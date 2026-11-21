// CITY TRAFFIC OBEYS THE ROAD (admin 2026-11-20 engine plan, item 4: a living city). Runs the REAL generated
// three/citytraffic.ts on a REAL city.ts grid with the kit's own vehicles, and checks every frame of a two-minute drive:
// every vehicle on a street and in the LEFT lane, nobody past a stop line on red, nobody inside the gap to the one
// ahead, nobody stuck, turns at crossings, and a stop for the player.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { generateGame3D, GAME_3D_MODULES } from '../src/server/lib/Game3DGenerator';

const DIR = join(__dirname, `.tmp-city-traffic-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let C: any; let T: any; let O: any;
beforeAll(async () => {
  for (const [p, c] of Object.entries(generateGame3D(['citytraffic']).files)) {
    mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), c);
  }
  C = await import(join(DIR, 'src/game/three/city.ts'));
  T = await import(join(DIR, 'src/game/three/citytraffic.ts'));
  O = await import(join(DIR, 'src/game/three/objects.ts'));
});
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

function setup(options: object = {}) {
  const city = C.createCity({ blocksX: 4, blocksZ: 4, seed: 3 });
  const scene = new THREE.Scene(); scene.add(city.root);
  const traffic = T.createCityTraffic(city, { count: 20, seed: 9, ...options });
  scene.add(traffic.root);
  return { city, scene, traffic, plan: city.plan };
}
const axisOf = (c: any): 'x' | 'z' => (c.from[0] !== c.to[0] ? 'x' : 'z');

describe('🚦 city traffic', () => {
  it('ships in the 3D kit and brings the city and the vehicles with it', () => {
    expect(GAME_3D_MODULES).toContain('citytraffic');
    const files = Object.keys(generateGame3D(['citytraffic']).files);
    expect(files).toEqual(expect.arrayContaining(['src/game/three/citytraffic.ts', 'src/game/three/city.ts', 'src/game/three/objects.ts', 'src/game/three/collision.ts', 'src/game/three/surfaces.ts']));
  });

  it('the lights give one street green at a time, with amber in between, and a full cycle', () => {
    let both = 0, amberSeen = 0;
    for (let t = 0; t < 40; t += 0.1) {
      const z = T.trafficLight(1, 2, 'z', t, 8), x = T.trafficLight(1, 2, 'x', t, 8);
      if (z === 'green' && x === 'green') both++;
      if (z !== 'red' && x !== 'red') both++;   // never green/amber both ways at once
      if (z === 'amber' || x === 'amber') amberSeen++;
    }
    expect(both).toBe(0);
    expect(amberSeen).toBeGreaterThan(0);
    // Neighbouring crossings are not in lock-step.
    const seq = (i: number) => Array.from({ length: 40 }, (_, k) => T.trafficLight(i, 0, 'z', k * 0.5, 8)).join();
    expect(seq(0)).not.toEqual(seq(1));
  });

  it('two minutes of driving: on the street, in the LEFT lane, never past a red stop line, never inside the gap, nobody stuck, turns made', () => {
    const { traffic, plan } = setup();
    const start = traffic.cars.map((c: any) => c.object.position.clone());
    const travelled = traffic.cars.map(() => 0);
    const axes = traffic.cars.map((c: any) => new Set([axisOf(c)]));
    let ranRed = 0, offStreet = 0, wrongLane = 0, tooClose = 0, sharedCrossing = 0;
    const dt = 1 / 30;
    for (let f = 0; f < 120 * 30; f++) {
      const before = traffic.cars.map((c: any) => ({ from: c.from.join(), to: c.to.join(), along: c.along, light: traffic.lightAt(c.to[0], c.to[1], axisOf(c)) }));
      const prev = traffic.cars.map((c: any) => c.object.position.clone());
      traffic.update(dt);
      traffic.cars.forEach((c: any, k: number) => {
        travelled[k] += c.object.position.distanceTo(prev[k]);
        axes[k].add(axisOf(c));
        const p = c.object.position;
        if (!C.onStreet(plan, p.x, p.z)) offStreet++;
        // Left lane: the street's centre line is to the vehicle's RIGHT, a quarter road away.
        const h = c.object.rotation.y, fx = Math.sin(h), fz = Math.cos(h);
        const sx = axisOf(c) === 'z' ? plan.streetsX[c.from[0]] : null;
        const sz = axisOf(c) === 'x' ? plan.streetsZ[c.from[1]] : null;
        const lateral = sx !== null ? (p.x - sx) * fz : -(p.z - (sz as number)) * fx;
        if (Math.abs(lateral - plan.road / 4) > 0.05 && Math.abs(lateral - plan.road / 4) > 0.05 * plan.road) wrongLane++;
        // Red light: a vehicle that was before its stop line on amber/red must not be past it now.
        const b = before[k];
        const len = T.edgeLength(plan, c.from, c.to);
        const stopAt = len - T.stopBack(plan) - c.length / 2;
        if (b.from === c.from.join() && b.to === c.to.join() && b.along <= stopAt + 0.01 && c.along > stopAt + 0.05 && b.light !== 'green') ranRed++;
      });
      // Never two vehicles inside one crossing (paths would cross).
      const inside = new Map<string, number>();
      for (const c of traffic.cars) {
        const p = c.object.position;
        const i = plan.streetsX.findIndex((x: number) => Math.abs(p.x - x) < plan.road / 2);
        const j = plan.streetsZ.findIndex((z: number) => Math.abs(p.z - z) < plan.road / 2);
        if (i >= 0 && j >= 0) inside.set(i + ',' + j, (inside.get(i + ',' + j) ?? 0) + 1);
      }
      for (const n of inside.values()) if (n > 1) sharedCrossing++;
      // The gap to the vehicle ahead in the same lane.
      for (const a of traffic.cars) for (const o of traffic.cars) {
        if (a === o || a.from.join() !== o.from.join() || a.to.join() !== o.to.join() || o.along <= a.along) continue;
        if (o.along - a.along < (a.length + o.length) / 2) tooClose++;
      }
    }
    expect({ offStreet, wrongLane, ranRed, tooClose, sharedCrossing }).toEqual({ offStreet: 0, wrongLane: 0, ranRed: 0, tooClose: 0, sharedCrossing: 0 });
    expect(offStreet).toBe(0);
    expect(wrongLane).toBe(0);
    expect(ranRed).toBe(0);
    expect(tooClose).toBe(0);
    for (let k = 0; k < travelled.length; k++) expect(travelled[k], `vehicle ${k} never moved`).toBeGreaterThan(80);
    expect(axes.filter((s: Set<string>) => s.size === 2).length).toBeGreaterThan(traffic.cars.length / 2);   // most turned
    expect(start.length).toBe(20);
  });

  it('rush hour: 45 vehicles and long reds back the queues up through crossings — still no overlap, no shared crossing, no gridlock', () => {
    const { traffic, plan } = setup({ count: 45, greenSeconds: 15, seed: 21 });
    const travelled = traffic.cars.map(() => 0);
    let tooClose = 0, sharedCrossing = 0, blockedBox = 0;
    for (let f = 0; f < 90 * 30; f++) {
      const prev = traffic.cars.map((c: any) => c.object.position.clone());
      traffic.update(1 / 30);
      traffic.cars.forEach((c: any, k: number) => { travelled[k] += c.object.position.distanceTo(prev[k]); });
      const inside = new Map<string, number>();
      for (const c of traffic.cars) {
        const p = c.object.position;
        const i = plan.streetsX.findIndex((x: number) => Math.abs(p.x - x) < plan.road / 2);
        const j = plan.streetsZ.findIndex((z: number) => Math.abs(p.z - z) < plan.road / 2);
        if (i >= 0 && j >= 0) inside.set(i + ',' + j, (inside.get(i + ',' + j) ?? 0) + 1);
        // Don't block the box: nobody stands still inside a crossing.
        if (i >= 0 && j >= 0 && c.speed < 0.05) blockedBox++;
      }
      for (const n of inside.values()) if (n > 1) sharedCrossing++;
      for (const a of traffic.cars) for (const o of traffic.cars) {
        if (a === o || a.from.join() !== o.from.join() || a.to.join() !== o.to.join() || o.along <= a.along) continue;
        if (o.along - a.along < (a.length + o.length) / 2 + 0.5) tooClose++;
      }
    }
    expect({ tooClose, sharedCrossing, blockedBox }).toEqual({ tooClose: 0, sharedCrossing: 0, blockedBox: 0 });
    expect(Math.min(...travelled)).toBeGreaterThan(20);   // nobody gridlocked for the whole rush hour
  });

  it('a queue that reaches back to a crossing does not block it: the next car waits at its stop line, not inside the crossing', () => {
    const { traffic, plan } = setup({ count: 30, seed: 5, lights: false });
    // The player stands just past crossing (1,1), in the left lane of the street to (2,1): a queue forms behind them.
    const at = T.trafficPose(plan, [1, 1], [2, 1], plan.road / 2 + 8);
    const player = new THREE.Object3D(); player.position.set(at.x, 0, at.z);
    let blockedBox = 0;
    for (let f = 0; f < 60 * 30; f++) {
      traffic.update(1 / 30, [player]);
      for (const c of traffic.cars) {
        const p = c.object.position;
        const insideX = Math.abs(p.x - plan.streetsX[1]) < plan.road / 2, insideZ = Math.abs(p.z - plan.streetsZ[1]) < plan.road / 2;
        if (insideX && insideZ && c.speed < 0.05) blockedBox++;
      }
    }
    expect(traffic.cars.some((c: any) => c.from.join() === '1,1' && c.to.join() === '2,1')).toBe(true);   // a queue did form
    expect(blockedBox).toBe(0);
  });

  it('a car waiting at a crossing waits BEHIND the zebra crossing, never on its stripes', () => {
    const { traffic, plan } = setup({ count: 25, seed: 13 });
    let onZebra = 0, waited = 0;
    for (let f = 0; f < 90 * 30; f++) {
      traffic.update(1 / 30);
      for (const c of traffic.cars) {
        if (c.speed > 0.05) continue;
        const len = T.edgeLength(plan, c.from, c.to);
        const front = c.along + c.length / 2;
        const toNode = len - front;                     // metres from the bumper to the crossing's centre ahead
        if (toNode > plan.road / 2 && toNode < plan.road / 2 + C.CITY_ZEBRA.gap + C.CITY_ZEBRA.depth) onZebra++;
        if (toNode < 20) waited++;
      }
    }
    expect(waited).toBeGreaterThan(0);   // cars did wait at lights
    expect(onZebra).toBe(0);
  });

  it('stops for the player standing in its lane, and drives on when the player steps away', () => {
    const { traffic, plan } = setup({ count: 1, lights: false });
    const car = traffic.cars[0];
    const p = T.trafficPose(plan, car.from, car.to, car.along + 9);
    const player = new THREE.Object3D(); player.position.set(p.x, 0, p.z);
    for (let f = 0; f < 120; f++) traffic.update(1 / 30, [player]);
    const gap = car.object.position.distanceTo(player.position);
    expect(gap).toBeGreaterThan(car.length / 2);
    expect(car.speed).toBeLessThan(0.2);
    player.position.set(1000, 0, 1000);
    for (let f = 0; f < 60; f++) traffic.update(1 / 30, [player]);
    expect(car.speed).toBeGreaterThan(2);
  });

  it('without lights every crossing is green; the same seed drives the same way', () => {
    const { traffic } = setup({ lights: false });
    expect(traffic.lightAt(1, 1, 'x')).toBe('green');
    expect(traffic.lightAt(1, 1, 'z')).toBe('green');
    const a = setup().traffic, b = setup().traffic;
    for (let f = 0; f < 300; f++) { a.update(1 / 30); b.update(1 / 30); }
    expect(a.cars.map((c: any) => c.object.position.toArray().map((v: number) => v.toFixed(4)))).toEqual(b.cars.map((c: any) => c.object.position.toArray().map((v: number) => v.toFixed(4))));
  });

  it('dispose takes the traffic away and never frees the player car\'s shared parts', () => {
    const { traffic, scene } = setup({ count: 4 });
    const player = O.createCar({ detail: 'lite' }); scene.add(player);
    let freed = 0;
    player.traverse((o: any) => { if (o.isMesh) o.geometry.addEventListener('dispose', () => { freed++; }); });
    traffic.dispose();
    expect(traffic.root.parent).toBeNull();
    expect(freed).toBe(0);
  });
});
