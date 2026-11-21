// WHICH PART OF THE GAME IS THE USER TALKING ABOUT? — by what they MEAN, not by the file's name (admin 2026-11-21: "agar
// user police ko 'sipahi' kahe to platform use nahi pehchanega … isko intention ke anusar banao").
//
// The growth guard opens a working part of a game only when the user's request is about it. Matching the request against
// the part's file name alone fails the moment the user says the same thing in other words. A part is now known by
// everything that says what it IS — and all of it is read from the project and the user's own history, never guessed:
//   1. its id's words                       ("police")
//   2. its own `about` list                 (defineFeature({ id: 'police', about: ['police', 'sipahi', 'chase'] }))
//   3. THE USER'S OWN WORDS for it          — what they typed when it was made or last changed, kept by the platform in
//                                             src/game/features/names.json. A user who asked for "sipahi" and got police.ts
//                                             is understood when they say "sipahi" again.
//   4. words that MEAN the same             — a table of the things games are made of, in English, Roman Hindi and
//                                             Devanagari (police = sipahi = cop = पुलिस), so a switch of language is no switch
//                                             of subject.
// Words that say nothing ("karo", "game", "add") and words every part shares never decide. When the meaning is still not
// clear, the guard stays shut and the platform ASKS — a wrong "yes" here would rewrite a part that works, so no model's
// guess is ever allowed to open one. PURE.

export const PART_NAMES_FILE = 'src/game/features/names.json';

