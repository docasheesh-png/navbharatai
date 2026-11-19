// The source of the 2D world kit, written into a game as src/game/world2d/ by World2DGenerator.ts.
// Kept as text so the server writes exactly these bytes; tests/theTwoDWorldIsOneSeamlessMap.test.ts typechecks
// and runs them. After editing, run `node scripts/gameKitHistory.mjs` (the kit history census requires it).

export const WORLD2D_SAMPLES_SOURCE = String.raw`// THE 2D WORLD'S SAMPLE CHUNKS — pre-made 16 x 16 tile pieces that the world joins into one map (NavBharatAI's own work).
//
// Every sample keeps two promises, and the world relies on both (they are checked by NavBharatAI's tests):
//   1. Its outer ring of tiles is plain ground, so two samples side by side always meet on open ground.
//   2. The road corridor (rows 6-9 and columns 6-9) holds only soft tiles (ground, flowers, bush, sand,
//      dry grass), so a road laid through any sample never cuts a house, a tree or a pond in half.
// Legend: . ground  f flowers  b bush  s sand  d dry grass  T tree  P pine  R rock  W water  H house  w well  C cactus
// Add a sample: keep both promises, give it one of the biomes below, and it joins the world at once.

export type Biome = 'meadow' | 'forest' | 'lake' | 'village' | 'desert';

export interface Sample {
  id: string;
  biome: Biome;
  rows: readonly string[];
}

export const CHUNK_TILES = 16;

export const SAMPLES: readonly Sample[] = [
  { id: 'meadow-flowers', biome: 'meadow', rows: [
    '................',
    '.f..b......T..f.',
    '..T....f.....b..',
    '.....f.......T..',
    '.b..........f...',
    '...T...b..f.....',
    '.f........b.....',
    '.......f........',
    '..b.........f...',
    '....f...........',
    '.T.....f...T....',
    '...f.........b..',
    '..b........T....',
    '.....T......f...',
    '.f.....b........',
    '................'
  ] },
  { id: 'meadow-copse', biome: 'meadow', rows: [
    '................',
    '.TT..f.....f.b..',
    '.TTT.......TT...',
    '..T..b....TTT...',
    '.....f.....T..f.',
    '.f..........b...',
    '...b......f.....',
    '.........b......',
    '.....f..........',
    '.b..........f...',
    '..R.........b...',
    '.......f...T.T..',
    '.f..b......TTT..',
    '....R.......T...',
    '..f....b.....f..',
    '................'
  ] },
  { id: 'forest-deep', biome: 'forest', rows: [
    '................',
    '.PPTP......PTPP.',
    '.PTPP.....TPPTP.',
    '.PPP.b.....PPTP.',
    '.TPP.......PP.P.',
    '.PP.P.b....TPPP.',
    '..b.......b.....',
    '.f..............',
    '.........b......',
    '.b..........f...',
    '.PPTP.....PPTP..',
    '.PTPP.....PPPTP.',
    '.PPP.....bTPPP..',
    '.TP.PP.....PPTP.',
    '.PPP.R.....P.PP.',
    '................'
  ] },
  { id: 'forest-clearing', biome: 'forest', rows: [
    '................',
    '.PP.P.b....PTP..',
    '.TPP.......PP.P.',
    '.P.R........TPP.',
    '.PP..f.....f.PP.',
    '.T..........R.P.',
    '.....b..f.......',
    '..f.............',
    '.........f..b...',
    '.b...f..........',
    '.P..........f.P.',
    '.PT.R.......TPP.',
    '.PPP.f.....PP.P.',
    '.TPP.......PTPP.',
    '.PP.P.b....P.PT.',
    '................'
  ] },
  { id: 'lake-pond', biome: 'lake', rows: [
    '................',
    '.f.sss......b...',
    '.sWWWs......T...',
    '.WWWWWs.........',
    '.WWWWWs......f..',
    '.sWWWs....b.sss.',
    '..ss........sss.',
    '..f.............',
    '.........b......',
    '.b........f.....',
    '..........sWWWs.',
    '..f.......WWWWW.',
    '.T........sWWWs.',
    '...b.......sss..',
    '.......f.....T..',
    '................'
  ] },
  { id: 'lake-reeds', biome: 'lake', rows: [
    '................',
    '.T.........sss..',
    '...b......sWWWs.',
    '.f........WWWWs.',
    '..........sWWWs.',
    '.sss..b....sss..',
    '.sss......b.....',
    '.ss.............',
    '.........f..b...',
    '....b...........',
    '.ssss......f..T.',
    '.sWWs...........',
    '.WWWs.....b.....',
    '.sWWs........f..',
    '..ss...f........',
    '................'
  ] },
  { id: 'village-square', biome: 'village', rows: [
    '................',
    '.HH.f......HH.T.',
    '.HH........HH...',
    '....f.b.f.......',
    '.H.w.......f.H..',
    '.....f.....b....',
    '..b.......f.....',
    '.f..............',
    '..........b.....',
    '.....f..........',
    '.H.......f...H..',
    '.....b...b...H..',
    '.HH.........f...',
    '.HH..f....HH....',
    '...b......HH..T.',
    '................'
  ] },
  { id: 'village-farms', biome: 'village', rows: [
    '................',
    '.ddddd.....HH...',
    '.ddddd.....HH.f.',
    '.ddddd..........',
    '.......f...w....',
    '.H..b......dddd.',
    '...........d....',
    '.f......d.......',
    '.....b..........',
    '..........f.....',
    '.dddd.....ddddd.',
    '.dddd.....ddddd.',
    '.dddd..b..ddddd.',
    '......f.........',
    '.HH.........H.T.',
    '................'
  ] },
  { id: 'desert-dunes', biome: 'desert', rows: [
    '................',
    '.d..C...d...dd..',
    '..dd......C.....',
    '.....R.d....d.C.',
    '.C.d.......d....',
    '...dd.d....R..d.',
    '..d....d...d....',
    '.d..............',
    '.....d....d.....',
    '..d.......d.d...',
    '.C...dd.d..C....',
    '...R.......dd...',
    '.dd...d...C...d.',
    '...C.....d..R...',
    '.d...dd.....d.C.',
    '................'
  ] },
  { id: 'desert-oasis', biome: 'desert', rows: [
    '................',
    '.C...d.....d..C.',
    '...dd...d....d..',
    '.R....d....sss..',
    '..d.......sWWWs.',
    '.d..C....sWWWWs.',
    '...d.....dsss...',
    '.d........d.....',
    '.....d..........',
    '..d.......d.....',
    '.sss.....d...C..',
    '.sWWs..d....d...',
    '.sWWWs....C...R.',
    '..sss...d.......',
    '.C....d....dd.C.',
    '................'
  ] },
];
`;

