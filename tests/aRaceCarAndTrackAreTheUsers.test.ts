// 🏁 THE USER'S OWN CAR AND THE USER'S OWN TRACK (admin 2026-11-22, verbatim: "user puri racing game ko bhi AI se modified
// karwa sake, jaise chahe sab free hand do!").
//
// The race starter had one kit car and one road library, and the builder was told "never hand-build a second track". These
// run the REAL generated kit (play/raceCustom.ts beside three/objects.ts and three/race.ts): a model becomes the car's look
// at the car's size while the kit keeps driving it; a track model becomes the ground with a racing line read from its road,
// laps count, rivals drive it, and a model that cannot be raced on is refused with the reason — never faked.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';
import { RACE_CUSTOM_PATH } from '../src/server/lib/GameRaceCustomGenerator';

const DIR = join(__dirname, `.tmp-race-custom-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let RC: any; let RACE: any; let O: any;

beforeAll(async () => {
  const shell = generateGameShell(['racingroadgame']).files;
  for (const files of [generateGameRuntime().files, generateGame3D().files, shell]) {
    for (const [p, c] of Object.entries(files)) { const f = join(DIR, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
  }
  // The user's own car file, exactly as the platform writes it (carSwap.raceCarFile) — read by the kit by itself.
  writeFileSync(join(DIR, 'src/game/car.ts'), "import type { CarChoice } from './play/raceCustom';\nexport const CAR: CarChoice = { color: 0x1e88e5, model: 'public/models/my-car.glb' };\n");
  RC = await import(join(DIR, RACE_CUSTOM_PATH));
  RACE = await import(join(DIR, 'src/game/three/race.ts'));
  O = await import(join(DIR, 'src/game/three/objects.ts'));
}, 60_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const box = (w: number, h: number, d: number, name = 'body') => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial()); m.name = name; return m; };
/** A flat ring of road (an oval circuit), radius inner → outer, at height y. */
const ring = (inner: number, outer: number, y = 0, name = 'Road') => {
  const m = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 96, 1), new THREE.MeshBasicMaterial());
  m.rotation.x = -Math.PI / 2; m.position.y = y; m.name = name; return m;
};
const plane = (size: number, y = 0, name = 'Grass') => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size, 1, 1), new THREE.MeshBasicMaterial());
  m.rotation.x = -Math.PI / 2; m.position.y = y; m.name = name; return m;
};

describe('the kit ships the door with the race starter, and only with it', () => {
  it('play/raceCustom.ts comes with RacingRoadGame and is imported by it; a non-race shell has neither', () => {
    const race = generateGameShell(['racingroadgame']).files;
    expect(race[RACE_CUSTOM_PATH]).toBeTruthy();
    expect(race['src/game/RacingRoadGame.tsx']).toMatch(/from '\.\/play\/raceCustom'/);
    expect(generateGameShell(['game', 'gamecanvas']).files[RACE_CUSTOM_PATH]).toBeUndefined();
  });
  it('the starter reads src/game/car.ts and src/game/track.ts by itself, and its props win', () => {
    expect(RC.projectRaceChoices()).toEqual({ car: { color: 0x1e88e5, model: 'public/models/my-car.glb' }, track: null });
    const src = generateGameShell().files['src/game/RacingRoadGame.tsx'];
    expect(src).toMatch(/const carChoice = carProp \?\? own\.car \?\? undefined;/);
    expect(src).toMatch(/const trackChoice = trackProp \?\? own\.track \?\? undefined;/);
    expect(src).toMatch(/\[plan, opponents, finishKm, carChoice, trackChoice\]/);
  });
  it('a project file is told from a library subject, and served from public/', () => {
    expect(RC.isProjectModelFile('public/models/my-car.glb')).toBe(true);
    expect(RC.isProjectModelFile('sports car')).toBe(false);
    expect(RC.projectModelUrl('public/models/my-car.glb')).toBe('/models/my-car.glb');
    expect(RC.projectModelUrl('/models/x.gltf')).toBe('/models/x.gltf');
  });
});

describe('🚗 the user\'s own car', () => {
  it('a model is sized to the car: its long side becomes modelLength, wheels on the road, centred on the car', () => {
    const fitted = RC.fitCarModel(box(2, 1.2, 8), { modelLength: 4 });
    const b = new THREE.Box3().setFromObject(fitted);
    expect(b.max.z - b.min.z).toBeCloseTo(4, 5);
    expect(b.min.y).toBeCloseTo(0, 5);
    expect((b.max.x + b.min.x) / 2).toBeCloseTo(0, 5);
    expect((b.max.z + b.min.z) / 2).toBeCloseTo(0, 5);
  });
  it('modelYaw turns a model whose nose points sideways; modelLift raises it', () => {
    const fitted = RC.fitCarModel(box(8, 1, 2), { modelYaw: 90, modelLength: 4.3, modelLift: 0.1 });
    const b = new THREE.Box3().setFromObject(fitted);
    expect(b.max.z - b.min.z).toBeCloseTo(4.3, 4);
    expect(b.max.x - b.min.x).toBeCloseTo(4.3 / 4, 4);
    expect(b.min.y).toBeCloseTo(0.1, 5);
  });
  it('the kit car keeps driving; its body is hidden only once the model is really there', async () => {
    const car = O.createCar({ detail: 'lite' });
    const kitParts = car.children.length;
    const handle = RC.applyCarChoice(car, { model: 'public/models/my-car.glb', modelLength: 4.3 }, async (name: string) => { expect(name).toBe('public/models/my-car.glb'); return box(2, 1.4, 4.5); });
    expect(handle.showing).toBe('kit');
    await handle.ready;
    expect(handle.showing).toBe('model');
    expect(handle.error).toBeNull();
    expect(car.children.slice(0, kitParts).every((c: THREE.Object3D) => !c.visible)).toBe(true);
    expect(car.children[kitParts].name).toBe('car model');
    // It is still the kit's vehicle: the controls drive it.
    let drive = O.createVehicleState(car);
    for (let i = 0; i < 60; i++) drive = O.driveVehicle(car, drive, { x: 0, y: -1 }, 1 / 60);
    expect(car.position.z).toBeGreaterThan(1);
    handle.dispose();
    expect(car.children.length).toBe(kitParts);
    expect(car.children.every((c: THREE.Object3D) => c.visible)).toBe(true);
  });
  it('a model that cannot be loaded is SAID — with the reason — and the standard car stays (never a silent swap)', async () => {
    const car = O.createCar({ detail: 'lite' });
    const heard: string[] = [];
    const errors: unknown[] = []; const log = console.error; console.error = (m: unknown) => { errors.push(m); };
    try {
      const handle = RC.applyCarChoice(car, { model: 'public/models/missing.glb' }, async () => { throw new Error('the file public/models/missing.glb could not be loaded (404)'); }, (m: string) => heard.push(m));
      await handle.ready;
      expect(handle.showing).toBe('kit');
      expect(handle.error).toMatch(/^Your car "public\/models\/missing\.glb" could not be used: the file public\/models\/missing\.glb could not be loaded \(404\)\. The standard car is shown instead\.$/);
      expect(heard).toEqual([handle.error]);
      expect(car.children.every((c: THREE.Object3D) => c.visible)).toBe(true);
      const empty = RC.applyCarChoice(O.createCar({ detail: 'lite' }), { model: 'x.glb' }, async () => new THREE.Group());
      await empty.ready;
      expect(empty.error).toMatch(/the model is empty/);
    } finally { console.error = log; }
    expect(errors.length).toBeGreaterThan(0);
  });
  it('no model chosen: nothing is loaded and nothing changes', async () => {
    let called = false;
    const handle = RC.applyCarChoice(O.createCar({ detail: 'lite' }), { color: 0x00ff00, model: null }, async () => { called = true; return box(1, 1, 1); });
    await handle.ready;
    expect(called).toBe(false);
    expect(handle.showing).toBe('kit');
  });
  it('a library subject the game never saved is refused with how to fix it (the kit loader itself)', async () => {
    await expect(RC.loadRaceModel('sports car')).rejects.toThrow(/"sports car" is not one of this game's saved models — add it from the game library first, or attach the file/);
    await expect(RC.loadRaceModel('  ')).rejects.toThrow(/no model was named/);
  });
});

describe('🛣️ the user\'s own track', () => {
  it('an oval road on grass: the racing line runs round the middle of the road, one lap is its length, the car starts on it', () => {
    const model = new THREE.Group(); model.add(plane(300, -0.05), ring(50, 60));
    const built = RC.createModelTrack(model, { laps: 2, name: 'Oval' });
    expect(built.ok).toBe(true);
    const t = built.track;
    expect(t.length).toBeGreaterThan(2 * Math.PI * 55 * 0.95);
    expect(t.length).toBeLessThan(2 * Math.PI * 55 * 1.05);
    for (const p of t.line) expect(Math.hypot(p.x, p.z)).toBeGreaterThan(51), expect(Math.hypot(p.x, p.z)).toBeLessThan(59);
    expect(Math.hypot(t.startPose.x, t.startPose.z)).toBeCloseTo(55, -0.3);
    expect(t.laps).toBe(2);
    expect(t.name).toBe('Oval');
    expect(t.heightAt(55, 0)).toBeGreaterThan(-0.01);
    // The model is the world's ground (markWorldCollider), so the kit's movers know it.
    expect(model.userData.navbharatWorldCollider).toBe('ground');
  });
  it('driving round counts laps; rivals drive the same line; the race finishes after the laps', () => {
    const model = new THREE.Group(); model.add(ring(50, 60));
    const t = RC.createModelTrack(model, { laps: 2 }).track;
    const car = new THREE.Object3D();
    let status: any;
    const steps = 400;
    for (let i = 0; i <= steps * 2 + 5; i++) {
      const p = t.poseAt((i / steps) * t.length);
      car.position.set(p.x, 0, p.z);
      status = t.update(car);
    }
    expect(status.distance).toBeGreaterThan(t.length * 1.98);
    expect(status.lap).toBe(2);
    // Backwards is not progress.
    const back = t.poseAt(t.length * 2 - 30); car.position.set(back.x, 0, back.z);
    expect(t.update(car).distance).toBeLessThan(status.distance);
    t.reset();
    const s0 = t.poseAt(0); car.position.set(s0.x, 0, s0.z);
    expect(Math.abs(t.update(car).distance)).toBeLessThan(2);

    const scene = new THREE.Scene();
    const race = RACE.createRace(scene, { stream: t, opponents: 3, countdown: 0, finishDistance: t.laps * t.length });
    for (let i = 0; i < 120; i++) race.update(1 / 60, 0);
    for (const r of race.rivals) {
      expect(r.car.visible).toBe(true);
      const d = Math.hypot(r.car.position.x, r.car.position.z);
      expect(d).toBeGreaterThan(50 - 3); expect(d).toBeLessThan(60 + 3);
    }
    let st = race.status();
    for (let i = 0; i < 60 * 120 && st.phase !== 'finished'; i++) st = race.update(1 / 60, t.laps * t.length + 1);
    expect(st.phase).toBe('finished');
    race.dispose();
  });
  it('the car drives ON the track: a raised road is the ground under it', () => {
    const model = new THREE.Group(); model.add(plane(300, 0), ring(50, 60, 2));
    const t = RC.createModelTrack(model, {}).track;
    expect(t.heightAt(55, 0)).toBeCloseTo(2, 1);
    expect(t.startPose.y).toBeCloseTo(2, 1);
    const car = O.createCar({ detail: 'lite' });
    car.position.set(t.startPose.x, 0, t.startPose.z); car.rotation.y = t.startPose.heading;
    const tuning = { ground: t.heightAt };
    let drive = O.createVehicleState(car, tuning);
    for (let i = 0; i < 30; i++) drive = O.driveVehicle(car, drive, { x: 0, y: -1 }, 1 / 60, tuning);
    expect(car.position.y).toBeCloseTo(2, 1);
  });
  it('reverse drives the loop the other way; an explicit line is used as given', () => {
    const model = new THREE.Group(); model.add(ring(50, 60));
    const fwd = RC.createModelTrack(model.clone(), {}).track, rev = RC.createModelTrack(model.clone(), { reverse: true }).track;
    const turn = (t: any) => { const a = t.poseAt(10), b = t.poseAt(30); return Math.sign(a.x * b.z - a.z * b.x); };
    expect(turn(fwd)).toBe(-turn(rev));
    const flat = new THREE.Group(); flat.add(plane(400, 0, 'Ground'));
    const line = RC.createModelTrack(flat, { line: [[-100, -50], [100, -50], [100, 50], [-100, 50]] });
    expect(line.ok).toBe(true);
    expect(line.track.length).toBeCloseTo(600, -1);
  });
  it('a miniature model (5 units across) is scaled to a raceable size, and the user is told', () => {
    const model = new THREE.Group(); model.add(ring(2, 2.5));
    const built = RC.createModelTrack(model, {});
    expect(built.ok).toBe(true);
    expect(built.notes.join(' ')).toMatch(/scaled up to 400 m \(set TRACK\.size to choose\)/);
    expect(RC.createModelTrack(model.clone(), { size: 200 }).notes).toEqual([]);
  });
  it('🔴 what cannot be raced on is refused with the reason — never a fake racing line', () => {
    const flat = new THREE.Group(); flat.add(plane(300, 0, 'Ground'));
    const open = RC.createModelTrack(flat, {});
    expect(open.ok).toBe(false);
    expect(open.reason).toMatch(/one open flat surface, so the road cannot be told from the ground/);
    const strip = new THREE.Group(); strip.add(plane(300, -0.05, 'Grass'));
    const road = box(200, 0.1, 10, 'Road'); road.position.set(60, 0, 0); strip.add(road);
    expect(RC.createModelTrack(strip, {}).reason).toMatch(/does not go all the way round/);
    expect(RC.createModelTrack(new THREE.Group(), {}).reason).toMatch(/empty/);
    const tiny = new THREE.Group(); tiny.add(ring(5, 6));
    expect(RC.createModelTrack(tiny, { size: 12 }).reason).toMatch(/too short to race/);
    expect(RC.createModelTrack(flat.clone(), { line: [[0, 0], [1, 1]] }).reason).toMatch(/at least three/);
  });
  it('loadModelTrack never rejects: a model that does not load comes back as its reason', async () => {
    expect(await RC.loadModelTrack({ model: 'public/models/gone.glb' }, async () => { throw new Error('the file public/models/gone.glb could not be loaded (404)'); }))
      .toEqual({ ok: false, reason: 'the file public/models/gone.glb could not be loaded (404)' });
    expect((await RC.loadModelTrack({ model: '' })).reason).toMatch(/no track model/);
    const ok = await RC.loadModelTrack({ model: 'public/models/oval.glb', laps: 5 }, async () => { const g = new THREE.Group(); g.add(ring(50, 60)); return g; });
    expect(ok.ok).toBe(true);
    expect(ok.track.laps).toBe(5);
  });
});
