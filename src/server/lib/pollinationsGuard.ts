// The word scan every prompt passes BEFORE it is sent to the free image provider (Pollinations).
//
// 🔴 WHY THIS EXISTS — Google Play rejected the Android update on 2026-09-28 under the Sexual Content
// and Profanity + AI-Generated Content policies, and attached the evidence: a screenshot of "Image
// Generator AI FREE" in the "Photograph" style showing a realistic nude woman. Two gaps met there:
//
//   1. The platform's own triage (`triagePrompt` → `ADULT_CONTENT`) is written for APP-building
//      prompts. It waits for a pair — a porn noun AND "site / app / stream" — so a picture request has
//      no second half to match. Measured on the real function before this change: `nude woman`,
//      `naked girl on beach`, `topless woman` and even the bare word `porn` all returned ALLOW.
//      The CLAUDE.md line "missing a cleverly-worded request costs one model refusal, which already
//      works" is true of a chat model and FALSE of this image model: it does not refuse, it draws.
//   2. The provider's anonymous link has its own NSFW filter OFF unless `safe=true` is sent, and it
//      was not sent.
//
// So this module is the image-specific answer the admin asked for (2026-09-28, verbatim: "pollination
// ai ki api call se pahle ek scanning ki jaye! aur sensitive words par ban lagao! sirf pollination ai
// ke liye"). It is DELIBERATELY scoped to the Pollinations call: chat and build keep their own,
// precision-first triage, because a chat about sexual health or a build of a harassment-reporting
// tool must not be refused for naming what it is about. A PICTURE is different — the words describe
// what will be drawn, and "nude" in an image prompt has no innocent reading the drawing would respect.
//
// 🔒 THE CHOKE POINT IS THE URL BUILDER. `pollinationsImageUrl` calls `assertPollinationsPromptSafe`,
// so no code path — the image screen, the browser-fetch link, free chat's inline image, or one written
// next year — can build a link for a banned prompt. Callers ALSO scan first, so the user gets a clear
// refusal instead of an error; the assertion is the net under them, not the only line.
//
// ⚠️ A WORD LIST IS NOT A CLASSIFIER, and this one is not the only layer: `safe=true` on the link asks
// the provider to refuse NSFW output too. The list catches what the user ASKED for; the provider's
// filter catches what the model drew anyway. Neither is relied on alone.
//
// PURE module: no I/O, no model call, ₹0.

/** Why a prompt was refused. Admin-facing only; the user sees `POLLINATIONS_BLOCK_MESSAGE`. */
export type PollinationsBlockCategory = 'sexual' | 'profanity';

export type PollinationsScan =
  | { ok: true }
  | { ok: false; category: PollinationsBlockCategory; term: string };

/**
 * What the user is told. Branded (the White-Label Law: no provider name), names no word and no rule,
 * and says what to do next. English, per the language standard for NavBharatAI's own UI text.
 */
export const POLLINATIONS_BLOCK_MESSAGE =
  'NavBharatAI does not create nude, sexual or vulgar pictures. Please describe a different image.';

/** Thrown by the URL builder when a banned prompt reaches it — a bug in a caller, never a user path. */
export class PollinationsPromptBlockedError extends Error {
  readonly category: PollinationsBlockCategory;
  constructor(category: PollinationsBlockCategory) {
    super(`pollinations prompt blocked (${category})`);
    this.name = 'PollinationsPromptBlockedError';
    this.category = category;
  }
}