export const WORLD2D_WORLD_SOURCE = String.raw`// THE 2D WORLD — an endless (or bounded) top-down map joined from pre-made sample chunks (NavBharatAI's own work).
//
// How the pieces become ONE map, with no seam anywhere:
//   - Each chunk is a sample from samples.ts, picked by a seeded hash from the biome the land asks for, and
//     sometimes mirrored, so the same sample never reads as a repeat.
//   - Roads cross a chunk edge only at its middle (tiles 7 and 8). Whether an edge carries a road is decided
//     ONCE per edge, from the edge's own coordinates, so both chunks that share it always agree: a road that
//     leaves one chunk always enters the next. Highways run straight every few rows and columns; local roads
//     join them at random.
//   - The ground colour is one smooth function of the tile's world position, not of the chunk, so grass
//     fades into forest floor and sand across chunk edges with no line between them.
// Coordinates: tiles are integers (tx, ty); pixels are tx * tileSize. Chunks are CHUNK_TILES tiles wide.
// Deterministic: the same seed always gives the same world, on every device.

import { CHUNK_TILES, SAMPLES, type Biome, type Sample } from './samples';

export type TileKind =
  | 'ground' | 'flowers' | 'bush' | 'sand' | 'dry' | 'tree' | 'pine' | 'rock' | 'water'
  | 'house' | 'well' | 'cactus' | 'road' | 'bridge' | 'void';

export interface Tile {
  kind: TileKind;
  /** True when a player or vehicle cannot pass. */
  solid: boolean;
  /** True on a road or a bridge. */
  road: boolean;
  /** The ground colour under the tile, as a CSS colour. */
  ground: string;
}

export interface ChunkSockets { n: boolean; e: boolean; s: boolean; w: boolean }

export interface Chunk {
  cx: number;
  cy: number;
  /** The sample this chunk was made from, or null outside a bounded world. */
  sample: string | null;
  biome: Biome | null;
  sockets: ChunkSockets;
  /** CHUNK_TILES x CHUNK_TILES tile kinds, row by row. */
  kinds: TileKind[];
}

export interface World2DOptions {
  /** Same seed, same world. Default 1. */
  seed?: number;
  /** Pixels per tile. Default 32. */
  tileSize?: number;
  /** Chunks across a bounded square map. Omit (or null) for an endless map. */
  sizeChunks?: number | null;
  /** A highway every this many chunk rows and columns (2 to 12). Default 4. */
  highwayEvery?: number;
  /** Chance that a non-highway chunk edge carries a local road (0 to 1). Default 0.3. */
  localRoads?: number;
}

export interface World2D {
  readonly seed: number;
  readonly tileSize: number;
  readonly chunkTiles: number;
  /** null for an endless map; otherwise the map's edges in pixels. */
  readonly bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
  chunkAt(cx: number, cy: number): Chunk;
  tileAt(tx: number, ty: number): Tile;
  /** The tile under a point in pixels. */
  tileAtPixel(x: number, y: number): Tile;
  isSolid(x: number, y: number): boolean;
  isRoad(x: number, y: number): boolean;
  biomeAt(x: number, y: number): Biome | null;
  /** A safe place to start: on a road near the map's centre (on open ground if the map has no road). */
  spawnPoint(): { x: number; y: number };
  /** How many chunks are held in memory right now (the cache is bounded). */
  cachedChunks(): number;
}

const SOLID: ReadonlySet<TileKind> = new Set<TileKind>(['tree', 'pine', 'rock', 'water', 'house', 'well', 'cactus', 'void']);
const LEGEND: Readonly<Record<string, TileKind>> = {
  '.': 'ground', f: 'flowers', b: 'bush', s: 'sand', d: 'dry', T: 'tree', P: 'pine', R: 'rock',
  W: 'water', H: 'house', w: 'well', C: 'cactus',
};
const MAX_CACHED_CHUNKS = 512;
const ROAD_A = 7;
const ROAD_B = 8;

/** A well-mixed 32-bit hash of integers, as a number in [0, 1). */
export function hash01(seed: number, a: number, b: number, c = 0): number {
  let h = (seed | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (a | 0), 0x85ebca6b); h ^= h >>> 13;
  h = Math.imul(h ^ (b | 0), 0xc2b2ae35); h ^= h >>> 16;
  h = Math.imul(h ^ (c | 0), 0x27d4eb2f); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Smooth value noise in [0, 1): continuous everywhere, so neighbouring tiles always get neighbouring values. */
export function valueNoise(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x); const y0 = Math.floor(y);
  const fx = smooth(x - x0); const fy = smooth(y - y0);
  const a = hash01(seed, x0, y0); const b = hash01(seed, x0 + 1, y0);
  const c = hash01(seed, x0, y0 + 1); const d = hash01(seed, x0 + 1, y0 + 1);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const ramp = (lo: number, hi: number, v: number): number => smooth(clamp01((v - lo) / (hi - lo)));
const mod = (a: number, n: number): number => ((a % n) + n) % n;

export function createWorld2D(options: World2DOptions = {}): World2D {
  const seed = Number.isFinite(options.seed) ? Math.floor(options.seed as number) : 1;
  const tileSize = Number.isFinite(options.tileSize) && (options.tileSize as number) >= 4 ? Math.floor(options.tileSize as number) : 32;
  const size = options.sizeChunks == null ? null : Math.max(1, Math.min(4096, Math.floor(options.sizeChunks)));
  const every = Math.max(2, Math.min(12, Math.floor(options.highwayEvery ?? 4)));
  const localRoads = clamp01(options.localRoads ?? 0.3);
  const minChunk = size === null ? 0 : -Math.floor(size / 2);
  const maxChunk = size === null ? 0 : minChunk + size - 1;
  const inside = (cx: number, cy: number): boolean => size === null || (cx >= minChunk && cx <= maxChunk && cy >= minChunk && cy <= maxChunk);
  const rowOffset = Math.floor(hash01(seed, 11, 0) * every);
  const colOffset = Math.floor(hash01(seed, 12, 0) * every);
  const highwayRow = (cy: number): boolean => mod(cy - rowOffset, every) === 0;
  const highwayCol = (cx: number): boolean => mod(cx - colOffset, every) === 0;
  const byBiome = new Map<Biome, Sample[]>();
  for (const sample of SAMPLES) byBiome.set(sample.biome, [...(byBiome.get(sample.biome) ?? []), sample]);

  // An edge between (cx, cy) and (cx + 1, cy) is "vertical", keyed by its right chunk; an edge between (cx, cy)
  // and (cx, cy + 1) is "horizontal", keyed by its lower chunk. Both neighbours read the same key.
  const verticalEdgeRoad = (cx: number, cy: number): boolean =>
    inside(cx - 1, cy) && inside(cx, cy) && (highwayRow(cy) || hash01(seed, cx, cy, 21) < localRoads);
  const horizontalEdgeRoad = (cx: number, cy: number): boolean =>
    inside(cx, cy - 1) && inside(cx, cy) && (highwayCol(cx) || hash01(seed, cx, cy, 22) < localRoads);

  const heat = (tx: number, ty: number): number => valueNoise(seed + 101, tx / 56, ty / 56);
  const moisture = (tx: number, ty: number): number => valueNoise(seed + 202, tx / 44, ty / 44);
  const biomeFor = (cx: number, cy: number): Biome => {
    const tx = cx * CHUNK_TILES + CHUNK_TILES / 2; const ty = cy * CHUNK_TILES + CHUNK_TILES / 2;
    if (heat(tx, ty) > 0.66) return 'desert';
    if (hash01(seed, cx, cy, 31) < 0.12) return 'village';
    const m = moisture(tx, ty);
    if (m > 0.64) return 'lake';
    if (m > 0.5) return 'forest';
    return 'meadow';
  };

  const cache = new Map<string, Chunk>();
  const VOID_KINDS: TileKind[] = new Array<TileKind>(CHUNK_TILES * CHUNK_TILES).fill('void');

  function buildChunk(cx: number, cy: number): Chunk {
    const sockets: ChunkSockets = {
      n: horizontalEdgeRoad(cx, cy), s: horizontalEdgeRoad(cx, cy + 1),
      w: verticalEdgeRoad(cx, cy), e: verticalEdgeRoad(cx + 1, cy),
    };
    if (!inside(cx, cy)) return { cx, cy, sample: null, biome: null, sockets, kinds: VOID_KINDS.slice() };
    const biome = biomeFor(cx, cy);
    const pool = byBiome.get(biome) ?? SAMPLES;
    const sample = pool[Math.floor(hash01(seed, cx, cy, 41) * pool.length)] ?? SAMPLES[0];
    const flipX = hash01(seed, cx, cy, 42) < 0.5;
    const flipY = hash01(seed, cx, cy, 43) < 0.5;
    const kinds: TileKind[] = new Array<TileKind>(CHUNK_TILES * CHUNK_TILES);
    for (let y = 0; y < CHUNK_TILES; y++) {
      const row = sample.rows[flipY ? CHUNK_TILES - 1 - y : y] ?? '';
      for (let x = 0; x < CHUNK_TILES; x++) {
        kinds[y * CHUNK_TILES + x] = LEGEND[row.charAt(flipX ? CHUNK_TILES - 1 - x : x)] ?? 'ground';
      }
    }
    // Lay the road: a centre square, and an arm out to every edge that carries one. Water under a road is a bridge.
    const any = sockets.n || sockets.e || sockets.s || sockets.w;
    const lay = (x: number, y: number): void => {
      const i = y * CHUNK_TILES + x;
      kinds[i] = kinds[i] === 'water' ? 'bridge' : 'road';
    };
    if (any) {
      for (let y = ROAD_A; y <= ROAD_B; y++) for (let x = ROAD_A; x <= ROAD_B; x++) lay(x, y);
      for (let k = 0; k < ROAD_A; k++) {
        if (sockets.n) { lay(ROAD_A, k); lay(ROAD_B, k); }
        if (sockets.w) { lay(k, ROAD_A); lay(k, ROAD_B); }
      }
      for (let k = ROAD_B + 1; k < CHUNK_TILES; k++) {
        if (sockets.s) { lay(ROAD_A, k); lay(ROAD_B, k); }
        if (sockets.e) { lay(k, ROAD_A); lay(k, ROAD_B); }
      }
    }
    return { cx, cy, sample: sample.id, biome, sockets, kinds };
  }

  function chunkAt(cx: number, cy: number): Chunk {
    const key = cx + ',' + cy;
    const hit = cache.get(key);
    if (hit) { cache.delete(key); cache.set(key, hit); return hit; }
    const chunk = buildChunk(cx, cy);
    cache.set(key, chunk);
    if (cache.size > MAX_CACHED_CHUNKS) { const oldest = cache.keys().next().value; if (oldest !== undefined) cache.delete(oldest); }
    return chunk;
  }

  function groundColour(tx: number, ty: number): string {
    const desert = ramp(0.56, 0.72, heat(tx, ty));
    const wet = ramp(0.44, 0.62, moisture(tx, ty)) * (1 - desert);
    const grain = (hash01(seed, tx, ty, 51) - 0.5) * 4;
    const r = 104 * (1 - desert - wet) + 72 * wet + 222 * desert + grain;
    const g = 168 * (1 - desert - wet) + 134 * wet + 198 * desert + grain;
    const b = 82 * (1 - desert - wet) + 62 * wet + 140 * desert + grain;
    return 'rgb(' + Math.round(r) + ',' + Math.round(g) + ',' + Math.round(b) + ')';
  }

  function tileAt(tx: number, ty: number): Tile {
    const ix = Math.floor(tx); const iy = Math.floor(ty);
    const cx = Math.floor(ix / CHUNK_TILES); const cy = Math.floor(iy / CHUNK_TILES);
    const kind = chunkAt(cx, cy).kinds[mod(iy, CHUNK_TILES) * CHUNK_TILES + mod(ix, CHUNK_TILES)] ?? 'ground';
    return { kind, solid: SOLID.has(kind), road: kind === 'road' || kind === 'bridge', ground: kind === 'void' ? '#1d2a3a' : groundColour(ix, iy) };
  }

  const tileAtPixel = (x: number, y: number): Tile => tileAt(Math.floor(x / tileSize), Math.floor(y / tileSize));

  function spawnPoint(): { x: number; y: number } {
    // The highway row nearest the centre of the map, then outward until a road (or open ground) is found.
    const centre = size === null ? 0 : minChunk + Math.floor((size - 1) / 2);
    // A road that runs straight through (east-west or north-south) first, so the player starts on a long road,
    // then any road at all.
    for (const through of [true, false]) {
      for (let r = 0; r <= 8; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const cx = centre + dx; const cy = centre + dy;
            if (!inside(cx, cy)) continue;
            const chunk = chunkAt(cx, cy);
            const ok = through ? (chunk.sockets.e && chunk.sockets.w) || (chunk.sockets.n && chunk.sockets.s)
              : chunk.kinds[ROAD_A * CHUNK_TILES + ROAD_A] === 'road';
            if (ok) return { x: (cx * CHUNK_TILES + ROAD_B) * tileSize, y: (cy * CHUNK_TILES + ROAD_B) * tileSize };
          }
        }
      }
    }
    // No road (a one-chunk map): the first open tile spiralling out from the centre tile.
    const c0 = centre * CHUNK_TILES + CHUNK_TILES / 2;
    for (let r = 0; r < CHUNK_TILES * 4; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (!tileAt(c0 + dx, c0 + dy).solid) return { x: (c0 + dx + 0.5) * tileSize, y: (c0 + dy + 0.5) * tileSize };
      }
    }
    return { x: (c0 + 0.5) * tileSize, y: (c0 + 0.5) * tileSize };
  }

  const span = CHUNK_TILES * tileSize;
  return {
    seed, tileSize, chunkTiles: CHUNK_TILES,
    bounds: size === null ? null : { minX: minChunk * span, minY: minChunk * span, maxX: (maxChunk + 1) * span, maxY: (maxChunk + 1) * span },
    chunkAt, tileAt, tileAtPixel,
    isSolid: (x, y) => tileAtPixel(x, y).solid,
    isRoad: (x, y) => tileAtPixel(x, y).road,
    biomeAt: (x, y) => chunkAt(Math.floor(x / span), Math.floor(y / span)).biome,
    spawnPoint,
    cachedChunks: () => cache.size,
  };
}

/**
 * Move a round body of radius r by (dx, dy), sliding along walls instead of sticking to them. Each axis is
 * tried on its own, and long moves are split into steps no longer than a third of a tile, so nothing passes
 * through a tree or a house however fast it goes.
 */
export function moveWithCollision(world: World2D, x: number, y: number, dx: number, dy: number, r: number): { x: number; y: number; blockedX: boolean; blockedY: boolean } {
  const radius = Math.max(0, Math.min(r, world.tileSize * 0.45));
  const blocked = (px: number, py: number): boolean =>
    world.isSolid(px - radius, py - radius) || world.isSolid(px + radius, py - radius)
    || world.isSolid(px - radius, py + radius) || world.isSolid(px + radius, py + radius);
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / (world.tileSize / 3)));
  let nx = x; let ny = y; let blockedX = false; let blockedY = false;
  for (let i = 0; i < steps; i++) {
    const sx = dx / steps; const sy = dy / steps;
    if (sx !== 0 && !blockedX) { if (blocked(nx + sx, ny)) blockedX = true; else nx += sx; }
    if (sy !== 0 && !blockedY) { if (blocked(nx, ny + sy)) blockedY = true; else ny += sy; }
  }
  return { x: nx, y: ny, blockedX, blockedY };
}
`;

