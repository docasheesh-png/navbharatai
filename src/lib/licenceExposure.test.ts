/**
 * A LEGAL RISK WRITTEN ONLY IN A DOCUMENT IS A RISK NOBODY CAN ACT ON (admin 2026-09-09).
 *
 * Two runtime services run on free tiers their own terms reserve for NON-COMMERCIAL use, while
 * NavBharatAI charges money — so the exposure is live today, not at some future scale. Both had been
 * sitting as open items in CLAUDE.md and PROGRESS.md for weeks, where the admin (who does not read
 * source) could never see them.
 *
 * The rules below are the ones that make this a feature rather than prose in a .ts file: the register
 * reads the SAME switch the source obeys, "off" is never presented as a fix, and no credential value
 * can leak through it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import {
  LICENCE_EXPOSURES,
  liveWeatherSourceEnabled,
  exposureState,
  licenceExposures,
  activeExposureCount,
  licenceExposureHeadline,
} from './licenceExposure';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('the weather switch — one definition, obeyed by the source AND reported by the panel', () => {
  it('🔴 is OFF by default — reversed 2026-09-20, and the reversal is the fix, not a detail', () => {
    // It used to default ON, so a licence exposure was live on every deployment unless somebody
    // typed a value into a console. On-by-default and off-by-effort is backwards for a legal risk:
    // the effort belongs on the side that costs money.
    expect(liveWeatherSourceEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(liveWeatherSourceEnabled({ LIVE_WEATHER_SOURCE: 'on' } as never)).toBe(true);
    expect(liveWeatherSourceEnabled({ LIVE_WEATHER_SOURCE: ' ON ' } as never)).toBe(true);
    expect(liveWeatherSourceEnabled({ LIVE_WEATHER_SOURCE: 'off' } as never)).toBe(false);
  });

  it('🔒 anything unreadable stays OFF — the safe direction for a legal exposure', () => {
    // The mirror image of the AGENTV3_FEATURE_HEAL_PCT trap this repo already paid for, where a
    // mistyped value silently meant "everyone". Here a typo must never mean "start calling".
    for (const v of ['', '   ', 'true', 'yes', 'ON!', '1', 'enabled', 'onn']) {
      expect(liveWeatherSourceEnabled({ LIVE_WEATHER_SOURCE: v } as never), v).toBe(false);
    }
  });

  it('🔒 the SOURCE reads this exact function — a panel that kept its own opinion would be a false assurance', () => {
    // This is the whole design. If the dispatcher stopped importing it, the card could report "off"
    // while the calls kept going out — worse than no card at all, because it would be believed.
    const src = read('../server/lib/liveDataSources.ts');
    expect(src).toContain("import { liveWeatherSourceEnabled } from '../../lib/licenceExposure'");
    expect(src).toContain('liveWeatherSourceEnabled(env)');
    // The switch gates the weather block, and only that one.
    expect(src).toContain('if (liveWeatherSourceEnabled(env)) sources.push(weatherBlock);');
  });

  it('🔒 the restricted host has exactly ONE caller left — the AQI one is GONE, not merely moved', () => {
    // ⚠️ THIS REPLACES an assertion that the switch removed "BOTH Open-Meteo callers" (the old
    // ternary `? [weatherBlock, aqiBlock, …]`). That assertion's FACT changed on 2026-09-20: air
    // quality moved to CPCB's own feed, which is licensed for commercial use, so there is only one
    // restricted caller now.
    //
    // It is replaced by something STRONGER rather than merely updated. The old line proved a list's
    // shape; this proves the restricted HOST is unreachable from the AQI path at all — which is the
    // thing that actually matters, and which a future edit re-adding the old call would break even
    // if it kept the list looking right.
    const src = read('../server/lib/liveDataSources.ts');
    expect(src).not.toContain('air-quality-api.open-meteo.com');
    // The weather forecast + its geocoder are the ONE remaining restricted pair.
    expect(src).toContain('api.open-meteo.com/v1/forecast');
  });

  it('🔒 AQI is gated by its OWN credential, never by the weather switch', () => {
    // Pausing a provider's licence exposure must not also silence a properly licensed source —
    // otherwise pausing the problem pauses the fix.
    const src = read('../server/lib/liveDataSources.ts');
    expect(src).toContain('if (cpcbAqiConfigured(env)) sources.push(');
    const weatherGate = src.indexOf('if (liveWeatherSourceEnabled(env)) sources.push(weatherBlock);');
    const aqiGate = src.indexOf('if (cpcbAqiConfigured(env)) sources.push(');
    expect(weatherGate).toBeGreaterThan(-1);
    expect(aqiGate).toBeGreaterThan(weatherGate); // two separate statements, not one condition
  });

  it('the sources that are NOT restricted keep working when it is off', () => {
    const src = read('../server/lib/liveDataSources.ts');
    // Currency and PIN code are pushed unconditionally — outside every gate.
    expect(src).toContain('sources.push(currencyBlock, pincodeBlock);');
  });
});

describe('exposureState — what is actually running right now', () => {
  const vt = LICENCE_EXPOSURES.find((e) => e.id === 'virustotal')!;
  const om = LICENCE_EXPOSURES.find((e) => e.id === 'open-meteo')!;

  it('a key-gated source is active only when its key is present', () => {
    expect(exposureState(vt, { VIRUSTOTAL_API_KEY: 'k' } as never)).toBe('active');
    expect(exposureState(vt, {} as never)).toBe('not-configured');
    expect(exposureState(vt, { VIRUSTOTAL_API_KEY: '   ' } as never)).toBe('not-configured');
  });

  it('🔴 the key-free source now reads SWITCHED-OFF on a fresh deployment', () => {
    // It used to read 'active' here, and that was the honest report of a wrong default. Both moved
    // together: the source stopped running AND the panel stopped saying it was.
    expect(exposureState(om, {} as never)).toBe('switched-off');
    expect(exposureState(om, { LIVE_WEATHER_SOURCE: 'on' } as never)).toBe('active');
    expect(exposureState(om, { LIVE_WEATHER_SOURCE: 'off' } as never)).toBe('switched-off');
  });

  it('🔒 the panel ASKS the source\'s own function — it does not re-derive the rule', () => {
    // Two implementations of one rule is exactly how a panel comes to say "off" while the calls
    // keep going out. `exposureState` must agree with `liveWeatherSourceEnabled` on every input.
    for (const v of [undefined, '', 'on', ' ON ', 'off', 'true', 'garbage']) {
      const env = (v === undefined ? {} : { LIVE_WEATHER_SOURCE: v }) as never;
      const running = liveWeatherSourceEnabled(env);
      expect(exposureState(om, env), String(v)).toBe(running ? 'active' : 'switched-off');
    }
  });

  it('switched-off beats everything — an off source is not in use, whatever its key says', () => {
    const keyed = { ...om, requires: 'SOME_KEY' };
    expect(exposureState(keyed, { SOME_KEY: 'x', LIVE_WEATHER_SOURCE: 'off' } as never)).toBe('switched-off');
  });
});

describe('the register as a whole', () => {
  it('counts only what is running', () => {
    // 🔴 A FRESH DEPLOYMENT NOW COUNTS ZERO. Before 2026-09-20 an untouched environment ran the
    // weather source, so `{}` counted 1 — the number that made this panel worth building.
    expect(activeExposureCount({} as never)).toBe(0);
    expect(activeExposureCount({ VIRUSTOTAL_API_KEY: 'k' } as never)).toBe(1);  // the scanner only
    expect(activeExposureCount({ LIVE_WEATHER_SOURCE: 'on' } as never)).toBe(1); // the weather only
    expect(activeExposureCount({ VIRUSTOTAL_API_KEY: 'k', LIVE_WEATHER_SOURCE: 'on' } as never)).toBe(2);
  });

  it('🔒 every row carries the sentence the card shows about its switch', () => {
    // The component must never build this line itself: it always said "=off", which went false the
    // day a default flipped and `on` became the word that matters.
    for (const row of LICENCE_EXPOSURES) {
      expect(row.switchHint, row.id).toBeTruthy();
    }
    const weather = LICENCE_EXPOSURES.find((e) => e.id === 'open-meteo')!;
    expect(weather.switchHint).toContain('LIVE_WEATHER_SOURCE=on');
    expect(weather.switchHint).not.toContain('=off');
  });

  it('🔒 the card renders the row\'s sentence, not one of its own', () => {
    const dash = read('../components/AdminDashboard.tsx');
    expect(dash).toContain('{row.switchHint}');
    expect(dash).not.toContain('=off in Cloud Run');
  });

  it('every row carries the four things an admin needs to decide', () => {
    for (const row of licenceExposures({} as never)) {
      expect(row.name, row.id).toBeTruthy();
      expect(row.restriction, row.id).toBeTruthy();
      expect(row.powers, row.id).toBeTruthy();
      expect(row.honestFix, row.id).toBeTruthy();
      expect(row.whenOff, row.id).toBeTruthy();
      expect(['active', 'switched-off', 'not-configured']).toContain(row.state);
    }
  });

  it('🔒 every row says the real fix is a PURCHASE — "off" must never read as solved', () => {
    // The failure this prevents is subtle and permanent: an admin who switches something off and
    // believes the exposure is closed will never buy the plan, and the risk returns the day someone
    // switches it back on.
    for (const row of LICENCE_EXPOSURES) {
      expect(row.honestFix.toLowerCase(), row.id).toMatch(/buy|plan|commercial/);
      expect(row.honestFix.toLowerCase(), row.id).toContain('cannot be fixed in code');
    }
  });

  it('🔒 no row can leak a secret — it names env KEYS, never values', () => {
    const blob = JSON.stringify(LICENCE_EXPOSURES);
    expect(blob).toContain('VIRUSTOTAL_API_KEY'); // the NAME is fine and necessary
    // A value would have to arrive through `requires`/`killSwitch`, which are read from the env by
    // `exposureState` and never copied into a row.
    for (const row of licenceExposures({ VIRUSTOTAL_API_KEY: 'super-secret-value' } as never)) {
      expect(JSON.stringify(row)).not.toContain('super-secret-value');
    }
  });

  it('the headline is honest in BOTH directions', () => {
    // Both running now takes an explicit `on` for the weather — the default stopped doing it for us
    // on 2026-09-20. The assertion's point is unchanged: when two are live, the headline says two.
    const running = licenceExposureHeadline({ VIRUSTOTAL_API_KEY: 'k', LIVE_WEATHER_SOURCE: 'on' } as never);
    expect(running).toMatch(/2 of 2/);
    expect(running.toLowerCase()).toContain('pause, not a fix');
    // Zero running is "not currently exposed", never "solved" — one env change reverses it.
    const none = licenceExposureHeadline({} as never);
    expect(none.toLowerCase()).toContain('none of the');
    expect(none.toLowerCase()).not.toMatch(/\bsolved\b|\bsafe\b|\bfixed\b/);
  });
});

describe('the admin surface is wired, admin-only, and read-only', () => {
  const route = read('../server/routes/admin.ts');
  const panel = read('../components/AdminDashboard.tsx');

  it('the route exists behind the admin token and returns the register', () => {
    expect(route).toContain("app.get('/api/admin/licence-exposure', verifyAdminToken");
    expect(route).toContain('licenceExposures()');
    expect(route).toContain('licenceExposureHeadline()');
  });

  it('the panel fetches it when the Security tab opens, and renders the honest fix', () => {
    expect(panel).toContain("fetch('/api/admin/licence-exposure'");
    expect(panel).toContain('fetchLicenceExposure()');
    expect(panel).toContain('The real fix:');
    expect(panel).toContain('If switched off:');
  });

  it('🔒 there is NO write path — a licence decision is not a button', () => {
    // Turning a source off is a Cloud Run change the admin makes deliberately. A one-click toggle here
    // would let a mis-tap stop App Store publishing for every user with no audit trail.
    const at = panel.indexOf('Licence exposure');
    const card = panel.slice(at, at + 3500);
    expect(card).not.toMatch(/onClick=\{[^}]*licence/i);
    expect(route).not.toContain("app.post('/api/admin/licence-exposure'");
  });
});
