// A GAME STAYS SMOOTH ON A BUDGET PHONE (admin 2026-11-21 plan). Two halves:
//   1. a cheap phone STARTS one picture level lower (it used to start at the top and stutter for its first seconds);
//   2. the playtest reads what each frame asks of the GPU from the kit game's own renderer, and a game over the
//      budget-phone limit is a real defect with a one-tap fix — an unmeasured game is never accused.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';
import { BUDGET_PHONE, tooHeavyForBudgetPhones, playtestDefects, gamePlaytestScript, type PlaytestRun } from '../src/server/AgentV3/gamePlaytest';
import { buildFindingSuggestions } from '../src/server/AgentV3/buildFindingSuggestions';

const DIR = join(__dirname, `.tmp-budget-phone-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let P: any;
beforeAll(async () => {
  for (const [p, c] of Object.entries(generateGameRuntime(['perf']).files)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), c); }
  P = await import(join(DIR, 'src/game/core/perf.ts'));
});
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

describe('📱 a budget phone starts lower', () => {
  it('knows a budget phone by its memory, and by its cores only when memory is not reported', () => {
    expect(P.budgetDevice({ deviceMemory: 2, hardwareConcurrency: 8 })).toBe(true);    // a typical cheap Android
    expect(P.budgetDevice({ deviceMemory: 3 })).toBe(true);
    expect(P.budgetDevice({ deviceMemory: 4, hardwareConcurrency: 8 })).toBe(false);
    expect(P.budgetDevice({ deviceMemory: 8, hardwareConcurrency: 2 })).toBe(false);   // memory wins when reported
    expect(P.budgetDevice({ hardwareConcurrency: 4 })).toBe(false);                    // an iPhone reports 4 and no memory
    expect(P.budgetDevice({ hardwareConcurrency: 2 })).toBe(true);
    expect(P.budgetDevice(null)).toBe(false);
    expect(P.budgetDevice({})).toBe(false);
  });

  it('the governor starts a level down, climbs back after a smooth run, and goes back down on reset', () => {
    const gov = P.createPerfGovernor({ startDrop: 1 });
    expect(gov.drop).toBe(1);
    expect(P.steppedQuality('high', gov.drop)).toBe('medium');
    for (let i = 0; i < 60 * 16; i++) gov.feed(1 / 60);   // 16 smooth seconds
    expect(gov.drop).toBe(0);
    gov.reset();
    expect(gov.drop).toBe(1);
    expect(P.createPerfGovernor({ startDrop: 9, maxDrop: 2 }).drop).toBe(2);
    expect(P.createPerfGovernor().drop).toBe(0);
  });

  it('the game shell starts the governor from the budget-phone check and reports its drawing load', () => {
    const game = generateGameShell().files['src/game/Game.ts'];
    expect(game).toMatch(/createPerfGovernor\(\{ startDrop: budgetDevice\(\) \? 1 : 0 \}\)/);
    expect(game).toMatch(/load: \(\) => \{ const i = this\.renderer\.info; return \{ calls: i\.render\.calls, triangles: i\.render\.triangles/);
  });
});

describe('📱 the playtest measures the drawing load', () => {
  const run = (load: PlaytestRun['load']): PlaytestRun => ({ ok: true, load } as PlaytestRun);

  it('flags a frame over the budget-phone limit, with the numbers; never an unmeasured game', () => {
    expect(tooHeavyForBudgetPhones(null)).toBeNull();
    expect(tooHeavyForBudgetPhones(undefined)).toBeNull();
    expect(tooHeavyForBudgetPhones({ calls: 180, triangles: 250_000, geometries: 40, textures: 12 })).toBeNull();
    expect(tooHeavyForBudgetPhones({ calls: BUDGET_PHONE.calls, triangles: BUDGET_PHONE.triangles, geometries: 1, textures: 1 })).toBeNull();
    const calls = tooHeavyForBudgetPhones({ calls: 850, triangles: 300_000, geometries: 400, textures: 30 })!;
    expect(calls).toMatch(/850 draw calls/);
    expect(calls).not.toMatch(/triangles/);
    const tris = tooHeavyForBudgetPhones({ calls: 100, triangles: 2_400_000, geometries: 50, textures: 10 })!;
    expect(tris).toMatch(/2400k triangles/);
    expect(playtestDefects(run({ calls: 900, triangles: 100, geometries: 1, textures: 1 }), null).map((d) => d.code)).toContain('GAME_DEFECT_TOO_HEAVY');
    expect(playtestDefects(run(null), null).map((d) => d.code)).not.toContain('GAME_DEFECT_TOO_HEAVY');
  });

  it('the browser probe reads the load from the kit game after a round of play', () => {
    expect(gamePlaytestScript('http://localhost:5173')).toMatch(/out\.load = await page\.evaluate\(\(\) => \(window\.__nbKit && window\.__nbKit\.load \? window\.__nbKit\.load\(\) : null\)\)/);
  });

  it('a heavy game gets a one-tap fix with what was measured, and the route records it as a real finding', () => {
    const [offer] = buildFindingSuggestions([{ code: 'GAME_TOO_HEAVY', severity: 'warning', message: 'Too heavy for budget phones: 850 draw calls a frame.' }]);
    expect(offer.title).toBe('Make it smooth on budget phones');
    expect(offer.prompt).toMatch(/InstancedMesh/);
    expect(offer.prompt).toMatch(/850 draw calls/);
    const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toMatch(/code: 'GAME_TOO_HEAVY', message: `Too heavy for budget phones: \$\{heavy\.evidence\}\.`, autoResolved: false/);
  });
});
