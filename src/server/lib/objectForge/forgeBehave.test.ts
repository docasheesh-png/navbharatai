// BEHAVIOUR AS DATA: a spec names one of five fixed movements and gives numbers; the kit's own code (behave.ts, tested here) moves the object.
// No movement code is ever generated. The behaviours are tested as pure motion (a stand-in object records what is asked of it), then on the real
// worked examples in a real three.js scene.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import ts from 'typescript';
import { loadForge, authorObject, objectFileSource } from './forgeRuntime';
import { FORGE_BEHAVE } from './forgeBehaveSource';
import { FORGE_EXAMPLES } from './forgeExamples';
import { FORGE_GUIDE } from './ObjectForgeGenerator';
import { applyEdits, personSpecFor } from './forgeCustomise';

const { engine: E, check: C } = loadForge();
const behaveJs = ts.transpileModule(FORGE_BEHAVE, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const B: Record<string, any> = {};
// eslint-disable-next-line no-new-func
new Function('exports', 'require', behaveJs)(B, (rel: string) => { if (rel === './forge') return E; throw new Error('unexpected import ' + rel); });

/** A stand-in for a Forge object that records what the behaviour asks of it. */
function stub(spinBase = 1.2) {
  const calls: Array<{ kind: string; arg?: unknown }> = [];
  const group = {
    position: { x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } },
    rotation: { order: 'XYZ', x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } },
  };
  let clip: string | null = null; let speed = 1;
  const obj = {
    group, nodes: {}, triangles: 0, clips: ['run', 'walk', 'idle', 'drive', 'fly'],
    get clip() { return clip; },
    play(name: string | null, s = 1) { calls.push({ kind: 'play', arg: name }); clip = name; speed = s; },
    setSpeed(s: number) { calls.push({ kind: 'speed', arg: s }); speed = s; },
    spinOf: () => spinBase,
    update(dt: number) { calls.push({ kind: 'update', arg: dt }); }, dispose() { /* not used */ },
  };
  return { obj, group, calls, get speed() { return speed; } };
}
const run = (m: any, seconds: number, dt = 1 / 60, input?: any): void => { for (let t = 0; t < seconds; t += dt) m.update(dt, input); };

describe('behaviour lifecycle preserves deliberate placement', () => {
  it('orbit stays stopped across later animation frames', () => {
    const s = stub(); const m = B.behave(s.obj, { type: 'orbit', radius: 60, altitude: 40, speed: 25, clip: 'fly' });
    m.update(0.1); m.stop();
    const position = { x: m.x, z: m.z }; const heading = m.heading;
    run(m, 1);
    expect({ x: m.x, z: m.z }).toEqual(position); expect(m.heading).toBe(heading);
    expect(m.speed).toBe(0); expect(m.state).toBe('idle'); expect(s.speed).toBe(0);
  });
  it.each([undefined, { type: 'static' }])('a static wrapper preserves the entire authored pose (%s)', (behaviour) => {
    const s = stub(); s.group.position.set(7, 5, -2); s.group.rotation.set(0.5, 0.7, -0.2);
    const m = B.behave(s.obj, behaviour); m.update(0.1);
    expect(s.group.position).toMatchObject({ x: 7, y: 5, z: -2 });
    expect(s.group.rotation).toMatchObject({ x: 0.5, y: 0.7, z: -0.2, order: 'XYZ' });
    expect(s.calls.filter(c => c.kind === 'update')).toHaveLength(1);
  });
  it('a driven boat retains its draft throughout movement', () => {
    const s = stub(); s.group.position.y = -0.3;
    const m = B.behave(s.obj, { type: 'drive', maxSpeed: 12 }, { heightAt: () => 4 });
    expect(s.group.position.y).toBeCloseTo(3.7, 9);
    run(m, 1, 0.05, { throttle: 1, steer: 0 });
    expect(s.group.position.y).toBeCloseTo(3.7, 9);
  });
  it('an explicit finite height offset can override the initial elevation', () => {
    const s = stub(); s.group.position.y = 10;
    const m = B.behave(s.obj, { type: 'drive', maxSpeed: 12 }, { heightAt: () => 4, heightOffset: -0.2 });
    m.update(0.1); expect(s.group.position.y).toBeCloseTo(3.8, 9);
  });
});

