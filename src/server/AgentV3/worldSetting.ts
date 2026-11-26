// THE PLACES A GAME'S WORLD HAS ARE THE PLACES THE USER NAMED (admin 2026-11-26: "user jo bole wahi bane — village bole to
// city nahi").
//
// 🔴 THE DEFECT. A new open-world game decided its places with one yes/no — openWorldWantsCity — and that yes was also given
// when the request only mentioned houses or roads ("ek gaon banao jisme ghar aur sadak ho": the contract's subjects held
// building and road, and "sadak" matched the Hinglish city words). So a village became a city. And when the user DID say
// village, nothing put a village on the map: src/game/world.ts was seeded with a city or with no place at all.
//
// THE RULE NOW. The user's own words decide the places, in their order, with their counts:
//   • a place (city / town / village) or a land (desert / jungle / mountain / snow / beach) is on the map when it is NAMED,
//     in any of the spellings mapGrowthIntent.ts already reads (English, Hinglish, Devanagari);
//   • "4 gaon", "do shehar" put that many; the first place named is where the player starts;
//   • a place the user refuses ("city nahi", "no city", "bina shehar ke", "shehar mat banao") is never on the map;
//   • houses, buildings, roads and lanes belong to the place that was named — they never turn a village into a city;
//   • only when NO place or land is named does the old reading stand: a GTA-style reference, or buildings, roads or the
//     Hinglish for streets, give a city (the open-country default is unchanged otherwise).
// ONE vocabulary: the word lists are mapGrowthIntent's (PLACE_OF, NUM_WORD, NEG), so an edit turn ("ek aur gaon jodo") and the
// first build read the same words. PURE.

import { NEG, NUM_WORD, PLACE_OF, W, norm, type MapPlaceKind } from './mapGrowthIntent';
import { buildGameContract } from './gameIntent';
import { namesGtaTitle } from '../lib/wellKnownGameTitles';

export interface WorldPlace { kind: MapPlaceKind; count: number }
export interface WorldSetting {
  /** The places and lands named, in the order the user named them; the first is where the player starts. */
  places: WorldPlace[];
  /** Places the user refused by name ("city nahi"). */
  refused: MapPlaceKind[];
  /** How it was decided, for the report. */
  basis: 'named' | 'line' | 'implied-city' | 'none';
}

/** The line that carries the decision into a milestone turn, so a rewritten step can never lose it (the CITY_LINE reason). */
export const PLACES_LINE_PREFIX = "The map's places, as the user named them:";
/** Most copies of one place the FIRST build lays down; "100 gaon" grows later, one region per entry (worldGrow.ts). */
export const SEED_COPIES_CAP = 12;

// Two words in mapGrowthIntent's lists are safe in an EDIT ("ek aur van jodo") but not in a new game's request: "van" is also
// the English vehicle and "tat" a common syllable. A first build reads a place only from the unambiguous words.
const AMBIGUOUS_ON_A_FIRST_BUILD = new Set(['van', 'tat']);
const PLACE_WORDS: Array<[MapPlaceKind, string]> = PLACE_OF.map(([kind, words]) => [kind, words.split('|').filter((w) => !AMBIGUOUS_ON_A_FIRST_BUILD.has(w)).join('|')]);
const CITY_STREET_HINGLISH = /\b(?:sheh?a?r|shahar|nagar|sadak\w*|sadke\w*|galiy?\w*|imarat\w*)\b/i;
const NUMBER = new RegExp(`(?<=\\s)(\\d{1,4}|${Object.keys(NUM_WORD).join('|')})\\s+$`, 'u');
/** "no city", "not a city", "without a city", "bina shehar", "shehar ke bina". */
const REFUSE_BEFORE = /(?<=\s)(?:no|not\s+a|not\s+any|without|without\s+a|bina|बिना)\s+$/u;
const NEG_RE = new RegExp(W(NEG), 'u');

function linePlaces(text: string): WorldPlace[] | null {
  const at = text.indexOf(PLACES_LINE_PREFIX);
  if (at < 0) return null;
  const rest = text.slice(at + PLACES_LINE_PREFIX.length).split('\n')[0];
  const out: WorldPlace[] = [];
  for (const part of rest.split(',')) {
    const m = /^\s*(city|town|village|desert|jungle|mountain|snow|beach)(?:\s*x\s*(\d+))?\s*\.?\s*$/.exec(part);
    if (m) out.push({ kind: m[1] as MapPlaceKind, count: Math.max(1, Math.min(SEED_COPIES_CAP, Number(m[2] ?? 1))) });
  }
  return out;
}

