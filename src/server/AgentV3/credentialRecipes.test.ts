import { describe, it, expect } from 'vitest';
import {
  CREDENTIAL_RECIPES, recipeFor, preferredOption, recipeVarNames, optionSource, optionLink,
  requiredVarNames, isSameCredentialName,
} from './credentialRecipes';
import { serviceEnvNames, servicePackages, detectAppRequirements } from './AppRequirements';

const pkg = (deps: Record<string, string>) => JSON.stringify({ name: 'app', dependencies: deps });

describe('the catalogue is internally sound', () => {
  it('has no duplicate ids', () => {
    const ids = CREDENTIAL_RECIPES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every recipe has at least one option, and every option has at least one variable', () => {
    for (const r of CREDENTIAL_RECIPES) {
      expect(r.options.length, r.id).toBeGreaterThan(0);
      for (const o of r.options) expect(o.vars.length, `${r.id}/${o.provider}`).toBeGreaterThan(0);
    }
  });

  it('every option carries a real https link, a host label, a path and a cost', () => {
    for (const r of CREDENTIAL_RECIPES) {
      for (const o of r.options) {
        const where = `${r.id}/${o.provider}`;
        expect(() => new URL(o.link), where).not.toThrow();
        expect(new URL(o.link).protocol, where).toBe('https:');
        // The label is what a user reads on a surface where the link is not clickable, so it has to be
        // the actual host — a label that disagrees with its own link sends people to the wrong site.
        expect(o.link, where).toContain(o.linkLabel.split('/')[0]);
        expect(o.path.trim().length, where).toBeGreaterThan(0);
        expect(o.cost.trim().length, where).toBeGreaterThan(0);
      }
    }
  });

  it('every variable says where to find it', () => {
    for (const r of CREDENTIAL_RECIPES) {
      for (const o of r.options) {
        for (const v of o.vars) expect(v.where.trim().length, `${r.id}/${v.name}`).toBeGreaterThan(0);
      }
    }
  });

  it('keyless is either null or a real sentence — never an empty string pretending to be an answer', () => {
    for (const r of CREDENTIAL_RECIPES) {
      if (r.keyless === null) continue;
      expect(r.keyless.trim().length, r.id).toBeGreaterThan(20);
    }
  });
});

// THE LOCK. AppRequirements.ts owns the env-var names; this file only annotates them. If a name is
// renamed there and not here, the annotation silently stops appearing and the user is back to a
// checklist with no "where do I get it" — the exact failure this module was built to end, returning
// quietly. These two tests make that failure loud instead.
describe('anti-drift: the recipes stay pinned to AppRequirements\' catalogue', () => {
  it('every recipe id is a real service id', () => {
    for (const r of CREDENTIAL_RECIPES) {
      expect(serviceEnvNames(r.id), `${r.id} is not a service in AppRequirements`).not.toEqual([]);
    }
  });

  it('every annotated variable name is one AppRequirements actually knows for that service', () => {
    for (const r of CREDENTIAL_RECIPES) {
      const known = new Set(serviceEnvNames(r.id));
      for (const name of recipeVarNames(r.id)) {
        expect(known.has(name), `${r.id} annotates ${name}, which AppRequirements does not know`).toBe(true);
      }
    }
  });

  it('every requirement a user can actually be asked for has a recipe', () => {
    // A `kind: 'user'` service with no recipe still renders — it just loses the link. This asserts we
    // have not left one behind, because "which key" without "where from" is the original problem.
    const everyUserService = detectAppRequirements({
      files: {
        'package.json': pkg({
          razorpay: '^2.9.0', 'cashfree-pg': '^4.0.0', stripe: '^14.0.0', nodemailer: '^6.9.0',
          resend: '^3.0.0', twilio: '^4.0.0', 'mapbox-gl': '^3.0.0', openai: '^4.0.0',
          cloudinary: '^2.0.0', '@clerk/clerk-react': '^5.0.0', '@supabase/supabase-js': '^2.0.0',
        }),
      },
    }).filter((r) => r.kind === 'user');
    expect(everyUserService.length).toBeGreaterThan(8);
    for (const r of everyUserService) expect(recipeFor(r.id), `no recipe for ${r.id}`).not.toBeNull();
  });
});

