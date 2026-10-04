// EVERY PERSON NAVBHARATAI DRAWS IS INDIAN — unless the user named somebody else (admin 2026-09-30).
//
// Admin, verbatim: *"jab bhi koi face bane to woh bhi chinis face banta hai. ladka ladki koi bhi, hame
// indian face chahiye! jab bhi koi human image banayi jaye to default indian face hi banna chahiye
// (100% indian) jab tak specific bola na jaye kisi aur face ke bare me."*
//
// 🔑 THE CAUSE WAS OUR PROMPT, NOT THE ENGINE. "a boy", "girl portrait", "a doctor" reached the image
// model with nothing about who the person is, so the model filled the gap with its own default — and
// the free model's default face is East Asian far more often than Indian. A model does exactly what
// it is told and guesses the rest; we were leaving the one thing an Indian product must never leave
// to a guess. So the rule is written into the brief, every time a person is in it.
//
// 🔒 THE USER'S OWN WORDS STILL WIN — the same principle as the rest of the craft layer. A request that
// NAMES an origin ("a Japanese chef", "an African dancer", "a European tourist", "diverse team") is
// left exactly as written: the default fills a silence, it never overrules an answer.
//
// ⚠️ PRECISION OVER RECALL, and the asymmetry is the reason. Missing a person costs one picture that
// comes out like it does today; wrongly adding "an Indian person" to a product shot, a cat's face or a
// face-wash bottle puts a stranger into a picture nobody asked to have one in. So ambiguous words
// ("model", "log", "beta", "developer", bare "portrait") are left out on purpose, and "face" does not
// count when it belongs to an animal, a clock or a product.
//
// PURE — no env, no I/O. The craft layer is its only caller, and every image the generator makes —
// every rung — passes through the craft layer.

/** Words that put a PERSON in the picture. English, Hinglish (romanised) and Devanagari. */
const PEOPLE_WORDS: readonly string[] = [
  // English — people in general
  'person', 'persons', 'people', 'human', 'humans', 'man', 'men', 'woman', 'women', 'boy', 'boys', 'girl', 'girls',
  'guy', 'guys', 'lady', 'ladies', 'gentleman', 'gentlemen', 'kid', 'kids', 'child', 'children', 'baby', 'babies',
  'toddler', 'toddlers', 'teen', 'teens', 'teenager', 'teenagers', 'youth', 'crowd', 'family', 'families', 'couple',
  'couples', 'selfie', 'headshot', 'faces', 'face',
  // English — family and relations
  'father', 'mother', 'dad', 'mom', 'mum', 'parents', 'grandfather', 'grandmother', 'grandpa', 'grandma', 'granny',
  'son', 'daughter', 'brother', 'sister', 'husband', 'wife', 'bride', 'groom', 'friend', 'friends', 'uncle', 'aunty', 'auntie',
  // English — roles a person is drawn as
  'student', 'students', 'teacher', 'teachers', 'doctor', 'doctors', 'nurse', 'nurses', 'farmer', 'farmers',
  'shopkeeper', 'shopkeepers', 'labourer', 'laborer', 'businessman', 'businessmen',
  'businesswoman', 'businesswomen', 'employee', 'employees', 'customer', 'customers', 'patient', 'patients',
  'athlete', 'athletes', 'cricketer', 'cricketers', 'footballer', 'dancer', 'dancers', 'singer', 'singers', 'chef',
  'chefs', 'policeman', 'policewoman', 'police officer', 'soldier', 'soldiers', 'engineer', 'engineers', 'scientist',
  'scientists', 'villager', 'villagers', 'priest', 'pandit', 'sadhu', 'monk', 'princess', 'warrior', 'warriors',
  'influencer', 'vlogger', 'youtuber', 'entrepreneur', 'lawyer', 'tailor', 'barber', 'mechanic', 'musician',
  // ⚠️ Left out on purpose: player (a media player icon), worker (a service worker), cook (a cook book),
  // seller (best seller), driver / pilot / officer / artist / king / queen — each is a product or a
  // thing as often as a person, and a false "yes" puts a stranger into a picture of an object.
  // Hinglish (romanised)
  'ladka', 'ladki', 'ladke', 'ladkiyan', 'ladkiyaan', 'aadmi', 'admi', 'aurat', 'auratein', 'aurten', 'mahila',
  'purush', 'bachcha', 'bacha', 'bachche', 'bache', 'bachchi', 'bachi', 'insaan', 'insan', 'dadi', 'dada', 'nani',
  'nana', 'maa', 'papa', 'mummy', 'dulha', 'dulhan', 'kisan', 'chehra', 'chehre', 'beti', 'bhai', 'behen', 'bahan',
  'didi', 'bhaiya', 'dost',
];

