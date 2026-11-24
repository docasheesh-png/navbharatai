/**
 * 🎲 ANY RULE THE USER IMAGINES IS RUN BY THE KIT (admin 2026-11-24: "navbharatai api call se user ki sabhi ulti sidhi
 * imagination ko real banaye"; question 8: "gun fire se enemy mar jana chahiye / 5 shoot me marna chahiye"; question 7:
 * "enemy ko bleeding karwao").
 * Class: a combat rule lived only as words the builder had to remember. Now it is data — COMBAT in src/game/gameRules.ts or
 * a file under src/game/rules/ — read by the kit's own Health; and compose_rule turns any sentence into that data with one
 * model call. These run the REAL kit files.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateGameRuntime, GAME_RULES_FILE } from '../src/server/lib/GameRuntimeGenerator';
import { generateGameSystems } from '../src/server/lib/GameSystemsGenerator';
import { gameCombatFrom } from '../src/server/AgentV3/gameRules';
import { buildGameContract, gameContractBlock } from '../src/server/AgentV3/gameIntent';
import { gameKitPlan, gameKitRecipeInput } from '../src/server/AgentV3/gameKitSeed';
import { composeRule, rulePrompt } from '../src/server/AgentV3/gameAssets/composeRule';

/* eslint-disable @typescript-eslint/no-explicit-any */
const DIR = join(__dirname, `.tmp-any-rule-${process.pid}`);
let C: any; let EV: any;
beforeAll(async () => {
  const runtime = generateGameRuntime(undefined, { combat: { enemyHitsToKill: 5, bleed: { seconds: 2, perSecond: 30 } } });
  for (const r of [runtime, generateGameSystems(['combat'])]) {
    for (const [p, c] of Object.entries(r.files)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), c); }
  }
  // A rule compose_rule wrote on a later turn: the player dies on the 3rd hit.
  const made = await composeRule('player 3 hit me mare', async () => ({ text: '{"name":"player-fragile","combat":{"playerHitsToKill":3}}' }));
  if (made.kind !== 'made') throw new Error('compose');
  mkdirSync(dirname(join(DIR, made.path)), { recursive: true }); writeFileSync(join(DIR, made.path), made.source);
  EV = await import(join(DIR, 'src/game/core/events.ts'));
  C = await import(join(DIR, 'src/game/systems/combat.ts'));
});
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

describe('the kit runs the combat rules as data', () => {
  it('🔴 "5 shoot me marna chahiye": an enemy dies on its 5th hit, whatever the weapon\'s damage', () => {
    const hp = new C.Health({ max: 100, invulnerable: 0 });
    for (let i = 1; i <= 4; i++) { expect(hp.damage(1).died, `hit ${i}`).toBe(false); }
    expect(hp.damage(1).died).toBe(true);
    const big = new C.Health({ max: 100, invulnerable: 0 });
    expect(big.damage(9999).died).toBe(false); // a huge weapon still needs five hits
  });
  it('🔴 "enemy ko bleeding karwao": a hit enemy keeps losing health, shows blood, and can bleed to death', () => {
    const seen: string[] = [];
    const offA = EV.events.on('ENEMY_DAMAGED', (p: { bleeding?: boolean }) => { if (p.bleeding) seen.push('blood'); });
    const offB = EV.events.on('ENEMY_DIED', (p: { bled?: boolean }) => { if (p.bled) seen.push('bled-out'); });
    const hp = new C.Health({ max: 100, invulnerable: 0 });
    hp.damage(1); // 20 left after a 5-hits-to-kill hit... then 2 s × 30/s bleed
    expect(hp.current).toBe(80);
    for (let t = 0; t < 2.2; t += 0.05) hp.tick(0.05);
    expect(hp.current).toBeCloseTo(20, 0);
    expect(seen.filter((s) => s === 'blood').length).toBeGreaterThanOrEqual(3);
    const weak = new C.Health({ max: 100, invulnerable: 0 });
    for (let i = 0; i < 4; i++) weak.damage(1);       // 20 left, bleeding 2 s × 30 = 60 → dies of it
    for (let t = 0; t < 2.2; t += 0.05) weak.tick(0.05);
    expect(weak.isDead).toBe(true);
    expect(seen).toContain('bled-out');
    offA(); offB();
  });
  it('a rule file compose_rule wrote is read too: the player dies on the 3rd hit, and never bleeds', () => {
    const hp = new C.Health({ max: 100, invulnerable: 0, damagedEvent: 'PLAYER_DAMAGED', diedEvent: 'PLAYER_DIED' });
    hp.damage(1); hp.damage(1);
    expect(hp.isDead).toBe(false);
    expect(hp.bleeding).toBe(0);
    expect(hp.damage(1).died).toBe(true);
  });
  it('with no combat rules the old Health is untouched', () => {
    C.setCombatRules({});
    const hp = new C.Health({ max: 100, invulnerable: 0 });
    expect(hp.damage(30).remaining).toBe(70);
    C.setCombatRules(null);
  });
});

