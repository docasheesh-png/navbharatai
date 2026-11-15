// ATHREE MAP phase 5b — VEHICLES: a sports car and a sports bike. These tests run the emitted code: the shapes (size, symmetry, outward
// normals, triangle bounds), the driving physics on synthetic ground (acceleration, top speed, braking per surface, steering, the grip
// limit, a handbrake slide, hills, cross slopes, a jump, water, frame-rate independence, a bike leaning into a turn), the vehicle driven
// round the real race circuit and across a real bridge, and the vehicle on screen with real three.js.
// What they cannot prove — how it LOOKS and whether the materials look right on a GPU — is checked by a headless-Chromium render.
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { loadAthree } from '../../../../tests/helpers/loadAthree';

// These tests simulate seconds of driving at 120 steps a second and sample whole worlds; under the coverage run they are several times
// slower, so each gets two minutes instead of vitest's default twenty seconds: the assertions are not loosened, only the clock.
vi.setConfig({ testTimeout: 120000 });

const A = loadAthree();
const TIERS = ['phone', 'mid', 'desktop'] as const;
const flat = (surface = 'asphalt', ground: (x: number, z: number) => number = () => 0) => ({ groundAt: ground, surfaceAt: () => surface });
const NO = A.NO_INPUT;

function bbox(a: any): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity]; const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < a.position.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], a.position[i + k]); max[k] = Math.max(max[k], a.position[i + k]); }
  return { min, max };
}

describe('the car and the bike as shapes', () => {
  it('a car is a sports car: 4.3 to 4.7 m long, 1.8 to 2.1 m wide, 1.15 to 1.35 m tall, tyres on the ground with a 0.34 m radius', () => {
    const car = A.buildCar(A.VEHICLE_TIERS.desktop);
    const body = bbox(car.body); const tyre = bbox(car.tyre);
    expect(body.max[0] - body.min[0]).toBeGreaterThan(4.3); expect(body.max[0] - body.min[0]).toBeLessThan(4.7);
    const width = Math.max(body.max[2], tyre.max[2]) - Math.min(body.min[2], tyre.min[2]);
    expect(width).toBeGreaterThan(1.8); expect(width).toBeLessThan(2.1);
    expect(Math.max(body.max[1], bbox(car.glass).max[1])).toBeGreaterThan(1.15); expect(Math.max(body.max[1], bbox(car.glass).max[1])).toBeLessThan(1.35);
    expect(tyre.min[1]).toBeCloseTo(0, 6);
    expect(tyre.max[1]).toBeCloseTo(0.68, 2);
    expect(body.min[1]).toBeGreaterThan(0.15);
  });
  it('a bike is about 2 m long, under 0.8 m wide, with 0.33 m wheels on the ground', () => {
    const bike = A.buildBike(A.VEHICLE_TIERS.desktop);
    const all = bbox(bike.body); const tyre = bbox(bike.tyre);
    expect(Math.max(all.max[0], tyre.max[0]) - Math.min(all.min[0], tyre.min[0])).toBeGreaterThan(1.9);
    expect(Math.max(all.max[0], tyre.max[0]) - Math.min(all.min[0], tyre.min[0])).toBeLessThan(2.4);
    expect(Math.max(all.max[2], tyre.max[2]) - Math.min(all.min[2], tyre.min[2])).toBeLessThan(0.8);
    expect(tyre.min[1]).toBeCloseTo(0, 6); expect(tyre.max[1]).toBeCloseTo(0.66, 2);
  });
  it('the car is left-right symmetric', () => {
    const car = A.buildCar(A.VEHICLE_TIERS.mid);
    for (const part of [car.body, car.tyre, car.lights]) {
      let sum = 0; for (let i = 2; i < part.position.length; i += 3) sum += part.position[i];
      expect(Math.abs(sum / (part.position.length / 3))).toBeLessThan(0.02);
    }
  });
  it('every vehicle fits its triangle bound, and detail rises from phone to desktop', () => {
    const counts: Record<string, number[]> = { car: [], bike: [] };
    for (const q of TIERS) {
      const tier = A.VEHICLE_TIERS[q];
      for (const [kind, parts] of [['car', A.buildCar(tier)], ['bike', A.buildBike(tier)]] as const) {
        const n = A.vehicleTriangles(parts);
        expect(n, kind + ' ' + q).toBeLessThanOrEqual(A.VEHICLE_TRIANGLES_MAX[q]);
        expect(n).toBeGreaterThan(300);
        counts[kind].push(n);
      }
    }
    for (const kind of ['car', 'bike']) { expect(counts[kind][1]).toBeGreaterThan(counts[kind][0]); expect(counts[kind][2]).toBeGreaterThan(counts[kind][1]); }
  });
  it('arrays are consistent: indices in range, unit normals, nothing NaN; and the body normals point OUTWARDS (the winding is right)', () => {
    for (const parts of [A.buildCar(A.VEHICLE_TIERS.mid), A.buildBike(A.VEHICLE_TIERS.mid)]) {
      for (const part of [parts.body, parts.glass, parts.tyre, parts.rim, parts.lights]) {
        if (!part) continue;
        const n = part.position.length / 3;
        expect(part.normal.length).toBe(n * 3); expect(part.index.length).toBe(part.triangles * 3);
        for (const i of part.index) expect(i).toBeLessThan(n);
        for (const v of [...part.position, ...part.normal]) expect(Number.isFinite(v)).toBe(true);
        for (let i = 0; i < n; i++) expect(Math.hypot(part.normal[i * 3], part.normal[i * 3 + 1], part.normal[i * 3 + 2])).toBeCloseTo(1, 4);
      }
    }
    const car = A.buildCar(A.VEHICLE_TIERS.desktop);
    const b = bbox(car.body); const cy = (b.min[1] + b.max[1]) / 2;
    let outward = 0; let n = 0;
    for (let i = 0; i < car.body.position.length; i += 3) {
      const x = car.body.position[i]; const y = car.body.position[i + 1] - cy; const z = car.body.position[i + 2];
      if (Math.abs(z) < 0.05 && Math.abs(y) < 0.05) continue;
      n++;
      if (car.body.normal[i + 1] * y + car.body.normal[i + 2] * z > 0) outward++;
      void x;
    }
    expect(outward / n).toBeGreaterThan(0.95);
  });
  it('there is room for at least eight vehicles at every tier after the map has taken its worst case', () => {
    for (const q of TIERS) expect(A.vehicleBudget(q), q).toBeGreaterThanOrEqual(8);
  });
});

