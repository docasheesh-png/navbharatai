// 🗺️ THE MAP PLANNER — "naksha banane wala dimaag" (admin 2026-11-27, wave 1 part 1).
//
// The admin asked NavBharatAI to make its own map in a fixed order: a frame of the asked size → a natural boundary nobody can cross →
// water (rivers, ponds, lakes, sea, deeper away from the shore) → a ground nobody falls through → roads → colonies of houses between
// the roads. Before any of those layers is drawn, ONE reader has to decide what the user actually asked for. Until now that decision
// was scattered: `sizeKmIn` and `archetypeIn` in the map kinds, the builder's own `archetype` / `size_km`, and a 100 km default that
// every game got whatever it was (a 100 km loop for a two-street shooter).
//
// This module is that one reader. It turns the user's words (English, Hinglish, Devanagari input) into a MapPlan of nine fields:
//   1. area        — km², with honest units: "5 km" is a SIDE (a 5 x 5 km frame, 25 km²); "5 km²", "5 sq km", "5 varg km" is an AREA.
//   2. archetype   — the kind of land (athreeMapKinds.ts).
//   3. boundary    — the natural edge nobody crosses: sea, mountains, canyon, forest-river, dunes, wall.
//   4. water       — sea / rivers / lakes / ponds / canals, or none.
//   5. roadStyle   — grid (the default smart city + highways), highway, organic (random), hill (curvy), straight.
//   6. density     — sparse (a village), normal, dense (a crowded city).
//   7. region      — a flavour of India: Rajasthan desert, Kerala backwaters, Mumbai coast, the Himalaya ...
//   8. gameType    — on-foot, shooter, RPG, driving, racing, flight, battle royale, explore.
//   9. timeOfDay   — dawn, day, evening, night.
//
// DEFAULT AREA BY GAME TYPE (admin-approved 2026-11-27): on foot / shooter / RPG 5 km²; driving / racing 25 km²; flight 100 km².
// The user's stated size ALWAYS wins. Two honest exceptions to the defaults, both written into the plan's notes:
//   • battle royale keeps the 8 km island it already had (64 km²) — the admin's list does not name it, and "a royale gets the big
//     map" is behaviour users already rely on;
//   • a game whose play needs a RACE CIRCUIT (racing) or a RUNWAY (flight) is raised to the smallest map on which the world really
//     fits one, read from the emitted world's own CIRCUIT_RUNWAY_MIN_SIZE. Roads themselves exist at every size (#4626), so a game
//     that only drives needs no floor. (Until #4626 this read MIN_ROAD_SIZE, "no roads below 20 km", which raised every unsized race
//     to 400 km²; that name now means where the planned town network takes over, and the planner must never read it.)
//
// What the world does with the plan is NOT claimed here. `appliedMapLayers` reads the emitted world's source and says which of the
// plan's fields it really consumes; everything else is "recorded, not yet built" in the build notes (the honesty rule).
//
// PURE: no I/O, no clock, no env. Never throws.

import { ARCHETYPES, archetypeIn, clampSizeKm, sizeKmIn, type Archetype, type MapChoice } from './athreeMapKinds';
import { mapProfileFor } from './athreeMapIntent';
import { buildGameContract } from '../../AgentV3/gameIntent';
import { namesGtaTitle } from '../wellKnownGameTitles';
import { largeWorldIntent } from '../../AgentV3/largeWorldIntent';

export type BoundaryKind = 'sea' | 'mountains' | 'canyon' | 'forest-river' | 'dunes' | 'wall';
export type RoadStyle = 'grid' | 'highway' | 'organic' | 'hill' | 'straight';
export type Density = 'sparse' | 'normal' | 'dense';
export type MapGameType = 'on-foot' | 'shooter' | 'rpg' | 'driving' | 'racing' | 'flight' | 'boating' | 'battle-royale' | 'explore' | 'unknown';
export type TimeOfDay = 'dawn' | 'day' | 'evening' | 'night';
export type RegionFlavour =
  | 'rajasthan-desert' | 'kerala-backwaters' | 'mumbai-coast' | 'goa-beach' | 'himalaya' | 'ladakh' | 'sundarbans' | 'punjab-fields' | 'deccan-plateau' | 'northeast-hills';

/** The water the user asked for. Counts are what was named ("do nadiyan" = 2); a kind named without a number is 1. */
export interface WaterPlan { sea: boolean; rivers: number; lakes: number; ponds: number; canals: number }

/** Where a field's value came from — so the notes can say "you asked" or "the default for a racing game". */
export type PlanSource = 'user' | 'builder' | 'region' | 'game-default' | 'archetype-default' | 'default';

