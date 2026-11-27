// 🗺️ THE MAP FROM ABOVE — the shared vocabulary of the top-down map preview and the saved-map library (admin 2026-11-27, wave 2 part 2).
//
// The server runs the game's OWN emitted Athree world, with the seed the game uses, and samples it to a small grid of classes
// (src/server/lib/athreeMap/mapPreviewRun.ts). The grid travels as one string — one character per cell — and the client paints it.
// This module is the one place both sides agree on what a cell means, and the one place a server body is checked before it is
// trusted (`parseMapPreview`, `parseMapPreviewCard`, `parseSavedMapPlan`): anything not shaped like a preview is not a preview.
//
// The colours are the MAP's, not the app's theme: water is blue and grass is green in every theme, like a swatch in the theme
// picker. They are numbers (RGB), painted into a canvas, never a class name.
//
// PURE: no I/O, no DOM.

/** One character per cell, in this order. */
export const MAP_CELL = {
  deepSea: '0',
  sea: '1',
  shallowSea: '2',
  inlandWater: '3',
  pond: '4',
  beach: '5',
  desert: '6',
  grass: '7',
  forest: '8',
  rock: '9',
  snow: 'a',
  road: 'b',
  edge: 'c',
  plot: 'd',
} as const;
export type MapCellName = keyof typeof MAP_CELL;
export type MapCellCode = (typeof MAP_CELL)[MapCellName];
const CELL_CODES = new Set<string>(Object.values(MAP_CELL));

/** RGB per cell. Deeper sea is darker. */
export const MAP_CELL_RGB: Readonly<Record<MapCellCode, readonly [number, number, number]>> = {
  '0': [18, 52, 110],
  '1': [30, 84, 160],
  '2': [70, 140, 210],
  '3': [52, 120, 200],
  '4': [90, 170, 230],
  '5': [226, 210, 160],
  '6': [214, 180, 112],
  '7': [104, 166, 78],
  '8': [44, 110, 52],
  '9': [128, 120, 110],
  a: [236, 240, 244],
  b: [48, 48, 52],
  c: [92, 64, 44],
  d: [210, 52, 48],
};

/** The words for the legend under the picture (only the kinds the map really has are listed). */
export const MAP_CELL_LABEL: Readonly<Record<MapCellCode, string>> = {
  '0': 'Deep sea',
  '1': 'Sea',
  '2': 'Shallow sea',
  '3': 'River or lake',
  '4': 'Pond',
  '5': 'Beach',
  '6': 'Desert',
  '7': 'Grassland',
  '8': 'Forest',
  '9': 'Rock and mountain',
  a: 'Snow',
  b: 'Road',
  c: 'Map edge (nobody crosses)',
  d: 'Building plot',
};

export const MAP_PREVIEW_MAX_SIDE = 160;

export interface MapPreview {
  v: 1;
  /** Cells across and down (the picture is square: width === height). */
  width: number;
  height: number;
  /** width * height characters, row by row from the north-west corner (x grows east, z grows south). */
  cells: string;
  /** The real side of the area shown, in metres. */
  sideMeters: number;
  mode: 'loop' | 'bounded';
  /** The seed the world was built with (the game's own). */
  seed: number;
  /** The map's edge kind ('none' on a loop world). */
  boundary: string;
  /** Where the player starts, as a fraction of the picture (0..1 across, 0..1 down), or null when the world gave none. */
  spawn: { u: number; v: number } | null;
  /** How many of each drawn feature the picture shows (roads in cells, ponds and plots as things). */
  counts: { roadCells: number; ponds: number; plots: number };
}

/** The plan a saved map carries — the MAP_PLAN data a game's config.ts holds, plus the seed and the world profile. */
export interface SavedMapPlan {
  areaKm2: number;
  sideKm: number;
  archetype: string;
  boundary: string;
  water: { sea: boolean; rivers: number; lakes: number; ponds: number; canals: number };
  roadStyle: string;
  density: string;
  region: string | null;
  gameType: string;
  timeOfDay: string | null;
  hours: number | null;
  seed: number;
  profile: string;
}

