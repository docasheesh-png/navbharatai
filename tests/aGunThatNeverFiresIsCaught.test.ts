/**
 * A GUN THAT NEVER FIRES IS CAUGHT BY PLAYING (build reports #2526–#2530, 2026-11-25).
 *
 * The user asked for a gun in an open world. #2526 placed it in the hero's hand, #2527 wrote a fire feature on APIs that do
 * not exist and never listed it, #2528 wrote a second one, #2529 broke it — and no build ever pressed the fire key, because
 * the playtest only pressed the arrows, WASD, Space and a drag. So "the gun works" was never measured, in five builds.
 *
 * The class: an ACTION the game is built around is never exercised by the playtest. The fix:
 *   • the kit's Weapon counts itself on window.__nbWeapons, and the Game shell counts the PLAYER's own shots and swings
 *     (window.__nbKit.attacks) from the events it already reads;
 *   • the playtest's fireProbe presses F, J and a click in any game that made a gun and reads the shots back — reported
 *     through the rule probes (GAME_RULE_BROKEN, with a one-tap fix that names the wiring).
 * The probe runs here, as written, in a real browser, against a page whose gun fires and one whose gun does not.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { generateGameSystems } from '../src/server/lib/GameSystemsGenerator';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';
import { gamePlaytestModule, gamePlaytestConfig, ruleProbeMessage, RULE_EVENTS } from '../src/server/AgentV3/gamePlaytest';
import { reportRuleProbes } from '../src/server/AgentV3/buildPhases/gameRuleProbes';
import { buildFindingSuggestions } from '../src/server/AgentV3/buildFindingSuggestions';

/* eslint-disable @typescript-eslint/no-explicit-any */
const DIR = join(__dirname, `.tmp-gun-fires-${process.pid}`);
let Wp: any;
beforeAll(async () => {
  (globalThis as any).window ??= {};
  delete (globalThis as any).window.__nbWeapons;
  for (const r of [generateGameRuntime(), generateGameSystems()]) {
    for (const [p, c] of Object.entries(r.files)) { const f = join(DIR, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
  }
  Wp = await import(join(DIR, 'src/game/systems/weapon.ts'));
}, 60_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

describe('the kit says a gun exists and counts the player\'s own shots', () => {
  it('every Weapon the game makes is counted on window.__nbWeapons', () => {
    const before = (globalThis as any).window.__nbWeapons ?? 0;
    new Wp.Weapon('pistol'); new Wp.Weapon('rifle');
    expect((globalThis as any).window.__nbWeapons).toBe(before + 2);
  });
  it('the shell hook exposes attacks(), counted in the SAME handlers that decide a shot is the player\'s', () => {
    const shell = generateGameShell().files['src/game/Game.ts'] ?? '';
    expect(shell).toMatch(/const hook = \{[^}]*attacks: \(\) => \(\{ \.\.\.attacks \}\)/);
    expect(shell).toMatch(/events\.on\('WEAPON_FIRED', \(p\) => \{ if \(playersOwn\(p\)\) \{ attacks\.fired\+\+;/);
    expect(shell).toMatch(/events\.on\('MELEE_SWING', \(p\) => \{ if \(playersOwn\(p\)\) \{ attacks\.swung\+\+;/);
  });
});

const script = gamePlaytestModule({ ...gamePlaytestConfig('http://x'), rules: [], ruleEvents: RULE_EVENTS }, '');
const probeSource = script.slice(script.indexOf('async function fireProbe(page)'), script.indexOf('// FIRE_PROBE_END'));

describe('🔒 the script presses fire', () => {
  it('fireProbe exists, presses F, J and a click, and runs before the rules (which may end the round)', () => {
    expect(probeSource.length).toBeGreaterThan(100);
    expect(probeSource).toMatch(/'KeyF', 'KeyJ'/);
    expect(probeSource).toMatch(/page\.mouse\.click/);
    expect(script.indexOf('await fireProbe(page)')).toBeGreaterThan(script.indexOf('out.restartCheck = { ended, pressed, after }'));
    expect(script.indexOf('await fireProbe(page)')).toBeLessThan(script.indexOf('const h = window.__nbRules'));
  });
  it('the whole script is valid JavaScript', () => {
    expect(() => new Function(`return (async () => { ${script.replace(/^import .*$/m, '')} })`)).not.toThrow();
  });
});

// A page with the kit's two hooks. `wired` decides whether the attack keys reach the gun.
const page = (wired: boolean, guns = 1, status = 'playing') => `<!doctype html><html><body style="margin:0"><canvas width="800" height="600"></canvas><script>
  window.__nbWeapons = ${guns};
  const attacks = { fired: 0, swung: 0 };
  window.__nbKit = { status: () => '${status}', attacks: () => ({ ...attacks }) };
  const shoot = () => { if (${wired}) attacks.fired++; else attacks.swung++; };
  addEventListener('keydown', (e) => { if (!e.repeat && (e.code === 'KeyF' || e.code === 'KeyJ')) shoot(); });
  addEventListener('mousedown', (e) => { if (e.button === 0) shoot(); });
</script></body></html>`;

// The repo's real-browser tests share this path (aCameraInsideTheTrainIsCaught): the container's own Playwright.
const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const haveBrowser = existsSync(PW) && existsSync('/opt/pw-browsers');

describe.skipIf(!haveBrowser)('🎮 the probe, run in a real browser', () => {
  let browser: any; let run: (html: string) => Promise<any>;
  beforeAll(async () => {
    const { chromium } = (await import(PW)).default;
    browser = await chromium.launch();
    const fireProbe = new Function(`${probeSource}; return fireProbe;`)();
    run = async (html) => {
      const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
      const p = await ctx.newPage();
      await p.setContent(html);
      try { return await fireProbe(p); } finally { await ctx.close(); }
    };
  }, 60_000);
  afterAll(async () => { await browser?.close(); });

  it('a gun that fires → held, with the shots counted', async () => {
    const r = await run(page(true));
    expect(r).toMatchObject({ id: 'player-can-fire', verdict: 'held' });
    expect(r.why).toMatch(/^4 shot\(s\)/);
  }, 30_000);
  it('🔴 the #2526–#2530 game: a gun in the hand, nothing fires → not-held, and says what happened instead', async () => {
    const r = await run(page(false));
    expect(r).toMatchObject({ id: 'player-can-fire', verdict: 'not-held' });
    expect(r.why).toMatch(/no shot \(4 melee swing\(s\) instead\) though the game has 1 gun/);
  }, 30_000);
  it('no gun → no probe at all (a racing game is never asked to shoot)', async () => {
    expect(await run(page(false, 0))).toBeNull();
  }, 30_000);
  it('a round not in play → not checkable, never "broken"', async () => {
    expect(await run(page(false, 1, 'gameover'))).toMatchObject({ verdict: 'not-checkable' });
  }, 30_000);
});

describe('the verdict reaches the builder', () => {
  it('a gun that does not fire is GAME_RULE_BROKEN, said in words, with a fix that names the wiring', () => {
    const recorded: any[] = [];
    const code = reportRuleProbes([{ id: 'player-can-fire', verdict: 'not-held', why: 'F, J and a click fired no shot though the game has 1 gun(s)' }], { record: (i) => recorded.push(i), say: () => undefined });
    expect(code).toBe('GAME_RULE_BROKEN');
    expect(recorded[0].message).toMatch(/the player's gun fires — does NOT work/);
    expect(ruleProbeMessage([{ id: 'player-can-fire', verdict: 'held', why: '2 shot(s)' }])).toMatch(/gun fires — works/);
    const fix = buildFindingSuggestions([{ code: 'GAME_RULE_BROKEN', message: recorded[0].message, severity: 'warning' } as any]);
    expect(JSON.stringify(fix)).toMatch(/weapon\.update\(dt, ctx\.input\.isDown\('attack'\)/);
  });
});
