// ATHREE MAP — NATURAL BOUNDARIES, THE SEA SHELF, PONDS (talab) and THE WATER / GROUND RULES FOR EVERY MOVER
// (admin 2026-11-27: "frame → natural boundary nobody can cross → water (rivers, ponds/talab, lakes, sea; sea gets deeper from the
// shore, −1 to −50 m) → ground sheet nobody can fall through"). The emitted sources of src/game/athree/boundary.ts and movers.ts.
//
// 100% ours. Techniques (public ideas, own code):
//   • a ring around the centre of a bounded world whose radius wobbles with a seeded noise read on the circle (so it closes exactly),
//     and a height profile across the ring in the GAME's metres (a mountain wall, a canyon, a river with a forest band, a dune wall,
//     a fort wall) added to the SAME height function the renderer, the heightfield collider and every mover read;
//   • a sea floor that is a function of the distance from the shore (a beach, then a shelf down to a chosen depth), measured along
//     the ray from the centre on a bounded world, so the depth only grows going out to sea;
//   • ponds carved into that height function: a flat bottom, a bank, and ghat steps on one side;
//   • one table of water depths (wade, swim, deep) and a guard that holds every mover inside the ring, under the sky ceiling, out of
//     water too deep for it, and never under the ground (put back at its last safe point).
//
// PURE source strings; the generator writes them. Rule for editing: no backticks and no dollar-brace inside the strings below.

