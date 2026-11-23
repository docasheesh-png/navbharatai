// 🗺️ WHAT DOES THE USER WANT DONE TO THE MAP? (map expansion plan, item 10: intent routing.)
//
// The world rule (gameKitSeed.ts GAME_WORLD_RULE) teaches the builder every path a map grows by, but one rule for every
// request left the builder to tell apart sentences that sound alike and mean different things:
//   "ek aur map jodo"                → ONE more place or land, spread out on the map          (add-place)
//   "4 map jod ke ek world banao"    → the places stand EDGE TO EDGE as one map                (join-one)
//   "shehar ke bagal me registan"    → a land right next to that place (joinTo)                (join-to)
//   "cricket ground chahiye"         → a sports ground ON the map (a venue region)             (venue)
//   "cricket game banao"             → the GAME itself — not a ground added to a map           (game-itself)
//   "sab shehron ko roads se jodo"   → ROADS between places (the kit's highways), nothing moves (highways)
// plus the paths that were already there: a city made bigger (grow city), the map made bigger (grow map), "50× bada"
// (multiply), "universe banao" (universe), "isi map ko duplicate karo" (duplicate), "track bada karo" in a race
// (track-longer), "map chhota karo" (shrink) — and none.
//
// mapGrowthIntent reads WHICH ONE, in English, Hinglish and Devanagari. mapGrowthRoute then says, for THIS game's type,
// the smallest change that fulfils it — and carries the owner's decisions (2026-11-23):
//   • cricket and football get a world around the ground ONLY when the user asks for one;
//   • a race moves onto city roads only AFTER asking the user once (a longer track stays the race's own finishKm);
//   • a battle royale stays an 8 km island: places are added only on its dry land, and the island never grows.
// When the reading is unsure it ASKS (never edits on a guess). A game type with no map to grow gets no note at all.
//
// PURE. No I/O, no clock, no env (the turn-start port in growthTurn.ts reads the switch). Never throws.

export type MapGrowthKind =
  | 'add-place' | 'join-one' | 'join-to' | 'venue' | 'game-itself' | 'highways'
  | 'grow-city' | 'grow-map' | 'multiply' | 'universe' | 'duplicate' | 'track-longer' | 'shrink' | 'unsure' | 'none';

export type MapPlaceKind = 'city' | 'town' | 'village' | 'desert' | 'jungle' | 'mountain' | 'snow' | 'beach';
export type MapVenueKind = 'cricket-ground' | 'football-field' | 'stadium' | 'race-circuit' | 'arena';

export interface MapGrowthIntent {
  kind: MapGrowthKind;
  /** The place or land asked for (add-place / join-to), when the words name one. */
  place?: MapPlaceKind;
  /** The venue asked for (venue). */
  venue?: MapVenueKind;
  /** A venue or land asked for BESIDE a place ("bagal me", "next to"). */
  beside?: boolean;
  /** "50×", "10 guna" (multiply). */
  times?: number;
  /** The words that decided it, for the report. */
  evidence: string;
}

// Letters, digits and combining marks (Devanagari vowel signs are marks: \w does not see them).
const norm = (s: string): string => ` ${String(s ?? '').slice(0, 4000).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\p{M}×]+/gu, ' ').trim()} `;
/** A whole-word alternative group, safe for Devanagari (spaces, never \b). */
const W = (alts: string): string => `(?<=\\s)(?:${alts})(?=\\s)`;
const has = (t: string, re: RegExp): RegExpExecArray | null => re.exec(t);

