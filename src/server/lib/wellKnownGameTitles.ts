// WELL-KNOWN GAME TITLES — ONE reader shared by every surface that asks "did the user name a game?".
//
// 🔴 failedbr #2478 (2026-11-20, "make a bgmi for me"): the domain classifier (RequirementGapAnalyzer) answered
// "general" — not a game — because its game headline needed the word "game", while the royale reader in gameIntent
// knew "bgmi" all along. "make pubg for me", "build free fire", "gta 5 banao", "make minecraft for me" and "make a
// ludo for me" were all "general" too, so DOMAIN_KNOWLEDGE was "none" and the kit seed's own domain gate said no.
// gameIntent imports the analyzer, so the shared list has to live here, below both.
//
// 🔴 failedbr #2497 (2026-11-22, "ek bahut bada map par bubg jaisa game banao!!" — admin: "ye pubg ki jagah kya bana
// diya"). "bubg" is PUBG typed by ear, and every title reader was a regex of the exact spelling (\bpubg\b), so the
// contract came out {genre: unknown, dimension: unspecified} and the platform laid a 2D top-down world under a request
// for a big-map battle royale. 🧬 THE CLASS: title recognition was exact-spelling only, in six private lists (this file,
// gameIntent's NAMED_GAMES, the kit seed's 3D list, the map profile's open-world list, the scope analyzer's famous apps
// and the realism reader), while users type titles phonetically in Hinglish: bubg, pabji, pubji, pub-g, bgmii, frie
// fire, free fair, gtaa, g.t.a, maincraft, minecraf. THE FIX: one tolerant matcher over ONE curated catalogue, and
// every reader asks it. Tolerance is bounded so ordinary words never match:
//   1. NORMALISE — lowercase, NFKC, punctuation and spaces between the letters of one title ignored ("pub-g", "g.t.a",
//      "free-fire", "b g m i"), a run of the same letter read once ("bgmii", "gtaa", "pubgg").
//   2. CURATED SPELLINGS — every phonetic spelling we accept is written in the catalogue (pabji, pubji, bubg, frie
//      fire, maincraft…). A short title (under five letters once normalised) is matched ONLY by these: no edit
//      distance, so "bug", "pub", "bus", "big", "bag", "page" and "pug" can never become PUBG.
//   3. EDIT DISTANCE — only for long titles flagged `fuzzy`, only for a phrase of five letters or more, starting with
//      the same letter, within 1 (2 from eight letters), and never for a word in ORDINARY_WORDS.
// `tests/aMisspelledGameTitleIsStillTheGame.test.ts` holds the positive spellings and a negative corpus of real
// non-game prompts (tests/fixtures), and fails when a reader goes back to a private exact-spelling list.
//
// PURE, no imports.

/** What naming a title asks for: the kind decides genre, view and map (gameIntent, gameKitSeed, athreeMapIntent). */
export type GameTitleKind = 'royale' | 'fps' | 'runner' | 'gta' | 'sandbox' | 'other';

interface TitleEntry {
  /** The title as a person writes it — the contract's `reference` and the scope reason use this. */
  name: string;
  kind: GameTitleKind;
  /** Accepted spellings. A spelling starting with '?' counts only when the request also says game / khel. */
  spellings: readonly string[];
  /** Long titles only: also accept a small edit distance (see the header). */
  fuzzy?: boolean;
  /** Also an ordinary English word (halo, doom): a named REFERENCE, never on its own proof that a game was asked for. */
  plainWord?: boolean;
}

/**
 * THE catalogue. Add a spelling here — never a private regex somewhere else. Precision-first: a title that is also an
 * everyday word is either left out (asphalt, chess, pes) or marked plainWord.
 */
