// ENEMIES GO AROUND WALLS, NOT INTO THEM (admin 2026-11-19 game-gap audit, P1 #12: no pathfinding — an enemy steered
// straight at the player and pressed against the first wall in the way). These run the REAL generated systems/nav.ts and
// systems/ai.ts: A* finds a walkable way, never cuts a blocked corner, and an enemy given the level's walls reaches a
// player hiding behind one — without ever seeing or striking through it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { generateGameSystems } from '../src/server/lib/GameSystemsGenerator';

const DIR = join(__dirname, `.tmp-nav-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let NAV: any; let AI: any;

beforeAll(async () => {
  for (const r of [generateGameRuntime(), generateGameSystems()]) {
    for (const [p, c] of Object.entries(r.files)) { const f = join(DIR, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
  }
  NAV = await import(join(DIR, 'src/game/systems/nav.ts'));
  AI = await import(join(DIR, 'src/game/systems/ai.ts'));
});
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

// A wall across the middle (x from -8 to 8 at z = 0..1), open at both ends.
const WALL = [{ minX: -8, maxX: 8, minZ: 0, maxZ: 1 }];
const grid = () => NAV.createNavGrid({ minX: -20, minZ: -20, maxX: 20, maxZ: 20, cell: 0.5, blocked: NAV.blockedFromBoxes(WALL) });

describe('🧭 the nav grid and A*', () => {
  it('a path around the wall: it reaches the target and never enters a blocked cell, pulled tight to a few corners', () => {
    const g = grid();
    const path = NAV.findPath(g, { x: 0, z: -5 }, { x: 0, z: 6 });
    expect(path).not.toBeNull();
    expect(path.at(-1)).toEqual({ x: 0, z: 6 });
    expect(path.length).toBeLessThan(8);
    let from = { x: 0, z: -5 };
    for (const p of path) { expect(NAV.lineClear(g, from, p)).toBe(true); from = p; }
    expect(path.some((p: any) => Math.abs(p.x) >= 8)).toBe(true);          // it went round an end of the wall
  });
  it('a clear line is one step; an enclosed target has no path; a target inside a wall is reached from beside it', () => {
    const g = grid();
    expect(NAV.findPath(g, { x: -15, z: -15 }, { x: 15, z: -15 })).toEqual([{ x: 15, z: -15 }]);
    const box = NAV.createNavGrid({ minX: -10, minZ: -10, maxX: 10, maxZ: 10, cell: 0.5,
      blocked: NAV.blockedFromBoxes([{ minX: 2, maxX: 8, minZ: 2, maxZ: 2.6 }, { minX: 2, maxX: 8, minZ: 7.4, maxZ: 8 }, { minX: 2, maxX: 2.6, minZ: 2, maxZ: 8 }, { minX: 7.4, maxX: 8, minZ: 2, maxZ: 8 }]) });
    expect(NAV.findPath(box, { x: -5, z: -5 }, { x: 5, z: 5 })).toBeNull();
    expect(NAV.findPath(g, { x: 0, z: -5 }, { x: 0, z: 0.5 })).not.toBeNull();
  });
  it('a diagonal never squeezes between two blocked cells', () => {
    const g = NAV.createNavGrid({ minX: 0, minZ: 0, maxX: 4, maxZ: 4, cell: 1,
      blocked: (x: number, z: number) => (x > 2 && x < 3 && z > 1 && z < 2) || (x > 1 && x < 2 && z > 2 && z < 3) });
    // From cell (1,1) to (2,2): the two blocked cells touch only at a corner — the diagonal there is refused.
    const path = NAV.findPath(g, { x: 1.5, z: 1.5 }, { x: 2.5, z: 2.5 });
    expect(path === null || path.length > 1).toBe(true);
  });
  it('inflate keeps a body\'s radius clear of walls; an absurd grid is refused', () => {
    const g = NAV.createNavGrid({ minX: -20, minZ: -20, maxX: 20, maxZ: 20, cell: 0.5, blocked: NAV.blockedFromBoxes(WALL), inflate: 2 });
    expect(g.isBlocked(0, -0.75)).toBe(true);
    expect(grid().isBlocked(0, -0.75)).toBe(false);
    expect(() => NAV.createNavGrid({ minX: 0, minZ: 0, maxX: 10_000, maxZ: 10_000, cell: 1, blocked: () => false })).toThrow(/too large/);
  });
});

describe('🔴 an enemy given the walls hunts around them', () => {
  function run(nav: unknown, steps = 900) {
    let state = { mode: 'chase', position: { x: 0, z: -5 }, facing: 0, home: { x: 0, z: -5 }, patrolRadius: 0, timeInMode: 0 };
    const player = { x: 0, z: 6 };
    const g = grid();
    let enteredWall = false; let attackedThroughWall = false; let closest = Infinity;
    for (let i = 0; i < steps; i++) {
      const d = AI.stepEnemyAI(state, { player, neighbours: [], canSeePlayer: true, nav }, { ...AI.DEFAULT_ENEMY, loseRadius: 60, detectRadius: 40 }, 1 / 60);
      state = d.state;
      if (g.isBlocked(state.position.x, state.position.z)) enteredWall = true;
      if (state.mode === 'attack' && !NAV.lineClear(g, state.position, player)) attackedThroughWall = true;
      closest = Math.min(closest, Math.hypot(player.x - state.position.x, player.z - state.position.z));
    }
    return { enteredWall, attackedThroughWall, closest, state };
  }
  it('without the walls it walks straight into the wall (the old behaviour, still the default)', () => {
    const r = run(undefined, 600);
    expect(r.enteredWall).toBe(true);
  });
  it('with them it goes round, reaches the player, never enters the wall and never strikes through it', () => {
    const r = run(grid());
    expect(r.enteredWall).toBe(false);
    expect(r.attackedThroughWall).toBe(false);
    expect(r.closest).toBeLessThan(AI.DEFAULT_ENEMY.attackRadius + 0.5);
  });
});
