/**
 * BUILD 46e2d74b (admin 2026-10-11): "racing game me car ulti chal rahi hai" — the player's car showed its
 * HEADLIGHTS and LEFT turned it RIGHT; its reviewer also found "`updateGameState` never accelerates the car".
 * The build never called the game kit: it hand-wrote its engine in src/lib/game/*, where none of the kit's
 * guards (`driveVehicle`, `CameraRig.follow`, `createVehicleState` starting at speed 5) reach.
 *
 * `handWrittenVehicleScan.ts` reads a hand-written vehicle by its CODE SHAPE and the dispatcher says so at
 * write time, once per build, pointing at the kit. Every positive below has a negative beside it: a false
 * note costs a build a turn.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  vehicleShapeHalves, vehicleShapeFindings, handWrittenVehicleNote, type VehicleShapeHalves,
} from '../src/server/AgentV3/handWrittenVehicleScan';

/** Index a set of written files the way the dispatcher does, and read the findings. */
function findings(files: Record<string, string>) {
  const index = new Map<string, VehicleShapeHalves>();
  for (const [p, c] of Object.entries(files)) index.set(p, vehicleShapeHalves(p, c));
  return vehicleShapeFindings(index);
}
const kinds = (files: Record<string, string>) => findings(files).map((f) => f.kind).sort();

// The usual hand-written three.js chase camera, with a car that faces and drives +Z (the platform's own
// MODEL_FORWARD convention) — the geometry the investigation measured: headlights, mirrored steering.
const SCENE_FRONT = `import * as THREE from 'three';
export function updateCamera(camera: THREE.PerspectiveCamera, car: THREE.Group) {
  camera.position.x = car.position.x;
  camera.position.y = car.position.y + 3;
  camera.position.z = car.position.z + 6;
  camera.lookAt(car.position);
}`;
const CONTROLS_FORWARD = `export function updateGameState(state: GameState, car: THREE.Group, keys: Set<string>, dt: number) {
  if (keys.has('ArrowLeft')) car.rotation.y += 0.03;
  if (keys.has('ArrowRight')) car.rotation.y -= 0.03;
  car.position.x += Math.sin(car.rotation.y) * state.speed * dt;
  car.position.z += Math.cos(car.rotation.y) * state.speed * dt;
}`;

describe('camera-ahead — the camera on the side the car drives toward', () => {
  it('the 46e2d74b shape across two files (camera in scene.ts, motion in controls.ts) is found', () => {
    const f = findings({ 'src/lib/game/scene.ts': SCENE_FRONT, 'src/lib/game/controls.ts': CONTROLS_FORWARD });
    expect(f.find((x) => x.kind === 'camera-ahead')).toEqual({ kind: 'camera-ahead', path: 'src/lib/game/scene.ts', line: 'camera.position.z = car.position.z + 6;' });
  });

  it('every way of writing it: .set(…), lerp(new Vector3(…)), copy().add(new Vector3(…)), a car driving −Z under a −Z camera', () => {
    for (const cam of [
      'camera.position.set(car.position.x, car.position.y + 3, car.position.z + 6);',
      'camera.position.lerp(new THREE.Vector3(car.position.x, car.position.y + 3, car.position.z + 6), 0.1);',
      'camera.position.copy(car.position).add(new THREE.Vector3(0, 3, 6));',
    ]) {
      expect(kinds({ 'src/scene.ts': cam, 'src/controls.ts': CONTROLS_FORWARD }), cam).toContain('camera-ahead');
    }
    expect(kinds({ 'src/game.ts': 'camera.position.z = player.position.z - 8;\nplayer.position.z -= speed * dt;' })).toContain('camera-ahead');
    expect(kinds({ 'src/game.ts': 'camera.position.z = car.position.z + 8;\ncar.translateZ(speed * dt);' })).toContain('camera-ahead');
  });

  it('NEGATIVE: a real chase camera (behind the car, on either axis convention) is never named', () => {
    expect(kinds({ 'src/scene.ts': SCENE_FRONT.replace('car.position.z + 6', 'car.position.z - 6'), 'src/controls.ts': CONTROLS_FORWARD })).toEqual([]);
    expect(kinds({ 'src/game.ts': 'camera.position.z = car.position.z + 8;\ncar.position.z -= speed * dt;' })).toEqual([]);
    // Behind the heading: camera = car − forward × d.
    expect(kinds({
      'src/scene.ts': 'camera.position.x = car.position.x - Math.sin(car.rotation.y) * 8;\ncamera.position.z = car.position.z - Math.cos(car.rotation.y) * 8;',
      'src/controls.ts': CONTROLS_FORWARD,
    })).toEqual([]);
  });

  it('NEGATIVE: a lookAt target ahead of the car, a camera following something else, a top-down camera, a camera with no motion', () => {
    expect(kinds({ 'src/scene.ts': 'camera.position.set(car.position.x, 4, car.position.z - 9); camera.lookAt(new THREE.Vector3(car.position.x, 0, car.position.z + 10));', 'src/controls.ts': CONTROLS_FORWARD })).toEqual([]);
    expect(kinds({ 'src/scene.ts': 'cameraTarget.position.set(car.position.x, 0, car.position.z + 10);', 'src/controls.ts': CONTROLS_FORWARD })).toEqual([]);
    expect(kinds({ 'src/scene.ts': 'camera.position.z = ball.position.z + 6;', 'src/controls.ts': CONTROLS_FORWARD })).toEqual([]);
    expect(kinds({ 'src/scene.ts': 'camera.position.y = car.position.y + 20;\ncamera.position.x = car.position.x;', 'src/controls.ts': CONTROLS_FORWARD })).toEqual([]);
    expect(kinds({ 'src/scene.ts': SCENE_FRONT })).toEqual([]);
  });

  it('NEGATIVE: a car turned half a circle before it drives, or one that also reverses on another line, is left alone', () => {
    expect(kinds({ 'src/scene.ts': SCENE_FRONT + '\ncar.rotation.y = Math.PI;', 'src/controls.ts': CONTROLS_FORWARD })).toEqual([]);
    expect(kinds({ 'src/scene.ts': SCENE_FRONT, 'src/controls.ts': `${CONTROLS_FORWARD}\nif (reversing) car.position.z -= reverseSpeed * dt;` })).toEqual([]);
    // A quarter turn is not a flip: the finding stands.
    expect(kinds({ 'src/scene.ts': SCENE_FRONT + '\nwheel.rotation.y = Math.PI / 2;', 'src/controls.ts': CONTROLS_FORWARD })).toContain('camera-ahead');
  });

  it('NEGATIVE: the kit\'s own library files are never read (they are right by construction, and not the model\'s)', () => {
    expect(kinds({ 'src/game/three/camera.ts': SCENE_FRONT, 'src/game/play/vehicle.ts': CONTROLS_FORWARD })).toEqual([]);
  });
});