export const BOUNDARY = `// Athree map — natural boundaries, the sea shelf and ponds.
// Technique: a closed ring (radius = base x (1 + wobble), the wobble a seeded noise read ON the circle, so the ring closes exactly) with a
// height profile across it in game metres; a sea floor shaped by the distance from the shore (measured outward along the ray from the
// centre on a bounded world); ponds with a flat bottom, a bank and ghat steps. All of it feeds the ONE height function. Own implementation.
//
// HONEST LIMITS (said here so a game never claims more):
//   • A boundary exists only on a BOUNDED world. A loop world has no edge (it wraps), so its boundary is 'none' and nothing is held.
//   • The ring's terrain is the natural cue; the HARD guarantee is the guard in movers.ts, which a game must call for its movers every
//     frame (the open-world kit does it for the player, the car it drives and every bounded character). A mover the game never hands to
//     the guard is not held by it.
//   • 'dunes' are real sand (about 45 degrees at their steepest), so the slope alone does not stop a walker: the guard does.
//   • 'wall' is a drawn fort wall (createBoundaryWall) with no physics collider of its own: the guard is what stops a body at it.
//   • Trees in the 'forest-river' band are drawn by the plants module and have no collider.
//   • A river traced across the ring is buried by the mountain, canyon wall or dune wall there (its course is not re-routed).
//   • On a loop world the shelf follows the continental field (a fair stand-in for the distance from the shore, not a measurement of it).
//   • Ghat steps are in the height function; the terrain mesh draws them at its own resolution (crisp only up close).

import { fieldNoise, mulberry32 } from './noise';

export type BoundaryKind = 'sea' | 'mountains' | 'canyon' | 'forest-river' | 'dunes' | 'wall';
export const BOUNDARY_KINDS: readonly BoundaryKind[] = ['sea', 'mountains', 'canyon', 'forest-river', 'dunes', 'wall'];

/** What the ring tells a player near it, by kind (the soft cue). */
export const BOUNDARY_CUE: Record<BoundaryKind | 'none', string> = {
  sea: 'Open sea all around — the map ends here. Turn back.',
  mountains: 'The mountains close the map here — too steep to climb. Turn back.',
  canyon: 'A deep canyon ends the map here — there is no way across. Turn back.',
  'forest-river': 'A wide river and thick forest end the map here. Turn back.',
  dunes: 'A wall of high dunes ends the map here. Turn back.',
  wall: 'The city wall ends the map here. Turn back.',
  none: '',
};

/** A bounded world's edge, in the game's metres around the world centre (0, 0). */
export interface Boundary {
  readonly kind: BoundaryKind | 'none';
  /** Nothing flies above this height (metres). Infinity on a loop world. */
  readonly ceiling: number;
  /** Metres inside the limit over which cueAt rises from 0 to 1. */
  readonly cueBand: number;
  /** What a player near the edge is told. Empty on a loop world. */
  readonly cueText: string;
  /** Where the natural feature stands at an angle (the crest, the canyon, the river, the dune crest, the wall line). */
  featureAt(angle: number): number;
  /** The hard limit at an angle: no mover's centre goes farther from the centre than this. Infinity on a loop world. */
  limitAt(angle: number): number;
  /** Is (x, z) at least margin metres inside the limit? */
  inside(x: number, z: number, margin?: number): boolean;
  /** The nearest place at least margin metres inside the limit (the point itself when it already is). */
  clampInside(x: number, z: number, margin?: number): { x: number; z: number; moved: boolean };
  /** 0 far inside, rising to 1 at the limit: how near the edge a place is (drive a hint or a fog with it). */
  cueAt(x: number, z: number): number;
  /** The terrain across the ring: the height h (the land without the boundary) shaped by the boundary at (x, z). */
  shape(x: number, z: number, h: number): number;
  /** The land of the ring's band (forest beside the river, desert on the dunes, rock in the canyon), or null. */
  biomeAt(x: number, z: number): 'forest' | 'desert' | 'mountain' | null;
  /** n points of the limit, round the ring (for a minimap or a fence). */
  ring(n?: number): Array<{ x: number; z: number }>;
}

export interface BoundaryOptions {
  kind: BoundaryKind;
  seed: number;
  mode: 'loop' | 'bounded';
  /** Half the bounded world's size, in metres. */
  gameRadius: number;
  /** The height stretch of the world (1 at the reference size). */
  vs: number;
}

function smooth(a: number, b: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

const NONE: Boundary = {
  kind: 'none', ceiling: Infinity, cueBand: 0, cueText: '',
  featureAt: () => Infinity, limitAt: () => Infinity, inside: () => true,
  clampInside: (x, z) => ({ x, z, moved: false }), cueAt: () => 0, shape: (_x, _z, h) => h, biomeAt: () => null, ring: () => [],
};

/** The width of the ring's band in metres: 6% of the radius, held to 40 .. 260 m (a 1 km map still has a real edge). */
export function boundaryBand(gameRadius: number): number {
  return Math.max(40, Math.min(260, gameRadius * 0.06));
}

/** The canyon floor and the river plain stand this high above the sea (the ocean plane never floods the canyon). */
export const CANYON_FLOOR = 3;
export const RIVER_PLAIN = 1.5;
/** The boundary river's bed (the sea plane is its water: it is below sea level on purpose). */
export const RIVER_BED = -4;
/** The fort wall's height and thickness, metres. */
export const WALL_HEIGHT = 9;
export const WALL_THICKNESS = 2.6;

export function createBoundary(o: BoundaryOptions): Boundary {
  if (o.mode !== 'bounded') return NONE;
  const kind: BoundaryKind = BOUNDARY_KINDS.includes(o.kind) ? o.kind : 'sea';
  const R = Math.max(100, o.gameRadius);
  const w = boundaryBand(R);
  const seed = o.seed | 0;
  // The wobble is read ON the circle (cos, sin) x R, so angle 0 and angle 2 pi are the same point: the ring closes exactly.
  const wobble = (a: number): number => fieldNoise(Math.cos(a) * R, Math.sin(a) * R, seed + 71, 3, Math.max(200, R * 0.5), 0) * 2 - 1;
  const base = kind === 'sea' ? R * 0.97 : R * 0.86;
  const featureAt = (a: number): number => (kind === 'sea' ? base : base * (1 + 0.025 * wobble(a)));
  // Where each kind holds a mover: on the steep face, before the canyon's drop, at the near bank, on the dune face, at the wall.
  const channel = Math.max(10, Math.min(40, w * 0.25));
  const inset = kind === 'sea' ? 0 : kind === 'mountains' ? 0.2 * w : kind === 'canyon' ? 1.0 * w : kind === 'forest-river' ? channel : kind === 'dunes' ? 0.3 * w : WALL_THICKNESS + 1;
  const limitAt = (a: number): number => featureAt(a) - inset;
  const H = 1.6 * w;               // the mountain wall's rise: an average slope of 1.6 (58 degrees) across the band
  const D = Math.max(25, 0.5 * w); // the canyon's depth below its rim
  const Hd = 0.7 * w;              // the dune wall's rise
  const ceiling = 1000 * Math.max(1, o.vs) + (kind === 'mountains' ? H : kind === 'dunes' ? Hd : 0);
  const cueBand = Math.max(60, Math.min(250, R * 0.08));
  // Peaks beyond the crest: 1 .. 1.45 times the wall (they only ever add to it).
  const ridges = (x: number, z: number): number => { const r = 1 - Math.abs(2 * fieldNoise(x, z, seed + 73, 3, Math.max(60, w * 1.5), 0) - 1); return 1 + 0.45 * r * r; };

  function shape(x: number, z: number, h: number): number {
    if (kind === 'sea') return h;
    const d = Math.hypot(x, z);
    const u = d - featureAt(Math.atan2(z, x));
    switch (kind) {
      case 'mountains': {
        if (u < -w) return h;
        // A foot that is walkable, then a face steeper than 45 degrees over three quarters of the band, then peaks to the map's end.
        const rise = H * smooth(-w, 0, u) * (u > 0 ? 1 + (ridges(x, z) - 1) * smooth(0, w * 0.5, u) : 1);
        return Math.max(h, 0) + rise;
      }
      case 'canyon': {
        if (u < 0) {
          if (u < -2.2 * w) return h;
          // The land eases up to a rim at least D above the floor, then drops sheer to the floor.
          const rimmed = h + (Math.max(h, CANYON_FLOOR + D) - h) * smooth(-2.2 * w, -1.2 * w, u);
          return CANYON_FLOOR + (rimmed - CANYON_FLOOR) * (1 - smooth(-0.9 * w, -0.6 * w, u));
        }
        // The far wall: higher than the near rim, so a body in the canyon has no way out on either side.
        const far = Math.max(h + 0.6 * D, CANYON_FLOOR + 1.6 * D) * (1 + 0.1 * (ridges(x, z) - 1));
        return CANYON_FLOOR + (far - CANYON_FLOOR) * smooth(0.6 * w, 0.9 * w, u);
      }
      case 'forest-river': {
        const au = Math.abs(u);
        if (au > 2 * w) return h;
        // A plain beside the river on both sides, and the channel cut below sea level (the sea plane is its water).
        const plain = smooth(-2 * w, -0.8 * w, u) * (1 - smooth(0.8 * w, 2 * w, u));
        const onPlain = h + (RIVER_PLAIN - h) * plain;
        const g = 1 - smooth(channel * 0.6, channel, au);
        return onPlain + (RIVER_BED - onPlain) * g;
      }
      case 'dunes': {
        if (u < -1.2 * w) return h;
        const rise = Hd * smooth(-w, 0, u) * (0.85 + 0.3 * fieldNoise(x, z, seed + 75, 3, Math.max(40, w * 0.8), 0));
        return Math.max(h, 0) + rise;
      }
      case 'wall': {
        // A level footing under the wall (so it stands on even ground), and the land itself beyond it.
        const au = Math.abs(u);
        if (au > 30) return h;
        const footing = Math.max(h, RIVER_PLAIN);
        return h + (footing - h) * (1 - smooth(12, 30, au));
      }
    }
    return h;
  }

  function biomeAt(x: number, z: number): 'forest' | 'desert' | 'mountain' | null {
    if (kind === 'sea' || kind === 'wall' || kind === 'mountains') return null;
    const u = Math.hypot(x, z) - featureAt(Math.atan2(z, x));
    if (kind === 'forest-river') { const au = Math.abs(u); return au > channel && au < 2 * w ? 'forest' : null; }
    if (kind === 'dunes') return u > -1.2 * w ? 'desert' : null;
    return u > -w ? 'mountain' : null;
  }

  function clampInside(x: number, z: number, margin = 0): { x: number; z: number; moved: boolean } {
    const d = Math.hypot(x, z);
    if (!Number.isFinite(d)) return { x: 0, z: 0, moved: true };
    const a = Math.atan2(z, x);
    const lim = Math.max(0, limitAt(a) - Math.max(0, margin));
    if (d <= lim) return { x, z, moved: false };
    return { x: Math.cos(a) * lim, z: Math.sin(a) * lim, moved: true };
  }

  return {
    kind, ceiling, cueBand, cueText: BOUNDARY_CUE[kind],
    featureAt, limitAt, shape, biomeAt, clampInside,
    inside: (x, z, margin = 0) => Math.hypot(x, z) <= limitAt(Math.atan2(z, x)) - Math.max(0, margin),
    cueAt: (x, z) => { const d = Math.hypot(x, z); const lim = limitAt(Math.atan2(z, x)); return smooth(lim - cueBand, lim, d); },
    ring: (n = 256) => { const out: Array<{ x: number; z: number }> = []; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; const r = limitAt(a); out.push({ x: Math.cos(a) * r, z: Math.sin(a) * r }); } return out; },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The sea shelf.

export interface ShelfOptions {
  /** The deepest the sea gets, metres (5 .. 50, default 50). */
  maxDepth?: number;
  /** The sandy band from the waterline to 2 m deep, metres (default 40). */
  beach?: number;
  /** How far past the beach the shelf takes to reach maxDepth, metres (default 600). */
  width?: number;
}

export const SHELF_DEFAULTS = { maxDepth: 50, beach: 40, width: 600 } as const;
/** The depth at the outer edge of the beach. */
export const BEACH_DEPTH = 2;

/** The sea's depth (positive metres) at a distance from the shore: 0 at the waterline, 2 m at the beach's edge, maxDepth past the shelf. Never decreasing. */
export function shelfDepth(distance: number, o: ShelfOptions = {}): number {
  const max = Math.max(5, Math.min(50, Number.isFinite(o.maxDepth) ? (o.maxDepth as number) : SHELF_DEFAULTS.maxDepth));
  const beach = Math.max(5, Number.isFinite(o.beach) ? (o.beach as number) : SHELF_DEFAULTS.beach);
  const width = Math.max(20, Number.isFinite(o.width) ? (o.width as number) : SHELF_DEFAULTS.width);
  if (!(distance > 0)) return 0;
  if (distance <= beach) return BEACH_DEPTH * smooth(0, beach, distance) * 0.5 + BEACH_DEPTH * (distance / beach) * 0.5;
  return BEACH_DEPTH + (max - BEACH_DEPTH) * smooth(0, width, distance - beach);
}

/**
 * The outermost shore along each of n rays from the centre: the farthest radius (up to maxR) where isLand is true. Coarse steps from
 * the outside in, then a bisection to a metre. radii[i] is for angle i / n x 2 pi; 0 when a ray meets no land.
 */
export function shoreRadii(isLand: (x: number, z: number) => boolean, maxR: number, n = 720, step = 40): Float64Array {
  const radii = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    let out = maxR, r = maxR;
    while (r > 0 && !isLand(c * r, s * r)) { out = r; r -= step; }
    if (r <= 0) { radii[i] = 0; continue; }
    let lo = r, hi = out;
    for (let k = 0; k < 8 && hi - lo > 0.5; k++) { const m = (lo + hi) / 2; if (isLand(c * m, s * m)) lo = m; else hi = m; }
    radii[i] = lo;
  }
  return radii;
}

/** The shore radius at an angle, read from shoreRadii by linear interpolation round the ring. */
export function shoreAt(radii: Float64Array, angle: number): number {
  const n = radii.length;
  if (!n) return 0;
  let t = (angle / (Math.PI * 2)) * n;
  t = ((t % n) + n) % n;
  const i = Math.floor(t), f = t - i;
  return radii[i] * (1 - f) + radii[(i + 1) % n] * f;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Ponds (talab).

export interface Pond {
  id: number;
  x: number;
  z: number;
  /** The water's radius, metres. */
  radius: number;
  /** The water surface height. */
  level: number;
  /** The flat bottom's height (level minus the depth). */
  bottom: number;
  /** The direction the ghat steps face the water from (radians, world angle from the pond's centre). */
  ghat: number;
}

export const POND_DEPTH = 1.8;
export const POND_STEPS = 6;
/** Half the angle the ghat steps cover. */
export const GHAT_HALF_ANGLE = 0.45;
/** At most this many ponds on a map (a request for more is held to it, and said). */
export const MAX_PONDS = 40;

/** The rim stands this far above the water. */
const RIM = 0.5;

/** The ground of a pond at (x, z) given the land h there, or h itself outside its reach (1.35 x its radius). */
export function pondHeight(p: Pond, x: number, z: number, h: number): number {
  const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
  if (d >= p.radius * 1.35) return h;
  const rimH = p.level + RIM;
  if (d >= p.radius) return h + (rimH - h) * (1 - smooth(p.radius, p.radius * 1.35, d));
  let da = Math.atan2(dz, dx) - p.ghat;
  da = Math.atan2(Math.sin(da), Math.cos(da));
  if (Math.abs(da) <= GHAT_HALF_ANGLE) {
    // Ghat steps: from the rim down to the bottom in POND_STEPS equal treads over the outer 40% of the radius.
    const tread = (p.radius * 0.4) / POND_STEPS, rise = (rimH - p.bottom) / POND_STEPS;
    const n = Math.min(POND_STEPS, Math.floor((p.radius - d) / tread) + 1);
    return Math.max(p.bottom, rimH - n * rise);
  }
  // The bowl: a flat bottom inside 60% of the radius, a smooth bank up to the rim.
  return p.bottom + (rimH - p.bottom) * smooth(p.radius * 0.6, p.radius, d);
}

export interface PondSite {
  /** The land without ponds (with rivers, roads and the boundary). */
  ground(x: number, z: number): number;
  /** True where a river, a lake or a road is (no pond within reach of one). */
  busy(x: number, z: number): boolean;
  /** True where a pond may stand at all (inside the play area). */
  allowed(x: number, z: number): boolean;
  /** Land lower than this is beach or sea. */
  minLand: number;
  /** Search this far from the centre, metres. */
  reach: number;
}

/** How far from a pond's rim the nearest road or other water must be, metres (a town's talab fits inside a block of colony streets). */
export const POND_CLEAR = 20;

/** Place up to count ponds on FLAT dry ground away from water and roads, seeded: the same seed gives the same ponds. */
export function placePonds(seed: number, count: number, site: PondSite): Pond[] {
  const want = Math.max(0, Math.min(MAX_PONDS, Math.floor(Number.isFinite(count) ? count : 0)));
  const out: Pond[] = [];
  if (!want) return out;
  const rng = mulberry32((seed ^ 0x7a1ab) | 0);
  for (let attempt = 0; attempt < 6000 && out.length < want; attempt++) {
    const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * site.reach;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const radius = 12 + rng() * 14;
    const ghat = rng() * Math.PI * 2;
    if (!site.allowed(x, z)) continue;
    if (out.some((p) => Math.hypot(p.x - x, p.z - z) < (p.radius + radius) * 2.5)) continue;
    const h0 = site.ground(x, z);
    if (!(h0 > site.minLand + 1)) continue;
    // Flat: the centre and 16 points on the outer reach within 1.5 m of each other; no water or road near the rim (read below).
    let lo = h0, hi = h0, ok = true;
    for (let i = 0; i < 16 && ok; i++) {
      const b = (i / 16) * Math.PI * 2;
      const px = x + Math.cos(b) * radius * 1.4, pz = z + Math.sin(b) * radius * 1.4;
      const g = site.ground(px, pz);
      lo = Math.min(lo, g); hi = Math.max(hi, g);
      if (!(hi - lo <= 1.5) || !site.allowed(px, pz)) ok = false;
    }
    if (!ok || site.busy(x, z)) continue;
    // No water or road within POND_CLEAR metres of the rim, and none may slip between the samples (found 2026-11-27: on a planned town
    // grid, ponds landed ON 7 m streets that crossed the old 60 m ring between its 8 points — and a 60 m ring, read properly, leaves no
    // room for a talab anywhere in a town). A road that comes that near the rim crosses the ring, so the ring is read every 4 m (narrower
    // than the narrowest lane); the pond's bank ring is read too, for a dead-end that stops inside it.
    const ringN = Math.ceil((Math.PI * 2 * (radius + POND_CLEAR)) / 4);
    for (let i = 0; i < ringN && ok; i++) {
      const b = (i / ringN) * Math.PI * 2;
      if (site.busy(x + Math.cos(b) * (radius + POND_CLEAR), z + Math.sin(b) * (radius + POND_CLEAR))) ok = false;
    }
    for (let i = 0; i < 16 && ok; i++) {
      const b = ((i + 0.5) / 16) * Math.PI * 2;
      if (site.busy(x + Math.cos(b) * radius * 1.4, z + Math.sin(b) * radius * 1.4)) ok = false;
    }
    if (!ok) continue;
    // The rim sits on the lowest land round it, so the water never stands above the ground beside the pond.
    const level = lo - RIM;
    out.push({ id: out.length, x, z, radius, level, bottom: level - POND_DEPTH, ghat });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The fort wall, drawn ('wall' boundary). three.js is passed in by the caller; typed loosely here on purpose.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ThreeLike = any;

export interface BoundaryWall {
  readonly group: ThreeLike;
  /** Call every frame with the camera in WORLD metres and the floating origin: draws the wall within reach of the camera. */
  update(cameraX: number, cameraZ: number, origin: { x: number; z: number }): void;
  /** How many wall segments are drawn now. */
  drawn(): number;
  dispose(): void;
}

/** A crenellated stone wall along the boundary's feature line, standing on the ground, drawn within reach metres of the camera. */
export function createBoundaryWall(THREE: ThreeLike, boundary: Boundary, groundAt: (x: number, z: number) => number, reach = 1500): BoundaryWall {
  const SEG = 6;
  const r0 = boundary.featureAt(0);
  const n = Number.isFinite(r0) ? Math.max(16, Math.ceil((Math.PI * 2 * r0) / SEG)) : 0;
  const max = Math.min(n, Math.ceil((reach * 2.4) / SEG) + 8);
  const group = new THREE.Group();
  group.name = 'Boundary wall';
  group.userData.ground = false;
  const stone = new THREE.MeshStandardMaterial({ color: 0x9c8f7a, roughness: 0.95 });
  const body = new THREE.InstancedMesh(new THREE.BoxGeometry(SEG + 0.3, WALL_HEIGHT + 6, WALL_THICKNESS), stone, Math.max(1, max));
  const merlon = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, 1.5, WALL_THICKNESS), stone, Math.max(1, max * 2));
  body.count = 0; merlon.count = 0;
  group.add(body, merlon);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  let lastX = Infinity, lastZ = Infinity, count = 0;
  function rebuild(cx: number, cz: number): void {
    let b = 0, k = 0;
    for (let i = 0; i < n && b < max; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      const r0i = boundary.featureAt(a0), r1i = boundary.featureAt(a1);
      const x0 = Math.cos(a0) * r0i, z0 = Math.sin(a0) * r0i, x1 = Math.cos(a1) * r1i, z1 = Math.sin(a1) * r1i;
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      if (Math.hypot(mx - cx, mz - cz) > reach) continue;
      const g = Math.min(groundAt(x0, z0), groundAt(x1, z1), groundAt(mx, mz));
      q.setFromAxisAngle(up, Math.atan2(-(z1 - z0), x1 - x0));
      // The body reaches 6 m below the lowest ground under it, so a slope never shows a gap.
      m.compose(pos.set(mx, g + (WALL_HEIGHT + 6) / 2 - 6, mz), q, one); body.setMatrixAt(b++, m);
      const tx = (x1 - x0) / 4, tz = (z1 - z0) / 4;
      for (const f of [-1, 1]) { m.compose(pos.set(mx + tx * f, g + WALL_HEIGHT + 0.75, mz + tz * f), q, one); merlon.setMatrixAt(k++, m); }
    }
    body.count = b; merlon.count = k; count = b;
    body.instanceMatrix.needsUpdate = true; merlon.instanceMatrix.needsUpdate = true;
  }
  return {
    group,
    update(cameraX, cameraZ, origin) {
      if (n && Math.hypot(cameraX - lastX, cameraZ - lastZ) > reach * 0.1) { lastX = cameraX; lastZ = cameraZ; rebuild(cameraX, cameraZ); }
      group.position.set(-origin.x, 0, -origin.z);
    },
    drawn: () => count,
    dispose() { body.geometry.dispose(); merlon.geometry.dispose(); stone.dispose(); },
  };
}
`;

