/**
 * GENRE KITS (admin 2026-11-26 game-maker audit): the kit had NO code for a fighting game or a tower-defense game, so every
 * such request was written from memory. These tests import the very files the recipe writes and play them frame by frame.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { makeTempDir } from './helpers/tempDir';
import { generateGenreKits, FIGHTING_PATH, TOWER_DEFENSE_PATH } from '../src/server/lib/GameGenreKitsGenerator';

/* eslint-disable @typescript-eslint/no-explicit-any */
let F: any; let T: any;
beforeAll(async () => {
  const dir = makeTempDir('nbai-genre-kits-');
  for (const [p, c] of Object.entries(generateGenreKits().files)) { const f = join(dir, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
  F = await import(join(dir, FIGHTING_PATH));
  T = await import(join(dir, TOWER_DEFENSE_PATH));
});

/** Two fighters a short step apart, the computer switched off. */
function close(gap = 0.9) {
  const m = F.createMatch({ ai: null });
  m.p1.x = -gap / 2; m.p2.x = gap / 2;
  return m;
}
/** Press `attack` once, then hold `p2` for `frames` frames; every event. */
function play(m: any, attack: string, p2: any = {}, frames = 40, p1Hold: any = {}) {
  const out: any[] = [];
  for (let i = 0; i < frames; i++) out.push(...F.stepMatch(m, { ...p1Hold, attack: i === 0 ? attack : null }, p2));
  return out;
}

describe('fighting: frames, blocks, combos, specials, rounds', () => {
  it('a jab cannot hit before its startup frames, then hits once and puts the defender in hit-stun', () => {
    const m = close();
    const first: any[] = [];
    for (let i = 0; i < F.DEFAULT_MOVES.jab.startup; i++) first.push(...F.stepMatch(m, { attack: i === 0 ? 'jab' : null }, {}));
    expect(first.filter((e) => e.type === 'hit')).toEqual([]);
    const rest = play(m, null as any, {}, 20);
    expect(rest.filter((e) => e.type === 'hit')).toEqual([{ type: 'hit', by: 'p1', move: 'jab', damage: 4, combo: 1 }]);
    expect(m.p2.hp).toBe(96);
  });

  it('a block takes chip damage and block-stun instead of the hit', () => {
    const m = close();
    const ev = play(m, 'punch', { block: true });
    expect(ev.find((e) => e.type === 'blocked')).toEqual({ type: 'blocked', by: 'p1', move: 'punch', chip: 1 });
    expect(ev.some((e) => e.type === 'hit')).toBe(false);
    expect(m.p2.hp).toBe(99);
  });

  it('a low must be blocked crouching; a high misses a crouching fighter', () => {
    const standing = close(1.2);
    expect(play(standing, 'sweep', { block: true }).some((e) => e.type === 'hit')).toBe(true);
    const crouched = close(1.2);
    expect(play(crouched, 'sweep', { block: true, down: true }).some((e) => e.type === 'blocked')).toBe(true);
    const ducking = close();
    const ev = play(ducking, 'jab', { down: true });
    expect(ev.some((e) => e.type === 'hit')).toBe(false);
    expect(ev.some((e) => e.type === 'whiff')).toBe(true);
  });

  it('a throw cannot be blocked, but only reaches up close', () => {
    expect(play(close(0.8), 'throw', { block: true }).some((e) => e.type === 'hit' && e.move === 'throw')).toBe(true);
    expect(play(close(1.5), 'throw', { block: true }).some((e) => e.type === 'hit')).toBe(false);
  });

  it('a jab that hits cancels into a punch: a two-hit combo with scaled damage', () => {
    const m = close();
    const ev: any[] = [];
    for (let i = 0; i < 40; i++) {
      const attack = i === 0 ? 'jab' : i === 7 ? 'punch' : null;
      ev.push(...F.stepMatch(m, { attack }, {}));
    }
    const hits = ev.filter((e) => e.type === 'hit');
    expect(hits.map((h) => [h.move, h.combo, h.damage])).toEqual([['jab', 1, 4], ['punch', 2, Math.round(8 * F.COMBO_SCALING)]]);
  });

  it('down, forward, attack is the special move (a motion, not a button)', () => {
    const m = F.createMatch({ ai: null });
    F.stepMatch(m, { down: true }, {});
    F.stepMatch(m, { down: true, right: true }, {});
    F.stepMatch(m, { right: true, attack: 'punch' }, {});
    expect(m.p1.move?.name).toBe('blast');
  });

  it('a KO wins the round, the next round resets health, two rounds win the match', () => {
    const m = close();
    m.p2.hp = 3;
    const ev = play(m, 'jab', {}, 20);
    expect(ev.find((e) => e.type === 'ko')).toEqual({ type: 'ko', loser: 'p2' });
    expect(ev.find((e) => e.type === 'round')).toEqual({ type: 'round', winner: 'p1', round: 1 });
    for (let i = 0; i < 100; i++) F.stepMatch(m, {}, {});
    expect(m.round).toBe(2);
    expect(m.p2.hp).toBe(100);
    m.p1.x = -0.45; m.p2.x = 0.45; m.p2.hp = 3;
    const end = play(m, 'jab', {}, 20);
    expect(end.find((e) => e.type === 'match')).toEqual({ type: 'match', winner: 'p1' });
    expect(m.over).toBe(true);
  });

  it('when the clock runs out, the fighter with more health left wins', () => {
    const m = close(3);
    m.p2.hp = 40; m.clock = 1;
    const ev = F.stepMatch(m, {}, {});
    expect(ev.find((e: any) => e.type === 'timeout')).toEqual({ type: 'timeout', winner: 'p1' });
  });

  it('the computer blocks far more often when harder, and the same seed plays the same fight', () => {
    const blocks = (level: string, seed: number) => {
      const m = F.createMatch({ ai: level, seed });
      let n = 0;
      for (let i = 0; i < 1200; i++) {
        m.p1.x = -0.45; m.p2.x = 0.45; m.p1.hp = m.p2.hp = 100;
        n += F.stepMatch(m, { attack: i % 30 === 0 ? 'punch' : null }).filter((e: any) => e.type === 'blocked').length;
      }
      return n;
    };
    expect(blocks('hard', 7)).toBeGreaterThan(blocks('easy', 7) * 1.5);
    expect(blocks('normal', 3)).toBe(blocks('normal', 3));
  });
});

const MAP = [
  'S...####',
  '###.####',
  '###.....',
  '#######E',
];

describe('tower defense: path, placement, waves, armour, money, lives', () => {
  it('finds the path from the map, and refuses a map without one', () => {
    expect(T.findPath(MAP)).toHaveLength(11);
    expect(T.findPath(MAP)[0]).toEqual({ x: 0, y: 0 });
    expect(T.findPath(MAP).at(-1)).toEqual({ x: 7, y: 3 });
    expect(() => T.createTowerDefense({ map: ['S##', '##E'] })).toThrow(/joined by/);
  });

  it('a tower stands only on a free build tile it can pay for; selling refunds 70%', () => {
    const td = T.createTowerDefense({ map: MAP, money: 100 });
    expect(T.placementProblem(td, 'arrow', 1, 0)).toMatch(/never on the path/);
    expect(T.placeTower(td, 'arrow', 4, 0)).toBeTruthy();
    expect(td.money).toBe(50);
    expect(T.placementProblem(td, 'arrow', 4, 0)).toMatch(/already stands/);
    expect(T.placementProblem(td, 'cannon', 5, 0)).toMatch(/Not enough money/);
    expect(T.sellTower(td, td.towers[0].id)).toBe(35);
    expect(td.money).toBe(85);
  });

  it('an undefended wave leaks and costs lives; a defended one is killed for money', () => {
    const open = T.createTowerDefense({ map: MAP, lives: 20 });
    T.startWave(open);
    // Wave 1 only (the next starts by itself after the break): its 6 grunts all reach the base.
    for (let i = 0; i < 60 * 30 && open.waveActive; i++) T.stepTowerDefense(open, 1 / 60);
    expect(open.lives).toBe(20 - (4 + 2));
    const held = T.createTowerDefense({ map: MAP, money: 1000 });
    for (const [x, y] of [[4, 1], [2, 1], [4, 3], [2, 3]]) T.placeTower(held, 'arrow', x, y);
    T.startWave(held);
    const ev: any[] = [];
    for (let i = 0; i < 60 * 30 && !ev.some((e) => e.type === 'wave-cleared'); i++) ev.push(...T.stepTowerDefense(held, 1 / 60));
    expect(ev.filter((e) => e.type === 'killed')).toHaveLength(6);
    expect(held.lives).toBe(20);
    expect(ev.some((e) => e.type === 'wave-cleared')).toBe(true);
  });

  it('armour takes a flat amount off each hit; flyers are out of a cannon\'s reach', () => {
    const td = T.createTowerDefense({ map: MAP, money: 1000, plans: () => ({ groups: [{ kind: 'tank', count: 1, every: 1 }], hpScale: 1 }) });
    T.placeTower(td, 'arrow', 4, 1);
    T.startWave(td);
    let shot: any;
    for (let i = 0; i < 600 && !shot; i++) shot = T.stepTowerDefense(td, 1 / 60).find((e: any) => e.type === 'shot');
    expect(td.enemies[0].maxHp - td.enemies[0].hp).toBe(9 - 6);
    const air = T.createTowerDefense({ map: MAP, money: 1000, plans: () => ({ groups: [{ kind: 'flyer', count: 1, every: 1 }], hpScale: 1 }) });
    T.placeTower(air, 'cannon', 4, 1);
    T.startWave(air);
    const ev: any[] = [];
    for (let i = 0; i < 60 * 20; i++) ev.push(...T.stepTowerDefense(air, 1 / 60));
    expect(ev.some((e) => e.type === 'shot')).toBe(false);
  });

  it('sending a wave early pays a bonus; surviving every wave wins', () => {
    const td = T.createTowerDefense({ map: MAP, money: 2000, waves: 2, plans: () => ({ groups: [{ kind: 'runner', count: 1, every: 1 }], hpScale: 1 }) });
    for (const [x, y] of [[4, 1], [2, 1]]) T.placeTower(td, 'sniper', x, y);
    T.startWave(td);
    const ev: any[] = [];
    for (let i = 0; i < 60 * 15 && !ev.some((e) => e.type === 'wave-cleared'); i++) ev.push(...T.stepTowerDefense(td, 1 / 60));
    const before = td.money;
    expect(T.startWave(td)).toBe(true);
    expect(td.money).toBe(before + T.EARLY_WAVE_BONUS);
    for (let i = 0; i < 60 * 15 && td.result === 'playing'; i++) ev.push(...T.stepTowerDefense(td, 1 / 60));
    expect(td.result).toBe('won');
  });
});

describe('the platform lays the genre kit down for its genre, and tells the builder', () => {
  it('a fighting request (any words) gets the fighter; a tower-defense request gets the defense; others get neither', async () => {
    const { gameKitPlan, gameKitRecipeInput, gameKitHandoffBlock } = await import('../src/server/AgentV3/gameKitSeed');
    const { buildGameContract } = await import('../src/server/AgentV3/gameIntent');
    for (const p of ['ek 3d fighting game banao', 'street fighter jaisa game banao', 'kushti wala game', 'ladai wala game banao', 'a boxing game with a computer opponent']) {
      expect(buildGameContract(p).genre, p).toBe('fighting');
      const plan = gameKitPlan(p, 'vite-react');
      expect(plan, p).toContain('generate_genre_kits');
      expect(gameKitRecipeInput('generate_genre_kits', plan, p), p).toEqual({ include: ['fighting'] });
    }
    for (const p of ['tower defense game banao', 'towers and waves game where enemies walk a path']) {
      const plan = gameKitPlan(p, 'vite-react');
      expect(plan, p).toContain('generate_genre_kits');
      expect(gameKitRecipeInput('generate_genre_kits', plan, p), p).toEqual({ include: ['towerDefense'] });
    }
    for (const p of ['ludo game banao', 'a 3D car racing game on a track', 'make a bgmi for me']) expect(gameKitPlan(p, 'vite-react'), p).not.toContain('generate_genre_kits');
    const block = gameKitHandoffBlock([{ recipe: 'generate_game_runtime', ok: true, content: '' }, { recipe: 'generate_genre_kits', ok: true, content: '' }] as never, { request: 'fighting game' });
    expect(block).toMatch(/THE GENRE'S RULES ARE ALREADY IN src\/game\/genres\//);
  });

  it('the design document names the module the builder must call', async () => {
    const { analyzeGameRequirements, gameDesignBlock } = await import('../src/server/AgentV3/gameDesignDocument');
    const doc = analyzeGameRequirements('tekken jaisa fighting game banao');
    expect(doc.genreKits).toEqual(['src/game/genres/fighting.ts']);
    expect(doc.engine).not.toBe('board');
    expect(gameDesignBlock(doc)).toContain("The genre's rules already exist in src/game/genres/fighting.ts");
  });
});