describe('driving physics on flat ground', () => {
  const drive = (spec: any, env: any, seconds: number, input: any, x = 0, z = 0, yaw = 0, hz = 120): any => {
    const p = A.createVehiclePhysics(spec, env, x, z, yaw);
    for (let i = 0; i < seconds * hz; i++) p.step(1 / hz, typeof input === 'function' ? input(i / hz, p.state) : input);
    return p;
  };
  const GAS = { throttle: 1, steer: 0, brake: 0, handbrake: false };

  it('stands still on the ground when left alone, and is deterministic', () => {
    const p = drive(A.CAR_SPEC, flat(), 3, NO);
    expect(p.state.y).toBeCloseTo(0, 3); expect(p.state.speed).toBe(0); expect(p.state.onGround).toBe(true);
    const a = drive(A.CAR_SPEC, flat(), 4, (t: number) => ({ throttle: 1, steer: Math.sin(t), brake: 0, handbrake: false }));
    const b = drive(A.CAR_SPEC, flat(), 4, (t: number) => ({ throttle: 1, steer: Math.sin(t), brake: 0, handbrake: false }));
    expect(b.state).toEqual(a.state);
  });
  it('the car does 0 to 100 km/h in 2.8 to 6 s, never goes faster than its top speed, and speed only grows under full throttle', () => {
    const p = A.createVehiclePhysics(A.CAR_SPEC, flat(), 0, 0, 0);
    let t100 = -1; let prev = 0;
    for (let i = 0; i < 120 * 140; i++) {
      p.step(1 / 120, GAS);
      expect(p.state.speed).toBeGreaterThanOrEqual(prev - 1e-9); prev = p.state.speed;
      expect(p.state.speed).toBeLessThanOrEqual(A.CAR_SPEC.topSpeed + 0.5);
      if (t100 < 0 && p.state.speed >= 27.78) t100 = i / 120;
    }
    expect(t100).toBeGreaterThan(2.8); expect(t100).toBeLessThan(6);
    expect(p.state.speed).toBeGreaterThan(65);
  });
  it('the bike is quicker off the line and a little slower at the top', () => {
    const t = (spec: any): number => { const p = A.createVehiclePhysics(spec, flat(), 0, 0, 0); for (let i = 0; i < 120 * 30; i++) { p.step(1 / 120, GAS); if (p.state.speed >= 27.78) return i / 120; } return 99; };
    expect(t(A.BIKE_SPEC)).toBeLessThan(t(A.CAR_SPEC));
    expect(A.BIKE_SPEC.topSpeed).toBeLessThan(A.CAR_SPEC.topSpeed);
  });
  it('braking from 100 km/h stops in 25 to 50 m on asphalt, and the surface decides: grass is longer, snow much longer', () => {
    const stop = (surface: string): number => {
      const p = A.createVehiclePhysics(A.CAR_SPEC, flat(surface), 0, 0, 0);
      p.state.vx = 27.78; p.state.speed = 27.78;
      while (p.state.speed > 0.2) p.step(1 / 120, { throttle: 0, steer: 0, brake: 1, handbrake: false });
      return p.state.x;
    };
    const asphalt = stop('asphalt'); const grass = stop('grass'); const snow = stop('snow');
    expect(asphalt).toBeGreaterThan(25); expect(asphalt).toBeLessThan(50);
    expect(grass).toBeGreaterThan(asphalt * 1.5); expect(snow).toBeGreaterThan(asphalt * 3);
  });
  it('turns right when steered right: heading grows, at the rate the steering geometry asks for (v tan(delta) / wheelbase) at low speed', () => {
    const p = A.createVehiclePhysics(A.CAR_SPEC, flat(), 0, 0, 0);
    p.state.vx = 8; p.state.speed = 8;
    for (let i = 0; i < 120 * 2; i++) p.step(1 / 120, { throttle: 0.15, steer: 1, brake: 0, handbrake: false });
    const y0 = p.state.yaw; const v = p.state.speed; const delta = p.state.steerAngle;
    for (let i = 0; i < 12; i++) p.step(1 / 120, { throttle: 0.15, steer: 1, brake: 0, handbrake: false });
    const rate = (p.state.yaw - y0) / (12 / 120);
    expect(p.state.yaw).toBeGreaterThan(0);
    expect(rate).toBeGreaterThan(0.8 * v * Math.tan(delta) / A.CAR_SPEC.wheelbase); expect(rate).toBeLessThan(1.2 * v * Math.tan(delta) / A.CAR_SPEC.wheelbase);
  });
  it('the steering lock narrows with speed, so a fast car cannot turn as tight as a slow one', () => {
    const radius = (v: number): number => {
      const p = A.createVehiclePhysics(A.CAR_SPEC, flat(), 0, 0, 0);
      p.state.vx = v; p.state.speed = v;
      for (let i = 0; i < 120 * 3; i++) p.step(1 / 120, { throttle: v > 20 ? 0.3 : 0.1, steer: 1, brake: 0, handbrake: false });
      return Math.abs(p.state.speed / ((p.state.yaw - 0) / 3 || 1e-9));
    };
    expect(radius(40)).toBeGreaterThan(radius(10) * 3);
  });
  it('the sideways acceleration never goes beyond what the surface grips: about 1.15 g on asphalt, 0.32 g on snow', () => {
    const peak = (surface: string): number => {
      const p = A.createVehiclePhysics(A.CAR_SPEC, flat(surface), 0, 0, 0);
      p.state.vx = 40; p.state.speed = 40;
      let worst = 0; let last = p.state.yaw;
      for (let i = 0; i < 120 * 6; i++) { p.step(1 / 120, { throttle: 0.4, steer: 1, brake: 0, handbrake: false }); const rate = (p.state.yaw - last) * 120; last = p.state.yaw; worst = Math.max(worst, Math.abs(rate * p.state.speed)); }
      return worst / 9.81;
    };
    expect(peak('asphalt')).toBeLessThan(1.15 * 1.08); expect(peak('asphalt')).toBeGreaterThan(0.5);
    expect(peak('snow')).toBeLessThan(0.32 * 1.08);
  });
  it('a handbrake turn makes the car slide: sideways speed several m/s, against almost none with the same steering without it', () => {
    const slide = (handbrake: boolean): number => {
      const p = A.createVehiclePhysics(A.CAR_SPEC, flat(), 0, 0, 0);
      p.state.vx = 25; p.state.speed = 25;
      let worst = 0;
      for (let i = 0; i < 120 * 3; i++) { p.step(1 / 120, { throttle: 0.2, steer: 1, brake: 0, handbrake: handbrake && i > 60 }); worst = Math.max(worst, Math.abs(p.state.slip)); }
      return worst;
    };
    expect(slide(true)).toBeGreaterThan(2); expect(slide(false)).toBeLessThan(1);
  });
  it('reverses slowly: negative speed, never beyond a quarter of the top speed', () => {
    const p = drive(A.CAR_SPEC, flat(), 12, { throttle: -1, steer: 0, brake: 0, handbrake: false });
    expect(p.state.speed).toBeLessThan(-3); expect(p.state.speed).toBeGreaterThan(-A.CAR_SPEC.topSpeed * 0.3);
  });
  it('wheel rotation follows the distance driven (spin = distance / tyre radius) and the odometer counts metres', () => {
    const p = drive(A.CAR_SPEC, flat(), 6, GAS);
    expect(p.state.wheelSpin * A.CAR.wheelRadius).toBeCloseTo(p.state.odometer, 0);
    expect(p.state.odometer).toBeGreaterThan(100);
    expect(Math.abs(p.state.x - p.state.odometer)).toBeLessThan(1);
  });
  it('does not depend on the frame rate: 60 and 120 steps a second end within 1.5 percent of each other after 6 s', () => {
    const a = drive(A.CAR_SPEC, flat(), 6, (t: number) => ({ throttle: 1, steer: t > 3 ? 0.3 : 0, brake: 0, handbrake: false }), 0, 0, 0, 120);
    const b = drive(A.CAR_SPEC, flat(), 6, (t: number) => ({ throttle: 1, steer: t > 3 ? 0.3 : 0, brake: 0, handbrake: false }), 0, 0, 0, 60);
    expect(Math.abs(a.state.x - b.state.x) / a.state.x).toBeLessThan(0.015);
    expect(Math.abs(a.state.z - b.state.z)).toBeLessThan(2);
  });
});

