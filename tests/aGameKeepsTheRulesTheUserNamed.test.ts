/**
 * Admin 2026-11-24 (question 2, DNA level): "user kahta hai enemy add karo, jisko kill karne se score bade, par navbharatai
 * yeh nahi kar pata … hame game factory banna hai."
 *
 * Two roots, both fixed: (1) the contract kept features (enemies, score) and dropped the RULE between them; (2) the kit's
 * combat layer (generate_game_systems) was never laid down by the platform, so a weak builder hand-wrote a fragile fight.
 * Now the rule is read, handed over with the kit's API, listed as unverified until play proves it, and a fighting game
 * gets the combat layer before the first model call. Fixtures are the user's own words and synthetic neighbours.
 */
import { describe, expect, it } from 'vitest';
import { gameRulesFrom, wantsCombatKit, gameRulesBlock } from '../src/server/AgentV3/gameRules';
import { buildGameContract, gameContractBlock, scopeMatch } from '../src/server/AgentV3/gameIntent';
import { gameKitPlan, gameKitRecipeInput } from '../src/server/AgentV3/gameKitSeed';

describe('🔴 the user\'s own sentence keeps its rule', () => {
  it('Hinglish: "enemy add karo, jisko kill karne se score bade"', () => {
    expect(gameRulesFrom('enemy add karo, jisko kill karne se score bade').map((r) => r.id)).toEqual(['enemy-dies-score-up']);
  });
  it('English: "killing zombies should increase the score; if a zombie touches you, you lose a life"', () => {
    const ids = gameRulesFrom('make a game where killing zombies should increase the score. If a zombie touches you, you lose a life.').map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(['enemy-dies-score-up', 'enemy-hit-health-down']));
  });
  it('the contract carries it, and the builder is told the kit API for it', () => {
    const c = buildGameContract('ek shooting game banao, dushman ko maarne par points milne chahiye');
    expect(c.rules?.map((r) => r.id)).toContain('enemy-dies-score-up');
    const block = gameContractBlock(c);
    expect(block).toMatch(/Rules the user named/);
    expect(block).toMatch(/ENEMY_DIED/);
    expect(block).toMatch(/addScore/);
  });
  it('a rule is never claimed by a code scan: it is listed as unverified', () => {
    const c = buildGameContract('a game where killing enemies increases the score');
    expect(scopeMatch(c, { 'src/Game.ts': 'export const enemies = []; export let score = 0;' }).unverified).toEqual(expect.arrayContaining(['rule: when an enemy is killed, the score goes up']));
  });
});

describe('neighbours: a feature alone is not a rule', () => {
  it('"a game with enemies and a score" has no rule (both named, no relation)', () => {
    expect(gameRulesFrom('make a game with enemies and a score')).toEqual([]);
  });
  it('a quiz with points is not a kill rule; a request without rules keeps its contract unchanged', () => {
    expect(gameRulesFrom('quiz game with points for each right answer').map((r) => r.id)).not.toContain('enemy-dies-score-up');
    expect(buildGameContract('make a snake game').rules).toBeUndefined();
  });
  it('the block is empty with no rules', () => {
    expect(gameRulesBlock([])).toBe('');
  });
});

describe('🔴 the combat layer is laid down when the game has a fight', () => {
  it('a 2D shooter gets generate_game_systems, without the spawner (it needs the 3D world)', () => {
    const plan = gameKitPlan('2d space shooter game with enemies');
    expect(plan).toContain('generate_game_systems');
    expect(plan.indexOf('generate_game_systems')).toBeGreaterThan(plan.indexOf('generate_game_runtime'));
    const input = gameKitRecipeInput('generate_game_systems', plan) as { include: string[] };
    expect(input.include).not.toContain('spawner');
    expect(input.include).toContain('combat');
  });
  it('a 3D fighting game gets the whole combat layer after the 3D layer', () => {
    const plan = gameKitPlan('3d fighting game with a boss');
    expect(plan).toContain('generate_game_systems');
    expect(plan.indexOf('generate_game_systems')).toBeGreaterThan(plan.indexOf('generate_game_3d'));
    expect(gameKitRecipeInput('generate_game_systems', plan)).toBeUndefined();
  });
  it('neighbours: a puzzle, a quiz or a race gets no combat layer', () => {
    for (const p of ['make a sudoku puzzle game', 'make a quiz game', 'make a car racing game']) {
      expect(gameKitPlan(p), p).not.toContain('generate_game_systems');
    }
    expect(wantsCombatKit('a calm farming game', 'unknown', [])).toBe(false);
  });
});
