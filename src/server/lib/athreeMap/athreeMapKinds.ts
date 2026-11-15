// ATHREE MAP KINDS — "100+ types of maps, 1 km to 1000 km" (admin 2026-11-15), as a SPACE of maps and not a list somebody wrote by hand.
//
// A map is two choices: an ARCHETYPE (what kind of land: desert, jungle, archipelago, alpine ...) and a SIZE (1, 2, 5, 10, 25, 50, 100, 250,
// 500, 1000 km). The archetype is a handful of numbers the world already understands (relief, how much is sea, how dry, how warm, how many
// rivers); the size is how far the world is stretched (see createAthreeWorld). 12 archetypes x 10 sizes = 120 kinds, and every one is
// seeded, so each kind is also an endless run of different maps. `mapChoiceFor` reads a user's words (English, Hinglish) and picks both.
//
// Honest limits: a 1 to 5 km map has no roads (a road region is 12.5 km, a runway 900 m) and a plane has nowhere to take off; a map of
// 250 km and up is mostly empty land to cross, which is what it is.

/** The knobs of a map's character (the same five the emitted world takes: tests/census hold the two lists equal). */
export interface MapStyle { relief: number; seaShift: number; aridity: number; warmth: number; rivers: number }

export type Archetype =
  | 'continental' | 'plains' | 'hills' | 'alpine' | 'desert' | 'tundra' | 'jungle' | 'savanna' | 'archipelago' | 'island' | 'wetland' | 'coast';

export interface ArchetypeInfo {
  id: Archetype;
  what: string;
  mode: 'loop' | 'bounded';
  style: Partial<MapStyle>;
  /** Words a user types for it (lower case; English and Hinglish). */
  words: string[];
}

export const ARCHETYPES: Record<Archetype, ArchetypeInfo> = {
  continental: { id: 'continental', what: 'a bit of everything: coast, plains, forest, mountains, desert', mode: 'loop', style: {}, words: ['continent', 'continental', 'mixed', 'normal', 'varied', 'realistic'] },
  plains: { id: 'plains', what: 'wide flat farmland and grass, gentle rises', mode: 'loop', style: { relief: 0.25, seaShift: 0.15 }, words: ['plains', 'plain', 'flat', 'maidan', 'maidani', 'farmland', 'khet'] },
  hills: { id: 'hills', what: 'rolling hills, valleys, no great peaks', mode: 'loop', style: { relief: 0.55 }, words: ['hills', 'hill', 'hilly', 'tekri', 'tekdi', 'pahadiyan', 'rolling', 'valley', 'ghati'] },
  alpine: { id: 'alpine', what: 'high mountains with snow caps, deep valleys, many rivers', mode: 'loop', style: { relief: 1.3, warmth: -0.1, rivers: 1.5 }, words: ['alpine', 'mountain', 'mountains', 'mountainous', 'pahad', 'pahadi', 'himalaya', 'himalayan', 'peaks', 'hill station'] },
  desert: { id: 'desert', what: 'dunes and hardpan, few rivers, hot', mode: 'loop', style: { aridity: 0.45, warmth: 0.25, relief: 0.7, rivers: 0.3 }, words: ['desert', 'registan', 'registani', 'sahara', 'thar', 'dunes', 'sand', 'ret'] },
  tundra: { id: 'tundra', what: 'cold, snowy, sparse, frozen', mode: 'loop', style: { warmth: -0.45, aridity: 0.1, relief: 0.8 }, words: ['tundra', 'snow', 'snowy', 'ice', 'icy', 'arctic', 'barf', 'barfili', 'frozen', 'winter', 'cold'] },
  jungle: { id: 'jungle', what: 'dense wet forest, many rivers, low rolling land', mode: 'loop', style: { aridity: -0.35, warmth: 0.2, relief: 0.6, rivers: 2 }, words: ['jungle', 'rainforest', 'forest', 'amazon', 'van', 'jangal', 'tropical', 'dense'] },
  savanna: { id: 'savanna', what: 'warm open grassland with scattered rivers', mode: 'loop', style: { aridity: 0.2, warmth: 0.3, relief: 0.35, rivers: 0.6 }, words: ['savanna', 'savannah', 'grassland', 'ghaas', 'safari', 'steppe', 'prairie'] },
  archipelago: { id: 'archipelago', what: 'many islands in open sea', mode: 'loop', style: { seaShift: -0.45, relief: 0.7 }, words: ['archipelago', 'islands', 'dweep', 'dweepsamooh', 'tapu', 'tapuon', 'andaman', 'maldives'] },
  island: { id: 'island', what: 'one island with a shore all round it', mode: 'bounded', style: {}, words: ['island', 'isle', 'tapu', 'bounded', 'arena'] },
  wetland: { id: 'wetland', what: 'marsh and lakes on low wet ground, with rivers everywhere', mode: 'loop', style: { aridity: -0.4, relief: 0.2, seaShift: 0.1, rivers: 3 }, words: ['wetland', 'wetlands', 'marsh', 'swamp', 'daldal', 'delta', 'sundarban', 'backwater'] },
  coast: { id: 'coast', what: 'a long coastline with beaches, bays and hills behind', mode: 'loop', style: { seaShift: -0.15, relief: 0.8 }, words: ['coast', 'coastal', 'tat', 'samundar', 'beach', 'seaside', 'shore'] },
};