// ── Words ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
const MAP = 'maps?|naksh[ae]?|world|worlds|duniya|duniyaa|zameen|jameen|jamin|zamin|area|jagah|jagahen|level|मैप|नक्शा|नक्शे|दुनिया|ज़मीन|जमीन|जगह|वर्ल्ड';
const CITY = 'city|cities|sheh?a?r|shahar|shehron|shaharon|nagar|town|towns|kasba|qasba|village|villages|gaon|gaanv|gav|gaav|गाँव|गांव|शहर|शहरों|नगर|कस्बा|कस्बे|टाउन|सिटी';
const LAND = 'desert|registan|reghistan|marusthal|jungle|jangal|forest|van|mountains?|pahad|pahaad|pahar|parvat|hills?|snow|barf|baraf|himpradesh|beach|samundar|samudra|kinara|tat|रेगिस्तान|मरुस्थल|जंगल|वन|पहाड़|पहाड़ों|पर्वत|बर्फ|बर्फ़|समुद्र|किनारा|बीच';
const ADD = 'jodo|jod|jodna|jodiye|jodenge|joro|add|adds|daalo|dalo|daal|dal|lagao|laga|banao|bana|banaiye|chahiye|chaahiye|want|need|make|build|create|put|place|naya|nayi|naye|new|another|more|aur|ek|जोड़ो|जोड़|जोडो|डालो|बनाओ|बना|चाहिए|नया|नई|नए|और|एक';
const MORE = 'aur|another|more|naya|nayi|naye|new|ek|और|नया|नई|नए|एक';
const ROAD = 'roads?|sadak|sadke|sadkon|sadako|sadkein|highways?|rasta|raste|raston|रोड|सड़क|सड़कों|सडक|रास्ता|रास्ते|हाईवे';
const JOIN_VERB = 'jodo|jod|joro|jodna|connect|connected|link|join|joined|milao|जोड़ो|जोड़|जोडो|मिलाओ|कनेक्ट';
const BIG = 'bada|badaa|bade|badi|bara|bari|bigger|big|larger|large|huge|vishal|lamba|lambi|lambe|longer|long|badhao|badha|expand|extend|बड़ा|बड़ी|बड़े|बडा|लंबा|लंबी|लम्बा|लम्बी|बढ़ाओ|विशाल';
const SMALL = 'chhota|chota|chhoti|choti|smaller|small|shrink|ghatao|kam|छोटा|छोटी|घटाओ|कम';
const NEG = 'nahi|nahin|nai|mat|not|never|नहीं|नही|मत';
const GAMEWORD = 'game|games|khel|khelna|khelne|khelo|khelte|khelenge|match|gem|गेम|खेल|खेलना|खेलने|मैच';
const SPORT_CRICKET = 'cricket|kriket|क्रिकेट';
const SPORT_FOOTBALL = 'football|soccer|futbol|फुटबॉल|फ़ुटबॉल';
const SPORT_RACE = 'racing|race|car race|रेस|रेसिंग';
const GROUND = 'ground|grounds|maidan|maidaan|field|pitch|मैदान|ग्राउंड|पिच|फील्ड';
const STADIUM = 'stadium|stadiums|stediam|istadium|स्टेडियम';
const CIRCUIT = 'circuit|race track|racetrack|race course|racecourse|सर्किट|रेस ट्रैक';
const ARENA = 'arena|akhada|akhaada|अखाड़ा|एरीना';
const BESIDE_EN = 'beside|next to|adjacent to|adjacent|near|nearby|behind|alongside';
const BESIDE = `bagal|bagl|baju|bazu|paas|pas|saath|sath|sata|sate|se laga|se lage|se lagaa|laga hua|lage hue|lagaa hua|peeche|piche|बगल|पास|साथ|सटा|सटे|से लगा|लगा हुआ|पीछे|${BESIDE_EN}`;
const DUP = 'duplicate|copy|copies|nakal|clone|कॉपी|नकल|डुप्लीकेट';
const UNIVERSE = 'universe|brahmand|brahmaand|multiverse|galaxy|ब्रह्मांड|ब्रह्माण्ड';
const TRACK = 'track|road|sadak|race|route|rasta|ट्रैक|रोड|सड़क|रेस|रास्ता';

const re = (src: string) => new RegExp(src.normalize('NFKC'), 'u');
const near = (a: string, b: string, gap = 4): RegExp => re(`${W(a)}(?:\\s+\\S+){0,${gap}}?\\s+${W(b)}|${W(b)}(?:\\s+\\S+){0,${gap}}?\\s+${W(a)}`);
const before = (a: string, b: string, gap = 4): RegExp => re(`${W(a)}(?:\\s+\\S+){0,${gap}}?\\s+${W(b)}`);

