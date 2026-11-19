// GRENADES AND AIM ASSIST (admin 2026-11-19 game-gap audit, P2 shooter extras). These run the REAL generated
// systems/grenade.ts and systems/aimassist.ts: a throw arcs, bounces, rolls and goes off on its fuse; the blast falls off
// with distance and cover blocks it; aim assist leans toward a target near the crosshair without snapping, and never
// toward one outside the cone, out of range or behind a wall.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateGameSystems, GAME_SYSTEM_MODULES } from '../src/server/lib/GameSystemsGenerator';

const DIR = join(__dirname, `.tmp-grenade-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let G: any; let A: any;

beforeAll(async () => {
  for (const [p, c] of Object.entries(generateGameSystems().files)) { const f = join(DIR, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
  G = await import(join(DIR, 'src/game/systems/grenade.ts'));
  A = await import(join(DIR, 'src/game/systems/aimassist.ts'));
});
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

describe('💣 the throw', () => {
  it('arcs up and down, lands ahead in the throw direction, bounces, and rests on the ground when the fuse runs out', () => {
    const v = G.throwVelocity(0, 0.6, 12);
    expect(v.z).toBeGreaterThan(0); expect(v.y).toBeGreaterThan(0); expect(Math.abs(v.x)).toBeLessThan(1e-9);
    const f = G.simulateThrow({ origin: { x: 0, y: 1.5, z: 0 }, velocity: v, fuse: 4 });
    const peak = Math.max(...f.points.map((p: any) => p.y));
    expect(peak).toBeGreaterThan(2.5);
    expect(f.end.z).toBeGreaterThan(10);
    expect(f.end.y).toBeCloseTo(0.1, 2);
    expect(f.bounces).toBeGreaterThanOrEqual(1);
    expect(f.time).toBe(4);
    const last = f.points.slice(-10);
    expect(Math.hypot(last[9].x - last[0].x, last[9].z - last[0].z)).toBeLessThan(0.05);   // rolled to a stop
  });
  it('the same inputs give the same path (the aim arc IS the throw), and it follows the ground height', () => {
    const o = { origin: { x: 0, y: 1, z: 0 }, velocity: G.throwVelocity(1, 0.4, 10), fuse: 2 };
    expect(G.simulateThrow(o)).toEqual(G.simulateThrow(o));
    const hill = G.simulateThrow({ ...o, ground: () => 3, origin: { x: 0, y: 5, z: 0 } });
    expect(hill.end.y).toBeCloseTo(3.1, 2);
  });
});

describe('💥 the blast', () => {
  const targets = [{ id: 'near', position: { x: 1, y: 0, z: 0 } }, { id: 'mid', position: { x: 3, y: 0, z: 0 } }, { id: 'far', position: { x: 9, y: 0, z: 0 } }, { id: 'hidden', position: { x: 0, y: 0, z: 2 } }];
  it('🔴 falls off with distance, stops at the radius, and cover blocks it', () => {
    const hits = G.blastDamage({ x: 0, y: 0, z: 0 }, targets, { radius: 6, maxDamage: 100, blocked: (_a: any, b: any) => b.z > 1 });
    expect(hits.map((h: any) => h.id)).toEqual(['near', 'mid']);
    expect(hits[0].damage).toBe(83);
    expect(hits[1].damage).toBe(50);
    expect(hits[0].impulse.x).toBeGreaterThan(hits[1].impulse.x);
    expect(hits[0].impulse.y).toBeGreaterThan(0);
  });
  it('minDamage holds at the edge', () => {
    const [h] = G.blastDamage({ x: 0, y: 0, z: 0 }, [{ id: 'e', position: { x: 5.9, y: 0, z: 0 } }], { radius: 6, maxDamage: 100, minDamage: 20 });
    expect(h.damage).toBe(21);
  });
});

describe('🎯 aim assist', () => {
  const eye = { x: 0, y: 0, z: 0 };
  it('leans part of the way toward a target near the crosshair — never a snap', () => {
    const t = [{ id: 'e', position: { x: 0.5, y: 0, z: 10 } }];   // ~2.9° off
    const r = A.aimAssist({ origin: eye, dir: { x: 0, y: 0, z: 1 } }, t, { strength: 0.35 });
    expect(r.target).toBe('e');
    expect(r.dir.x).toBeGreaterThan(0);
    expect(r.dir.x).toBeLessThan(0.05 * 0.6);                     // turned less than the full way
    expect(Math.hypot(r.dir.x, r.dir.y, r.dir.z)).toBeCloseTo(1);
  });
  it('ignores targets outside the cone, out of range or behind a wall; picks the one nearest the crosshair', () => {
    const fwd = { origin: eye, dir: { x: 0, y: 0, z: 1 } };
    expect(A.aimAssist(fwd, [{ id: 'side', position: { x: 10, y: 0, z: 10 } }]).target).toBeNull();
    expect(A.aimAssist(fwd, [{ id: 'far', position: { x: 0, y: 0, z: 100 } }], { range: 60 }).target).toBeNull();
    expect(A.aimAssist(fwd, [{ id: 'wall', position: { x: 0.2, y: 0, z: 10 } }], { visible: () => false }).target).toBeNull();
    const two = [{ id: 'off', position: { x: 1, y: 0, z: 10 } }, { id: 'on', position: { x: 0.2, y: 0, z: 10 } }];
    expect(A.aimAssist(fwd, two).target).toBe('on');
    expect(A.aimAssist(fwd, two, { strength: 0 }).dir).toEqual({ x: 0, y: 0, z: 1 });
  });
  it('is part of the systems kit, and aim assist brings the grenade module it shares types with', () => {
    expect(GAME_SYSTEM_MODULES).toEqual(expect.arrayContaining(['grenade', 'aimassist']));
    expect(Object.keys(generateGameSystems(['aimassist']).files).sort()).toEqual(['src/game/systems/aimassist.ts', 'src/game/systems/grenade.ts']);
  });
});
