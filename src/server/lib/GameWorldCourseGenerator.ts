// 🛣️ A RACE ALONG THE WORLD'S ROADS — THE COURSE (map expansion plan, item 8, part 1 of 3).
//
// The road-library race drives one endless procedural road. Item 8 lets a race run across the open world's joined places
// instead — only after the user says yes once (owner decision 2026-11-23; mapGrowthIntent.ts asks). This part is ONLY the
// course: the legs the world already lays (its highways, each a polyline in world metres) chained into one driving line,
// resampled every 2 m, with what createRace and the car need from a course — poseAt(distance) for the rivals, update(car)
// for the player's distance, a finish line at finishKm along the route, and extend(points) so an endless race never runs
// out when the world plans the next place. Pure geometry: no three.js, no scene, no map — so it is tested on its own.
//
// NOT SHIPPED YET: no recipe writes this file and nothing imports it (part 2 wires it into <RacingRoadGame> behind
// TRACK.world, default off; part 3 lets the ask-once route offer it). TypeScript inside String.raw: never a backtick or a
// dollar-brace in the emitted code.

export const WORLD_COURSE_PATH = 'src/game/play/worldCourse.ts';

export const WORLD_COURSE = String.raw`// A RACE ALONG THE WORLD'S ROADS: the course. The world's highways (polylines in world metres) chained into one driving
// line, every 2 m, with what a race needs: poseAt for the rivals, update for the player, a finish at finishKm, extend for
// an endless race. Pure geometry (no three.js): positions in and out are WORLD metres minus the render origin you give.

export interface CoursePoint { x: number; z: number }
/** Where the course is at a distance, facing along it (a car faces +Z turned by heading: forward is (sin, cos)). */
export interface CoursePose { x: number; y: number; z: number; heading: number }

export interface WorldCourseOptions {
  /** The legs to chain, in driving order or not: each a polyline in world metres (the open world's highways). */
  legs: ReadonlyArray<ReadonlyArray<CoursePoint>>;
  /** Where to start: the leg end nearest this point. Default: the first leg's first point. */
  start?: CoursePoint;
  /** The ground under (x, z), in world metres (map.world.drivableHeightAt). Default 0. */
  heightAt?: (x: number, z: number) => number;
  /** The render origin (the open world shifts it as the player drives). Default (0, 0). */
  origin?: () => CoursePoint;
  /** A finish this many km along the course; null (default) is endless. */
  finishKm?: number | null;
  /** Two leg ends further apart than this are joined by a straight link, and counted in gaps. Default 400 m. */
  joinGap?: number;
}

export interface CourseStatus { distance: number; lap: number; segment: null; ended: boolean; rebased: null }

export interface WorldCourse {
  /** The course's length so far, in metres. */
  readonly length: number;
  /** The driving line, every 2 m, in world metres. */
  readonly line: ReadonlyArray<CoursePoint>;
  /** Where the finish is, in metres along the course; null for endless. Never past the end of a course that is not extended. */
  readonly finish: number | null;
  /** Straight links laid where two legs did not meet (metres each) — the caller may route those through a place's streets. */
  readonly gaps: ReadonlyArray<number>;
  /** Where the race starts: distance 0, facing along the course. */
  readonly startPose: CoursePose;
  /** The course at a distance; null before the start or past the end. */
  poseAt(distance: number): CoursePose | null;
  /** Every frame, with the player's car: how far along it has driven (the nearest point of the line near the last one). */
  update(car: { position: { x: number; z: number } }): CourseStatus;
  /** More road at the end (an endless race: the next place's highway). Returns the new length. */
  extend(points: ReadonlyArray<CoursePoint>): number;
  /** Back to the start (Play again). */
  reset(): void;
  dispose(): void;
}

const STEP = 2;
const finite = (p: CoursePoint | null | undefined): p is CoursePoint => !!p && Number.isFinite(p.x) && Number.isFinite(p.z);
const dist = (a: CoursePoint, b: CoursePoint): number => Math.hypot(b.x - a.x, b.z - a.z);

/** Chain legs end to end from the start: each next leg is the unused one whose nearer end is closest (turned round if need be). */
export function chainLegs(legs: ReadonlyArray<ReadonlyArray<CoursePoint>>, start?: CoursePoint, joinGap = 400): { points: CoursePoint[]; gaps: number[] } {
  const pool = legs.map((l) => (l || []).filter(finite)).filter((l) => l.length >= 2);
  if (!pool.length) return { points: [], gaps: [] };
  const used = new Array(pool.length).fill(false);
  let first = 0, flip = false;
  if (finite(start)) {
    let best = Infinity;
    pool.forEach((l, i) => {
      const a = dist(start, l[0]), b = dist(start, l[l.length - 1]);
      if (a < best) { best = a; first = i; flip = false; }
      if (b < best) { best = b; first = i; flip = true; }
    });
  }
  const points: CoursePoint[] = (flip ? [...pool[first]].reverse() : [...pool[first]]).map((p) => ({ x: p.x, z: p.z }));
  used[first] = true;
  const gaps: number[] = [];
  for (let n = 1; n < pool.length; n++) {
    const end = points[points.length - 1];
    let pick = -1, rev = false, best = Infinity;
    pool.forEach((l, i) => {
      if (used[i]) return;
      const a = dist(end, l[0]), b = dist(end, l[l.length - 1]);
      if (a < best) { best = a; pick = i; rev = false; }
      if (b < best) { best = b; pick = i; rev = true; }
    });
    if (pick < 0) break;
    used[pick] = true;
    const leg = rev ? [...pool[pick]].reverse() : pool[pick];
    if (best > joinGap) gaps.push(Math.round(best));
    for (let i = best < 0.01 ? 1 : 0; i < leg.length; i++) points.push({ x: leg[i].x, z: leg[i].z });
  }
  return { points, gaps };
}

/** A polyline every STEP metres (the last point kept). */
export function resample(points: ReadonlyArray<CoursePoint>, step = STEP): CoursePoint[] {
  const out: CoursePoint[] = [];
  if (!points.length) return out;
  out.push({ x: points[0].x, z: points[0].z });
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], len = dist(a, b);
    if (len <= 0) continue;
    let t = step - carry;
    while (t <= len) { out.push({ x: a.x + ((b.x - a.x) * t) / len, z: a.z + ((b.z - a.z) * t) / len }); t += step; }
    carry = len - (t - step);
  }
  const last = points[points.length - 1];
  if (dist(out[out.length - 1], last) > 0.01) out.push({ x: last.x, z: last.z });
  return out;
}

export function createWorldCourse(options: WorldCourseOptions): WorldCourse {
  const heightAt = options.heightAt ?? (() => 0);
  const origin = options.origin ?? (() => ({ x: 0, z: 0 }));
  const chained = chainLegs(options.legs, options.start, options.joinGap ?? 400);
  let line: CoursePoint[] = resample(chained.points);
  if (line.length < 2) line = [{ x: 0, z: 0 }, { x: 0, z: STEP }];
  const cum: number[] = [0];
  const measure = (from: number): void => { for (let i = Math.max(1, from); i < line.length; i++) cum[i] = cum[i - 1] + dist(line[i - 1], line[i]); };
  measure(1);
  const asked = options.finishKm != null && Number(options.finishKm) > 0 ? Number(options.finishKm) * 1000 : null;
  const length = (): number => cum[cum.length - 1];
  const finishAt = (): number | null => (asked === null ? null : Math.min(asked, length()));
  let near = 0;
  const poseAt = (d: number): CoursePose | null => {
    if (!Number.isFinite(d) || d < 0 || d > length()) return null;
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= d) lo = mid; else hi = mid; }
    const a = line[lo], b = line[Math.min(line.length - 1, lo + 1)], seg = cum[Math.min(cum.length - 1, lo + 1)] - cum[lo];
    const t = seg > 0 ? (d - cum[lo]) / seg : 0;
    const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
    const o = origin();
    return { x: x - o.x, y: heightAt(x, z), z: z - o.z, heading: Math.atan2(b.x - a.x, b.z - a.z) };
  };
  return {
    get length() { return length(); },
    get line() { return line; },
    get finish() { return finishAt(); },
    gaps: chained.gaps,
    get startPose() { return poseAt(0)!; },
    poseAt,
    update(car) {
      const o = origin(), px = car.position.x + o.x, pz = car.position.z + o.z;
      let best = Infinity, at = near;
      const scan = (from: number, to: number): void => {
        for (let i = Math.max(0, from); i < Math.min(line.length - 1, to); i++) {
          const a = line[i], b = line[i + 1], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
          const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / l2));
          const d = Math.hypot(px - (a.x + dx * t), pz - (a.z + dz * t));
          if (d < best) { best = d; at = i + t; }
        }
      };
      scan(near - 40, near + 80);                                   // near where it was: a car drives, it does not jump
      if (best > 30) scan(0, line.length - 1);                      // …unless it was put somewhere else (a respawn)
      near = Math.floor(at);
      const i = Math.min(cum.length - 2, Math.floor(at));
      const distance = cum[i] + (cum[i + 1] - cum[i]) * (at - i);
      const f = finishAt();
      return { distance, lap: 0, segment: null, ended: f !== null && distance >= f - 0.5, rebased: null };
    },
    extend(points) {
      const more = (points || []).filter(finite);
      if (!more.length) return length();
      const from = line.length;
      const tail = resample([line[line.length - 1], ...more]).slice(1);
      line = line.concat(tail);
      measure(from);
      return length();
    },
    reset() { near = 0; },
    dispose() { line = [line[0], line[1]]; cum.length = 2; },
  };
}
`;

