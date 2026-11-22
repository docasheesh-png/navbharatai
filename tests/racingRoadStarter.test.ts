import { describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import * as THREE from 'three';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';

// Execute the emitted component, not a duplicate starter implementation. WebGL is
// intentionally replaced; the real road geometry/stream is exercised separately.
function mountStarter(props: Record<string, unknown> = {}, raceCustom?: Record<string, unknown>) {
  let effect: (() => (() => void)) | undefined;
  const handlers = new Map<string, () => void>();
  const state = { status: 'playing' };
  const setters: ReturnType<typeof vi.fn>[] = [];
  let refIndex = 0, setterIndex = 0;
  let deps: unknown[] = [];
  const refs: Array<{ current: any }> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  let options: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const stream = { setPlan: vi.fn(() => true), root: new THREE.Group(), startPose: { x: 0, y: 0, z: 0, heading: 0 },
    update: vi.fn(), dispose: vi.fn() };
  const create = vi.fn(() => stream);
  const createRace = vi.fn((_scene: unknown, _options: unknown) => ({ canDrive: () => true, update: () => ({ position: 1, total: 4, time: 0 }), dispose: () => {} }));
  const game = { start: vi.fn(), pause: vi.fn(), resume: vi.fn(), dispose: vi.fn() };
  const context = { scene: new THREE.Scene(), follow: vi.fn(), input: { axis: () => ({ x: 0, y: -1 }) },
    player: { object: new THREE.Object3D(), reset(x: number, y: number, z: number) { this.object.position.set(x, y, z); } }, camera: new THREE.PerspectiveCamera(),
    lights: { key: new THREE.DirectionalLight(), hemisphere: new THREE.HemisphereLight(), ambient: new THREE.AmbientLight() } };
  const modules: Record<string, unknown> = {
    react: { useRef: (initial: unknown) => { const i = refIndex++; return refs[i] ?? (refs[i] = { current: initial as any }); }, // eslint-disable-line @typescript-eslint/no-explicit-any
      useState: (initial: unknown) => { const i = setterIndex++; const setter = setters[i] ?? (setters[i] = vi.fn()); return [initial, setter]; }, useEffect: (fn: typeof effect, nextDeps: unknown[]) => { effect = fn; deps = nextDeps; } },
    'react/jsx-runtime': { jsx: (type: unknown, props: unknown) => ({ type, props }), jsxs: (type: unknown, props: unknown) => ({ type, props }) },
    three: THREE,
    './core/events': { events: { on: (event: string, fn: () => void) => { handlers.set(event, fn); return () => handlers.delete(event); } } },
    './core/state': { state },
    './Game': { Game: class { constructor(o: unknown) { options = o; options.setup(context); return game; } } },
    './three/race': { createRace },
    './play/raceCustom': raceCustom ?? { projectRaceChoices: () => ({ car: null, track: null }), applyCarChoice: () => ({ showing: 'kit', error: null, ready: Promise.resolve(), dispose: () => {} }),
      loadModelTrack: async () => ({ ok: false, reason: 'not used here' }) },
    './three/objects': { createTrackStream: create, createCar: () => new THREE.Group(), createVehicleState: () => ({ speed: 20, heading: 0 }),
      driveVehicle: (_car: unknown, drive: unknown) => drive,
      RACING_ROAD_MAPS: Array.from({ length: 12 }, (_, i) => ({ id: i + 1, name: `Map ${i + 1}`, lengthKm: 10, lighting: i === 11 ? 'night' : 'day' })) },
  };
  const code = ts.transpileModule(generateGameShell().files['src/game/RacingRoadGame.tsx'], {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports: any = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
  new Function('require', 'exports', code)((name: string) => {
    if (!(name in modules)) throw new Error(`Unexpected import ${name}`);
    return modules[name];
  }, exports);
  const canvas = { focus: vi.fn() };
  const tree = exports.RacingRoadGame(props);
  refs[0].current = { querySelector: (selector: string) => selector === 'canvas' ? canvas : null };
  refs[1].current = { textContent: '' };
  let cleanup = effect!();
  const rerender = (nextProps: Record<string, unknown>) => {
    const previous = deps; refIndex = 0; setterIndex = 0;
    exports.RacingRoadGame(nextProps);
    if (deps.some((dep, i) => !Object.is(dep, previous[i]))) { cleanup(); cleanup = effect!(); }
  };
  const dispose = () => cleanup();
  return { rerender, tree, state, handlers, setters, refs, get options() { return options; }, context, stream, create, createRace, game, canvas, dispose };
}

describe('generated racing starter actually consumes the reusable library', () => {
  it('constructs default stream and shows all12 identities, distinct themes and12→1 loop', () => {
    const m = mountStarter();
    expect(m.create).toHaveBeenCalledWith(undefined, { detail: 'lite' });
    expect(m.game.start).toHaveBeenCalledOnce();
    expect(m.context.follow).toHaveBeenCalledOnce();
    const skies = new Set<number>();
    for (let step = 0; step < 13; step++) {
      const id = step % 12 + 1;
      m.stream.update.mockReturnValue({ segment: { startDistance: step * 10000, piece: { mapId: id, mapOffsetMetres: 0 } }, distance: step * 10000 + 250, lap: Math.floor(step / 12), rebased: null });
      m.options.update(m.context, 0.2);
      expect(m.refs[1].current.textContent).toContain(`${String(id).padStart(2, '0')}/12 · Map ${id}`);
      expect(m.refs[1].current.textContent).toContain(`Loop ${Math.floor(step / 12) + 1}`);
      skies.add((m.context.scene.background as THREE.Color).getHex());
      expect(m.context.lights.key.intensity).toBe(id === 12 ? 0.6 : 2.2);
    }
    expect(skies.size).toBe(12);
    m.dispose(); expect(m.stream.dispose).toHaveBeenCalledOnce(); expect(m.game.dispose).toHaveBeenCalledOnce();
  });
  it('keeps the player/camera aligned on floating-origin shifts and remounts independently', () => {
    for (let repeat = 0; repeat < 2; repeat++) {
      const m = mountStarter();
      m.stream.update.mockReturnValue({ segment: { piece: { mapId: 1 }, startDistance: 0 }, distance: 0, lap: 0, rebased: new THREE.Vector3(800, 0, 900) });
      m.options.update(m.context, 0.2);
      expect(m.context.player.object.position.toArray()).toEqual([-800, 0, -900]);
      expect(m.context.camera.position.toArray()).toEqual([-800, 0, -900]);
      m.dispose(); expect(m.game.dispose).toHaveBeenCalledOnce();
    }
  });
  it('a selected starter also includes Game and touch-control dependencies', () => {
    const files = generateGameShell(['racingroadgame']).files;
    expect(files['src/game/Game.ts']).toBeTruthy();
    expect(files['src/game/ui/touchControls.ts']).toBeTruthy();
  });
});

 it('background pause updates UI and the next click resumes instead of pausing twice', () => {
  const m = mountStarter();
  m.state.status = 'paused'; m.handlers.get('GAME_PAUSED')!();
  expect(m.setters[1]).toHaveBeenLastCalledWith(true);
  const button = m.tree.props.children.find((child: any) => child?.type === 'button');
  button.props.onClick(); expect(m.game.resume).toHaveBeenCalledOnce();
  m.state.status = 'playing'; m.handlers.get('GAME_RESUMED')!();
  expect(m.setters[1]).toHaveBeenLastCalledWith(false);
  m.dispose(); expect(m.handlers.size).toBe(0);
 });

it('returns keyboard focus to the driving canvas after activating Resume', () => {
  const m = mountStarter();
  const button = m.tree.props.children.find((child: any) => child?.type === 'button');
  button.props.onClick();
  expect(m.game.pause).toHaveBeenCalledOnce();
  expect(m.canvas.focus).not.toHaveBeenCalled();
  m.state.status = 'paused';
  // Both pointer clicks and keyboard activation reach this emitted React handler.
  button.props.onClick();
  expect(m.game.resume).toHaveBeenCalledOnce();
  expect(m.canvas.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
  m.dispose();
  button.props.onClick();
  expect(m.canvas.focus).toHaveBeenCalledOnce();
});

it('starter accepts arbitrary custom plans and exposes the live editable stream', () => {
  const plan = { loop: 'infinite', pieces: [{ kind: 'straight', length: 70, name: 'My road' }] };
  const ready = vi.fn();
  const m = mountStarter({ plan, onReady: ready });
  expect(m.create).toHaveBeenCalledWith(plan, { detail: 'lite' });
  expect(ready).toHaveBeenCalledWith(m.stream);
  const changed = { pieces: [{ kind: 'hill', length: 80 }, { kind: 'curve', length: 90 }] };
  ready.mock.calls[0][0].setPlan(changed, { now: true });
  expect(m.stream.setPlan).toHaveBeenCalledWith(changed, { now: true });
  m.stream.update.mockReturnValue({ segment: { piece: { name: 'My road' }, startDistance: 0, length: 70 }, distance: 20, lap: 0, rebased: null });
  m.options.update(m.context, 0.2);
  expect(m.refs[1].current.textContent).toContain('My road');
  expect(m.refs[1].current.textContent).not.toContain('/12');
  m.dispose();
});

it('plan identity changes restart with all settings; stable plans do not silently recreate the game', () => {
  const first = { width: 7, pieces: [{ kind: 'straight', length: 60 }] };
  const m = mountStarter({ plan: first });
  const ready = vi.fn();
  m.rerender({ plan: first, onReady: ready });
  expect(m.create).toHaveBeenCalledTimes(1);
  const replacement = { width: 14, seed: 88, ahead: 6, loop: 'none', pieces: [{ kind: 'water', length: 80 }] };
  m.rerender({ plan: replacement, onReady: ready });
  expect(m.game.dispose).toHaveBeenCalledTimes(1);
  expect(m.stream.dispose).toHaveBeenCalledTimes(1);
  expect(m.create).toHaveBeenLastCalledWith(replacement, { detail: 'lite' });
  expect(ready).toHaveBeenCalledWith(m.stream);
  expect(m.game.start).toHaveBeenCalledTimes(2);
  m.dispose();
});

describe("the user's own car and track reach the running starter", () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const ownTrack = () => {
    const root = new THREE.Group();
    let distance = 0;
    return { root, name: 'My Oval', length: 400, laps: 3, startPose: { x: 55, y: 0, z: 0, heading: 0 }, heightAt: () => 0, line: [],
      update: vi.fn(() => ({ distance: (distance += 10), lap: Math.floor(distance / 400), segment: null, ended: false, rebased: null })),
      poseAt: () => null, reset: vi.fn(), dispose: vi.fn() };
  };
  it('a track model: no road library is streamed, the race runs its laps on it, and the HUD shows the laps', async () => {
    const track = ownTrack();
    const applied: unknown[] = [];
    const m = mountStarter({ track: { model: 'public/models/oval.glb', laps: 3 }, car: { model: 'public/models/my-car.glb', color: 0x00ff00 } }, {
      projectRaceChoices: () => ({ car: null, track: null }),
      applyCarChoice: (_car: unknown, choice: unknown) => { applied.push(choice); return { dispose: () => {} }; },
      loadModelTrack: vi.fn(async (choice: { model: string }) => { expect(choice.model).toBe('public/models/oval.glb'); return { ok: true, track, notes: [] }; }),
    });
    // Loading is said on screen first; the game starts once the track is read.
    expect(m.setters[3]).toHaveBeenCalledWith('Loading your track...');
    expect(m.game.start).not.toHaveBeenCalled();
    await flush();
    expect(m.game.start).toHaveBeenCalledOnce();
    expect(m.create).not.toHaveBeenCalled();
    expect(m.createRace).toHaveBeenCalledWith(m.context.scene, { stream: track, opponents: 3, finishDistance: 1200 });
    expect(m.context.scene.children).toContain(track.root);
    expect(applied).toEqual([{ model: 'public/models/my-car.glb', color: 0x00ff00 }]);
    m.options.update(m.context, 0.25);
    expect(m.refs[1].current.textContent).toContain('My Oval · Lap 1/3');
    expect(m.setters[3]).toHaveBeenLastCalledWith(null);
    m.dispose();
    expect(track.dispose).toHaveBeenCalledOnce();
  });
  it('🔴 a track that cannot be raced on is SAID on screen with its reason, and the race runs on the road library', async () => {
    const m = mountStarter({ track: { model: 'public/models/flat.glb' } }, {
      projectRaceChoices: () => ({ car: null, track: null }),
      applyCarChoice: () => ({ dispose: () => {} }),
      loadModelTrack: async () => ({ ok: false, reason: 'the whole model is one open flat surface' }),
    });
    await flush();
    expect(m.setters[3]).toHaveBeenLastCalledWith('Your track "public/models/flat.glb" cannot be raced on: the whole model is one open flat surface. This race runs on the road library instead.');
    expect(m.create).toHaveBeenCalledOnce();
    expect(m.game.start).toHaveBeenCalledOnce();
    m.dispose();
  });
  it('the game\'s own car.ts and track.ts are used when no prop is given', async () => {
    const track = ownTrack();
    const loadModelTrack = vi.fn(async () => ({ ok: true, track, notes: [] }));
    const m = mountStarter({}, { projectRaceChoices: () => ({ car: { color: 1 }, track: { model: 'public/models/oval.glb' } }), applyCarChoice: () => ({ dispose: () => {} }), loadModelTrack });
    await flush();
    expect(loadModelTrack).toHaveBeenCalledWith({ model: 'public/models/oval.glb' });
    m.dispose();
  });
});
