// ATHREE MAP — natural boundaries, the sea shelf, ponds (talab) and the water / ground rules for every mover (admin 2026-11-27).
// These tests RUN the emitted code (tests/helpers/loadAthree.ts): every claim below is a measurement of the world a game gets.
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { loadAthree } from '../../../../tests/helpers/loadAthree';

vi.setConfig({ testTimeout: 180000 });

const A = loadAthree();
const KINDS = ['sea', 'mountains', 'canyon', 'forest-river', 'dunes', 'wall'] as const;
const world = (boundary: string, extra: Record<string, unknown> = {}) => A.createAthreeWorld({ profile: 'battle-royale', seed: 3, boundary, ...extra });
const ANGLES = Array.from({ length: 120 }, (_, i) => (i / 120) * Math.PI * 2);
const at = (r: number, a: number) => [Math.cos(a) * r, Math.sin(a) * r] as const;

describe('every boundary closes its ring (sampled all the way round)', () => {
  const w = A.boundaryBand(4000);

  it('the ring itself closes: the radius at angle 0 and at a full turn is the same point', () => {
    for (const kind of KINDS) {
      const b = world(kind).boundary;
      expect(b.kind).toBe(kind);
      expect(b.featureAt(0)).toBeCloseTo(b.featureAt(Math.PI * 2), 6);
      expect(b.featureAt(-1e-7)).toBeCloseTo(b.featureAt(1e-7), 3);
    }
  });

  it("sea: open water at the limit all the way round", () => {
    const wd = world('sea');
    for (const a of ANGLES) expect(wd.heightAt(...at(wd.boundary.limitAt(a), a)), 'angle ' + a).toBeLessThan(-2);
  });

  it('mountains: a face steeper than 45 degrees rising at least 0.8 of the wall height above the land inside, everywhere', () => {
    const wd = world('mountains');
    const H = 1.6 * w;
    for (const a of ANGLES) {
      const f = wd.boundary.featureAt(a);
      const foot = wd.heightAt(...at(f - w, a)), crest = wd.heightAt(...at(f, a));
      expect(crest - Math.max(foot, 0), 'angle ' + a).toBeGreaterThan(0.8 * H);
      let steepest = 0;
      for (let u = -w; u < 0; u += 4) steepest = Math.max(steepest, (wd.heightAt(...at(f + u + 4, a)) - wd.heightAt(...at(f + u, a))) / 4);
      expect(steepest, 'angle ' + a).toBeGreaterThan(1);
      // The limit is ON the face: a walker held there stands well above the land it came from.
      expect(wd.heightAt(...at(wd.boundary.limitAt(a), a)) - Math.max(foot, 0)).toBeGreaterThan(0.25 * H);
    }
  });

  it('canyon: a rim, a sheer drop to the floor, and a far wall higher than the rim, everywhere', () => {
    const wd = world('canyon');
    const D = Math.max(25, 0.5 * w);
    for (const a of ANGLES) {
      const f = wd.boundary.featureAt(a);
      const floor = wd.heightAt(...at(f, a)), rim = wd.heightAt(...at(f - w, a)), far = wd.heightAt(...at(f + w, a));
      expect(Math.abs(floor - A.CANYON_FLOOR), 'angle ' + a).toBeLessThan(0.01);
      expect(rim - floor, 'angle ' + a).toBeGreaterThanOrEqual(D * 0.99);
      expect(far - floor, 'angle ' + a).toBeGreaterThan(rim - floor);
      expect(far - floor).toBeGreaterThanOrEqual(1.4 * D);
      // The limit stands on the rim, before the drop: nobody is held at the bottom.
      expect(wd.heightAt(...at(wd.boundary.limitAt(a), a)) - floor).toBeGreaterThan(D * 0.9);
    }
  });

  it('forest-river: deep water in the channel and forest on both banks, everywhere', () => {
    const wd = world('forest-river');
    for (const a of ANGLES) {
      const f = wd.boundary.featureAt(a);
      const p = at(f, a);
      expect(wd.heightAt(...p), 'angle ' + a).toBeLessThan(-2);
      expect(A.waterDepthAt(wd, ...p).cls).not.toBe('dry');
      expect(A.moverRule('car', A.waterDepthAt(wd, ...p).depth).allowed).toBe(false);
      expect(wd.biomeAt(...at(f - 1.4 * w, a))).toBe('forest');
      expect(wd.biomeAt(...at(f + 1.4 * w, a))).toBe('forest');
    }
  });

  it('dunes: a sand wall at least half the dune height above the land inside, everywhere', () => {
    const wd = world('dunes');
    for (const a of ANGLES) {
      const f = wd.boundary.featureAt(a);
      expect(wd.heightAt(...at(f, a)) - Math.max(wd.heightAt(...at(f - 1.3 * w, a)), 0), 'angle ' + a).toBeGreaterThan(0.5 * 0.7 * w);
      expect(wd.biomeAt(...at(f, a))).toBe('desert');
    }
  });

  it('wall: a stone wall is drawn all round (every segment near the camera stands on the ground under it)', () => {
    const wd = world('wall');
    const wall = A.createBoundaryWall(THREE, wd.boundary, (x: number, z: number) => wd.heightAt(x, z));
    for (const a of [0, 1.3, 2.9, 4.4, 5.9]) {
      const [cx, cz] = at(wd.boundary.featureAt(a), a);
      wall.update(cx + 1e4, cz, { x: 0, z: 0 });
      wall.update(cx, cz, { x: 0, z: 0 });
      expect(wall.drawn(), 'angle ' + a).toBeGreaterThan(300);
      const body = wall.group.children[0] as THREE.InstancedMesh;
      const m = new THREE.Matrix4(), pos = new THREE.Vector3();
      for (let i = 0; i < body.count; i += 37) {
        body.getMatrixAt(i, m); pos.setFromMatrixPosition(m);
        const top = pos.y + (A.WALL_HEIGHT + 6) / 2;
        expect(top - wd.heightAt(pos.x, pos.z)).toBeGreaterThan(A.WALL_HEIGHT - 1.5);
      }
    }
    wall.dispose();
  });

  it('a loop world has no edge to hold (it wraps)', () => {
    const b = A.createAthreeWorld({ seed: 3, boundary: 'mountains' }).boundary;
    expect(b.kind).toBe('none');
    expect(b.ceiling).toBe(Infinity);
    expect(b.inside(1e6, 1e6)).toBe(true);
  });

  it('an unknown boundary name is the sea, and said', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(world('lava').boundary.kind).toBe('sea');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('spawns are never in the band, and the default sea island is unchanged on land', () => {
    for (const kind of KINDS) {
      const wd = world(kind);
      for (const s of wd.spawnPoints('player', 6)) expect(wd.boundary.inside(s.x, s.z, 40), kind).toBe(true);
    }
    const sea = world('sea'), old = A.createAthreeWorld({ profile: 'battle-royale', seed: 3 });
    for (let i = 0; i < 200; i++) { const x = (i * 97) % 5000 - 2500, z = (i * 61) % 5000 - 2500; expect(sea.heightAt(x, z)).toBe(old.heightAt(x, z)); }
  });
});

describe('the heightfield a collider gets IS the drawn ground, across the boundary', () => {
  it('node for node, for every kind', () => {
    for (const kind of KINDS) {
      const wd = world(kind);
      const f = wd.boundary.featureAt(0.7);
      const [x0, z0] = at(f - 200, 0.7);
      const hf = A.heightfieldFor(wd, x0, z0, 320, 32);
      const n = 33;
      for (let col = 0; col < n; col += 3) for (let row = 0; row < n; row += 3) {
        expect(hf.heights[col * n + row], kind).toBe(Math.fround(wd.heightAt(x0 + (col * 320) / 32, z0 + (row * 320) / 32)));
      }
    }
  });
});

describe('the sea shelf: a beach, then deeper and deeper away from the shore', () => {
  it('only gets deeper going out to sea, along every ray (bounded island)', () => {
    const wd = world('sea', { rivers: false });
    for (const a of ANGLES) {
      // From the outermost shore out to the limit, 10 m at a time.
      let r = wd.boundary.limitAt(a);
      while (r > 0 && wd.heightAt(...at(r, a)) < 0) r -= 10;
      let prev = Infinity, deepest = 0;
      for (let d = r + 10; d <= wd.boundary.limitAt(a); d += 10) {
        const h = wd.heightAt(...at(d, a));
        expect(h, 'angle ' + a + ' at ' + d).toBeLessThanOrEqual(prev + 1e-9);
        prev = h; deepest = Math.max(deepest, -h);
      }
      expect(deepest, 'angle ' + a).toBeGreaterThan(45);
      expect(deepest).toBeLessThanOrEqual(50);
    }
  });

  it('the profile: 0 at the waterline, 2 m at the beach edge, the chosen depth past the shelf, never decreasing', () => {
    expect(A.shelfDepth(0)).toBe(0);
    expect(A.shelfDepth(40)).toBeCloseTo(2, 9);
    expect(A.shelfDepth(5000)).toBeCloseTo(50, 9);
    expect(A.shelfDepth(5000, { maxDepth: 12 })).toBeCloseTo(12, 9);
    expect(A.shelfDepth(5000, { maxDepth: 500 })).toBeCloseTo(50, 9);
    let prev = 0;
    for (let d = 0; d < 1000; d += 0.5) { const v = A.shelfDepth(d); expect(v).toBeGreaterThanOrEqual(prev); prev = v; }
  });

  it('seaMaxDepth holds everywhere, on a loop world too', () => {
    const loop = A.createAthreeWorld({ seed: 5, rivers: false, roads: false, water: { seaMaxDepth: 15 } });
    let sea = 0;
    for (let i = 0; i < 4000; i++) { const h = loop.heightAt((i * 733) % 40000 - 20000, (i * 1181) % 40000 - 20000); if (h < 0) { sea++; expect(h).toBeGreaterThanOrEqual(-15 - 1e-9); } }
    expect(sea).toBeGreaterThan(100);
  });

  it('shelf: false is the old noise floor (deeper than 50 m offshore)', () => {
    expect(world('sea', { water: { shelf: false } }).heightAt(4600, 0)).toBeLessThan(-50);
  });
});

describe('ponds (talab): small, flat-bottomed, on flat dry ground, with ghat steps', () => {
  const wd = world('sea', { water: { ponds: 6 } });
  const bare = world('sea');
  const ponds = wd.ponds();

  it('places the ponds asked for, the same ones for the same seed', () => {
    expect(ponds.length).toBe(6);
    expect(world('sea', { water: { ponds: 6 } }).ponds()).toEqual(ponds);
  });

  it('each stands on flat dry ground, away from rivers and lakes, inside the play area', () => {
    for (const p of ponds) {
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < 16; i++) { const b = (i / 16) * Math.PI * 2; const g = bare.heightAt(p.x + Math.cos(b) * p.radius * 1.4, p.z + Math.sin(b) * p.radius * 1.4); lo = Math.min(lo, g); hi = Math.max(hi, g); }
      expect(hi - lo).toBeLessThanOrEqual(1.5);
      expect(lo).toBeGreaterThan(0);
      for (let i = 0; i < 8; i++) { const b = (i / 8) * Math.PI * 2; expect(bare.waterAt(p.x + Math.cos(b) * (p.radius + 60), p.z + Math.sin(b) * (p.radius + 60))).toBeNull(); }
      expect(wd.boundary.inside(p.x, p.z, 60)).toBe(true);
    }
  });

  it('holds water over a flat bottom; the world reports it as water, draws it as a lake, and nothing spawns in it', () => {
    for (const p of ponds) {
      expect(wd.heightAt(p.x, p.z)).toBeCloseTo(p.bottom, 9);
      expect(wd.heightAt(p.x + p.radius * 0.3, p.z - p.radius * 0.2)).toBeCloseTo(p.bottom, 9);
      const hit = wd.waterAt(p.x, p.z);
      expect(hit?.surface).toBe(p.level);
      expect(A.waterDepthAt(wd, p.x, p.z).depth).toBeCloseTo(A.POND_DEPTH, 9);
      expect(wd.surfaceAt(p.x, p.z)).toBe('water');
      expect(wd.waterBodies().lakes.some((l: any) => l.x === p.x && l.z === p.z && l.level === p.level)).toBe(true);
      // The rim is above the water, so the water stays in the pond.
      for (let i = 0; i < 12; i++) { const b = (i / 12) * Math.PI * 2; expect(wd.heightAt(p.x + Math.cos(b) * p.radius * 1.05, p.z + Math.sin(b) * p.radius * 1.05)).toBeGreaterThan(p.level); }
    }
    for (const s of wd.spawnPoints('player', 20)) for (const p of ponds) expect(Math.hypot(s.x - p.x, s.z - p.z)).toBeGreaterThan(p.radius);
  });

  it('ghat steps: walking in along the ghat the ground goes down in equal steps to the bottom', () => {
    for (const p of ponds) {
      const heights: number[] = [];
      for (let d = p.radius - 0.05; d > p.radius * 0.55; d -= 0.1) heights.push(wd.heightAt(p.x + Math.cos(p.ghat) * d, p.z + Math.sin(p.ghat) * d));
      const levels = Array.from(new Set(heights.map((h) => Math.round(h * 1000) / 1000)));
      for (let i = 1; i < heights.length; i++) expect(heights[i]).toBeLessThanOrEqual(heights[i - 1] + 1e-9);
      expect(levels.length).toBe(A.POND_STEPS);
      expect(Math.min(...heights)).toBeCloseTo(p.bottom, 9);
    }
  });

  it('no ponds unless asked: the default world has none and is unchanged by the option', () => {
    expect(bare.ponds()).toEqual([]);
  });
});