/** Devanagari has no word spaces the same way — matched as substrings. */
const PEOPLE_SUBSTRINGS: readonly string[] = [
  'लड़का', 'लड़की', 'लड़के', 'आदमी', 'औरत', 'महिला', 'पुरुष', 'बच्चा', 'बच्ची', 'बच्चे', 'इंसान', 'चेहरा',
  'किसान', 'दुल्हन', 'दूल्हा', 'व्यक्ति', 'लोग', 'परिवार',
];

/**
 * A "face" that is not a person's. Precision-first: these are the ones that would otherwise put a
 * stranger into a picture of a cat, a clock or a jar of cream.
 */
const NON_HUMAN_BEFORE_FACE =
  'cat|kitten|dog|puppy|animal|lion|tiger|monkey|bear|panda|fox|owl|horse|cow|rabbit|bird|robot|clock|watch|'
  + 'emoji|smiley|cartoon|doll|teddy|pumpkin|moon|sun|rock|cliff|mountain|building|cube|coin|card';
const PRODUCT_AFTER_FACE =
  'mask|masks|wash|cream|creams|serum|serums|pack|packs|scrub|oil|powder|id|off|palm|paint|shield|value|card|cards|down|up';

/**
 * The user NAMED an origin — so the default must not speak. Nationalities, regions, and the ordinary
 * ways a person asks for a mix ("diverse", "different races").
 *
 * ⚠️ "South Asian" is Indian-compatible and is deliberately NOT here; "Asian" on its own is.
 * ⚠️ "white" / "black" count only next to a person word — "black dress" and "white background" are
 * colours, not origins.
 */
const OTHER_ORIGIN_WORDS: readonly string[] = [
  'chinese', 'japanese', 'korean', 'thai', 'vietnamese', 'filipino', 'filipina', 'indonesian', 'malaysian',
  'singaporean', 'mongolian', 'tibetan', 'nepali', 'nepalese', 'bhutanese', 'sri\\s+lankan', 'sinhalese',
  'bangladeshi', 'pakistani', 'afghan', 'iranian', 'persian', 'arab', 'emirati', 'saudi', 'turkish',
  'egyptian', 'african', 'nigerian', 'kenyan', 'ethiopian', 'somali', 'ghanaian', 'american', 'canadian',
  'mexican', 'latino', 'latina', 'latinx', 'hispanic', 'brazilian', 'argentinian', 'argentine', 'colombian',
  'peruvian', 'chilean', 'cuban', 'jamaican', 'european', 'british', 'irish', 'scottish', 'welsh', 'french',
  'german', 'italian', 'spanish', 'portuguese', 'dutch', 'swedish', 'norwegian', 'danish', 'finnish', 'russian',
  'ukrainian', 'polish', 'greek', 'australian', 'caucasian', 'jewish', 'israeli', 'hawaiian', 'native\\s+american',
  'maori', 'aboriginal', 'inuit', 'scandinavian', 'nordic', 'slavic', 'westerner', 'westerners', 'foreigner',
  'foreigners', 'videshi', 'angrez', 'angrezi\\s+(?:aadmi|ladki|ladka|aurat)', 'gora', 'gori', 'firangi',
  'asian', 'east\\s+asian', 'oriental',
  'diverse', 'diversity', 'multicultural', 'multi-?ethnic', 'multiracial', 'mixed[-\\s]race',
  '(?:different|various|all)\\s+(?:races|ethnicities|nationalities|countries)', 'international\\s+(?:team|people|group)',
  '(?:white|black)\\s+(?:man|men|woman|women|person|people|guy|guys|girl|girls|boy|boys|lady|ladies|kid|kids|child|children|skin|skinned|family|couple)',
  '(?:white|black)-skinned', 'blonde?', 'redhead', 'red-haired', 'blue\\s+eyes', 'blue-eyed',
];