describe('stalled — a speed that starts at 0 and nothing ever raises', () => {
  const STATE = 'export interface GameState { speed: number; lap: number }\nexport const initialState: GameState = { speed: 0, lap: 1 };';
  const KEYS = "export const keys = new Set<string>();\naddEventListener('keydown', (e) => { if (e.key === 'ArrowUp') keys.add('ArrowUp'); });\n// a racing car";

  it('the 46e2d74b shape — "updateGameState never accelerates the car" — is found', () => {
    const f = findings({ 'src/lib/game/state.ts': STATE, 'src/lib/game/controls.ts': CONTROLS_FORWARD, 'src/lib/game/input.ts': KEYS });
    expect(f.find((x) => x.kind === 'stalled')).toMatchObject({ path: 'src/lib/game/state.ts' });
  });

  it('NEGATIVE: raised anywhere the build wrote — +=, an assignment, Math.min, a React setter, a non-zero start', () => {
    for (const raise of [
      'if (keys.has("ArrowUp")) state.speed += ACCELERATION * dt;',
      'state.speed = Math.min(state.speed + 0.2, MAX);',
      'setSpeed((s) => s + 1);',
    ]) {
      expect(kinds({ 'src/lib/game/state.ts': STATE, 'src/lib/game/controls.ts': CONTROLS_FORWARD, 'src/lib/game/input.ts': `${KEYS}\n${raise}` }), raise).not.toContain('stalled');
    }
    expect(kinds({ 'src/lib/game/state.ts': STATE.replace('speed: 0', 'speed: 5'), 'src/lib/game/controls.ts': CONTROLS_FORWARD, 'src/lib/game/input.ts': KEYS })).not.toContain('stalled');
  });

  it('NEGATIVE: not a vehicle, no accelerator, or a speed that moves nothing', () => {
    // A snake game: a speed setting at 0 that only paces the timer.
    expect(kinds({ 'src/Snake.tsx': "let speed = 0; const tick = () => setTimeout(step, 200 - speed); addEventListener('keydown', (e) => { if (e.key === 'ArrowUp') dir = UP; });" })).toEqual([]);
    expect(kinds({ 'src/lib/game/state.ts': STATE, 'src/lib/game/controls.ts': CONTROLS_FORWARD })).not.toContain('stalled');
  });
});

describe('axis-throttle — the kit\'s axis (UP is −1) used as throttle without its minus', () => {
  it('found when the throttle takes axis.y as it is; never when it takes −axis.y', () => {
    expect(kinds({ 'src/race.ts': 'const a = input.axis();\nconst throttle = a.y;\ncar.position.z += throttle * speed;' })).toContain('axis-throttle');
    expect(kinds({ 'src/race.ts': 'const a = input.axis();\nconst throttle = -a.y;\ncar.position.z += throttle * speed;' })).not.toContain('axis-throttle');
  });
});

describe('the note the builder reads, and where the dispatcher says it', () => {
  it('names the file, the line, the defect in words, and the kit that does it right', () => {
    const note = handWrittenVehicleNote(findings({ 'src/lib/game/scene.ts': SCENE_FRONT, 'src/lib/game/controls.ts': CONTROLS_FORWARD }));
    expect(note).toContain('🏎️ HAND-WRITTEN VEHICLE');
    expect(note).toContain('src/lib/game/scene.ts: `camera.position.z = car.position.z + 6;`');
    expect(note).toMatch(/HEADLIGHTS, and LEFT reads as RIGHT/);
    expect(note).toContain('run_recipe({ name: "generate_game_3d" })');
    expect(note).toMatch(/driveVehicle\(car, drive, input\.axis\(\), dt\)/);
    expect(note).toMatch(/rig\.follow\(car, dt\)/);
    expect(handWrittenVehicleNote([])).toBe('');
  });

  it('the dispatcher indexes every write and says it once per build, with the other write notes', () => {
    const src = readFileSync(join(__dirname, '../src/server/AgentV3/ToolDispatcher.ts'), 'utf8');
    expect(src).toContain('this._vehicleShapeIndex.set(p, vehicleShapeHalves(p, files[p]))');
    expect(src).toMatch(/vehicle = handWrittenVehicleNote\(found\); this\._vehicleShapeNoted = true;/);
    expect(src).toMatch(/\+ touch \+ vehicle \+ browserScript;/);
  });
});
