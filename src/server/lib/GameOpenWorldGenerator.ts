// THE OPEN-WORLD STARTER (failedbr #2485, 2026-11-21 — admin: "is game me to map aya hi nahi, bas ek character aya … jo
// joystick se hawa me move kar raha hai … library ka use kyu nahi ho raha, hona chahiye").
//
// 🔑 ROOT CAUSE. The platform laid down BOTH the big map (generate_athree_map) and the game shell (the player, the camera,
// the joystick) — and nothing joined them. The map streams terrain around a camera and re-bases its render origin; the
// character controller walks on collider meshes; a city is built flat at y = 0. Joining the three (a walkable ground from
// the map's height function, a floating origin for everything the game adds, ground levelled under a city) was left to the
// builder's first turn. A weak builder wrote its own game instead, 70 steps of it, and the user got a character walking on
// the controller's implicit y = 0 with no world under it. 🧬 THE CLASS: two kit layers that only work together, shipped with
// no code between them. The join is kit code now, tested in a real browser, and the starter is playable as it stands:
// a builder that adds nothing still delivers a character in a city on the big map.
/** The shape every game recipe returns (gameRecipeLayers.RecipeOutput), with its instructions. */
interface RecipeOutput { files: Record<string, string>; dependencies?: Array<{ name: string; version: string }>; instructions: string }

