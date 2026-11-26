/**
 * 🎬 ANY MOVE, ON ANY CHARACTER (admin 2026-11-26: "sabhi characters ke moves ko character se alag kar do … jaise user kahe
 * characters jump kare, hero car par laat mare, hero pani me taire, character car ka gate khole, character gun fire kare …
 * sirf hero nahi kisi bhi character par … police / villegers / bot, user jo bole woh kam kare").
 *
 * The class this locks: a move belonged to ONE character (its clip) and only the hero could be told to act. Moves are now a
 * library of data (120+) that plays on every body and every character — the player, one NPC, every NPC of a kind, or all —
 * and a move can move the whole body and touch the world. These run the REAL kit files (entities, actions, humanoid, water).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { generateGameController } from '../src/server/lib/GameControllerGenerator';
import { generateGameSystems } from '../src/server/lib/GameSystemsGenerator';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';
import { GAME_ENTITIES_PATH } from '../src/server/lib/GameEntitiesGenerator';
import { GAME_ACTIONS, GAME_ACTIONS_PATH, LIBRARY_ACTIONS, actionKey, validateAction } from '../src/server/lib/GameActionsGenerator';
import { MOVE_ALIASES, MOVE_LIBRARY, mirrorPose } from '../src/server/lib/gameMoveLibrary';
import { actionPrompt } from '../src/server/AgentV3/gameAssets/composeAction';
import { GAME_PHYSICS } from '../src/server/lib/GamePhysicsGenerator';

/* eslint-disable @typescript-eslint/no-explicit-any */
const DIR = join(__dirname, `.tmp-any-move-${process.pid}`);
let E: any; let EV: any; let ACT: any; let HM: any; let SURF: any;

beforeAll(async () => {
  const files: Record<string, string> = {
    ...generateGameRuntime().files, ...generateGame3D().files, ...generateGameController().files, ...generateGameSystems().files, ...generateGameShell().files,
  };
  for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), c); }
  E = await import(join(DIR, GAME_ENTITIES_PATH));
  EV = await import(join(DIR, 'src/game/core/events.ts'));
  ACT = await import(join(DIR, GAME_ACTIONS_PATH));
  HM = await import(join(DIR, 'src/game/three/humanoid.ts'));
  SURF = await import(join(DIR, 'src/game/three/surfaces.ts'));
}, 60_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

/** A small world: the player (the kit person) at the origin facing +Z, and a way to step every system. */
function world() {
  const scene = new THREE.Scene();
  const player = { object: new THREE.Group() };
  scene.add(player.object);
  const hero = HM.createHumanoid({ height: 1.75 });
  player.object.add(hero.root);
  const hooks = new Set<(dt: number) => void>();
  const ctx: any = {
    scene, player, hero,
    particles: { burst: () => {} },
    onStep: (fn: (dt: number) => void) => { hooks.add(fn); return () => { hooks.delete(fn); }; },
  };
  const npcs = new E.Entities(ctx);
  const step = (seconds: number, dt = 1 / 60) => {
    for (let t = 0; t < seconds; t += dt) { hero.update(dt, 0, true); for (const f of [...hooks]) f(dt); ACT.updateActions(ctx, dt); }
  };
  return { ctx, scene, hero, npcs, step };
}
function on(name: string) { const seen: any[] = []; const off = EV.events.on(name, (p: any) => seen.push(p)); return { seen, off }; }
const spawn = (npcs: any, kind: string, x: number, z: number) => npcs.spawn({ kind, x, z, hostile: false, patrolRadius: 3 });

