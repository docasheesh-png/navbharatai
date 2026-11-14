import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { join } from 'path';
import { generateGamePhysics, GAME_PHYSICS_MODULES, RAPIER_PACKAGE, RAPIER_VERSION } from './GamePhysicsGenerator';

/**
 * THESE TESTS RUN THE GENERATED CODE ON THE REAL RAPIER ENGINE. The emitted modules are compiled and loaded exactly as a
 * game would hold them, and the physics is the real @dimforge/rapier3d-compat WASM — not a stand-in — so a falling body,
 * a trigger volume, a raycast and a restored snapshot are checked against what the engine actually does.
 *
 * What is NOT proven here, and the docs say so: behaviour on a physical phone or in a WebView (this is Node), and
 * determinism across devices. Rendering FPS is simulated by the frame times the tests feed in, not measured on a GPU.
 */
const files = generatePhysics();
function generatePhysics() { return generateGamePhysics().files; }

const req = createRequire(import.meta.url);
function rapierModule(): any { return req(RAPIER_PACKAGE); }

function loadAll(src: Record<string, string> = files): Record<string, Record<string, any>> {
  const cache: Record<string, Record<string, any>> = {};
  const resolve = (from: string, spec: string): string => {
    const parts = from.split('/').slice(0, -1);
    for (const seg of spec.split('/')) { if (seg === '..') parts.pop(); else if (seg !== '.') parts.push(seg); }
    return parts.join('/') + '.ts';
  };
  const load = (path: string): Record<string, any> => {
    if (cache[path]) return cache[path];
    expect(src[path], path + ' was not emitted').toBeTruthy();
    const js = ts.transpileModule(src[path], { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const exports: Record<string, any> = {};
    cache[path] = exports;
    const requireFn = (id: string): any => (id === RAPIER_PACKAGE ? rapierModule() : load(resolve(path, id)));
    // eslint-disable-next-line no-new-func
    new Function('exports', 'require', js)(exports, requireFn);
    return exports;
  };
  for (const p of Object.keys(src)) load(p);
  return cache;
}

const mods = loadAll();
const { PhysicsWorld, SNAPSHOT_VERSION } = mods['src/game/physics/world.ts'];
const { PhysicsBinding } = mods['src/game/physics/sync.ts'];
const { sanitizePhysicsConfig, validateBodySpec, interactionGroups, DEFAULT_PHYSICS, MAX_TRIANGLES } = mods['src/game/physics/config.ts'];

const realLoader = async () => { const R = rapierModule().default; await R.init(); return R; };
const make = async (cfg: Record<string, unknown> = {}, onEvent?: any) => PhysicsWorld.create(cfg, realLoader, onEvent);

const FLOOR = { id: 'floor', type: 'static', shape: { type: 'box', hx: 50, hy: 0.5, hz: 50 }, position: { x: 0, y: -0.5, z: 0 } };
const ball = (id: string, y: number, extra: Record<string, unknown> = {}) => ({ id, type: 'dynamic', shape: { type: 'sphere', radius: 0.5 }, position: { x: 0, y, z: 0 }, ...extra });
const box = (id: string, y: number, extra: Record<string, unknown> = {}) => ({ id, type: 'dynamic', shape: { type: 'box', hx: 0.5, hy: 0.5, hz: 0.5 }, position: { x: 0, y, z: 0 }, ...extra });
const run = (w: any, seconds: number, fps = 60) => { const dt = 1 / fps; let t = 0; while (t < seconds - 1e-9) { w.step(dt); t += dt; } };
const y = (w: any, id: string) => w.getTransform(id).position.y;

describe('rigid bodies fall, land and rest', () => {
  it('a body in free fall follows gravity', async () => {
    const w = await make();
    w.addBody(ball('b', 100));
    run(w, 1);
    // semi-implicit Euler at 60 Hz: within 2% of the analytic 100 - 0.5 g t^2
    const analytic = 100 - 0.5 * 9.81 * 1;
    expect(Math.abs(y(w, 'b') - analytic)).toBeLessThan(analytic * 0.02);
    w.dispose();
  });

  it('a body lands on a static floor, rests on top of it and goes to sleep', async () => {
    const w = await make();
    w.addBody(FLOOR);
    w.addBody(box('b', 5));
    run(w, 6);
    expect(y(w, 'b')).toBeGreaterThan(0.45);
    expect(y(w, 'b')).toBeLessThan(0.55);
    expect(w.isSleeping('b')).toBe(true);
    w.dispose();
  });

  it('a sphere dropped on a box stays above it', async () => {
    const w = await make();
    w.addBody({ id: 'block', type: 'static', shape: { type: 'box', hx: 2, hy: 1, hz: 2 }, position: { x: 0, y: 1, z: 0 } });
    w.addBody(ball('s', 8));
    run(w, 4);
    expect(y(w, 's')).toBeGreaterThan(2.4);
    w.dispose();
  });

  it('gravityScale 0 floats, a negative scale rises, locked translation stays put', async () => {
    const w = await make();
    // apart from each other: bodies placed on the same spot would push one another away
    w.addBody(ball('float', 10, { gravityScale: 0, position: { x: 0, y: 10, z: 0 } }));
    w.addBody(ball('rise', 10, { gravityScale: -1, position: { x: 5, y: 10, z: 0 } }));
    w.addBody(ball('pinned', 10, { lockTranslation: true, position: { x: 10, y: 10, z: 0 } }));
    run(w, 1);
    expect(y(w, 'float')).toBeCloseTo(10, 3);
    expect(y(w, 'rise')).toBeGreaterThan(10.5);
    expect(y(w, 'pinned')).toBeCloseTo(10, 3);
    w.dispose();
  });

  it('every collider shape works: box, sphere, capsule, cylinder, convex hull', async () => {
    const w = await make();
    w.addBody(FLOOR);
    const shapes: any[] = [
      { type: 'box', hx: 0.5, hy: 0.5, hz: 0.5 }, { type: 'sphere', radius: 0.5 }, { type: 'capsule', halfHeight: 0.5, radius: 0.4 },
      { type: 'cylinder', halfHeight: 0.5, radius: 0.5 },
      { type: 'convex', points: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1, -1, 0, 0] },
    ];
    shapes.forEach((shape, i) => expect(w.addBody({ id: 's' + i, type: 'dynamic', shape, position: { x: i * 3, y: 4, z: 0 } }), shape.type).toEqual({ ok: true, id: 's' + i }));
    run(w, 5);
    for (let i = 0; i < shapes.length; i++) expect(y(w, 's' + i), shapes[i].type).toBeGreaterThan(-0.2);
    w.dispose();
  });

  it('a triangle mesh works as static scenery', async () => {
    const w = await make();
    const quad = { type: 'trimesh', vertices: [-20, 0, -20, 20, 0, -20, 20, 0, 20, -20, 0, 20], indices: [0, 2, 1, 0, 3, 2] };
    expect(w.addBody({ id: 'ground', type: 'static', shape: quad, position: { x: 0, y: 0, z: 0 } }).ok).toBe(true);
    w.addBody(ball('b', 3));
    run(w, 4);
    expect(y(w, 'b')).toBeGreaterThan(0.3);
    w.dispose();
  });

  it('forces, impulses and velocity move a dynamic body, and refuse the wrong body', async () => {
    const w = await make({ gravity: { x: 0, y: 0, z: 0 } });
    w.addBody(ball('b', 0));
    w.addBody({ id: 'wall', type: 'static', shape: { type: 'box', hx: 1, hy: 1, hz: 1 }, position: { x: 50, y: 0, z: 0 } });
    expect(w.applyImpulse('b', { x: 10, y: 0, z: 0 })).toBe(true);
    run(w, 0.5);
    expect(w.linearVelocity('b').x).toBeGreaterThan(1);
    expect(w.setVelocity('b', { x: 0, y: 5, z: 0 })).toBe(true);
    expect(w.linearVelocity('b').y).toBeCloseTo(5, 3);
    expect(w.applyImpulse('wall', { x: 1, y: 0, z: 0 })).toBe(false);
    expect(w.applyImpulse('b', { x: NaN, y: 0, z: 0 })).toBe(false);
    expect(w.applyImpulse('ghost', { x: 1, y: 0, z: 0 })).toBe(false);
    w.dispose();
  });

  it('a kinematic body is moved by the game and carries what stands on it', async () => {
    const w = await make();
    w.addBody({ id: 'lift', type: 'kinematic', shape: { type: 'box', hx: 3, hy: 0.25, hz: 3 }, position: { x: 0, y: 0, z: 0 } });
    w.addBody(box('rider', 1.5, { friction: 2 }));
    run(w, 1);
    for (let i = 0; i < 120; i++) { w.moveKinematic('lift', { x: 0, y: (i + 1) * 0.02, z: 0 }); w.step(1 / 60); }
    expect(y(w, 'lift')).toBeGreaterThan(2);
    expect(y(w, 'rider')).toBeGreaterThan(2);
    expect(w.moveKinematic('rider', { x: 0, y: 0, z: 0 })).toBe(false); // only kinematic bodies are moved by the game
    expect(w.moveKinematic('lift', { x: Infinity, y: 0, z: 0 })).toBe(false);
    w.dispose();
  });
});

describe('collision filtering, triggers and events', () => {
  it('collision groups and masks decide who hits whom', async () => {
    const w = await make();
    w.addBody({ ...FLOOR, collisionGroup: 1 });
    w.addBody(ball('hits', 3, { collisionGroup: 2, collisionMask: 0b10 })); // collides with group 1
    w.addBody(ball('ghost', 3, { collisionGroup: 2, collisionMask: 0b100 })); // does not collide with group 1
    run(w, 4);
    expect(y(w, 'hits')).toBeGreaterThan(0.3);
    expect(y(w, 'ghost')).toBeLessThan(-5);
    w.dispose();
  });

  it('interaction groups pack membership and mask the way Rapier reads them', () => {
    expect(interactionGroups(0, undefined)).toBe(0x0001ffff);
    expect(interactionGroups(2, 0b10)).toBe(((1 << 2) << 16 | 0b10) >>> 0);
    expect(interactionGroups(15, 0xffff)).toBe(0x8000ffff);
  });

  it('a sensor reports entering and leaving and blocks nothing', async () => {
    const log: Array<[string, any]> = [];
    const w = await make({}, (n: string, p: any) => log.push([n, p]));
    w.addBody({ id: 'zone', type: 'static', sensor: true, shape: { type: 'box', hx: 2, hy: 2, hz: 2 }, position: { x: 0, y: 3, z: 0 } });
    w.addBody(ball('b', 8));
    run(w, 3);
    expect(w.getTransform('b').position.y).toBeLessThan(0); // fell straight through the trigger
    const names = log.map(([n]) => n);
    expect(names).toContain('sensor_entered');
    expect(names).toContain('sensor_exited');
    expect(log.find(([n]) => n === 'sensor_entered')![1]).toEqual({ sensor: 'zone', other: 'b' });
    expect(names).not.toContain('collision_started');
    w.dispose();
  });

  it('a contact reports collision_started once with both ids, and collision_stopped when apart', async () => {
    const log: Array<[string, any]> = [];
    const w = await make({}, (n: string, p: any) => log.push([n, p]));
    w.addBody(FLOOR);
    w.addBody(ball('b', 2, { restitution: 0.9 }));
    run(w, 4);
    const started = log.filter(([n]) => n === 'collision_started');
    expect(started.length).toBeGreaterThanOrEqual(1);
    expect(new Set(Object.values(started[0][1]))).toEqual(new Set(['floor', 'b']));
    expect(log.some(([n]) => n === 'collision_stopped')).toBe(true); // it bounced
    w.dispose();
  });

  it('a listener that throws, or removes a body mid-event, cannot corrupt the world', async () => {
    const w = await make({}, () => { throw new Error('boom'); });
    w.addBody(FLOOR);
    w.addBody(ball('b', 2));
    expect(() => run(w, 3)).not.toThrow();
    const w2 = await make();
    w2.addBody(FLOOR);
    w2.addBody(ball('x', 2));
    w2.on((n: string, p: any) => { if (n === 'collision_started') w2.removeBody(p.a === 'floor' ? p.b : p.a); });
    expect(() => run(w2, 3)).not.toThrow();
    expect(w2.has('x')).toBe(false);
    w.dispose(); w2.dispose();
  });
});

describe('raycasts', () => {
  it('hits the floor at the right distance, with its normal, and names the body', async () => {
    const w = await make();
    w.addBody(FLOOR);
    w.step(1 / 60);
    const hit = w.castRay({ x: 0, y: 10, z: 0 }, { x: 0, y: -1, z: 0 }, 100);
    expect(hit.id).toBe('floor');
    expect(hit.distance).toBeCloseTo(10, 3);
    expect(hit.point.y).toBeCloseTo(0, 3);
    expect(hit.normal.y).toBeCloseTo(1, 3);
    w.dispose();
  });

  it('respects the maximum distance and the mask, and refuses bad input', async () => {
    const w = await make();
    w.addBody({ ...FLOOR, collisionGroup: 3 });
    w.step(1 / 60);
    expect(w.castRay({ x: 0, y: 10, z: 0 }, { x: 0, y: -1, z: 0 }, 5)).toBeNull();
    expect(w.castRay({ x: 0, y: 10, z: 0 }, { x: 0, y: -1, z: 0 }, 100, 0b1)).toBeNull(); // group 3 is not in the mask
    expect(w.castRay({ x: 0, y: 10, z: 0 }, { x: 0, y: -1, z: 0 }, 100, 0b1000)).not.toBeNull();
    for (const bad of [[{ x: NaN, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }, 5], [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 5], [{ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }, -1], [{ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }, NaN]]) {
      expect(w.castRay(...(bad as [any, any, number]))).toBeNull();
    }
    w.dispose();
  });
});

describe('the fixed timestep — the same physics at any frame rate', () => {
  const fall = async (fps: number, seconds = 2) => { const w = await make(); w.addBody(ball('b', 100)); run(w, seconds, fps); const out = { y: y(w, 'b'), steps: w.stats().steps }; w.dispose(); return out; };

  it('30, 60 and 144 fps agree on where a falling body is, within one step', async () => {
    const a = await fall(30); const b = await fall(60); const c = await fall(144);
    for (const r of [a, b, c]) expect(Math.abs(r.steps - 120)).toBeLessThanOrEqual(1);
    expect(Math.abs(a.y - b.y)).toBeLessThan(0.2);
    expect(Math.abs(c.y - b.y)).toBeLessThan(0.2);
  });

  it('uneven frame times give the same result as even ones', async () => {
    const w = await make(); w.addBody(ball('b', 100));
    const frames = [0.004, 0.031, 0.016, 0.009, 0.05, 0.002, 0.016, 0.02];
    let total = 0; let i = 0;
    while (total < 2) { const f = frames[i++ % frames.length]; w.step(f); total += f; }
    // the same NUMBER of fixed steps, fed evenly, lands in exactly the same place: the frame times did not matter
    const steps = w.stats().steps;
    const even = await make(); even.addBody(ball('b', 100));
    for (let k = 0; k < steps; k++) even.step(1 / 60);
    expect(even.stats().steps).toBe(steps);
    expect(y(w, 'b')).toBeCloseTo(y(even, 'b'), 9);
    even.dispose(); w.dispose();
  });

  it('a frame is clamped, catch-up is bounded, and the dropped time is counted and announced', async () => {
    const log: Array<[string, any]> = [];
    const w = await make({ maxStepsPerFrame: 3 }, (n: string, p: any) => log.push([n, p]));
    w.addBody(ball('b', 100));
    const steps = w.step(10); // a tab that slept for ten seconds
    expect(steps).toBeLessThanOrEqual(3);
    expect(w.stats().droppedSeconds).toBeGreaterThan(9);
    const lag = w.step(0.2); // 12 steps due, 3 allowed
    expect(lag).toBe(3);
    expect(log.some(([n]) => n === 'lagging')).toBe(true);
    expect(w.stats().simSeconds).toBeLessThan(0.5);
    w.dispose();
  });

  it('a long frame is CLAMPED to maxFrameDelta before it is simulated, not merely capped by the step limit', async () => {
    const w = await make({ maxStepsPerFrame: 20, maxFrameDelta: 0.1 });
    w.addBody(ball('b', 100));
    // one second of frame time, but only 0.1 s may be simulated: 6 steps at 1/60, though 20 would be allowed
    expect(w.step(1)).toBe(6);
    expect(w.stats().droppedSeconds).toBeCloseTo(0.9, 6);
    w.dispose();
  });

  it('ignores a NaN, negative or zero frame time', async () => {
    const w = await make(); w.addBody(ball('b', 10));
    for (const bad of [NaN, -1, 0, Infinity, -Infinity, undefined as any, '1' as any, null as any]) expect(w.step(bad)).toBe(0);
    expect(w.stats().steps).toBe(0);
    w.dispose();
  });

  it('interpolation blends the previous and current states by the leftover fraction', async () => {
    const w = await make({ gravity: { x: 0, y: 0, z: 0 } });
    w.addBody(ball('b', 0));
    w.setVelocity('b', { x: 60, y: 0, z: 0 }); // one metre per step
    w.step(1 / 60 + 0.25 / 60); // one full step and a quarter of the next
    const cur = w.getTransform('b').position.x;
    const drawn = w.getInterpolated('b').position.x;
    expect(w.alpha).toBeCloseTo(0.25, 2);
    expect(cur - drawn).toBeCloseTo(0.75, 1); // drawn = prev + 0.25 * (cur - prev)
    expect(drawn).toBeGreaterThan(0);
    expect(drawn).toBeLessThan(cur);
    w.dispose();
  });

  it('the binding writes interpolated transforms and drops bodies that are gone', async () => {
    const w = await make({ gravity: { x: 0, y: 0, z: 0 } });
    w.addBody(ball('b', 0));
    w.setVelocity('b', { x: 60, y: 0, z: 0 });
    w.step(1.5 / 60);
    const obj = { position: { x: -1, y: -1, z: -1 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } };
    const binding = new PhysicsBinding();
    binding.bind('b', obj); binding.bind('ghost', { position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } });
    expect(binding.sync(w)).toBe(1);
    expect(binding.size).toBe(1);
    expect(obj.position.x).toBeCloseTo(w.getInterpolated('b').position.x, 6);
    expect(Math.hypot(obj.quaternion.x, obj.quaternion.y, obj.quaternion.z, obj.quaternion.w)).toBeCloseTo(1, 6);
    w.dispose();
  });
});