describe('driving physics on slopes, over a crest, and in water', () => {
  const GAS = { throttle: 1, steer: 0, brake: 0, handbrake: false };
  it('a hill slows the car and tilts it to the slope: pitch follows the ground, roll follows a cross slope (positive: the right side higher)', () => {
    const run = (ground: (x: number, z: number) => number): any => { const p = A.createVehiclePhysics(A.CAR_SPEC, flat('asphalt', ground), 0, 0, 0); for (let i = 0; i < 120 * 5; i++) p.step(1 / 120, GAS); return p; };
    const level = run(() => 0); const hill = run((x) => 0.1 * x); const side = run((_x, z) => 0.05 * z);
    expect(hill.state.speed).toBeLessThan(level.state.speed);
    expect(hill.state.pitch).toBeCloseTo(Math.atan(0.1), 1);
    expect(side.state.roll).toBeCloseTo(Math.atan(0.05), 1);
    expect(Math.abs(level.state.pitch)).toBeLessThan(0.005);
  });
  it('rides on the ground: the body height is the average of the four wheels, within a few cm, on a steady slope', () => {
    const p = A.createVehiclePhysics(A.CAR_SPEC, flat('asphalt', (x) => 0.08 * x), 0, 0, 0);
    for (let i = 0; i < 120 * 4; i++) p.step(1 / 120, { throttle: 0.4, steer: 0, brake: 0, handbrake: false });
    const avg = (0.08 * (p.state.x + A.CAR.frontAxle) + 0.08 * (p.state.x + A.CAR.rearAxle)) / 2;
    expect(Math.abs(p.state.y - avg)).toBeLessThan(0.1);
  });
  it('flies off a crest and lands again: airborne at some point, body falls under gravity, then rides on the lower ground', () => {
    const p = A.createVehiclePhysics(A.CAR_SPEC, flat('asphalt', (x) => (x > 120 ? -6 : 0)), 0, 0, 0);
    p.state.vx = 40; p.state.speed = 40;
    let air = false; let minVy = 0;
    for (let i = 0; i < 120 * 8; i++) { p.step(1 / 120, { throttle: 0, steer: 0, brake: 0, handbrake: false }); if (!p.state.onGround) { air = true; minVy = Math.min(minVy, p.state.vy); } }
    expect(air).toBe(true); expect(minVy).toBeLessThan(-3);
    expect(p.state.onGround).toBe(true); expect(Math.abs(p.state.y - -6)).toBeLessThan(0.15);
  });
  it('water cuts the engine and drags the car to a stop', () => {
    const p = A.createVehiclePhysics(A.CAR_SPEC, flat('water'), 0, 0, 0);
    for (let i = 0; i < 120 * 5; i++) p.step(1 / 120, GAS);
    expect(p.state.inWater).toBe(true); expect(p.state.speed).toBeLessThan(0.5);
    const q = A.createVehiclePhysics(A.CAR_SPEC, flat('water'), 0, 0, 0);
    q.state.vx = 30; q.state.speed = 30;
    for (let i = 0; i < 120 * 4; i++) q.step(1 / 120, NO);
    expect(q.state.speed).toBeLessThan(3);
  });
  it('a bike leans INTO a turn (roll negative on a right turn), a car rolls a little the other way', () => {
    const lean = (spec: any): number => { const p = A.createVehiclePhysics(spec, flat(), 0, 0, 0); p.state.vx = 20; p.state.speed = 20; for (let i = 0; i < 120 * 3; i++) p.step(1 / 120, { throttle: 0.3, steer: 1, brake: 0, handbrake: false }); return p.state.roll; };
    expect(lean(A.BIKE_SPEC)).toBeLessThan(-0.15);
    expect(lean(A.CAR_SPEC)).toBeGreaterThan(0);
    expect(Math.abs(lean(A.CAR_SPEC))).toBeLessThan(Math.abs(lean(A.BIKE_SPEC)));
  });
  it('reset puts the car back at rest on the ground', () => {
    const p = A.createVehiclePhysics(A.CAR_SPEC, flat('asphalt', () => 7), 0, 0, 0);
    for (let i = 0; i < 300; i++) p.step(1 / 120, GAS);
    p.reset(10, 20, 1.2);
    expect(p.state.x).toBe(10); expect(p.state.z).toBe(20); expect(p.state.yaw).toBe(1.2); expect(p.state.speed).toBe(0); expect(p.state.y).toBe(7);
  });
});

