// A PLACE PICKED FROM THE LIBRARY IS ADDED BY THE PLATFORM ITSELF (admin 2026-11-21: "game library se user chun ke khud map,
// object add karwa sake" and "isko rocksolid karo — jo kaam adhura hai pura karo").
//
// Choosing New city / New town / New village in the Game Library sent a sentence to the builder, and the builder was trusted
// to add one entry to src/game/world.ts. That is the smallest, most mechanical edit in the product: it needs no model. The
// platform now makes it at the start of the turn — one new entry, a fresh id, nothing else touched — and the builder is told
// it is done. PURE: the route does the reading and the writing.
import { parseRegions } from './growthGuard';

export type PlaceKind = 'city' | 'town' | 'village' | 'desert' | 'jungle' | 'mountain' | 'snow' | 'beach';
const KINDS: readonly PlaceKind[] = ['city', 'town', 'village', 'desert', 'jungle', 'mountain', 'snow', 'beach'];
/** The most places and lands a map holds (play/openWorld.ts MAX_REGIONS — admin 2026-11-22: "10—100 maps … universe"; 1,000 since 2026-11-23). */
export const MAX_PLACES = 1000;
/** What an older copy of play/openWorld.ts holds (a game whose kit file was edited keeps it): it reads no entry past this. */
export const OLD_MAX_PLACES = 100;
/**
 * How many places THIS game's map reads: the MAX_REGIONS written in its own play/openWorld.ts (never above MAX_PLACES). A file
 * that cannot be read, or says no number, is taken as the older 100 — so an entry is never added where the map would ignore it. PURE.
 */
export function placesTheMapHolds(bridge: string | null | undefined): number {
  const m = /export const MAX_REGIONS = (\d+);/.exec(String(bridge ?? ''));
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(MAX_PLACES, n) : OLD_MAX_PLACES;
}

/** The request the library's "Add to game" sends for a map place (libraryThumbnails.addToGamePrompt). Exactly that shape. PURE. */
export function mapPlaceAsked(prompt: string | null | undefined): PlaceKind | null {
  const m = /\(library map place: "(city|town|village|desert|jungle|mountain|snow|beach)"\)/.exec(String(prompt ?? ''));
  return m && (KINDS as readonly string[]).includes(m[1]) ? (m[1] as PlaceKind) : null;
}

export type AppendResult =
  | { ok: true; source: string; id: string; count: number }
  | { ok: false; reason: 'no-list' | 'full' };

/** `source` with ONE more place of this kind at the end of WORLD.regions. Every existing entry is kept byte for byte. PURE. */
export function appendPlace(source: string, kind: PlaceKind, cap: number = MAX_PLACES): AppendResult {
  const text = String(source ?? '');
  const regions = parseRegions(text);
  if (!regions) return { ok: false, reason: 'no-list' };
  if (regions.length >= Math.min(MAX_PLACES, cap)) return { ok: false, reason: 'full' };
  const taken = new Set(regions.map((r) => r.id));
  let n = regions.filter((r) => new RegExp(`\\bkind\\s*:\\s*['"]${kind}['"]`).test(r.text)).length + 1;
  let id = `${kind}-${n}`;
  while (taken.has(id)) id = `${kind}-${++n}`;
  const out = appendRegionEntries(text, [`{ id: '${id}', kind: '${kind}' }`]);
  return out === null ? { ok: false, reason: 'no-list' } : { ok: true, source: out, id, count: regions.length + 1 };
}

/**
 * `source` with these entries (each the exact text of one `{ … }`) added at the end of WORLD.regions, one per line. Every
 * existing entry is kept byte for byte. null when there is no regions list the platform can read. PURE.
 */
export function appendRegionEntries(source: string, entries: readonly string[]): string | null {
  const text = String(source ?? '');
  const regions = parseRegions(text);
  const open = /\bregions\s*:\s*\[/.exec(text);
  if (!regions || !open) return null;
  // The closing bracket of the regions list: the first `]` at depth 0 after it opens.
  let depth = 0, close = -1;
  for (let i = open.index + open[0].length; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}') depth--;
    else if (ch === ']') { if (depth === 0) { close = i; break; } depth--; }
  }
  if (close < 0) return null;
  if (entries.length === 0) return text;
  const before = text.slice(0, close).replace(/[ \t]+$/, '');
  const needsComma = regions.length > 0 && !/,\s*$/.test(before);
  const lead = /\n\s*$/.test(before) ? '' : '\n';
  const lines = entries.map((e) => `    ${e},\n`).join('');
  return `${before}${needsComma ? ',' : ''}${lead}${lines}  ${text.slice(close)}`;
}

/** What the builder is told when the platform has already made the change. */
export function placeAddedHandoff(kind: PlaceKind, id: string, count: number): string {
  return `✅ ALREADY DONE BY THE PLATFORM: one new ${kind} ("${id}") was added to WORLD.regions in src/game/world.ts — the map now has ${count} place(s). `
    + 'Do NOT edit src/game/world.ts again and do not add another place. Change nothing else. Reply in one or two sentences, in the user\'s language, '
    + `that a new ${kind} is on the map, away from the others with open country between, and that they can ask for more.`;
}
/** When the map is full: said plainly, nothing invented. */
export function placeNotAddedHandoff(kind: PlaceKind, cap: number = MAX_PLACES): string {
  return `The map already has ${cap} places, the most it holds, so the platform did NOT add another ${kind}. Do not add one by hand. Tell the user plainly, `
    + 'in their language, that the map is full, and offer to make one of the existing places bigger or to remove one they name.';
}
