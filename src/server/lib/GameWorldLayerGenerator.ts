// THE WORLD LAYER (map expansion plan, item 5) — the big map under ANY game, following whatever the game says: the player on
// foot, a car, a camera. It is written into the project beside the open-world bridge (src/game/play/openWorld.ts) and is a
// thin layer over it: the bridge itself is not changed, so every open-world game is exactly what it was, and an edited bridge
// in an older project keeps working. Racing and sports games (items 7 and 8) mount the world through this file.

export const WORLD_LAYER_PATH = 'src/game/play/worldLayer.ts';

export const GAME_WORLD_LAYER = String.raw`// THE WORLD LAYER — NavBharatAI's big map (terrain, places, lands, highways, the corner and full map, the floating origin)
// under ANY game, following whatever the game says: the player on foot, a car, a camera. It is the open world
// (play/openWorld.ts) with a different thing to follow; with nothing to follow it IS the open world, the same in every way.
//   const world = createWorldLayer(ctx, { regions: WORLD.regions, follow: car });   // in setup()
//   world.frame(ctx, dt);                                                            // in update(), every frame
// The world streams the land around the followed thing, keeps walkable ground under it and, when the render origin moves
// far from the start, moves it, the camera, the player and everything placed with world.place() back together — so they
// never drift apart. Put anything else of yours that stands on the world in carry, or place it with world.place()
// (never both: a placed thing is already moved with the origin, and is not moved a second time).
import * as THREE from 'three';
import type { GameContext } from '../Game';
import { createOpenWorld, type OpenWorld, type OpenWorldOptions } from './openWorld';

export interface WorldLayerOptions extends OpenWorldOptions {
  /**
   * What the world follows: the land streams around it and the walkable ground stays under it. A thing (a car, the camera)
   * or a function giving it each frame (when the player gets in and out of cars). Left out: the player on foot.
   */
  follow?: THREE.Object3D | (() => THREE.Object3D | null | undefined);
  /** Put the followed thing at the world's start (on a street of the first place) when the world is made. Default true. */
  placeAtSpawn?: boolean;
  /** More of your things that move back with each origin shift (the player and the camera always do). */
  carry?: THREE.Object3D[];
}

export interface WorldLayer extends OpenWorld {
  /** What the world follows now. */
  readonly target: THREE.Object3D;
  /** Follow something else from the next frame (null: the player on foot again). */
  follow(target: THREE.Object3D | null): void;
  /** Move this thing back with each origin shift too (or stop: carry(object, false)). */
  carry(object: THREE.Object3D, on?: boolean): void;
}

export function createWorldLayer(ctx: GameContext, options: WorldLayerOptions = {}): WorldLayer {
  const { follow, placeAtSpawn = true, carry = [], ...worldOptions } = options;
  const pick = typeof follow === 'function' ? follow : null;
  let chosen: THREE.Object3D | null = (typeof follow === 'function' ? follow() : follow) ?? null;
  const target = (): THREE.Object3D => chosen ?? ctx.player.object;
  const carried = new Set<THREE.Object3D>(carry);
  // When the camera itself is followed, the world moves it once (as the followed thing), never a second time as the camera.
  const spareCamera = new THREE.PerspectiveCamera();
  let making = true;
  // The world reads ctx.player.object for where to stream, puts it at the start, and tells it where the sea is: here those
  // go to the followed thing. Everything else on ctx is the game's own, read through.
  const player = {
    get object() { return target(); },
    reset(x: number, y: number, z: number) {
      if (target() === ctx.player.object) ctx.player.reset(x, y, z);
      else if (!making || placeAtSpawn) target().position.set(x, y, z);
    },
    setWater(level: number) { if (target() === ctx.player.object) ctx.player.setWater(level); },
  };
  const view = Object.create(ctx) as GameContext;
  Object.defineProperty(view, 'player', { get: () => (target() === ctx.player.object ? ctx.player : player) });
  Object.defineProperty(view, 'camera', { get: () => (target() === ctx.camera ? spareCamera : ctx.camera) });
  // The game's own things keep their WORLD places across the first origin move (made while the world is made).
  const before = new Map<THREE.Object3D, THREE.Vector3>();
  const placed = new Set<THREE.Object3D>();
  const others = (): THREE.Object3D[] => {
    const list: THREE.Object3D[] = [];
    if (target() !== ctx.player.object) list.push(ctx.player.object);
    // The camera is moved by the world already (or is the followed thing); never a second time here.
    // A thing placed with world.place() is already moved by the bridge — never also as a carried thing.
    for (const o of carried) if (o !== target() && o !== ctx.player.object && o !== ctx.camera && !placed.has(o) && !list.includes(o)) list.push(o);
    return list;
  };
  for (const o of others()) before.set(o, o.position.clone());
  if (!placeAtSpawn && target() !== ctx.player.object) before.set(target(), target().position.clone());
  const world = createOpenWorld(view, worldOptions);
  making = false;
  const origin = world.map.chunks!.origin;
  for (const [o, p] of before) { o.position.x = p.x - origin.x; o.position.z = p.z - origin.z; }
  if (target() === ctx.camera) { ctx.camera.near = spareCamera.near; ctx.camera.far = spareCamera.far; ctx.camera.updateProjectionMatrix(); }
  const layer = Object.create(world) as WorldLayer;
  Object.defineProperty(layer, 'target', { get: target });
  const rawPlace = world.place.bind(world), rawRelease = world.release.bind(world);
  layer.place = (object, x, z, lift = 0) => { placed.add(object); carried.delete(object); rawPlace(object, x, z, lift); };
  layer.release = (object) => { placed.delete(object); rawRelease(object); };
  layer.follow = (next) => { chosen = next; };
  layer.carry = (object, on = true) => { if (on) { if (!placed.has(object)) carried.add(object); } else carried.delete(object); };
  layer.frame = (_ctx, delta) => {
    if (pick) { const next = pick(); if (next !== undefined) chosen = next; }
    const ox = origin.x, oz = origin.z;
    world.frame(view, delta);
    const dx = origin.x - ox, dz = origin.z - oz;
    if (dx || dz) for (const o of others()) { o.position.x -= dx; o.position.z -= dz; }
  };
  return layer;
}
`;