/** Things games are made of. Each line is ONE meaning; any word in it stands for all of them. */
const MEANINGS: readonly string[][] = [
  ['police', 'cop', 'cops', 'sipahi', 'pulis', 'thanedar', 'officer', 'constable', 'पुलिस', 'सिपाही'],
  ['coin', 'coins', 'sikka', 'sikke', 'paisa', 'paise', 'money', 'cash', 'rupee', 'rupaye', 'rupaya', 'gold', 'सिक्का', 'सिक्के', 'पैसा', 'पैसे'],
  ['rain', 'baarish', 'barish', 'barsaat', 'monsoon', 'बारिश'],
  ['weather', 'mausam', 'मौसम'],
  ['snow', 'barf', 'baraf', 'बर्फ'],
  ['wind', 'hawa', 'aandhi', 'storm', 'toofan', 'tufan', 'हवा', 'तूफान'],
  ['car', 'cars', 'gaadi', 'gadi', 'gaadiyan', 'gadiyan', 'vehicle', 'vehicles', 'motor', 'taxi', 'jeep', 'गाड़ी'],
  ['bike', 'motorcycle', 'motorbike', 'scooter', 'scooty', 'बाइक'],
  ['traffic', 'jam', 'ट्रैफिक'],
  ['enemy', 'enemies', 'dushman', 'villain', 'gunda', 'gunde', 'goon', 'goons', 'bot', 'bots', 'दुश्मन', 'गुंडा'],
  ['zombie', 'zombies', 'bhoot', 'ghost', 'monster', 'rakshas', 'भूत'],
  ['health', 'life', 'lives', 'jaan', 'hp', 'heal', 'medkit', 'dawai', 'जान'],
  ['gun', 'guns', 'bandook', 'banduk', 'pistol', 'rifle', 'weapon', 'weapons', 'hathiyar', 'shoot', 'shooting', 'fire', 'goli', 'bullet', 'ammo', 'बंदूक', 'गोली'],
  ['sword', 'talwar', 'knife', 'chaku', 'melee', 'तलवार'],
  ['bomb', 'bum', 'blast', 'explosion', 'dhamaka', 'grenade', 'बम', 'धमाका'],
  ['mission', 'missions', 'task', 'tasks', 'quest', 'quests', 'kaam', 'objective', 'मिशन'],
  ['delivery', 'deliver', 'parcel', 'courier', 'saman', 'डिलीवरी'],
  ['shop', 'shops', 'store', 'dukaan', 'dukan', 'market', 'bazaar', 'bazar', 'दुकान', 'बाज़ार'],
  ['timer', 'time', 'clock', 'samay', 'waqt', 'countdown', 'ghadi', 'समय'],
  ['score', 'points', 'ank', 'number', 'scoreboard', 'leaderboard', 'स्कोर'],
  ['night', 'raat', 'dark', 'andhera', 'रात'],
  ['day', 'din', 'morning', 'subah', 'sun', 'suraj', 'dhoop', 'दिन'],
  ['music', 'song', 'songs', 'gaana', 'gana', 'sangeet', 'संगीत', 'गाना'],
  ['sound', 'sounds', 'awaaz', 'awaz', 'audio', 'आवाज़'],
  ['speed', 'fast', 'faster', 'tez', 'raftaar', 'raftar', 'slow', 'dheema', 'dheere', 'तेज़'],
  ['jump', 'jumping', 'kood', 'kud', 'koodna', 'chhalang', 'कूद'],
  ['race', 'racing', 'daud', 'dod', 'lap', 'laps', 'checkpoint', 'checkpoints', 'रेस'],
  ['fight', 'fighting', 'ladai', 'larai', 'combat', 'punch', 'maar', 'लड़ाई'],
  ['house', 'houses', 'ghar', 'home', 'makan', 'घर'],
  ['building', 'buildings', 'imarat', 'tower', 'towers', 'इमारत'],
  ['road', 'roads', 'sadak', 'sadke', 'street', 'streets', 'rasta', 'highway', 'सड़क'],
  ['tree', 'trees', 'ped', 'paudha', 'jungle', 'forest', 'van', 'पेड़', 'जंगल'],
  ['water', 'paani', 'pani', 'river', 'nadi', 'lake', 'jheel', 'sea', 'samundar', 'पानी', 'नदी'],
  ['boat', 'boats', 'naav', 'nav', 'ship', 'jahaz', 'नाव'],
  ['plane', 'planes', 'aeroplane', 'airplane', 'aircraft', 'helicopter', 'udaan', 'हवाई'],
  ['train', 'trains', 'rail', 'railway', 'metro', 'ट्रेन'],
  ['bus', 'buses', 'बस'], ['truck', 'trucks', 'lorry', 'ट्रक'],
  ['people', 'log', 'pedestrian', 'pedestrians', 'crowd', 'bheed', 'npc', 'npcs', 'public', 'janta', 'लोग'],
  ['animal', 'animals', 'janwar', 'jaanwar', 'जानवर'],
  ['dog', 'dogs', 'kutta', 'kutte', 'कुत्ता'], ['cow', 'cows', 'gaay', 'gai', 'गाय'], ['horse', 'horses', 'ghoda', 'ghode', 'घोड़ा'],
  ['bird', 'birds', 'chidiya', 'panchi', 'pakshi', 'चिड़िया'],
  ['light', 'lights', 'roshni', 'batti', 'lamp', 'bulb', 'रोशनी'],
  ['door', 'doors', 'darwaza', 'gate', 'दरवाज़ा'], ['key', 'keys', 'chaabi', 'chabi', 'चाबी'],
  ['treasure', 'khazana', 'chest', 'loot', 'खज़ाना'],
  ['star', 'stars', 'sitara', 'sitare', 'सितारा'],
  ['level', 'levels', 'stage', 'stages', 'padav', 'लेवल'],
  ['boss', 'sardar', 'don', 'बॉस'],
  ['power', 'powerup', 'powerups', 'shakti', 'boost', 'booster', 'taakat', 'शक्ति'],
  ['shield', 'kavach', 'dhal', 'armor', 'armour', 'कवच'],
  ['win', 'jeet', 'victory', 'jeetna', 'जीत'], ['lose', 'haar', 'gameover', 'harna', 'हार'],
  ['menu', 'pause', 'settings', 'setting', 'मेन्यू'],
  ['camera', 'view', 'nazara', 'कैमरा'],
  ['player', 'character', 'hero', 'aadmi', 'insaan', 'kirdar', 'avatar', 'खिलाड़ी'],
  ['clothes', 'kapde', 'dress', 'outfit', 'shirt', 'कपड़े'],
  ['colour', 'color', 'colours', 'colors', 'rang', 'रंग'],
  ['fuel', 'petrol', 'diesel', 'tel', 'पेट्रोल'],
  ['map', 'minimap', 'naksha', 'नक्शा'],
  ['food', 'khana', 'pizza', 'burger', 'खाना'],
  ['hospital', 'aspatal', 'doctor', 'ambulance', 'अस्पताल'],
  ['school', 'vidyalaya', 'स्कूल'], ['temple', 'mandir', 'मंदिर'],
  ['wanted', 'chase', 'peecha', 'pakad', 'pakadna', 'pursuit'],
  ['jail', 'prison', 'thana', 'lockup', 'जेल'],
  ['bank', 'robbery', 'chori', 'dakaiti', 'heist', 'बैंक'],
  ['garage', 'mechanic', 'repair', 'गैराज'],
  ['friend', 'dost', 'saathi', 'partner', 'दोस्त'],
];
const MEANING_OF = new Map<string, number>();
MEANINGS.forEach((group, i) => { for (const w of group) if (!MEANING_OF.has(w)) MEANING_OF.set(w, i); });