export const MOVERS = `// Athree map — the water and ground rules for every mover.
// Technique: one table of water depths (dry, wade, swim, deep) read from the world's own water and ground, a rule per kind of mover,
// and a guard that, every frame, holds a mover inside the boundary, under the sky ceiling, out of water too deep for it, and never under
// the ground (a mover found under it is put back at its last safe point). Own implementation.
//
// HONEST LIMITS: the guard only holds what a game hands to it (the open-world kit hands it the player, the car it drives and every
// bounded character each frame). It moves a body back; it does not steer it: a bot is held at the edge, not routed along it.

import type { AthreeWorld } from './world';

export type WaterClass = 'dry' | 'wade' | 'swim' | 'deep';
export type MoverKind = 'person' | 'animal' | 'bot' | 'car' | 'bike' | 'boat' | 'aircraft';

/** Below this depth a place is dry. */
export const DRY_DEPTH = 0.05;
/** Up to this a person wades (waist deep), slower. */
export const WADE_DEPTH = 0.9;
/** From this a person cannot cross on foot: deep water needs a boat. Between WADE_DEPTH and this a person swims. */
export const DEEP_DEPTH = 4;
/** A car or a bike fords water up to this depth, slowly; deeper, its engine stalls and it is held at the water's edge. */
export const FORD_DEPTH = 0.4;
/** A car in water deeper than this sinks (the athree car settles on the bed, its engine dead). */
export const SINK_DEPTH = 1.2;
/** A boat needs at least this much water under it; shallower, it runs aground. */
export const BOAT_DEPTH = 0.6;
/** A mover found more than this far under the ground is put back at its last safe point. */
export const NET_MARGIN = 2;

export interface WaterReading {
  /** The water surface over the place, or null on dry land. */
  surface: number | null;
  /** Metres of water over the ground (0 on dry land). */
  depth: number;
  kind: 'sea' | 'river' | 'lake' | 'pond' | null;
  cls: WaterClass;
}

export function waterClass(depth: number): WaterClass {
  return depth < DRY_DEPTH ? 'dry' : depth < WADE_DEPTH ? 'wade' : depth < DEEP_DEPTH ? 'swim' : 'deep';
}

/** The water at a place: the sea where the ground is under sea level, else a river, lake or pond the world reports. */
export function waterDepthAt(world: AthreeWorld, x: number, z: number): WaterReading {
  const ground = world.heightAt(x, z);
  let surface: number | null = null;
  let kind: WaterReading['kind'] = null;
  const w = world.waterAt(x, z);
  if (w && Number.isFinite(w.surface) && w.surface > ground) { surface = w.surface; kind = w.kind as WaterReading['kind']; }
  if (ground < world.seaLevel && (surface === null || world.seaLevel > surface)) { surface = world.seaLevel; kind = 'sea'; }
  const depth = surface === null || !Number.isFinite(ground) ? 0 : Math.max(0, surface - ground);
  return { surface: depth > 0 ? surface : null, depth, kind: depth > 0 ? kind : null, cls: waterClass(depth) };
}

export interface MoverRule {
  /** May this mover be here at all? */
  allowed: boolean;
  /** What it does here: walk, wade, swim, drive, ford, float, fly. */
  mode: 'walk' | 'wade' | 'swim' | 'drive' | 'ford' | 'float' | 'fly' | 'blocked';
  /** Multiply its speed by this. */
  speed: number;
  /** Why it may not be here (said to the player), or null. */
  reason: string | null;
}

/** What a mover of this kind does in water this deep. */
export function moverRule(kind: MoverKind, depth: number): MoverRule {
  if (kind === 'aircraft') return { allowed: true, mode: 'fly', speed: 1, reason: null };
  if (kind === 'boat') {
    return depth >= BOAT_DEPTH ? { allowed: true, mode: 'float', speed: 1, reason: null } : { allowed: false, mode: 'blocked', speed: 0, reason: 'Too shallow for the boat — it would run aground.' };
  }
  if (kind === 'car' || kind === 'bike') {
    if (depth < DRY_DEPTH) return { allowed: true, mode: 'drive', speed: 1, reason: null };
    if (depth <= FORD_DEPTH) return { allowed: true, mode: 'ford', speed: 0.45, reason: null };
    return { allowed: false, mode: 'blocked', speed: 0, reason: 'Too deep to drive — the engine would stall. Find a bridge or a boat.' };
  }
  const c = waterClass(depth);
  if (c === 'dry') return { allowed: true, mode: 'walk', speed: 1, reason: null };
  if (c === 'wade') return { allowed: true, mode: 'wade', speed: 0.55, reason: null };
  if (c === 'swim') return { allowed: true, mode: 'swim', speed: 0.4, reason: null };
  return { allowed: false, mode: 'blocked', speed: 0, reason: 'Too deep to cross on foot — you need a boat.' };
}

export type HoldReason = 'edge' | 'ceiling' | 'fell' | 'water' | null;

export interface HoldResult {
  /** True when the position was changed. */
  moved: boolean;
  /** The first thing that moved it (edge, ceiling, fell, water), or null. */
  reason: HoldReason;
  water: WaterReading;
  rule: MoverRule;
  /** What to tell the player when it was held, or null. */
  say: string | null;
}

export interface MoverGuard {
  /**
   * Hold one mover (its WORLD position, changed in place). key is anything that names it (the object itself). Call it every frame,
   * after the mover moved. A body with no safe point yet (its first frame) is only held by the edge and the ceiling.
   */
  hold(key: object, p: { x: number; y: number; z: number }, kind?: MoverKind): HoldResult;
  /** Forget a mover (it left the game). */
  forget(key: object): void;
  /** The last safe point recorded for a mover, or null. */
  lastSafe(key: object): { x: number; y: number; z: number } | null;
}

/** How far inside the limit each kind of mover is held (its own half size, about). */
const EDGE_MARGIN: Record<MoverKind, number> = { person: 0.5, animal: 0.8, bot: 0.5, car: 2, bike: 1.2, boat: 4, aircraft: 8 };

export function createMoverGuard(world: AthreeWorld, options: { netMargin?: number } = {}): MoverGuard {
  const net = Math.max(0.25, Number.isFinite(options.netMargin) ? (options.netMargin as number) : NET_MARGIN);
  const safe = new WeakMap<object, { x: number; y: number; z: number }>();
  const groundOf = (kind: MoverKind, x: number, z: number): number => (kind === 'car' || kind === 'bike' ? world.drivableHeightAt(x, z) : world.heightAt(x, z));
  const boundary = world.boundary;
  return {
    hold(key, p, kind = 'person') {
      let reason: HoldReason = null;
      let say: string | null = null;
      const last = safe.get(key) || null;
      const note = (r: HoldReason, s: string | null): void => { if (!reason) { reason = r; say = s; } };
      if (!(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z))) {
        if (last) { p.x = last.x; p.y = last.y; p.z = last.z; note('fell', null); }
      }
      // 1. The edge: the ring's hard limit.
      if (boundary && boundary.kind !== 'none') {
        const c = boundary.clampInside(p.x, p.z, EDGE_MARGIN[kind]);
        if (c.moved) { p.x = c.x; p.z = c.z; note('edge', boundary.cueText); }
      }
      // 2. The sky ceiling.
      if (boundary && p.y > boundary.ceiling) { p.y = boundary.ceiling; note('ceiling', 'This is as high as the map goes.'); }
      // 3. The ground sheet: nothing is ever under it. A body found below it goes back to its last safe point, on the surface.
      let g = groundOf(kind, p.x, p.z);
      if (Number.isFinite(g) && p.y < g - net) {
        if (last) { p.x = last.x; p.z = last.z; }
        g = groundOf(kind, p.x, p.z);
        p.y = Math.max(last ? last.y : g, g);
        note('fell', null);
      }
      // 4. Water too deep (or too shallow, for a boat) for this mover: back to where it last could be.
      let water = waterDepthAt(world, p.x, p.z);
      const onDeck = (kind === 'car' || kind === 'bike') && water.surface !== null && world.drivableHeightAt(p.x, p.z) > water.surface;
      let rule = moverRule(kind, onDeck ? 0 : water.depth);
      if (!rule.allowed && last) {
        p.x = last.x; p.z = last.z; p.y = Math.max(p.y, groundOf(kind, p.x, p.z));
        note('water', rule.reason);
        water = waterDepthAt(world, p.x, p.z);
        rule = moverRule(kind, water.depth);
      }
      // A place is recorded as safe only when nothing had to move the body there and the body may be there.
      if (!reason && rule.allowed && Number.isFinite(g) && p.y >= g - 0.25) safe.set(key, { x: p.x, y: p.y, z: p.z });
      return { moved: reason !== null, reason, water, rule, say };
    },
    forget: (key) => { safe.delete(key); },
    lastSafe: (key) => { const s = safe.get(key); return s ? { ...s } : null; },
  };
}
`;