const PLACE_OF: Array<[MapPlaceKind, string]> = [
  ['desert', 'desert|registan|reghistan|marusthal|रेगिस्तान|मरुस्थल'], ['jungle', 'jungle|jangal|forest|van|जंगल|वन'],
  ['mountain', 'mountains?|pahad|pahaad|pahar|parvat|hills?|पहाड़|पहाड़ों|पर्वत'], ['snow', 'snow|barf|baraf|बर्फ|बर्फ़'],
  ['beach', 'beach|samundar|samudra|kinara|tat|समुद्र|किनारा|बीच'], ['village', 'village|villages|gaon|gaanv|gav|gaav|गाँव|गांव'],
  ['town', 'town|towns|kasba|qasba|कस्बा|कस्बे|टाउन'], ['city', 'city|cities|sheh?a?r|shahar|shehron|shaharon|nagar|शहर|शहरों|नगर|सिटी'],
];
const placeIn = (t: string, after = 0): MapPlaceKind | undefined => {
  let best: { kind: MapPlaceKind; at: number } | undefined;
  for (const [kind, words] of PLACE_OF) {
    const g = new RegExp(W(words).normalize('NFKC'), 'gu'); g.lastIndex = after;
    const m = g.exec(t);
    if (m && (!best || m.index < best.at)) best = { kind, at: m.index };
  }
  return best?.kind;
};
const NUM_WORD: Record<string, number> = { do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, das: 10, sau: 100, hazaar: 1000, hazar: 1000, two: 2, three: 3, four: 4, five: 5, ten: 10, hundred: 100, thousand: 1000, 'दो': 2, 'तीन': 3, 'चार': 4, 'पांच': 5, 'पाँच': 5, 'दस': 10, 'सौ': 100 };