describe('paths', () => {
  const square: Array<[number, number]> = [[0, 0], [0, 10], [10, 10], [10, 0]];
  it('a closed square is 40 m, an open one 30 m', () => { expect(B.pathLength(square, true)).toBeCloseTo(40, 9); expect(B.pathLength(square, false)).toBeCloseTo(30, 9); });
  it('a distance is a place along it, and a loop wraps', () => {
    expect(B.pathPoint(square, true, 5)).toMatchObject({ x: 0, z: 5 });
    expect(B.pathPoint(square, true, 15).x).toBeCloseTo(5, 6); expect(B.pathPoint(square, true, 15).z).toBeCloseTo(10, 6);
    const w = B.pathPoint(square, true, 45); expect(w.x).toBeCloseTo(0, 6); expect(w.z).toBeCloseTo(5, 6);
    expect(B.pathPoint(square, true, -5).z).toBeCloseTo(0 + 0, 0 + 6 - 6) ;
  });
  it('an open path stops at its end and at its start', () => {
    const end = B.pathPoint(square, false, 999); expect(end.x).toBeCloseTo(10, 6); expect(end.z).toBeCloseTo(0, 6);
    const start = B.pathPoint(square, false, -999); expect(start.x).toBeCloseTo(0, 6); expect(start.z).toBeCloseTo(0, 6);
  });
  it('it points along the path: +z is heading 0, +x is a quarter turn, and a corner is turned, not snapped', () => {
    expect(B.pathPoint(square, true, 5).heading).toBeCloseTo(0, 6);
    expect(B.pathPoint(square, true, 15).heading).toBeCloseTo(Math.PI / 2, 6);
    const corner = B.pathPoint(square, true, 10).heading; expect(corner).toBeGreaterThan(0.2); expect(corner).toBeLessThan(Math.PI / 2 - 0.2);
  });
  it('angles wrap into [-pi, pi)', () => { expect(Math.abs(B.wrapAngle(3 * Math.PI))).toBeCloseTo(Math.PI, 9); expect(Math.abs(B.wrapAngle(-3 * Math.PI))).toBeCloseTo(Math.PI, 9); expect(B.wrapAngle(0.5)).toBeCloseTo(0.5, 9); });
});

describe('rails', () => {
  const path: Array<[number, number]> = [[0, 0], [0, 100]];
  it('moves at its speed along the path, facing the way it goes', () => {
    const s = stub(); const m = B.behave(s.obj, { type: 'rails', path, speed: 10, clip: 'run' });
    run(m, 3);
    expect(s.group.position.z).toBeCloseTo(30, 0); expect(s.group.position.x).toBeCloseTo(0, 6); expect(m.speed).toBe(10); expect(m.state).toBe('moving'); expect(m.heading).toBeCloseTo(0, 6);
  });
  it('a loop comes back to where it began after length / speed seconds', () => {
    const sq: Array<[number, number]> = [[0, 0], [0, 50], [50, 50], [50, 0]];
    const s = stub(); const m = B.behave(s.obj, { type: 'rails', path: sq, loop: true, speed: 20 });
    run(m, 10, 1 / 100);
    expect(s.group.position.x).toBeCloseTo(0, 0); expect(s.group.position.z).toBeCloseTo(0, 0);
    expect(m.state).toBe('moving');
  });
  it('an open path ends: finished, speed 0, and it stays where the path ends', () => {
    const s = stub(); const m = B.behave(s.obj, { type: 'rails', path, speed: 50, clip: 'run' });
    run(m, 5);
    expect(m.state).toBe('finished'); expect(m.speed).toBe(0); expect(s.group.position.z).toBeCloseTo(100, 6);
    const z = s.group.position.z; run(m, 1); expect(s.group.position.z).toBe(z);
  });
  it('starts the clip once, not every frame (a restart each frame would freeze the wheels)', () => {
    const s = stub(); const m = B.behave(s.obj, { type: 'rails', path, speed: 5, clip: 'run' });
    run(m, 2);
    expect(s.calls.filter((c) => c.kind === 'play').length).toBe(1);
  });
  it('rolls its wheels at the true speed: v / (2 pi r) turns a second, as a fraction of the clip\'s own spin', () => {
    const s = stub(1.5); const m = B.behave(s.obj, { type: 'rails', path, speed: 12, clip: 'run', wheelRadius: 0.5 });
    run(m, 1);
    expect(s.speed).toBeCloseTo(12 / (2 * Math.PI * 0.5) / 1.5, 6);
  });
  it('advances the object own animation by the same step, once a frame (so the game calls ONE update)', () => {
    const s = stub(); const m = B.behave(s.obj, { type: 'rails', path, speed: 5, clip: 'run' });
    run(m, 1, 1 / 50);
    const updates = s.calls.filter((c) => c.kind === 'update');
    expect(updates.length).toBe(50); for (const u of updates) expect(u.arg).toBeCloseTo(1 / 50, 9);
  });
  it('a huge or NaN time step cannot throw it down the track', () => {
    const s = stub(); const m = B.behave(s.obj, { type: 'rails', path, speed: 10 });
    m.update(1000); expect(s.group.position.z).toBeCloseTo(1, 6); // clamped to 0.1 s
    m.update(NaN); m.update(-5); expect(Number.isFinite(s.group.position.z)).toBe(true);
  });
});