// 🏁 THE WORLD RACE (item 8, part 2 of 3): the race on that course, under the open world. <RacingRoadGame> loads this file
// only when the game's src/game/track.ts says TRACK.world = true AND the file is in the project (play/raceCustom.ts
// loadWorldRace, through import.meta.glob: a project without it compiles and races on the road library, as before). It is
// written into a project only after the user says yes once (part 3). Not shipped by any recipe.
export const WORLD_RACE_PATH = 'src/game/play/worldRace.ts';

export const WORLD_RACE = String.raw`// THE WORLD RACE: the race runs on the open world's highways, from the first place through the others, with the kit's
// rivals, countdown, position and finish. <RacingRoadGame> uses it by itself when src/game/track.ts sets TRACK.world = true.
// The places are the game's own src/game/world.ts (WORLD.regions) when it has one, else four towns joined by highways.
import * as THREE from 'three';
import type { GameContext } from '../Game';
import { createWorldLayer, type WorldLayer } from './worldLayer';
import { createWorldCourse, type CoursePose, type WorldCourse } from './worldCourse';
import { createRace, type Race, type RaceStatus } from '../three/race';
import type { WorldRegion } from './openWorld';

export interface WorldRaceOptions {
  /** The player's car (the kit car): it is followed by the world and put on the start line. */
  car: THREE.Object3D;
  opponents?: number;
  /** A finish this many km along the route; null or more than the route: the end of the route. */
  finishKm?: number | null;
  /** The places to race through. Default: src/game/world.ts WORLD.regions, else four towns. */
  regions?: ReadonlyArray<WorldRegion>;
  seed?: number;
}

export interface WorldRace {
  readonly world: WorldLayer;
  readonly course: WorldCourse;
  readonly race: Race;
  /** The start line, in render coordinates. */
  readonly startPose: CoursePose;
  /** The ground the car drives on, at a RENDER (x, z). */
  groundAt(x: number, z: number): number;
  /** Every frame: the world streams round the car, the car's distance is read, the race moves on. */
  update(ctx: GameContext, dt: number): { distance: number; standing: RaceStatus; km: number; totalKm: number };
  /** Back to the start line (Play again). */
  reset(): void;
  dispose(): void;
}

const TOWNS: WorldRegion[] = [
  { id: 'start-town', kind: 'town' }, { id: 'east-town', kind: 'town', toward: 'east' },
  { id: 'north-town', kind: 'town', toward: 'north' }, { id: 'far-town', kind: 'town', toward: 'north-east' },
] as WorldRegion[];

function ownRegions(): ReadonlyArray<WorldRegion> | null {
  try {
    const found = import.meta.glob('../world.ts', { eager: true, import: 'WORLD' }) as Record<string, { regions?: ReadonlyArray<WorldRegion> } | undefined>;
    const regions = Object.values(found)[0]?.regions;
    return Array.isArray(regions) && regions.length >= 2 ? regions : null;
  } catch { return null; }
}

/** Throws (with a reason a person can read) when the world has no road to race on. */
export function startWorldRace(ctx: GameContext, options: WorldRaceOptions): WorldRace {
  const regions = options.regions ?? ownRegions() ?? TOWNS;
  const world = createWorldLayer(ctx, { regions: regions as WorldRegion[], follow: options.car, placeAtSpawn: false, ...(options.seed !== undefined ? { seed: options.seed } : {}) });
  const origin = world.map.chunks!.origin;
  const legs = world.highways.map((h) => h.map((p) => ({ x: p.x, z: p.z })));
  const home = world.places[0]?.centre;
  const course = createWorldCourse({ legs, start: home ? { x: home.x, z: home.z } : undefined, heightAt: (x, z) => world.heightAt(x, z), origin: () => ({ x: origin.x, z: origin.z }), finishKm: options.finishKm ?? null });
  if (legs.length === 0 || course.length < 500) { world.dispose(); throw new Error('this world has no highway between its places to race on (it needs at least two places)'); }
  const start = course.startPose;
  const putOnStart = (): void => { options.car.position.set(start.x, start.y, start.z); options.car.rotation.y = start.heading; };
  putOnStart();
  const finish = course.finish ?? course.length;                         // the world's route ends: so does an "endless" race, for now
  const race = createRace(ctx.scene, { stream: course, opponents: options.opponents ?? 3, finishDistance: finish });
  return {
    world, course, race,
    get startPose() { return course.startPose; },
    groundAt: (x, z) => world.heightAt(x + origin.x, z + origin.z),
    update(c, dt) {
      world.frame(c, dt);
      const s = course.update(options.car);
      const standing = race.update(dt, s.distance);
      return { distance: s.distance, standing, km: s.distance / 1000, totalKm: finish / 1000 };
    },
    reset() { course.reset(); const p = course.startPose; options.car.position.set(p.x, p.y, p.z); options.car.rotation.y = p.heading; },
    dispose() { race.dispose(); course.dispose(); world.dispose(); },
  };
}
`;
