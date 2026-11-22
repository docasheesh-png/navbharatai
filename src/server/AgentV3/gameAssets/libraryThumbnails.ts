/**
 * The in-app Game library (2026-11-19): what a user may browse, and the pictures it shows.
 * The list is the reviewed catalogue itself (one row per distinct model), so the screen can never offer a model the
 * builder cannot fetch. Pictures are rendered by scripts/library/renderLibraryThumbnails.mts into a directory the
 * production image already copies; a file is served only when its name is a catalogue hash.
 * White-label: rows carry no provider, pack or author name.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { REVIEWED_GAME_ASSETS, type ReviewedAsset } from './providers';

export const LIBRARY_THUMB_DIR = 'assets/game-models/thumbs';
/** Device pixels; rendered at 2x of a 80 px tile. */
export const LIBRARY_THUMB_SIZE = 160;

export interface LibraryBrowseRow {
  id: string;
  name: string;
  category: string;
  /** The words add_library_models understands for this model; the first is the one the composer uses. */
  subjects: readonly string[];
  animations: readonly string[];
  /** Relative API path of the picture, or null when none has been rendered yet (the screen shows a plain tile). */
  thumb: string | null;
}
export interface LibraryBrowseResult { rows: LibraryBrowseRow[]; total: number; categories: Array<{ category: string; count: number }> }

const titleCase = (s: string) => s.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase());
/** Catalogue ids carry internal batch/pack prefixes ("lib4-cow", "city-car_taxi"); a user sees only the object. */
const ID_PREFIX = /^(?:lib\d+|library|city|medieval|prototype|adventurers)-(?=.)/i;
export const libraryDisplayName = (id: string) => titleCase(id.replace(ID_PREFIX, '')) || titleCase(id);
const normalize = (s: string) => s.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ');
const HASH = /^[a-f0-9]{64}$/;
/**
 * A picture is rendered only for models whose licence asks nothing of a picture: CC0, and MIT (whose notice covers
 * copies of the software, which a rendered image is not). A CC BY picture would need a visible credit on this screen,
 * and users never see a source name (White-Label Law), so those models show a plain tile instead.
 */
export function thumbnailAllowed(c: Pick<ReviewedAsset, 'license'>): boolean {
  return c.license.spdx === 'CC0-1.0' || c.license.spdx === 'MIT';
}

export function libraryThumbPath(sha256: string, cwd = process.cwd()): string | null {
  if (!HASH.test(sha256) || !REVIEWED_GAME_ASSETS.some((c) => c.sha256 === sha256 && thumbnailAllowed(c))) return null;
  const path = join(cwd, LIBRARY_THUMB_DIR, `${sha256}.webp`);
  return existsSync(path) ? path : null;
}

/**
 * 🗺️ MAP PLACES IN THE LIBRARY (admin 2026-11-21: "game library se user chun ke khud map, object add karwa sake"). The
 * library held only models, so a user could pick a cow but never a town. These are the places the open-world map grows by
 * (play/openWorld.ts regions): choosing one sends a request that adds ONE region to the game's map. They are NavBharatAI's
 * own generated places — no file, so no picture: a plain tile, like any model whose picture is not rendered.
 */
export const MAP_PLACE_PREFIX = 'map-place:';
export const LIBRARY_MAP_PLACES: ReadonlyArray<{ kind: 'city' | 'town' | 'village' | 'desert' | 'jungle' | 'mountain' | 'snow' | 'beach'; name: string; subjects: readonly string[] }> = [
  { kind: 'city', name: 'New city (streets, towers, traffic)', subjects: ['city', 'shehar', 'downtown', 'map', 'place'] },
  { kind: 'town', name: 'New town (shops, low buildings)', subjects: ['town', 'kasba', 'market', 'map', 'place'] },
  { kind: 'village', name: 'New village (a few houses, parks)', subjects: ['village', 'gaon', 'gaanv', 'map', 'place'] },
  // Lands (failedbr #2488): the ground itself becomes that land — no buildings.
  { kind: 'desert', name: 'New desert (sand, dunes)', subjects: ['desert', 'registan', 'ret', 'sand', 'map', 'land'] },
  { kind: 'jungle', name: 'New jungle (dense trees)', subjects: ['jungle', 'forest', 'van', 'trees', 'map', 'land'] },
  { kind: 'mountain', name: 'New mountains (peaks, rock)', subjects: ['mountain', 'pahad', 'parvat', 'hills', 'map', 'land'] },
  { kind: 'snow', name: 'New snow land', subjects: ['snow', 'baraf', 'ice', 'map', 'land'] },
  { kind: 'beach', name: 'New beach', subjects: ['beach', 'samundar kinara', 'sea', 'sand', 'map', 'land'] },
];
export function mapPlaceRows(): LibraryBrowseRow[] {
  return LIBRARY_MAP_PLACES.map((p) => ({ id: `${MAP_PLACE_PREFIX}${p.kind}`, name: p.name, category: 'map-places', subjects: p.subjects, animations: [], thumb: null }));
}