export const ARCHETYPE_IDS = Object.keys(ARCHETYPES) as Archetype[];
export const SIZE_CLASSES_KM = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000] as const;
/** How many distinct kinds of map exist (each is also seeded, so each is an endless run of different maps). */
export const MAP_KIND_COUNT = ARCHETYPE_IDS.length * SIZE_CLASSES_KM.length;

export interface MapChoice { archetype: Archetype; sizeKm: number }

/** What createAthreeWorld takes for a choice. A size is a free number from 1 to 1000 km; the size classes are the tested ones. */
export interface MapWorldOptions {
  mode: 'loop' | 'bounded';
  sizeMeters: number;
  style: Partial<MapStyle>;
}

export function clampSizeKm(km: number): number {
  return Math.max(1, Math.min(1000, Number.isFinite(km) ? km : 100));
}

export function mapOptionsFor(choice: MapChoice): MapWorldOptions {
  const a = ARCHETYPES[choice.archetype] ?? ARCHETYPES.continental;
  return { mode: a.mode, sizeMeters: Math.round(clampSizeKm(choice.sizeKm) * 1000), style: { ...a.style } };
}

const SIZE_WORDS: Array<[string[], number]> = [
  [['tiny', 'bahut chhota', 'mini'], 1], [['small', 'chhota', 'chota', 'chhoti', 'compact'], 5], [['medium', 'madhyam', 'normal size'], 25],
  [['large', 'big', 'bada', 'badi', 'vishal'], 100], [['huge', 'vast', 'giant', 'massive', 'bahut bada', 'continent sized', 'continent-sized'], 500],
];

const tokens = (s: string): string[] => s.toLowerCase().split(/[^\p{L}\p{N}.-]+/u).filter(Boolean);

/** The size in km a user's words ask for ("5 km", "1000 km ka map", "chhota map"), or null when they name none. */
export function sizeKmIn(text: string): number | null {
  const m = /(\d+(?:[.,]\d+)?)\s*(?:km|kms|kilometers?|kilometres?|kilo\s*meters?|किमी|किलोमीटर)(?![\p{L}\p{N}\p{M}])/iu.exec(text);
  if (m) return clampSizeKm(Number(m[1].replace(',', '.')));
  const t = text.toLowerCase();
  // A phrase ("bahut bada") before a single word ("bada"): the longer wish is the stronger one.
  for (const phrase of [true, false]) {
    for (const [words, km] of SIZE_WORDS.slice().reverse()) if (words.some((w) => w.includes(' ') === phrase && (phrase ? t.includes(w) : tokens(t).includes(w)))) return km;
  }
  return null;
}

/** The archetype a user's words ask for, or null. The most specific word wins (the order of ARCHETYPE_IDS breaks ties; island beats archipelago on "island"). */
export function archetypeIn(text: string): Archetype | null {
  const t = tokens(text);
  const hit = (a: Archetype): boolean => ARCHETYPES[a].words.some((w) => (w.includes(' ') ? text.toLowerCase().includes(w) : t.includes(w)));
  for (const a of ['archipelago', 'desert', 'jungle', 'alpine', 'tundra', 'wetland', 'savanna', 'coast', 'plains', 'hills', 'island', 'continental'] as Archetype[]) if (hit(a)) return a;
  return null;
}

/** Read a request: a choice when it names a size or a kind of land, null when it names neither (then the default world is used). */
export function mapChoiceFor(text: string): MapChoice | null {
  const sizeKm = sizeKmIn(text);
  const archetype = archetypeIn(text);
  if (sizeKm === null && archetype === null) return null;
  return { archetype: archetype ?? 'continental', sizeKm: sizeKm ?? 100 };
}

export function describeMap(choice: MapChoice): string {
  const a = ARCHETYPES[choice.archetype];
  const km = clampSizeKm(choice.sizeKm);
  const notes: string[] = [];
  if (km < 20 && a.mode === 'loop') notes.push('too small for a road network, so there are no roads and no runway');
  if (a.mode === 'bounded' && km < 6) notes.push('too small for roads');
  if (km >= 250) notes.push('mostly open land to cross; roads are made region by region as you travel');
  return `${a.id} map, ${km} km${a.mode === 'bounded' ? ' across' : ' (a seamless loop)'}: ${a.what}` + (notes.length ? ` (${notes.join('; ')})` : '');
}
