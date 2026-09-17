import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { publicTierLabel, namesAProvider, PUBLIC_ENGINE_NAME, PROVIDER_IDENTITY_RE } from '../src/lib/engineLabels';

/**
 * 🔴 THE BLUNDER (admin, 2026-09-14, from his own phone):
 *   "navbharatai -> settings -> live metrics. live metric me PROVIDER KA NAAM SHOW HO RAHA HAI!
 *    maine kaha tha — kahi bhi kisi bhi prkar se real background provider ai ka naam show nahi
 *    hona chahiye (white labeling karni hai)."
 *
 * The card read "KIMI · 3 reqs · 23,73,820 tokens · $1.4916".
 *
 * The sweep that followed found the leak he saw was NOT the worst one: the POWER SELECTOR, which
 * every user opens and which is gated on nothing, printed "Normal — balanced (Sonnet)",
 * "Sonnet · 100%", "Opus · medium effort", "Opus · ultracode (max effort)".
 *
 * This suite is the half that lasts. CLAUDE.md's White-Label Law asks for exactly it: "a regression
 * test asserts that user-facing surfaces contain NONE of the forbidden vendor/model tokens, so a new
 * leak fails CI instead of reaching a user."
 */

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

/** Strip comments and imports — a vendor name in a code comment is documentation, not a leak. */
function renderableText(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|import\s|export\s+\{[^}]*\}\s+from)/.test(l))
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n');
}

describe('publicTierLabel — the choke point', () => {
  it('names no vendor on ANY tier, including tiers that do not exist', () => {
    for (const t of ['weak', 'off', 'mini', 'medium', 'max', '', 'nonsense', null, undefined]) {
      const label = publicTierLabel(t as never);
      expect(namesAProvider(label), `${t} -> ${label}`).toBe(false);
    }
  });

  it('🔴 the exact strings the power selector used to print are gone', () => {
    const labels = ['weak', 'off', 'mini', 'medium', 'max'].map((t) => publicTierLabel(t));
    for (const bad of ['Sonnet', 'Opus', 'Haiku', 'Claude', 'GLM', 'Kimi', 'Gemini']) {
      expect(labels.join(' | ')).not.toContain(bad);
    }
  });

  it('still tells the user what they are choosing between', () => {
    // A white-labelled name is not an excuse for a useless one — the tiers must still be rankable.
    expect(publicTierLabel('weak')).toMatch(/free/i);
    expect(publicTierLabel('off')).toMatch(/balanced/i);
    expect(publicTierLabel('mini')).toMatch(/strong/i);
    // The three LIVE tiers must be distinct — identical safe strings would be white-label theatre
    // rather than a fix.
    const live = ['weak', 'off', 'mini'].map(publicTierLabel);
    expect(new Set(live).size).toBe(3);
    // ⚠️ The retired tiers deliberately share 'mini' text: the server remaps a stored 'medium'/'max'
    // UP to Strong, so an old preference must read the tier it is ACTUALLY getting.
    expect(publicTierLabel('medium')).toBe(publicTierLabel('mini'));
    expect(publicTierLabel('max')).toBe(publicTierLabel('mini'));
  });

  it('an unknown tier falls back to the brand, never to a vendor', () => {
    expect(publicTierLabel('something-new-in-2027')).toContain(PUBLIC_ENGINE_NAME);
  });
});

describe('the two surfaces that leaked', () => {
  it('🔴 the power selector renders through the choke point, not a ternary', () => {
    const panel = renderableText(read('src/components/agentv3/AgentV3Panel.tsx'));
    expect(panel).toContain('publicTierLabel(powerLevel)');
    // The precise strings from the breach, which must not come back in any branch.
    for (const bad of ["'Normal — balanced (Sonnet)'", "'Sonnet · 100%'", "'Opus · medium effort'", "'Opus · ultracode (max effort)'"]) {
      expect(panel).not.toContain(bad);
    }
  });

  it('🔴 Settings → Live Metrics no longer renders a provider key as a heading', () => {
    const settings = renderableText(read('src/components/panels/SettingsPanel.tsx'));
    // The leak was `{provider}` printed from Object.entries(...tokens) — the cost is now aggregated.
    expect(settings).not.toContain('AI Cost by Provider');
    expect(settings).not.toMatch(/capitalize[^>]*>\{provider\}/);
    expect(settings).toContain('PUBLIC_ENGINE_NAME');
  });
});