describe('pause, resume, reset and snapshots', () => {
  it('pause freezes the simulation and resume continues it', async () => {
    const w = await make(); w.addBody(ball('b', 50));
    run(w, 0.5);
    const frozen = y(w, 'b');
    w.pause();
    expect(w.step(1)).toBe(0);
    expect(y(w, 'b')).toBe(frozen);
    expect(w.stats().paused).toBe(true);
    w.resume();
    run(w, 0.5);
    expect(y(w, 'b')).toBeLessThan(frozen);
    w.dispose();
  });

  it('reset removes every body and starts fresh with the same config', async () => {
    const w = await make({ gravity: { x: 0, y: -3, z: 0 } });
    w.addBody(FLOOR); w.addBody(ball('b', 5));
    run(w, 1);
    w.reset();
    expect(w.ids()).toEqual([]);
    expect(w.stats()).toMatchObject({ bodies: 0, colliders: 0, steps: 0, simSeconds: 0, droppedSeconds: 0 });
    expect(w.addBody(ball('b', 5)).ok).toBe(true); // the id is free again
    run(w, 1);
    expect(y(w, 'b')).toBeCloseTo(5 - 0.5 * 3, 0);
    w.dispose();
  });

  it('a snapshot restores the world exactly: running on from it gives the same result as running on without it', async () => {
    const w = await make();
    w.addBody(FLOOR);
    for (let i = 0; i < 5; i++) w.addBody(box('c' + i, 3 + i * 1.2, { restitution: 0.3 }));
    run(w, 1);
    const snap = w.snapshot();
    expect(snap.v).toBe(SNAPSHOT_VERSION);
    run(w, 1.5);
    const after = w.ids().map((id: string) => w.getTransform(id).position.y);
    expect(w.restore(snap)).toEqual({ ok: true });
    run(w, 1.5);
    const again = w.ids().map((id: string) => w.getTransform(id).position.y);
    again.forEach((v: number, i: number) => expect(v).toBeCloseTo(after[i], 9));
    expect(w.has('c3')).toBe(true);
    expect(w.castRay({ x: 0, y: 20, z: 0 }, { x: 0, y: -1, z: 0 }, 50)).not.toBeNull();
    w.dispose();
  });

  it('a bad snapshot is refused with a reason and the current world is untouched', async () => {
    const w = await make();
    w.addBody(FLOOR); w.addBody(ball('b', 5));
    run(w, 0.5);
    const before = y(w, 'b');
    const snap = w.snapshot();
    for (const bad of [null, {}, { ...snap, v: 99 }, { ...snap, state: [1, 2, 3] }, { ...snap, state: new Uint8Array([1, 2, 3]) }, { ...snap, handles: [] }, { ...snap, specs: [...snap.specs, { ...snap.specs[1], id: 'ghost' }] }]) {
      const r = w.restore(bad);
      expect(r.ok, JSON.stringify(Object.keys(bad ?? {}))).toBe(false);
      expect(typeof r.reason).toBe('string');
    }
    expect(y(w, 'b')).toBe(before);
    expect(w.has('b')).toBe(true);
    run(w, 0.5);
    expect(y(w, 'b')).toBeLessThan(before);
    w.dispose();
  });

  it('refuses a snapshot with more bodies than the limit', async () => {
    const big = await make({ maxBodies: 50 });
    for (let i = 0; i < 30; i++) big.addBody(ball('b' + i, i + 2));
    const snap = big.snapshot();
    const small = await make({ maxBodies: 10 });
    expect(small.restore(snap).ok).toBe(false);
    big.dispose(); small.dispose();
  });
});