const CATALOGUE: readonly TitleEntry[] = [
  // ── Battle royale ────────────────────────────────────────────────────────────────────────────────────────────────
  { name: 'PUBG', kind: 'royale', spellings: ['pubg', 'pubgi', 'pubgee', 'pubji', 'pubjee', 'pabji', 'pabjee', 'pabg', 'bubg', 'bubji', 'pugb', 'pubg mobile', '?pbg', 'पबजी', 'पब्जी', 'पब जी', 'पबज़ी'] },
  { name: 'BGMI', kind: 'royale', spellings: ['bgmi', 'battlegrounds mobile india', 'battleground mobile india', 'बीजीएमआई'] },
  { name: 'Free Fire', kind: 'royale', fuzzy: true, spellings: ['free fire', 'freefire', 'firefree', 'frie fire', 'fri fire', 'fry fire', 'free fair', 'fre fair', 'fri fair', 'frie fair', 'free fayar', 'fri fayar', 'free fyre', 'free fier', 'free faier', 'फ्री फायर', 'फ्री फ़ायर', 'फ्रीफायर', 'फ्री फाइर'] },
  { name: 'Fortnite', kind: 'royale', fuzzy: true, spellings: ['fortnite', 'fortnait', 'fort nite', 'fortnit', 'fortnyt', 'फोर्टनाइट'] },
  { name: 'Apex Legends', kind: 'royale', spellings: ['apex legends', 'apex legend'] },
  { name: 'Battlefield', kind: 'royale', spellings: ['battlefield'] },
  // ── First-person shooters ──────────────────────────────────────────────────────────────────────────────────────
  { name: 'Call of Duty', kind: 'fps', fuzzy: true, spellings: ['call of duty', 'cod mobile', 'codm', 'कॉल ऑफ ड्यूटी'] },
  { name: 'Counter-Strike', kind: 'fps', fuzzy: true, spellings: ['counter strike', 'counterstrike', 'cs go', 'csgo', 'cs2', 'cs 2'] },
  { name: 'Valorant', kind: 'fps', spellings: ['valorant', 'valoront', 'valorent', 'velorant', 'valornt', 'वैलोरेंट'] },
  { name: 'Halo', kind: 'fps', plainWord: true, spellings: ['halo'] },
  { name: 'Doom', kind: 'fps', plainWord: true, spellings: ['doom'] },
  // ── Endless runners ────────────────────────────────────────────────────────────────────────────────────────────
  { name: 'Temple Run', kind: 'runner', spellings: ['temple run', 'templerun', 'tempal run', 'templ run', 'temple runn', 'टेम्पल रन'] },
  { name: 'Subway Surfers', kind: 'runner', fuzzy: true, spellings: ['subway surfers', 'subway surfer', 'subway surfar', 'sabway surfer', 'subwaysurfers', 'सबवे सर्फर'] },
  // ── Open world ─────────────────────────────────────────────────────────────────────────────────────────────────
  { name: 'GTA', kind: 'gta', spellings: ['gta', 'gta 5', 'gta v', 'gta vice city', 'gta san andreas', 'gta sa', 'grand theft auto', 'जीटीए'] },
  { name: 'Minecraft', kind: 'sandbox', fuzzy: true, spellings: ['minecraft', 'mine craft', 'maincraft', 'main craft', 'mincraft', 'minecraf', 'maincraf', 'mainkraft', 'minekraft', 'mainecraft', 'माइनक्राफ्ट', 'माइनक्राफ़्ट', 'मायनक्राफ्ट'] },
  // ── Other unmistakable games ───────────────────────────────────────────────────────────────────────────────────
  { name: 'Among Us', kind: 'other', spellings: ['among us', 'amongus', 'amang us'] },
  { name: 'Candy Crush', kind: 'other', fuzzy: true, spellings: ['candy crush', 'candycrush', 'kandy crush'] },
  { name: 'Flappy Bird', kind: 'other', fuzzy: true, spellings: ['flappy bird', 'flappybird', 'flapy bird'] },
  { name: 'Pac-Man', kind: 'other', spellings: ['pac man', 'pacman', 'pakman', 'pac-man'] },
  { name: 'Tetris', kind: 'other', spellings: ['tetris'] },
  { name: 'Super Mario', kind: 'other', spellings: ['super mario', 'supermario'] },
  { name: 'Mario Kart', kind: 'other', spellings: ['mario kart', 'mariokart'] },
  { name: 'Ludo', kind: 'other', spellings: ['ludo', 'लूडो'] },
  { name: 'Carrom', kind: 'other', spellings: ['carrom', 'caram board', 'carrom board', 'कैरम'] },
  { name: 'Snakes and Ladders', kind: 'other', spellings: ['snakes and ladders', 'snake and ladder', 'snakes and ladder', 'snake and ladders', 'snakes & ladders', 'snake & ladder', 'snake n ladder', 'snakes n ladders', 'साँप सीढ़ी', 'सांप सीढ़ी'] },
  { name: 'Clash of Clans', kind: 'other', fuzzy: true, spellings: ['clash of clans', 'clash of clan'] },
  { name: 'Angry Birds', kind: 'other', fuzzy: true, spellings: ['angry birds', 'angry bird', 'angrybirds'] },
  { name: 'Fruit Ninja', kind: 'other', fuzzy: true, spellings: ['fruit ninja', 'fruitninja', 'fruit ninjaa'] },
  { name: 'Need for Speed', kind: 'other', fuzzy: true, spellings: ['need for speed', 'need 4 speed'] },
  { name: 'Roblox', kind: 'other', spellings: ['roblox', 'roblocks', 'robloks'] },
  { name: 'Teen Patti', kind: 'other', spellings: ['teen patti', 'teenpatti', 'teen pati', 'तीन पत्ती'] },
  { name: 'Rummy', kind: 'other', spellings: ['rummy', 'rumy', 'रमी'] },
  { name: '8 Ball Pool', kind: 'other', spellings: ['8 ball pool', '8ball pool', 'eight ball pool'] },
];

