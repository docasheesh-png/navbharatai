// A PLANE FLIES LIKE A PLANE (admin 2026-11-19 game-gap audit, P2 aircraft). These run the REAL generated
// three/flight.ts: no take-off below take-off speed, a climb out with the nose up, a stall that drops the nose and
// sinks, banking right turns right (as seen from behind), the wings level themselves, and a gentle landing rolls out
// while a steep or banked one is a crash.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateGame3D, GAME_3D_MODULES } from '../src/server/lib/Game3DGenerator';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';

const DIR = join(__dirname, `.tmp-flight-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let F: any;

beforeAll(async () => {
  for (const r of [generateGameRuntime(), generateGame3D()]) for (const [p, c] of Object.entries(r.files)) { const f = join(DIR, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
  F = await import(join(DIR, 'src/game/three/flight.ts'));
}, 60_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const DT = 1 / 60;
function fly(plane: any, s: any, input: any, seconds: number, opts: any = {}) { for (let i = 0; i < Math.round(seconds / DT) && !s.crashed; i++) s = F.flyAircraft(plane, s, input, DT, opts); return s; }
/** Take off and climb to a safe height with full throttle. */
function airborne() {
  const plane = F.createAircraft({ kind: 'jet' });
  let s = F.createFlightState();
  s = fly(plane, s, { pitch: 0, roll: 0, throttle: 1 }, 8);
  s = fly(plane, s, { pitch: 1, roll: 0, throttle: 1 }, 2);
  s = fly(plane, s, { pitch: 0, roll: 0, throttle: 1 }, 6);
  return { plane, s };
}

describe('✈️ the flight model', () => {
  it('stays on the runway below take-off speed, even with the nose pulled up', () => {
    const plane = F.createAircraft();
    let s = F.createFlightState();
    s = fly(plane, s, { pitch: 1, roll: 0, throttle: 0.2 }, 6);
    expect(s.onGround).toBe(true);
    expect(s.speed).toBeLessThan(34);
    expect(plane.position.y).toBeCloseTo(1.2);
  });
  it('🔴 takes off above take-off speed with the nose up, and climbs', () => {
    const { plane, s } = airborne();
    expect(s.onGround).toBe(false);
    expect(s.crashed).toBe(false);
    expect(s.altitude).toBeGreaterThan(10);
    expect(plane.position.z).toBeGreaterThan(100);
  });
  it('🔴 a stall: with the throttle closed and the nose held up it slows, the nose drops and it sinks', () => {
    const { plane, s: start } = airborne();
    const h0 = plane.position.y;
    let s = fly(plane, start, { pitch: 1, roll: 0, throttle: 0 }, 12);
    expect(s.stalled || s.crashed || s.speed < 30).toBe(true);
    s = fly(plane, s, { pitch: 1, roll: 0, throttle: 0 }, 2);
    expect(s.sink).toBeLessThan(0);
    expect(plane.position.y).toBeLessThan(h0 + 200);
    expect(s.pitch).toBeLessThan(1);
  });
  it('banking right turns right — toward -X, the right as seen from behind — and the wings level when let go', () => {
    const { plane, s: start } = airborne();
    const x0 = plane.position.x;
    let s = fly(plane, start, { pitch: 0.1, roll: 1, throttle: 1 }, 1.5);
    expect(s.roll).toBeGreaterThan(0.5);
    s = fly(plane, s, { pitch: 0.1, roll: 0, throttle: 1 }, 4);
    expect(plane.position.x).toBeLessThan(x0 - 5);
    expect(Math.abs(s.roll)).toBeLessThan(0.1);
  });
  it('🔴 a steep dive into the ground is a crash; a gentle descent is a landing that rolls out', () => {
    const { plane, s: start } = airborne();
    const crashed = fly(plane, start, { pitch: -1, roll: 0, throttle: 1 }, 30);
    expect(crashed.crashed).toBe(true);
    expect(crashed.speed).toBe(0);
    // A low, level approach with the throttle back.
    const p2 = F.createAircraft();
    p2.position.set(0, 4, 0);
    let s = F.createFlightState({ onGround: false, speed: 40, throttle: 0.45, pitch: -0.02 });
    s = fly(p2, s, { pitch: 0, roll: 0, throttle: 0.45 }, 20);
    expect(s.crashed).toBe(false);
    expect(s.onGround).toBe(true);
  });
  it('follows the ground height; the mesh is a plane facing +Z with a propeller only on a prop plane', () => {
    const plane = F.createAircraft({ kind: 'prop' });
    let s = F.createFlightState();
    s = fly(plane, s, { pitch: 0, roll: 0, throttle: 0.3 }, 2, { ground: () => 50 });
    expect(plane.position.y).toBeCloseTo(51.2);
    expect(plane.getObjectByName('propeller')).toBeTruthy();
    expect(F.createAircraft({ kind: 'jet' }).getObjectByName('propeller')).toBeUndefined();
    expect(GAME_3D_MODULES).toContain('flight');
    const input = { axis: () => ({ x: 0.5, y: -1 }), isDown: (a: string) => a === 'sprint' };
    expect(F.flightInput(input, 0.5)).toEqual({ pitch: 1, roll: 0.5, throttle: 0.52 });
  });
});