describe('limits, validation and the world never reaching native code with bad input', () => {
  it('sanitises every config number and drops unknown keys', () => {
    const c = sanitizePhysicsConfig({ gravity: { x: 1e9, y: NaN, z: -1e9 }, timestep: 5, maxStepsPerFrame: 1e6, maxFrameDelta: -1, solverIterations: 0, maxBodies: 1e9, maxColliders: -3, maxJoints: 1e9, worldBounds: 0, debug: 'yes', evil: true });
    expect(c.gravity).toEqual({ x: 100, y: DEFAULT_PHYSICS.gravity.y, z: -100 });
    expect(c.timestep).toBe(1 / 20);
    expect(c.maxStepsPerFrame).toBe(20);
    expect(c.maxFrameDelta).toBe(0.01);
    expect(c.solverIterations).toBe(1);
    expect(c.maxBodies).toBe(5000);
    expect(c.maxColliders).toBe(1);
    expect(c.maxJoints).toBe(1000);
    expect(c.worldBounds).toBe(10);
    expect(c.debug).toBe(false);
    expect('evil' in c).toBe(false);
    expect(sanitizePhysicsConfig(null)).toEqual(DEFAULT_PHYSICS);
    expect(sanitizePhysicsConfig('x')).toEqual(DEFAULT_PHYSICS);
  });

  it('refuses a bad body with a reason — NaN, negatives, huge sizes, bad ids, bad masks — and adds nothing', async () => {
    const w = await make();
    const bad: any[] = [
      null, 'x', {}, ball('', 1), ball('a'.repeat(200), 1), { ...ball('t', 1), type: 'wobbly' },
      { ...ball('n', 1), position: { x: NaN, y: 0, z: 0 } }, { ...ball('far', 1), position: { x: 1e9, y: 0, z: 0 } },
      { ...ball('neg', 1), shape: { type: 'sphere', radius: -1 } }, { ...ball('huge', 1), shape: { type: 'sphere', radius: 1e9 } },
      { ...ball('m', 1), mass: -5 }, { ...ball('both', 1), mass: 1, density: 1 }, { ...ball('f', 1), friction: 99 }, { ...ball('r', 1), restitution: 2 },
      { ...ball('g', 1), collisionGroup: 16 }, { ...ball('k', 1), collisionMask: 0x10000 }, { ...ball('q', 1), rotation: { x: 0, y: 0, z: 0, w: 5 } },
      { ...ball('s', 1), shape: { type: 'mystery' } }, { ...ball('c', 1), shape: { type: 'convex', points: [1, 2, 3] } },
      { id: 'dyn-mesh', type: 'dynamic', position: { x: 0, y: 0, z: 0 }, shape: { type: 'trimesh', vertices: [0, 0, 0, 1, 0, 0, 0, 0, 1], indices: [0, 1, 2] } },
      { id: 'bad-idx', type: 'static', position: { x: 0, y: 0, z: 0 }, shape: { type: 'trimesh', vertices: [0, 0, 0, 1, 0, 0, 0, 0, 1], indices: [0, 1, 7] } },
    ];
    for (const spec of bad) { const r = w.addBody(spec); expect(r.ok, JSON.stringify(spec)?.slice(0, 80)).toBe(false); expect(String(r.reason).length).toBeGreaterThan(5); }
    expect(w.stats().bodies).toBe(0);
    expect(w.stats().colliders).toBe(0);
    w.dispose();
  });

  it('a dynamic triangle mesh is refused with the advice to use a simple shape', () => {
    const msg = validateBodySpec({ id: 'x', type: 'dynamic', position: { x: 0, y: 0, z: 0 }, shape: { type: 'trimesh', vertices: [0, 0, 0, 1, 0, 0, 0, 0, 1], indices: [0, 1, 2] } }, DEFAULT_PHYSICS);
    expect(msg).toContain('static');
    expect(msg).toContain('convex hull');
  });

  it('a mesh over the triangle limit is refused', () => {
    const tris = MAX_TRIANGLES + 1;
    const vertices = Array.from({ length: 9 }, () => 0);
    const indices = Array.from({ length: tris * 3 }, (_, i) => i % 3);
    expect(validateBodySpec({ id: 'x', type: 'static', position: { x: 0, y: 0, z: 0 }, shape: { type: 'trimesh', vertices, indices } }, DEFAULT_PHYSICS)).toContain('triangles');
  });

  it('refuses a duplicate id and stops at the body limit, then accepts again after a removal', async () => {
    const w = await make({ maxBodies: 5 });
    for (let i = 0; i < 5; i++) expect(w.addBody(ball('b' + i, i + 2)).ok).toBe(true);
    expect(w.addBody(ball('b0', 20))).toMatchObject({ ok: false });
    expect(w.addBody(ball('extra', 20))).toMatchObject({ ok: false });
    expect(w.addBody(ball('extra', 20)).reason).toContain('limit of 5');
    expect(w.removeBody('b2')).toBe(true);
    expect(w.removeBody('b2')).toBe(false);
    expect(w.addBody(ball('extra', 20)).ok).toBe(true);
    w.dispose();
  });

  it('stops at the collider limit', async () => {
    const w = await make({ maxColliders: 3 });
    for (let i = 0; i < 3; i++) w.addBody(ball('b' + i, i + 2));
    expect(w.addBody(ball('x', 9)).reason).toContain('collider limit');
    w.dispose();
  });

  it('a body at the edge of the world bounds is accepted, one beyond is not', async () => {
    const w = await make({ worldBounds: 100 });
    expect(w.addBody({ ...ball('in', 0), position: { x: 99, y: 0, z: 0 } }).ok).toBe(true);
    expect(w.addBody({ ...ball('out', 0), position: { x: 101, y: 0, z: 0 } }).ok).toBe(false);
    w.dispose();
  });
});

