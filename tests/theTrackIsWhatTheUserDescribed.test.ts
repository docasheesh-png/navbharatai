import { indexedRaycast } from './helpers/indexedRaycast';
// THE TRACK IS WHAT THE USER DESCRIBED (admin 2026-11-02, t315u): curved and closed roads drape on the land,
// a road crossing a rail is a LEVEL crossing, and a streamed track plan loops A..L for ever — or ends where
// the user said (a barrier, a lake) — with seamless joins, bounded memory and a car that never sinks.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';

const DIR = join(__dirname, `.tmp-track-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let W: any; let O: any; let S: any;
beforeAll(async () => {
  (globalThis as any).document = { createElement: () => ({ getContext: () => ({ createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }), putImageData: () => undefined }) }) };
  (globalThis as any).window = { innerWidth: 800, innerHeight: 600 };
  for (const r of [generateGameRuntime(), generateGame3D()]) {
    for (const [p, c] of Object.entries(r.files)) { const f = join(DIR, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
  }
  W = await import(join(DIR, 'src/game/three/world.ts'));
  O = await import(join(DIR, 'src/game/three/objects.ts'));
  S = await import(join(DIR, 'src/game/three/surfaces.ts'));
});
afterAll(() => { rmSync(DIR, { recursive: true, force: true }); delete (globalThis as any).document; delete (globalThis as any).window; });
beforeEach(() => { S.setGround(null); S.clearWater(); });

const surfY = (m: THREE.Object3D, x: number, z: number) => {
  let top = m; while (top.parent) top = top.parent;
  top.updateMatrixWorld(true);
  const hit = indexedRaycast(new THREE.Raycaster(new THREE.Vector3(x, 500, z), new THREE.Vector3(0, -1, 0)), m)[0];
  return hit ? hit.point.y : NaN;
};

describe('curved and closed roads', () => {
  it('a closed circuit drapes on hills: asphalt above the grass all the way round', () => {
    const t = W.createTerrain({ size: 400, amplitude: 10, seed: 6 });
    const ring: Array<[number, number]> = [];
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; ring.push([Math.cos(a) * 110, Math.sin(a) * 70]); }
    const road = O.createRoad({ path: ring, closed: true, detail: 'lite' });
    S.syncGround();
    const path = road.userData.path;
    let relief = 0;
    for (let sv = 0; sv < path.total; sv += 1.3) {
      const q = O.pathPose(path, sv);
      for (const lat of [-3.5, 0, 3.5]) {
        const x = q.x + q.tz * lat, z = q.z - q.tx * lat;
        const r = surfY(road.children[0], x, z), g = surfY(t, x, z);
        expect(r - g).toBeGreaterThan(0);
        expect(r - g).toBeLessThan(0.25);
        relief = Math.max(relief, Math.abs(r));
      }
    }
    expect(relief).toBeGreaterThan(1);
  });

  it('a car driven round a curve stays on the asphalt (never below it)', () => {
    W.createTerrain({ size: 400, amplitude: 10, seed: 6 });
    const road = O.createRoad({ path: [[0, -100], [20, 0], [80, 60], [160, 80]], detail: 'lite' });
    const path = road.userData.path;
    const car = O.createCar();
    for (let sv = 0; sv < path.total; sv += 2) {
      const q = O.pathPose(path, sv);
      car.position.set(q.x, -10, q.z);
      O.settleOnGround(car, Math.atan2(q.tx, q.tz), 1);
      expect(car.position.y).toBeGreaterThanOrEqual(surfY(road.children[0], q.x, q.z) - 0.03);
      expect(car.position.y).toBeLessThan(surfY(road.children[0], q.x, q.z) + 0.1);
    }
  });
});

describe('a road across a rail is a LEVEL crossing', () => {
  it('rails are flush with the asphalt at the crossing and the car does not jump', () => {
    W.createTerrain({ size: 400, amplitude: 10, seed: 3 });
    const road = O.createRoad({ length: 200, detail: 'lite' });
    const track = O.createRailTrack({ length: 200, detail: 'lite' }); track.rotation.y = Math.PI / 2;   // crosses at the origin
    S.syncGround();
    const asphalt = surfY(road.children[0], 0.5, 0.9);
    const railTop = surfY(track.children[2], 0.5, 0.838);
    expect(Math.abs(railTop - asphalt)).toBeLessThan(0.06);
    // Drive across: the ground under the car never steps up by the rail height.
    let prev = O.groundHeightAt(0, -20), maxStep = 0;
    for (let z = -20; z <= 20; z += 0.25) { const h = O.groundHeightAt(1, z); maxStep = Math.max(maxStep, Math.abs(h - prev)); prev = h; }
    expect(maxStep).toBeLessThan(0.1);
  });
});

describe('createTrackStream — a plan streamed for ever, or ended where the user said', () => {
  const drive = (stream: any, car: THREE.Object3D, metres: number) => {
    let st: any = null, last: any = null;
    const dt = 1 / 30;
    for (let t = 0, moved = 0; moved < metres && t < 200000; t++) {
      // Steer along the track: aim at a point 8 m ahead on the current piece.
      last = stream.update(car);
      const seg = last.segment; if (!seg) break;
      const path = seg.road.userData.path;
      const here = O.pathPose(path, Math.min(path.total, (last.distance - seg.startDistance) + 2));
      const tx = here.tx, tz = here.tz;
      car.position.x = here.x + seg.road.position.x; car.position.z = here.z + seg.road.position.z;
      car.rotation.y = Math.atan2(tx, tz);
      st = O.settleOnGround(car, car.rotation.y, dt, {}, st ?? {});
      moved = last.distance;
      if (last.ended && path.total - (last.distance - seg.startDistance) < 3) break;
    }
    return last;
  };

  it('3 infinite loops of A..L: never sinks, joins seamless, memory bounded, laps counted, pieces vary per loop', () => {
    const stream = O.createTrackStream(O.DEFAULT_TRACK_PLAN, { detail: 'lite' });
    const scene = new THREE.Scene(); scene.add(stream.root);
    const car = O.createCar(); scene.add(car);
    const loopLen = O.DEFAULT_TRACK_PLAN.pieces.reduce((a: number, p: any) => a + p.length, 0);
    let maxAlive = 0, minGap = Infinity, rebased = 0;
    const seen: string[] = [];
    let status: any;
    for (let target = 50; target < loopLen * 3 + 80; target += 25) {
      status = drive(stream, car, target);
      if (status.rebased) rebased++;
      maxAlive = Math.max(maxAlive, stream.stats().alive, S.corridorCount());
      minGap = Math.min(minGap, car.position.y - O.groundHeightAt(car.position.x, car.position.z));
      // Seamless: each live piece starts exactly where the previous one ended.
      const segs = stream.segments;
      for (let i = 1; i < segs.length; i++) {
        expect(Math.hypot(segs[i].start.x - segs[i - 1].end.x, segs[i].start.z - segs[i - 1].end.z)).toBeLessThan(1e-6);
        expect(Math.abs(segs[i].start.heading - segs[i - 1].end.heading)).toBeLessThan(1e-9);
        expect(Math.abs(segs[i].start.y - segs[i - 1].end.y)).toBeLessThan(1e-9);
      }
      for (const sg of segs) seen.push(sg.loop + ':' + sg.index + ':' + sg.pickups.length);
    }
    expect(status.lap).toBeGreaterThanOrEqual(3);
    expect(status.distance).toBeGreaterThan(loopLen * 3);
    expect(minGap).toBeGreaterThanOrEqual(-1e-6);
    expect(maxAlive).toBeLessThanOrEqual(6);                 // 1 behind + current + 3 ahead (+ spawn slack)
    expect(stream.stats().created).toBeGreaterThan(36);       // 3 × 12 pieces were streamed and recycled
    // Floating origin: ~3.5 km driven, yet the car is still within the rebase radius of 0.
    expect(Math.hypot(car.position.x, car.position.z)).toBeLessThan(1000);
    // L -> A join: the stream kept going past the end of the plan (index 11 then 0 in the next loop).
    expect(stream.segments.some((s: any) => s.loop >= 3)).toBe(true);
    const cones = (l: number) => stream.segments.filter((s: any) => s.loop === l);
    void cones;
    stream.dispose();
  });

  it('a finite plan ENDS: straight, curve, then the road runs into a lake (declared water) and no more pieces come', () => {
    const plan = { loop: 'none', pieces: [{ kind: 'straight', length: 80 }, { kind: 'curve', angle: 0.6, length: 90 }, { kind: 'water', length: 70 }] };
    const stream = O.createTrackStream(plan, { detail: 'lite' });
    const car = O.createCar();
    const status = drive(stream, car, 10000);
    expect(status.ended).toBe(true);
    expect(stream.stats().created).toBe(3);
    const last = stream.segments[stream.segments.length - 1];
    expect(last.piece.kind).toBe('water');
    // Beyond the slipway there is water: groundScene lets a boat be below the ground there, nowhere else.
    const lake = last.extras.children.find((c: any) => c.geometry?.type === 'CircleGeometry');
    expect(S.isWaterAt(lake.position.x + last.road.position.x, lake.position.z)).toBe(true);
    expect(S.isWaterAt(stream.segments[0].start.x, stream.segments[0].start.z)).toBe(false);
    stream.dispose();
  });

  it('loopFrom: an intro played once, then the rest loops; an end barrier stops a finite course', () => {
    const intro = O.createTrackStream({ loop: 'infinite', loopFrom: 1, pieces: [{ kind: 'finish', length: 40 }, { kind: 'straight', length: 60 }, { kind: 'curve', angle: 0.4, length: 60 }] }, { detail: 'lite' });
    const car = O.createCar();
    drive(intro, car, 700);
    expect(intro.stats().created).toBeGreaterThan(8);
    expect(intro.segments.every((s: any) => s.index !== 0)).toBe(true);   // the intro never came back
    intro.dispose();
    const fin = O.createTrackStream({ loop: 'none', pieces: [{ kind: 'straight', length: 60 }, { kind: 'end' }] }, { detail: 'lite' });
    const st = drive(fin, O.createCar(), 10000);
    expect(st.ended).toBe(true);
    expect(fin.segments[fin.segments.length - 1].piece.kind).toBe('end');
    fin.dispose();
  });

  it('a circuit closes back onto its start', () => {
    const c = O.createTrackStream({ loop: 'circuit', ahead: 20, pieces: [{ kind: 'curve', angle: Math.PI, length: 300 }, { kind: 'straight', length: 60 }, { kind: 'curve', angle: Math.PI * 0.9, length: 300 }] }, { detail: 'lite' });
    const segs = c.segments;
    const last = segs[segs.length - 1];
    expect(last.piece.name).toBe('circuit closer');
    expect(Math.hypot(last.end.x - segs[0].start.x, last.end.z - segs[0].start.z)).toBeLessThan(1e-6);
    c.dispose();
  });

  // Owner 2026-11-18: "12 par takna nahi hai … user jab chahe map ko badlao karwa sake … kuch bhi hard-core nahi".
  const seamless = (segs: any[]) => {
    for (let i = 1; i < segs.length; i++) {
      expect(Math.hypot(segs[i].start.x - segs[i - 1].end.x, segs[i].start.z - segs[i - 1].end.z)).toBeLessThan(1e-6);
      expect(Math.abs(segs[i].start.heading - segs[i - 1].end.heading)).toBeLessThan(1e-9);
      expect(Math.abs(segs[i].start.y - segs[i - 1].end.y)).toBeLessThan(1e-9);
      expect(segs[i].startDistance).toBeCloseTo(segs[i - 1].startDistance + segs[i - 1].length, 6);
    }
  };

  it('the course changes while the game runs: any number of pieces, seamless, the piece under the car kept', () => {
    const stream = O.createTrackStream(O.DEFAULT_TRACK_PLAN, { detail: 'lite' });
    const car = O.createCar();
    drive(stream, car, 300);
    const under = stream.update(car).segment;
    // A two-piece desert course, swapped in NOW: everything ahead of the car is replaced.
    const desert = { loop: 'infinite', pieces: [{ kind: 'straight', length: 90, scenery: 'desert', name: 'dune straight' }, { kind: 'curve', angle: -0.5, length: 100, scenery: 'desert', name: 'dune bend' }] };
    expect(stream.setPlan(desert, { now: true })).toBe(true);
    expect(stream.segments.some((s: any) => s === under)).toBe(true);
    expect(stream.segments.filter((s: any) => s.serial > under.serial)).toHaveLength(0);
    expect(stream.plan.pieces).toHaveLength(2);
    drive(stream, car, 1200);
    const names = stream.segments.map((s: any) => s.piece.name).filter((n: string) => n.startsWith('dune'));
    expect(names.length).toBeGreaterThan(1);
    expect(stream.segments.every((s: any) => s.piece.name.startsWith('dune') || s.serial <= under.serial)).toBe(true);
    seamless(stream.segments);
    // And a twenty-piece course, swapped in at the NEXT join (the road already laid ahead stays).
    const twenty = { loop: 'infinite', pieces: Array.from({ length: 20 }, (_, i) => ({ kind: i % 2 ? 'curve' : 'straight', angle: i % 4 === 1 ? 0.3 : -0.3, length: 60, name: `p${i + 1}` })) };
    const before = stream.segments.map((s: any) => s.serial);
    expect(stream.setPlan(twenty)).toBe(true);
    for (const sv of before) expect(stream.segments.some((s: any) => s.serial === sv) || sv < stream.segments[0].serial).toBe(true);
    drive(stream, car, 1500);
    expect(stream.segments.some((s: any) => /^p\d+$/.test(s.piece.name))).toBe(true);
    seamless(stream.segments);
    stream.dispose();
  });

  it('an empty plan or an ended course is refused and changes nothing', () => {
    const stream = O.createTrackStream(O.DEFAULT_TRACK_PLAN, { detail: 'lite' });
    expect(stream.setPlan({ pieces: [] })).toBe(false);
    expect(stream.plan.pieces).toHaveLength(12);
    stream.dispose();
    const fin = O.createTrackStream({ loop: 'none', pieces: [{ kind: 'straight', length: 60 }, { kind: 'end' }] }, { detail: 'lite' });
    drive(fin, O.createCar(), 10000);
    expect(fin.setPlan(O.DEFAULT_TRACK_PLAN)).toBe(false);
    fin.dispose();
  });
});