/**
 * ═══ THE LISTS ═══ (admin 2026-09-28: "ek list banao, lambi list — India ki sabhi bhashaon me, English
 * me, aur duniya ki sabhi bhashaon me jiska matlab sexual content se hai — Pollinations tak jayen hi
 * nahi"). Two engines read them, because scripts differ in how a "word" can be found:
 *
 *  • BOUNDED terms (Latin, Cyrillic, Greek scripts) match only as WHOLE words, after folding accents
 *    away (`desnúda` → `desnuda`, `obnažённая` → `obnazhennaya`-style folds are NOT done; Cyrillic is
 *    matched in Cyrillic). "class", "button", "Essex", "sextant", "Sussex" are therefore untouched.
 *    Entries are regex SOURCE fragments; `\p{L}*` means "any word ending".
 *  • SUBSTRING terms (Indic scripts, Arabic, Persian, Urdu, Hebrew, Chinese, Japanese, Korean, Thai)
 *    match anywhere, because these scripts either have no spaces or attach prefixes to words. So every
 *    one of them must be long and specific enough that no ordinary word CONTAINS it.
 *
 * 🔒 THE PRECISION RULE: a term is left OUT when an ordinary picture request uses it innocently, and
 * the reason is written next to it below. Missing one disguised request still has a second net
 * (`safe=true`, the provider's own filter); refusing a shop banner has none.
 *   English: breast (chicken breast, breast-cancer poster) · cock (rooster) · dick (a name) · pussy
 *     (a cat) · strip (comic/LED strip) · hot (hot tea) · bath/shower (bathroom showroom) · swimsuit
 *     (sports shop — but see the MINORS rule) · lust… (lustrous hair) · shit… (shiitake) ·
 *     twerk/pole dance (dance classes).
 *   Hinglish: chod… ("chhod do" is often typed "chod do") · chut ("chhut" = discount).
 *   Hindi: ब्रा (it is inside ब्राह्मण) · स्तन (breast-cancer awareness) · लिंग (also "gender") · योनि (religious).
 *   Arabic: جنس / جنسي (also "gender / nationality" — جنسية is on every ID form).
 *   Chinese/Japanese: single characters such as 色 (colour) and 裸 (inside 裸足, "barefoot").
 *   Korean: 가슴 (also "heart", as in a racing heart). Thai: นม (milk).
 *   Danish/Norwegian: nøgen folds to "nogen" = "someone". Portuguese: pelada (a football kick-about).
 *   Spanish: coger (to take), nudo (a knot). French: baiser (a kiss). Turkish: meme (also a meme).
 *   Names and places: Naga (Nagaland, the serpent), Nagda (a town in MP), Vasna (Ahmedabad), Sunni
 *   (the Muslim community), Nagi/Nago. Everyday words: tanga (a horse-cart), lode (mother lode),
 *   гол/гола (Russian "goal"), goală (Romanian "empty"), puting (Tagalog "white"), uchi (Japanese
 *   "home"), 벗은 (Korean "took off", a hat), বাল (inside বালক "boy", বালি "sand"), くそ (inside
 *   やくそく "promise"), لخت (Persian "a moment").
 *   Unverified romanised South-Indian slang was left out rather than guessed at.
 *   The MINORS rule deliberately does not pair a child with bed / bedroom / bath / shower / pose:
 *   "kids bedroom design", "baby shower card" and "baby bath tub" are ordinary shop requests.
 */

