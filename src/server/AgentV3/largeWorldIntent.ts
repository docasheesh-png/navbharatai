// DOES THE USER WANT A BIG WORLD? READ FROM WHAT THEY MEAN, NOT FROM ONE MAGIC WORD (admin 2026-11-19).
//
// Admin, verbatim: *"navbharatai par jab koi user game banwata hai, to road/map bahut chota sa banta hai"* and,
// on the first draft of this fix: *"sirf word par nahi, intension par trigger ho!!"*
//
// 🔑 ROOT CAUSE. The big-world gate (`mapProfileFor`, athreeMapIntent.ts) matched a short English list —
// "big map", "huge world", "open world". A user who wrote "bada map banao", "aisi duniya jisme kahin bhi ghoom
// sakun", "road khatam hi na ho" or "map bahut chhota hai, bada karo" meant exactly that and got no world:
// the platform's map was never offered, and the builder hand-made a few hundred metres of ground.
//
// 🧬 THE FIX: one reader of the WISH, shared by every surface that sizes a game world (the 3D Athree map, the
// 2D world, the race course). A wish is recognised by MEANING — any one of five shapes, in English, Hinglish
// or Devanagari, in any word order:
//   1. BIG SPACE     — a size idea next to a space idea: "bada map", "map bada ho", "विशाल दुनिया",
//                      "lambi sadak", "a world that is really large".
//   2. FREE ROAM     — the player can go anywhere: "kahin bhi ghoom sakun", "explore", "free roam",
//                      "jahan chahe ja sake", "कहीं भी घूम".
//   3. NEVER ENDING  — the space must not run out: "road khatam na ho", "never ends", "door tak chalaun",
//                      "endless track", "अंतहीन".
//   4. TOO SMALL     — a complaint about the current size, which IS a wish for a bigger one: "map bahut chhota
//                      hai", "road jaldi khatam ho jata hai", "aur bada karo", "make the world bigger".
//   5. DISTANCE      — a distance a small scene cannot hold: "20 km ka map", "50 km race".
// A wish for a SMALL world ("chhota map banao", "a tiny arena", "bada map nahi chahiye") is read as NOT big.
//
// Honest limit: this is a deterministic reader (no model call, no cost, instant, and the same answer every
// time); it reads the shapes above, not every sentence a human could write. The builder model still reads the
// whole request, and a world it asks for is still subject to the recipe's own "is this a game" check.
//
// PURE. No I/O, no clock, no env. Never throws.

export type LargeWorldWish = 'big-space' | 'free-roam' | 'never-ending' | 'too-small' | 'distance';

export interface LargeWorldIntent {
  /** True when the request means "give me a big world". */
  wants: boolean;
  /** Which shape of wish was read (the strongest one), or null. */
  wish: LargeWorldWish | null;
  /** True when the request asks for a SMALL world on purpose — then nothing here makes it big. */
  smallOnPurpose: boolean;
  /** The words that carried the wish, for the build report. */
  evidence: string;
}

// Tokens are letters, digits and combining marks, so Devanagari words survive (\w does not see them).
const TOKEN = /[\p{L}\p{N}\p{M}]+/gu;
const tokenize = (s: string): string[] => (s.normalize('NFKC').toLowerCase().match(TOKEN) ?? []);

/** The idea of SIZE: big, long, wide — and their Hinglish and Devanagari forms. */
const BIG = new Set([
  'big', 'bigger', 'biggest', 'large', 'larger', 'largest', 'huge', 'massive', 'vast', 'giant', 'gigantic', 'enormous', 'immense',
  'wide', 'wider', 'long', 'longer', 'longest', 'expansive', 'sprawling', 'humongous',
  'bada', 'bade', 'badi', 'bado', 'bara', 'bari', 'bare', 'badaa', 'vishal', 'vishaal', 'lamba', 'lambi', 'lambe', 'lamba', 'vistrit',
  'vyapak', 'chauda', 'chaudi', 'khula', 'khuli',
  'बड़ा', 'बड़ी', 'बड़े', 'बडा', 'बडी', 'बडे', 'विशाल', 'लंबा', 'लंबी', 'लंबे', 'लम्बा', 'लम्बी', 'लम्बे', 'विस्तृत', 'चौड़ा', 'चौड़ी', 'खुला', 'खुली',
]);

