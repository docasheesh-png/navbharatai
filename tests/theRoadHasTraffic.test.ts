// THE ROAD HAS TRAFFIC (admin 2026-10-05 — the taxonomy's "Traffic AI", built on India's own vehicles).
//
// A driving or city game with an empty road reads as a stage set. createTraffic fills a road with cars,
// autos, buses, trucks and tractors that keep LEFT, cruise at their own kind's speed, keep a safe gap,
// stop for the player and loop round. The invariants a player would notice the instant they broke — two
// vehicles inside each other, traffic driving through the player — are what these tests hold, over a
// minute of simulated driving, with the generated module and real three.js.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';

const DIR = join(__dirname, `.tmp-game3d-traffic-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let O: any;
beforeAll(async () => {
  (globalThis as any).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }), putImageData: () => undefined }) }) };
  for (const [p, c] of Object.entries(generateGame3D().files)) { const f = join(DIR, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
  O = await import(join(DIR, 'src/game/three/objects.ts'));
});
afterAll(() => { rmSync(DIR, { recursive: true, force: true }); delete (globalThis as any).document; });

const ROAD = { length: 200, width: 9 };
const simulate = (t: any, seconds: number, avoid: THREE.Object3D[] = [], each?: () => void) => {
  for (let i = 0; i < Math.round(seconds * 30); i++) { t.update(1 / 30, avoid); each?.(); }
};
/** The smallest bumper-to-bumper gap in each lane right now (the lane loops). */
function minGap(t: any): number {
  let min = Infinity;
  for (const v of t.vehicles) for (const o of t.vehicles) {
    if (o === v || o.dir !== v.dir) continue;
    let ahead = o.object.position.z * o.dir - v.object.position.z * v.dir;
    if (ahead <= 0) ahead += ROAD.length;
    min = Math.min(min, ahead - (v.length + o.length) / 2);
  }
  return min;
}

describe('traffic keeps the rules a player would see broken', () => {
  it('over a minute of driving, no two vehicles are ever inside each other', () => {
    const t = O.createTraffic({ road: ROAD, count: 12, detail: 'lite', seed: 3 });
    let worst = Infinity;
    simulate(t, 60, [], () => { worst = Math.min(worst, minGap(t)); });
    expect(worst).toBeGreaterThan(0);
  });

  it('everyone keeps LEFT: heading +Z in the +X lane, heading −Z in the −X lane, and stays on the road', () => {
    const t = O.createTraffic({ road: ROAD, count: 10, detail: 'lite' });
    simulate(t, 20);
    for (const v of t.vehicles) {
      expect(Math.sign(v.object.position.x)).toBe(v.dir);
      expect(Math.abs(v.object.position.z)).toBeLessThanOrEqual(ROAD.length / 2 + 0.01);
      // Facing its direction of travel (models face +Z).
      expect(Math.cos(v.object.rotation.y)).toBeCloseTo(v.dir, 5);
    }
  });

  it('a car behind a tractor slows to the tractor\'s pace instead of driving through it', () => {
    const t = O.createTraffic({ road: ROAD, count: 2, kinds: ['tractor', 'car'], detail: 'lite', seed: 1 });
    // Put both in the same lane, the car 25 m behind the tractor.
    const [tractor, car] = t.vehicles;
    car.dir = 1; car.object.position.set(ROAD.width / 4, 0, -30); car.object.rotation.y = 0;
    tractor.object.position.set(ROAD.width / 4, 0, -5);
    simulate(t, 30);
    expect(car.speed).toBeLessThan(tractor.cruise * 1.15);
    expect(minGap(t)).toBeGreaterThan(0);
  });

  it('even a vehicle arriving too fast for its brakes never enters the one ahead (the hard backstop)', () => {
    const t = O.createTraffic({ road: ROAD, count: 2, kinds: ['tractor', 'car'], detail: 'lite' });
    const [tractor, car] = t.vehicles;
    car.dir = 1; car.object.rotation.y = 0;
    tractor.cruise = 0; tractor.speed = 0;
    tractor.object.position.set(ROAD.width / 4, 0, 0);
    // 0.8 m of room, at 13 m/s, with a long frame: braking alone would carry it 1.2 m — into the tractor.
    car.object.position.set(ROAD.width / 4, 0, -((car.length + tractor.length) / 2 + 0.8));
    car.speed = 13;
    t.update(0.1);
    expect(minGap(t)).toBeGreaterThan(0);
  });

  it('a player standing in the lane is never driven through — the vehicle stops behind them', () => {
    const t = O.createTraffic({ road: ROAD, count: 1, kinds: ['bus'], detail: 'lite' });
    const bus = t.vehicles[0];
    bus.object.position.z = -40;
    const player = new THREE.Object3D();
    player.position.set(ROAD.width / 4, 0, 0);
    simulate(t, 20, [player]);
    expect(bus.speed).toBeLessThan(0.5);
    expect(player.position.z - bus.object.position.z).toBeGreaterThan(bus.length / 2);
    // Once the player steps off the road, it drives on.
    player.position.x = 40;
    simulate(t, 5, [player]);
    expect(bus.speed).toBeGreaterThan(3);
  });

  it('the traffic keeps flowing round the loop, wheels turning; the same seed gives the same traffic', () => {
    const a = O.createTraffic({ road: ROAD, count: 6, detail: 'lite', seed: 9 });
    const b = O.createTraffic({ road: ROAD, count: 6, detail: 'lite', seed: 9 });
    const wheel = a.vehicles[0].object.children.find((c: any) => c.name === 'wheel');
    const r0 = wheel.rotation.x;
    simulate(a, 40); simulate(b, 40);
    expect(wheel.rotation.x).not.toBe(r0);
    expect(a.vehicles.map((v: any) => v.object.position.z.toFixed(4))).toEqual(b.vehicles.map((v: any) => v.object.position.z.toFixed(4)));
    expect(a.vehicles.every((v: any) => v.speed > 0.5)).toBe(true);
  });
});