/**
 * Ordinary words that sit within edit distance of a fuzzy title. Never a title, whatever the distance says. The negative
 * corpus test adds to this list when a real prompt proves a new neighbour.
 */
const ORDINARY_WORDS: ReadonlySet<string> = new Set([
  // Measured neighbours (the negative corpus proves each): a file name and a bakery's crust. Words further away than the
  // bounded distance ("fortnight", "fortunate", "free hire", "minecart") never needed listing.
  'freefile', 'candycrust', 'candycrusts',
].map((w) => normaliseKey(w)));

/** The comparison key: NFKC, lowercase, only letters/digits/marks, each run of one letter read once. */
function normaliseKey(s: string): string {
  return String(s ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, '').replace(/(.)\1+/gu, '$1');
}

const GAME_WORD = /\bgames?\b|\bkhel\b|गेम|खेल/i;

interface Spelling { entry: TitleEntry; key: string; needsGameWord: boolean }

const SPELLINGS: readonly Spelling[] = CATALOGUE.flatMap((entry) => entry.spellings.map((raw) => ({
  entry,
  key: normaliseKey(raw.replace(/^\?/, '')),
  needsGameWord: raw.startsWith('?'),
})));
const BY_KEY: ReadonlyMap<string, Spelling> = new Map(SPELLINGS.map((s) => [s.key, s]));
/** The longest title in words — windows longer than this cannot be a title. */
const MAX_WORDS = 4;
/** A word or title shorter than this (normalised) is matched only by a curated spelling — never by edit distance. */
export const MIN_FUZZY_LENGTH = 5;

/** A fuzzy title's FIRST spelling (its canonical form) is the only one edit distance is measured against. */
interface FuzzyForm { entry: TitleEntry; glued: string; words: readonly string[] }
const FUZZY: readonly FuzzyForm[] = CATALOGUE.filter((e) => e.fuzzy).map((entry) => {
  const words = entry.spellings[0].split(/\s+/).map((w) => normaliseKey(w)).filter(Boolean);
  return { entry, glued: words.join(''), words };
});

/** One letter wrong, missing or extra; two from ten letters. */
const capFor = (len: number): number => (len >= 10 ? 2 : 1);