/** The idea of a SPACE the player is in: map, world, land, road, journey. */
const SPACE = new Set([
  'map', 'maps', 'world', 'worlds', 'land', 'terrain', 'area', 'region', 'island', 'city', 'town', 'country', 'continent', 'arena',
  'ground', 'field', 'race', 'races', 'racing', 'drive', 'driving', 'road', 'roads', 'track', 'tracks', 'highway', 'route', 'path', 'course', 'circuit', 'journey', 'level', 'environment',
  'duniya', 'dunia', 'duniyaa', 'zameen', 'zamin', 'jamin', 'jameen', 'jagah', 'jagha', 'ilaka', 'ilaaka', 'shahar', 'shehar', 'gaon',
  'maidan', 'maidaan', 'sadak', 'sadke', 'sadkein', 'raasta', 'rasta', 'raste', 'raaste', 'safar', 'naksha', 'nakshaa', 'nakshe', 'desh',
  'मैप', 'दुनिया', 'ज़मीन', 'जमीन', 'इलाका', 'इलाक़ा', 'जगह', 'शहर', 'गाँव', 'गांव', 'मैदान', 'सड़क', 'सडक', 'रास्ता', 'रास्ते', 'सफर', 'सफ़र',
  'नक्शा', 'नक्शे', 'ट्रैक', 'रोड', 'वर्ल्ड', 'देश', 'रेस',
]);

/** The idea of SMALL. */
const SMALL = new Set([
  'small', 'smaller', 'tiny', 'little', 'mini', 'compact', 'short', 'shorter', 'cramped', 'narrow',
  'chhota', 'chota', 'chhoti', 'choti', 'chhote', 'chote', 'chhotaa', 'tang',
  'छोटा', 'छोटी', 'छोटे', 'तंग',
]);

/** Words that turn a size word into "MORE of it" ("aur bada", "make it bigger", "badhao"). */
const GROW_VERB = /\b(?:bada|bade|badi|lamba|lambi)\s+(?:karo|kardo|kar\s+do|kijiye|kariye|banao|bana\s+do|kar\s+dijiye)\b|\b(?:badhao|badhaao|badha\s+do|badhaa\s+do|badhaiye|expand|enlarge|extend|increase|widen|lengthen)\b|\bmake\s+(?:it|the\s+\w+|this\s+\w+)\s+(?:much\s+)?(?:bigger|larger|longer|wider)\b|बढ़ाओ|बढ़ा\s*दो|बड़ा\s*करो|लंबा\s*करो/iu;

/** "Is too small / ends too soon" — a complaint, which is a wish for more. */
const COMPLAINT = /\b(?:bahut|bohot|bahot|kaafi|itna|itni|bht|very|too|so|really|quite)\s+(?:hi\s+)?(?:chhota|chota|chhoti|choti|small|tiny|short)\b|\b(?:chhota|chota|chhoti|choti|small|tiny|short)\s+(?:sa|si|se\s+)?(?:hai|he|h|hain|lagta|lagti|lag\s+raha|lag\s+rahi|ho\s+gaya|ho\s+gayi|ban\s+raha|ban\s+rahi|banta|banti|is|was|feels|looks)\b|\b(?:jaldi|turant|10|12|das|baarah|barah)\s+(?:\w+\s+){0,3}(?:khatam|khtm|end|finish)\b|\b(?:ends?|finishes|runs\s+out)\s+(?:too\s+)?(?:quickly|soon|fast|early)\b|बहुत\s*छोटा|छोटा\s*(?:है|लगता|बनता)|जल्दी\s*खत्म/iu;