/** Words that say nothing about WHICH part: what to do, how, and the particles of English and Roman Hindi. */
const SAYS_NOTHING = new Set(('a an the and or but of to in on at for with from by into over under is are was were be been do does did done make makes made add adds added put get got give take use show want need '
  + 'game games feature features part parts thing things file files code new old more less very some any all every also too just please this that these those it its my your our their me you we they '
  + 'change changes changed update updated edit modify set increase decrease bigger smaller big small good better best nice like should would could can will must may when then if so not no yes '
  + 'ko ka ki ke se me mein par pe ho hai hain tha thi the hoga hogi kar karo karna kare karein kiya kijiye kardo do de dena dijiye daal daalo dalo dalna lagao laga banao bana banado '
  + 'aur bhi ya lekin jo jab tab to hi ek do teen sab kuch koi yeh ye woh wo is us un in mera meri mere apna apni tum aap hum main mujhe humko chahiye chaiye thoda zyada jyada kam '
  + 'badlo badal badalna badhao ghatao bada chhota accha achha naya purana wala wali wale jaise jaisa tarah karke liye').split(/\s+/));

const norm = (s: string): string => String(s ?? '').normalize('NFKC').toLowerCase();
/** A word as it is compared: lower-case, Roman-Hindi and English plural endings dropped. */
export function stem(word: string): string {
  let w = norm(word);
  if (/^[a-z0-9]+$/.test(w)) {
    if (w.length > 5) w = w.replace(/(?:iyon|iyan|iyaan|yon|yan|ein)$/, 'i').replace(/(?:on|en)$/, '');
    if (w.length > 4) w = w.replace(/(?:ies)$/, 'y').replace(/(?:es|s)$/, '');
  }
  return w;
}
/** The telling words of a text: split, stemmed, with the words that say nothing removed. */
export function tellingWords(text: string): string[] {
  const out = new Set<string>();
  for (const raw of norm(text).replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^\p{L}\p{M}\p{N}]+/u)) {
    if (!raw || SAYS_NOTHING.has(raw)) continue;
    const w = stem(raw);
    if (w.length < 3 && /^[a-z0-9]+$/.test(w)) continue;
    if (!SAYS_NOTHING.has(w)) out.add(w);
  }
  return [...out];
}
const camelWords = (id: string): string => String(id ?? '').replace(/([a-z0-9])([A-Z])/g, '$1 $2');