describe('memory lifecycle and failure', () => {
  it('adding and removing a thousand bodies leaves nothing behind', async () => {
    const w = await make();
    for (let round = 0; round < 10; round++) {
      for (let i = 0; i < 100; i++) expect(w.addBody(ball('b' + i, 5 + i * 0.01, { position: { x: i * 2, y: 5, z: 0 } })).ok).toBe(true);
      expect(w.stats().bodies).toBe(100);
      run(w, 0.1);
      for (let i = 0; i < 100; i++) w.removeBody('b' + i);
      expect(w.stats()).toMatchObject({ bodies: 0, colliders: 0 });
      expect(w.ids()).toEqual([]);
      // the bookkeeping maps are emptied too, not only the native world
      expect((w as any).colliderOwner.size).toBe(0);
      expect((w as any).sensorColliders.size).toBe(0);
    }
    w.dispose();
  });

  it('a disposed world is a safe no-op and says so', async () => {
    const w = await make();
    w.addBody(ball('b', 5));
    w.dispose();
    w.dispose();
    expect(w.available).toBe(false);
    expect(w.reason).toContain('disposed');
    expect(w.step(1)).toBe(0);
    expect(w.addBody(ball('c', 5))).toMatchObject({ ok: false });
    expect(w.castRay({ x: 0, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }, 10)).toBeNull();
    expect(w.snapshot()).toBeNull();
    expect(w.getTransform('b')).toBeNull();
    expect(() => { w.reset(); w.pause(); w.resume(); w.removeBody('b'); }).not.toThrow();
  });

  it('WASM INITIALISATION FAILURE: create() does not throw, the world is unavailable with a reason, and every call is safe', async () => {
    const log: Array<[string, any]> = [];
    const w = await PhysicsWorld.create({}, async () => { throw new Error('wasm blocked'); }, (n: string, p: any) => log.push([n, p]));
    expect(w.available).toBe(false);
    expect(w.reason).toContain('wasm blocked');
    expect(log[0][0]).toBe('unavailable');
    expect(w.addBody(ball('b', 5))).toEqual({ ok: false, reason: w.reason });
    expect(w.step(1)).toBe(0);
    expect(w.castRay({ x: 0, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }, 10)).toBeNull();
    expect(w.snapshot()).toBeNull();
    expect(w.restore({} as any).ok).toBe(false);
    expect(w.debugLines()).toBeNull();
    expect(w.stats()).toMatchObject({ available: false, bodies: 0 });
    expect(() => { w.reset(); w.dispose(); }).not.toThrow();
  });

  it('a module that loads but is not Rapier is refused', async () => {
    const w = await PhysicsWorld.create({}, async () => ({}) as any);
    expect(w.available).toBe(false);
    expect(w.reason).toContain('not the expected module');
  });

  it('the debug view is OFF unless asked for, and then returns real line data', async () => {
    const off = await make();
    off.addBody(FLOOR);
    expect(off.debugLines()).toBeNull();
    const on = await make({ debug: true });
    on.addBody(FLOOR); on.addBody(ball('b', 3));
    on.step(1 / 60);
    const lines = on.debugLines();
    expect(lines.vertices.length).toBeGreaterThan(0);
    expect(lines.vertices.length % 3).toBe(0);
    expect(lines.colors.length % 4).toBe(0);
    off.dispose(); on.dispose();
  });

  it('measures the step: a 200-body pile steps well inside a frame budget', async () => {
    const w = await make({ maxBodies: 300 });
    w.addBody(FLOOR);
    for (let i = 0; i < 200; i++) w.addBody(box('c' + i, 1 + (i % 10) * 1.1, { position: { x: (i % 5) * 1.2 - 2.4, y: 1 + Math.floor(i / 5) * 1.1, z: 0 } }));
    run(w, 3);
    const s = w.stats();
    expect(s.bodies).toBe(201);
    expect(Number.isFinite(s.stepMs)).toBe(true);
    expect(s.stepMs).toBeLessThan(33); // catastrophe guard only: the real figure for the docs is s.stepMs, measured on this machine
    w.dispose();
  });
});


// ---- the character controller (stage B) -------------------------------------------------------------------------
const HERO = (extra: Record<string, unknown> = {}) => ({ id: 'hero', position: { x: 0, y: 1.3, z: 0 }, ...extra });
const quatZ = (deg: number) => ({ x: 0, y: 0, z: Math.sin((deg * Math.PI) / 360), w: Math.cos((deg * Math.PI) / 360) });
/** A static ramp whose top surface starts flush with the floor at x = startX and rises (or falls) by angleDeg. */
const ramp = (id: string, startX: number, angleDeg: number, hx = 12) => {
  const th = (angleDeg * Math.PI) / 180; const hy = 0.1;
  return { id, type: 'static', shape: { type: 'box', hx, hy, hz: 6 }, rotation: quatZ(angleDeg),
    position: { x: startX + hx * Math.cos(th) + hy * Math.sin(th), y: hx * Math.sin(th) - hy * Math.cos(th), z: 0 } };
};
const stepsOf = (w: any, seconds: number, each?: (i: number) => void, fps = 60) => { const n = Math.round(seconds * fps); for (let i = 0; i < n; i++) { each?.(i); w.step(1 / fps); } };
const hero = (w: any) => w.character('hero');
const pos = (w: any) => hero(w).state().position;