/** The player may go anywhere: free roam / explore. */
const FREE_ROAM = /\b(?:kahin|kahi|kahiin|kahee|kidhar)\s+bhi\s+(?:\w+\s+){0,2}(?:ja|jaa|jaye|jaaye|ghoom|ghum|ghoomo|ghumo|chal|chala|chalao|ud|uda|daud|drive)\w*|\b(?:jahan|jaha|jidhar)\s+(?:bhi\s+)?(?:chahe|chaahe|chahu|chahun|mann|man\s+kare|marzi)\b|\bghoom\s*(?:sake|sakun|sakoon|sakte|sakta|sakti|paye|paaye|na|ne|o|iye)\b|\bghum\s*(?:sake|sakun|sakte|na|ne)\b|\bghoomne\b|\bghumne\b|\bfree[\s-]?roam\w*|\broam\w*\s+(?:freely|anywhere|around)\b|\bgo\s+anywhere\b|\bexplor(?:e|ing|ation|able)\b|\bwherever\s+(?:you|i|they|the\s+player)\b|\bopen[\s-]?(?:world|map)\b|\bsandbox\b|कहीं\s*भी|जहाँ\s*चाहे|घूम\s*सक|घूमने|खुली\s*दुनिया/iu;

/** The space must not run out. */
const NEVER_ENDING = /\b(?:khatam|khtm|khatm|end)\s+(?:hi\s+)?(?:na|nahi|nahin|nhi|naa|mat)\s*(?:ho|hona|hoye|kare|hoga|ho\s+sake)?\b|\b(?:kabhi|kbhi)\s+(?:bhi\s+)?(?:khatam|khtm|end)\s+(?:na|nahi|nahin)\b|\bnever[\s-]?(?:ending|ends?|stops?|runs?\s+out)\b|\b(?:does\s*n[o']?t|doesnt|should\s*n[o']?t|wo\s*n[o']?t)\s+(?:ever\s+)?(?:end|stop|run\s+out)\b|\b(?:endless|infinite|unlimited|limitless|boundless|unending)\b|\bdoor\s+(?:door\s+)?tak\b|\bmiles\s+and\s+miles\b|\bkilometr?e?s?\s+(?:and|tak)\s+kilometr?e?s?\b|\blong\s+(?:drive|ride|journey|road\s+trip)\b|\blamb[aie]\s+safar\b|खत्म\s*(?:ही\s*)?(?:न|ना|नहीं)|कभी\s*खत्म\s*न|अंतहीन|अनंत|दूर\s*(?:दूर\s*)?तक/iu;

/** A distance only a big world holds. Two km or more: a single screen is a few hundred metres. */
const DISTANCE = /(\d+(?:[.,]\d+)?)\s*(?:km|kms|kilometers?|kilometres?|kilo\s*meters?|किमी|किलोमीटर)(?![\p{L}\p{N}\p{M}])/iu;

/** "Not big" / "no big map" — the size idea is refused. */
const REFUSED_BIG = /\b(?:bada|badi|bade|big|large|huge|lamba|lambi)\s+(?:\w+\s+){0,2}(?:nahi|nahin|nhi|mat|not\s+needed|na\s+ho)\b|\b(?:no|not|don'?t\s+want\s+a?)\s+(?:a\s+)?(?:very\s+)?(?:big|large|huge|long|open)\s+(?:map|world|level|road|track)\b|बड़ा\s*(?:\S{1,24}\s+){0,2}नहीं/iu;

/** Two token sets meet within `gap` tokens of each other, in either order. Returns the pair, or null. */
function near(tokens: readonly string[], a: ReadonlySet<string>, b: ReadonlySet<string>, gap: number): string | null {
  for (let i = 0; i < tokens.length; i++) {
    if (!a.has(tokens[i])) continue;
    for (let j = Math.max(0, i - gap); j <= Math.min(tokens.length - 1, i + gap); j++) {
      if (j !== i && b.has(tokens[j])) return i < j ? `${tokens[i]} … ${tokens[j]}` : `${tokens[j]} … ${tokens[i]}`;
    }
  }
  return null;
}

/** A journey: something the player drives, rides or flies. "Door tak gaadi chalaun" is about distance. */
const JOURNEY = /\b(?:gaadi|gadi|gaari|car|cars|truck|bike|bus|train|plane|jet|boat|cycle|chala\w*|drive|drives|driving|ride|riding|fly|flying|udaa\w*|uda\w*|travel\w*)\b|गाड़ी|गाडी|चला|उड़ा|ट्रक|बस|ट्रेन/iu;

const NONE: LargeWorldIntent = { wants: false, wish: null, smallOnPurpose: false, evidence: '' };

/**
 * Read whether a request means "a big world". The order of the checks is the order of strength: an explicit
 * refusal or a small-on-purpose request wins, then a complaint (the user is looking at a small world now), then
 * a distance, a big space, never-ending, and free roam.
 */
export function largeWorldIntent(prompt: string | null | undefined): LargeWorldIntent {
  try {
    const raw = String(prompt ?? '').slice(0, 20_000);
    if (!raw.trim()) return NONE;
    const text = raw.normalize('NFKC');
    const tokens = tokenize(text);
    const hasSpace = tokens.some((t) => SPACE.has(t));

    if (REFUSED_BIG.test(text)) return { ...NONE, smallOnPurpose: true, evidence: (REFUSED_BIG.exec(text)?.[0] ?? '').trim() };

    // A complaint about size, or an order to grow it, about a space: the user wants MORE.
    const complaint = COMPLAINT.exec(text);
    const grow = GROW_VERB.exec(text);
    if (hasSpace && (complaint || grow)) {
      return { wants: true, wish: 'too-small', smallOnPurpose: false, evidence: ((complaint ?? grow)?.[0] ?? '').trim() };
    }

    // "chhota map banao" / "a tiny arena": small on purpose, unless a complaint was read above.
    const small = near(tokens, SMALL, SPACE, 2);
    const big = near(tokens, BIG, SPACE, 3);
    if (small && !big) return { ...NONE, smallOnPurpose: true, evidence: small };

    const distance = DISTANCE.exec(text);
    if (distance && Number(distance[1].replace(',', '.')) >= 2) {
      return { wants: true, wish: 'distance', smallOnPurpose: false, evidence: distance[0].trim() };
    }
    if (big) return { wants: true, wish: 'big-space', smallOnPurpose: false, evidence: big };

    // "Never ends" says something about a world only when a space or a journey is in the sentence: "game kabhi
    // band na ho" is about crashes, and an endless RUNNER is a lane, not a world (the caller decides the genre).
    const endless = NEVER_ENDING.exec(text);
    if (endless && (hasSpace || JOURNEY.test(text))) return { wants: true, wish: 'never-ending', smallOnPurpose: false, evidence: endless[0].trim() };

    const roam = FREE_ROAM.exec(text);
    if (roam) return { wants: true, wish: 'free-roam', smallOnPurpose: false, evidence: roam[0].trim() };

    return NONE;
  } catch {
    return NONE;
  }
}

/** One line for the build report. */
export function largeWorldIntentLine(intent: LargeWorldIntent): string {
  if (!intent.wants) return intent.smallOnPurpose ? `The request asks for a small world ("${intent.evidence}").` : 'The request does not ask for a big world.';
  const what: Record<LargeWorldWish, string> = {
    'big-space': 'asks for a big space',
    'free-roam': 'wants to go anywhere',
    'never-ending': 'wants a space that never runs out',
    'too-small': 'says the world is too small',
    distance: 'names a distance only a big world holds',
  };
  return `The request ${what[intent.wish!]} ("${intent.evidence}"), so the game gets a big world.`;
}