describe('the move library — separate from every character', () => {
  it('has 120+ moves, each a unique name that validates to itself and actually moves something', () => {
    expect(LIBRARY_ACTIONS.length).toBeGreaterThanOrEqual(120);
    const names = LIBRARY_ACTIONS.map((a) => a.name);
    expect(new Set(names).size).toBe(names.length);
    for (const a of LIBRARY_ACTIONS) {
      expect(validateAction(a), a.name).toEqual(a);
      expect(a.keys.some((k) => Object.keys(k.pose).length || k.body) || (a.steps ?? []).length, a.name).toBeTruthy();
    }
  });

  it('has the moves the admin named, by their English AND Hindi names', () => {
    const lib = new Set(LIBRARY_ACTIONS.map((a) => a.name));
    for (const m of ['jump', 'kick-car', 'swim', 'open-car-door', 'fire-pistol', 'get-in-car', 'dance', 'salute', 'police-whistle', 'handcuff']) expect(lib.has(m), m).toBe(true);
    expect(actionKey('laat')).toBe('kick');
    expect(actionKey('tairna')).toBe('swim');
    expect(actionKey('car ka gate kholna')).toBe('open-car-door');
    expect(actionKey('goli chalana')).toBe('fire-pistol');
    expect(actionKey('kood')).toBe('jump');
  });

  it('🔒 every alias names a real move (an alias to nothing is a request silently dropped)', () => {
    const lib = new Set(LIBRARY_ACTIONS.map((a) => a.name));
    for (const [alias, target] of Object.entries(MOVE_ALIASES)) expect(lib.has(target), `${alias} → ${target}`).toBe(true);
  });

  it('🔒 the kit holds the SAME alias table and library as the server — one source, injected, never re-typed', () => {
    expect(GAME_ACTIONS).not.toContain('__ALIASES__');
    expect(GAME_ACTIONS).not.toContain('__LIBRARY__');
    for (const [alias, target] of Object.entries(MOVE_ALIASES)) expect(ACT.actionKey(alias), alias).toBe(target);
    expect(ACT.MOVES.length).toBe(LIBRARY_ACTIONS.length);
  });

  it('a mirrored pose swaps sides and the sideways direction', () => {
    expect(mirrorPose({ rightUpperArm: [-1, 0.2, 0.3] })).toEqual({ leftUpperArm: [1, 0.2, 0.3] });
    expect(MOVE_LIBRARY.length).toBeGreaterThan(100);
  });
});

describe('any character — not only the hero', () => {
  it('🔴 "police salute kare": every police character salutes; the villager and the player do not', () => {
    const { ctx, npcs, step } = world();
    const p1 = spawn(npcs, 'police', 3, 3); const p2 = spawn(npcs, 'police', -3, 3); const v = spawn(npcs, 'villager', 0, 6);
    const rest = p1.humanoid.joints.rightShoulder.quaternion.clone();
    expect(ACT.performAction(ctx, 'salute', 'police')).toBe(true);
    expect(ACT.currentAction(ctx, p1.object)).toBe('salute');
    expect(ACT.currentAction(ctx, p2.object)).toBe('salute');
    expect(ACT.currentAction(ctx, v.object)).toBeNull();
    expect(ACT.currentAction(ctx)).toBeNull();
    step(0.6);
    expect(p1.humanoid.joints.rightShoulder.quaternion.angleTo(rest)).toBeGreaterThan(0.5);
  });

  it('a plural or a Hindi-free kind works ("villagers"), and "all" is every character but the player', () => {
    const { ctx, npcs } = world();
    const a = spawn(npcs, 'villager', 2, 2); const b = spawn(npcs, 'villager', -2, 2); const c = spawn(npcs, 'bot', 0, 5);
    expect(ACT.performAction(ctx, 'dance', 'villagers')).toBe(true);
    expect([ACT.currentAction(ctx, a.object), ACT.currentAction(ctx, b.object), ACT.currentAction(ctx, c.object)]).toEqual(['dance', 'dance', null]);
    expect(ACT.performAction(ctx, 'namaste', 'all')).toBe(true);
    expect(ACT.currentAction(ctx, c.object)).toBe('namaste');
    expect(ACT.currentAction(ctx)).toBeNull();
  });

  it('nobody of that kind is said plainly, never a silent no-op', () => {
    const { ctx } = world();
    const hint = on('HINT');
    expect(ACT.performAction(ctx, 'jump', 'pirate')).toBe(false);
    hint.off();
    expect(hint.seen.some((h) => /pirate/.test(h.text))).toBe(true);
  });

  it('a character stands still while it acts, and walks again when the action ends', () => {
    const { ctx, npcs, step } = world();
    const v = spawn(npcs, 'villager', 4, 4);
    v.goTo({ x: 30, z: 30 });
    ACT.performAction(ctx, 'bow', v.object);
    const at = v.object.position.clone();
    step(0.5);
    expect(v.object.position.distanceTo(at)).toBeLessThan(0.05);
    step(1.5);
    expect(v.object.userData.acting).toBe(false);
    expect(v.object.position.distanceTo(at)).toBeGreaterThan(0.2);
  });
});