export const GAME_OPEN_WORLD_BRIDGE = String.raw`// THE BRIDGE BETWEEN THE BIG MAP AND THE GAME — the player, the camera and everything the game adds stand ON the Athree
// world. The map streams terrain around the player and re-bases its render origin far from the start; the character
// controller walks on collider meshes. This module joins the two: a small invisible ground mesh, sampled from the map's own
// height function, follows the player (so feet meet exactly the ground that is drawn), the sea is water to swim in, and an
// origin shift moves the player and every anchored object together. Use createOpenWorld() in setup() and world.frame() in
// update(); place your own things with world.place(object, x, z).
import * as THREE from 'three';
import type { GameContext } from '../Game';
import { markWorldCollider } from '../three/collision';
import { createAthreeMap, type AthreeMap, type AthreeMapOptions } from '../athree';
import { createCity, planCity, type City, type CityOptions } from '../three/city';
import { createCityTraffic, type CityTraffic, type CityTrafficOptions } from '../three/citytraffic';
import { createCityPeople, type CityPeople, type CityPeopleOptions } from '../three/citypeople';
import { createCar } from '../three/objects';

export interface OpenWorldOptions extends Omit<AthreeMapOptions, 'three'> {
  /** Side of the walkable ground patch kept under the player, in metres. Default 96. */
  patchSize?: number;
  /**
   * A city on the map, on ground levelled for it near the start: streets, crossings, pavements, shops, apartments, offices,
   * houses and parks, with traffic that obeys the lights and people who cross on the zebras. true for the default city;
   * false (default) for open country only. The player starts on one of its streets.
   */
  city?: boolean | (CityOptions & { traffic?: CityTrafficOptions | false; people?: CityPeopleOptions | false; parkedCars?: number });
}

/** The city standing on the map. Its own numbers (plan, routes, lots) are in CITY metres: use toWorld() to leave it. */
export interface OpenWorldCity {
  readonly city: City;
  readonly traffic: CityTraffic | null;
  readonly people: CityPeople | null;
  /** The city's centre in WORLD metres, and the height of its ground. */
  readonly centre: { x: number; y: number; z: number };
  /** Parked cars the player can get into (already given to ctx.vehicles). */
  readonly parked: THREE.Object3D[];
  /** A CITY point (plan.lots, city.route …) as a WORLD place. */
  toWorld(x: number, z: number): { x: number; z: number };
}

export interface OpenWorld {
  readonly map: AthreeMap;
  /** The city, when options.city asked for one. */
  readonly city: OpenWorldCity | null;
  /** Where the player starts: WORLD metres. */
  readonly spawn: { x: number; y: number; z: number };
  /** The player's position in WORLD metres (what the map's own functions take). */
  playerWorld(): { x: number; y: number; z: number };
  /** Ground height at a WORLD place — the same height the terrain is drawn at. */
  heightAt(x: number, z: number): number;
  /** Put an object on the ground at a WORLD place (lift = metres above it). It then follows origin shifts by itself. */
  place(object: THREE.Object3D, x: number, z: number, lift?: number): void;
  /** Stop tracking an object placed with place(). */
  release(object: THREE.Object3D): void;
  /** Call once per update(): streams the map, keeps the ground under the player, applies origin shifts. */
  frame(ctx: GameContext, delta: number): void;
  dispose(): void;
}

export function createOpenWorld(ctx: GameContext, options: OpenWorldOptions = {}): OpenWorld {
  const { patchSize = 96, city: cityOption = false, ...mapOptions } = options;
  const map = createAthreeMap({ profile: 'open-world', quality: 'mid', skyOptions: { lights: false }, ...mapOptions, three: THREE } as AthreeMapOptions);
  const chunks = map.chunks!;
  ctx.scene.add(chunks.group);
  (map as { sky?: { applyTo(scene: THREE.Scene): void } | null }).sky?.applyTo(ctx.scene);
  ctx.camera.near = 0.3; ctx.camera.far = 9000; ctx.camera.updateProjectionMatrix();

  // The walkable ground: a grid whose heights are the map's, rebuilt as the player moves on.
  const cells = 32;
  const geometry = new THREE.PlaneGeometry(patchSize, patchSize, cells, cells);
  geometry.rotateX(-Math.PI / 2);
  const ground = markWorldCollider(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ visible: false })), 'ground');
  ground.frustumCulled = false;
  ctx.scene.add(ground);
  const centre = { x: Number.NaN, z: Number.NaN };
  const step = patchSize / cells;
  const layGround = (wx: number, wz: number): void => {
    const cx = Math.round(wx / step) * step, cz = Math.round(wz / step) * step;
    if (Math.abs(cx - centre.x) < patchSize * 0.2 && Math.abs(cz - centre.z) < patchSize * 0.2) {
      ground.position.set(centre.x - chunks.origin.x, 0, centre.z - chunks.origin.z);
      return;
    }
    centre.x = cx; centre.z = cz;
    const p = geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setY(i, map.world.heightAt(cx + p.getX(i), cz + p.getZ(i)));
    p.needsUpdate = true;
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    ground.position.set(cx - chunks.origin.x, 0, cz - chunks.origin.z);
    ground.updateMatrixWorld(true);
  };

  const s = map.world.spawnPoints('player', 1)[0] ?? { x: 0, y: map.world.heightAt(0, 0), z: 0, heading: 0 };
  const spawn = { x: s.x, y: map.world.heightAt(s.x, s.z), z: s.z };

  // THE CITY: the flattest dry place near the start is levelled (before any terrain is drawn), and the city stands on it.
  const cityRoot = new THREE.Group();
  let town: OpenWorldCity | null = null;
  let townLocal: THREE.Object3D | null = null;
  if (cityOption) {
    const { traffic: trafficOption, people: peopleOption, parkedCars = 4, ...cityOptions } = cityOption === true ? {} : cityOption;
    const plan = planCity(cityOptions);
    const hx = plan.width / 2 + 8, hz = plan.depth / 2 + 8;
    let best = { x: spawn.x, z: spawn.z, cost: Number.POSITIVE_INFINITY };
    for (const ring of [0, 1, 2, 3]) for (let k = 0; k < (ring ? 8 : 1); k++) {
      const a = (k / 8) * Math.PI * 2, r = ring * Math.max(hx, hz) * 0.9;
      const cx = spawn.x + Math.cos(a) * r, cz = spawn.z + Math.sin(a) * r;
      let low = Number.POSITIVE_INFINITY, high = Number.NEGATIVE_INFINITY, wet = false;
      for (let i = -3; i <= 3 && !wet; i++) for (let j = -3; j <= 3; j++) {
        const x = cx + (i / 3) * hx, z = cz + (j / 3) * hz, h = map.world.heightAt(x, z);
        if (h < 2 || map.world.waterAt(x, z) || map.world.roadAt(x, z)) { wet = true; break; }
        low = Math.min(low, h); high = Math.max(high, h);
      }
      const cost = wet ? Number.POSITIVE_INFINITY : (high - low) + r * 0.01;
      if (cost < best.cost) best = { x: cx, z: cz, cost };
    }
    const y = map.world.levelGround(best.x, best.z, hx, hz, 60);
    const city = createCity(cityOptions);
    cityRoot.add(city.root);
    const traffic = trafficOption === false ? null : createCityTraffic(city, trafficOption || {});
    if (traffic) cityRoot.add(traffic.root);
    const people = peopleOption === false ? null : createCityPeople(city, { traffic, ...(peopleOption || {}) });
    if (people) cityRoot.add(people.root);
    townLocal = new THREE.Object3D(); cityRoot.add(townLocal);
    const parked: THREE.Object3D[] = [];
    const colours = [0xc8102e, 0x1d4ed8, 0xf59e0b, 0x111827, 0xe5e7eb, 0x15803d];
    for (let i = 0; i < Math.max(0, Math.min(12, parkedCars)); i++) {
      // Beside the kerb of a north-south street, between two crossings, nose along the street.
      const sx = plan.streetsX[(i * 2 + 1) % plan.streetsX.length];
      const z0 = plan.streetsZ[i % (plan.streetsZ.length - 1)], z1 = plan.streetsZ[(i % (plan.streetsZ.length - 1)) + 1];
      const car = createCar({ color: colours[i % colours.length] });
      car.position.set(sx + (plan.road / 2 - 1.3) * (i % 2 ? 1 : -1), city.heightAt(sx, (z0 + z1) / 2), z0 + (z1 - z0) * (0.3 + 0.4 * ((i * 0.37) % 1)));
      car.rotation.y = i % 2 ? Math.PI : 0;
      cityRoot.add(car); parked.push(car); ctx.vehicles.add(car);
    }
    town = { city, traffic, people, parked, centre: { x: best.x, y, z: best.z }, toWorld: (x, z) => ({ x: best.x + x, z: best.z + z }) };
    // Start on one of its streets.
    spawn.x = best.x + city.spawn.x; spawn.z = best.z + city.spawn.z; spawn.y = y + city.spawn.y;
  }
  map.update(spawn.x, spawn.z, 0, spawn.y);
  if (town) { cityRoot.position.set(town.centre.x - chunks.origin.x, town.centre.y, town.centre.z - chunks.origin.z); ctx.scene.add(cityRoot); cityRoot.updateMatrixWorld(true); }
  layGround(spawn.x, spawn.z);
  ctx.player.reset(spawn.x - chunks.origin.x, spawn.y + 0.2, spawn.z - chunks.origin.z);
  ctx.player.setWater(map.world.seaLevel);

  const anchored = new Map<THREE.Object3D, { x: number; z: number }>();
  let time = 0;
  const playerWorld = () => {
    const p = ctx.player.object.position;
    return { x: p.x + chunks.origin.x, y: p.y, z: p.z + chunks.origin.z };
  };
  return {
    map, spawn, playerWorld, city: town,
    heightAt: (x, z) => map.world.heightAt(x, z),
    place(object, x, z, lift = 0) {
      object.position.set(x - chunks.origin.x, map.world.heightAt(x, z) + lift, z - chunks.origin.z);
      anchored.set(object, { x, z });
      if (!object.parent) ctx.scene.add(object);
    },
    release(object) { anchored.delete(object); },
    frame(_ctx, delta) {
      time += delta;
      const at = playerWorld();
      const shift = map.update(at.x, at.z, time, at.y);
      if (shift) {
        // The render origin moved: everything that is not the map moves back by the same amount.
        ctx.player.object.position.x -= shift.dx; ctx.player.object.position.z -= shift.dz;
        ctx.camera.position.x -= shift.dx; ctx.camera.position.z -= shift.dz;
        for (const [object] of anchored) { object.position.x -= shift.dx; object.position.z -= shift.dz; }
        cityRoot.position.x -= shift.dx; cityRoot.position.z -= shift.dz;
      }
      layGround(at.x, at.z);
      if (town && townLocal) {
        // Traffic and people keep clear of the player: they are told where the player is in the CITY's own metres.
        townLocal.position.set(at.x - town.centre.x, at.y - town.centre.y, at.z - town.centre.z);
        const seated = ctx.vehicles.seated;
        town.traffic?.update(delta, seated ? [townLocal, seated] : [townLocal]);
        town.people?.update(delta, [townLocal]);
      }
    },
    dispose() {
      ctx.scene.remove(ground); geometry.dispose(); (ground.material as THREE.Material).dispose();
      if (town) { town.people?.dispose(); town.traffic?.dispose(); town.city.dispose(); ctx.scene.remove(cityRoot); }
      ctx.scene.remove(chunks.group); anchored.clear(); map.dispose();
    },
  };
}
`;