describe('preferredOption — the app\'s own code picks the provider', () => {
  const maps = recipeFor('maps');

  it('picks the provider whose variable the app actually reads', () => {
    expect(preferredOption(maps, { envVars: ['VITE_MAPBOX_ACCESS_TOKEN'] })?.provider).toBe('Mapbox');
    expect(preferredOption(maps, { envVars: ['VITE_GOOGLE_MAPS_API_KEY'] })?.provider).toBe('Google Maps');
  });

  it('falls back to the declared PACKAGE when no variable is read yet', () => {
    // The real case this exists for: `mapbox-gl` is in package.json but no token is referenced yet.
    // Without the package signal this app would be sent to the Google Cloud Console.
    expect(preferredOption(maps, { packages: ['mapbox-gl'] })?.provider).toBe('Mapbox');
    expect(preferredOption(maps, { packages: ['@react-google-maps/api'] })?.provider).toBe('Google Maps');
  });

  it('the variable wins over the package when they disagree', () => {
    // A leftover dependency must not override what the code demonstrably reads.
    expect(
      preferredOption(maps, { envVars: ['VITE_MAPBOX_ACCESS_TOKEN'], packages: ['@react-google-maps/api'] })?.provider,
    ).toBe('Mapbox');
  });

  it('falls back to the first (easiest to obtain) option when the app reveals neither', () => {
    expect(preferredOption(maps, {})?.provider).toBe('Google Maps');
    expect(preferredOption(maps, null)?.provider).toBe('Google Maps');
    expect(preferredOption(maps, { envVars: ['SOMETHING_ELSE'], packages: ['lodash'] })?.provider).toBe('Google Maps');
  });

  it('is null-safe for a service we have no recipe for', () => {
    expect(preferredOption(null, { envVars: ['X'] })).toBeNull();
    expect(preferredOption(recipeFor('no_such_service'), {})).toBeNull();
    expect(recipeFor(null)).toBeNull();
    expect(recipeFor(undefined)).toBeNull();
  });
});

describe('anti-drift: the package signals stay pinned to AppRequirements too', () => {
  it('every package a recipe claims is one AppRequirements uses to detect that service', () => {
    for (const r of CREDENTIAL_RECIPES) {
      const known = new Set(servicePackages(r.id));
      for (const o of r.options) {
        for (const p of o.packages || []) {
          expect(known.has(p), `${r.id}/${o.provider} claims ${p}, which AppRequirements does not detect`).toBe(true);
        }
      }
    }
  });
});

describe('requiredVarNames — the app names them, the recipe completes them', () => {
  const razorpay = preferredOption(recipeFor('payments_razorpay'), {});
  const mapbox = preferredOption(recipeFor('maps'), { packages: ['mapbox-gl'] });

  it('asks only for the CHOSEN provider\'s keys, never the alternative provider\'s', () => {
    expect(requiredVarNames(mapbox, [])).toEqual(['VITE_MAPBOX_ACCESS_TOKEN']);
    expect(requiredVarNames(mapbox, []).join()).not.toMatch(/GOOGLE/);
  });

  it('uses the name the APP actually reads when it differs only by a browser prefix', () => {
    // The app reads the server-side name. Telling this user to save VITE_MAPBOX_ACCESS_TOKEN would
    // leave the map just as broken, because nothing in their code would ever read it.
    expect(requiredVarNames(mapbox, ['MAPBOX_ACCESS_TOKEN'])).toEqual(['MAPBOX_ACCESS_TOKEN']);
  });

  it('still completes the set — a key referenced without its secret gets both', () => {
    expect(requiredVarNames(razorpay, ['RAZORPAY_KEY_ID'])).toEqual(['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET']);
  });

  it('falls back to whatever the app reads when there is no recipe at all', () => {
    expect(requiredVarNames(null, ['SOME_KEY'])).toEqual(['SOME_KEY']);
    expect(requiredVarNames(null, null)).toEqual([]);
  });

  it('treats the three browser prefixes as the same credential', () => {
    expect(isSameCredentialName('VITE_X_TOKEN', 'X_TOKEN')).toBe(true);
    expect(isSameCredentialName('NEXT_PUBLIC_X_TOKEN', 'X_TOKEN')).toBe(true);
    expect(isSameCredentialName('REACT_APP_X_TOKEN', 'VITE_X_TOKEN')).toBe(true);
    expect(isSameCredentialName('X_TOKEN', 'Y_TOKEN')).toBe(false);
    // A bare prefix is not a credential name, and must not collapse everything into one match.
    expect(isSameCredentialName('VITE_', 'NEXT_PUBLIC_')).toBe(false);
  });
});