/** The meanings (and the bare words) a text carries: each word, and the meaning it belongs to when it has one. */
function senses(words: readonly string[]): { words: Set<string>; meanings: Set<number> } {
  const meanings = new Set<number>();
  for (const w of words) { const m = MEANING_OF.get(w) ?? MEANING_OF.get(`${w}s`); if (m !== undefined) meanings.add(m); }
  return { words: new Set(words), meanings };
}

/** `about: ['police', 'sipahi']` in a feature's own source. PURE. */
export function aboutWordsIn(source: string | undefined): string[] {
  const m = /\babout\s*:\s*\[([^\]]*)\]/.exec(String(source ?? ''));
  if (!m) return [];
  return [...m[1].matchAll(/['"`]([^'"`]+)['"`]/g)].map((x) => x[1]);
}

/** The platform's record of what the USER called each part. Tolerant of anything that is not that shape. PURE. */
export function parsePartNames(source: string | undefined): Record<string, string[]> {
  try {
    const raw = JSON.parse(String(source ?? '')) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Record<string, string[]> = {};
    for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
      if (Array.isArray(v)) out[id] = v.filter((s): s is string => typeof s === 'string').slice(-6);
    }
    return out;
  } catch { return {}; }
}

/** `names` with what the user said this turn remembered for these parts (the last six sayings each, bounded). PURE. */
export function rememberPartNames(existing: string | undefined, ids: readonly string[], request: string): string {
  const names = parsePartNames(existing);
  const said = String(request ?? '').replace(/\s+/g, ' ').trim().slice(0, 240);
  for (const id of ids) {
    if (!id || !said) continue;
    const list = names[id] ?? [];
    if (!list.includes(said)) names[id] = [...list, said].slice(-6);
  }
  return `${JSON.stringify(names, null, 2)}\n`;
}

export interface PartKnowledge {
  /** Everything that says what this part is: its id, its `about` list, the user's own sayings. */
  vocabulary: string[];
}
/** What is known about each part of the project at the start of the turn, by id. PURE. */
export function partKnowledge(filesAtTurnStart: Readonly<Record<string, string>>): Map<string, PartKnowledge> {
  const names = parsePartNames(filesAtTurnStart[PART_NAMES_FILE]);
  const out = new Map<string, PartKnowledge>();
  for (const [path, source] of Object.entries(filesAtTurnStart)) {
    const m = /^src\/game\/features\/([^/]+)\.tsx?$/.exec(path);
    if (!m || m[1] === 'index') continue;
    out.set(m[1], { vocabulary: [camelWords(m[1]), ...aboutWordsIn(source), ...(names[m[1]] ?? [])] });
  }
  return out;
}

/**
 * Is the request about THIS part? True when one of the request's telling words is one of the part's own, or MEANS the same
 * as one — and that word (or meaning) does not belong to most of the other parts too, in which case it tells nothing.
 * `others` are the vocabularies of the rest of the game's parts. PURE.
 */
export function requestMeans(request: string, vocabulary: readonly string[], others: ReadonlyArray<readonly string[]> = []): boolean {
  const asked = senses(tellingWords(request));
  if (asked.words.size === 0) return false;
  const mine = senses(vocabulary.flatMap(tellingWords));
  const rest = others.map((v) => senses(v.flatMap(tellingWords)));
  const shared = (test: (s: { words: Set<string>; meanings: Set<number> }) => boolean): boolean => rest.length >= 2 && rest.filter(test).length * 2 > rest.length;
  for (const w of asked.words) {
    const hit = mine.words.has(w) || [...mine.words].some((v) => v.length >= 4 && w.length >= 4 && (v.startsWith(w) || w.startsWith(v)));
    if (hit && !shared((s) => s.words.has(w))) return true;
  }
  for (const m of asked.meanings) if (mine.meanings.has(m) && !shared((s) => s.meanings.has(m))) return true;
  return false;
}