describe('moves that touch the world', () => {
  it('🔴 "hero villager ko laat mare": the kick lands on the character in front — it loses health; the one behind does not', () => {
    const { ctx, npcs, step } = world();
    const front = spawn(npcs, 'villager', 0, 1.2); const behind = spawn(npcs, 'villager', 0, -1.2);
    const struck = on('ACTION_STRUCK');
    expect(ACT.performAction(ctx, 'laat')).toBe(true);
    step(0.7);
    struck.off();
    expect(front.health.current).toBeLessThan(front.health.max);
    expect(behind.health.current).toBe(behind.health.max);
    expect(struck.seen[0]).toMatchObject({ by: 'player', target: 'villager', damage: 15 });
  });

  it('🔴 "hero car par laat mare": the car in front is struck with an impulse along the way the hero faces', () => {
    const { ctx, scene, step } = world();
    const car = new THREE.Group(); car.name = 'red car'; car.position.set(0, 0, 2);
    const hits: THREE.Vector3[] = [];
    car.userData.onStruck = (impulse: THREE.Vector3) => hits.push(impulse.clone());
    scene.add(car);
    expect(ACT.performAction(ctx, 'car par laat')).toBe(true);
    step(0.8);
    expect(hits).toHaveLength(1);
    expect(hits[0].z).toBeGreaterThan(5);
  });

  it('🔴 "police gun fire kare": the shot hits the first character in line, and only that one', () => {
    const { ctx, npcs, step } = world();
    const cop = spawn(npcs, 'police', 0, 0);
    cop.object.position.set(10, 0, 0); cop.model.rotation.y = 0; // faces +Z
    const target = spawn(npcs, 'bot', 0, 0); target.object.position.set(10, 0, 8);
    const aside = spawn(npcs, 'bot', 0, 0); aside.object.position.set(14, 0, 8);
    const fired = on('ACTION_FIRED');
    expect(ACT.performAction(ctx, 'goli chalana', 'police')).toBe(true);
    step(0.6);
    fired.off();
    expect(target.health.current).toBeLessThan(target.health.max);
    expect(aside.health.current).toBe(aside.health.max);
    expect(fired.seen[0]).toMatchObject({ by: 'police', hit: 'bot' });
  });

  it('a thrown item leaves the hand, flies forward and lands', () => {
    const { ctx, scene, step } = world();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.1)); ball.name = 'ball'; ball.userData.pickup = true; ball.position.set(0, 0, 0.6);
    scene.add(ball);
    const landed = on('ITEM_LANDED');
    ACT.performAction(ctx, 'pick-up'); step(1.1);
    expect(ACT.heldItem(ctx)).toBe(ball);
    ACT.performAction(ctx, 'throw'); step(3);
    landed.off();
    expect(ACT.heldItem(ctx)).toBeNull();
    expect(landed.seen.length).toBe(1);
    expect(ball.position.z).toBeGreaterThan(2);
  });

  it('🔴 "character car ka gate khole, gaadi me baithe, utre": an NPC opens the car, rides in it, and gets out beside it', () => {
    const { ctx, scene, npcs, step } = world();
    const v = spawn(npcs, 'villager', 0, 0); v.object.position.set(0, 0, 0);
    const car = new THREE.Group(); car.name = 'taxi'; car.position.set(1.5, 0, 1);
    let opened = 0; car.userData.interact = () => { opened++; };
    scene.add(car);
    ACT.performAction(ctx, 'car ka gate kholna', v.object); step(1);
    expect(opened).toBe(1);
    expect(ACT.performAction(ctx, 'get-in-car', v.object)).toBe(true); step(1.1);
    expect(v.object.visible).toBe(false);
    car.position.set(20, 0, 5); step(0.1);
    expect(v.object.position.distanceTo(car.position)).toBeLessThan(0.01);
    ACT.performAction(ctx, 'get-out-car', v.object); step(1);
    expect(v.object.visible).toBe(true);
    expect(v.object.position.distanceTo(car.position)).toBeGreaterThan(1);
  });

  it('the player gets in through the shell\'s own vehicle seats', () => {
    const { ctx, scene, step } = world();
    const car = new THREE.Group(); car.name = 'car'; scene.add(car);
    let seated: THREE.Object3D | null = null;
    ctx.vehicles = { inReach: car, get seated() { return seated; }, enter: (c: THREE.Object3D) => { seated = c; return true; }, exit: () => { seated = null; return true; } };
    expect(ACT.performAction(ctx, 'get-out-car')).toBe(false); // not in a car yet — said, not faked
    ACT.performAction(ctx, 'gaadi me baithna'); step(1.1);
    expect(seated).toBe(car);
  });
});