describe('the request becomes the data', () => {
  it('🔴 the admin\'s words: shots, goli, bleeding — English, Hinglish, Hindi', () => {
    expect(gameCombatFrom('enemy ko 5 goli me marna chahiye')).toEqual({ enemyHitsToKill: 5 });
    expect(gameCombatFrom('Enemies should die after five shots. Make the enemy bleed.')).toEqual({ enemyHitsToKill: 5, bleed: { seconds: 3, perSecond: 8 } });
    expect(gameCombatFrom('player 3 hit me mar jaye')).toEqual({ playerHitsToKill: 3 });
    expect(gameCombatFrom('दुश्मन को खून निकले')).toEqual({ bleed: { seconds: 3, perSecond: 8 } });
    expect(gameCombatFrom('a racing game with 5 laps')).toEqual({});
  });
  it('the seed hands the runtime the combat data, the contract says it, and the combat layer is laid down', () => {
    const req = 'Make a zombie shooter. Zombies should die after 3 shots and bleed.';
    const plan = gameKitPlan(req) as any[];
    expect(plan).toContain('generate_game_systems');
    expect(gameKitRecipeInput('generate_game_runtime', plan, req)).toMatchObject({ combat: { enemyHitsToKill: 3, bleed: { seconds: 3, perSecond: 8 } } });
    const block = gameContractBlock(buildGameContract(req));
    expect(block).toMatch(/an enemy dies on hit 3/);
    expect(block).toMatch(/call each Health's tick\(delta\) every step/);
    expect(block).toMatch(/compose_rule/);
    expect(generateGameRuntime(['state'], { combat: { enemyHitsToKill: 3 } }).files[GAME_RULES_FILE]).toContain('export const COMBAT = {"enemyHitsToKill":3};');
  });
});

describe('compose_rule: one model call, checked, refused honestly', () => {
  it('a sentence becomes a rule file the kit reads', async () => {
    let prompt = '';
    const made = await composeRule('har zombie marne par 3 point, boss 20 goli me mare', async (p) => { prompt = p; return { text: 'ok {"name":"zombie points","rules":[{"when":"ENEMY_DIED","then":{"addScore":3}}],"combat":{"enemyHitsToKill":20}}' }; });
    expect(prompt).toBe(rulePrompt('har zombie marne par 3 point, boss 20 goli me mare'));
    expect(made.kind).toBe('made');
    if (made.kind !== 'made') return;
    expect(made.path).toBe('src/game/rules/zombie-points.ts');
    expect(made.source).toContain("import type { GameRule } from '../core/rules';");
    expect(made.source).toContain('{"when":"ENEMY_DIED","then":{"addScore":3}}');
    expect(made.source).toContain('export const COMBAT = {"enemyHitsToKill":20};');
  });
  it('outside the vocabulary, a broken answer, or no answer: refused, nothing written', async () => {
    expect((await composeRule('gravity flips every 10 s', async () => ({ text: '{"name":"none"}' }))).kind).toBe('refused');
    expect((await composeRule('x', async () => ({ text: '{"rules":[{"when":"DELETE","then":{"addScore":5}}]}' }))).kind).toBe('refused');
    expect((await composeRule('x', async () => null)).kind).toBe('refused');
    const r = await composeRule('gravity flips', async () => ({ text: 'no' }));
    expect(r.kind === 'refused' && r.reason).toMatch(/Write this rule as code/);
  });
});