export const GAME_OPEN_WORLD_STARTER = String.raw`// THE OPEN-WORLD STARTER — a character on NavBharatAI's big map, playable as it stands: the kit's own animated person,
// the follow camera, the joystick and keys, terrain that streams as you walk, roads, plants, rivers, the sea and the sky.
// Make it your game through its props: setup() adds your things to the world (cars, enemies, pickups, missions) and
// update() runs your rules — never replace the world, the player or the camera.
import React, { useMemo, useRef } from 'react';
import { GameCanvas } from './GameCanvas';
import type { GameContext, GameOptions } from './Game';
import { createOpenWorld, type OpenWorld, type OpenWorldOptions } from './play/openWorld';

export interface OpenWorldGameProps {
  title?: string;
  subtitle?: string;
  /** The map: seed, profile, size, quality, style — see play/openWorld.ts and athree/. */
  world?: OpenWorldOptions;
  /** Add your game to the world. Runs once, after the player is standing on the map. */
  setup?: (ctx: GameContext, world: OpenWorld) => void;
  /** Your rules, at a fixed 60 Hz, after the world has streamed for this step. */
  update?: (ctx: GameContext, world: OpenWorld, delta: number) => void;
  /** Any other shell option (camera, touch buttons, language, music …). */
  options?: Omit<GameOptions, 'container' | 'setup' | 'update'>;
}

export function OpenWorldGame({ title = 'Open World', subtitle, world: worldOptions, setup, update, options }: OpenWorldGameProps) {
  const world = useRef<OpenWorld | null>(null);
  const hooks = useRef({ setup, update }); hooks.current = { setup, update };
  const gameOptions = useMemo<Omit<GameOptions, 'container'>>(() => ({
    camera: 'third-person', gameId: 'open-world', minimap: true,
    startScreen: { title, ...(subtitle ? { subtitle } : {}) },
    ...options,
    setup(ctx) {
      world.current = createOpenWorld(ctx, worldOptions);
      hooks.current.setup?.(ctx, world.current);
    },
    update(ctx, delta) {
      if (!world.current) return;
      world.current.frame(ctx, delta);
      hooks.current.update?.(ctx, world.current, delta);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);
  return <GameCanvas options={gameOptions} />;
}

export default OpenWorldGame;
`;