describe('the whole body, loops, stances and where a move can happen', () => {
  it('🔴 "hero pani me taire": refused on dry land (said why), swims in water, keeps swimming, and stops when told', () => {
    const { ctx, step } = world();
    const hint = on('HINT');
    expect(ACT.performAction(ctx, 'tairna')).toBe(false);
    hint.off();
    expect(hint.seen.some((h) => /water/.test(h.text))).toBe(true);
    const off = SURF.addWater((x: number, z: number) => Math.abs(x) < 50 && Math.abs(z) < 50);
    try {
      const at = ctx.player.object.position.clone();
      expect(ACT.performAction(ctx, 'swim')).toBe(true);
      step(3.7);
      expect(ACT.currentAction(ctx)).toBe('swim');
      expect(ctx.player.object.position.z - at.z).toBeGreaterThan(3);
      ACT.stopAction(ctx);
      expect(ACT.currentAction(ctx)).toBeNull();
      expect(ctx.hero.root.parent.position.length()).toBe(0);
    } finally { off(); }
  });

  it('🔴 "character jump kare": the whole body rises, and is back on its feet after', () => {
    const { ctx, npcs, step } = world();
    const bot = spawn(npcs, 'bot', 3, 3);
    ACT.performAction(ctx, 'jump', 'bot');
    let peak = 0;
    for (let i = 0; i < 60; i++) { step(1 / 60); const pivot = bot.humanoid.root.parent; peak = Math.max(peak, pivot.userData.actionPivot ? pivot.position.y : 0); }
    expect(peak).toBeGreaterThan(0.5);
    step(0.3);
    expect(bot.humanoid.root.parent.position.y).toBe(0);
  });

  it('a stance holds its last pose until the next move (sit), and the turn-around really turns', () => {
    const { ctx, step } = world();
    const done = on('ACTION_DONE');
    ACT.performAction(ctx, 'sit'); step(2);
    expect(ACT.currentAction(ctx)).toBe('sit');
    expect(done.seen.at(-1)).toMatchObject({ name: 'sit', holding: true });
    ACT.performAction(ctx, 'turn-around'); step(1);
    done.off();
    expect(Math.abs(ctx.hero.root.rotation.y - Math.PI)).toBeLessThan(0.05);
    expect(ACT.currentAction(ctx)).toBeNull();
  });
});

describe('a move NavBharatAI makes has the same vocabulary', () => {
  it('the prompt teaches the whole body, loops, places and the world-touching steps', () => {
    const p = actionPrompt('moonwalk', 'gliding backwards');
    for (const w of ['rise', 'forward', 'turn', 'loop', 'hold', 'requires', 'strike', 'fire', 'throw', 'enterVehicle', 'water']) expect(p, w).toContain(w);
  });

  it('a made move keeps its body, loop and place, clamped; nonsense is dropped, never guessed', () => {
    const def = validateAction({
      name: 'moonwalk', seconds: 2, loop: true, requires: 'water',
      keys: [{ t: 0, pose: {}, body: { forward: 0, rise: 99 } }, { t: 1, pose: { head: [0, 1, 0] }, body: { forward: -1.5, wobble: 3 } }],
      steps: [{ at: 0.5, do: 'strike', damage: 500, force: 99 }, { at: 0.6, do: 'teleport' }],
    })!;
    expect(def.loop).toBe(true);
    expect(def.requires).toBe('water');
    expect(def.keys[0].body).toEqual({ forward: 0, rise: 2.5 });
    expect(def.keys[1].body).toEqual({ forward: -1.5 });
    expect(def.steps).toEqual([{ at: 0.5, do: 'strike', damage: 100, force: 30 }]);
    expect(validateAction({ name: 'x', keys: [{ t: 0, pose: {} }], requires: 'moon' })).toBeNull();
    expect(validateAction({ name: 'x', requires: 'moon', keys: [{ t: 0, pose: {} }, { t: 1, pose: { head: [0, 1, 0] } }] })!.requires).toBeUndefined();
  });

  it('🔒 a physics body takes a kick as a real impulse, and only the hook physics installed is removed with it', () => {
    expect(GAME_PHYSICS).toContain('mesh.userData.onStruck = struck');
    expect(GAME_PHYSICS).toContain('if (ownStruck.get(mesh) === mesh.userData.onStruck) delete mesh.userData.onStruck;');
  });
});