describe('wander', () => {
  const spec = { type: 'wander', radius: 20, speed: 1.5, clip: 'walk', idleClip: 'idle', pause: [1, 3], seed: 7 };
  const at = (cx: number, cz: number) => { const s = stub(); s.group.position.set(cx, 0, cz); return s; };

  it('never leaves its circle, over a very long walk, from any starting place', () => {
    for (const [cx, cz] of [[0, 0], [500, -300]]) {
      const s = at(cx, cz); const m = B.behave(s.obj, spec);
      let far = 0;
      for (let i = 0; i < 30000; i++) { m.update(1 / 30); far = Math.max(far, Math.hypot(s.group.position.x - cx, s.group.position.z - cz)); }
      expect(far, `from (${cx}, ${cz})`).toBeLessThan(20 + 0.01); expect(far).toBeGreaterThan(5); // it really does roam
    }
  });
  it('is deterministic for a seed, and different for another', () => {
    const walk = (seed: number) => { const s = at(0, 0); const m = B.behave(s.obj, { ...spec, seed }); const out: number[] = []; for (let i = 0; i < 600; i++) { m.update(1 / 30); out.push(s.group.position.x, s.group.position.z); } return out; };
    expect(walk(7)).toEqual(walk(7)); expect(walk(7)).not.toEqual(walk(8));
  });
  it('the seed in the options overrides the spec\'s', () => {
    const a = at(0, 0); const ma = B.behave(a.obj, spec, { seed: 99 }); const b = at(0, 0); const mb = B.behave(b.obj, { ...spec, seed: 99 });
    for (let i = 0; i < 300; i++) { ma.update(1 / 30); mb.update(1 / 30); }
    expect(a.group.position.x).toBe(b.group.position.x);
  });
  it('walks, turns on the spot and rests, and never faster than its speed', () => {
    const s = at(0, 0); const m = B.behave(s.obj, spec);
    const states = new Set<string>(); let fastest = 0; let px = 0; let pz = 0;
    for (let i = 0; i < 6000; i++) { m.update(1 / 30); states.add(m.state); fastest = Math.max(fastest, Math.hypot(s.group.position.x - px, s.group.position.z - pz) * 30); px = s.group.position.x; pz = s.group.position.z; }
    expect([...states].sort()).toEqual(['idle', 'moving', 'turning']);
    expect(fastest).toBeLessThanOrEqual(1.5 + 1e-6);
  });
  it('plays walk while it walks and idle while it rests, switching only when it changes', () => {
    const s = at(0, 0); const m = B.behave(s.obj, spec);
    for (let i = 0; i < 3000; i++) m.update(1 / 30);
    const plays = s.calls.filter((c) => c.kind === 'play').map((c) => c.arg);
    expect(new Set(plays)).toEqual(new Set(['walk', 'idle']));
    expect(plays.length).toBeLessThan(200); // a change of state, not a restart every frame
    for (let i = 1; i < plays.length; i++) expect(plays[i]).not.toBe(plays[i - 1]);
  });
  it('stands on a hill and leans with it: nose up going uphill', () => {
    const s = at(0, 0);
    const m = B.behave(s.obj, { ...spec, pause: [0, 0] }, { heightAt: (_x: number, z: number) => z * 0.2 + 3 });
    for (let i = 0; i < 2000; i++) {
      m.update(1 / 30);
      expect(s.group.position.y).toBeCloseTo(s.group.position.z * 0.2 + 3, 9);
      // facing uphill (+z component) the nose is up: a negative pitch about x
      if (Math.cos(m.heading) > 0.9 && m.state === 'moving') expect(s.group.rotation.x).toBeLessThan(-0.1);
      if (Math.cos(m.heading) < -0.9 && m.state === 'moving') expect(s.group.rotation.x).toBeGreaterThan(0.1);
    }
  });
  it('a FAST walker still cannot overshoot its target out of the circle (a big step against a small circle)', () => {
    const s = at(0, 0); const m = B.behave(s.obj, { type: 'wander', radius: 3, speed: 60, pause: [0, 0], seed: 3 });
    let far = 0;
    for (let i = 0; i < 20000; i++) { m.update(0.1); far = Math.max(far, Math.hypot(s.group.position.x, s.group.position.z)); }
    expect(far).toBeLessThanOrEqual(3 + 1e-9); expect(far).toBeGreaterThan(1);
  });
  it('a fast walker ARRIVES (a step bigger than the distance left lands on the target instead of skipping past it for ever)', () => {
    const s = at(0, 0); const m = B.behave(s.obj, { type: 'wander', radius: 40, speed: 60, pause: [0.2, 0.2], seed: 5 });
    let rests = 0; let wasIdle = false;
    for (let i = 0; i < 3000; i++) { m.update(0.1); const idle = m.state === 'idle'; if (idle && !wasIdle) rests++; wasIdle = idle; }
    expect(rests).toBeGreaterThan(40);
  });
  it('a creature that never pauses still sets off at once (pause [0, 0])', () => {
    const s = at(0, 0); const m = B.behave(s.obj, { type: 'wander', radius: 20, speed: 2, pause: [0, 0], seed: 2 });
    run(m, 5, 1 / 30); expect(Math.hypot(s.group.position.x, s.group.position.z)).toBeGreaterThan(2);
  });
  it('stop() makes it stand still for good', () => {
    const s = at(0, 0); const m = B.behave(s.obj, spec); run(m, 10); m.stop();
    const x = s.group.position.x; run(m, 30); expect(s.group.position.x).toBe(x);
  });
});