const BOUNDED_SEXUAL: readonly string[] = [
  // ── English: nudity ──
  'nude', 'nudes', 'nudie', 'nudity', 'nudist\\p{L}*', 'naked', 'topless', 'bottomless', 'undress(?:ed|ing|es)?',
  'unclothed', 'disrob\\p{L}*', 'bare[-\\s]?(?:breasts?|chested\\s+(?:woman|women|girl|girls|lady))',
  '(?:no|without|zero)\\s+(?:clothes|clothing|dress|dresses|kapde|kapda|kapdon|kapdo)', 'wearing\\s+nothing',
  'in\\s+the\\s+buff', 'birthday\\s+suit', 'skinny[-\\s]?dipping', 'see[-\\s]?through',
  'transparent\\s+(?:clothes|dress|top|shirt|saree|sari|bra|blouse)', 'wardrobe\\s+malfunction', 'nip\\s?slip',
  'upskirt', 'downblouse', 'camel\\s?toe', 'wet\\s+t[-\\s]?shirt',
  // ── English: explicit / pornographic ──
  'porn\\p{L}*', 'pr0n', 'xxx', 'nsfw', 'r18', 'r-18', 'hentai', 'ecchi', 'ahegao', 'futanari', 'rule\\s?34',
  'onlyfans', 'erotic\\p{L}*', 'erotica', 'sex', 'sexy', 'sexi', 'sexual\\p{L}*', 'sexting', 'sext',
  'sensual\\p{L}*', 'seduc\\p{L}*', 'provocative', 'lewd', 'lust', 'lustful', 'lusty', 'horny', 'aroused',
  'orgasm\\p{L}*', 'orgy', 'orgies', 'threesome', 'gangbang', 'fetish\\p{L}*', 'bdsm', 'bondage', 'kinky',
  'masturbat\\p{L}*', 'blowjob\\p{L}*', 'handjob\\p{L}*', 'cumshot\\p{L}*', 'creampie', 'ejaculat\\p{L}*', 'erection',
  'intercourse', 'kamasutra', 'kama\\s+sutra', 'dildo\\p{L}*', 'sex\\s?toys?', 'vibrator', 'milf', 'gilf',
  'stripper\\p{L}*', 'striptease', 'strip\\s+club', 'lap\\s?dance', 'playboy', 'penthouse\\s+pet', 'centerfold',
  'pin[-\\s]?up\\s+(?:girl|model)', 'camgirl\\p{L}*', 'cam\\s?girl', 'escort\\s+(?:girl|service)', 'call\\s?girl\\p{L}*',
  'hooker\\p{L}*', 'prostitut\\p{L}*', 'brothel\\p{L}*', 'harlot', 'voyeur\\p{L}*', 'peeping\\s+tom',
  // ── English: sexual violence and minors — refused outright, whatever else the prompt says ──
  'rape', 'raped', 'raping', 'rapist', 'molest\\p{L}*', 'incest\\p{L}*', 'pedo\\p{L}*', 'paedo\\p{L}*', 'lolita',
  'loli', 'lolicon', 'shota\\p{L}*', 'jailbait', 'child\\s+porn\\p{L}*', 'cp\\s+(?:pic|pics|image|images)',
  // ── English: minimal clothing / underwear ──
  'lingerie', 'underwear', 'undergarment\\p{L}*', 'bra', 'bras', 'brassiere', 'panty', 'panties', 'knickers', 'thong',
  'g[-\\s]?string', 'bikini\\p{L}*', 'micro[-\\s]?bikini', 'negligee', 'babydoll\\s+(?:dress|lingerie)',
  // ── English: body parts named sexually ──
  'boob\\p{L}*', 'tits', 'titt(?:y|ies)', 'nipples?', 'areolae?', 'cleavage', 'buttocks', 'booty', 'butt\\s?cheeks?',
  'genitals?', 'genitalia', 'penis\\p{L}*', 'phallus', 'vagina\\p{L}*', 'vulva', 'labia', 'clitoris', 'clit',
  'scrotum', 'testicles?', 'crotch', 'pubic',
  // ── English: suggestive phrasing that turns an ordinary word sexual ──
  'hot\\s+(?:girl|girls|woman|women|lady|ladies|babe|babes|chick|chicks|bhabhi|aunty|aunties)',
  '(?:girl|girls|woman|women|lady|ladies|man|men|boy|boys|couple)\\s+(?:in|taking|having)\\s+(?:a\\s+|the\\s+)?(?:shower|bath|bathtub)',
  '(?:girl|girls|woman|women|lady|ladies|couple)\\s+in\\s+(?:bed|bedroom)', 'bedroom\\s+(?:pose|scene|photo)',
  '(?:sexy|seductive|sensual|provocative|suggestive)\\s+pose', 'suggestive',
  // ── Hinglish / romanised Indian languages ──
  'nangi', 'nanga', 'nange', 'nangapan', 'nagn', 'nagna', 'nagnata', 'bina\\s+kapd\\p{L}*', 'kapd\\p{L}*\\s+ke\\s+bina',
  'kapd\\p{L}*\\s+(?:utaa?r|utha)\\p{L}*', 'chudai', 'chodai', 'chodna', 'chudna', 'chudwa\\p{L}*', 'randi', 'raand',
  'sambhog', 'ashleel', 'ashlil', 'kaamuk', 'kamuk', 'choochi', 'chuchi', 'chuchiyan', 'garam\\s+ladki',
  'sexy\\s+ladki', 'sexy\\s+bhabhi', 'desi\\s+bhabhi', 'mms\\s+video', 'nanga\\s+nach',
  'pundai', 'koothi', 'dengu', 'modda', 'puku',
  // ── Spanish ──
  'desnud\\p{L}*', 'sin\\s+ropa', 'sexo', 'sexual', 'pornograf\\p{L}*', 'porno', 'eroti\\p{L}*', 'tetas', 'teta', 'pezon\\p{L}*',
  'lenceria', 'puta', 'putas', 'follar', 'prostitut\\p{L}*', 'encuerad\\p{L}*', 'caliente\\s+(?:chica|mujer)',
  // ── Portuguese ──
  'nua', 'nuas', 'nudez', 'sem\\s+roupa', 'peitos', 'mamilos?', 'bunda', 'calcinha', 'safada', 'putaria', 'transar', 'foder',
  // ── French ──
  'nue', 'nues', 'nudite', 'sexe', 'seins', 'tetons', 'fesses', 'sans\\s+vetements', 'erotique', 'pornographique',
  'salope', 'putain', 'culotte', 'soutien[-\\s]?gorge',
  // ── German / Dutch / Scandinavian ──
  'nackt\\p{L}*', 'nacktheit', 'erotik', 'erotisch\\p{L}*', 'bruste', 'busen', 'nippel', 'unterwasche', 'ficken', 'hure',
  'schlampe', 'oben\\s+ohne', 'naakt', 'seks', 'borsten', 'tepels', 'hoer', 'naken', 'nakna',
  // ── Italian ──
  'nuda', 'sesso', 'sessuale', 'tette', 'capezzoli', 'senza\\s+vestiti', 'puttana', 'mutandine',
  // ── Polish / Czech / Hungarian / Romanian / Finnish ──
  'nagie', 'seksu', 'erotyczn\\p{L}*', 'piersi', 'cycki', 'sutki', 'dziwka', 'nahota',
  'meztelen', 'szex', 'dezbracat\\p{L}*', 'alaston', 'seksi',
  // ── Turkish (ı folds to i) ──
  'ciplak', 'seks', 'sevisme', 'erotik', 'fahise',
  // ── Indonesian / Malay / Filipino / Swahili / Vietnamese (accents folded) ──
  'telanjang', 'bugil', 'bogel', 'payudara', 'toket', 'bokep', 'mesum', 'cabul', 'tanpa\\s+busana',
  'hubad', 'kantot', 'libog', 'ngono', 'khoa\\s+than', 'tinh\\s+duc', 'khieu\\s+dam',
];