describe('rendering', () => {
  const razorpay = preferredOption(recipeFor('payments_razorpay'), {});

  it('optionLink is just the clickable link — short enough for a build message', () => {
    expect(optionLink(razorpay)).toBe('[dashboard.razorpay.com](https://dashboard.razorpay.com/app/keys)');
    expect(optionLink(null)).toBe('');
  });

  it('optionSource adds the console path, for surfaces with room for it', () => {
    const full = optionSource(razorpay);
    expect(full).toContain('dashboard.razorpay.com');
    expect(full).toContain('API Keys');
    expect(optionSource(null)).toBe('');
  });
});

describe('the safety facts a first-timer trips on are recorded', () => {
  it('marks the values that must never reach a browser bundle', () => {
    const stripe = preferredOption(recipeFor('payments_stripe'), {});
    expect(stripe?.vars.find((v) => v.name === 'STRIPE_SECRET_KEY')?.serverOnly).toBe(true);
    // The publishable key is genuinely safe to expose — flagging it would train people to ignore the flag.
    expect(stripe?.vars.find((v) => v.name === 'STRIPE_PUBLISHABLE_KEY')?.serverOnly).toBeUndefined();
  });

  it('records the test-key prefixes, so a live app shipping a sandbox key can be caught deterministically', () => {
    const stripe = preferredOption(recipeFor('payments_stripe'), {});
    expect(stripe?.vars.find((v) => v.name === 'STRIPE_SECRET_KEY')?.testPrefixes).toContain('sk_test_');
    const razor = preferredOption(recipeFor('payments_razorpay'), {});
    expect(razor?.vars.find((v) => v.name === 'RAZORPAY_KEY_ID')?.testPrefixes).toContain('rzp_test_');
  });

  it('offers the keyless route where one genuinely exists, and stays null where it does not', () => {
    // India-first: real money with no gateway account at all.
    expect(recipeFor('payments_razorpay')?.keyless).toMatch(/UPI/);
    expect(recipeFor('maps')?.keyless).toMatch(/OpenStreetMap/);
    expect(recipeFor('database_hosted')?.keyless).toMatch(/one tap/);
    // There is no honest keyless way to send transactional email — saying otherwise would be a lie.
    expect(recipeFor('email_smtp')?.keyless).toBeNull();
    expect(recipeFor('email_api')?.keyless).toBeNull();
  });
});

describe('WHITE-LABEL: the catalogue never names one of NavBharatAI\'s own AI vendors', () => {
  it('holds across every string in the file', () => {
    const blob = JSON.stringify(CREDENTIAL_RECIPES);
    for (const vendor of ['GLM', 'Z.ai', 'Kimi', 'Moonshot', 'Claude', 'Anthropic', 'Sonnet', 'Opus', 'Vertex', 'Grok', 'Bedrock']) {
      expect(blob, `leaks ${vendor}`).not.toContain(vendor);
    }
  });
});