describe('drive', () => {
  const car = { type: 'drive', maxSpeed: 40, wheelRadius: 0.34, clip: 'drive' };
  it('accelerates to its top speed under full throttle, and no faster', () => { const s = stub(); const m = B.behave(s.obj, car); run(m, 30, 1 / 60, { throttle: 1, steer: 0 }); expect(m.speed).toBeCloseTo(40, 6); });
  it('coasts to a stop with no input, and brakes harder than it coasts', () => {
    const s1 = stub(); const a = B.behave(s1.obj, car); run(a, 30, 1 / 60, { throttle: 1, steer: 0 }); run(a, 3, 1 / 60, {});
    const s2 = stub(); const b = B.behave(s2.obj, car); run(b, 30, 1 / 60, { throttle: 1, steer: 0 }); run(b, 3, 1 / 60, { throttle: 0, steer: 0, brake: true });
    expect(a.speed).toBeGreaterThan(0); expect(a.speed).toBeLessThan(40); expect(b.speed).toBe(0);
    run(a, 60, 1 / 60, {}); expect(a.speed).toBe(0);
  });
  it('goes backward slowly: reverse is held to 30 percent of top speed', () => { const s = stub(); const m = B.behave(s.obj, car); run(m, 30, 1 / 60, { throttle: -1, steer: 0 }); expect(m.speed).toBeCloseTo(-12, 6); });
  it('moves the way it faces: at heading 0 along +z, and after turning along the new heading', () => {
    const s = stub(); const m = B.behave(s.obj, car); run(m, 5, 1 / 60, { throttle: 1, steer: 0 });
    expect(s.group.position.z).toBeGreaterThan(20); expect(Math.abs(s.group.position.x)).toBeLessThan(1e-9);
    const z0 = s.group.position.z; run(m, 0.5, 1 / 60, { throttle: 1, steer: 1 });
    expect(s.group.position.x).toBeLessThan(-0.5); expect(s.group.position.z).toBeGreaterThan(z0); // steer right: toward -x (its right), still going forward
  });
  it('a vehicle turns only as it moves: standing still, steering does nothing; in reverse the turn is reversed', () => {
    const s = stub(); const m = B.behave(s.obj, car); run(m, 3, 1 / 60, { throttle: 0, steer: 1 }); expect(m.heading).toBe(0);
    const f = stub(); const mf = B.behave(f.obj, car); run(mf, 0.5, 1 / 60, { throttle: 1, steer: 1 });
    const r = stub(); const mr = B.behave(r.obj, car); run(mr, 1.5, 1 / 60, { throttle: -1, steer: 1 });
    expect(mf.heading).toBeLessThan(-0.1); expect(mr.heading).toBeGreaterThan(0.01);
  });
  it('its wheels turn at the true speed (and backward in reverse), and the clip is started once', () => {
    const s = stub(1.2); const m = B.behave(s.obj, car); run(m, 30, 1 / 60, { throttle: 1, steer: 0 });
    expect(s.speed).toBeCloseTo(40 / (2 * Math.PI * 0.34) / 1.2, 5);
    expect(s.calls.filter((c) => c.kind === 'play').length).toBe(1);
    const r = stub(1.2); const mr = B.behave(r.obj, car); run(mr, 30, 1 / 60, { throttle: -1, steer: 0 });
    expect(r.speed).toBeLessThan(0);
  });
  it('rubbish input is held to range and never makes a NaN', () => {
    const s = stub(); const m = B.behave(s.obj, car);
    for (const input of [{ throttle: NaN, steer: NaN }, { throttle: 99, steer: -99 }, { throttle: Infinity, steer: 1 }, undefined, {} as any]) m.update(1 / 60, input);
    expect(Number.isFinite(s.group.position.x) && Number.isFinite(s.group.position.z) && Number.isFinite(m.speed)).toBe(true);
    run(m, 5, 1 / 60, { throttle: 99, steer: 99 }); expect(m.speed).toBeLessThanOrEqual(40 + 1e-9);
  });
  it('lies on a slope: nose up uphill, and rolled to match a side slope', () => {
    const s = stub(); const m = B.behave(s.obj, car, { heightAt: (x: number, z: number) => z * 0.1 + x * 0.1 });
    run(m, 2, 1 / 60, { throttle: 1, steer: 0 });
    expect(s.group.rotation.x).toBeLessThan(-0.05);     // going up +z: nose up (negative pitch)
    expect(s.group.rotation.z).toBeGreaterThan(0.05);   // ground rises toward +x: the +x side rises
    expect(s.group.position.y).toBeCloseTo(s.group.position.z * 0.1 + s.group.position.x * 0.1, 9);
  });
});

