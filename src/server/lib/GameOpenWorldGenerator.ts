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
import type { LandBiome } from '../athree/world';
import { createCity, planCity, type City, type CityOptions } from '../three/city';
import { createCityTraffic, type CityTraffic, type CityTrafficOptions } from '../three/citytraffic';
import { createCityPeople, type CityPeople, type CityPeopleOptions } from '../three/citypeople';
import { createCar } from '../three/objects';
import { softwareRenderer } from '../three/surfaces';

export interface OpenWorldOptions extends Omit<AthreeMapOptions, 'three'> {
  /** Side of the walkable ground patch kept under the player, in metres. Default 96. */
  patchSize?: number;
  /**
   * A city on the map, on ground levelled for it near the start: streets, crossings, pavements, shops, apartments, offices,
   * houses and parks, with traffic that obeys the lights and people who cross on the zebras. true for the default city;
   * false (default) for open country only. The player starts on one of its streets.
   */
  city?: boolean | RegionCity;
  /**
   * MORE PLACES ON THE MAP — how the world grows. Each entry is a city, a town or a village standing on its own levelled
   * ground, spread out across the map with open country between them. Add an entry to make the map bigger; never edit
   * the others. The first place (city, or regions[0]) is where the player starts. Up to 100 (places and lands together):
   * only the cities near the player are built, so a long list is a big universe, not a slow start.
   */
  regions?: WorldRegion[];
}

export type RegionCity = CityOptions & { traffic?: CityTrafficOptions | false; people?: CityPeopleOptions | false; parkedCars?: number };
export type RegionKind = 'city' | 'town' | 'village' | LandKind;
/** A LAND, not a settlement: a desert, a jungle, mountains, snow or a beach laid on part of the map (no buildings). */
export type LandKind = 'desert' | 'jungle' | 'mountain' | 'snow' | 'beach';
const LAND_BIOME: Record<LandKind, LandBiome> = { desert: 'desert', jungle: 'forest', mountain: 'mountain', snow: 'snow', beach: 'beach' };
export function isLandKind(kind: unknown): kind is LandKind { return typeof kind === 'string' && kind in LAND_BIOME; }
/** How many places and lands one map holds (admin 2026-11-22: "10—100 maps … bahut bada universe"). */
export const MAX_REGIONS = 100;
/** A planned place's city is built when the player comes this many metres from its edge. */
export const BUILD_AHEAD = 1500;
export type Compass = 'north' | 'north-east' | 'east' | 'south-east' | 'south' | 'south-west' | 'west' | 'north-west';
export interface WorldRegion {
  /** A short unique name: 'old-town', 'harbour', 'hill-village'. */
  id: string;
  kind: RegionKind;
  /** Which way from the first place. Left out: the places spread around by themselves. */
  toward?: Compass;
  /** How far from the first place, in metres. Left out: far enough to be a journey, near enough to reach. */
  distance?: number;
  /** Change this place: { blocksX, blocksZ, style, maxFloors, traffic: { count }, people: { count }, parkedCars }. */
  city?: RegionCity;
  /** A land region only: how far it reaches from its centre, in metres (default 450). */
  radius?: number;
}

/** A land on the map (a desert, a jungle, mountains, snow, a beach) — no buildings, just the land itself. */
export interface OpenWorldLand {
  readonly id: string;
  readonly kind: LandKind;
  /** Its centre in WORLD metres, and how far it reaches. */
  readonly centre: { x: number; z: number };
  readonly radius: number;
}
const COMPASS: Record<Compass, number> = { north: 0, 'north-east': Math.PI / 4, east: Math.PI / 2, 'south-east': (3 * Math.PI) / 4, south: Math.PI, 'south-west': (5 * Math.PI) / 4, west: (3 * Math.PI) / 2, 'north-west': (7 * Math.PI) / 4 };
const REGION_PRESETS: Record<'city' | 'town' | 'village', { city: CityOptions; traffic: number; people: number; parkedCars: number }> = {
  city: { city: { blocksX: 4, blocksZ: 4, style: 'mixed' }, traffic: 12, people: 30, parkedCars: 4 },
  town: { city: { blocksX: 3, blocksZ: 3, style: 'town', maxFloors: 4 }, traffic: 6, people: 16, parkedCars: 3 },
  village: { city: { blocksX: 2, blocksZ: 2, style: 'town', maxFloors: 2, parks: 0.3 }, traffic: 2, people: 8, parkedCars: 1 },
};