export function libraryBrowseRows(catalogue: readonly ReviewedAsset[] = REVIEWED_GAME_ASSETS, hasThumb: (sha: string) => boolean = (sha) => libraryThumbPath(sha) !== null): LibraryBrowseRow[] {
  const seen = new Set<string>();
  const rows: LibraryBrowseRow[] = [];
  for (const c of catalogue) {
    if (seen.has(c.sha256)) continue;
    seen.add(c.sha256);
    rows.push({
      id: c.id,
      name: libraryDisplayName(c.id),
      category: c.libraryCategory ?? 'other',
      subjects: c.subjects,
      animations: Object.keys(c.animationRoles ?? {}),
      thumb: thumbnailAllowed(c) && hasThumb(c.sha256) ? `/api/agentv3/game-library/thumb/${c.sha256}` : null,
    });
  }
  return rows;
}

export function browseLibrary(query: { q?: string; category?: string; limit?: number; offset?: number }, rows: readonly LibraryBrowseRow[] = [...mapPlaceRows(), ...libraryBrowseRows()]): LibraryBrowseResult {
  const q = normalize(String(query.q ?? '')).slice(0, 60);
  const cat = normalize(String(query.category ?? ''));
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
  const words = q ? q.split(' ') : [];
  const hit = rows.filter((r) => (!cat || r.category === cat)
    && words.every((w) => normalize(r.name).includes(w) || r.subjects.some((s) => normalize(s).includes(w)) || r.category.includes(w)));
  const limit = Number.isFinite(query.limit) ? Math.max(1, Math.min(120, Math.floor(query.limit!))) : 60;
  const offset = Number.isFinite(query.offset) ? Math.max(0, Math.floor(query.offset!)) : 0;
  return {
    rows: hit.slice(offset, offset + limit),
    total: hit.length,
    categories: [...counts].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
  };
}

/**
 * 🧍 A LIBRARY MODEL AS THE PLAYER (failedbr #2485, admin 2026-11-21: "yeh jo character banta hai, isko user jab chahe
 * replace karwa de, text se ya game library se chun ke"). The same tile, a second meaning: not "put this in the scene" but
 * "this is who I play as". A map place is not a body, so it has no such instruction.
 */
export function useAsCharacterPrompt(row: Pick<LibraryBrowseRow, 'id' | 'name'>): string | null {
  if (row.id.startsWith(MAP_PLACE_PREFIX)) return null;
  return `Make the ${row.name} from the NavBharatAI library my game's player character (library id: "${row.id}"). Replace only the character I play as; keep the map, the controls and everything else as it is.`;
}

/** The instruction the composer receives: names the exact subject add_library_models resolves, and nothing runs until sent. */
export function addToGamePrompt(row: Pick<LibraryBrowseRow, 'id' | 'name'>): string {
  if (row.id.startsWith(MAP_PLACE_PREFIX)) {
    const kind = row.id.slice(MAP_PLACE_PREFIX.length);
    return `Add one more ${kind} to my game's map as a new place (library map place: "${kind}"). Keep every place already on the map and everything else as it is.`;
  }
  return `Add the ${row.name} model from the NavBharatAI library to my game (library id: "${row.id}"). Place it where it fits the scene and keep everything else as it is.`;
}
