// "CITY SIZE BADH KYU NAHI RAHA??" — THE MAP WISHES THE PLATFORM CARRIES OUT ITSELF (admin 2026-11-22, failedbr #2494 / #2495).
//
// Two requests about the open-world map have exactly one right edit, and both were left to the builder's reading of a long rule:
//   1. ONE CITY BIGGER ("shehar bada karo", "city ka size badhao", "city ko copy clone kar ke jodo"). The kit grows a city with
//      tiles that JOIN it (play/openWorld.ts `joinTo`: edge to edge on the city's own grid, its streets carried straight on).
//      In #2495 the builder added SEPARATE cities instead — copies far away — so no city grew, and the reply said it had.
//   2. A SIZE THE USER NAMES ("map ko 40km*40km banao"). In #2495 it was ignored entirely, and the reply said "All conditions
//      met". The kit lays the places across a square of WORLD.spreadMeters.
// 🧬 THE CLASS: a mechanical, unambiguous change trusted to a weak model's reading of a rule. Like the library's place-add
// (worldGrow.ts), the platform makes it at the start of the turn — from the file as it is NOW, every existing entry kept byte
// for byte — and the builder is told it is done. Where the request is NOT unambiguous (several cities and none named; a city
// grown AND separate cities asked for), nothing is changed on a guess: the builder is told to ask (GAME_NO_GUESS_RULE).
// PURE apart from the small ports the route passes in; never throws.
import { upgradeWorldAtTurnStart } from './worldUpgrade';
import { parseRegions } from './growthGuard';
import { appendRegionEntries, MAX_PLACES } from './worldGrow';
import { worldCapabilities, GAME_OPEN_WORLD_FILE } from './gameKitSeed';

export const WORLD_PATH = 'src/game/world.ts';
type Issue = { phase: 'build'; severity: 'info' | 'warning'; code: string; autoResolved: boolean; message: string };

// ── 1. one city bigger ───────────────────────────────────────────────────────────────────────────────────────────────────
const CITY_WORD = String.raw`(?:city|cities|citys|citiyon|shehar|sheher|shahar|shahr|shehron|nagar)`;
const GROW_WORD = String.raw`(?:bada|badi|bade|badaa|badhao|badhaa\w*|badha\w*|badh\w*|bigger|larger|huge|giant|expand\w*|grow\w*|enlarg\w*|extend\w*|vistar\w*)`;
/**
 * "shehar bada karo", "city ka size badhao", "city ko aur bada karo", "city 4 guna badi karo". Only filler words may stand
 * between the city and the growing word: "city me traffic badhao" is about the traffic (one entry's numbers), not the size.
 */
const FILLER = String.raw`(?:ka|ki|ke|ko|size|area|aur|bhi|thoda|thodi|bahut|bohot|bahot|zyada|jyada|much|more|even|ab|abhi|isko|is|very|\d+|guna|gunaa|times|x|two|teen|char|chaar|paanch)`;
const CITY_THEN_GROW = new RegExp(String.raw`\b${CITY_WORD}\b(?:\s+${FILLER}){0,4}\s+${GROW_WORD}`, 'iu');
/** "expand the city", "grow my city", "make the city bigger" — never "make a city" (a new one). */
const GROW_THEN_CITY = /\b(?:expand|grow|enlarge|extend|increase(?:\s+the\s+size\s+of)?)\s+(?:the\s+|my\s+|this\s+|our\s+)?(?:\w+\s+)?city\b|\bmake\s+(?:the|my|this|our)\s+(?:\w+\s+)?city\s+(?:much\s+|a\s+lot\s+|even\s+)?(?:bigger|larger|huge|giant)\b/i;
/** "city ko copy / clone / duplicate kar ke jodo / merge karo", "citys ko jod jod ke copy clone karo" — both words, either order. */
const CITY_THEN = new RegExp(String.raw`\b${CITY_WORD}\b([\s\S]{0,80})`, 'giu');
const CLONE_WORD = /\b(?:copy|clone|duplicate|duplicat\w*)\b/i;
const JOIN_WORD = /\b(?:jod\w*|jor\w*|merge\w*|join\w*|attach\w*|mila\w*)/i;
const cityCloneJoin = (r: string): boolean => [...r.matchAll(CITY_THEN)].some((m) => CLONE_WORD.test(m[1]) && JOIN_WORD.test(m[1]));
/** A SEPARATE city asked for: a new / another / second city, or a number of cities ("4 city ho", "do shehar"). */
const SEPARATE_CITY = new RegExp(String.raw`\b(?:ek\s+aur|aur\s+ek|nay[aie]|new|another|alag|dusr[aie]|doosr[aie]|second|extra)\s+(?:[\p{L}]+\s+)?${CITY_WORD}\b|\b(?:\d+|teen|char|chaar|paanch|two|three|four|five|six|many|kai)\s+${CITY_WORD}\b|\b${CITY_WORD}\s+(?:aur|and)\s+(?:\w+\s+)?(?:village|gaon|gaanv|town)\s+(?:aur\s+)?(?:jod|add)\w*`, 'iu');