/**
 * ⚠️ THE ALLOWLIST, AND WHY EACH ENTRY IS NOT A LEAK.
 *
 * The law covers which engine NAVBHARATAI ran. It does NOT cover a third-party AI the USER is adding
 * to THEIR OWN app — those are the user's integrations, chosen and paid for by them, and scrubbing
 * them would break the feature. Each file below is one of those, or an admin-only surface where
 * CLAUDE.md explicitly permits vendor identity.
 */
const ALLOWED: Record<string, string> = {
  // Admin-only surfaces. CLAUDE.md §3: "provider/model identity … MUST stay available to the admin:
  // the admin dashboard, build diagnostics, server logs, the deliveredVia / per-provider telemetry."
  'src/components/AdminDashboard.tsx': 'admin-only dashboard — vendor identity is permitted and needed',
  'src/lib/agentV3CostSummary.ts': 'feeds AdminDashboard only — per-tier cost rows for the admin',
  // The USER'S OWN third-party integrations. Naming them IS the feature.
  'src/components/ide/APIMarketplace.tsx': "catalogue of APIs the USER can add to THEIR app",
  'src/components/ide/AIChat.tsx': "the IDE's bring-your-own-key provider picker",
  'src/components/ide/SecurityScan.tsx': "uses the USER'S own key",
  'src/lib/credentialRecipes.ts': "setup recipes for the USER'S own provider accounts",
  // Reached only once the walk was widened. This is the bring-your-own-key provider map, and it is
  // the law being OBEYED rather than broken: every user-visible `label` is already white-labelled
  // ("Deep Reasoning Logic Core", "Sovereign Cognitive Engine"). What names a vendor is the `link`
  // the user clicks to fetch THEIR OWN key, which cannot be anything else — the same ground as
  // `credentialRecipes.ts` and the IDE's key picker above.
  'src/types/index.ts': "BYOK key-signup links to the USER'S own provider accounts; the labels are already white-labelled",
  'src/hooks/useChatEngine.ts': "forwards the USER'S own keys as headers",
  // The quick-start snippets name the CLIENT LIBRARY the developer installs (`openai` on npm/PyPI) to
  // call OUR endpoint — the model in every snippet is "navbharatai". The package name is the user's
  // own tooling, not the engine behind the answer; the prose deliberately says "chat-completions
  // format", never a vendor. (2026-09-17, Developer Tools → NavBharatAI API)
  'src/components/devtools/DeveloperApiCard.tsx': "the developer's OWN SDK package name in a quick-start snippet",
  // This module's whole job is to name the forbidden tokens so they can be kept out.
  'src/lib/engineLabels.ts': 'the choke point itself — it must contain the vocabulary it blocks',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

/**
 * 🔴 PROSE NEEDS A DIFFERENT DETECTOR, AND FINDING THAT OUT IS WHY THIS EXISTS.
 *
 * The sweep below reads STRING LITERALS, because in code an identifier or a type name cannot reach
 * a screen. That detector **cannot read prose at all**, and it fails silently. Proven, not assumed:
 * a probe reading "built by Claude Sonnet" was appended to `privacyPolicy.ts`, the file was in the
 * walk, and the sweep passed. The policy carries **27 apostrophes** ("the user's data", "Google's
 * own"), each of which a regex reads as a quote — so the pairing shifts and real text ends up
 * treated as the gap BETWEEN two literals, never tested.
 *
 * So `src/content` is swept WHOLE instead. That is sound precisely here and nowhere else: these
 * files are long-form text shown to users — the Privacy Policy, Terms, DPA, Security note — with no
 * provider identifiers to false-positive on. They contain none today (verified before this landed).
 *
 * ⚠️ THE SAME APOSTROPHE FLAW STILL AFFECTS THE CODE TREES, and it is recorded rather than papered
 * over: a component holding `"the user's app"` shifts its own pairing too, so a vendor literal
 * further down that file can be missed. Reading it correctly needs a real tokenizer, not a wider
 * regex — a decision, not a lint, and recorded as an open root cause in `PROGRESS.md`.
 */
describe('🔒 long-form user-facing TEXT may not name a vendor', () => {
  it('sweeps src/content whole, because a literal matcher cannot read prose', () => {
    const files = walk(resolve(root, 'src/content'));
    expect(files.length).toBeGreaterThan(4);           // never vacuous
    const offenders: string[] = [];
    for (const full of files) {
      const rel = relative(root, full).replace(/\\/g, '/');
      if (ALLOWED[rel]) continue;
      const text = renderableText(readFileSync(full, 'utf8'));
      const hit = text.match(PROVIDER_IDENTITY_RE);
      if (hit) offenders.push(`${rel}: names "${hit[0]}"`);
    }
    expect(offenders, `User-facing text names an AI vendor:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('and it really would catch one — the detector is not vacuous', () => {
    const planted = renderableText('export const T = `Your app is built by Claude Sonnet, and the '
      + "user's data stays put.`;");
    expect(PROVIDER_IDENTITY_RE.test(planted)).toBe(true);
  });
});

describe('🔒 no NEW user-facing surface may name a vendor', () => {
  it('sweeps every client file that is not explicitly allowed', () => {
    // 🔴 WIDENED 2026-09-17. This walked components/lib/hooks only, so FOUR client trees carrying
    // user-facing text were outside an ABSOLUTE rule's only guard — `src/content` most of all: the
    // Privacy Policy, Terms and DPA are read by users and by Google's and Meta's reviewers.
    // (Swept the same day: no actual leak was hiding there — every vendor mention in the unwalked
    // files was a comment, an internal object key, or the permitted bring-your-own-key surface. The
    // gap was in what could come NEXT, and nothing about its narrowness could ever have failed.)
    const files = [
      ...walk(resolve(root, 'src/components')),
      ...walk(resolve(root, 'src/lib')),
      ...walk(resolve(root, 'src/hooks')),
      // `src/content` is deliberately NOT here — see the prose sweep below. A regex literal
      // matcher cannot read prose, and putting it here would have looked like coverage.
      ...walk(resolve(root, 'src/config')),
      ...walk(resolve(root, 'src/services')),
      ...walk(resolve(root, 'src/types')),
      resolve(root, 'src/App.tsx'),
      resolve(root, 'src/main.tsx'),
      resolve(root, 'src/swUpdateCheck.ts'),
    ];
    // A walk that reached nothing would pass vacuously — the failure mode this repo keeps paying for.
    expect(files.length).toBeGreaterThan(200);
    expect(files.map((f) => relative(root, f))).toContain('src/types/index.ts');
    const offenders: string[] = [];
    for (const full of files) {
      const rel = relative(root, full).replace(/\\/g, '/');
      if (ALLOWED[rel]) continue;
      const text = renderableText(readFileSync(full, 'utf8'));
      // Only STRING LITERALS can reach a screen; an identifier or a type name cannot.
      //
      // ⚠️ TWO BOUNDS CORRECTED 2026-09-17, both found by widening the walk above.
      //
      // `{2,200}` required at least TWO characters, so an EMPTY literal could not match — and the
      // matcher then paired the wrong quotes. In `{ gemini: '', groq: '' }` it skipped quote 1,
      // paired quotes 2 and 3, and reported the source between them (`, groq: `) as a user-facing
      // string. Worse than the false positive: every pairing after a mis-pair is shifted by one, so
      // a genuine vendor literal further down the same file could be read as the gap BETWEEN two
      // literals and never tested. `{0,...}` keeps the pairing aligned; an empty string names no
      // vendor, so admitting it costs nothing.
      //
      // The 200-character ceiling silently skipped any literal longer than that — which is EVERY
      // piece of long-form user-facing text in `src/content`, the Privacy Policy and Terms
      // included. Widening the walk to reach those files would have achieved nothing while this
      // cap stood: the file would be read and then wholly ignored.
      for (const m of text.matchAll(/(['"`])((?:(?!\1)[^\\]|\\.){0,20000}?)\1/g)) {
        const lit = m[2];
        if (namesAProvider(lit)) offenders.push(`${rel}: ${lit.slice(0, 90)}`);
      }
    }
    expect(offenders, `A user-facing string names a vendor. If this is the USER'S OWN integration, add the file to ALLOWED with a reason.\n${offenders.join('\n')}`).toEqual([]);
  });
});