describe('the surfaces of the map', () => {
  const w = A.createAthreeWorld({ seed: 3, profile: 'racing' });
  it('asphalt on a road, water in a river, a lake or the sea, and by biome elsewhere', () => {
    const road = w.homeRoads().roads.find((r: any) => r.kind === 'circuit').points[5];
    expect(w.surfaceAt(road.x, road.z)).toBe('asphalt');
    const seen = new Set<string>();
    for (let i = 0; i < 6000; i++) {
      const x = ((i * 7919) % 90000) - 45000; const z = ((i * 104729) % 90000) - 45000;
      const s = w.surfaceAt(x, z); seen.add(s);
      expect(['asphalt', 'grass', 'sand', 'snow', 'rock', 'water']).toContain(s);
      if (w.waterAt(x, z) || w.heightAt(x, z) < 0) expect(s).toBe('water');
      if (s === 'sand') expect(['beach', 'desert']).toContain(w.biomeAt(x, z));
      if (s === 'snow') expect(w.biomeAt(x, z)).toBe('snow');
    }
    for (const k of ['grass', 'water', 'sand', 'rock', 'snow']) expect(seen.has(k), k).toBe(true);
  });
  it('grip falls from asphalt to rock to grass to sand to snow, and water has almost none', () => {
    const f = A.SURFACE_FRICTION;
    expect(f.asphalt).toBeGreaterThan(f.rock); expect(f.rock).toBeGreaterThan(f.grass); expect(f.grass).toBeGreaterThan(f.sand); expect(f.sand).toBeGreaterThan(f.snow); expect(f.snow).toBeGreaterThan(f.water);
  });
});