export const WORLD2D_RENDER_SOURCE = String.raw`// DRAWING THE 2D WORLD — only what is on screen, each chunk painted once and kept (NavBharatAI's own work).
//
// A chunk is painted onto its own small canvas the first time it is seen and reused every frame after that, so a
// frame costs one drawImage per visible chunk however detailed the land is. The cache is bounded: chunks far
// behind the player are dropped and repainted only if the player comes back. Where no DOM canvas exists, the
// tiles are drawn straight onto the target context instead.

import type { Chunk, TileKind, World2D } from './world';

export interface WorldRendererOptions {
  /** How many painted chunks to keep. Default 96. */
  maxCachedChunks?: number;
}

export interface WorldRenderer {
  /** Draw the part of the world centred on (centreX, centreY) pixels into a view of viewW x viewH pixels. */
  draw(ctx: CanvasRenderingContext2D, centreX: number, centreY: number, viewW: number, viewH: number): void;
  /** A square minimap at (x, y) of size pixels, centred on the player, showing radiusChunks chunks each way. */
  drawMinimap(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, playerX: number, playerY: number, radiusChunks?: number): void;
  /** The screen position of a world point for the last drawn view (to draw the player, enemies or pickups). */
  toScreen(worldX: number, worldY: number): { x: number; y: number };
  /** Forget every painted chunk (for example after a resize). */
  dispose(): void;
}

const BIOME_COLOUR: Readonly<Record<string, string>> = {
  meadow: '#6aa84f', forest: '#3f7d3a', lake: '#4f9fd6', village: '#c9a46b', desert: '#e0c88c',
};

function paintTile(ctx: CanvasRenderingContext2D, kind: TileKind, ground: string, px: number, py: number, s: number): void {
  ctx.fillStyle = ground;
  ctx.fillRect(px, py, s, s);
  const cx = px + s / 2; const cy = py + s / 2;
  const disc = (x: number, y: number, r: number, colour: string): void => {
    ctx.fillStyle = colour; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  };
  switch (kind) {
    case 'road': ctx.fillStyle = '#4d4f53'; ctx.fillRect(px, py, s, s); break;
    case 'bridge':
      ctx.fillStyle = '#3d7fb8'; ctx.fillRect(px, py, s, s);
      ctx.fillStyle = '#9c6b3c'; ctx.fillRect(px + s * 0.08, py, s * 0.84, s);
      ctx.fillStyle = '#7a5230';
      for (let k = 1; k < 4; k++) ctx.fillRect(px + s * 0.08, py + (k * s) / 4, s * 0.84, Math.max(1, s * 0.04));
      break;
    case 'water':
      ctx.fillStyle = '#3d7fb8'; ctx.fillRect(px, py, s, s);
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(px + s * 0.2, py + s * 0.35, s * 0.3, Math.max(1, s * 0.06));
      break;
    case 'sand': ctx.fillStyle = '#e8d29a'; ctx.fillRect(px, py, s, s); break;
    case 'dry':
      ctx.fillStyle = 'rgba(190,160,80,0.55)';
      ctx.fillRect(px + s * 0.15, py + s * 0.3, s * 0.7, Math.max(1, s * 0.06));
      ctx.fillRect(px + s * 0.25, py + s * 0.62, s * 0.55, Math.max(1, s * 0.06));
      break;
    case 'flowers':
      disc(px + s * 0.3, py + s * 0.35, s * 0.08, '#f4d03f');
      disc(px + s * 0.65, py + s * 0.55, s * 0.08, '#e74c3c');
      disc(px + s * 0.4, py + s * 0.72, s * 0.08, '#f5f5f5');
      break;
    case 'bush': disc(cx, cy, s * 0.28, '#2f6b2a'); disc(cx - s * 0.08, cy - s * 0.08, s * 0.14, '#3f8a38'); break;
    case 'tree':
      ctx.fillStyle = '#6b4423'; ctx.fillRect(cx - s * 0.06, cy, s * 0.12, s * 0.42);
      disc(cx, cy - s * 0.05, s * 0.4, '#2e6b2e'); disc(cx - s * 0.12, cy - s * 0.15, s * 0.18, '#3c8a3c');
      break;
    case 'pine':
      ctx.fillStyle = '#6b4423'; ctx.fillRect(cx - s * 0.05, cy + s * 0.25, s * 0.1, s * 0.22);
      ctx.fillStyle = '#1f5a34'; ctx.beginPath();
      ctx.moveTo(cx, py + s * 0.04); ctx.lineTo(px + s * 0.88, py + s * 0.78); ctx.lineTo(px + s * 0.12, py + s * 0.78);
      ctx.closePath(); ctx.fill();
      break;
    case 'rock': disc(cx, cy + s * 0.05, s * 0.34, '#8a8d91'); disc(cx - s * 0.1, cy - s * 0.04, s * 0.14, '#a6a9ad'); break;
    case 'cactus':
      ctx.fillStyle = '#3b8f4a';
      ctx.fillRect(cx - s * 0.08, py + s * 0.15, s * 0.16, s * 0.75);
      ctx.fillRect(cx - s * 0.32, cy - s * 0.05, s * 0.24, s * 0.1); ctx.fillRect(cx - s * 0.32, cy - s * 0.25, s * 0.1, s * 0.25);
      ctx.fillRect(cx + s * 0.08, cy + s * 0.05, s * 0.24, s * 0.1); ctx.fillRect(cx + s * 0.22, cy - s * 0.15, s * 0.1, s * 0.25);
      break;
    case 'house':
      ctx.fillStyle = '#d9b38c'; ctx.fillRect(px + s * 0.12, py + s * 0.42, s * 0.76, s * 0.5);
      ctx.fillStyle = '#b5452b'; ctx.beginPath();
      ctx.moveTo(px + s * 0.04, py + s * 0.46); ctx.lineTo(cx, py + s * 0.08); ctx.lineTo(px + s * 0.96, py + s * 0.46);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#5a3a22'; ctx.fillRect(cx - s * 0.08, py + s * 0.64, s * 0.16, s * 0.28);
      break;
    case 'well': disc(cx, cy, s * 0.34, '#8a8d91'); disc(cx, cy, s * 0.2, '#2f5f8a'); break;
    case 'void': ctx.fillStyle = '#1d2a3a'; ctx.fillRect(px, py, s, s); break;
    default: break;
  }
}

/** Paint one chunk at (ox, oy): its tiles, then the dashed centre line along every road arm. */
function paintChunk(ctx: CanvasRenderingContext2D, world: World2D, chunk: Chunk, ox: number, oy: number): void {
  const n = world.chunkTiles; const s = world.tileSize;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const tile = world.tileAt(chunk.cx * n + x, chunk.cy * n + y);
      paintTile(ctx, tile.kind, tile.ground, ox + x * s, oy + y * s, s);
    }
  }
  const { n: north, e, s: south, w } = chunk.sockets;
  if (!(north || e || south || w) || chunk.sample === null) return;
  ctx.fillStyle = '#f2f2f2';
  const mid = 8 * s; const thick = Math.max(1, s * 0.08); const dash = s * 0.5;
  const dashes = (fromX: number, fromY: number, toX: number, toY: number): void => {
    const len = Math.hypot(toX - fromX, toY - fromY); const ux = (toX - fromX) / (len || 1); const uy = (toY - fromY) / (len || 1);
    for (let d = dash / 2; d < len; d += dash * 2) {
      const x0 = fromX + ux * d; const y0 = fromY + uy * d;
      if (ux !== 0) ctx.fillRect(ox + x0, oy + y0 - thick / 2, dash * Math.abs(ux), thick);
      else ctx.fillRect(ox + x0 - thick / 2, oy + y0, thick, dash * Math.abs(uy));
    }
  };
  if (north) dashes(mid, 0, mid, mid);
  if (south) dashes(mid, mid, mid, n * s);
  if (w) dashes(0, mid, mid, mid);
  if (e) dashes(mid, mid, n * s, mid);
}

export function createWorldRenderer(world: World2D, options: WorldRendererOptions = {}): WorldRenderer {
  const maxCached = Math.max(4, Math.floor(options.maxCachedChunks ?? 96));
  const painted = new Map<string, HTMLCanvasElement>();
  const span = world.chunkTiles * world.tileSize;
  const canPaintOffscreen = typeof document !== 'undefined' && typeof document.createElement === 'function';
  let lastLeft = 0; let lastTop = 0;

  function paintedChunk(cx: number, cy: number): HTMLCanvasElement | null {
    if (!canPaintOffscreen) return null;
    const key = cx + ',' + cy;
    const hit = painted.get(key);
    if (hit) { painted.delete(key); painted.set(key, hit); return hit; }
    const canvas = document.createElement('canvas');
    canvas.width = span; canvas.height = span;
    const c = canvas.getContext('2d');
    if (!c) return null;
    paintChunk(c, world, world.chunkAt(cx, cy), 0, 0);
    painted.set(key, canvas);
    if (painted.size > maxCached) { const oldest = painted.keys().next().value; if (oldest !== undefined) painted.delete(oldest); }
    return canvas;
  }

  return {
    draw(ctx, centreX, centreY, viewW, viewH) {
      const left = Math.round(centreX - viewW / 2); const top = Math.round(centreY - viewH / 2);
      lastLeft = left; lastTop = top;
      ctx.fillStyle = '#1d2a3a';
      ctx.fillRect(0, 0, viewW, viewH);
      const c0 = Math.floor(left / span); const c1 = Math.floor((left + viewW) / span);
      const r0 = Math.floor(top / span); const r1 = Math.floor((top + viewH) / span);
      for (let cy = r0; cy <= r1; cy++) {
        for (let cx = c0; cx <= c1; cx++) {
          const ox = cx * span - left; const oy = cy * span - top;
          const image = paintedChunk(cx, cy);
          if (image) ctx.drawImage(image, ox, oy);
          else paintChunk(ctx, world, world.chunkAt(cx, cy), ox, oy);
        }
      }
    },
    drawMinimap(ctx, x, y, size, playerX, playerY, radiusChunks = 6) {
      const r = Math.max(1, Math.floor(radiusChunks));
      const cells = r * 2 + 1; const cell = size / cells;
      const pcx = Math.floor(playerX / span); const pcy = Math.floor(playerY / span);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(x - 2, y - 2, size + 4, size + 4);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const chunk = world.chunkAt(pcx + dx, pcy + dy);
          const mx = x + (dx + r) * cell; const my = y + (dy + r) * cell;
          ctx.fillStyle = chunk.biome ? BIOME_COLOUR[chunk.biome] ?? '#6aa84f' : '#1d2a3a';
          ctx.fillRect(mx, my, Math.ceil(cell), Math.ceil(cell));
          if (chunk.sample === null) continue;
          ctx.fillStyle = '#3a3c40';
          const w = Math.max(1, cell * 0.2); const half = cell / 2;
          if (chunk.sockets.n) ctx.fillRect(mx + half - w / 2, my, w, half);
          if (chunk.sockets.s) ctx.fillRect(mx + half - w / 2, my + half, w, half);
          if (chunk.sockets.w) ctx.fillRect(mx, my + half - w / 2, half, w);
          if (chunk.sockets.e) ctx.fillRect(mx + half, my + half - w / 2, half, w);
        }
      }
      const fx = (playerX - pcx * span) / span; const fy = (playerY - pcy * span) / span;
      ctx.fillStyle = '#ffd400';
      ctx.beginPath(); ctx.arc(x + (r + fx) * cell, y + (r + fy) * cell, Math.max(2, cell * 0.25), 0, Math.PI * 2); ctx.fill();
    },
    toScreen(worldX, worldY) { return { x: worldX - lastLeft, y: worldY - lastTop }; },
    dispose() { painted.clear(); },
  };
}
`;

export const WORLD2D_INDEX_SOURCE = String.raw`// The 2D world: one map joined seamlessly from pre-made sample chunks, endless or bounded (NavBharatAI's own work).
export { createWorld2D, moveWithCollision, hash01, valueNoise } from './world';
export type { World2D, World2DOptions, Tile, TileKind, Chunk, ChunkSockets } from './world';
export { createWorldRenderer } from './render';
export type { WorldRenderer, WorldRendererOptions } from './render';
export { SAMPLES, CHUNK_TILES } from './samples';
export type { Sample, Biome } from './samples';
`;