export const OPEN_WORLD_BRIDGE_PATH = 'src/game/play/openWorld.ts';
export const OPEN_WORLD_STARTER_PATH = 'src/game/OpenWorldGame.tsx';

/** The App that mounts the starter — written by the platform only where no game is mounted yet. */
export function openWorldAppSource(options: { city?: boolean; title?: string } = {}): string {
  const title = String(options.title ?? 'Open World').replace(/[^\p{L}\p{N} .,!?'-]/gu, '').trim().slice(0, 60) || 'Open World';
  return [
    "import { OpenWorldGame } from './game/OpenWorldGame';",
    '',
    '// The player is already standing on NavBharatAI\'s big map' + (options.city ? ', on a street of its city' : '') + '. Make it your game through the',
    '// setup and update props (cars, enemies, pickups, missions, rules) — the world, the player and the camera are the kit\'s.',
    'export default function App() {',
    `  return <OpenWorldGame title=${JSON.stringify(title)}${options.city ? ' world={{ city: true }}' : ''} />;`,
    '}',
    '',
  ].join('\n');
}

export function generateOpenWorld(): RecipeOutput {
  return {
    files: { [OPEN_WORLD_BRIDGE_PATH]: GAME_OPEN_WORLD_BRIDGE, [OPEN_WORLD_STARTER_PATH]: GAME_OPEN_WORLD_STARTER },
    dependencies: [],
    instructions: [
      'Added the open-world starter: src/game/OpenWorldGame.tsx and src/game/play/openWorld.ts. It JOINS the Athree map and the game shell —',
      'the kit\'s animated player walks on the map\'s own ground (never y = 0), the follow camera, joystick and keys work, the terrain streams',
      'as the player moves, and the floating origin is handled. Render it and the game is playable:',
      '```tsx',
      "import { OpenWorldGame } from './game/OpenWorldGame';",
      'export default function App() {',
      '  return <OpenWorldGame title="My World" world={{ city: true }}',
      '    setup={(ctx, world) => { /* add YOUR game: world.place(object, x, z) puts a thing on the ground at a WORLD place */ }}',
      '    update={(ctx, world, dt) => { /* YOUR rules, 60 Hz. world.playerWorld() is where the player is, in WORLD metres */ }} />;',
      '}',
      '```',
      'world={{ city: true }} levels ground near the start and stands a city on it (streets, crossings, pavements, shops, apartments, offices,',
      'parks), with traffic that obeys the lights, people who cross on the zebras, and parked cars the player gets into with Use (E). world.city',
      'gives the city, its traffic, its people, the parked cars and toWorld(x, z) for its lots and routes. Pass city options',
      '({ blocksX, blocksZ, style, traffic: { count }, people: { count }, parkedCars }) to change it, or leave city out for open country.',
      'RULES: never write your own world, ground plane, player, character controller, camera or game loop beside it; never set a position to',
      'y = 0 — use world.heightAt(x, z) or world.place(); positions you read from Three objects are RENDER metres (world metres minus',
      'world.map.chunks.origin) — use world.playerWorld() and world.place() and you never need to convert.',
    ].join('\n'),
  };
}