/** The city standing on the map. Its own numbers (plan, routes, lots) are in CITY metres: use toWorld() to leave it. */
export interface OpenWorldCity {
  readonly id: string;
  readonly kind: RegionKind;
  /** Roughly how far the place reaches from its centre, in metres. */
  readonly radius: number;
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
  /** The first place (where the player starts), or null in open country. */
  readonly city: OpenWorldCity | null;
  /** The places whose city is built so far (see places for all of them). */
  readonly regions: OpenWorldCity[];
  /** Every land on the map (desert, jungle, mountain, snow, beach regions), in the order listed. */
  readonly lands: OpenWorldLand[];
  /** The highways joining every place and land (centre lines in WORLD metres, with their heights). */
  readonly highways: ReadonlyArray<ReadonlyArray<{ x: number; y: number; z: number }>>;
  /**
   * EVERY place on the map, built or not, in the order listed. regions holds the places whose city has been built so far:
   * the first at once, the others as the player comes near (so a map of a hundred places starts as fast as a map of one).
   */
  readonly places: ReadonlyArray<{ id: string; kind: RegionKind; centre: { x: number; z: number }; radius: number; readonly built: boolean }>;
  /** The place the player is in or nearest to, and how far its centre is. null in a world with no places. */
  nearestRegion(): { region: OpenWorldCity; distance: number } | null;
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
  const { patchSize = 96, city: cityOption = false, regions: regionList, ...mapOptions } = options;
  // A browser with no GPU gets the map's phone tier (failedbr #2487 — see Game.ts applyQuality); a game may still ask for any tier.
  const map = createAthreeMap({ profile: 'open-world', quality: softwareRenderer() ? 'phone' : 'mid', skyOptions: { lights: false }, ...mapOptions, three: THREE } as AthreeMapOptions);
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