/** Cyrillic and Greek — the same whole-word engine; ё is folded to е and Greek accents are dropped. */
const BOUNDED_SEXUAL_OTHER_SCRIPTS: readonly string[] = [
  // Russian / Ukrainian / Bulgarian / Serbian
  'голая', 'голый', 'голые', 'голой', 'обнаженн\\p{L}*', 'нагая', 'нагой', 'нагишом', 'без\\s+одежды', 'секс\\p{L}*',
  'порно\\p{L}*', 'эроти\\p{L}*', 'соски', 'сиськи', 'шлюх\\p{L}*', 'проститут\\p{L}*', 'голий', 'оголен\\p{L}*',
  'нага', 'еротика',
  // Greek
  'γυμνη', 'γυμνος', 'γυμνο', 'σεξ', 'πορνο\\p{L}*', 'ερωτικ\\p{L}*',
];

/** Scripts without word spaces, or that attach prefixes — matched as substrings of the raw text. */
const SUBSTRING_SEXUAL: readonly string[] = [
  // Hindi / Marathi / Nepali (Devanagari)
  'नंगी', 'नंगा', 'नंगे', 'नंगापन', 'नग्न', 'निर्वस्त्र', 'बिना कपड़', 'कपड़े उतार', 'सेक्स', 'सेक्सी', 'अश्लील', 'चुदाई',
  'चोदना', 'चोदा', 'रंडी', 'कामुक', 'संभोग', 'वासना', 'पोर्न', 'बिकिनी', 'चूची', 'नागडी', 'नागडा', 'नाङ्गो', 'नाङ्गी',
  'बलात्कार',
  // Bengali / Assamese
  'নগ্ন', 'নেংটা', 'উলঙ্গ', 'উলংগ', 'যৌন', 'সেক্স', 'সেক্সি', 'অশ্লীল', 'চোদা', 'মাগি', 'পর্ন', 'ধর্ষণ',
  // Gujarati
  'નગ્ન', 'નાગી', 'સેક્સ', 'અશ્લીલ', 'બીભત્સ',
  // Punjabi (Gurmukhi)
  'ਨੰਗੀ', 'ਨੰਗਾ', 'ਨਗਨ', 'ਸੈਕਸ', 'ਅਸ਼ਲੀਲ',
  // Odia
  'ଉଲଗ୍ନ', 'ନଗ୍ନ', 'ସେକ୍ସ', 'ଅଶ୍ଳୀଳ',
  // Tamil
  'நிர்வாண', 'ஆபாச', 'செக்ஸ்', 'பாலியல்', 'உடலுறவு', 'புண்டை', 'முலை', 'கற்பழிப்பு',
  // Telugu
  'నగ్న', 'బూతు', 'సెక్స్', 'అశ్లీల', 'లైంగిక', 'దెంగు', 'బట్టలు లేకుండా',
  // Kannada
  'ನಗ್ನ', 'ಬೆತ್ತಲೆ', 'ಸೆಕ್ಸ್', 'ಅಶ್ಲೀಲ', 'ಲೈಂಗಿಕ',
  // Malayalam
  'നഗ്ന', 'സെക്സ്', 'അശ്ലീല', 'ലൈംഗിക', 'തുണിയില്ലാത്ത',
  // Urdu / Persian / Arabic
  'ننگی', 'ننگا', 'سیکس', 'فحش', 'فحاشی', 'عریاں', 'چدائی', 'برهنه', 'سکس', 'پورن', 'عارية', 'عاري', 'إباحي',
  'اباحي', 'سكس', 'عاهرة', 'بدون ملابس',
  // Hebrew
  'עירום', 'עירומה', 'סקס', 'פורנו', 'ארוטי',
  // Chinese (simplified + traditional)
  '裸体', '裸體', '全裸', '裸女', '裸男', '赤裸', '裸露', '露点', '露點', '色情', '情色', '性爱', '性愛', '性交', '做爱', '做愛',
  '黄色图片', '成人视频', '比基尼', '奶子', '走光', '援交', '妓女', '自慰', '强奸', '強姦', '內衣', '内衣',
  // Japanese
  'ヌード', '裸体', '全裸', 'エロい', 'エロ画像', 'エッチ', '性行為', 'セックス', 'ポルノ', 'おっぱい', '乳首', 'ビキニ',
  'av女優', '痴漢', '売春', '下着姿',
  // Korean
  '누드', '나체', '알몸', '섹스', '야한', '포르노', '성인물', '젖꼭지', '비키니', '음란', '성행위',
  // Thai
  'เปลือย', 'โป๊', 'เซ็กซ์', 'ลามก', 'อนาจาร', 'หัวนม', 'ร่วมเพศ', 'บิกินี่',
];