/** Which way the user wants the map changed. PURE. Never throws. */
export function mapGrowthIntent(text: string | null | undefined): MapGrowthIntent {
  try {
    const t = norm(String(text ?? ''));
    if (t.trim().length === 0) return { kind: 'none', evidence: '' };
    // Said NOT to be done: a "no" inside the words that matched, right after them ("bada map nahi chahiye", "jodo mat"), or a
    // "don't / never / mat" right before them ("map mat jodo", "don't add a city"). A "no" elsewhere in the sentence ("alag mat
    // rakho, jod ke ek world banao") does not undo the wish.
    const negWord = re(W(NEG));
    const negated = (m: RegExpExecArray): boolean => {
      if (negWord.test(` ${m[0].trim()} `)) return true;
      const after = t.slice(m.index + m[0].length).trim().split(/\s+/).slice(0, 2).join(' ');
      if (negWord.test(` ${after} `) && !/\b(?:balki|lekin|but)\b|बल्कि|लेकिन/u.test(after)) return true;
      const prev = t.slice(0, m.index).trim().split(/\s+/);
      const p1 = prev.slice(-1).join(' '), p2 = prev.slice(-2).join(' ');
      return re(W('mat|मत|never|not')).test(` ${p1} `) || re(W('dont|don|never|not')).test(` ${p2} `);
    };
    const found = (kind: MapGrowthKind, m: RegExpExecArray | null, extra: Partial<MapGrowthIntent> = {}): MapGrowthIntent =>
      (m && kind !== 'unsure' && negated(m) ? { kind: 'none', evidence: m[0].trim().slice(0, 80) } : { kind, evidence: (m?.[0] ?? '').trim().slice(0, 80), ...extra });

    // 1. A SPORTS GROUND / VENUE named — "cricket ground chahiye", "football ka maidan", "स्टेडियम", "race track add karo".
    //    A ground beats "game": "cricket ground wala map" is a ground. (A race track made LONGER is the race's own road: 7.)
    const venueOf = (): { venue: MapVenueKind; m: RegExpExecArray } | null => {
      let m: RegExpExecArray | null;
      if ((m = has(t, re(W(STADIUM))))) return { venue: 'stadium', m };
      if ((m = has(t, near(SPORT_CRICKET, GROUND, 3)))) return { venue: 'cricket-ground', m };
      if ((m = has(t, near(SPORT_FOOTBALL, GROUND, 3)))) return { venue: 'football-field', m };
      if ((m = has(t, re(W(CIRCUIT)))) && !has(t, near('track|race track|racetrack|circuit|ट्रैक|सर्किट', BIG, 3))) return { venue: 'race-circuit', m };
      if ((m = has(t, re(W(ARENA))))) return { venue: 'arena', m };
      return null;
    };
    const v = venueOf();
    if (v) {
      const beside = !!has(t, re(W(BESIDE))) && !!has(t, re(W(`${CITY}|${LAND}|${MAP}`)));
      // "शहर में स्टेडियम" — IN a place: beside it (a venue never stands on a city's own lots).
      const inPlace = !!has(t, before(CITY, 'me|mein|main|में|in|inside|andar|अंदर', 1));
      return found('venue', v.m, { venue: v.venue, ...(beside || inPlace ? { beside: true } : {}) });
    }

    // 2. THE GAME ITSELF — "cricket game banao", "football khelna hai", "racing game banao": no ground, no map.
    const gameItself = has(t, near(`${SPORT_CRICKET}|${SPORT_FOOTBALL}|${SPORT_RACE}`, GAMEWORD, 3));
    if (gameItself && !has(t, re(W(`${MAP}|${CITY}|${LAND}`)))) return found('game-itself', gameItself);

    // 3. ROADS BETWEEN PLACES — "sab shehron ko roads se jodo", "connect the cities with roads": the kit's highways.
    const roads = has(t, near(ROAD, JOIN_VERB, 3));
    if (roads && !has(t, near(ROAD, BIG, 2))) return found('highways', roads);

    // 4. JOINED INTO ONE — "4 map jod ke ek world", "sab maps ko mila ke ek kar do", "ek hi map bana do", "merge into one".
    const participle = 'jod ke|jodke|jod kar|jodkar|jodkr|jor ke|jod k|mila ke|milake|mila kar|milakar|chipka ke|chipkake|chipka kar|joint kar|merge kar|merge karke|merge karke|जोड़ के|जोड़कर|जोड़ कर|मिला के|मिलाकर|मिला कर|चिपका के';
    const oneWords = 'ek|एक|one|single';
    const joinOne = has(t, re(`${W(participle)}(?:\\s+\\S+){0,3}?\\s+${W(oneWords)}`))
      || has(t, re(`${W('ek|एक')}\\s+${W('hi|ही')}\\s+${W(MAP)}`))
      || has(t, re(`${W('merge|join|joined|combine|combined|merged')}(?:\\s+\\S+){0,4}?\\s+${W('into')}\\s+${W('one|a single|single')}`))
      || has(t, re(`${W('into|in')}\\s+${W('one')}\\s+(?:\\S+\\s+)?${W(MAP)}`))
      || has(t, re(`${W('one')}\\s+(?:big\\s+|giant\\s+|huge\\s+)?${W(MAP)}`)) && has(t, re(W('join|merge|combine|stitch')));
    if (joinOne) return found('join-one', joinOne);

    // 5. RIGHT NEXT TO a place — "shehar ke bagal me registan", "city se laga hua jungle", "शहर के पास रेगिस्तान".
    const besideM = has(t, re(`${W(`${CITY}|${LAND}|${MAP}|is|isi|iske|uske|इस|उस`)}(?:\\s+\\S+){0,3}?\\s+${W(BESIDE)}`))
      || has(t, re(W(BESIDE_EN)));
    if (besideM && has(t, re(W(`${CITY}|${LAND}`)))) {
      // The place asked for: in Hinglish / Hindi it comes AFTER the "beside" words ("shehar ke bagal me REGISTAN"); in English
      // BEFORE them ("a DESERT next to the city"). Else the first one named.
      const english = re(`${W(BESIDE_EN)}`).exec(t);
      const place = (english ? placeIn(t.slice(0, english.index + 1)) : placeIn(t, besideM.index + besideM[0].length)) ?? placeIn(t);
      return found('join-to', besideM, place ? { place } : {});
    }

    // 6. DUPLICATE, UNIVERSE, N× — the paths that were already there.
    const dup = has(t, re(W(DUP)));
    if (dup && has(t, re(W(`${MAP}|${CITY}|is|isi|इसी|इस`)))) return found('duplicate', dup);
    const uni = has(t, re(W(UNIVERSE)));
    if (uni) return found('universe', uni);
    const times = has(t, re(`(?<=\\s)(\\d+)\\s*(?:x|×|guna|gunaa|गुना|times|fold)(?=\\s)`)) || has(t, re(`(?<=\\s)(\\d+)(?:x|×)(?=\\s)`))
      || has(t, re(`${W(Object.keys(NUM_WORD).join('|'))}\\s+${W('guna|gunaa|गुना|times')}`));
    if (times && has(t, re(W(`${BIG}|${MAP}`)))) {
      const n = Number(times[1]) || NUM_WORD[times[0].trim().split(/\s+/)[0]] || 0;
      if (n >= 2) return found('multiply', times, { times: Math.min(1000, n) });
    }

    // 7. A LONGER TRACK — "track bada karo", "race lambi karo", "road jaldi khatam ho jati hai", "20 km ki race".
    const longer = has(t, near(TRACK, BIG, 2)) || has(t, near(TRACK, 'khatam|khtm|ends|end|ख़त्म|खत्म', 3))
      || has(t, re(`(?<=\\s)\\d+\\s*(?:km|kilometre|kilometer|किमी)(?=\\s)(?:\\s+\\S+){0,3}?\\s+${W(TRACK)}`));
    if (longer && !has(t, re(W(`${MAP}|${CITY}|${LAND}`)))) return found('track-longer', longer);

    // 8. SMALLER — "map chhota karo", "make the world smaller".
    const shrink = has(t, near(`${MAP}|${CITY}`, SMALL, 2));
    if (shrink) return found('shrink', shrink);

    // 9. BIGGER — a city ("yeh shehar bada karo", "city ko bada karo") or the map ("map bada karo", "duniya badi karo").
    const growCity = has(t, re(`${W(CITY)}(?:\\s+\\S+){0,2}?\\s+${W(BIG)}`));
    if (growCity) return found('grow-city', growCity, { place: placeIn(t) });
    const growMap = has(t, near(MAP, BIG, 2)) || has(t, re(`${W(`${MAP}`)}\\s+${W('badhao|expand|extend|बढ़ाओ')}`));
    if (growMap) return found('grow-map', growMap);

    // 10. ONE MORE PLACE OR LAND, spread — "ek aur map jodo", "ek desert map jodo", "aur maps jodo", "add a village".
    const noun = `${MAP}|${CITY}|${LAND}`;
    const add = has(t, near(ADD, noun, 3));
    if (add && (has(t, re(W(MORE))) || has(t, re(W('jodo|jod|joro|add|daalo|dalo|lagao|जोड़ो|डालो|जोडो'))))) return found('add-place', add, { ...(placeIn(t) ? { place: placeIn(t) } : {}) });

    // A bare "bada karo" / "isko bada karo" about nothing named: unsure (the map? the ground? the track?) — ASK.
    // Only when NOTHING else is named ("jump button bada karo" is about a button, not the map) and it is not refused.
    const bare = has(t, re(`${W(`${BIG}`)}\\s+${W('karo|kar|kardo|karde|करो|कर|do|please')}`));
    const fillerWord = re(`^\\s(?:${BIG}|karo|kar|kardo|karde|do|de|please|plz|isko|isse|ise|isey|ye|yeh|is|ko|thoda|aur|zara|sab|bhai|ji|make|it|this|इसे|इसको|यह|ये|को|थोड़ा|और|करो|कर|दो|दें)\\s$`);
    const filler = { test: (x: string) => x.trim().split(/\s+/).every((w) => fillerWord.test(` ${w} `)) };
    if (bare && filler.test(t) && !negated(bare)) return found('unsure', bare);
    return { kind: 'none', evidence: '' };
  } catch { return { kind: 'none', evidence: '' }; }
}