  // THE PLACES ON THE MAP: each one (a city, a town, a village) gets the flattest dry ground in its direction, levelled
  // BEFORE any terrain is drawn, and stands on it. The list grows one entry at a time; the first is where the player starts.
  const wanted: WorldRegion[] = [
    ...(cityOption ? [{ id: 'city', kind: 'city' as const, ...(cityOption === true ? {} : { city: cityOption }) }] : []),
    ...(regionList || []),
  ];
  const towns: OpenWorldCity[] = [];
  const roots: THREE.Group[] = [];
  const locals: THREE.Object3D[] = [];
  const taken: Array<{ x: number; z: number; r: number }> = [];
  const seenIds = new Set<string>();
  const landList: OpenWorldLand[] = [];
  const colours = [0xc8102e, 0x1d4ed8, 0xf59e0b, 0x111827, 0xe5e7eb, 0x15803d];
  // 🌌 A UNIVERSE OF PLACES (admin 2026-11-22: "mujhe chahiye 10—100 maps jod kar bahut bada universe bhi bana sake"). Up to
  // MAX_REGIONS places and lands. Every place is PLANNED up front — its spot on the map and its levelled ground, which are cheap
  // and must exist before the first terrain is drawn — but its CITY (buildings, traffic, people, parked cars) is built only when
  // the player comes within BUILD_AHEAD metres of it, one place per frame, so a hundred places cost what the nearest few cost.
  // The places spread out on a golden-angle spiral (the n-th one about √n spacings from the first), never stacked, always
  // reachable; a place asked to lie toward a direction keeps that direction.
  interface PlannedPlace { region: WorldRegion; preset: (typeof REGION_PRESETS)['city']; cityOptions: CityOptions; centre: { x: number; y: number; z: number }; reach: number; built: number }
  const planned: PlannedPlace[] = [];
  for (const region of wanted) {
    if (!region || typeof region.id !== 'string' || !region.id || seenIds.has(region.id) || planned.length + landList.length >= MAX_REGIONS) continue;
    seenIds.add(region.id);
    const n = planned.length + landList.length;
    // A LAND, not a place to build: laid on the map the way it was asked (toward, distance), clear of the places already there.
    if (isLandKind(region.kind)) {
      const r = Math.min(2000, Math.max(150, Number(region.radius) || 450));
      const base = planned[0]?.centre ?? spawn;
      const angle = region.toward !== undefined ? COMPASS[region.toward] : (n * 2.399963);
      let far = Math.max(region.distance ?? 0, (planned[0]?.reach ?? 0) + r + 300, (r * 2 + 400) * Math.sqrt(n));
      let at = { x: base.x + Math.sin(angle) * far, z: base.z - Math.cos(angle) * far };
      for (let tries = 0; tries < 8 && taken.some((t) => Math.hypot(at.x - t.x, at.z - t.z) < t.r + r + 100); tries++) {
        far += r; at = { x: base.x + Math.sin(angle) * far, z: base.z - Math.cos(angle) * far };
      }
      map.world.setLand(at.x, at.z, r, LAND_BIOME[region.kind]);
      taken.push({ x: at.x, z: at.z, r });
      landList.push({ id: region.id, kind: region.kind, centre: at, radius: r });
      continue;
    }
    const preset = REGION_PRESETS[region.kind] || REGION_PRESETS.city;
    const { traffic: _t, people: _p, parkedCars: _c, ...own } = region.city || {};
    const cityOptions: CityOptions = { ...preset.city, seed: 11 + planned.length * 17, ...own };
    const plan = planCity(cityOptions);
    const hx = plan.width / 2 + 8, hz = plan.depth / 2 + 8, reach = Math.max(hx, hz);
    // Where to look: the first place is at the start; the others go the way they were asked, clear of what is there.
    const first = planned.length === 0;
    const angle = region.toward !== undefined ? COMPASS[region.toward] : (n * 2.399963);   // the golden angle: spread, never stacked
    const spacing = reach * 2 + 400;
    let far = Math.max(region.distance ?? 0, first ? 0 : spacing * Math.max(1, Math.sqrt(n)));
    let best = { x: spawn.x, z: spawn.z, cost: Number.POSITIVE_INFINITY };
    const samples = first ? 3 : 2;                                                                       // 7×7 for the start, 5×5 after
    // Water or roads where it was asked: look a little further out (and, for a spread place, a little to either side), before
    // leaving a place out (a map of a hundred places must not lose the ones that happened to point at the sea).
    for (let attempt = 0; attempt < (first ? 1 : 10) && !Number.isFinite(best.cost); attempt++, far += spacing * 0.5) {
    // A place asked to lie toward a direction keeps it; a spread place may also turn a little to find dry ground.
    const turn = region.toward !== undefined ? 0 : (attempt % 2 ? 1 : -1) * Math.ceil(attempt / 2) * 0.35;
    const home = first ? { x: spawn.x, z: spawn.z } : { x: planned[0].centre.x + Math.sin(angle + turn) * far, z: planned[0].centre.z - Math.cos(angle + turn) * far };
    best = { x: home.x, z: home.z, cost: Number.POSITIVE_INFINITY };
    for (const ring of [0, 1, 2, 3, 4]) for (let k = 0; k < (ring ? 8 : 1); k++) {
      const a = (k / 8) * Math.PI * 2, r = ring * reach * 0.9;
      const cx = home.x + Math.cos(a) * r, cz = home.z + Math.sin(a) * r;
      if (taken.some((t) => Math.hypot(cx - t.x, cz - t.z) < t.r + reach + 140)) continue;   // never on top of another place
      let low = Number.POSITIVE_INFINITY, high = Number.NEGATIVE_INFINITY, wet = false;
      for (let i = -samples; i <= samples && !wet; i++) for (let j = -samples; j <= samples; j++) {
        const x = cx + (i / samples) * hx, z = cz + (j / samples) * hz, h = map.world.heightAt(x, z);
        if (h < 2 || map.world.waterAt(x, z) || map.world.roadAt(x, z)) { wet = true; break; }
        low = Math.min(low, h); high = Math.max(high, h);
      }
      const cost = wet ? Number.POSITIVE_INFINITY : (high - low) + r * 0.01;
      if (cost < best.cost) best = { x: cx, z: cz, cost };
      if (!first && cost < 1.5) break;                                                                  // flat enough: stop looking
    }
    }
    if (!Number.isFinite(best.cost) && !first) { console.error('[world] no dry ground was found for "' + region.id + '" in that direction; it was left out.'); continue; }
    const y = map.world.levelGround(best.x, best.z, hx, hz, 60);
    taken.push({ x: best.x, z: best.z, r: reach });
    planned.push({ region, preset, cityOptions, centre: { x: best.x, y, z: best.z }, reach, built: -1 });
  }
  /** Build one planned place's city now (buildings, traffic, people, parked cars) and put it on the map. */
  const buildPlace = (p: PlannedPlace): OpenWorldCity => {
    const { traffic: trafficOption, people: peopleOption, parkedCars = p.preset.parkedCars } = p.region.city || {};
    const city = createCity(p.cityOptions);
    const plan = city.plan;
    const root = new THREE.Group(); root.name = 'Region ' + p.region.id;
    root.add(city.root);
    const traffic = trafficOption === false ? null : createCityTraffic(city, { count: p.preset.traffic, ...(trafficOption || {}) });
    if (traffic) root.add(traffic.root);
    const people = peopleOption === false ? null : createCityPeople(city, { traffic, count: p.preset.people, ...(peopleOption || {}) });
    if (people) root.add(people.root);
    const local = new THREE.Object3D(); root.add(local);
    const parked: THREE.Object3D[] = [];
    for (let i = 0; i < Math.max(0, Math.min(12, parkedCars)); i++) {
      // Beside the kerb of a north-south street, between two crossings, nose along the street.
      const sx = plan.streetsX[(i * 2 + 1) % plan.streetsX.length];
      const zi = i % Math.max(1, plan.streetsZ.length - 1);
      const z0 = plan.streetsZ[zi], z1 = plan.streetsZ[Math.min(plan.streetsZ.length - 1, zi + 1)];
      const car = createCar({ color: colours[(i + towns.length) % colours.length] });
      car.position.set(sx + (plan.road / 2 - 1.3) * (i % 2 ? 1 : -1), city.heightAt(sx, (z0 + z1) / 2), z0 + (z1 - z0) * (0.3 + 0.4 * ((i * 0.37) % 1)));
      car.rotation.y = i % 2 ? Math.PI : 0;
      root.add(car); parked.push(car); ctx.vehicles.add(car);
    }
    const centre = p.centre;
    const built: OpenWorldCity = { id: p.region.id, kind: p.region.kind, city, traffic, people, parked, centre, radius: p.reach, toWorld: (x, z) => ({ x: centre.x + x, z: centre.z + z }) };
    p.built = towns.length;
    towns.push(built); roots.push(root); locals.push(local);
    root.position.set(centre.x - chunks.origin.x, centre.y, centre.z - chunks.origin.z);
    ctx.scene.add(root); root.updateMatrixWorld(true);
    return built;
  };
  // 🛣️ ROADS THAT NEVER END (admin 2026-11-22: "user kitni bhi gaadiyan chalaye — abhi 30 sec me hi road khatam ho jati hai").
  // Every place and land is joined to the network by a highway: a minimum spanning tree over their centres (each new place to its
  // nearest one), each road running from the edge of one to the edge of the other. The land is cut and filled to it by the map
  // itself (world.addRoad), so a car can drive from any place to every other — across a universe of a hundred places — without
  // the road running out. Laid before the first frame, like the levelled ground.
  const stops = [...planned.map((p) => ({ x: p.centre.x, z: p.centre.z, r: p.reach })), ...landList.map((l) => ({ x: l.centre.x, z: l.centre.z, r: Math.min(120, l.radius * 0.3) }))];
  const roadGroup = new THREE.Group(); roadGroup.name = 'Highways';
  const asphalt = new THREE.MeshStandardMaterial({ color: 0x34363a, roughness: 0.95 });
  const roadLines: Array<Array<{ x: number; y: number; z: number }>> = [];
  if (stops.length > 1) {
    const joined = new Set<number>([0]);
    while (joined.size < stops.length) {
      let best: [number, number, number] | null = null;
      for (const a of joined) for (let b = 0; b < stops.length; b++) {
        if (joined.has(b)) continue;
        const d = Math.hypot(stops[a].x - stops[b].x, stops[a].z - stops[b].z);
        if (!best || d < best[2]) best = [a, b, d];
      }
      if (!best) break;
      joined.add(best[1]);
      const A0 = stops[best[0]], B0 = stops[best[1]], len = best[2] || 1;
      const ux = (B0.x - A0.x) / len, uz = (B0.z - A0.z) / len;
      if (len < A0.r + B0.r + 20) continue;                                                   // touching places need no road
      const from = { x: A0.x + ux * (A0.r + 6), z: A0.z + uz * (A0.r + 6) }, to = { x: B0.x - ux * (B0.r + 6), z: B0.z - uz * (B0.r + 6) };
      roadLines.push(map.world.addRoad([from, to], 9));
    }
  }
  /** One asphalt ribbon per road, a little above the carved ground, with a white centre line. */
  for (const line of roadLines) {
    if (line.length < 2) continue;
    const pos: number[] = [], idx: number[] = [];
    for (let i = 0; i < line.length; i++) {
      const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)];
      const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1, nx = -dz / l * 4.5, nz = dx / l * 4.5;
      pos.push(line[i].x + nx, line[i].y + 0.08, line[i].z + nz, line[i].x - nx, line[i].y + 0.08, line[i].z - nz);
      if (i > 0) { const k = i * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, asphalt); mesh.receiveShadow = true; mesh.name = 'Highway';
    roadGroup.add(mesh);
  }
  // The first place is where the player starts: built now, and the player stands on one of its streets.
  if (planned[0]) {
    const home = buildPlace(planned[0]);
    spawn.x = home.centre.x + home.city.spawn.x; spawn.z = home.centre.z + home.city.spawn.z; spawn.y = home.centre.y + home.city.spawn.y;
  }
  const town: OpenWorldCity | null = towns[0] || null;
  map.update(spawn.x, spawn.z, 0, spawn.y);
  // The highways are drawn in WORLD metres: their group sits at minus the origin, and moves back with every origin shift.
  roadGroup.position.set(-chunks.origin.x, 0, -chunks.origin.z); ctx.scene.add(roadGroup);
  // The first place was put on the map before map.update() moved the origin: line it up again.
  towns.forEach((t, i) => { roots[i].position.set(t.centre.x - chunks.origin.x, t.centre.y, t.centre.z - chunks.origin.z); roots[i].updateMatrixWorld(true); });
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
    map, spawn, playerWorld, city: town, regions: towns, lands: landList, highways: roadLines,
    places: planned.map((p) => ({ id: p.region.id, kind: p.region.kind, centre: { x: p.centre.x, z: p.centre.z }, radius: p.reach, get built() { return p.built >= 0; } })),
    nearestRegion() {
      const at = playerWorld();
      let found: { region: OpenWorldCity; distance: number } | null = null;
      for (const t of towns) { const d = Math.hypot(at.x - t.centre.x, at.z - t.centre.z); if (!found || d < found.distance) found = { region: t, distance: d }; }
      return found;
    },
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
        for (const root of roots) { root.position.x -= shift.dx; root.position.z -= shift.dz; }
        roadGroup.position.x -= shift.dx; roadGroup.position.z -= shift.dz;
      }
      layGround(at.x, at.z);
      // A place still only planned is built when the player comes near it — at most one per frame, so walking towards a
      // cluster of places never stalls a frame on several cities at once.
      for (const p of planned) {
        if (p.built >= 0) continue;
        if (Math.hypot(at.x - p.centre.x, at.z - p.centre.z) < p.reach + BUILD_AHEAD) { buildPlace(p); break; }
      }
      // A place lives only while the player is near it: far ones are not drawn, and only the near ones run their streets.
      const seated = ctx.vehicles.seated;
      towns.forEach((t, i) => {
        const d = Math.hypot(at.x - t.centre.x, at.z - t.centre.z);
        roots[i].visible = d < t.radius + 2600;
        if (d > t.radius + 500) return;
        locals[i].position.set(at.x - t.centre.x, at.y - t.centre.y, at.z - t.centre.z);
        t.traffic?.update(delta, seated ? [locals[i], seated] : [locals[i]]);
        t.people?.update(delta, [locals[i]]);
      });
    },
    dispose() {
      ctx.scene.remove(ground); geometry.dispose(); (ground.material as THREE.Material).dispose();
      towns.forEach((t, i) => { t.people?.dispose(); t.traffic?.dispose(); t.city.dispose(); ctx.scene.remove(roots[i]); });
      ctx.scene.remove(roadGroup); roadGroup.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); }); asphalt.dispose();
      ctx.scene.remove(chunks.group); anchored.clear(); map.dispose();
    },
  };
}
`;

export const GAME_PLAYER_BODY_PATH = 'src/game/play/playerBody.ts';
export const GAME_PLAYER_BODY = String.raw`// WHO THE PLAYER IS — and how it is changed (admin 2026-11-21: "yeh jo character banta hai, isko user jab chahe replace
// karwa de, text se ya game library se chun ke").
//
// The player's body is the kit's own animated person by default. It is changed in ONE place, src/game/player.ts:
//   • look  — the same person with other colours, height or build (still walks, runs, jumps and plays every action pose);
//   • model — a character from the game library, by its subject ("knight", "farmer"). It is loaded from the game's own
//             saved models; while it loads, and if it cannot be loaded, the kit person stays — the player is never missing.
// Nothing else in the game refers to the body, so replacing the character touches nothing else.
import * as THREE from 'three';
import type { GameContext } from '../Game';
import type { HumanoidOptions } from '../three/humanoid';