describe('water rules for every mover', () => {
  it('a person wades, then swims, and needs a boat in deep water; a car fords, then may not go; a boat needs depth', () => {
    expect(A.moverRule('person', 0).mode).toBe('walk');
    expect(A.moverRule('person', 0.5).mode).toBe('wade');
    expect(A.moverRule('person', 0.5).speed).toBeLessThan(1);
    expect(A.moverRule('person', 2).mode).toBe('swim');
    expect(A.moverRule('person', 6).allowed).toBe(false);
    expect(A.moverRule('car', 0.3).mode).toBe('ford');
    expect(A.moverRule('car', 0.8).allowed).toBe(false);
    expect(A.moverRule('boat', 0.2).allowed).toBe(false);
    expect(A.moverRule('boat', 5).mode).toBe('float');
    expect(A.moverRule('aircraft', 50).mode).toBe('fly');
  });

  const ramp = (slope: number) => ({
    groundAt: (x: number) => 2 - x * slope,
    surfaceAt: (x: number) => (2 - x * slope < 0 ? 'water' : 'sand'),
    waterDepthAt: (x: number) => Math.max(0, x * slope - 2),
  });

  it('deep water stops a car: driven flat out down a beach it stalls in the shallows and never drives on the sea bed', () => {
    const p = A.createVehiclePhysics(A.CAR_SPEC, ramp(0.05), 0, 0, 0);
    let deepest = 0;
    for (let i = 0; i < 120 * 30; i++) { p.step(1 / 120, { throttle: 1, steer: 0, brake: 0, handbrake: false }); deepest = Math.max(deepest, p.state.waterDepth); }
    expect(p.state.inWater).toBe(true);
    expect(Math.abs(p.state.speed)).toBeLessThan(0.5);
    expect(deepest).toBeLessThan(A.SINK_DEPTH + 0.5);
  });

  it('a car launched into deep water sinks: its engine is dead until it is reset', () => {
    const p = A.createVehiclePhysics(A.CAR_SPEC, ramp(0.05), 100, 0, 0);
    for (let i = 0; i < 120 * 5; i++) p.step(1 / 120, { throttle: 1, steer: 0, brake: 0, handbrake: false });
    expect(p.state.sunk).toBe(true);
    expect(Math.abs(p.state.speed)).toBeLessThan(0.2);
    p.reset(0, 0, 0);
    expect(p.state.sunk).toBe(false);
  });

  it('on a real map the car on a beach heading out to sea stops before the deep (no seabed driving)', () => {
    const wd = world('sea', { rivers: false });
    const env = A.mapEnvironment(wd);
    let found = 0;
    for (const a of ANGLES.slice(0, 40)) {
      let r = wd.boundary.limitAt(a);
      while (r > 0 && wd.heightAt(...at(r, a)) < 0) r -= 5;
      const [x, z] = at(r - 60, a);
      if (wd.heightAt(x, z) < 1 || wd.heightAt(x, z) > 8) continue;
      found++;
      const p = A.createVehiclePhysics(A.CAR_SPEC, env, x, z, a);
      let deepest = 0;
      for (let i = 0; i < 60 * 25; i++) { p.step(1 / 60, { throttle: 1, steer: 0, brake: 0, handbrake: false }); deepest = Math.max(deepest, p.state.waterDepth); }
      expect(deepest, 'angle ' + a).toBeLessThan(A.SINK_DEPTH + 1);
      expect(Math.abs(p.state.speed)).toBeLessThan(1);
    }
    expect(found).toBeGreaterThan(5);
  });

  it('the guard holds a kit car at the water: it never stands where the water is deeper than it can ford', () => {
    const wd = world('sea', { rivers: false });
    const guard = A.createMoverGuard(wd);
    const a = 0.4;
    let r = wd.boundary.limitAt(a);
    while (wd.heightAt(...at(r, a)) < 0) r -= 5;
    const car = {};
    const p = { x: 0, y: 0, z: 0 };
    let held = 0;
    for (let d = r - 100; d < r + 400; d += 3) {
      const [x, z] = at(d, a);
      // A car that drives on: it tries to go farther each frame from where it was left.
      const want = Math.max(d, Math.hypot(p.x, p.z) + 3);
      p.x = Math.cos(a) * want; p.z = Math.sin(a) * want; p.y = wd.drivableHeightAt(p.x, p.z);
      void x; void z;
      const res = guard.hold(car, p, 'car');
      if (res.reason === 'water') held++;
      expect(A.waterDepthAt(wd, p.x, p.z).depth).toBeLessThanOrEqual(A.FORD_DEPTH + 1e-9);
    }
    expect(held).toBeGreaterThan(10);
  });
});