// ── The route: the smallest change for THIS game ───────────────────────────────────────────────────────────────────────
export type MapGameType = 'open-world' | 'battle-royale' | 'racing-library' | 'cricket' | 'football' | 'other';

export interface MapGrowthCapabilities {
  /** A sports game can be given a world around its ground (map expansion item 7). Off until that ships. */
  sportsWorld?: boolean;
  /** A race can move onto the world's city roads (map expansion item 8, TRACK.world). Off until that ships. */
  racingWorld?: boolean;
}

export interface MapGrowthRoute {
  /** edit: make this one change · ask: ask the user ONE question, change nothing · tell: change nothing, say why · none: no note. */
  action: 'edit' | 'ask' | 'tell' | 'none';
  /** What the builder is told (empty for none). */
  note: string;
}

const ISLAND = 'This battle royale stays an 8 km island (owner decision): never raise sizeMeters, never change the map profile, never make the island bigger.';
const islandFit = ' Places and lands go only on the island\'s dry land; the kit says in the console which ones did not fit — tell the user plainly which did not fit, never drop one silently.';
const regionOf = (i: MapGrowthIntent): string => i.place ?? 'city';

/** Switch (map expansion item 7): AGENTV3_SPORTS_WORLD=on lets a cricket or football game ASKED for a world get one. OFF by default. */
export function sportsWorldEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(?:1|on|true|yes)$/i.test(String(env.AGENTV3_SPORTS_WORLD ?? '').trim());
}