export interface PlayerChoice {
  /** The kit person's look: { height, build, skin, hair, shirt, trousers, shoes } (colours as 0xRRGGBB). */
  look?: HumanoidOptions;
  /** A library character's subject (it must be one of the game's saved models), or null for the kit person. */
  model?: string | null;
  /** How tall the model stands, in metres. Default 1.75. */
  modelHeight?: number;
}

export interface PlayerModelHandle { root: THREE.Object3D; source?: string; update(dt: number): void; dispose?(): void; play?(role: string, fade?: number): boolean }
export type PlayerAssetModule = { loadRequestedAsset?: (subject: string, fallback: () => PlayerModelHandle) => Promise<PlayerModelHandle> };

/** The game's saved library models, when it has any. A game without the file simply has none — never a broken build. */
function assetModule(): Promise<PlayerAssetModule | null> {
  try {
    const found = import.meta.glob('../three/assetModels.ts') as Record<string, () => Promise<PlayerAssetModule>>;
    const load = Object.values(found)[0];
    return load ? load().catch(() => null) : Promise.resolve(null);
  } catch { return Promise.resolve(null); }
}

/** Which clip a moving body plays. */
export function locomotionRole(speed: number, grounded: boolean): 'idle' | 'walk' | 'run' | 'jump' {
  if (!grounded) return 'jump';
  return speed > 4.2 ? 'run' : speed > 0.25 ? 'walk' : 'idle';
}