function editDistance(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** One title found in a request: where it is in the ORIGINAL text, and which title it is. */
export interface GameTitleMention {
  name: string;
  kind: GameTitleKind;
  plainWord: boolean;
  /** The exact characters of the request that named it ("bubg", "g.t.a", "frie fire"). */
  matched: string;
  index: number;
  /** 'exact' — a catalogue spelling; 'fuzzy' — within the bounded edit distance of one. */
  via: 'exact' | 'fuzzy';
}

// Words: letters, digits and marks (so Devanagari survives). Between the words of ONE title only spaces and the
// punctuation people type inside a name (. - _ ' & /) may sit; anything else (a comma, a full stop and a space…) ends it.
const WORD = /[\p{L}\p{N}\p{M}]+/gu;
const JOINER = /^[\s.\-_'&]{0,3}$/u;

/**
 * The fuzzy title these words spell, or null. One word is compared whole with a canonical form (glued: "frifire",
 * "minecrat"); several words are compared word by word with a canonical form of the same length, at least one word exact
 * and every other word at most one letter off and five letters or longer — so "free hire" (hire is four letters) is never
 * Free Fire while "counter strik" is Counter-Strike. PURE.
 */
function fuzzyTitle(keys: readonly string[]): TitleEntry | null {
  if (keys.length === 1) {
    const k = keys[0];
    if (k.length < MIN_FUZZY_LENGTH || ORDINARY_WORDS.has(k)) return null;
    return FUZZY.find((f) => f.glued.length >= MIN_FUZZY_LENGTH && f.glued[0] === k[0]
      && editDistance(k, f.glued, capFor(Math.min(k.length, f.glued.length))) <= capFor(Math.min(k.length, f.glued.length)))?.entry ?? null;
  }
  if (ORDINARY_WORDS.has(keys.join(''))) return null;
  return FUZZY.find((f) => f.words.length === keys.length
    && keys.some((k, n) => k === f.words[n])
    && keys.every((k, n) => k === f.words[n] || (k.length >= MIN_FUZZY_LENGTH && f.words[n].length >= MIN_FUZZY_LENGTH && k[0] === f.words[n][0] && editDistance(k, f.words[n], 1) <= 1)))?.entry ?? null;
}

/** Every well-known game title the request names, in order, longest spelling first at each place. PURE; never throws. */
export function findGameTitles(text: string | null | undefined): GameTitleMention[] {
  try {
    const raw = String(text ?? '').slice(0, 20_000);
    if (!raw.trim()) return [];
    const words = [...raw.matchAll(WORD)].map((m) => ({ s: m[0], at: m.index ?? 0 }));
    const saysGame = GAME_WORD.test(raw);
    const out: GameTitleMention[] = [];
    for (let i = 0; i < words.length; i++) {
      let found: { mention: GameTitleMention; last: number } | null = null;
      let joined = '';
      for (let j = i; j < Math.min(words.length, i + MAX_WORDS); j++) {
        if (j > i && !JOINER.test(raw.slice(words[j - 1].at + words[j - 1].s.length, words[j].at))) break;
        joined += words[j].s;
        const key = normaliseKey(joined);
        const matched = raw.slice(words[i].at, words[j].at + words[j].s.length);
        const exact = BY_KEY.get(key);
        if (exact && (!exact.needsGameWord || saysGame)) {
          found = { mention: { name: exact.entry.name, kind: exact.entry.kind, plainWord: Boolean(exact.entry.plainWord), matched, index: words[i].at, via: 'exact' }, last: j };
          continue;
        }
        if (found) continue;
        const near = fuzzyTitle(words.slice(i, j + 1).map((w) => normaliseKey(w.s)));
        if (near) found = { mention: { name: near.name, kind: near.kind, plainWord: false, matched, index: words[i].at, via: 'fuzzy' }, last: j };
      }
      if (found) { out.push(found.mention); i = found.last; }
    }
    return out;
  } catch {
    return [];
  }
}

/** Does the request name a title of this kind? PURE. */
export function namesGameTitleOfKind(text: string | null | undefined, kind: GameTitleKind): boolean {
  return findGameTitles(text).some((m) => m.kind === kind);
}

/** A GTA title in any spelling ("gta 5", "gta5", "gtaa", "g.t.a", "grand theft auto", "जीटीए"). The ONE GTA reader. PURE. */
export function namesGtaTitle(text: string | null | undefined): boolean {
  return namesGameTitleOfKind(text, 'gta');
}

/**
 * A regex that finds, in THIS text, exactly the spellings the matcher read as one of `names` — for a caller that needs
 * each mention's position (the scope analyzer reads the words around a product name). null when none is named. PURE.
 */
export function gameTitleRegexIn(text: string | null | undefined, names: readonly string[]): RegExp | null {
  const hits = [...new Set(findGameTitles(text).filter((m) => names.includes(m.name)).map((m) => m.matched))];
  if (!hits.length) return null;
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(hits.sort((a, b) => b.length - a.length).map(esc).join('|'), 'i');
}

/**
 * A royale by GENRE words, not by a title (titles are the catalogue's): "battle royale" (and "battle royal", "battel
 * royal"), "last man standing", "BR game", and "FF" as Free Fire only when a game word or a comparison follows it
 * (failedbr #1349: "Muje ek game banani hai / Ff india jisa" got a 2D-only kit).
 */
export const ROYALE_GENRE_PHRASE = /बैटल\s*रॉयल|\bbatt?(?:le|el|al)\s*roy(?:ale?|el)\b|last\s+man\s+standing|\bbr\s+game\b|\bff\s*-?\s*(?:india|max|maxx|game|jaisa|jaise|jaisi|jisa|jise|jaesa|wala|wali)\b|\bffmax\b/i;

/** Does the request ask for a royale-style game — by genre words or by a royale title in any spelling? PURE. */
export function mentionsBattleRoyale(text: string | null | undefined): boolean {
  const t = String(text ?? '').normalize('NFKC');
  return ROYALE_GENRE_PHRASE.test(t) || namesGameTitleOfKind(t, 'royale');
}

/**
 * A request ABOUT a game rather than for one: a tournament, a top-up store, a stats tracker, a fan page. Such a request
 * names the title but asks for an ordinary app, and must not be handed a game engine ("BGMI tournament registration app").
 */
const ABOUT_A_GAME = /\b(?:tournaments?|esports?|e-sports?|scrims?|registrations?|register|stats?|statistics|tracker|leaderboard\s+(?:site|website|app)|top\s*-?\s*ups?|recharge|diamonds?|redeem|codes?|coupons?|wallet|store|shop|marketplace|selling|sell|accounts?\s+(?:sale|selling|store)|news|blog|wiki|guide|tips|fan\s*(?:site|page|club)|website|web\s*site|landing\s*page|portal|dashboard|community|forum|clan\s+management|team\s+management|booking|cafe|parlour|parlor)\b/i;

/** Does the request NAME a well-known game as the thing to build (not an app about it)? PURE. */
export function namesWellKnownGame(text: string | null | undefined): boolean {
  const t = String(text ?? '').normalize('NFKC');
  if (!ROYALE_GENRE_PHRASE.test(t) && !findGameTitles(t).some((m) => !m.plainWord)) return false;
  return !ABOUT_A_GAME.test(t);
}

// ── An unrecognised reference ─────────────────────────────────────────────────────────────────────────────────────
// "X jaisa game", "a game like X", "X type / style game": the user named something as the model for the game. When X is
// none of our titles and the request names no genre, the platform cannot know what X is — and must not guess.

const LIKENESS_AFTER = /^([\p{L}\p{N}][\p{L}\p{N}\-.']{1,24})\s+(?:jaisa|jaisi|jaise|jesa|jesi|jese|jaesa|jaisaa|jisa|jaysa|wala|wali|type|style|like|ki\s+tarah|ke\s+jaisa)\s+(?:\S+\s+){0,2}(?:games?|khel)\b/iu;
const LIKENESS_BEFORE = /\b(?:games?|khel)\s+(?:like|similar\s+to|inspired\s+by|in\s+the\s+style\s+of)\s+([\p{L}\p{N}][\p{L}\p{N}\-.']{1,24})/iu;
/** Words that are not names: pronouns, "before", "real", generic nouns. */
const NOT_A_NAME = new Set(['mere', 'mera', 'meri', 'tere', 'tera', 'apne', 'apna', 'uske', 'iske', 'unke', 'inke', 'aap', 'aapke', 'is', 'us', 'ye', 'yeh', 'wo', 'woh', 'this', 'that', 'it', 'the', 'a', 'an', 'my', 'your', 'our', 'pehle', 'pahle', 'purane', 'purana', 'real', 'asli', 'normal', 'simple', 'accha', 'acha', 'achha', 'badiya', 'badhiya', 'mast', 'naya', 'new', 'old', 'best', 'top', 'popular', 'famous', 'mobile', 'phone', 'android', 'online', 'offline', 'kids', 'bacchon', 'baccho', 'india', 'indian', 'desi', 'hindi', 'english', 'same', 'similar', 'other', 'any', 'kisi', 'koi', 'kuch', 'mujhe', 'muje', 'ek', 'bahut', 'bohot', 'bada', 'badi', 'chhota', 'chota', 'map', 'world', 'duniya', 'game', 'games', 'khel']);

/**
 * The name the request holds up as the model for its game when it is NOT a title we know ("zorbix jaisa game"), or null.
 * The caller decides only when the request names no genre either. PURE; never throws.
 */
export function unrecognisedGameReference(text: string | null | undefined): string | null {
  try {
    const t = String(text ?? '').normalize('NFKC');
    if (!t.trim() || findGameTitles(t).length || ROYALE_GENRE_PHRASE.test(t)) return null;
    const candidates: string[] = [];
    for (const w of t.matchAll(WORD)) {
      const at = w.index ?? 0;
      const a = LIKENESS_AFTER.exec(t.slice(at, at + 120));
      if (a) candidates.push(a[1]);
    }
    const b = LIKENESS_BEFORE.exec(t);
    if (b) candidates.push(b[1]);
    const name = candidates.map((c) => c.replace(/[.'-]+$/, '')).find((c) => !NOT_A_NAME.has(c.toLowerCase()) && /\p{L}/u.test(c));
    return name ?? null;
  } catch {
    return null;
  }
}
