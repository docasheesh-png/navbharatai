/**
 * THE GAME-MAKER COVERAGE BENCHMARK (admin 2026-11-26: "sabhi prkar ke game bana sake"). Fifty games people ask for, read the
 * way a real first build reads them. This test is the scoreboard's lock: every game is read as a game, in the genre and with
 * the places the user named, and the number the builder has to improvise ("kit-only") may only ever go DOWN.
 */
import { describe, expect, it } from 'vitest';
import { CANONICAL_GAMES, MAX_KIT_ONLY, coverageBoard, coverageSummary, effectiveClass } from '../src/server/AgentV3/gameCoverage';

const board = coverageBoard();

describe('the coverage benchmark', () => {
  it('holds at least fifty distinct games, each with a reason when it is a known defect', () => {
    expect(CANONICAL_GAMES.length).toBeGreaterThanOrEqual(50);
    expect(new Set(CANONICAL_GAMES.map((g) => g.id)).size).toBe(CANONICAL_GAMES.length);
    for (const g of CANONICAL_GAMES) if (g.note) expect(g.note, g.id).toMatch(/Q-\d+/);
    for (const g of CANONICAL_GAMES) if (g.starterFits === false) expect(g.note, `${g.id}: a starter that does not fit must say why`).toBeTruthy();
  });

  it('every one is read as a game — none falls out of the game path', () => {
    expect(board.filter((r) => r.coverage === 'not-a-game').map((r) => r.id)).toEqual([]);
  });

  for (const [i, g] of CANONICAL_GAMES.entries()) {
    it(`${g.id}: genre ${g.genre}, ${effectiveClass(g, g.coverage)}${g.places ? `, places ${g.places.join(' + ')}` : ''}`, () => {
      const r = board[i];
      expect(r.genre).toBe(g.genre);
      if (g.places) expect(r.places).toEqual(g.places);
      // A better class is welcome — and is recorded here on purpose, so the scoreboard never drifts from the truth.
      expect(r.coverage).toBe(effectiveClass(g, g.coverage));
    });
  }

  it('RATCHET: the games the builder must improvise may only go down', () => {
    const kitOnly = board.filter((r) => r.coverage === 'kit-only').length;
    expect(kitOnly).toBeLessThanOrEqual(MAX_KIT_ONLY);
    // Lower MAX_KIT_ONLY when a game moves up; never raise it.
    expect(MAX_KIT_ONLY).toBeLessThanOrEqual(28);
  });

  it('the summary says the honest numbers', () => {
    const s = coverageSummary(board);
    expect(s).toMatch(/^Game-maker coverage: \d+ of 50 canonical games/);
    expect(s).toMatch(/Builder improvises: .*sandbox/);
  });
});