describe('character: falling, landing and standing', () => {
  it('falls, lands on the floor, stands there, and says it landed with how fast it was falling', async () => {
    const log: Array<[string, any]> = [];
    const w = await make({}, (n: string, p: any) => log.push([n, p]));
    w.addBody(FLOOR);
    expect(w.addCharacter(HERO({ position: { x: 0, y: 4, z: 0 } }))).toEqual({ ok: true, id: 'hero' });
    stepsOf(w, 2);
    const s = hero(w).state();
    expect(s.grounded).toBe(true);
    expect(s.position.y).toBeGreaterThan(0.88); // feet 0.9 below the centre, plus the skin
    expect(s.position.y).toBeLessThan(1.0);
    expect(s.groundId).toBe('floor');
    const landed = log.filter(([n]) => n === 'character_landed');
    expect(landed.length).toBe(1);
    expect(landed[0][1].id).toBe('hero');
    expect(landed[0][1].speed).toBeGreaterThan(4);
    w.dispose();
  });

  it('standing still it stays put and stays grounded, step after step', async () => {
    const w = await make();
    w.addBody(FLOOR); w.addCharacter(HERO());
    stepsOf(w, 1);
    const y0 = pos(w).y;
    let groundedSteps = 0;
    stepsOf(w, 3, () => { w.step(0); }); // no-ops
    for (let i = 0; i < 180; i++) { w.step(1 / 60); if (hero(w).grounded) groundedSteps++; }
    expect(groundedSteps).toBe(180);
    expect(Math.abs(pos(w).y - y0)).toBeLessThan(0.005);
    expect(Math.hypot(pos(w).x, pos(w).z)).toBeLessThan(0.01);
    w.dispose();
  });

  it('a character standing and walking does NOT flood the game with collision events (its contacts flicker); sensors are still reported', async () => {
    const log: Array<[string, any]> = [];
    const w = await make({}, (n: string, p: any) => log.push([n, p]));
    w.addBody(FLOOR); w.addCharacter(HERO());
    stepsOf(w, 3);
    hero(w).setMove(3, 0); stepsOf(w, 3);
    expect(log.filter(([n]) => n === 'collision_started' || n === 'collision_stopped')).toEqual([]);
    expect(log.some(([n]) => n === 'character_landed')).toBe(true);
    w.dispose();
  });

  it('is a kinematic body in the world: it counts as a body and a collider, and interpolates like one', async () => {
    const w = await make();
    w.addBody(FLOOR); w.addCharacter(HERO());
    expect(w.stats()).toMatchObject({ bodies: 2, colliders: 2, characters: 1 });
    stepsOf(w, 1);
    hero(w).setMove(6, 0);
    w.step(1 / 60 + 0.5 / 60);
    const cur = w.getTransform('hero').position.x; const drawn = w.getInterpolated('hero').position.x;
    expect(drawn).toBeLessThan(cur);
    expect(drawn).toBeGreaterThan(0);
    w.dispose();
  });
});

describe('character: walking', () => {
  it('walks at the speed the game asks for, and stops when it stops asking', async () => {
    const w = await make();
    w.addBody(FLOOR); w.addCharacter(HERO());
    stepsOf(w, 1);
    const x0 = pos(w).x;
    hero(w).setMove(3, 0);
    stepsOf(w, 2);
    const walked = pos(w).x - x0;
    // 3 m/s for 2 s, minus the brief acceleration (3 squared over twice 40 = 0.1125 m): 5.8875 m. Tight on purpose — a controller
    // that loses even one step in thirty (as one that leans on gravity while standing does) falls below it.
    expect(walked).toBeGreaterThan(5.85); expect(walked).toBeLessThan(5.93);
    expect(hero(w).state().speed).toBeCloseTo(3, 1);
    hero(w).setMove(0, 0);
    stepsOf(w, 0.4);
    expect(hero(w).state().speed).toBeLessThan(0.01);
    w.dispose();
  });

  it('is stopped by a wall and does not pass through it, however long it walks', async () => {
    const w = await make();
    w.addBody(FLOOR);
    w.addBody({ id: 'wall', type: 'static', shape: { type: 'box', hx: 0.5, hy: 2, hz: 10 }, position: { x: 5, y: 2, z: 0 } });
    w.addCharacter(HERO());
    stepsOf(w, 1);
    hero(w).setMove(5, 0);
    stepsOf(w, 6);
    expect(pos(w).x).toBeLessThan(4.5 - 0.35 + 0.01);
    expect(pos(w).x).toBeGreaterThan(3.9);
    expect(hero(w).state().speed).toBeLessThan(0.2);
    w.dispose();
  });

  it('slides ALONG a wall when it walks into it at an angle', async () => {
    const w = await make();
    w.addBody(FLOOR);
    w.addBody({ id: 'wall', type: 'static', shape: { type: 'box', hx: 0.5, hy: 2, hz: 20 }, position: { x: 4, y: 2, z: 0 } });
    w.addCharacter(HERO());
    stepsOf(w, 1);
    hero(w).setMove(3, 3);
    stepsOf(w, 3);
    expect(pos(w).x).toBeLessThan(3.5 - 0.35 + 0.01);
    expect(pos(w).z).toBeGreaterThan(4); // it kept going along the wall
    w.dispose();
  });

  it('never gains speed from a non-finite or huge request', async () => {
    const w = await make();
    w.addBody(FLOOR); w.addCharacter(HERO());
    expect(hero(w).setMove(NaN, 0)).toBe(false);
    expect(hero(w).setMove(0, Infinity)).toBe(false);
    expect(hero(w).setMove(1e9, 0)).toBe(true);
    stepsOf(w, 1);
    expect(hero(w).state().speed).toBeLessThanOrEqual(100.0001);
    w.dispose();
  });
});