/** The smallest change that fulfils `intent` in a game of this type. PURE. Never throws. */
export function mapGrowthRoute(intent: MapGrowthIntent, game: MapGameType, caps: MapGrowthCapabilities = {}): MapGrowthRoute {
  try {
    const none: MapGrowthRoute = { action: 'none', note: '' };
    const k = intent.kind;
    if (k === 'none' || game === 'other') return none;
    const edit = (note: string): MapGrowthRoute => ({ action: 'edit', note });
    const ask = (note: string): MapGrowthRoute => ({ action: 'ask', note });
    const tell = (note: string): MapGrowthRoute => ({ action: 'tell', note });
    const gameItself = 'This request names the GAME itself (a match, a race), not a change to the map — do not add a venue, a place or a land for it.';

    if (game === 'cricket' || game === 'football') {
      // A world around the ground ONLY when the user asks for one (owner decision); a sports game is never given one on a guess.
      if (k === 'game-itself') return none;
      if (k === 'unsure' || k === 'track-longer' || k === 'shrink') {
        return ask('Ask the user ONE short question in their language before changing anything: do they mean the GROUND (the field, the boundary) or a WORLD around the ground (places to walk to)? Change nothing until they answer.');
      }
      if (k === 'venue') return tell('This game is already played on its own ground. Do not add a second ground or a map for it; if the user wants the ground itself changed, change only the ground.');
      // An explicit world wish: add-place, grow-map, join-*, universe, multiply, duplicate, highways.
      if (!(caps.sportsWorld ?? sportsWorldEnabled())) {   // item 7: the switch is read here only when the caller did not say
        return tell(`The user asked for a world around this ${game} game. A world around a ${game} ground is not available in this game yet: change NOTHING about the match or the ground, build no map by hand, and tell the user plainly, in their language, that a world around the ground is not available yet (the match itself is unchanged).`);
      }
      return edit(`The user ASKED for a world around this ${game} game, so it gets one (owner decision: only on request): mount the ${game} ground as a venue on the world and keep the match inside it exactly as it is — rules, ball and players unchanged. The platform's note above (src/game/play/worldVenue.ts) says what it added and the ONE change to make — or why nothing was added, and then change nothing.`);
    }

    if (game === 'racing-library') {
      if (k === 'track-longer') return edit('A longer race is the race\'s own road: change TRACK.finishKm (or null for endless) in src/game/track.ts — nothing else. No cities, no map, no venue.');
      if (k === 'game-itself' || k === 'shrink' || k === 'unsure') {
        return k === 'game-itself' ? none : ask('Ask the user ONE short question before changing anything: a longer or shorter race (the road), or something else? Change nothing until they answer.');
      }
      if (k === 'highways') return tell('The race already runs on one joined road. Nothing to connect: change nothing, and say so in one sentence.');
      // Cities, lands, a bigger world, a venue: the race would move onto the world's city roads — only after asking ONCE.
      if (!caps.racingWorld) {
        return tell('This race runs on the road library; moving it onto a world with cities is not available yet. Change NOTHING about the race, add no map or city by hand, and tell the user plainly, in their language, that cities on the route are not available yet — and offer a longer track (TRACK.finishKm) instead.');
      }
      return ask('Moving this race onto city roads changes the race (owner decision: ask once). Ask the user ONE question in their language — "Race ko shehar ki sadkon par le jaayein?" — and change NOTHING this turn. Only after a clear yes set TRACK.world; after a no keep the road library and never ask again.');
    }

    // An open world (explore too) or a battle royale: the map's own regions list.
    const br = game === 'battle-royale';
    const brWrap = (note: string): string => (br ? `${note} ${ISLAND}${islandFit}` : note);
    switch (k) {
      case 'game-itself': return tell(gameItself);
      case 'add-place': return edit(brWrap(`ADD one region to WORLD.regions in src/game/world.ts: { id: '<new id>', kind: '${regionOf(intent)}' } — spread out (NO joinTo; toward only if they said a side). Change no other entry.`));
      case 'join-one': return edit(brWrap('JOINED INTO ONE: each place asked for is a joined tile of the FIRST region — { id: \'<new id>\', kind: \'city\', joinTo: \'<first region id>\', toward?: … }; a land in the same breath is a land region with joinTo: \'<first region id>\'. Edge to edge, one ground level, no highway between. Change no other entry.'));
      case 'join-to': return edit(brWrap(`RIGHT NEXT TO a place: ADD { id: '<new id>', kind: '${regionOf(intent)}', joinTo: '<the id of the place they named>', toward?: '<side, if they said one>' } — it lies against that place's edge, no highway between. Never move the existing entry.`));
      case 'venue': return edit(brWrap(`A SPORTS GROUND on the map: ADD ONE region { id: '<new id>', kind: 'venue', venue: '${intent.venue ?? 'football-field'}'${intent.beside ? ', joinTo: \'<the id of the place they named>\'' : ''}, toward? } — standard size, level dry ground, joined by road. Do NOT build the ground by hand as a feature, and do not start a new game.`));
      case 'highways': return tell('ROADS between places: the kit\'s highways already join every place on the map. Move nothing, add nothing, and say so in one sentence (if a place truly has no road, name it in the console report).');
      case 'grow-city': return edit(brWrap('GROW that city with joined tiles: ADD { id: \'<city id>-2\', kind: \'city\', joinTo: \'<that city id>\' } (several for "bahut bada"). Change no other entry.'));
      case 'grow-map':
      case 'multiply':
      case 'universe':
        if (br) return tell(`${ISLAND} The island cannot be made bigger: tell the user so plainly, in their language, and offer to add more places ON the island instead. Change nothing this turn unless they asked for places too.`);
        return edit(`BIGGER means MORE places: ADD spread regions (a mix of places and lands, every direction)${k === 'multiply' && intent.times ? `, about ${Math.min(1000, intent.times)}× the places there are` : ''}${k === 'universe' ? ', many at once' : ''} — up to the map's cap of 1000 entries. NEVER raise sizeMeters. Change no existing entry.`);
      case 'duplicate': return edit(brWrap('DUPLICATE: add copies of the existing regions with NEW ids (same kind and the same city options), spread around the original. Never edit or remove the originals.'));
      case 'shrink': return ask('Making the map smaller means removing places. Ask the user ONE question — which places to remove — and change nothing until they name them.');
      case 'track-longer':
      case 'unsure':
        return ask('The request does not say WHAT to make bigger (the map, a city, a road). Ask the user ONE short question in their language and change nothing until they answer.');
      default: return none;
    }
  } catch { return { action: 'none', note: '' }; }
}

