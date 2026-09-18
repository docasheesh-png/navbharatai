// THE DOMAIN VOCABULARY OF THE COUNTRY THIS APP IS FOR — one table, ten scripts.
//
// 🔴 WHY THIS EXISTS (admin, 2026-09-18, after the failure table). `RequirementGapAnalyzer`'s domain
// regexes were English, with romanised Hindi and then Devanagari appended by hand, twice. So a prompt
// written in Bengali, Tamil, Telugu, Gujarati, Kannada, Malayalam, Punjabi, Odia or Urdu named no domain
// at all: `analyzeRequirementGaps` returned `general`, `namesBusinessDomain` returned false, and
// `RequestAnalyser` scored a whole hospital management system at 5 — the score of "hi". Every consequence
// of that score followed: the 80-step cap instead of 150, no blueprint, a small-app ETA, and the cheap
// flash rung instead of Kimi. The user typed their language and got a toy.
//
// The other half (the 50/50 law): why could it arise at all? Because there was no PLACE for a language.
// The vocabulary lived inside thirteen one-line regex literals, so adding a language meant editing
// thirteen lines and every editor had to re-derive the boundary rules below. This module is that place.
// One table, one boundary builder, one compiled cache — and `RequirementGapAnalyzer` asks it once at the
// single point where a domain is chosen, so both selection sites (the analyzer and the suggestion bulb)
// gain every language for free.
//
// 🔒 THE BOUNDARY IS THE WHOLE DIFFICULTY, and it is why these terms are NOT pasted into the regexes.
// JavaScript's `\b` is ASCII-only: it fires between "म" and a space, and also between "म" and "ा". So
// `\b` is useless here, and an UNANCHORED Indic term matches inside longer, unrelated words — the way
// `माल` (goods) matches inside `मालिक` (owner) and would make an owner-dashboard a logistics app. Two
// assertions, both needed, built once in `boundedTerm`:
//   • LEFT  `(?<![\p{L}\p{N}\p{M}])` — nothing letter-ish immediately before, so a term cannot be found
//     in the middle or at the end of a longer word.
//   • RIGHT `(?!\p{M}*[\p{L}\p{N}])` — optional COMBINING MARKS may follow (so an inflected `दुकानों`
//     still matches `दुकान`), but not a mark-then-letter. That second half is what a naive
//     "marks are allowed" rule gets wrong: in Indic scripts a virama IS a mark, so `ಯೋಗ` (yoga) would
//     otherwise match inside `ಯೋಗ್ಯ` (suitable) — `ಗ` + `್` (mark) + `ಯ` (letter).
//
// A term written with a trailing `+` is a STEM: the left assertion only, so the case suffixes that
// Tamil, Telugu, Kannada and Malayalam attach directly to a noun still match (`மருத்துவமனை` in
// `மருத்துவமனையில்`, "in the hospital"). A stem is only marked `+` when every longer word starting with
// it belongs to the same domain — otherwise the term stays a whole word and an inflected form is simply
// missed. **A miss costs today's behaviour; a false positive costs a wrongly-sized, dearer build.** That
// asymmetry decided every borderline word here, exactly as it decides the safety triage.
//
// ⚠️ WHAT IS DELIBERATELY NOT HERE, so nobody reads the gaps as oversights:
//   • `saas`, `crm`, `productivity` — their English signals are acronyms and phrases ("B2B", "sales
//     pipeline", "kanban") that Indian-language prompts generally write in English anyway. A
//     transliteration table there would be guesswork with almost no signal.
//   • Generic "home" words (`घर`, `ঘর`, `ಮನೆ`, `വീട്`) are absent from `real-estate`: they are the
//     ordinary word for one's own house and would fire on prompts that are not about property. The
//     rent/plot/tenant words carry that domain instead.
//   • "Hotel" words are absent from `restaurant`: in India the word means both an eatery and lodging,
//     and English `hotel` is in no domain regex today either. Guessing between two real domains would
//     hand the build the wrong implicit-feature list.
//   • Urdu terms are here, but Urdu cannot widen the India-context signal in `RequirementGapAnalyzer`:
//     its script is shared with Arabic and Persian, so a script test would call an Arabic prompt Indian.
//
// PURE. No I/O, no clock. Never throws: a key with no terms yields a matcher that is always false.