describe('character: jumping', () => {
  const apex = async (extra: Record<string, unknown> = {}, cfg: Record<string, unknown> = {}, fps = 60) => {
    const w = await make(cfg);
    w.addBody(FLOOR); w.addCharacter(HERO(extra));
    stepsOf(w, 1, undefined, fps);
    const y0 = pos(w).y; let top = y0; let jumped = 0;
    w.on((n: string) => { if (n === 'character_jumped') jumped++; });
    hero(w).jump();
    stepsOf(w, 2, () => { top = Math.max(top, pos(w).y); }, fps);
    const out = { rise: top - y0, jumped, grounded: hero(w).grounded };
    w.dispose();
    return out;
  };

  it('is not "grounded" while it is rising: the ground snap must not pull a jump back down', async () => {
    const w = await make();
    w.addBody(FLOOR); w.addCharacter(HERO());
    stepsOf(w, 1);
    const y0 = pos(w).y;
    hero(w).jump();
    let risingGrounded = 0; let risingSteps = 0;
    for (let i = 0; i < 40; i++) {
      w.step(1 / 60);
      const s = hero(w).state();
      if (s.velocity.y > 0.5 && s.position.y > y0 + 0.15) { risingSteps++; if (s.grounded) risingGrounded++; }
    }
    expect(risingSteps).toBeGreaterThan(20);
    expect(risingGrounded).toBe(0);
    w.dispose();
  });

  it('jumps to the height physics says — v squared over 2 g — and lands again', async () => {
    const r = await apex();
    expect(r.jumped).toBe(1);
    expect(r.rise).toBeGreaterThan(2.0); expect(r.rise).toBeLessThan(2.25); // 6.5^2 / (2 * 9.81) = 2.15
    expect(r.grounded).toBe(true);
  });

  it('a stronger jump goes higher, and a lower gravity scale goes higher still', async () => {
    const base = await apex();
    const strong = await apex({ jumpSpeed: 9 });
    const floaty = await apex({ gravityScale: 0.5 });
    expect(strong.rise).toBeGreaterThan(base.rise * 1.7);
    expect(floaty.rise).toBeGreaterThan(base.rise * 1.8);
  });

  it('the jump is the same height at 30, 60 and 144 fps', async () => {
    const a = await apex({}, {}, 30); const b = await apex({}, {}, 60); const c = await apex({}, {}, 144);
    expect(Math.abs(a.rise - b.rise)).toBeLessThan(0.12);
    expect(Math.abs(c.rise - b.rise)).toBeLessThan(0.12);
  });

  it('there is no double jump: a press in mid-air does nothing', async () => {
    const w = await make();
    w.addBody(FLOOR); w.addCharacter(HERO());
    stepsOf(w, 1);
    const y0 = pos(w).y; let top = y0; let jumped = 0;
    w.on((n: string) => { if (n === 'character_jumped') jumped++; });
    hero(w).jump();
    stepsOf(w, 2, (i) => { top = Math.max(top, pos(w).y); if (i === 24) hero(w).jump(); }); // at 0.4 s, still rising
    expect(jumped).toBe(1);
    expect(top - y0).toBeLessThan(2.25);
    w.dispose();
  });

  it('COYOTE TIME: a jump just after walking off a ledge still works, one long after does not', async () => {
    const setup = async () => {
      const w = await make();
      w.addBody({ id: 'ledge', type: 'static', shape: { type: 'box', hx: 5, hy: 0.5, hz: 5 }, position: { x: 0, y: -0.5, z: 0 } });
      w.addCharacter(HERO({ coyoteTime: 0.15 }));
      stepsOf(w, 1);
      hero(w).setMove(3, 0);
      let guard = 0;
      while (hero(w).grounded && guard++ < 600) w.step(1 / 60);
      return w;
    };
    const quick = await setup();
    let jumps = 0; quick.on((n: string) => { if (n === 'character_jumped') jumps++; });
    stepsOf(quick, 0.05);
    hero(quick).jump(); stepsOf(quick, 0.1);
    expect(jumps).toBe(1);
    const late = await setup();
    let lateJumps = 0; late.on((n: string) => { if (n === 'character_jumped') lateJumps++; });
    stepsOf(late, 0.5);
    hero(late).jump(); stepsOf(late, 0.1);
    expect(lateJumps).toBe(0);
    quick.dispose(); late.dispose();
  });

  it('JUMP BUFFER: a jump pressed just before landing happens on landing, one pressed long before does not', async () => {
    const run = async (earlyBySeconds: number) => {
      const w = await make();
      w.addBody(FLOOR);
      w.addCharacter(HERO({ position: { x: 0, y: 3, z: 0 }, jumpBuffer: 0.12 }));
      let jumps = 0; w.on((n: string) => { if (n === 'character_jumped') jumps++; });
      let pressed = false; let steps = 0;
      while (!hero(w).grounded && steps++ < 600) {
        const s = hero(w).state();
        // how long until it lands, from height and fall speed (distance to the feet's floor)
        const h = s.position.y - 0.9; const v = -s.velocity.y;
        const t = (-v + Math.sqrt(v * v + 2 * 9.81 * Math.max(0, h))) / 9.81;
        if (!pressed && t <= earlyBySeconds) { hero(w).jump(); pressed = true; }
        w.step(1 / 60);
      }
      stepsOf(w, 0.3);
      w.dispose();
      return jumps;
    };
    expect(await run(0.06)).toBe(1);
    expect(await run(0.5)).toBe(0);
  });

  it('hitting a ceiling stops the rise at once: it starts falling instead of sticking to it', async () => {
    const airtime = async (withCeiling: boolean) => {
      const w = await make();
      w.addBody(FLOOR);
      if (withCeiling) w.addBody({ id: 'ceiling', type: 'static', shape: { type: 'box', hx: 5, hy: 0.5, hz: 5 }, position: { x: 0, y: 2.55, z: 0 } }); // underside at 2.05
      w.addCharacter(HERO());
      stepsOf(w, 1);
      hero(w).jump();
      let steps = 0; let top = 0;
      do { w.step(1 / 60); steps++; top = Math.max(top, pos(w).y); } while (!hero(w).grounded && steps < 300 || steps < 3);
      w.dispose();
      return { seconds: steps / 60, top };
    };
    const free = await airtime(false); const low = await airtime(true);
    expect(free.seconds).toBeGreaterThan(1.2); // a normal jump hangs for about 1.3 s
    expect(low.top).toBeLessThan(2.05 - 0.9 + 0.02); // the head stopped at the underside
    expect(low.seconds).toBeLessThan(0.5); // and it came straight back down (about 0.3 s; sticking to the ceiling takes about 0.85 s)
  });

  it('a fall is limited to maxFallSpeed', async () => {
    const w = await make();
    w.addBody(FLOOR);
    w.addCharacter(HERO({ position: { x: 0, y: 300, z: 0 }, maxFallSpeed: 25 }));
    let fastest = 0;
    stepsOf(w, 8, () => { fastest = Math.max(fastest, -hero(w).state().velocity.y); });
    expect(fastest).toBeLessThanOrEqual(25.001);
    expect(fastest).toBeGreaterThan(24);
    w.dispose();
  });

  it('announces a jump with its id', async () => {
    const log: Array<[string, any]> = [];
    const w = await make({}, (n: string, p: any) => log.push([n, p]));
    w.addBody(FLOOR); w.addCharacter(HERO());
    stepsOf(w, 1); hero(w).jump(); stepsOf(w, 0.2);
    expect(log.find(([n]) => n === 'character_jumped')![1]).toEqual({ id: 'hero' });
    w.dispose();
  });
});

describe('character: slopes, steps and the ground', () => {
  const walkOnto = async (rampDeg: number, seconds = 3, extra: Record<string, unknown> = {}) => {
    const w = await make();
    w.addBody(FLOOR);
    w.addBody(ramp('ramp', 3, rampDeg));
    w.addCharacter(HERO(extra));
    stepsOf(w, 1);
    hero(w).setMove(3, 0);
    stepsOf(w, seconds);
    const out = { ...pos(w), grounded: hero(w).grounded };
    w.dispose();
    return out;
  };

  it('walks UP a gentle slope', async () => {
    const r = await walkOnto(30);
    expect(r.y).toBeGreaterThan(2.0); // climbed well above the floor
    expect(r.grounded).toBe(true);
  });

  it('is stopped by a slope steeper than its limit', async () => {
    const r = await walkOnto(65);
    expect(r.x).toBeLessThan(3 + 0.9); // it stopped at the foot of it
    expect(r.y).toBeLessThan(1.3);
  });

  it('the limit is the spec\'s: a character allowed to climb 70 degrees climbs a 65 degree slope', async () => {
    const r = await walkOnto(65, 3, { maxSlopeClimbDeg: 75, minSlopeSlideDeg: 80 });
    expect(r.y).toBeGreaterThan(2);
  });

  it('steps up onto a low ledge by itself, and is stopped by a high one', async () => {
    const run = async (height: number) => {
      const w = await make();
      w.addBody(FLOOR);
      w.addBody({ id: 'step', type: 'static', shape: { type: 'box', hx: 5, hy: height / 2, hz: 5 }, position: { x: 8, y: height / 2, z: 0 } });
      w.addCharacter(HERO());
      stepsOf(w, 1);
      hero(w).setMove(3, 0);
      stepsOf(w, 4);
      const out = pos(w); w.dispose(); return out;
    };
    const low = await run(0.25); const high = await run(0.7);
    expect(low.x).toBeGreaterThan(8); expect(low.y).toBeGreaterThan(1.1); // on top of it
    expect(high.x).toBeLessThan(3 + 0.35 + 4.5); expect(high.y).toBeLessThan(1.0); // still on the floor, in front of it
  });

  it('follows the ground DOWN a small drop instead of falling off it — because snap-to-ground is on', async () => {
    const run = async (snap: number) => {
      const w = await make();
      // a raised floor (top at y = 0.2) that ends at x = 3, with the real floor (top at y = 0) beyond it
      w.addBody({ id: 'low', type: 'static', shape: { type: 'box', hx: 50, hy: 0.5, hz: 50 }, position: { x: 0, y: -0.5, z: 0 } });
      w.addBody({ id: 'raised', type: 'static', shape: { type: 'box', hx: 3, hy: 0.1, hz: 50 }, position: { x: 0, y: 0.1, z: 0 } });
      w.addCharacter(HERO({ position: { x: -2, y: 1.5, z: 0 }, snapToGround: snap, autostepHeight: 0.3 }));
      stepsOf(w, 2);
      hero(w).setMove(3, 0);
      let airborne = 0;
      for (let i = 0; i < 150; i++) { w.step(1 / 60); if (pos(w).x > 2.6 && pos(w).x < 5 && !hero(w).grounded) airborne++; }
      const end = pos(w); w.dispose();
      return { airborne, x: end.x, y: end.y };
    };
    const snapped = await run(0.3);
    const loose = await run(0);
    expect(snapped.x).toBeGreaterThan(5); // it did walk off the raised floor
    expect(snapped.airborne).toBe(0); // and never left the ground doing it
    expect(loose.airborne).toBeGreaterThan(0); // without snapping it dropped
    expect(snapped.y).toBeLessThan(1.0);
  });

  it('is CARRIED by a moving platform it stands on, and knows what it stands on', async () => {
    const w = await make();
    w.addBody({ id: 'lift', type: 'kinematic', shape: { type: 'box', hx: 4, hy: 0.25, hz: 4 }, position: { x: 0, y: -0.25, z: 0 } });
    w.addCharacter(HERO());
    stepsOf(w, 1);
    expect(hero(w).state().groundId).toBe('lift');
    let px = 0;
    stepsOf(w, 2, () => { px += 2 / 60; w.moveKinematic('lift', { x: px, y: -0.25, z: 0 }); });
    const lift = w.getTransform('lift').position.x;
    expect(lift).toBeGreaterThan(3.8);
    expect(Math.abs(pos(w).x - lift)).toBeLessThan(0.25); // it rode with it, with nobody steering
    expect(hero(w).state().grounded).toBe(true);
    w.dispose();
  });

  it('is carried UP by a rising lift', async () => {
    const w = await make();
    w.addBody({ id: 'lift', type: 'kinematic', shape: { type: 'box', hx: 3, hy: 0.25, hz: 3 }, position: { x: 0, y: -0.25, z: 0 } });
    w.addCharacter(HERO());
    stepsOf(w, 1);
    let py = -0.25;
    stepsOf(w, 2, () => { py += 1.5 / 60; w.moveKinematic('lift', { x: 0, y: py, z: 0 }); });
    expect(pos(w).y).toBeGreaterThan(3.3);
    expect(hero(w).state().grounded).toBe(true);
    w.dispose();
  });
});