describe('orbit', () => {
  const spec = { type: 'orbit', radius: 60, altitude: 40, speed: 25, bank: 20, clip: 'fly' };
  it('stays exactly one radius from where it started, at its altitude, banked into the turn', () => {
    const s = stub(); s.group.position.set(100, 0, -50);
    const m = B.behave(s.obj, spec);
    for (let i = 0; i < 3000; i++) {
      m.update(1 / 30);
      expect(Math.hypot(s.group.position.x - 100, s.group.position.z + 50)).toBeCloseTo(60, 6);
      expect(s.group.position.y).toBeCloseTo(40, 9);
      expect(s.group.rotation.z).toBeCloseTo((20 * Math.PI) / 180, 9);
    }
  });
  it('flies at its speed, along the circle, nose first, and comes round in 2 pi r / speed seconds', () => {
    const s = stub(); const m = B.behave(s.obj, spec);
    let px = s.group.position.x; let pz = s.group.position.z;
    for (let i = 0; i < 100; i++) {
      m.update(1 / 100);
      const vx = (s.group.position.x - px) * 100; const vz = (s.group.position.z - pz) * 100;
      expect(Math.hypot(vx, vz)).toBeCloseTo(25, 0);
      expect(Math.sin(m.heading) * vx + Math.cos(m.heading) * vz).toBeGreaterThan(24); // moving the way its nose points
      px = s.group.position.x; pz = s.group.position.z;
    }
    const s2 = stub(); const m2 = B.behave(s2.obj, spec); const x0 = s2.group.position.x; const z0 = s2.group.position.z;
    run(m2, (2 * Math.PI * 60) / 25, 1 / 100);
    expect(s2.group.position.x).toBeCloseTo(x0, 0); expect(s2.group.position.z).toBeCloseTo(z0, 0);
  });
});

describe('static', () => {
  it('does not move, and update is harmless', () => {
    const s = stub(); s.group.position.set(5, 0, 6); const m = B.behave(s.obj, { type: 'static' });
    run(m, 5); expect(s.group.position.x).toBe(5); expect(s.group.position.z).toBe(6); expect(m.speed).toBe(0);
    expect(B.behave(stub().obj, undefined).speed).toBe(0);
  });
});