/**
 * A person who is not a real human, or a character whose look is fixed by who they are. Adding
 * "Indian" to Spider-Man, a robot or a zombie would argue with the request.
 */
const NOT_A_REAL_PERSON: readonly string[] = [
  'robot', 'robots', 'cyborg', 'android\\s+(?:robot|humanoid)', 'humanoid', 'alien', 'aliens', 'zombie', 'zombies',
  'skeleton', 'mannequin', 'statue', 'snowman', 'stick\\s+figure', 'emoji', 'spider[-\\s]?man', 'iron\\s+man',
  'superman', 'batman', 'hulk', 'mickey', 'minion', 'minions', 'smurf',
];

/**
 * ⚠️ NO LOOKBEHIND ANYWHERE IN THIS FILE (Q-322). It is bundled into the Image Generator screen, and
 * Safari before 16.4 (iOS 15 – 16.3) throws on a lookbehind when the regex is built — at module load,
 * so the whole screen failed to open. The word start is a CONSUMING non-letter instead; every regex
 * here is only ever asked `.test()`, so what the start consumes is never read.
 */
function bounded(terms: readonly string[]): RegExp {
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${terms.join('|')})(?![\\p{L}\\p{N}])`, 'iu');
}

const PEOPLE_RE = bounded(PEOPLE_WORDS.filter((w) => w !== 'face'));
/** "face" as a word, not followed by a product noun ("face wash", "face mask"). */
const FACE_WORD_RE = new RegExp(
  `(?:^|[^\\p{L}\\p{N}])face(?![\\p{L}\\p{N}])(?!\\s+(?:${PRODUCT_AFTER_FACE})(?![\\p{L}\\p{N}]))`,
  'giu',
);
/** The text just before a "face" that makes it a cat's face or a clock's face, not a person's. */
const NON_HUMAN_OWNER_RE = new RegExp(`(?:${NON_HUMAN_BEFORE_FACE})['’]?s?\\s$`, 'iu');
/** "south asian" is Indian-compatible: it is removed before the origin words are read. */
const SOUTH_ASIAN_RE = /south[\s-]asian/giu;
const OTHER_ORIGIN_RE = bounded(OTHER_ORIGIN_WORDS);
const NOT_A_REAL_PERSON_RE = bounded(NOT_A_REAL_PERSON);

/** A person's "face": the word itself, and not a cat's, a clock's or a face-wash bottle's. */
function namesAPersonsFace(p: string): boolean {
  for (const m of p.matchAll(FACE_WORD_RE)) {
    const faceAt = (m.index ?? 0) + m[0].length - 'face'.length;
    if (!NON_HUMAN_OWNER_RE.test(p.slice(0, faceAt))) return true;
  }
  return false;
}

/** Does this brief put a PERSON in the picture? PURE. */
export function depictsPeople(prompt: string | null | undefined): boolean {
  const p = String(prompt ?? '').normalize('NFKC');
  if (!p.trim()) return false;
  if (PEOPLE_RE.test(p) || namesAPersonsFace(p)) return true;
  return PEOPLE_SUBSTRINGS.some((w) => p.includes(w));
}

/** Did the user name an origin, a mix, or a character whose look is not ours to choose? PURE. */
export function namesOtherOrigin(prompt: string | null | undefined): boolean {
  const p = String(prompt ?? '').normalize('NFKC').replace(SOUTH_ASIAN_RE, ' ');
  return OTHER_ORIGIN_RE.test(p) || NOT_A_REAL_PERSON_RE.test(p);
}

/**
 * The direction itself. Plain words a diffusion model weighs well: WHO (Indian, from India), and the
 * two things that decide whether a face reads as Indian — features and skin tone.
 */
export const INDIAN_PEOPLE_DIRECTION =
  'Every person in the image is Indian — a real person from India, with authentic Indian (South Asian) '
  + 'facial features and a natural Indian skin tone.';

/**
 * 🔑 THE SAME RULE, PHRASED SO IT CANNOT INVENT A PERSON (admin 2026-10-01, verbatim: *"jab tak
 * specific kaha na jaye, tab tak indian face banane chahiye … result me 100% indian human ana
 * chahiye … yeh un breckbale rule hai"*).
 *
 * THE DEFECT THIS CLOSES, and it is a RECALL defect, not a wording one. `depictsPeople` is a word
 * list, and that list deliberately LEAVES OUT the commonest words in a real Indian picture request —
 * `worker`, `driver`, `cook`, `seller`, `player`, `officer`, `artist`, `model`, a bare `portrait` —
 * because each is a product or a thing as often as a person ("service worker", "media player", "best
 * seller", "3D model"), and the EMPHATIC sentence above would then put a stranger into a picture of
 * an object. So "delivery worker in a mask" reached the engine with nothing about who the person is,
 * and the model filled the gap with its own default face. That is the admin's screenshot.
 *
 * Widening the list is whack-a-mole: every new word needs its own exception, and the next report
 * finds the word nobody thought of. The CONDITIONAL form removes the reason the list had to be narrow
 * at all — "IF any person appears" constrains a person who is already there and can never add one, so
 * it is safe on a cat, a face-wash bottle, a dashboard and an empty logo brief alike. It therefore
 * goes on EVERY brief the user has not already answered, and the word list stops being a gate on
 * coverage: it only decides which of the two wordings is used.
 */
export const INDIAN_PEOPLE_CONDITIONAL =
  'If any person appears in this image, they are Indian — a real person from India, with authentic '
  + 'Indian (South Asian) facial features and a natural Indian skin tone, never any other ethnicity.';

/**
 * The NEGATIVE half — the one that was missing entirely (admin: *"clear 'indian face cut' likh kar
 * bhejo"*).
 *
 * A positive sentence alone loses to a diffusion model's own face prior, which is exactly what the
 * reports show: the direction was in the prompt and the face still came out East Asian. A negative is
 * weighed on a different axis, so the two together are far stronger than either. Kept SHORT on
 * purpose — this module's own history records a suspicion that long inline negatives cost sharpness,
 * and these five items are the ones the failures were actually made of.
 *
 * ⚠️ Inert where there is no face: a negative for a concept the picture does not contain changes
 * nothing, which is what lets it ride along with the conditional direction on every brief.
 */
export const INDIAN_PEOPLE_NEGATIVE =
  'east asian face, chinese facial features, korean facial features, japanese facial features, '
  + 'white or european face';

/** Should the EMPHATIC direction speak for this brief — i.e. is a person actually named? PURE. */
export function wantsIndianPeopleDefault(prompt: string | null | undefined): boolean {
  return depictsPeople(prompt) && !namesOtherOrigin(prompt);
}

/** What the craft layer should add for this brief, or null when the user's own words answered it. */
export interface IndianPeopleDirective {
  /** The sentence to put straight after the subject. */
  direction: string;
  /** What to add to the brief's negatives. */
  negative: string;
  /** A person is NAMED in the brief (the emphatic wording), rather than merely possible. */
  named: boolean;
}

/**
 * THE ONE DECISION. Returns null ONLY when the user named somebody else — their words always win,
 * which is the half of this rule that has never changed.
 *
 * `emphaticAllowed` is false for a UI screenshot and a background, where a word like "student" or
 * "patient" names a DOMAIN rather than a person. Those briefs still get the CONDITIONAL sentence —
 * which is strictly more than they got before, and still cannot invite a stranger into a dashboard.
 *
 * PURE.
 */
export function indianPeopleDirective(
  prompt: string | null | undefined,
  opts: { emphaticAllowed?: boolean } = {},
): IndianPeopleDirective | null {
  if (namesOtherOrigin(prompt)) return null;
  const named = depictsPeople(prompt) && opts.emphaticAllowed !== false;
  return {
    direction: named ? INDIAN_PEOPLE_DIRECTION : INDIAN_PEOPLE_CONDITIONAL,
    negative: INDIAN_PEOPLE_NEGATIVE,
    named,
  };
}