describe('character: steering in the air', () => {
  const drift = async (airControl: number) => {
    const w = await make();
    w.addBody(FLOOR); w.addCharacter(HERO({ airControl }));
    stepsOf(w, 1);
    hero(w).setMove(3, 0);
    stepsOf(w, 0.5);
    hero(w).jump();
    stepsOf(w, 0.1);
    hero(w).setMove(0, 0); // let go in the air
    stepsOf(w, 0.1);
    const out = hero(w).state().velocity.x; w.dispose(); return out;
  };

  it('with no air control the momentum carries; with full air control it stops almost at once', async () => {
    expect(await drift(0)).toBeGreaterThan(2.9);
    expect(await drift(1)).toBeLessThan(0.1);
    const some = await drift(0.3);
    expect(some).toBeGreaterThan(1.2); expect(some).toBeLessThan(2.4); // 3 minus 12 m/s squared for 0.1 s
    expect(some).toBeGreaterThan(await drift(1));
  });
});

describe('character: other bodies', () => {
  it('pushes a dynamic crate it walks into, unless pushing is off', async () => {
    const run = async (pushDynamic: boolean) => {
      const w = await make();
      w.addBody(FLOOR);
      w.addBody(box('crate', 0.5, { position: { x: 2.5, y: 0.5, z: 0 }, mass: 5, friction: 0.3 }));
      w.addCharacter(HERO({ pushDynamic }));
      stepsOf(w, 1);
      hero(w).setMove(2, 0);
      stepsOf(w, 3);
      const crate = w.getTransform('crate').position.x; w.dispose(); return crate;
    };
    const pushed = await run(true); const notPushed = await run(false);
    expect(pushed - 2.5).toBeGreaterThan(0.5); // it moved
    expect(notPushed - 2.5).toBeLessThan(0.1); // it did not
    expect(pushed - 2.5).toBeGreaterThan((notPushed - 2.5) * 5);
  });

  it('collision filtering: a character whose mask leaves a group out walks through that group', async () => {
    const w = await make();
    w.addBody(FLOOR);
    w.addBody({ id: 'ghostwall', type: 'static', collisionGroup: 3, shape: { type: 'box', hx: 0.5, hy: 2, hz: 10 }, position: { x: 4, y: 2, z: 0 } });
    w.addBody({ id: 'realwall', type: 'static', collisionGroup: 1, shape: { type: 'box', hx: 0.5, hy: 2, hz: 10 }, position: { x: 8, y: 2, z: 0 } });
    w.addCharacter(HERO({ collisionGroup: 2, collisionMask: 0b11 })); // collides with groups 0 (the floor) and 1, not 3
    stepsOf(w, 1);
    hero(w).setMove(4, 0);
    stepsOf(w, 3);
    expect(pos(w).x).toBeGreaterThan(5); // through the group-3 wall
    expect(pos(w).x).toBeLessThan(7.5 - 0.35 + 0.01); // stopped by the group-1 wall
    w.dispose();
  });

  it('walking into a trigger volume is seen by it', async () => {
    const log: Array<[string, any]> = [];
    const w = await make({}, (n: string, p: any) => log.push([n, p]));
    w.addBody({ ...FLOOR });
    w.addBody({ id: 'zone', type: 'static', sensor: true, shape: { type: 'box', hx: 1, hy: 2, hz: 3 }, position: { x: 4, y: 2, z: 0 } });
    w.addCharacter(HERO());
    stepsOf(w, 1);
    hero(w).setMove(3, 0);
    stepsOf(w, 3);
    const entered = log.find(([n]) => n === 'sensor_entered');
    expect(entered).toBeTruthy();
    expect(entered![1]).toEqual({ sensor: 'zone', other: 'hero' });
    expect(log.some(([n]) => n === 'sensor_exited')).toBe(true);
    expect(pos(w).x).toBeGreaterThan(6); // and the trigger blocked nothing
    w.dispose();
  });
});

describe('character: validation, lifecycle and failure', () => {
  it('refuses a bad character with a reason, and adds nothing', async () => {
    const w = await make();
    const bad: any[] = [
      null, 'x', {}, HERO({ id: '' }), HERO({ position: { x: NaN, y: 0, z: 0 } }), HERO({ position: { x: 1e9, y: 0, z: 0 } }),
      HERO({ radius: -1 }), HERO({ radius: 99 }), HERO({ halfHeight: 0 }), HERO({ maxSlopeClimbDeg: 90 }), HERO({ minSlopeSlideDeg: -5 }),
      HERO({ jumpSpeed: 99 }), HERO({ airControl: 2 }), HERO({ coyoteTime: 5 }), HERO({ mass: 0 }), HERO({ pushDynamic: 'yes' }),
      HERO({ collisionGroup: 16 }), HERO({ collisionMask: 0x10000 }), HERO({ acceleration: NaN }),
    ];
    for (const spec of bad) { const r = w.addCharacter(spec); expect(r.ok, JSON.stringify(spec)?.slice(0, 70)).toBe(false); expect(String(r.reason).length).toBeGreaterThan(5); }
    expect(w.stats()).toMatchObject({ bodies: 0, colliders: 0, characters: 0 });
    w.dispose();
  });

  it('refuses a duplicate id, counts toward the body limit, and cannot be moved as an ordinary kinematic body', async () => {
    const w = await make({ maxBodies: 3 });
    expect(w.addCharacter(HERO()).ok).toBe(true);
    expect(w.addCharacter(HERO())).toMatchObject({ ok: false });
    expect(w.addBody(ball('hero', 5)).ok).toBe(false);
    expect(w.addCharacter(HERO({ id: 'b' })).ok).toBe(true);
    expect(w.addCharacter(HERO({ id: 'c' })).ok).toBe(true);
    expect(w.addCharacter(HERO({ id: 'd' })).reason).toContain('limit of 3');
    expect(w.moveKinematic('hero', { x: 1, y: 1, z: 1 })).toBe(false);
    w.dispose();
  });

  it('teleport moves it and stops it, and refuses a bad position', async () => {
    const w = await make();
    w.addBody(FLOOR); w.addCharacter(HERO());
    stepsOf(w, 1);
    hero(w).setMove(5, 0); stepsOf(w, 1);
    expect(hero(w).teleport({ x: 20, y: 2, z: -3 })).toBe(true);
    expect(pos(w)).toMatchObject({ x: 20, z: -3 });
    expect(hero(w).state().speed).toBeCloseTo(0, 6);
    expect(hero(w).teleport({ x: NaN, y: 0, z: 0 })).toBe(false);
    expect(hero(w).teleport({ x: 1e9, y: 0, z: 0 })).toBe(false);
    w.dispose();
  });

  it('removing a character frees it and its body; the bookkeeping is emptied; the id is free again', async () => {
    const w = await make();
    for (let round = 0; round < 5; round++) {
      for (let i = 0; i < 40; i++) expect(w.addCharacter(HERO({ id: 'c' + i, position: { x: i * 2, y: 1.3, z: 0 } })).ok).toBe(true);
      expect(w.stats().characters).toBe(40);
      stepsOf(w, 0.1);
      for (let i = 0; i < 40; i++) expect(w.removeBody('c' + i)).toBe(true);
      expect(w.stats()).toMatchObject({ bodies: 0, colliders: 0, characters: 0 });
      expect((w as any).characters.size).toBe(0);
      expect((w as any).colliderOwner.size).toBe(0);
    }
    expect(w.character('c1')).toBeNull();
    w.dispose();
  });

  it('reset and dispose free the characters', async () => {
    const w = await make();
    w.addBody(FLOOR); w.addCharacter(HERO());
    w.reset();
    expect(w.character('hero')).toBeNull();
    expect(w.stats().characters).toBe(0);
    expect(w.addCharacter(HERO()).ok).toBe(true);
    w.dispose();
    expect(w.character('hero')).toBeNull();
    expect(w.addCharacter(HERO({ id: 'x' })).ok).toBe(false);
  });

  it('on a world that could not load physics, a character is refused with the reason and nothing throws', async () => {
    const w = await PhysicsWorld.create({}, async () => { throw new Error('wasm blocked'); });
    expect(w.addCharacter(HERO())).toEqual({ ok: false, reason: w.reason });
    expect(w.character('hero')).toBeNull();
    expect(() => w.step(1)).not.toThrow();
  });

  it('is deterministic: the same inputs give the same walk', async () => {
    const walk = async () => {
      const w = await make();
      w.addBody(FLOOR); w.addBody(ramp('r', 3, 20)); w.addCharacter(HERO());
      stepsOf(w, 1);
      stepsOf(w, 3, (i) => { hero(w).setMove(Math.sin(i / 20) * 4, 3); if (i % 70 === 0) hero(w).jump(); });
      const out = JSON.stringify(hero(w).state()); w.dispose(); return out;
    };
    expect(await walk()).toBe(await walk());
  });

  it('a snapshot saves the character: running on from a restore equals running on without it, input and all', async () => {
    const w = await make();
    w.addBody(FLOOR); w.addBody(ramp('r', 3, 20)); w.addCharacter(HERO());
    stepsOf(w, 1);
    hero(w).setMove(3, 1); stepsOf(w, 1.2);
    hero(w).jump(); stepsOf(w, 0.2);
    const snap = w.snapshot();
    expect(snap.characters.length).toBe(1);
    stepsOf(w, 2);
    const after = JSON.stringify(hero(w).state());
    expect(w.restore(snap)).toEqual({ ok: true });
    expect(w.character('hero')).not.toBeNull();
    stepsOf(w, 2); // NOTE: no setMove after the restore — the saved input carries on
    expect(JSON.stringify(hero(w).state())).toBe(after);
    w.dispose();
  });

  it('a snapshot with a bad character is refused whole, and the world is untouched', async () => {
    const w = await make();
    w.addBody(FLOOR); w.addCharacter(HERO());
    stepsOf(w, 1);
    const before = JSON.stringify(hero(w).state());
    const snap = w.snapshot();
    for (const bad of [{ ...snap, characters: 'x' }, { ...snap, characters: [{ spec: { id: 'ghost', position: { x: 0, y: 0, z: 0 } }, saved: {} }] }, { ...snap, characters: [{ spec: { ...snap.characters[0].spec, radius: -3 }, saved: snap.characters[0].saved }] }]) {
      expect(w.restore(bad).ok).toBe(false);
    }
    expect(JSON.stringify(hero(w).state())).toBe(before);
    stepsOf(w, 0.5);
    expect(hero(w).grounded).toBe(true);
    w.dispose();
  });
});