/** A regex-safe copy of a term. The terms below contain no metacharacters; this keeps that true. */
function escapeRegex(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** One term, boundary-asserted. A trailing `+` marks a STEM (suffixes may follow) — see the header. */
function boundedTerm(raw: string): string {
  const stem = raw.endsWith('+');
  const body = escapeRegex(stem ? raw.slice(0, -1) : raw);
  return `(?<![\\p{L}\\p{N}\\p{M}])${body}${stem ? '' : '(?!\\p{M}*[\\p{L}\\p{N}])'}`;
}

/**
 * Domain key → the domain's nouns in the scripts of India.
 *
 * Keys MUST match `DomainDef.key` in `RequirementGapAnalyzer`; `indicDomainKeys()` is asserted against
 * that list by a test, so a typo here cannot become a language that silently never matches. Each block is
 * one language, in the order bn · ta · te · ur · mr · gu · kn · ml · pa · or, and holds the two or three
 * highest-signal nouns of that domain — not a dictionary. Hindi/Devanagari terms already live in the
 * regex literals and are not repeated.
 */
export const INDIC_DOMAIN_TERMS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  healthcare: [
    'হাসপাতাল+', 'ডাক্তার+', 'রোগী+', 'ওষুধ+', 'ঔষধ+', 'ক্লিনিক+',
    'மருத்துவ+', 'நோயாளி+', 'மருந்+',
    'ఆసుపత్రి+', 'ఆస్పత్రి+', 'వైద్య+', 'రోగి+',
    'ہسپتال', 'ڈاکٹر', 'مریض', 'دواخانہ', 'دوائی',
    'रुग्ण+', 'औषध+',
    'હોસ્પિટલ+', 'દવાખાન+', 'દર્દી+', 'ડૉક્ટર+',
    'ಆಸ್ಪತ್ರೆ+', 'ವೈದ್ಯ+', 'ರೋಗಿ+', 'ಔಷಧ+',
    'ആശുപത്രി+', 'ഡോക്ടർ', 'രോഗി+', 'മരുന്ന്',
    'ਹਸਪਤਾਲ+', 'ਡਾਕਟਰ', 'ਮਰੀਜ਼', 'ਦਵਾਈ',
    'ଡାକ୍ତରଖାନା+', 'ଡାକ୍ତର', 'ରୋଗୀ+', 'ଔଷଧ+',
  ],
  ecommerce: [
    'দোকান+', 'বাজার+', 'অর্ডার+', 'পণ্য+',
    'கடை', 'சந்தை+', 'ஆர்டர்', 'விற்பனை+',
    'దుకాణ+', 'అంగడి+', 'మార్కెట్', 'ఆర్డర్',
    'دکان', 'بازار', 'آرڈر', 'خریداری',
    'દુકાન+', 'બજાર+', 'ઓર્ડર',
    'ಅಂಗಡಿ+', 'ಮಾರುಕಟ್ಟೆ+', 'ಆರ್ಡರ್',
    'കട', 'ചന്ത+', 'ഓർഡർ',
    'ਦੁਕਾਨ+', 'ਬਾਜ਼ਾਰ', 'ਆਰਡਰ',
    'ଦୁକାନ+', 'ବଜାର', 'ଅର୍ଡର',
  ],
  education: [
    'বিদ্যালয়+', 'স্কুল+', 'ছাত্র+', 'শিক্ষক+', 'পরীক্ষা', 'কলেজ+',
    'பள்ளி+', 'மாணவ+', 'ஆசிரிய+', 'கல்லூரி+',
    'పాఠశాల+', 'విద్యార్థి+', 'ఉపాధ్యాయ+', 'పరీక్ష', 'కళాశాల+',
    'اسکول', 'مدرسہ', 'استاد', 'امتحان',
    'शाळा', 'शाळे+', 'विद्यार्थ+',
    'શાળા+', 'વિદ્યાર્થી+', 'શિક્ષક+', 'પરીક્ષા',
    'ಶಾಲೆ+', 'ವಿದ್ಯಾರ್ಥಿ+', 'ಶಿಕ್ಷಕ+', 'ಪರೀಕ್ಷೆ',
    'സ്കൂൾ', 'വിദ്യാർത്ഥി+', 'അധ്യാപക+', 'പരീക്ഷ',
    'ਸਕੂਲ', 'ਵਿਦਿਆਰਥੀ+', 'ਅਧਿਆਪਕ', 'ਪ੍ਰੀਖਿਆ',
    'ବିଦ୍ୟାଳୟ+', 'ଛାତ୍ର+', 'ଶିକ୍ଷକ+', 'ପରୀକ୍ଷା',
  ],
  restaurant: [
    'রেস্টুরেন্ট+', 'খাবার+', 'মেনু+', 'রান্নাঘর+',
    'உணவக+', 'மெனு+', 'சாப்பாடு+', 'சமையல்+',
    'రెస్టారెంట్', 'భోజన+', 'మెనూ',
    'ریستوران', 'مینو', 'باورچی',
    'उपाहारगृह+', 'जेवण+',
    'રેસ્ટોરન્ટ+', 'ભોજન+', 'મેનુ',
    'ರೆಸ್ಟೋರೆಂಟ್', 'ಊಟ', 'ಮೆನು',
    'ഭക്ഷണ+', 'മെനു',
    'ਰੈਸਟੋਰੈਂਟ', 'ਖਾਣਾ', 'ਮੇਨੂ',
    'ରେଷ୍ଟୁରାଣ୍ଟ', 'ଖାଦ୍ୟ', 'ମେନୁ',
  ],
  logistics: [
    'ডেলিভারি+', 'কুরিয়ার+', 'পরিবহন+', 'গুদাম+',
    'விநியோக+', 'கூரியர்', 'போக்குவரத்து+', 'கிடங்கு+',
    'డెలివరీ', 'కొరియర్', 'రవాణా', 'గిడ్డంగి+',
    'ڈیلیوری', 'کوریئر', 'گودام', 'ترسیل',
    'वाहतूक', 'वाहतुक+',
    'ડિલિવરી', 'કુરિયર', 'ગોદામ+',
    'ಡೆಲಿವರಿ', 'ಕೊರಿಯರ್', 'ಸಾಗಣೆ+', 'ಗೋದಾಮು+',
    'ഡെലിവറി', 'കൊറിയർ',
    'ਡਿਲੀਵਰੀ', 'ਕੁਰੀਅਰ', 'ਗੋਦਾਮ',
    'ଡେଲିଭରି', 'କୁରିଅର', 'ଗୋଦାମ',
  ],
  fintech: [
    'ঋণ+', 'লেনদেন+', 'খাতা+', 'সুদ',
    'கடன்+', 'வட்டி+',
    'అప్పు', 'వడ్డీ+', 'ఖాతా+', 'లావాదేవీ+',
    'قرض', 'سود', 'کھاتہ', 'ادھار',
    'ઉધાર', 'વ્યાજ', 'ખાતું', 'લોન',
    'ಸಾಲ', 'ಬಡ್ಡಿ+', 'ಖಾತೆ+',
    'വായ്പ+', 'പലിശ+', 'കടം',
    'ਕਰਜ਼ਾ', 'ਵਿਆਜ', 'ਖਾਤਾ', 'ਉਧਾਰ',
    'ଋଣ+', 'ସୁଧ', 'ଖାତା+',
  ],
  'real-estate': [
    'ভাড়া+', 'জমি+', 'ফ্ল্যাট+', 'ভাড়াটিয়া+',
    'வாடகை+', 'நிலம்', 'குடியிருப்பு+',
    'అద్దె+', 'ప్లాట్',
    'مکان', 'کرایہ', 'زمین', 'پلاٹ',
    'भाडे', 'भाड्या+', 'मालमत्ता',
    'મકાન+', 'ભાડું', 'ભાડા+', 'જમીન+',
    'ಬಾಡಿಗೆ+', 'ನಿವೇಶನ+',
    'വാടക+',
    'ਮਕਾਨ', 'ਕਿਰਾਇਆ', 'ਜ਼ਮੀਨ',
    'ଭଡ଼ା', 'ଜମି+',
  ],
  fitness: [
    'জিম', 'ব্যায়াম+', 'ফিটনেস+',
    'உடற்பயிற்சி+', 'ஜிம்', 'யோகா+',
    'వ్యాయామ+', 'జిమ్', 'యోగా+',
    'جم', 'ورزش', 'یوگا',
    'વ્યાયામ', 'જિમ',
    'ವ್ಯಾಯಾಮ+', 'ಜಿಮ್',
    'വ്യായാമ+', 'ജിം',
    'ਜਿਮ', 'ਕਸਰਤ',
    'ବ୍ୟାୟାମ', 'ଜିମ',
  ],
  events: [
    'বিয়ে+', 'অনুষ্ঠান+', 'মেলা', 'ইভেন্ট+',
    'விழா+', 'திருமண+', 'நிகழ்ச்சி+',
    'పెళ్లి+', 'వివాహ+', 'కార్యక్రమ+',
    'شادی', 'تقریب', 'میلہ',
    'लग्न', 'लग्ना+', 'समारंभ',
    'લગ્ન', 'પ્રસંગ', 'મેળો',
    'ಮದುವೆ+', 'ಸಮಾರಂಭ+', 'ಜಾತ್ರೆ+',
    'വിവാഹ+', 'കല്യാണ+', 'പരിപാടി+',
    'ਵਿਆਹ', 'ਸਮਾਗਮ', 'ਮੇਲਾ',
    'ବିବାହ', 'ସମାରୋହ', 'ମେଳା',
  ],
  jobs: [
    'চাকরি+', 'নিয়োগ+', 'শূন্যপদ+',
    'வேலை+', 'பணியிட+', 'நியமன+',
    'ఉద్యోగ+', 'నియామక+',
    'نوکری', 'بھرتی', 'ملازمت',
    'नोकरी', 'नोकऱ्या+',
    'નોકરી+', 'ભરતી',
    'ಉದ್ಯೋಗ+', 'ನೇಮಕ+',
    'ജോലി+', 'നിയമന+',
    'ਨੌਕਰੀ+', 'ਭਰਤੀ',
    'ଚାକିରି+', 'ନିଯୁକ୍ତି+',
  ],
  social: [
    'বন্ধু+', 'পোস্ট+', 'মেসেজ+', 'চ্যাট+',
    'நண்ப+', 'அரட்டை+',
    'స్నేహితు+', 'చాట్',
    'دوست', 'پیغام',
    'મિત્ર', 'સંદેશ',
    'ಸ್ನೇಹಿತ+', 'ಸಂದೇಶ+',
    'സുഹൃത്ത്', 'സന്ദേശ+',
    'ਦੋਸਤ', 'ਸੁਨੇਹਾ',
    'ବନ୍ଧୁ', 'ସନ୍ଦେଶ',
  ],
  booking: [
    'বুকিং+', 'টিকিট+',
    'முன்பதிவு+', 'டிக்கெட்',
    'బుకింగ్', 'టికెట్',
    'بکنگ', 'ٹکٹ',
    'तिकीट',
    'બુકિંગ', 'ટિકિટ',
    'ಬುಕಿಂಗ್', 'ಟಿಕೆಟ್',
    'ബുക്കിംഗ്', 'ടിക്കറ്റ്',
    'ਬੁਕਿੰਗ', 'ਟਿਕਟ',
    'ବୁକିଂ', 'ଟିକେଟ',
  ],
  game: [
    'গেম+', 'খেলা+',
    'விளையாட்டு+', 'கேம்',
    'ఆట', 'గేమ్',
    'گیم', 'کھیل',
    'खेळ',
    'ગેમ', 'રમત',
    'ಆಟ', 'ಗೇಮ್',
    'ഗെയിം', 'കളി',
    'ਗੇਮ', 'ਖੇਡ',
    'ଖେଳ', 'ଗେମ',
  ],
});