export interface PlayerBody {
  /** Call every step. */
  update(delta: number): void;
  /** 'person' while the kit person is shown; 'model' once the library character has taken its place. */
  readonly showing: 'person' | 'model';
  dispose(): void;
}

/** Apply the choice to the running game. The second loader argument exists for tests; a game reads its own saved models. */
export function applyPlayerChoice(ctx: GameContext, choice?: PlayerChoice | null, load: () => Promise<PlayerAssetModule | null> = assetModule): PlayerBody {
  let model: PlayerModelHandle | null = null;
  let role = '';
  let gone = false;
  const subject = typeof choice?.model === 'string' ? choice.model.trim() : '';
  if (subject && ctx.hero) {
    const empty = (): PlayerModelHandle => ({ root: new THREE.Group(), source: 'procedural', update() { /* nothing to move */ } });
    void load().then((mod) => (mod?.loadRequestedAsset ? mod.loadRequestedAsset(subject, empty) : null)).then((handle) => {
      if (gone || !handle || handle.source !== 'model' || !ctx.hero) {
        if (!gone) console.error('[player] the character "' + subject + '" is not one of this game\'s saved models; the default person is shown.');
        handle?.dispose?.();
        return;
      }
      // Stand it at the asked height, feet on the ground, where the kit person stands.
      const box = new THREE.Box3().setFromObject(handle.root);
      const tall = box.max.y - box.min.y;
      if (Number.isFinite(tall) && tall > 0.01) { const k = (choice?.modelHeight ?? 1.75) / tall; handle.root.scale.multiplyScalar(k); handle.root.position.y -= box.min.y * k; }
      ctx.player.object.add(handle.root);
      ctx.hero.root.scale.setScalar(0.0001);       // the kit person steps aside (the shell still drives it)
      model = handle;
    }).catch((error) => { console.error('[player] the character could not be loaded: ' + String(error)); });
  }
  return {
    get showing() { return model ? 'model' as const : 'person' as const; },
    update(delta) {
      if (!model || !ctx.hero) return;
      model.root.rotation.y = ctx.hero.root.rotation.y;
      model.root.visible = ctx.hero.root.visible;
      const next = locomotionRole(ctx.player.speed, ctx.player.isGrounded);
      if (next !== role) { role = next; if (!model.play?.(next)) model.play?.(next === 'run' ? 'walk' : 'idle'); }
      model.update(delta);
    },
    dispose() {
      gone = true;
      if (model) { model.root.removeFromParent(); model.dispose?.(); model = null; }
      if (ctx.hero) ctx.hero.root.scale.setScalar(1);
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
import { createFeatureHost, type FeatureHost, type GameFeature } from './play/features';
import { applyPlayerChoice, type PlayerBody, type PlayerChoice } from './play/playerBody';

export interface OpenWorldGameProps {
  title?: string;
  subtitle?: string;
  /** The map: seed, profile, size, quality, style — see play/openWorld.ts and athree/. */
  world?: OpenWorldOptions;
  /**
   * THE GAME, as a list of features (play/features.ts): each adds one thing, each is guarded, and adding one more never
   * touches the others. Keep the list in src/game/features/index.ts.
   */
  features?: ReadonlyArray<GameFeature<OpenWorld>>;
  /**
   * WHO THE PLAYER IS: the kit person's look (colours, height, build), or a character model from the game library.
   * Keep it in src/game/player.ts — changing the character is changing that one file.
   */
  player?: PlayerChoice;
  /** Add your game to the world. Runs once, after the player is standing on the map. */
  setup?: (ctx: GameContext, world: OpenWorld) => void;
  /** Your rules, at a fixed 60 Hz, after the world has streamed for this step. */
  update?: (ctx: GameContext, world: OpenWorld, delta: number) => void;
  /** Any other shell option (camera, touch buttons, language, music …). */
  options?: Omit<GameOptions, 'container' | 'setup' | 'update'>;
}

export function OpenWorldGame({ title = 'Open World', subtitle, world: worldOptions, features, player, setup, update, options }: OpenWorldGameProps) {
  const world = useRef<OpenWorld | null>(null);
  const host = useRef<FeatureHost<OpenWorld> | null>(null);
  const listed = useRef(features); listed.current = features;
  const body = useRef<PlayerBody | null>(null);
  const hooks = useRef({ setup, update }); hooks.current = { setup, update };
  const gameOptions = useMemo<Omit<GameOptions, 'container'>>(() => ({
    camera: 'third-person', gameId: 'open-world', minimap: true,
    startScreen: { title, ...(subtitle ? { subtitle } : {}) },
    ...(player?.look ? { playerLook: player.look } : {}),
    ...options,
    setup(ctx) {
      world.current = createOpenWorld(ctx, worldOptions);
      body.current = applyPlayerChoice(ctx, player);
      hooks.current.setup?.(ctx, world.current);
      host.current = createFeatureHost<OpenWorld>(listed.current || []);
      host.current.setup(ctx, world.current);
    },
    update(ctx, delta) {
      if (!world.current) return;
      world.current.frame(ctx, delta);
      body.current?.update(delta);
      hooks.current.update?.(ctx, world.current, delta);
      host.current?.update(ctx, world.current, delta);
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
    "import { FEATURES } from './game/features';",
    "import { WORLD } from './game/world';",
    "import { PLAYER } from './game/player';",
    '',
    '// The player is already standing on NavBharatAI\'s big map' + (options.city ? ', on a street of its city' : '') + '. Make it your game through the',
    '// FEATURES list in src/game/features/index.ts: one small file per thing the game has (coins, enemies, missions, rules).',
    '// The MAP grows the same way: its places (city, town, village) are the regions list in src/game/world.ts.',
    '// The world, the player and the camera are the kit\'s.',
    'export default function App() {',
    `  return <OpenWorldGame title=${JSON.stringify(title)} world={WORLD} player={PLAYER} features={FEATURES} />;`,
    '}',
    '',
  ].join('\n');
}

export const GAME_FEATURES_INDEX_PATH = 'src/game/features/index.ts';
/** The game's own list of features — the user's file (never a kit file): created once, then only ever added to. */
export const GAME_FEATURES_INDEX = [
  '// THIS GAME, AS A LIST. Each feature is one file in this folder that adds one thing to the game.',
  '// To ADD something: create src/game/features/<name>.ts with defineFeature({ id, setup, update }) and add it to the list below.',
  '// To CHANGE one thing: edit only that feature\'s file. To REMOVE it: take it out of the list. Nothing else needs to change.',
  "import type { GameFeature } from '../play/features';",
  "import type { OpenWorld } from '../play/openWorld';",
  '',
  'export const FEATURES: GameFeature<OpenWorld>[] = [',
  '];',
  '',
].join('\n');

export const GAME_PLAYER_FILE_PATH = 'src/game/player.ts';
/** The game's own player — the user's file (never a kit file): created once; changing the character is changing this. */
export const GAME_PLAYER_FILE = [
  "// THIS GAME'S PLAYER. To change how the character looks, edit look (colours are 0xRRGGBB; height in metres; build 0.85 slight to 1.2 heavy).",
  "// To use a character from the game library instead, add it to the game first, then set model to its subject (for example 'knight').",
  '// Set model back to null for the default person. Nothing else in the game needs to change.',
  "import type { PlayerChoice } from './play/playerBody';",
  '',
  'export const PLAYER: PlayerChoice = {',
  '  look: { shirt: 0x2e5a87 },',
  '  model: null,',
  '};',
  '',
].join('\n');

export const GAME_WORLD_FILE_PATH = 'src/game/world.ts';
/** The game's own map — the user's file (never a kit file): created once, then only ever added to. */
export function gameWorldFileSource(options: { city?: boolean } = {}): string {
  return [
    '// THIS GAME\'S MAP. The land is NavBharatAI\'s big Athree map; the places on it are the regions list below.',
    '// To make the map BIGGER: add one more region (a city, a town or a village; say which way with toward, or leave it out).',
    '// To change ONE place: edit only its entry (city: { blocksX, blocksZ, style, traffic: { count }, people: { count }, parkedCars }).',
    '// The first region is where the player starts. Nothing else needs to change.',
    "import type { OpenWorldOptions } from './play/openWorld';",
    '',
    'export const WORLD: OpenWorldOptions = {',
    '  seed: 7,',
    '  regions: [',
    ...(options.city ? ["    { id: 'main-city', kind: 'city' },"] : []),
    '  ],',
    '};',
    '',
  ].join('\n');
}

export function generateOpenWorld(): RecipeOutput {
  return {
    files: { [OPEN_WORLD_BRIDGE_PATH]: GAME_OPEN_WORLD_BRIDGE, [OPEN_WORLD_STARTER_PATH]: GAME_OPEN_WORLD_STARTER, [GAME_PLAYER_BODY_PATH]: GAME_PLAYER_BODY },
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
      'GROW THE GAME BY FEATURES (src/game/play/features.ts): every thing the game has is ONE file, src/game/features/<name>.ts —',
      "  export default defineFeature<OpenWorld>({ id: 'coins', setup(ctx, world, api) { /* add objects; return a value to share */ }, update(ctx, world, dt, api) { /* rules */ } });",
      'and one line in the FEATURES list in src/game/features/index.ts, passed as <OpenWorldGame features={FEATURES} />. A feature that needs',
      'another names it in needs: [\'coins\'] and reads what it shared with api.get(\'coins\'). Each feature is guarded: one that throws is switched',
      'off and named in the console, and the rest of the game keeps running. To add the next thing, add the next file — never rewrite the others.',
      'GROW THE MAP BY REGIONS: world={{ regions: [{ id: \'main-city\', kind: \'city\' }, { id: \'old-town\', kind: \'town\', toward: \'east\' }, { id: \'hill-village\', kind: \'village\' }] }}',
      'stands each place on its own levelled ground, spread across the map with open country and roads between them (up to 12; far places are',
      'not drawn, only near ones run their traffic). Keep the list in src/game/world.ts; a bigger map is ONE more entry. world.regions lists',
      'them and world.nearestRegion() says where the player is.',
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