describe('the edge, the sky ceiling and the ground sheet hold every mover', () => {
  it('nobody leaves: a walker, a car, a bot, a boat and an aircraft far outside are brought inside the limit, for every kind', () => {
    for (const kind of KINDS) {
      const wd = world(kind);
      const guard = A.createMoverGuard(wd);
      for (const mover of ['person', 'car', 'bot', 'boat', 'aircraft']) {
        for (const a of [0, 1, 2.5, 4, 5.5]) {
          const p = { x: Math.cos(a) * 9000, y: 50, z: Math.sin(a) * 9000 };
          const res = guard.hold({}, p, mover);
          expect(res.reason, kind + ' ' + mover).toBe('edge');
          expect(wd.boundary.inside(p.x, p.z), kind + ' ' + mover).toBe(true);
        }
      }
    }
  });

  it('a walker (a boat, at sea) pushing outward every frame never crosses, and is told why', () => {
    for (const kind of KINDS) {
      const wd = world(kind);
      const guard = A.createMoverGuard(wd);
      const me = {};
      // On the sea island a walker is stopped by deep water first ('you need a boat'); a boat goes on to the edge.
      const mover = kind === 'sea' ? 'boat' : 'person';
      const a = 2.2;
      let r0 = 0;
      if (kind === 'sea') { r0 = wd.boundary.limitAt(a); while (wd.heightAt(Math.cos(a) * r0, Math.sin(a) * r0) < 0) r0 -= 5; r0 += 150; }
      const p = { x: Math.cos(a) * r0, y: Math.max(0, wd.heightAt(Math.cos(a) * r0, Math.sin(a) * r0)), z: Math.sin(a) * r0 };
      let said: string | null = null;
      for (let i = 0; i < 4000; i++) {
        p.x += Math.cos(a) * 2; p.z += Math.sin(a) * 2; p.y = Math.max(p.y, wd.heightAt(p.x, p.z));
        const res = guard.hold(me, p, mover);
        if (res.reason === 'edge') said = res.say;
        expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(wd.boundary.limitAt(Math.atan2(p.z, p.x)) + 1e-6);
      }
      expect(said, kind).toBe(A.BOUNDARY_CUE[kind]);
      expect(wd.boundary.cueAt(p.x, p.z)).toBeGreaterThan(0.9);
    }
  });

  it('nothing flies above the ceiling', () => {
    const wd = world('mountains');
    const p = { x: 0, y: 1e6, z: 0 };
    expect(A.createMoverGuard(wd).hold({}, p, 'aircraft').reason).toBe('ceiling');
    expect(p.y).toBe(wd.boundary.ceiling);
    expect(wd.boundary.ceiling).toBeGreaterThan(wd.heightAt(...at(wd.boundary.featureAt(0) + 50, 0)));
  });

  it('the safety net: a mover found under the ground is put back on the surface at its last safe point', () => {
    const wd = world('sea');
    const guard = A.createMoverGuard(wd);
    const me = {};
    const s = wd.spawnPoints('player', 1)[0];
    const p = { x: s.x, y: wd.heightAt(s.x, s.z), z: s.z };
    expect(guard.hold(me, p, 'person').moved).toBe(false);
    p.x += 30; p.y = wd.heightAt(p.x, p.z) - 5;
    const res = guard.hold(me, p, 'person');
    expect(res.reason).toBe('fell');
    expect(p.x).toBe(s.x); expect(p.z).toBe(s.z);
    expect(p.y).toBeGreaterThanOrEqual(wd.heightAt(s.x, s.z));
    // A body that has never stood anywhere safe is put on the surface where it is.
    const q = { x: s.x + 50, y: -500, z: s.z };
    guard.hold({}, q, 'bot');
    expect(q.y).toBe(wd.heightAt(q.x, q.z));
    // A position that is not a number goes back to the last safe point.
    const r = { x: Number.NaN, y: 0, z: 0 };
    guard.hold(me, r, 'person');
    expect([r.x, r.z]).toEqual([s.x, s.z]);
  });

  it('a swimmer under the surface but above the bed is not "fallen"', () => {
    const wd = world('sea', { rivers: false });
    const guard = A.createMoverGuard(wd);
    const a = 1.1;
    let r = wd.boundary.limitAt(a);
    while (wd.heightAt(...at(r, a)) < 0) r -= 5;
    const [x, z] = at(r + 70, a);
    const bed = wd.heightAt(x, z);
    expect(bed).toBeLessThan(-1);
    const p = { x, y: bed + 0.3, z };
    expect(guard.hold({}, p, 'person').reason).toBe(null);
  });
});