/** Profanity — Google's policy is "Sexual Content AND Profanity", and a picture can carry text. */
const BOUNDED_PROFANITY: readonly string[] = [
  'fuck\\p{L}*', 'motherfuck\\p{L}*', 'f[*u]ck', 'shit', 'shitty', 'bullshit', 'bitch\\p{L}*', 'cunt\\p{L}*', 'whore\\p{L}*',
  'slut\\p{L}*', 'bastard\\p{L}*', 'asshole\\p{L}*', 'wanker\\p{L}*',
  'madarchod\\p{L}*', 'maderchod\\p{L}*', 'behenchod\\p{L}*', 'bhenchod\\p{L}*', 'bhenchodd?', 'chutiy\\p{L}*', 'chutia\\p{L}*',
  'gandu\\p{L}*', 'lund', 'lauda', 'loda', 'bhosd\\p{L}*', 'bsdk', 'mc\\s?bc', 'harami\\p{L}*', 'kutti\\s+(?:ka|ki)',
  'mierda', 'cabron', 'pendejo', 'merde', 'connard', 'scheisse', 'arschloch', 'cazzo', 'vaffanculo', 'blyat',
];
const SUBSTRING_PROFANITY: readonly string[] = [
  'मादरचोद', 'बहनचोद', 'भेनचोद', 'चूतिया', 'गांडू', 'भोसड़ी', 'लौड़ा', 'हरामी', 'कुत्ती',
  'খানকি', 'சூத்து', 'ధెంగ', 'ماں کی', 'كس أمك', 'блядь', 'сука', 'пизд', 'хуй', '他妈的', '操你', '씨발', '개새끼',
];