/** Was this mention refused — "city nahi", "shehar mat banao", "no city", "bina shehar"? */
function refusedAt(t: string, start: number, end: number): boolean {
  if (REFUSE_BEFORE.test(t.slice(Math.max(0, start - 16), start))) return true;
  // A refusal word right after the place, before any other place or "balki/but/sirf" turns the sentence ("city nahi, gaon").
  const after = t.slice(end, end + 28).split(/(?<=\s)(?:balki|but|sirf|only|bas|बल्कि|सिर्फ)(?=\s)/u)[0];
  const words = after.trim().split(/\s+/).slice(0, 3).join(' ');
  return NEG_RE.test(` ${words} `);
}

/** The places the user's request names. PURE. Never throws. */
export function worldSettingFrom(prompt: string | null | undefined): WorldSetting {
  const raw = String(prompt ?? '');
  const fromLine = linePlaces(raw);
  if (fromLine) return { places: fromLine, refused: [], basis: 'line' };
  const t = norm(raw);
  const hits: Array<{ kind: MapPlaceKind; at: number; count: number; refused: boolean }> = [];
  for (const [kind, words] of PLACE_WORDS) {
    const g = new RegExp(W(words).normalize('NFKC'), 'gu');
    let m: RegExpExecArray | null;
    while ((m = g.exec(t))) {
      const num = NUMBER.exec(t.slice(Math.max(0, m.index - 14), m.index));
      const n = num ? (/^\d+$/.test(num[1]) ? Number(num[1]) : NUM_WORD[num[1]] ?? 1) : 1;
      hits.push({ kind, at: m.index, count: Math.max(1, n), refused: refusedAt(t, m.index, m.index + m[0].length) });
    }
  }
  hits.sort((a, b) => a.at - b.at);
  const refused = [...new Set(hits.filter((h) => h.refused).map((h) => h.kind))];
  const places: WorldPlace[] = [];
  for (const h of hits) {
    if (h.refused || refused.includes(h.kind)) continue;
    const same = places.find((p) => p.kind === h.kind);
    // The same place said twice is one place ("gaon … us gaon me"); a number said once sets how many.
    if (same) { same.count = Math.max(same.count, h.count); continue; }
    places.push({ kind: h.kind, count: h.count });
  }
  for (const p of places) p.count = Math.min(SEED_COPIES_CAP, p.count);
  if (places.length > 0) return { places, refused, basis: 'named' };
  if (!refused.includes('city') && impliesCity(raw)) return { places: [{ kind: 'city', count: 1 }], refused, basis: 'implied-city' };
  return { places: [], refused, basis: 'none' };
}

/** No place named: a GTA-style reference, or buildings / roads / the Hinglish for streets, still give a city. */
function impliesCity(text: string): boolean {
  try {
    const c = buildGameContract(text);
    if ((c.subjects ?? []).some((s) => s === 'building' || s === 'road')) return true;
  } catch { /* the words below still decide */ }
  if (namesGtaTitle(text)) return true;
  return CITY_STREET_HINGLISH.test(text);
}

/** The carrying line for a milestone turn, or null when no place is named. PURE. */
export function placesLine(setting: WorldSetting): string | null {
  if (setting.places.length === 0) return null;
  return `${PLACES_LINE_PREFIX} ${setting.places.map((p) => (p.count > 1 ? `${p.kind} x${p.count}` : p.kind)).join(', ')}.`;
}

/** The regions src/game/world.ts starts with, in order (the first is where the player starts). PURE. */
export function worldRegionsFor(setting: WorldSetting): Array<{ id: string; kind: MapPlaceKind }> {
  const out: Array<{ id: string; kind: MapPlaceKind }> = [];
  for (const p of setting.places) {
    for (let i = 1; i <= p.count; i++) out.push({ id: i === 1 ? `main-${p.kind}` : `${p.kind}-${i}`, kind: p.kind });
  }
  return out;
}

/** The builder's rule, said once with the places this game has. PURE. */
export function worldSettingRule(setting: WorldSetting): string {
  if (setting.places.length === 0 && setting.refused.length === 0) return '';
  const named = setting.places.map((p) => (p.count > 1 ? `${p.count} ${p.kind}s` : `a ${p.kind}`)).join(', ');
  return '🗺️ THE PLACES ARE THE USER\'S OWN WORDS: '
    + (named ? `this world has ${named} (src/game/world.ts already lists them, the first is where the player starts). ` : '')
    + (setting.refused.length ? `The user said NO ${setting.refused.join(' / ')} — never add one. ` : '')
    + 'Never add a place the user did not name (a village game gets no city; houses, roads and shops in a village are the VILLAGE\'s), '
    + 'never swap one for another, and never "upgrade" one (a village is not a town). A place they ask for later is ONE more region.';
}