/** Does the request ask to make a city BIGGER (and not for separate cities)? PURE. */
export function cityGrowthAsked(request: string): 'grow' | 'mixed' | null {
  const r = String(request ?? '');
  const grow = CITY_THEN_GROW.test(r) || GROW_THEN_CITY.test(r) || cityCloneJoin(r);
  if (!grow) return null;
  // "bada shehar banao" asks for a big NEW city, not this one bigger — only when the request also asks for one.
  return SEPARATE_CITY.test(r) ? 'mixed' : 'grow';
}

const TELLING = (id: string): string[] => String(id).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/)
  .filter((t) => t.length >= 3 && !['city', 'main', 'new', 'the', 'town', 'tile'].includes(t));

export interface CityRoot { id: string; name: string | null; tiles: number }
/** The cities on the map that stand on their own (not a tile of another), with how many tiles each already has. PURE. */
export function citiesOnMap(worldSource: string): CityRoot[] {
  const regions = parseRegions(worldSource) ?? [];
  const joinOf = (text: string): string | null => /\bjoinTo\s*:\s*['"]([^'"]+)['"]/.exec(text)?.[1] ?? null;
  const roots = regions.filter((r) => /\bkind\s*:\s*['"]city['"]/.test(r.text) && !joinOf(r.text));
  const rootOf = (id: string, seen = new Set<string>()): string => {
    const r = regions.find((x) => x.id === id); const j = r ? joinOf(r.text) : null;
    return j && !seen.has(j) ? (seen.add(j), rootOf(j, seen)) : id;
  };
  return roots.map((c) => ({ id: c.id, name: /\bname\s*:\s*['"]([^'"]+)['"]/.exec(c.text)?.[1] ?? null,
    tiles: 1 + regions.filter((r) => joinOf(r.text) && rootOf(r.id) === c.id && r.id !== c.id).length }));
}

/** Which city the request means: the only one, or the one it names. null = it cannot be told. PURE. */
export function cityMeant(request: string, cities: readonly CityRoot[]): CityRoot | null {
  if (cities.length === 1) return cities[0];
  const words = String(request ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const named = cities.filter((c) => [...TELLING(c.id), ...(c.name ? c.name.toLowerCase().split(/\s+/).filter((t) => t.length >= 3) : [])]
    .some((t) => words.includes(t)));
  return named.length === 1 ? named[0] : null;
}

const NUMBER_WORDS: Record<string, number> = { do: 2, two: 2, teen: 3, three: 3, char: 4, chaar: 4, four: 4, paanch: 5, panch: 5, five: 5, das: 10, ten: 10 };
/** How many tiles to add: "N guna / Nx / N times" → N − 1, "bahut bada" → 8, else 3 (four tiles: a 2 × 2 block). PURE. */
export function tilesWanted(request: string): number {
  const r = String(request ?? '').toLowerCase();
  const times = /\b(\d+|do|two|teen|three|char|chaar|four|paanch|panch|five|das|ten)\s*(?:guna|gunaa|times|x|×)\b/.exec(r);
  if (times) { const n = Number(times[1]) || NUMBER_WORDS[times[1]] || 2; return Math.max(1, Math.min(24, n - 1)); }
  const count = /\b(\d+)\s*(?:tiles?|blocks?|hisse|tukde)\b/.exec(r);
  if (count) return Math.max(1, Math.min(24, Number(count[1])));
  if (/\b(?:bahut|bohot|bahot|bhot|bht|very|much|giant|huge|vishal|kaafi|kafi|massive)\b/.test(r)) return 8;
  return 3;
}

const COMPASS: Array<[RegExp, string]> = [
  [/\b(?:north[\s-]?east|uttar[\s-]?purab|ishan)\b/i, 'north-east'], [/\b(?:north[\s-]?west|uttar[\s-]?paschim)\b/i, 'north-west'],
  [/\b(?:south[\s-]?east|dakshin[\s-]?purab)\b/i, 'south-east'], [/\b(?:south[\s-]?west|dakshin[\s-]?paschim)\b/i, 'south-west'],
  [/\b(?:north|uttar)\b/i, 'north'], [/\b(?:south|dakshin)\b/i, 'south'], [/\b(?:east|purab|poorab|poorv|purv)\b/i, 'east'], [/\b(?:west|paschim|pashchim)\b/i, 'west'],
];
/** The direction the request names, if any. PURE. */
export function towardIn(request: string): string | null {
  for (const [re, dir] of COMPASS) if (re.test(String(request ?? ''))) return dir;
  return null;
}

export type CityGrowth =
  | { ok: true; source: string; city: string; added: string[]; tiles: number }
  | { ok: false; reason: 'no-city' | 'which-city' | 'mixed' | 'full' | 'no-joinTo' | 'no-list'; cities: string[] };

/** The map file with the city the request means grown by joined tiles — or why that was not done. PURE. */
export function growCity(worldSource: string, request: string, openWorldSource: string | null | undefined): CityGrowth {
  const cities = citiesOnMap(worldSource);
  const names = cities.map((c) => c.name ? `${c.id} ("${c.name}")` : c.id);
  const cap = worldCapabilities(openWorldSource);
  if (!cap.joinTo) return { ok: false, reason: 'no-joinTo', cities: names };
  if (cityGrowthAsked(request) === 'mixed') return { ok: false, reason: 'mixed', cities: names };
  if (cities.length === 0) return { ok: false, reason: 'no-city', cities: names };
  const city = cityMeant(request, cities);
  if (!city) return { ok: false, reason: 'which-city', cities: names };
  const regions = parseRegions(worldSource);
  if (!regions) return { ok: false, reason: 'no-list', cities: names };
  // The most THIS game's own map file reads (an older copy reads fewer than the current kit's MAX_PLACES).
  const room = Math.min(MAX_PLACES, cap.maxRegions) - regions.length;
  const n = Math.min(tilesWanted(request), room);
  if (n <= 0) return { ok: false, reason: 'full', cities: names };
  const taken = new Set(regions.map((r) => r.id));
  const toward = towardIn(request);
  const added: string[] = [];
  for (let k = 2; added.length < n; k++) { const id = `${city.id}-${k}`; if (!taken.has(id)) { added.push(id); taken.add(id); } }
  const source = appendRegionEntries(worldSource, added.map((id) => `{ id: '${id}', kind: 'city', joinTo: '${city.id}'${toward ? `, toward: '${toward}'` : ''} }`));
  return source === null ? { ok: false, reason: 'no-list', cities: names } : { ok: true, source, city: city.id, added, tiles: city.tiles + added.length };
}

// ── 2. a size the user names ─────────────────────────────────────────────────────────────────────────────────────────────
const MAP_WORD = /\b(?:map|maps|world|duniya|duniyan|naksha|zameen|jameen|zamin|area|universe|island)\b/i;
const KM = String.raw`(\d+(?:[.,]\d+)?)\s*(?:km|kms|kilomet(?:er|re)s?|kilo\s*meters?)(?![\p{L}\p{N}])(?!\s*(?:\/|per)\s*h)`;
/** "40km*40km", "40 x 40 km", "40 km × 40 km", "50 km ka map". The larger side of a rectangle. null = no size named. PURE. */
export function mapSizeAskedKm(request: string): number | null {
  const r = String(request ?? '');
  if (!MAP_WORD.test(r) || /\b(?:km\/h|kmph|kmh|speed|raftaar|raftar|track|race|lap)\b/i.test(r)) return null;
  const square = new RegExp(String.raw`(\d+(?:[.,]\d+)?)\s*(?:km|kms)?\s*[*x×]\s*` + KM, 'iu').exec(r);
  if (square) return Math.max(Number(square[1].replace(',', '.')), Number(square[2].replace(',', '.')));
  const one = new RegExp(KM, 'iu').exec(r);
  return one ? Number(one[1].replace(',', '.')) : null;
}

export type SpreadResult = { ok: true; source: string; km: number; changed: boolean } | { ok: false; km: number; reason: 'too-big' | 'too-small' | 'no-spread' | 'no-world' };
/** The map file with WORLD.spreadMeters set to the size asked — or why it was not. PURE. */
export function setMapSpread(worldSource: string, km: number, openWorldSource: string | null | undefined): SpreadResult {
  if (km > 1000) return { ok: false, km, reason: 'too-big' };
  if (km < 1) return { ok: false, km, reason: 'too-small' };
  if (!worldCapabilities(openWorldSource).spread) return { ok: false, km, reason: 'no-spread' };
  const metres = Math.round(km * 1000);
  const text = String(worldSource ?? '');
  const open = /(export\s+const\s+WORLD\b[^=]*=\s*\{)/.exec(text);
  if (!open) return { ok: false, km, reason: 'no-world' };
  const existing = /(\bspreadMeters\s*:\s*)([^,\n}]+)/.exec(text);
  if (existing) {
    const source = text.slice(0, existing.index) + existing[1] + metres + text.slice(existing.index + existing[0].length);
    return { ok: true, source, km, changed: source !== text };
  }
  const at = open.index + open[0].length;
  return { ok: true, source: `${text.slice(0, at)}\n  spreadMeters: ${metres},${text.slice(at)}`, km, changed: true };
}

// ── the turn ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** What the builder is told, from what the platform did. PURE. */
export function worldWishHandoff(growth: CityGrowth | null, spread: SpreadResult | null): string {
  const lines: string[] = [];
  if (growth?.ok) {
    lines.push(`✅ ALREADY DONE BY THE PLATFORM: the city "${growth.city}" was made bigger — ${growth.added.length} tile(s) joined to it in WORLD.regions`
      + ` (src/game/world.ts: ${growth.added.join(', ')}, each { kind: 'city', joinTo: '${growth.city}' }), so it is now ONE city of ${growth.tiles} blocks of`
      + ' streets and buildings, edge to edge, the streets carried straight on. Do NOT add more tiles, do NOT add separate cities for this, and'
      + ' do not touch those entries. Tell the user, in their language, that the city is now that much bigger and they can ask for it bigger still.');
  } else if (growth && !growth.ok) {
    const why: Record<typeof growth.reason, string> = {
      'which-city': `the map has ${growth.cities.length} cities (${growth.cities.join(', ')}) and the request does not say which one`,
      mixed: 'the request asks both to make a city bigger and for separate cities, so it is not clear which it wants',
      'no-city': 'the map has no city yet (only towns, villages or lands)',
      full: 'the map already holds as many places as this game\'s map file reads, the most it holds',
      'no-joinTo': `this game's map file (${GAME_OPEN_WORLD_FILE}) is an older or edited copy that cannot join tiles to a city`,
      'no-list': 'src/game/world.ts is not in the shape the platform can read',
    };
    lines.push(`🛑 The platform did NOT make a city bigger: ${why[growth.reason]}. Do not grow a city on a guess and never fake it with separate`
      + ' copies or a feature. ' + (growth.reason === 'which-city' || growth.reason === 'mixed'
      ? 'Do everything else that is clear, then ask ONE short question in the user\'s language that names the choices (for example: "Kaun sa shehar bada karun — '
        + `${growth.cities.slice(0, 3).join(' ya ')}?" or "Ek hi shehar bada karun, ya alag naye shehar jodun?").`
      : 'Tell the user plainly, in their language, why it was not done.'));
  }
  if (spread?.ok) {
    lines.push(`✅ ALREADY DONE BY THE PLATFORM: WORLD.spreadMeters = ${Math.round(spread.km * 1000)} in src/game/world.ts — the places on the map are laid across`
      + ` ${spread.km} km × ${spread.km} km, with open country between them and highways joining them (the world itself is never smaller than that).`
      + ' Do NOT change spreadMeters or sizeMeters. Tell the user the map now spans that size; if it has only a few places, say the space between'
      + ' them is open country and offer to add more places.');
  } else if (spread && !spread.ok) {
    const why = { 'too-big': `${spread.km} km is more than the most a map can be (1000 km)`, 'too-small': `${spread.km} km is less than the smallest map (1 km)`,
      'no-spread': `this game's map file (${GAME_OPEN_WORLD_FILE}) is an older or edited copy that cannot lay the places across a set size`,
      'no-world': 'src/game/world.ts is not in the shape the platform can read' }[spread.reason];
    lines.push(`🛑 The platform did NOT set the map's size: ${why}. Do not stretch sizeMeters instead, and never say the map is that size. Tell the user plainly, in`
      + ' their language, what was not done and why.');
  }
  return lines.join('\n\n');
}

/** Prepend a platform handoff to the builder's prompt (nothing when there is none). PURE. */
export function withPlatformHandoff(handoff: string, prompt: string): string {
  return handoff ? `${handoff}\n\n---\n\n${prompt}` : prompt;
}

/**
 * The map wishes above, carried out at the start of a turn on a game that has src/game/world.ts. Reads the file as it is NOW,
 * writes it once, and returns what the builder is told ('' when the request is neither). Never throws.
 */
export async function worldWishAtTurnStart(io: {
  /** An import or a module turn: the map is not this turn's to change. */
  skip?: boolean;
  prompt: string;
  filesAtTurnStart: Readonly<Record<string, string>> | null;
  read: (path: string) => Promise<string>;
  write: (path: string, content: string) => Promise<void>;
  record: (issue: Issue) => void;
}): Promise<string> {
  try {
    // 🧬 An old hand-edited world upgraded, only on the user's explicit words (worldUpgrade.ts, map expansion item 11).
    if (!io.skip) { const up = await upgradeWorldAtTurnStart(io); if (up) return up; }
    if (io.skip || !io.filesAtTurnStart || typeof io.filesAtTurnStart[WORLD_PATH] !== 'string') return '';
    const wantsGrowth = cityGrowthAsked(io.prompt) !== null;
    const km = mapSizeAskedKm(io.prompt);
    if (!wantsGrowth && km === null) return '';
    const live = await io.read(WORLD_PATH).then((c) => (typeof c === 'string' ? c : null), () => null);
    if (live === null) return '';
    const kit = await io.read(GAME_OPEN_WORLD_FILE).then((c) => (typeof c === 'string' ? c : null), () => io.filesAtTurnStart?.[GAME_OPEN_WORLD_FILE] ?? null);
    let source = live;
    const growth = wantsGrowth ? growCity(source, io.prompt, kit) : null;
    if (growth?.ok) source = growth.source;
    const spread = km !== null ? setMapSpread(source, km, kit) : null;
    if (spread?.ok) source = spread.source;
    if (source !== live) await io.write(WORLD_PATH, source);
    if (growth) io.record({ phase: 'build', severity: 'info', code: growth.ok ? 'CITY_GROWN' : 'CITY_GROW_NOT_DONE', autoResolved: true,
      message: growth.ok ? `The platform made the city "${growth.city}" bigger with ${growth.added.length} joined tile(s) (${growth.tiles} blocks now) — no model call made this change.`
        : `The request asked for a bigger city; the platform changed nothing (${growth.reason}) and the builder was told to ${growth.reason === 'which-city' || growth.reason === 'mixed' ? 'ask' : 'say why'}.` });
    if (spread) io.record({ phase: 'build', severity: 'info', code: spread.ok ? 'MAP_SIZE_SET' : 'MAP_SIZE_NOT_SET', autoResolved: true,
      message: spread.ok ? `The platform laid the map's places across ${spread.km} km × ${spread.km} km (WORLD.spreadMeters) as the request asked.` : `The request named a ${spread.km} km map; not set (${spread.reason}) and the builder was told to say so.` });
    return worldWishHandoff(growth, spread);
  } catch { return ''; }   // the builder still has the request and the rule
}

// ── what a summary may say about the map ─────────────────────────────────────────────────────────────────────────────────
/** The measured facts a summary's map claims are checked against (claimAudit `world`). */
export interface WorldClaimFacts {
  regionsBefore: number;
  regionsAfter: number;
  /** Places / lands / tiles whose id is new this turn. */
  added: number;
  sizeKmBefore: number | null;
  sizeKmAfter: number | null;
  spreadKmBefore: number | null;
  spreadKmAfter: number | null;
  /** The size the user's request named for the map, if any. */
  askedKm: number | null;
}
const kmOf = (source: string, key: string): number | null => {
  const m = new RegExp(String.raw`\b${key}\s*:\s*([\d_.]+(?:e\d+)?)`).exec(source);
  const n = m ? Number(m[1].replace(/_/g, '')) : NaN;
  return Number.isFinite(n) && n > 0 ? n / 1000 : null;
};
/** The map as it was when the turn began and as it is at its end. null when the game has no map file. PURE. */
export function worldClaimFacts(before: string | null | undefined, after: string | null | undefined, request: string): WorldClaimFacts | null {
  if (typeof before !== 'string' && typeof after !== 'string') return null;
  const b = typeof before === 'string' ? before : '';
  const a = typeof after === 'string' ? after : b;
  const ib = new Set((parseRegions(b) ?? []).map((r) => r.id));
  const ia = (parseRegions(a) ?? []).map((r) => r.id);
  return { regionsBefore: ib.size, regionsAfter: ia.length, added: ia.filter((id) => !ib.has(id)).length,
    sizeKmBefore: kmOf(b, 'sizeMeters'), sizeKmAfter: kmOf(a, 'sizeMeters'),
    spreadKmBefore: kmOf(b, 'spreadMeters'), spreadKmAfter: kmOf(a, 'spreadMeters'), askedKm: mapSizeAskedKm(request) };
}