/**
 * Whole-word engine: a term counts only when no letter or digit touches it on either side. Built with
 * Unicode properties so it works for every alphabetic script, unlike `\b`, which only knows A–Z.
 */
function boundedRegex(terms: readonly string[]): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${terms.join('|')})(?![\\p{L}\\p{N}])`, 'iu');
}
const SEXUAL_RE = boundedRegex([...BOUNDED_SEXUAL, ...BOUNDED_SEXUAL_OTHER_SCRIPTS]);
const PROFANITY_RE = boundedRegex(BOUNDED_PROFANITY);

/**
 * THE MINORS RULE. A child together with anything revealing is refused even when each word alone is
 * innocent — "swimsuit" is fine for a sports-shop banner, and "a girl in a swimsuit" is not a picture
 * this product should draw. The two halves are checked within one prompt.
 */
const MINOR_RE = boundedRegex([
  'child', 'children', 'kid', 'kids', 'minor', 'minors', 'teen', 'teens', 'teenage\\p{L}*', 'underage', 'schoolgirl\\p{L}*',
  'school\\s?girl', 'little\\s+girl', 'young\\s+girl', 'little\\s+boy', 'toddler', 'baby', 'bachchi', 'bacchi', 'nabalig',
  'ladki\\s+(?:12|13|14|15|16|17)',
]);
const REVEALING_RE = boundedRegex([
  'swimsuit\\p{L}*', 'swimwear', 'bathing\\s+suit', 'beachwear', 'short\\s+skirt', 'mini\\s?skirt', 'crop\\s+top', 'tight\\s+dress',
  'shirtless', 'wet\\s+clothes', 'underwear', 'lingerie',
]);
const MINOR_SUBSTRING = ['बच्ची', 'नाबालिग', '儿童', '少女', '幼女', 'ロリ', '어린이'];

/** Look-alike digits and symbols a person types to slip a word past a filter: `nud3`, `p0rn`, `$exy`. */
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' };

/** Letters that do not decompose under NFKD but must fold for the lists above to match. */
const FOLD: Record<string, string> = { 'ı': 'i', 'ø': 'o', 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'đ': 'd', 'ł': 'l', 'ё': 'е', 'þ': 'th' };

/**
 * The forms the scan reads. PURE and exported so the tests can pin each disguise it undoes.
 *
 * 1. NFKC + lowercase, with zero-width characters removed (they are invisible and split a word).
 * 2. Accents folded away for alphabetic scripts (`desnúda` → `desnuda`, `ç` → `c`, Greek tonos
 *    dropped). Indic scripts are left untouched: their vowel signs ARE the word.
 * 3. Look-alike characters mapped back to letters — ONLY inside tokens that also contain a letter,
 *    so a size like "1024 x 768" or a price "₹499" is never rewritten into letters.
 * 4. Spaced-out letters joined: "n u d e", "n.u.d.e", "s-e-x" become one word. Only RUNS of
 *    single characters are joined, never ordinary words — "a big dog" stays three words.
 */
export function normalizeForScan(text: string): string {
  let t = String(text ?? '').normalize('NFKC').toLowerCase().replace(/[​-‍⁠﻿­]/g, '');
  // Fold accents on Latin, Greek and Cyrillic letters only (decompose, drop the combining mark).
  t = t.replace(/[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}]/gu, (ch) => {
    if (FOLD[ch]) return FOLD[ch];
    return ch.normalize('NFKD').replace(/\p{M}/gu, '');
  });
  t = t.replace(/[a-z0-9@$!]+/g, (tok) => (/[a-z]/.test(tok) ? tok.replace(/[013457@$!]/g, (c) => LEET[c] ?? c) : tok));
  // Runs of ≥3 single letters separated by spaces or punctuation: "n u d e" / "n.u.d.e" / "n-u-d-e".
  t = t.replace(/(?<![\p{L}\p{N}])\p{L}(?:[\s._\-*+]+\p{L}(?![\p{L}\p{N}])){2,}/gu, (run) => run.replace(/[\s._\-*+]+/g, ''));
  return t;
}

function firstSubstring(text: string, terms: readonly string[]): string | null {
  for (const w of terms) if (text.includes(w)) return w;
  return null;
}

/**
 * Scan a prompt that is about to be sent to Pollinations. PURE.
 *
 * Reads the text as written AND normalised, because normalising can also JOIN a word that was
 * legitimately apart, and reading both costs nothing. Any hit refuses.
 */
export function scanPollinationsPrompt(text: string | null | undefined): PollinationsScan {
  const raw = String(text ?? '');
  const lowered = raw.normalize('NFKC').toLowerCase();
  const stripped = lowered.replace(/[​-‍⁠﻿­]/g, '');
  const forms = [lowered, normalizeForScan(raw)];
  for (const f of forms) {
    const s = SEXUAL_RE.exec(f);
    if (s) return { ok: false, category: 'sexual', term: s[0] };
    const p = PROFANITY_RE.exec(f);
    if (p) return { ok: false, category: 'profanity', term: p[0] };
  }
  const sub = firstSubstring(stripped, SUBSTRING_SEXUAL);
  if (sub) return { ok: false, category: 'sexual', term: sub };
  const prof = firstSubstring(stripped, SUBSTRING_PROFANITY);
  if (prof) return { ok: false, category: 'profanity', term: prof };
  // A child together with anything revealing, in either form.
  for (const f of forms) {
    const minor = MINOR_RE.exec(f) ?? (firstSubstring(f, MINOR_SUBSTRING) ? [firstSubstring(f, MINOR_SUBSTRING) as string] : null);
    if (minor && REVEALING_RE.test(f)) return { ok: false, category: 'sexual', term: `${minor[0]} + revealing` };
  }
  return { ok: true };
}

/** The net under every caller: throws for a banned prompt. Called by `pollinationsImageUrl`. */
export function assertPollinationsPromptSafe(text: string | null | undefined): void {
  const scan = scanPollinationsPrompt(text);
  if (!scan.ok) throw new PollinationsPromptBlockedError(scan.category);
}