export interface MapPlan {
  /** The frame's area in km² (side² — the frame is square: a loop's period or a bounded island's frame). */
  areaKm2: number;
  /** The frame's side in km (sqrt of the area, 1..1000, rounded to 0.01 km). */
  sideKm: number;
  areaSource: PlanSource;
  archetype: Archetype;
  archetypeSource: PlanSource;
  boundary: BoundaryKind;
  boundarySource: PlanSource;
  water: WaterPlan;
  /** The user said "no water" / "bina paani": every water wish is off. */
  waterRefused: boolean;
  roadStyle: RoadStyle;
  roadStyleSource: PlanSource;
  density: Density;
  region: RegionFlavour | null;
  gameType: MapGameType;
  timeOfDay: TimeOfDay | null;
  /** The hour for the sky (0..24) when a time of day was asked for. */
  hours: number | null;
  /**
   * The choice the world is built with (archetype + side). null only when the request names no size, no land and no game type —
   * then the default world (a 100 km loop) is used, exactly as before the planner.
   */
  choice: MapChoice | null;
  /** Plain lines for the build notes: every default taken and every number raised, said out loud. */
  notes: string[];
}

/** The world options the plan passes through to createAthreeWorld (the names the wave-1 agents share). */
export interface MapPlanWorldOptions {
  areaKm2: number;
  boundary: BoundaryKind;
  water: WaterPlan;
  roadStyle: RoadStyle;
  density: Density;
}

export interface MapPlanInput {
  prompt: string;
  /** What the builder model passed to the tool (archetype, size_km). A field it gives wins over the words for that field only. */
  builder?: { archetype?: Archetype | null; sizeKm?: number | null } | null;
  /**
   * The smallest side, in metres, on which the world fits a race circuit and a runway, per mode (the emitted world's
   * CIRCUIT_RUNWAY_MIN_SIZE). When given, a racing or flight game gets at least this; when not, no floor is applied and the plan says so.
   */
  circuitRunwayFloorMeters?: { loop: number; bounded: number } | null;
}

/**
 * DEFAULT AREA BY GAME TYPE, km² (admin-approved 2026-11-27). Battle royale keeps its existing 8 km island; a boat game is sized like
 * driving (a vehicle that covers ground) but needs no roads.
 */
export const DEFAULT_AREA_KM2: Record<Exclude<MapGameType, 'unknown'>, number> = {
  'on-foot': 5, shooter: 5, rpg: 5, explore: 5, driving: 25, racing: 25, boating: 25, flight: 100, 'battle-royale': 64,
};
/** Games whose play needs a race circuit or a runway (roads to drive on exist on every map, so driving needs no floor). */
const NEEDS_CIRCUIT_OR_RUNWAY: ReadonlySet<MapGameType> = new Set<MapGameType>(['racing', 'flight']);

/** The natural edge each kind of land has when the user names none. */
export const DEFAULT_BOUNDARY: Record<Archetype, BoundaryKind> = {
  island: 'sea', archipelago: 'sea', coast: 'sea', continental: 'sea', wetland: 'forest-river', jungle: 'forest-river', savanna: 'forest-river',
  plains: 'forest-river', desert: 'dunes', alpine: 'mountains', hills: 'mountains', tundra: 'mountains',
};

const norm = (s: string): string => String(s ?? '').normalize('NFKC').toLowerCase();
const tokensOf = (s: string): string[] => norm(s).split(/[^\p{L}\p{N}\p{M}]+/u).filter(Boolean);
const round2 = (n: number): number => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------------------------------------------------------------
// 1. AREA — a side or an area, said honestly.

const NUM = '(\\d+(?:[.,]\\d+)?)';
const AREA_UNIT = '(?:km\\s*(?:²|\\^\\s*2|2\\b|sq\\b|square\\b)|sq\\.?\\s*(?:km|kms|kilomet(?:er|re)s?)\\b|square\\s*(?:km|kms|kilomet(?:er|re)s?)\\b|varg\\s*(?:km|kms|kilomet(?:er|re)s?)\\b|वर्ग\\s*(?:किमी|किलोमीटर|कि\\.?\\s*मी))';
const AREA_RE = new RegExp(NUM + '\\s*' + AREA_UNIT, 'iu');
const KM_WORD = '(?:km|kms|kilomet(?:er|re)s?|किमी|किलोमीटर)';
/** "5 x 5 km", "5 by 5 km", "5 into 5 km", "5 गुणा 5 किमी": a rectangle; the frame is square, so its area is kept and its side is sqrt. */
const RECT_RE = new RegExp(NUM + '\\s*' + KM_WORD + '?\\s*(?:x|×|\\*|by|into|guna|गुणा)\\s*' + NUM + '\\s*' + KM_WORD, 'iu');