/** A simple driver for the tests: steer towards a point 18 m ahead along a road, hold a steady speed. */
function follow(points: any[], closed: boolean, state: any, aim: { i: number }, targetSpeed: number): any {
  const n = points.length;
  let best = aim.i; let bd = Infinity;
  for (let k = -6; k <= 14; k++) {
    const j = closed ? (aim.i + k + n * 4) % n : Math.min(n - 1, Math.max(0, aim.i + k));
    const d = Math.hypot(points[j].x - state.x, points[j].z - state.z);
    if (d < bd) { bd = d; best = j; }
  }
  aim.i = best;
  const tj = closed ? (best + 3) % n : Math.min(n - 1, best + 3);
  const want = Math.atan2(points[tj].z - state.z, points[tj].x - state.x);
  let err = want - state.yaw; while (err > Math.PI) err -= Math.PI * 2; while (err < -Math.PI) err += Math.PI * 2;
  return { throttle: state.speed < targetSpeed ? 1 : 0, steer: Math.max(-1, Math.min(1, err * 2.2)), brake: state.speed > targetSpeed + 4 ? 0.4 : 0, handbrake: false };
}

describe('driving on the real map', () => {
  it('a car laps the real race circuit: it stays on the road (within 7 m of the centre line, 95 percent of the time) and covers over a kilometre', () => {
    for (const seed of [3, 9]) {
      const w = A.createAthreeWorld({ seed, profile: 'racing' });
      const home = w.homeRoads(); const road = home.roads[home.circuit.road];
      const sp = w.spawnPoints('vehicle', 1)[0];
      const phys = A.createVehiclePhysics(A.CAR_SPEC, A.mapEnvironment(w), sp.x, sp.z, sp.heading);
      const aim = { i: road.points.length - 3 };
      let near = 0; let total = 0; let onRoad = 0;
      for (let i = 0; i < 120 * 70; i++) {
        phys.step(1 / 120, follow(road.points, true, phys.state, aim, 22));
        if (i % 12 === 0) {
          total++;
          const p = road.points[aim.i];
          if (Math.hypot(p.x - phys.state.x, p.z - phys.state.z) < 7) near++;
          if (w.roadAt(phys.state.x, phys.state.z)) onRoad++;
        }
      }
      expect(near / total, 'seed ' + seed).toBeGreaterThan(0.95);
      expect(onRoad / total, 'seed ' + seed).toBeGreaterThan(0.8);
      expect(phys.state.odometer).toBeGreaterThan(1000);
      expect(phys.state.inWater).toBe(false);
    }
  });
  it('a car crosses a bridge ON THE DECK, with the river beneath it (the class: a car that falls through a bridge)', () => {
    let crossed = 0;
    for (const [seed, profile] of [[6, 'open-world'], [3, 'open-world'], [14, 'open-world']] as const) {
      const w = A.createAthreeWorld({ seed, profile });
      for (const road of w.homeRoads().roads) {
        const i = road.points.findIndex((p: any, k: number) => p.bridge && road.points[k + 1]?.bridge && road.points[k + 2]?.bridge && road.points[k + 3]?.bridge && road.points[k + 4]?.bridge);
        if (i < 0) continue;
        const start = Math.max(0, i - 14);
        const phys = A.createVehiclePhysics(A.CAR_SPEC, A.mapEnvironment(w), road.points[start].x, road.points[start].z, Math.atan2(road.points[start + 1].z - road.points[start].z, road.points[start + 1].x - road.points[start].x));
        const aim = { i: start };
        let onDeck = 0; let fell = false;
        for (let k = 0; k < 120 * 25 && aim.i < Math.min(road.points.length - 3, i + 12); k++) {
          phys.step(1 / 120, follow(road.points, false, phys.state, aim, 14));
          const near = road.points[aim.i];
          if (near.bridge && Math.hypot(near.x - phys.state.x, near.z - phys.state.z) < 3) {
            if (Math.abs(phys.state.y - near.y) < 0.6) onDeck++; else fell = true;
          }
        }
        expect(fell, 'seed ' + seed).toBe(false);
        expect(onDeck, 'seed ' + seed).toBeGreaterThan(20);
        expect(w.heightAt(road.points[i + 2].x, road.points[i + 2].z)).toBeLessThan(road.points[i + 2].y - 1.5);
        crossed++;
        break;
      }
    }
    expect(crossed).toBeGreaterThanOrEqual(2);
  });
  it('a bike gets round the circuit too', () => {
    const w = A.createAthreeWorld({ seed: 3, profile: 'racing' });
    const home = w.homeRoads(); const road = home.roads[home.circuit.road];
    const sp = w.spawnPoints('vehicle', 1)[0];
    const phys = A.createVehiclePhysics(A.BIKE_SPEC, A.mapEnvironment(w), sp.x, sp.z, sp.heading);
    const aim = { i: road.points.length - 3 };
    let near = 0; let total = 0;
    for (let i = 0; i < 120 * 50; i++) { phys.step(1 / 120, follow(road.points, true, phys.state, aim, 20)); if (i % 12 === 0) { total++; const p = road.points[aim.i]; if (Math.hypot(p.x - phys.state.x, p.z - phys.state.z) < 7) near++; } }
    expect(near / total).toBeGreaterThan(0.95);
    expect(phys.state.odometer).toBeGreaterThan(700);
  });
});