describe('a behaviour is validated like the rest of the spec', () => {
  const base = () => { const s: any = JSON.parse(JSON.stringify(FORGE_EXAMPLES.quadruped.spec)); return s; };
  const errorsWith = (b: unknown): string => { const s = base(); s.behaviour = b; return C.validateObjectSpec(s).errors.join(' | '); };
  it('every worked example\'s behaviour is valid', () => { for (const e of Object.values(FORGE_EXAMPLES)) expect(C.validateObjectSpec(e.spec).errors, e.id).toEqual([]); });
  const cases: Array<[string, unknown, RegExp]> = [
    ['an unknown type', { type: 'teleport' }, /type must be one of: static, rails, wander, drive, orbit/],
    ['not an object', 'rails', /type must be one of/],
    ['a rails path with one point', { type: 'rails', path: [[0, 0]], speed: 5 }, /2 to 200 points/],
    ['a rails path point that is NaN', { type: 'rails', path: [[0, 0], [NaN, 5]], speed: 5 }, /path\[1\]\[0\] must be a number/],
    ['a rails path point out of range', { type: 'rails', path: [[0, 0], [1e9, 5]], speed: 5 }, /path\[1\]\[0\] is 1000000000/],
    ['rails with no speed', { type: 'rails', path: [[0, 0], [0, 9]] }, /speed must be a number/],
    ['rails with speed 0', { type: 'rails', path: [[0, 0], [0, 9]], speed: 0 }, /speed is 0/],
    ['rails loop that is not a boolean', { type: 'rails', path: [[0, 0], [0, 9]], speed: 5, loop: 'yes' }, /loop must be true or false/],
    ['a clip the object does not have', { type: 'wander', radius: 10, speed: 1, clip: 'gallop' }, /no clip called that \(its clips: .*walk/],
    ['wander radius 0', { type: 'wander', radius: 0, speed: 1 }, /radius is 0/],
    ['wander pause reversed', { type: 'wander', radius: 10, speed: 1, pause: [5, 1] }, /shortest pause is longer than the longest/],
    ['wander pause not a pair', { type: 'wander', radius: 10, speed: 1, pause: [1] }, /\[shortest, longest\]/],
    ['drive with no maxSpeed', { type: 'drive' }, /maxSpeed must be a number/],
    ['drive with a huge speed', { type: 'drive', maxSpeed: 99999 }, /maxSpeed is 99999/],
    ['drive with a wheel radius of 100 m', { type: 'drive', maxSpeed: 10, wheelRadius: 100 }, /wheelRadius is 100/],
    ['orbit with a negative altitude', { type: 'orbit', radius: 50, altitude: -5, speed: 20 }, /altitude is -5/],
    ['orbit with a bank of 90', { type: 'orbit', radius: 50, altitude: 5, speed: 20, bank: 90 }, /bank is 90/],
    ['orbit with no radius', { type: 'orbit', altitude: 5, speed: 20 }, /radius must be a number/],
  ];
  for (const [label, b, re] of cases) it(label, () => { expect(errorsWith(b)).toMatch(re); });
  it('no behaviour and a static one are fine', () => { expect(errorsWith(undefined)).toBe(''); expect(errorsWith({ type: 'static' })).toBe(''); });
  it('survives rubbish without throwing', () => { for (const b of [null, 5, [], { type: 7 }, { type: 'drive', maxSpeed: {} }]) expect(() => errorsWith(b)).not.toThrow(); });
});

describe('the worked examples move the way their subject does', () => {
  const wheelRadii = (spec: any): number[] => {
    const out: number[] = [];
    const walk = (nodes: any[]): void => { for (const n of nodes) { if (/wheel/.test(n.name) && n.shape) out.push(n.shape.type === 'torus' ? n.shape.radius + n.shape.tube : n.shape.radiusTop ?? n.shape.radius); if (n.children) walk(n.children); } };
    walk(spec.nodes); return out;
  };
  it('the train is on rails round a closed loop, its clip is its wheels\' spin, and its wheelRadius is a real wheel radius', () => {
    const b: any = (FORGE_EXAMPLES.train.spec as any).behaviour;
    expect(b.type).toBe('rails'); expect(b.loop).toBe(true); expect(B.pathLength(b.path, true)).toBeGreaterThan(200);
    const r = wheelRadii(FORGE_EXAMPLES.train.spec); expect(b.wheelRadius).toBeGreaterThanOrEqual(Math.min(...r)); expect(b.wheelRadius).toBeLessThanOrEqual(Math.max(...r));
  });
  it('the car and the bike are driven, with the radius of their own wheels', () => {
    for (const id of ['car', 'bike']) {
      const b: any = (FORGE_EXAMPLES[id].spec as any).behaviour; expect(b.type, id).toBe('drive');
      const r = wheelRadii(FORGE_EXAMPLES[id].spec); expect(b.wheelRadius, id).toBeCloseTo(r[0], 2);
    }
  });
  it('the animal and the person wander; the plane circles; the boat is driven', () => {
    expect((FORGE_EXAMPLES.quadruped.spec as any).behaviour.type).toBe('wander'); expect((FORGE_EXAMPLES.person.spec as any).behaviour.type).toBe('wander');
    expect((FORGE_EXAMPLES.plane.spec as any).behaviour.type).toBe('orbit'); expect((FORGE_EXAMPLES.boat.spec as any).behaviour.type).toBe('drive');
  });
  it('a house, a tree and a sword do not move: no behaviour', () => { for (const id of ['house', 'tree', 'sword']) expect((FORGE_EXAMPLES[id].spec as any).behaviour, id).toBeUndefined(); });
  it('the plane is a plane: 8 m long, 11 m across, its lowest point is the ground (wheels), a propeller that spins', () => {
    const r = authorObject(FORGE_EXAMPLES.plane.spec).report!;
    expect(r.size[2]).toBeGreaterThan(8); expect(r.size[2]).toBeLessThan(9.2); expect(r.size[0]).toBeGreaterThan(10.5); expect(r.size[0]).toBeLessThan(12); expect(Math.abs(r.min[1])).toBeLessThan(0.02);
    const spinning = (E.expandNodes(FORGE_EXAMPLES.plane.spec) as any[]).filter((n) => n.clips.fly?.[0]?.spin);
    expect(spinning.length).toBe(1); expect(r.warnings).toEqual([]);
  });
  it('the boat is a boat: 5 m long, the keel is the ground, a mast above a hull, bobbing', () => {
    const r = authorObject(FORGE_EXAMPLES.boat.spec).report!;
    expect(r.size[2]).toBeGreaterThan(4.8); expect(r.size[2]).toBeLessThan(5.3); expect(Math.abs(r.min[1])).toBeLessThan(0.02); expect(r.size[1]).toBeGreaterThan(3.5); expect(r.warnings).toEqual([]);
    expect(Object.keys(r.clips)).toEqual(['bob']);
  });
});

describe('the object says how fast its wheels spin (what a behaviour scales)', () => {
  const o = (id: string) => E.createObject(THREE, FORGE_EXAMPLES[id].spec);
  it('spinOf is the fastest spin in a clip, in turns a second; a clip without a spin, or no such clip, is 0', () => {
    expect(o('car').spinOf('drive')).toBe(2.5); expect(o('bike').spinOf('ride')).toBe(2); expect(o('plane').spinOf('fly')).toBe(8);
    expect(o('train').spinOf('run')).toBe(1.5); // the locomotive turns at 1.2, a carriage wheel at 1.5: the fastest
    expect(o('person').spinOf('walk')).toBe(0); expect(o('car').spinOf('nonsense')).toBe(0);
  });
});

describe('with a real three.js scene', () => {
  const make = (id: string) => E.createObject(THREE, FORGE_EXAMPLES[id].spec);
  it('the train follows its track and its wheels turn at the right speed for it', () => {
    const o = make('train'); const spec: any = FORGE_EXAMPLES.train.spec;
    const m = B.behave(o, spec.behaviour);
    const wheel = o.nodes.loco_wheel; const rot0 = wheel.rotation.x;
    for (let i = 0; i < 300; i++) m.update(1 / 60); // 5 s at 10 m/s = 50 m along the loop
    expect(Math.abs(wheel.rotation.x - rot0)).toBeGreaterThan(1);
    const p = B.pathPoint(spec.behaviour.path, true, 50);
    expect(o.group.position.x).toBeCloseTo(p.x, 4); expect(o.group.position.z).toBeCloseTo(p.z, 4); expect(o.group.rotation.y).toBeCloseTo(p.heading, 4);
    expect(o.clip).toBe('run');
  });
  it('the car drives on a real height function, its wheels roll with its speed and stop when it does', () => {
    const o = make('car'); const spec: any = FORGE_EXAMPLES.car.spec;
    const m = B.behave(o, spec.behaviour, { heightAt: (x: number, z: number) => 2 + 0.05 * z });
    for (let i = 0; i < 180; i++) m.update(1 / 60, { throttle: 1, steer: 0 });
    expect(m.speed).toBeGreaterThan(5); expect(o.group.position.y).toBeCloseTo(2 + 0.05 * o.group.position.z, 9);
    const r1 = o.nodes.wheel.rotation.x; for (let i = 0; i < 10; i++) m.update(1 / 60, { throttle: 1, steer: 0 }); expect(o.nodes.wheel.rotation.x).not.toBeCloseTo(r1, 3);
    for (let i = 0; i < 1200; i++) m.update(1 / 60, { throttle: 0, steer: 0, brake: true });
    const frozen = o.nodes.wheel.rotation.x; for (let i = 0; i < 30; i++) m.update(1 / 60, {}); expect(o.nodes.wheel.rotation.x).toBeCloseTo(frozen, 9);
  });
  it('the animal wanders inside its circle, walking and resting, on the ground', () => {
    const o = make('quadruped'); const spec: any = FORGE_EXAMPLES.quadruped.spec;
    o.group.position.set(10, 0, 10);
    const m = B.behave(o, spec.behaviour, { heightAt: () => 1.5 });
    let far = 0; const clips = new Set<string>();
    for (let i = 0; i < 6000; i++) { m.update(1 / 30); far = Math.max(far, Math.hypot(o.group.position.x - 10, o.group.position.z - 10)); if (o.clip) clips.add(o.clip); }
    expect(far).toBeLessThan(spec.behaviour.radius + 0.01); expect(far).toBeGreaterThan(3);
    expect([...clips].sort()).toEqual(['idle', 'walk']); expect(o.group.position.y).toBeCloseTo(1.5, 9);
  });
  it('the plane circles with its propeller spinning', () => {
    const o = make('plane'); const spec: any = FORGE_EXAMPLES.plane.spec;
    const m = B.behave(o, spec.behaviour);
    const r0 = o.nodes.propeller.rotation.z;
    for (let i = 0; i < 120; i++) m.update(1 / 60);
    expect(Math.abs(o.nodes.propeller.rotation.z - r0)).toBeGreaterThan(5); expect(o.group.position.y).toBeCloseTo(40, 6);
  });
});

describe('everything around it knows about behaviour', () => {
  it('the object file carries it: the spec, and a behave function that uses it', () => {
    const src = objectFileSource(FORGE_EXAMPLES.train.spec);
    expect(src).toContain('"behaviour"'); expect(src).toContain("import { behave, type BehaviourOptions } from '../forge/behave';");
    expect(src).toMatch(/export function behaveTrain\(obj: ForgeObject, options\?: BehaviourOptions\)/); expect(src).toContain('return behave(obj, SPEC.behaviour, options);');
  });
  it('the guide names all five behaviours and says the model only picks one and sets numbers', () => {
    for (const t of ['rails', 'wander', 'drive', 'orbit', 'static']) expect(FORGE_GUIDE).toContain(t);
    expect(FORGE_GUIDE).toMatch(/you never write movement/);
  });
  it('a person keeps its behaviour through every customisation', () => {
    const edited: any = applyEdits(personSpecFor(), [{ kind: 'param', name: 'gender', value: 'female' }]).spec;
    expect(edited.behaviour).toMatchObject({ type: 'wander' });
    const custom: any = personSpecFor(); custom.behaviour = { type: 'wander', radius: 3, speed: 0.5, clip: 'walk' };
    expect((applyEdits(custom, [{ kind: 'param', name: 'dress', value: true }]).spec as any).behaviour.radius).toBe(3);
  });
  it('a spec that goes through the real tool keeps its behaviour and measures with no warning', () => {
    for (const id of ['train', 'car', 'bike', 'quadruped', 'person', 'plane', 'boat']) { const r = authorObject(FORGE_EXAMPLES[id].spec); expect(r.ok, id).toBe(true); expect(r.files![`src/game/objects/${id}.ts`], id).toContain('"behaviour"'); expect(r.report!.warnings, id).toEqual([]); }
  });
});