/** Compiled once per key, on first use. A key with no terms caches `null` and never matches. */
const compiled = new Map<string, RegExp | null>();

function patternFor(key: string): RegExp | null {
  if (compiled.has(key)) return compiled.get(key) ?? null;
  const terms = INDIC_DOMAIN_TERMS[key];
  const re = terms && terms.length > 0
    ? new RegExp(terms.map(boundedTerm).join('|'), 'iu')
    : null;
  compiled.set(key, re);
  return re;
}

/** Whether `text` names this domain in one of the scripts of India. Pure; false for an unknown key. */
export function indicDomainMatches(key: string, text: string): boolean {
  if (!text) return false;
  const re = patternFor(key);
  return re ? re.test(text) : false;
}

/** The domain keys this table carries — asserted against `DomainDef.key` by a test. */
export function indicDomainKeys(): string[] {
  return Object.keys(INDIC_DOMAIN_TERMS);
}

/**
 * The nine Indic SCRIPTS of India, as one contiguous range: Devanagari (U+0900) through Malayalam
 * (U+0D7F) — Devanagari, Bengali, Gurmukhi, Gujarati, Odia, Tamil, Telugu, Kannada, Malayalam. Sinhala
 * (U+0D80) is deliberately outside it.
 *
 * ⚠️ Arabic script is NOT here, and that is the honest limit of a script test: Urdu shares it with
 * Arabic and Persian, so including it would declare an Arabic prompt to be for the Indian market.
 * Bengali is also Bangladesh's script and Devanagari also Nepal's — a prompt from either gets ₹/UPI
 * defaults, which is wrong but strictly closer than the $/Stripe defaults it would get otherwise.
 *
 * 🔎 THE SAME NINE RANGES ARE ENUMERATED ONCE MORE, in `AgentV3/LanguageDetect.ts` — deliberately, and
 * for a different question. That module asks WHICH language to build the app's labels in, so it names
 * each script separately and requires the script to DOMINATE the prompt (15%), because one stray
 * character must not rename an English app's UI. This asks only "is this a script of India at all",
 * with no dominance threshold on purpose: a single `दुकान` inside an English prompt is still a prompt
 * for the Indian market, and ₹ is still the right default. `tests/theLanguagesOfTheMarketNameTheirDomain`
 * asserts the two agree on the ranges, so the copies cannot drift apart unnoticed.
 */
export const INDIC_SCRIPT_RE = /[\u0900-\u0D7F]/;

/** Whether the text is written in an Indic script of India. Pure. */
export function usesIndicScript(text: string): boolean {
  return INDIC_SCRIPT_RE.test(String(text || ''));
}