describe('the emitted kit', () => {
  it('declares exactly the modules it emits and the one dependency it needs, pinned', () => {
    const names = Object.keys(files).map((f) => (f.split('/').pop() ?? '').replace(/\.ts$/, '')).sort();
    expect(names).toEqual([...GAME_PHYSICS_MODULES].sort());
    expect(generateGamePhysics().dependencies).toEqual([{ name: '@dimforge/rapier3d-compat', version: '0.21.0' }]);
    expect(RAPIER_VERSION).toBe('0.21.0');
  });

  it('LAZY WASM: no file imports the Rapier module statically — only types — so a simple game never downloads it', () => {
    for (const [path, src] of Object.entries(files)) {
      for (const m of src.matchAll(/^import\s+(?!type\b)[^;]*from\s*['"]@dimforge\/rapier3d-compat['"]/gm)) expect(m[0], path + ' imports Rapier as a value').toBe('');
    }
    expect(files['src/game/physics/world.ts']).toContain("await import('@dimforge/rapier3d-compat')");
  });

  it('imports nothing outside its own folder except Rapier', () => {
    for (const [path, src] of Object.entries(files)) {
      for (const m of src.matchAll(/from\s*['"]([^'"]+)['"]/g)) {
        expect(m[1].startsWith('./') || m[1] === '@dimforge/rapier3d-compat', path + ' imports ' + m[1]).toBe(true);
        if (m[1].startsWith('./')) expect(Object.keys(files), path + ' imports ' + m[1]).toContain('src/game/physics/' + m[1].slice(2) + '.ts');
      }
    }
  });

  it('every subset is import-closed and loads', () => {
    for (const include of [['config'], ['character'], ['world'], ['sync'], ['index'], ['nonsense']]) {
      const sub = generateGamePhysics(include).files;
      for (const [path, src] of Object.entries(sub)) {
        for (const m of src.matchAll(/from\s*['"](\.\/[^'"]+)['"]/g)) expect(Object.keys(sub), include + ': ' + path + ' imports ' + m[1]).toContain('src/game/physics/' + m[1].slice(2) + '.ts');
      }
      expect(() => loadAll(sub)).not.toThrow();
    }
  });

  it('every file parses as real TypeScript', () => {
    for (const [path, src] of Object.entries(files)) {
      const sf = ts.createSourceFile(path, src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
      const diagnostics = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
      expect(diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' ')), path).toEqual([]);
    }
  });

  it('type-checks under strict, noUnusedLocals and noUnusedParameters against the real Rapier typings', () => {
    const rapierTypes = req.resolve(RAPIER_PACKAGE).replace(/rapier\.(cjs|mjs)$/, 'rapier.d.ts');
    const options: ts.CompilerOptions = {
      strict: true, noUnusedLocals: true, noUnusedParameters: true, noImplicitReturns: true, noEmit: true,
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
      lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'], skipLibCheck: true, isolatedModules: true, types: [],
      baseUrl: '/', paths: { [RAPIER_PACKAGE]: [rapierTypes] },
    };
    const host = ts.createCompilerHost(options);
    const read = host.readFile.bind(host);
    const exists = host.fileExists.bind(host);
    const isDir = host.directoryExists?.bind(host);
    const mem = new Map(Object.entries(files).map(([p, c]) => ['/virtual/' + p, c]));
    host.directoryExists = (d) => [...mem.keys()].some((k) => k.startsWith(d.endsWith('/') ? d : d + '/')) || (isDir ? isDir(d) : false);
    host.fileExists = (f) => mem.has(f) || exists(f);
    host.readFile = (f) => mem.get(f) ?? read(f);
    host.getSourceFile = (f, lang) => {
      const text = mem.get(f) ?? read(f);
      return text === undefined ? undefined : ts.createSourceFile(f, text, lang, true);
    };
    const program = ts.createProgram([...mem.keys()], options, host);
    const errors = ts.getPreEmitDiagnostics(program).filter((d) => !d.file || d.file.fileName.startsWith('/virtual/')).map((d) => (d.file ? d.file.fileName.replace('/virtual/', '') + ': ' : '') + ts.flattenDiagnosticMessageText(d.messageText, ' '));
    expect(errors).toEqual([]);
  });
});

describe('the builder can really call this', () => {
  const catalog = readFileSync(join(__dirname, '../AgentV3/ToolCatalog.ts'), 'utf8');
  const dispatcher = readFileSync(join(__dirname, '../AgentV3/ToolDispatcher.ts'), 'utf8');
  const prompt = readFileSync(join(__dirname, '../AgentV3/systemPrompt.ts'), 'utf8');
  const layers = readFileSync(join(__dirname, './gameRecipeLayers.ts'), 'utf8');
  const knowledge = readFileSync(join(__dirname, '../AppContext/AppKnowledgeBase.ts'), 'utf8');

  it('is registered as a definition, in BOTH exposed lists, and in the recipe map', () => {
    expect(catalog).toContain("name: 'generate_game_physics'");
    expect(catalog.match(/^ {2}'generate_game_physics',$/gm)?.length).toBe(2);
    expect(layers).toContain('generate_game_physics: generateGamePhysics');
  });

  it('the dispatcher handles it, the prompt names it, the description gives the rules and the limits, every AI can explain it', () => {
    expect(dispatcher).toContain("case 'generate_game_physics': {");
    expect(dispatcher).toContain('generateGamePhysics(gphInclude)');
    expect(prompt).toContain('run_recipe({ name: "generate_game_physics" })');
    const at = catalog.indexOf("name: 'generate_game_physics'");
    const def = catalog.slice(at, at + 3500);
    for (const word of ['Rapier', 'FIXED', 'available', 'CHARACTER', 'NO VEHICLE CONTROLLER', 'ONLY when']) expect(def, word).toContain(word);
    expect(knowledge).toContain('generate_game_physics');
  });
});
