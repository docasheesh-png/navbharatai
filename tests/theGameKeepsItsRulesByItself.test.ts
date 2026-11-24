/**
 * 🎮 THE GAME FACTORY KEEPS THE USER'S RULES BY ITSELF (admin 2026-11-24: "user kahta hai enemy add karo, jisko kill karne
 * se score bade, par navbharatai yeh nahi kar pata hai … hame game factory banna hai").
 *
 * Class: a rule the user named lived only as a sentence the builder had to remember to wire. Now the request becomes
 * DATA (src/game/gameRules.ts) that the kit's own engine (src/game/core/rules.ts) applies from the first round — the
 * game only emits the event. These tests run the real kit files, not a description of them.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { cleanGameRules, gameRulesFileText, generateGameRuntime, GAME_RULES_FILE, GAME_RUNTIME_MODULES } from '../src/server/lib/GameRuntimeGenerator';
import { gameRuleData, gameRulesFrom, RULE_DATA } from '../src/server/AgentV3/gameRules';
import { gameKitPlan, gameKitRecipeInput } from '../src/server/AgentV3/gameKitSeed';

const REQUEST = 'Make a space shooter. Enemies come from the top. When I kill an enemy the score should go up. When my health runs out it is game over.';
const DIR = join(tmpdir(), `nb-rules-${process.pid}-${Date.now()}`);
let STATE: any; let EV: any; let RULES: any;

beforeAll(async () => {
  const rules = gameRuleData(gameRulesFrom(REQUEST));
  const r = generateGameRuntime(undefined, { rules });
  for (const [p, c] of Object.entries(r.files)) { const f = join(DIR, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
  EV = await import(join(DIR, 'src/game/core/events.ts'));
  STATE = await import(join(DIR, 'src/game/core/state.ts'));
  RULES = await import(join(DIR, 'src/game/core/rules.ts'));
});
afterAll(() => { rmSync(DIR, { recursive: true, force: true }); });

describe('the request becomes rules as data', () => {
  it('🔴 the admin\'s case: "kill an enemy, the score goes up" is a data rule the runtime recipe receives', () => {
    const plan = gameKitPlan(REQUEST) as any[];
    const input = gameKitRecipeInput('generate_game_runtime', plan, REQUEST) as { rules?: unknown[] } | undefined;
    expect(input?.rules).toEqual([
      { when: 'ENEMY_DIED', then: { addScore: 10 } },
      { when: 'PLAYER_DIED', then: { gameOver: true } },
    ]);
  });
  it('a request with no rule gives the runtime no rules input (today\'s behaviour)', () => {
    expect(gameKitRecipeInput('generate_game_runtime', ['generate_game_runtime'], 'make a snake game')).toBeUndefined();
  });
  it('the runtime writes src/game/gameRules.ts only when there are rules, and rules.ts always travels with state.ts', () => {
    expect(Object.keys(generateGameRuntime().files)).not.toContain(GAME_RULES_FILE);
    const withRules = generateGameRuntime(['state'], { rules: [{ when: 'ENEMY_DIED', then: { addScore: 10 } }] }).files;
    expect(Object.keys(withRules)).toEqual(expect.arrayContaining(['src/game/core/state.ts', 'src/game/core/rules.ts', 'src/game/core/events.ts', GAME_RULES_FILE]));
    expect(withRules[GAME_RULES_FILE]).toContain('{"when":"ENEMY_DIED","then":{"addScore":10}}');
    expect(GAME_RUNTIME_MODULES).toContain('rules');
  });
  it('census: every data rule is one the engine accepts', () => {
    for (const d of Object.values(RULE_DATA)) expect(cleanGameRules([d])).toEqual([d]);
  });
  it('model-supplied rules are cleaned, never guessed', () => {
    expect(cleanGameRules([{ when: 'DELETE_EVERYTHING', then: { addScore: 5 } }, { when: 'ENEMY_DIED', then: { addScore: -3 } }, 'x', null])).toEqual([]);
    expect(cleanGameRules('nope')).toEqual([]);
    expect(gameRulesFileText([{ when: 'ITEM_COLLECTED', then: { addScore: 5 } }])).toMatch(/export const RULES: GameRule\[\] = \[/);
  });
});

describe('the kit applies them in play', () => {
  it('🔴 the rules file is read and started by the first round: an ENEMY_DIED raises the score once', async () => {
    STATE.setStatus('playing');
    // the dynamic import in setStatus resolves on the next ticks
    for (let i = 0; i < 20 && RULES.gameRulesFromProject().length === 0; i++) await new Promise((r) => setTimeout(r, 5));
    await new Promise((r) => setTimeout(r, 20));
    const before = STATE.state.score;
    EV.events.emit('ENEMY_DIED', {});
    expect(STATE.state.score).toBe(before + 10);
  });
  it('a life lost with lives left does not end the round; the last one does', () => {
    STATE.state.lives = 2; STATE.state.health = 1;
    STATE.damagePlayer(1);
    expect(STATE.state.status).toBe('playing');
    STATE.state.health = 1;
    STATE.damagePlayer(1);
    expect(STATE.state.status).toBe('gameover');
  });
  it('a rule does nothing outside a round, and stopping removes it', () => {
    const before = STATE.state.score;
    EV.events.emit('ENEMY_DIED', {});
    expect(STATE.state.score).toBe(before);
    STATE.setStatus('playing');
    const stop = RULES.startRules([{ when: 'ITEM_COLLECTED', then: { addScore: 5 } }]);
    EV.events.emit('ITEM_COLLECTED', {});
    expect(STATE.state.score).toBe(before + 5);
    stop();
    EV.events.emit('ITEM_COLLECTED', {});
    expect(STATE.state.score).toBe(before + 5);
  });
  it('score-level-up moves the level every 100 points and says LEVEL_UP', () => {
    const seen: number[] = [];
    const off = EV.events.on('LEVEL_UP', (p: { level: number }) => seen.push(p.level));
    RULES.startRules([{ when: 'SCORE_CHANGED', then: { nextLevelEvery: 100 } }]);
    STATE.state.level = 1; STATE.state.score = 0;
    STATE.addScore(150);
    expect(STATE.state.level).toBe(2);
    expect(seen).toEqual([2]);
    off();
  });
});

describe('the builder is told not to count twice', () => {
  it('each data rule\'s build line names the rules file and forbids a second listener', () => {
    for (const r of gameRulesFrom('kill an enemy and the score goes up. collect coins to get more points. when health runs out it is game over. score points to level up to the next level')) {
      if (RULE_DATA[r.id]) expect(r.howToBuild, r.id).toMatch(/src\/game\/gameRules\.ts[^]*never add a second listener/);
    }
  });
});