/** This game's type, read from its OWN files. PURE. */
export function mapGameTypeOf(files: Readonly<Record<string, string>> | null | undefined): MapGameType {
  const f = files ?? {};
  const app = String(f['src/App.tsx'] ?? '');
  const world = f['src/game/world.ts'];
  if (/<RacingRoadGame\b/.test(app)) return 'racing-library';
  if (typeof world === 'string') {
    return /profile\s*:\s*['"]battle-royale['"]/.test(`${world}\n${app}`) ? 'battle-royale' : 'open-world';
  }
  if (Object.keys(f).some((p) => /^src\/game\/board\/.*cricket/i.test(p)) || /cricket|क्रिकेट/i.test(app)) return 'cricket';
  if (/football|soccer|फुटबॉल/i.test(app)) return 'football';
  return 'other';
}

/** The note the builder is told at the start of a turn, or '' (no note: nothing about the map, or a game with no map). PURE. */
export function mapGrowthNote(request: string, files: Readonly<Record<string, string>> | null | undefined, caps: MapGrowthCapabilities = {}): string {
  const game = mapGameTypeOf(files);
  if (game === 'other') return '';
  const intent = mapGrowthIntent(request);
  const route = mapGrowthRoute(intent, game, caps);
  if (route.action === 'none' || !route.note) return '';
  return `🧭 MAP REQUEST READ AS: ${intent.kind}${intent.evidence ? ` ("${intent.evidence}")` : ''} in a ${game} game → ${route.action.toUpperCase()}. ${route.note}`
    + ' (If the request clearly means something else, follow the request — this reading is a guide, never a reason to change what was not asked.)';
}