/** The area the words ask for, in km², and how it was said; null when they name no size. */
export function areaKm2In(text: string): { areaKm2: number; said: 'area' | 'side' | 'rectangle' | 'word' } | null {
  const t = String(text ?? '');
  const num = (s: string): number => Number(s.replace(',', '.'));
  const a = AREA_RE.exec(t);
  if (a && num(a[1]) > 0) return { areaKm2: num(a[1]), said: 'area' };
  const r = RECT_RE.exec(t);
  if (r && num(r[1]) > 0 && num(r[2]) > 0) return { areaKm2: num(r[1]) * num(r[2]), said: 'rectangle' };
  const side = sizeKmIn(t);
  if (side === null) return null;
  const numbered = new RegExp(NUM + '\\s*' + KM_WORD, 'iu').test(t);
  return { areaKm2: side * side, said: numbered ? 'side' : 'word' };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 7. REGION — a flavour of India sets the land, the edge and the water when the user names them by place.

interface RegionInfo { words: RegExp; archetype: Archetype; boundary?: BoundaryKind; water?: Partial<WaterPlan>; density?: Density; what: string }
export const REGIONS: Record<RegionFlavour, RegionInfo> = {
  'rajasthan-desert': { words: /\b(?:rajasthan\w*|thar|jaisalmer|bikaner|marwar\w*|barmer)\b|राजस्थान|थार|जैसलमेर/u, archetype: 'desert', boundary: 'dunes', what: 'Rajasthan desert: dunes, hardpan, few rivers' },
  'kerala-backwaters': { words: /\b(?:kerala|keral|backwaters?|alleppey|alappuzha|kumarakom)\b|केरल/u, archetype: 'wetland', boundary: 'sea', water: { canals: 1, lakes: 1, sea: true }, what: 'Kerala backwaters: canals, lagoons and a sea coast' },
  'mumbai-coast': { words: /\b(?:mumbai|bombay|marine\s+drive|juhu)\b|मुंबई|मुम्बई/u, archetype: 'coast', boundary: 'sea', water: { sea: true }, density: 'dense', what: 'Mumbai coast: a dense city on the sea' },
  'goa-beach': { words: /\bgoa\b|गोवा/u, archetype: 'coast', boundary: 'sea', water: { sea: true }, what: 'Goa: beaches and a sea coast' },
  ladakh: { words: /\b(?:ladakh|leh|spiti)\b|लद्दाख/u, archetype: 'tundra', boundary: 'mountains', what: 'Ladakh: a cold high desert ringed by mountains' },
  himalaya: { words: /\b(?:himalaya\w*|himachal|uttarakhand|manali|shimla|kashmir|sikkim|darjeeling|kedarnath)\b|हिमालय|हिमाचल|उत्तराखंड|कश्मीर/u, archetype: 'alpine', boundary: 'mountains', water: { rivers: 1 }, what: 'Himalaya: high snowy mountains and rivers' },
  sundarbans: { words: /\bsundarbans?\b|सुंदरबन/u, archetype: 'wetland', boundary: 'forest-river', water: { rivers: 1 }, what: 'Sundarbans: mangrove delta, rivers everywhere' },
  'punjab-fields': { words: /\b(?:punjab|haryana)\b|पंजाब|हरियाणा/u, archetype: 'plains', boundary: 'forest-river', water: { canals: 1 }, density: 'sparse', what: 'Punjab fields: flat farmland and canals' },
  'deccan-plateau': { words: /\b(?:deccan|dakkhan|maharashtra|karnataka|hampi)\b|दक्कन|महाराष्ट्र/u, archetype: 'hills', boundary: 'mountains', what: 'Deccan plateau: rolling hills and rocky ridges' },
  'northeast-hills': { words: /\b(?:northeast|north[\s-]east|meghalaya|assam|nagaland|mizoram|arunachal)\b|मेघालय|असम/u, archetype: 'jungle', boundary: 'mountains', water: { rivers: 1 }, what: 'the North-East: green forested hills and rivers' },
};

export function regionIn(text: string): RegionFlavour | null {
  const t = norm(text);
  for (const id of Object.keys(REGIONS) as RegionFlavour[]) if (REGIONS[id].words.test(t)) return id;
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 3. BOUNDARY — only an explicit "surrounded by / se ghira / edge" names one; otherwise the land's own edge.

const SURROUND = /\b(?:surrounded|encircled|ringed|enclosed|bounded|boxed\s+in|boundary|border|edge|ghira|ghiri|ghire|ghera|chaaron\s+(?:or|taraf)|charon\s+(?:or|taraf))\b|घिरा|घिरी|घिरे|घेरा|चारों\s+(?:ओर|तरफ)|सीमा/u;
const BOUNDARY_WORDS: Array<[BoundaryKind, RegExp]> = [
  ['wall', /\b(?:walls?|deewar\w*|diwar\w*|qila|fort|fence|parkota)\b|दीवार|किला/u],
  ['canyon', /\b(?:canyons?|gorges?|khaai|khai|cliffs?)\b|खाई/u],
  ['dunes', /\b(?:dunes?|ret\s+ke\s+teele|teele|registan|sand)\b|टीले|रेगिस्तान/u],
  ['mountains', /\b(?:mountains?|pahaa?d\w*|pahar\w*|parvat\w*|hills?|peaks?)\b|पहाड़|पहाड|पर्वत/u],
  ['forest-river', /\b(?:forest|jungle|jangal|van|river|nadi\w*)\b|जंगल|नदी/u],
  ['sea', /\b(?:sea|ocean|samundar|samudra|sagar|water|paani|pani)\b|समुद्र|समंदर|पानी/u],
];

/** The boundary the words name explicitly ("pahaadon se ghira", "surrounded by sea", "a walled city"), or null. */
export function boundaryIn(text: string): BoundaryKind | null {
  const t = norm(text);
  if (/\b(?:walled|qila\s+band)\b/u.test(t)) return 'wall';
  const m = SURROUND.exec(t);
  if (!m) return null;
  // The kind is the one named NEAREST the surround word, in the same sentence ("registan shooter, pahaadon se ghira" is ringed by
  // mountains, not by dunes): the land word and the edge word are often in one sentence.
  const from = Math.max(0, m.index - 60);
  const near = t.slice(from, m.index + m[0].length + 60);
  const centre = m.index - from;
  let best: { kind: BoundaryKind; d: number } | null = null;
  for (const [kind, re] of BOUNDARY_WORDS) {
    for (const hit of near.matchAll(new RegExp(re.source, 'gu'))) {
      const i = hit.index ?? 0;
      const between = i < centre ? near.slice(i, centre) : near.slice(centre, i);
      if (/[.!?;\n]/u.test(between)) continue;
      const d = i < centre ? centre - (i + hit[0].length) : i - centre;
      if (!best || d < best.d) best = { kind, d };
    }
  }
  if (best) return best.kind;
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 4. WATER

const COUNT_WORDS: Record<string, number> = { one: 1, ek: 1, two: 2, do: 2, three: 3, teen: 3, four: 4, char: 4, chaar: 4, five: 5, paanch: 5, panch: 5, many: 4, kai: 4, bahut: 4, lots: 4, several: 3 };
const WATER_KINDS: Array<[keyof Omit<WaterPlan, 'sea'>, RegExp]> = [
  ['ponds', /\b(?:ponds?|talaa?bs?|taalaa?bs?|talav|pokhar\w*|kund|pokhri)\b|तालाब|पोखर|कुंड/u],
  ['lakes', /\b(?:lakes?|jheel\w*|jhil|sarovar|lagoons?)\b|झील|सरोवर/u],
  ['canals', /\b(?:canals?|nahar\w*|nehar\w*|backwaters?)\b|नहर/u],
  ['rivers', /\b(?:rivers?|nadi|nadiy\w*|nadiyaan|streams?|darya)\b|नदी|नदियां|नदियाँ/u],
];
const SEA_WORDS = /\b(?:sea|ocean|samundar|samudra|sagar|beach|coast\w*|shore|seaside|harbou?r|port|bandar\w*)\b|समुद्र|समंदर|तट/u;
const NO_WATER = /\b(?:no|without|bina|bagair)\s+(?:any\s+)?(?:water|paani|pani)\b|\b(?:water|paani|pani)\s+(?:nahi|nahin|mat|na)\b|\bdry\s+(?:map|world|land)\b|बिना\s+पानी|पानी\s+नहीं/u;
const NEG_BEFORE = /\b(?:no|not|without|bina|bagair|koi)\s+(?:\w+\s+){0,1}$/u;
const NEG_AFTER = /^\s*(?:\w+\s+){0,1}(?:nahi|nahin|mat|na|not\s+needed)\b|^\s*(?:नहीं|मत)/u;

function countBefore(text: string, at: number): number {
  const before = text.slice(Math.max(0, at - 16), at).trim().split(/\s+/u).pop() ?? '';
  const n = Number(before);
  if (Number.isInteger(n) && n > 0 && n < 50) return n;
  return COUNT_WORDS[before] ?? 1;
}

export function waterIn(text: string, archetype: Archetype, region: RegionFlavour | null): { water: WaterPlan; refused: boolean; asked: boolean } {
  const t = norm(text);
  const water: WaterPlan = { sea: false, rivers: 0, lakes: 0, ponds: 0, canals: 0 };
  if (NO_WATER.test(t)) return { water, refused: true, asked: true };
  let asked = false;
  for (const [kind, re] of WATER_KINDS) {
    const g = new RegExp(re.source, 'gu');
    for (const m of t.matchAll(g)) {
      const at = m.index ?? 0;
      const negated = NEG_BEFORE.test(t.slice(Math.max(0, at - 24), at)) || NEG_AFTER.test(t.slice(at + m[0].length, at + m[0].length + 20));
      if (negated) { water[kind] = 0; asked = true; break; }
      water[kind] = Math.max(water[kind], countBefore(t, at));
      asked = true;
    }
  }
  if (SEA_WORDS.test(t)) { water.sea = true; asked = true; }
  const r = region ? REGIONS[region].water : undefined;
  if (r) for (const k of Object.keys(r) as Array<keyof WaterPlan>) {
    if (k === 'sea') water.sea = water.sea || Boolean(r.sea);
    else if (water[k] === 0 && !new RegExp(WATER_KINDS.find(([n]) => n === k)![1].source, 'u').test(t)) water[k] = Number(r[k]) || 0;
  }
  if (['island', 'archipelago', 'coast'].includes(archetype)) water.sea = true;
  return { water, refused: false, asked };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 5. ROADS, 6. DENSITY, 9. TIME OF DAY

const ROAD_STYLE_WORDS: Array<[RoadStyle, RegExp]> = [
  ['hill', /\b(?:curvy|curved|winding|twisty|hairpin\w*|serpentine|zig[\s-]?zag|ghumaa?vdaa?r|ghumavdar|ghat\s+(?:road|section)|mountain\s+roads?|ghoomti)\b|घुमावदार/u],
  ['organic', /\b(?:random|organic|irregular|old\s+city|purana\s+shahar|purani\s+basti|tedhi[\s-]?medhi|galiyan|gali)\b|टेढ़ी|गलियां|गलियाँ/u],
  ['straight', /\b(?:straight|seedhi|sidhi|seedha|sidha)\s+(?:roads?|sadak\w*|streets?)\b|\b(?:roads?|sadak\w*)\s+(?:seedhi|sidhi|straight)\b|सीधी\s+सड़क/u],
  ['highway', /\b(?:highways?|expressways?|motorways?|freeways?|national\s+highway|nh\s?\d+)\b|हाईवे|राजमार्ग/u],
  ['grid', /\b(?:grid|smart\s+city|sectors?|planned\s+city|chandigarh|blocks?)\b|स्मार्ट\s+सिटी/u],
];

export function roadStyleIn(text: string): RoadStyle | null {
  const t = norm(text);
  for (const [style, re] of ROAD_STYLE_WORDS) if (re.test(t)) return style;
  return null;
}

const DENSE = /\b(?:dense|crowded|packed|busy)\s+(?:city|town|basti|area|streets?|colony|colonies)\b|\b(?:bheed\w*|bhid\w*|metro\s+city|megacity|mega\s+city|ghani\s+basti|downtown)\b|भीड़/u;
const SPARSE = /\b(?:village|villages|gaon|gaanv|gaanw|gav|dhani|rural|countryside|sparse|kasba|few\s+houses|kam\s+ghar|hamlet)\b|गांव|गाँव|ग्रामीण/u;
export function densityIn(text: string): Density | null {
  const t = norm(text);
  if (DENSE.test(t)) return 'dense';
  if (SPARSE.test(t)) return 'sparse';
  return null;
}

const TIMES: Array<[TimeOfDay, number, RegExp]> = [
  ['night', 22, /\b(?:night|nighttime|midnight|raat|raatri)\b|रात/u],
  ['evening', 18, /\b(?:evening|sunset|dusk|shaam|sham|golden\s+hour)\b|शाम|सूर्यास्त/u],
  ['dawn', 6, /\b(?:dawn|sunrise|morning|subah|savera|sawera)\b|सुबह|सवेरा|सूर्योदय/u],
  ['day', 12, /\b(?:daytime|noon|midday|dopahar|din\s+ka|din\s+me|din\s+mein)\b|दोपहर|दिन\s+में/u],
];
export function timeOfDayIn(text: string): { time: TimeOfDay; hours: number } | null {
  const t = norm(text);
  for (const [time, hours, re] of TIMES) if (re.test(t)) return { time, hours };
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 8. GAME TYPE

const SHOOTER = /\b(?:shooter|shooting|shoot|gun\w*|fps|tps|sniper|commando|bandook|goli|war\s+game|zombie\w*)\b|शूटिंग|बंदूक/u;
const RPG = /\b(?:rpg|role[\s-]?playing|quest\w*|adventure|kingdom|dungeon\w*|fantasy)\b/u;
const DRIVE = /\b(?:driv(?:e|ing)|car|cars|gaadi|gadi|taxi|bus|truck|bike|scooter|auto[\s-]?rickshaw|tractor)\b|गाड़ी|गाडी/u;
const FOOT = /\b(?:walk\w*|on\s+foot|paidal|run\s+around|explore|exploring|survival|open[\s-]?world|sandbox|parkour|hero|character)\b/u;

export function mapGameTypeIn(text: string): MapGameType {
  const t = norm(text);
  const profile = mapProfileFor(text);
  if (profile === 'flight') return 'flight';
  if (profile === 'battle-royale') return 'battle-royale';
  const c = buildGameContract(text);
  if (profile === 'racing' || c.genre === 'racing') return 'racing';
  if (c.vehicle === 'boat' || /\b(?:boat|boats|naav|ship|kayak|canoe)\b|नाव/u.test(t) && /\b(?:game|khel)\b|गेम|खेल/u.test(t)) return 'boating';
  if (namesGtaTitle(t) || (c.vehicle && c.vehicle !== 'aircraft') || (DRIVE.test(t) && /\b(?:game|khel|sim\w*)\b|गेम|खेल/u.test(t))) return 'driving';
  if (c.genre === 'shooter' || SHOOTER.test(t)) return 'shooter';
  if (c.genre === 'rpg' || RPG.test(t)) return 'rpg';
  if (profile === 'explore') return 'explore';
  if (profile === 'open-world' || FOOT.test(t)) return 'on-foot';
  return 'unknown';
}

// ---------------------------------------------------------------------------------------------------------------------------------
// THE PLAN

export function planMap(input: MapPlanInput): MapPlan {
  const prompt = String(input?.prompt ?? '');
  const notes: string[] = [];
  const gameType = mapGameTypeIn(prompt);
  const region = regionIn(prompt);

  // archetype: builder > user words > region > a battle royale's island > continental
  const builderArch = input?.builder?.archetype && input.builder.archetype in ARCHETYPES ? input.builder.archetype : null;
  const wordArch = archetypeIn(prompt);
  let archetype: Archetype; let archetypeSource: PlanSource;
  if (builderArch) { archetype = builderArch; archetypeSource = 'builder'; }
  else if (wordArch) { archetype = wordArch; archetypeSource = 'user'; }
  else if (region) { archetype = REGIONS[region].archetype; archetypeSource = 'region'; }
  else if (gameType === 'battle-royale') { archetype = 'island'; archetypeSource = 'game-default'; }
  else { archetype = 'continental'; archetypeSource = 'default'; }

  // area: builder > user words > game default (with the road floor) > the legacy default world
  const builderSide = typeof input?.builder?.sizeKm === 'number' && Number.isFinite(input.builder.sizeKm) ? input.builder.sizeKm : null;
  let said = areaKm2In(prompt);
  // "map bahut chhota hai, bada karo" is a COMPLAINT that the map is too small — a wish for a bigger one. The size WORD in it
  // ("bahut chhota") describes the old map, not the new one, so it must never shrink the map to 1 km (largeWorldIntent reads the wish).
  if (said && said.said === 'word' && largeWorldIntent(prompt).wish === 'too-small') {
    notes.push('The request says the map is too small, so a size word in it describes the old map: the new map is a large one (100 km across).');
    said = { areaKm2: 100 * 100, said: 'word' };
  }
  let side: number | null; let areaSource: PlanSource;
  // The size the USER states always wins — over the builder's size_km too (the builder picks a size only when the user named none).
  if (said) {
    side = Math.sqrt(said.areaKm2); areaSource = 'user';
    if (builderSide !== null && Math.abs(clampSizeKm(builderSide) - clampSizeKm(side)) > 0.005) notes.push(`The builder asked for ${round2(builderSide)} km, but the user's own size wins.`);
    if (said.said === 'side') notes.push(`"${round2(side)} km" was read as the side of the map: a ${round2(side)} x ${round2(side)} km frame (${round2(said.areaKm2)} km²). An area is written with sq km (for example ${round2(side)} sq km).`);
    if (said.said === 'area') notes.push(`${round2(said.areaKm2)} km² was read as the AREA: a square frame about ${round2(side)} km on each side.`);
    if (said.said === 'rectangle') notes.push(`The ${round2(said.areaKm2)} km² rectangle is made a square frame of the same area (about ${round2(side)} km on each side); the world's frame is square.`);
  } else if (builderSide !== null) { side = builderSide; areaSource = 'builder';
  } else if (gameType !== 'unknown') {
    const area = DEFAULT_AREA_KM2[gameType];
    side = Math.sqrt(area); areaSource = 'game-default';
    notes.push(gameType === 'battle-royale'
      ? 'No size was named: a battle royale keeps its 8 km island (64 km²).'
      : `No size was named: the default for a ${gameType} game is ${area} km² (admin-approved defaults: on foot / shooter / RPG 5 km², driving / racing 25 km², flight 100 km²).`);
    if (NEEDS_CIRCUIT_OR_RUNWAY.has(gameType)) {
      const mode = ARCHETYPES[archetype].mode;
      const floorM = input?.circuitRunwayFloorMeters?.[mode];
      const what = gameType === 'flight' ? 'a runway' : 'a race circuit';
      if (typeof floorM === 'number' && Number.isFinite(floorM) && floorM > side * 1000) {
        const floorKm = floorM / 1000;
        notes.push(`A ${gameType} game needs ${what}, which this world fits only on a map at least ${floorKm} km across, so the map was raised to ${floorKm} x ${floorKm} km (${round2(floorKm * floorKm)} km²) instead of ${area} km².`);
        side = floorKm;
      } else if (floorM === undefined || floorM === null) {
        notes.push(`The smallest map that holds ${what} could not be read from this world, so the ${area} km² default may have none.`);
      }
    }
  } else { side = null; areaSource = 'default'; }

  let sideKm: number | null = null;
  if (side !== null) {
    sideKm = round2(clampSizeKm(side));
    if (sideKm !== round2(side)) notes.push(`Maps are 1 to 1000 km across, so ${round2(side)} km was held to ${sideKm} km.`);
  }
  const choice: MapChoice | null = sideKm === null && archetypeSource === 'default' ? null : { archetype, sizeKm: sideKm ?? 100 };
  const effSide = choice ? choice.sizeKm : 100;
  // The area is the one asked for (5 km² stays 5, not 2.24² = 5.02); the side is rounded for the world.
  const areaKm2 = round2(choice && side !== null && round2(clampSizeKm(side)) === sideKm ? side * side : effSide * effSide);

  // boundary: user words > region > the land's own edge
  const wordBoundary = boundaryIn(prompt);
  let boundary: BoundaryKind; let boundarySource: PlanSource;
  if (wordBoundary) { boundary = wordBoundary; boundarySource = 'user'; }
  else if (region && REGIONS[region].boundary) { boundary = REGIONS[region].boundary!; boundarySource = 'region'; }
  else { boundary = DEFAULT_BOUNDARY[archetype]; boundarySource = 'archetype-default'; }

  const { water, refused: waterRefused } = waterIn(prompt, archetype, region);
  if (waterRefused && boundary === 'sea') { boundary = archetype === 'desert' ? 'dunes' : 'mountains'; notes.push(`The user asked for no water, so the edge is ${boundary}, not the sea.`); }

  const wordRoad = roadStyleIn(prompt);
  const roadStyle: RoadStyle = wordRoad ?? 'grid';
  const roadStyleSource: PlanSource = wordRoad ? 'user' : 'default';
  const density: Density = densityIn(prompt) ?? (region ? REGIONS[region].density : undefined) ?? 'normal';
  const time = timeOfDayIn(prompt);

  return {
    areaKm2, sideKm: effSide, areaSource, archetype, archetypeSource, boundary, boundarySource, water, waterRefused,
    roadStyle, roadStyleSource, density, region, gameType, timeOfDay: time?.time ?? null, hours: time?.hours ?? null, choice, notes,
  };
}

/** The options the plan hands to createAthreeWorld under the shared names. */
export function mapPlanWorldOptions(plan: MapPlan): MapPlanWorldOptions {
  return { areaKm2: plan.areaKm2, boundary: plan.boundary, water: { ...plan.water }, roadStyle: plan.roadStyle, density: plan.density };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// WHAT WAS REALLY APPLIED — read from the emitted world's own source, never assumed.

export type MapLayer = 'frame' | 'land' | 'boundary' | 'water' | 'roadStyle' | 'density' | 'colonies' | 'timeOfDay';

/**
 * Which of the plan's layers the emitted world really consumes. frame and land always are (sizeMeters, mode and style are in
 * MAP_OPTIONS and the world reads them; with no choice the default world is the frame). The rest count only when the world's source reads that option by name — so the day the
 * boundary, water or road agents land, the notes say "applied" by themselves, and not one day earlier.
 */
export function appliedMapLayers(worldSource: string, plan: MapPlan): Record<MapLayer, boolean> {
  const reads = (name: string): boolean => new RegExp('options\\.' + name + '\\b|\\{[^}]*\\b' + name + '\\b[^}]*\\}\\s*=\\s*options\\b').test(worldSource);
  return {
    frame: true,
    land: true,
    boundary: reads('boundary'),
    // Water counts as applied only when the world reads the part the plan sets per map — the ponds count (the sea is always the
    // world's own; the world makes its own rivers and lakes, so their counts stay recorded, and the note says so).
    water: reads('water') && /\.ponds\b/.test(worldSource),
    roadStyle: reads('roadStyle'),
    density: reads('density'),
    // The colonies (wave 2) count only when the world both reads the density AND lays the plots from it.
    colonies: reads('density') && /\bplanColonies\s*\(/.test(worldSource),
    timeOfDay: false,
  };
}

/** The smallest map on which the emitted world fits a race circuit and a runway (its own CIRCUIT_RUNWAY_MIN_SIZE), or null. */
export function circuitRunwayFloorFromWorldSource(worldSource: string): { loop: number; bounded: number } | null {
  const m = /CIRCUIT_RUNWAY_MIN_SIZE[^=]*=\s*\{\s*loop:\s*(\d+)\s*,\s*bounded:\s*(\d+)\s*\}/.exec(String(worldSource ?? ''));
  return m ? { loop: Number(m[1]), bounded: Number(m[2]) } : null;
}

const BOUNDARY_WHAT: Record<BoundaryKind, string> = { sea: 'the sea', mountains: 'a ring of mountains', canyon: 'a canyon', 'forest-river': 'a forest and river', dunes: 'high dunes', wall: 'a wall' };
const ROAD_WHAT: Record<RoadStyle, string> = { grid: 'a smart-city grid with highways', highway: 'highways', organic: 'random, organic streets', hill: 'curvy hill roads', straight: 'straight roads' };

function waterWhat(w: WaterPlan, refused: boolean): string {
  if (refused) return 'no water (asked for)';
  const parts: string[] = [];
  if (w.sea) parts.push('sea');
  for (const k of ['rivers', 'lakes', 'ponds', 'canals'] as const) if (w[k] > 0) parts.push(`${w[k]} ${w[k] === 1 ? k.slice(0, -1) : k}`);
  return parts.length ? parts.join(', ') : 'whatever the land has';
}

/** The build-note block: the plan in plain words, what was APPLIED to this world and what is recorded but not built yet. */
export function describeMapPlan(plan: MapPlan, applied: Record<MapLayer, boolean>): string {
  const lines: string[] = [];
  lines.push(`MAP PLAN: ${plan.gameType === 'unknown' ? 'a game' : `a ${plan.gameType} game`}; ${plan.choice ? `${plan.archetype} land, ${plan.sideKm} x ${plan.sideKm} km (${plan.areaKm2} km², ${plan.areaSource === 'user' ? 'the size you asked for' : plan.areaSource === 'builder' ? 'the size the builder chose' : 'the default for this game'})` : 'the default world (a 100 km loop)'}${plan.region ? `; ${REGIONS[plan.region].what}` : ''}.`);
  const layer = (name: MapLayer, what: string): string => `  - ${name}: ${what} — ${applied[name] ? 'APPLIED' : 'recorded, not built into this world yet'}`;
  lines.push(layer('frame', plan.choice ? `${plan.sideKm} km across` : 'the default 100 km loop'));
  lines.push(layer('land', plan.archetype));
  lines.push(layer('boundary', BOUNDARY_WHAT[plan.boundary] + (plan.boundarySource === 'user' ? ' (asked for)' : '')));
  lines.push(layer('water', waterWhat(plan.water, plan.waterRefused)) + (applied.water && (plan.water.rivers || plan.water.lakes || plan.water.canals) ? ' (the ponds; the world makes its own rivers and lakes, so their counts and canals are recorded only)' : ''));
  lines.push(layer('roadStyle', ROAD_WHAT[plan.roadStyle] + (plan.roadStyleSource === 'user' ? ' (asked for)' : ' (default)')));
  lines.push(layer('density', plan.density));
  lines.push(layer('colonies', 'plots facing every road between the roads: shops on main roads, homes inside, a park, school, temple, clinic and playground per colony, taller near the town centre (map.world.colonies())'));
  if (plan.timeOfDay) lines.push(`  - timeOfDay: ${plan.timeOfDay} — not set by the map: pass skyOptions { hours: ${plan.hours} } to createAthreeMap (the sky module) to show it.`);
  for (const n of plan.notes) lines.push('  * ' + n);
  const missing = (Object.keys(applied) as MapLayer[]).filter((k) => !applied[k] && k !== 'timeOfDay' && !(k === 'frame' || k === 'land'));
  if (missing.length) lines.push(`Say plainly to the user that ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} planned but not yet built into the world; do not claim ${missing.length === 1 ? 'it' : 'them'}.`);
  return lines.join('\n');
}