/** What the chat shows under a build step that made or changed a map. `preview` null means it could not be drawn — `unavailable` says why. */
export interface MapPreviewCard {
  preview: MapPreview | null;
  unavailable?: string;
  /** One plain line: what this picture is. */
  title: string;
  /** The layer a chat edit changed, in plain words (absent on a new map). */
  changed?: string;
  /** The plan behind the picture, so the user can save it to their library. Absent when it could not be read. */
  plan?: SavedMapPlan;
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length <= max;

/** A server body → a preview, or null. Every field is checked; a grid of the wrong length or with an unknown cell is refused. */
export function parseMapPreview(raw: unknown): MapPreview | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 || !num(r.width) || !num(r.height) || !Number.isInteger(r.width) || r.width !== r.height) return null;
  if (r.width < 8 || r.width > MAP_PREVIEW_MAX_SIDE) return null;
  if (typeof r.cells !== 'string' || r.cells.length !== r.width * r.height) return null;
  for (let i = 0; i < r.cells.length; i++) if (!CELL_CODES.has(r.cells[i])) return null;
  if (!num(r.sideMeters) || r.sideMeters <= 0 || (r.mode !== 'loop' && r.mode !== 'bounded') || !num(r.seed) || !str(r.boundary, 40)) return null;
  let spawn: MapPreview['spawn'] = null;
  if (r.spawn !== null && r.spawn !== undefined) {
    const s = r.spawn as Record<string, unknown>;
    if (!num(s.u) || !num(s.v) || s.u < 0 || s.u > 1 || s.v < 0 || s.v > 1) return null;
    spawn = { u: s.u, v: s.v };
  }
  const c = (r.counts ?? {}) as Record<string, unknown>;
  const count = (v: unknown): number => (num(v) && v >= 0 ? Math.floor(v) : 0);
  return {
    v: 1, width: r.width, height: r.height, cells: r.cells, sideMeters: r.sideMeters, mode: r.mode, seed: Math.trunc(r.seed),
    boundary: r.boundary, spawn, counts: { roadCells: count(c.roadCells), ponds: count(c.ponds), plots: count(c.plots) },
  };
}

/** A stored or sent plan → a plan, or null. Shapes only; the server checks every kind against the planner's own lists before use. */
export function parseSavedMapPlan(raw: unknown): SavedMapPlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const w = (r.water ?? null) as Record<string, unknown> | null;
  const count = (v: unknown): number | null => (num(v) && v >= 0 && v <= 100 ? Math.floor(v) : null);
  if (!num(r.areaKm2) || r.areaKm2 <= 0 || r.areaKm2 > 1_000_000 || !num(r.sideKm) || r.sideKm < 1 || r.sideKm > 1000) return null;
  if (!str(r.archetype, 40) || !str(r.boundary, 40) || !str(r.roadStyle, 40) || !str(r.density, 40) || !str(r.gameType, 40) || !str(r.profile, 40)) return null;
  if (!w || typeof w.sea !== 'boolean') return null;
  const rivers = count(w.rivers), lakes = count(w.lakes), ponds = count(w.ponds), canals = count(w.canals);
  if (rivers === null || lakes === null || ponds === null || canals === null) return null;
  if (!(r.region === null || str(r.region, 40)) || !(r.timeOfDay === null || str(r.timeOfDay, 20)) || !(r.hours === null || num(r.hours))) return null;
  if (!num(r.seed) || !Number.isInteger(r.seed)) return null;
  return {
    areaKm2: r.areaKm2, sideKm: r.sideKm, archetype: r.archetype, boundary: r.boundary, water: { sea: w.sea, rivers, lakes, ponds, canals },
    roadStyle: r.roadStyle, density: r.density, region: (r.region as string | null), gameType: r.gameType, timeOfDay: (r.timeOfDay as string | null),
    hours: (r.hours as number | null), seed: r.seed, profile: r.profile,
  };
}

/** A card from the build stream → a card, or null. A card with neither a picture nor a reason is not a card. */
export function parseMapPreviewCard(raw: unknown): MapPreviewCard | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!str(r.title, 300) || !r.title) return null;
  const preview = r.preview === null || r.preview === undefined ? null : parseMapPreview(r.preview);
  if (r.preview && !preview) return null;
  const unavailable = str(r.unavailable, 400) && r.unavailable ? r.unavailable : undefined;
  if (!preview && !unavailable) return null;
  const plan = r.plan === undefined ? undefined : parseSavedMapPlan(r.plan) ?? undefined;
  const changed = str(r.changed, 400) && r.changed ? r.changed : undefined;
  return { preview, title: r.title, ...(unavailable ? { unavailable } : {}), ...(changed ? { changed } : {}), ...(plan ? { plan } : {}) };
}

/** The kinds a preview really shows, in legend order, with how many cells each covers. */
export function mapLegend(preview: MapPreview): Array<{ code: MapCellCode; label: string; cells: number }> {
  const counts = new Map<string, number>();
  for (const ch of preview.cells) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  return (Object.values(MAP_CELL) as MapCellCode[]).filter((c) => (counts.get(c) ?? 0) > 0).map((code) => ({ code, label: MAP_CELL_LABEL[code], cells: counts.get(code) ?? 0 }));
}

/** RGBA pixels for a canvas (one pixel per cell). The spawn is drawn over the picture by the card, not into the cells. PURE. */
export function mapPreviewPixels(preview: MapPreview): Uint8ClampedArray {
  const { width, height, cells } = preview;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < cells.length; i++) {
    const rgb = MAP_CELL_RGB[cells[i] as MapCellCode] ?? MAP_CELL_RGB.c;
    out[i * 4] = rgb[0]; out[i * 4 + 1] = rgb[1]; out[i * 4 + 2] = rgb[2]; out[i * 4 + 3] = 255;
  }
  return out;
}

/** "5 km x 5 km" / "800 m x 800 m": the side shown, said plainly. */
export function mapSideLabel(sideMeters: number): string {
  const side = sideMeters >= 1000 ? `${Math.round(sideMeters / 100) / 10} km` : `${Math.round(sideMeters)} m`;
  return `${side} x ${side}`;
}
