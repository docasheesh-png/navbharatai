/**
 * Locked plan item 2 (admin 2026-11-24; weakness audit P0-2): the game playtest's time is reserved, not left over.
 *
 * The playtest needed 90 s of headroom, and every pass before it could spend that time first, so the builds that ran
 * late, the ones with problems, were the ones whose game was never played. The route asked "is there time?" in ~30
 * places, each in its own words. Now every one asks `roomFor` (buildPhases/buildHeadroom.ts), which on a game turn
 * holds back the playtest's time until it has run, and generation is handed that much less. Non-game turns: no change.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLAYTEST_RESERVE_MS, playtestReserveMs, hasHeadroom, headroomMs } from '../src/server/AgentV3/buildPhases/buildHeadroom';
import { generationBudgetMs } from '../src/server/AgentV3/correctionReserve';
import { PLAYTEST_BUDGET_MS } from '../src/server/AgentV3/gamePlaytest';

const ROUTE = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
const CAP = 25 * 60_000;

describe('the reserve', () => {
  it('covers the playtest budget, its page load and the route timeout margin', () => {
    expect(PLAYTEST_RESERVE_MS).toBeGreaterThanOrEqual(PLAYTEST_BUDGET_MS + 15_000 + 20_000);
  });
  it('is held only on a game turn, only until the playtest ran, and never with the kill switch', () => {
    expect(playtestReserveMs({ gameTurn: true, playtestDone: false }, {})).toBe(PLAYTEST_RESERVE_MS);
    expect(playtestReserveMs({ gameTurn: true, playtestDone: true }, {})).toBe(0);
    expect(playtestReserveMs({ gameTurn: false, playtestDone: false }, {})).toBe(0);
    expect(playtestReserveMs({ gameTurn: true, playtestDone: false }, { AGENTV3_GAME_PLAYTEST_RESERVE: 'off' })).toBe(0);
  });
});

describe('🔴 the report shape: a game build running late still has the playtest\'s time', () => {
  // 21.5 min worked of 25: the old arithmetic let a 120 s pass run (3.5 min left), which ate the playtest's 90 s.
  const elapsed = CAP - 210_000;
  it('a pass before the playtest is told there is no room when it would eat the playtest\'s time', () => {
    const held = playtestReserveMs({ gameTurn: true, playtestDone: false }, {});
    expect(hasHeadroom({ capMs: CAP, elapsedMs: elapsed, needMs: 120_000 })).toBe(true); // the old answer
    expect(hasHeadroom({ capMs: CAP, elapsedMs: elapsed, needMs: 120_000, heldMs: held })).toBe(false);
  });
  it('the playtest itself then has its 90 s', () => {
    const heldAfter = playtestReserveMs({ gameTurn: true, playtestDone: true }, {});
    expect(hasHeadroom({ capMs: CAP, elapsedMs: elapsed, needMs: 90_000, heldMs: heldAfter })).toBe(true);
  });
  it('generation is handed the playtest\'s time less on a game turn, and the same as before otherwise', () => {
    expect(generationBudgetMs(CAP, 0, PLAYTEST_RESERVE_MS)).toBe(generationBudgetMs(CAP, 0) - PLAYTEST_RESERVE_MS);
    expect(generationBudgetMs(CAP, 0, 0)).toBe(generationBudgetMs(CAP, 0));
  });
});

describe('neighbours', () => {
  it('no watchdog (cap 0) means every pass fits, held or not', () => {
    expect(hasHeadroom({ capMs: 0, elapsedMs: 10 ** 9, needMs: 120_000, heldMs: PLAYTEST_RESERVE_MS })).toBe(true);
    expect(headroomMs({ capMs: 0, elapsedMs: 5 })).toBe(Number.POSITIVE_INFINITY);
    expect(generationBudgetMs(0, 0, PLAYTEST_RESERVE_MS)).toBe(0);
  });
  it('a non-game turn gets the old arithmetic exactly', () => {
    for (const elapsed of [0, 60_000, CAP - 121_000, CAP - 119_000, CAP]) {
      expect(hasHeadroom({ capMs: CAP, elapsedMs: elapsed, needMs: 120_000, heldMs: 0 })).toBe(elapsed < CAP - 120_000);
    }
  });
});

describe('🔒 census: the route asks one question', () => {
  it('no hand-written headroom arithmetic is left in the route', () => {
    expect(ROUTE).not.toMatch(/workElapsed\(\)\)? [<>] \(?effectiveBuildSeconds \* 1000 -/);
    expect(ROUTE).not.toMatch(/effectiveBuildSeconds === 0 \? (?:Number\.POSITIVE_INFINITY|Infinity) : \(?effectiveBuildSeconds \* 1000 - \(workElapsed\(\)\)/);
  });
  it('every generation budget holds the playtest reserve, and the playtest releases it when it starts', () => {
    expect(ROUTE).not.toMatch(/generationBudgetMs\(effectiveBuildSeconds \* 1000, workElapsed\(\)\)/);
    expect(ROUTE).toMatch(/gamePlaytestDone = true;\n\s+playtestHold\.playtestDone = true;/);
    expect(ROUTE).toMatch(/playtestHold\.buildOk = result\?\.ok === true;/);
  });
});