describe('the vehicle on screen (real three.js)', () => {
  const origin = { x: 0, z: 0 };
  function make(kind: 'car' | 'bike' = 'car', quality: 'phone' | 'mid' | 'desktop' = 'mid') {
    const w = A.createAthreeWorld({ seed: 3, profile: 'racing' });
    return { w, v: A.createVehicle(THREE, w, { kind, quality }) };
  }
  it('starts at the safe spawn of the map, on the ground, and draws a body, glass and lights plus four wheels (two for a bike)', () => {
    const { w, v } = make();
    const sp = w.spawnPoints('vehicle', 1)[0];
    expect(v.state.x).toBeCloseTo(sp.x, 6); expect(v.state.z).toBeCloseTo(sp.z, 6); expect(v.state.y).toBeCloseTo(w.drivableHeightAt(sp.x, sp.z), 6);
    let meshes = 0; v.group.traverse((o: any) => { if (o.isMesh) meshes++; });
    expect(meshes).toBe(3 + 4 * 2);
    expect(v.group.children).toHaveLength(1 + 4);
    const b = make('bike').v;
    let bm = 0; b.group.traverse((o: any) => { if (o.isMesh) bm++; });
    expect(bm).toBe(2 + 2 * 2);
    expect(v.triangles).toBeLessThanOrEqual(A.VEHICLE_TRIANGLES_MAX.mid);
  });
  it('is placed in render space (world minus origin), and follows a floating-origin shift', () => {
    const { v } = make();
    v.update(0, A.NO_INPUT, origin);
    const x = v.group.position.x; const z = v.group.position.z;
    v.update(0, A.NO_INPUT, { x: 1000, z: -400 });
    expect(v.group.position.x).toBeCloseTo(x - 1000, 6); expect(v.group.position.z).toBeCloseTo(z + 400, 6);
  });
  it('the model faces the way it drives: its front end is ahead of its middle along the heading, for any heading', () => {
    const { w } = make();
    for (const yaw of [0, 0.7, 2.1, -1.3, 3.0]) {
      const v = A.createVehicle(THREE, w, { kind: 'car', x: 500, z: 500, yaw });
      v.update(0, A.NO_INPUT, origin);
      v.group.updateMatrixWorld(true);
      const front = new THREE.Vector3(2, 0, 0).applyMatrix4(v.group.matrixWorld);
      const dx = front.x - v.group.position.x; const dz = front.z - v.group.position.z;
      expect(Math.atan2(dz, dx)).toBeCloseTo(Math.atan2(Math.sin(yaw), Math.cos(yaw)), 3);
      const right = new THREE.Vector3(0, 0, 1).applyMatrix4(v.group.matrixWorld);
      // The car's right is the heading turned a quarter turn towards +z: (-sin, cos).
      expect((right.x - v.group.position.x) * -Math.sin(yaw) + (right.z - v.group.position.z) * Math.cos(yaw)).toBeGreaterThan(0.99);
      v.dispose();
    }
  });
  it('wheels spin with the distance driven, the front wheels steer, and the brake lights come on under braking', () => {
    const { v } = make();
    for (let i = 0; i < 90; i++) v.update(1 / 60, { throttle: 1, steer: 0.6, brake: 0, handbrake: false }, origin);
    const wheels = v.group.children.slice(1);
    const spin = wheels.map((p: any) => p.children[0].rotation.z);
    for (const s of spin) expect(s).toBeCloseTo(-v.state.wheelSpin, 6);
    const front = wheels.filter((p: any) => p.position.x > 0); const rear = wheels.filter((p: any) => p.position.x < 0);
    for (const f of front) expect(f.rotation.y).toBeCloseTo(-v.state.steerAngle, 6);
    for (const r of rear) expect(r.rotation.y).toBe(0);
    expect(Math.abs(v.state.steerAngle)).toBeGreaterThan(0.05);
    const lights = v.group.children[0].children.find((c: any) => c.material && c.material.emissive);
    expect(lights.material.emissive.getHex()).toBe(0);
    v.update(1 / 60, { throttle: 0, steer: 0, brake: 1, handbrake: false }, origin);
    expect(lights.material.emissive.getHex()).toBe(0xff1010);
  });
  it('the body pitches and rolls with the ground; headlights switch on and off; dispose releases geometry and materials', () => {
    const { v } = make();
    for (let i = 0; i < 60; i++) v.update(1 / 60, { throttle: 0.3, steer: 0, brake: 0, handbrake: false }, origin);
    const body = v.group.children[0];
    expect(body.rotation.z).toBeCloseTo(v.state.pitch, 6); expect(body.rotation.x).toBeCloseTo(-v.state.roll, 6);
    const lamp = body.children.find((c: any) => c.isPointLight);
    expect(lamp.intensity).toBe(0); v.setLights(true); expect(lamp.intensity).toBeGreaterThan(0.5); v.setLights(false); expect(lamp.intensity).toBe(0);
    let n = 0;
    v.group.traverse((o: any) => { if (o.isMesh) { o.geometry.addEventListener('dispose', () => n++); } });
    const mat = v.group.children[0].children[0].material; mat.addEventListener('dispose', () => n++);
    v.dispose();
    expect(n).toBeGreaterThanOrEqual(12);
  });
  it('a long frame is stepped at a fixed rate, so the driving does not depend on the frame rate on screen', () => {
    const a = make().v; const b = make().v;
    for (let i = 0; i < 60; i++) a.update(1 / 60, { throttle: 1, steer: 0, brake: 0, handbrake: false }, origin);
    for (let i = 0; i < 30; i++) b.update(1 / 30, { throttle: 1, steer: 0, brake: 0, handbrake: false }, origin);
    expect(Math.abs(a.state.x - b.state.x)).toBeLessThan(0.5);
  });
});
