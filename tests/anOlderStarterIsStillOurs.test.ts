// AN OLDER COPY OF OUR OWN STARTER IS STILL OURS (autopsy db07e0af, 2026-10-12).
//
// "Banao" on a workspace holding only our persisted starter built a made-up todo app for ₹96.93. Part of why: "ours"
// meant byte-equal to TODAY's template, and the design kit had changed since that starter was written — so every
// change to a template turned every older starter into "the user's app". The game kit had the same class (Q-863).
// `platformSeedHistory.ts` now holds every version every starter and starter-chip template has written. Locked here:
//   1. the CENSUS — every file every template writes TODAY is in the history (fails the day a template changes
//      without `node scripts/platformSeedHistory.mjs` being run);
//   2. the REAL CASE — the starter as it was before this very change (its kit saved in a fixture) is still ours,
//      to the "nothing is anybody's work here" question and to the "who wrote this file" question;
//   3. one changed byte makes it the user's, exactly as before;
//   4. a caller's own template list is answered by that list alone (the history stands only for the engine's sets).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { holdsOnlyOurStarter, isOurStarterFile, platformSeedTemplates, starterTemplates } from '../src/server/AgentV3/starterFragment';
import { isPlatformSeededFile, projectHasUserCode } from '../src/server/AgentV3/platformAuthored';
import { isKnownSeedVersion, seedHash } from '../src/server/AgentV3/seedVersions';
import { PLATFORM_SEED_HISTORY } from '../src/server/AgentV3/platformSeedHistory';
import { TemplateRegistry } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/TemplateRegistry';
import { strictTsconfig } from '../src/server/AgentV3/strictTrial';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
/** `src/index.css` exactly as the vite-react starter wrote it before the theme switch was added to the kit. */
const KIT_BEFORE = gunzipSync(readFileSync(join(__dirname, 'fixtures/designKitBeforeThemeSwitch.css.gz'))).toString('utf8');
const viteStarter = () => new TemplateRegistry().getProvider('vite-react').getFiles([]);

describe('1 · the census: every file a template writes today is in the history', () => {
  it('every framework starter file, as a starter', () => {
    const missing: string[] = [];
    for (const t of starterTemplates()) for (const [p, c] of Object.entries(t)) {
      if (typeof c === 'string' && c.trim() && !isKnownSeedVersion(p, c, 'starter')) missing.push(p);
    }
    expect(missing, 'run `node scripts/platformSeedHistory.mjs` after changing a template').toEqual([]);
  });
  it('every starter-chip template file, as one of ours', () => {
    const missing: string[] = [];
    for (const t of platformSeedTemplates()) for (const [p, c] of Object.entries(t)) {
      if (typeof c === 'string' && c.trim() && !isKnownSeedVersion(p, c, 'any')) missing.push(p);
    }
    expect(missing, 'run `node scripts/platformSeedHistory.mjs` after changing a template').toEqual([]);
  });
  it('a strict-trial tsconfig (Q-008) is recorded in its strict form too', () => {
    const ts = viteStarter()['tsconfig.json'];
    expect(isKnownSeedVersion('tsconfig.json', strictTsconfig(ts), 'starter')).toBe(true);
  });
  it('the script and the reader hash content the same way', () => {
    const css = viteStarter()['src/index.css'];
    expect(PLATFORM_SEED_HISTORY.starter['src/index.css']).toContain(seedHash(css));
    expect(PLATFORM_SEED_HISTORY.starter['src/index.css']).toContain(seedHash(`${css.replace(/\n/g, '\r\n')}\n\n`));
  });
});

describe('2 · the real case: the starter written before this change is still ours', () => {
  it('the fixture really is an older kit (not today\'s)', () => {
    expect(KIT_BEFORE).toContain('@media (prefers-color-scheme: dark)');
    expect(KIT_BEFORE).not.toContain(':root.dark');
    expect(KIT_BEFORE).not.toBe(viteStarter()['src/index.css']);
  });
  it('a workspace holding it is "nothing anybody wrote" — "Banao" is asked about, not built', () => {
    const files: Record<string, string> = { ...viteStarter(), 'src/index.css': KIT_BEFORE };
    expect(holdsOnlyOurStarter(files)).toBe(true);
    expect(isOurStarterFile('src/index.css', KIT_BEFORE, starterTemplates())).toBe(true);
  });
  it('and the reports never grade it as the user\'s code', () => {
    expect(isPlatformSeededFile('src/index.css', KIT_BEFORE)).toBe(true);
    expect(projectHasUserCode({ ...viteStarter(), 'src/index.css': KIT_BEFORE })).toBe(false);
  });
});

describe('3 · one changed byte makes it the user\'s', () => {
  const edited = KIT_BEFORE.replace('--accent: #4f46e5;', '--accent: #0f766e;');
  it('the edit really changed something', () => expect(edited).not.toBe(KIT_BEFORE));
  it('everywhere', () => {
    expect(holdsOnlyOurStarter({ ...viteStarter(), 'src/index.css': edited })).toBe(false);
    expect(isOurStarterFile('src/index.css', edited, starterTemplates())).toBe(false);
    expect(isPlatformSeededFile('src/index.css', edited)).toBe(false);
    expect(projectHasUserCode({ ...viteStarter(), 'src/index.css': edited })).toBe(true);
  });
  it('a file at a path no template ever wrote is never ours', () => {
    expect(isKnownSeedVersion('src/Cart.tsx', KIT_BEFORE)).toBe(false);
  });
});

describe('4 · the history stands only for the engine\'s own template sets', () => {
  it('a caller\'s own list is answered byte for byte by that list', () => {
    const own = [{ ...viteStarter() }];
    expect(isOurStarterFile('src/index.css', KIT_BEFORE, own)).toBe(false);
    expect(holdsOnlyOurStarter({ 'src/index.css': KIT_BEFORE }, own)).toBe(false);
  });
  it('the write path (completing a fragment) still needs today\'s template, byte for byte', () => {
    expect(read('src/server/AgentV3/starterFragment.ts')).toMatch(/export function starterFilesToComplete[\s\S]*?if \(!sameFile\(p, got, tpl\)\) return \[\];/);
  });
});
