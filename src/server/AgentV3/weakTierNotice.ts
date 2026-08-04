// AgentV3 — the WEAK-tier welcome notice for free users (admin final spec 2026-07-12, improved 2026-07-13).
//
// A brand-new free user (welcome credits, clamped to the 'weak' tier) is TOLD, in THEIR OWN language,
// right in the first reply: you are on the free Weak engine, the other tiers live behind the options
// button (⚙️ gear) just BELOW the message box, and a recharge unlocks every tier (Normal → Full Team).
// Honest — it never claims a free user can switch without recharging.
//
// THREE admin-mandated improvements (2026-07-13):
//   1. LANGUAGE: the notice is now hand-translated into every major Indian language we can detect
//      (Hindi, Bengali, Punjabi, Gujarati, Odia, Tamil, Telugu, Kannada, Malayalam, Urdu) plus a natural
//      English default for Latin-script / Hinglish / anything else — so a user reads it in the language
//      they actually wrote in, not always English.
//   2. ICON + LOCATION (corrected 2026-08-02 from a real screenshot): the real control is the composer's
//      **Settings gear** button — lucide `Settings` (a ⚙️ gear), title "Build options" — and it sits in the
//      toolbar row **BELOW** the message box (alongside Build / attach / mic), NOT to the LEFT of it. The
//      notice previously said "🎛️ … just left of the message box" (both wrong: no sliders icon, and it is
//      below, not left), which sent users hunting in the wrong place. It now says "⚙️ options button just
//      below the message box".
//   3. NO "₹1" HINT: the notice no longer advertises that a ₹1 recharge unlocks everything — it just says
//      the first recharge unlocks all tiers (still true; we simply don't headline the minimum amount).
//
// Deterministic + pure: the caller passes the detected language code (LanguageDetect) and a seed. Hindi
// and English keep three rotating phrasings (repeats never read identically); every other language has a
// single, natural translation (the notice is shown at most once per user per server instance, so a user
// never sees two of them back-to-back). Unknown / non-Indian scripts (zh, ja, ko, ru, …) fall back to
// English; the conversational AI then answers any follow-up in the user's own language.

// The UI control the notice points at: lucide `Settings` (a ⚙️ gear, title "Build options"), in the
// composer toolbar just BELOW the message box — the popover that lists the Weak → Full Team tiers.
const ICON = '⚙️';

const HINDI_VARIANTS: string[] = [
  `🌱 आप अभी **फ्री Weak इंजन** पर हैं — हर नए account की शुरुआत यहीं से होती है। बाक़ी tiers message box के ठीक **नीचे ${ICON} options बटन** में हैं (उन पर 🔒 दिखेगा); पहला recharge करते ही वे सब खुल जाते हैं।`,
  `🌱 यह build **फ्री Weak इंजन** पर चली — free account पर यही इंजन available है। सारे tiers देखने के लिए message box के **नीचे ${ICON} options बटन** को खोलें — Normal, Strong, Powerful और Full Team पहले recharge के बाद unlock हो जाते हैं।`,
  `🌱 आप **फ्री Weak इंजन** पर build कर रहे हैं। ज़्यादा powerful tiers message box के **नीचे ${ICON} options बटन** में 🔒 के साथ दिखेंगे — पहला recharge करते ही वे सब आपके लिए खुल जाएँगे।`,
];

const ENGLISH_VARIANTS: string[] = [
  `🌱 You're on the **free Weak engine** — the tier every new account starts on. The other tiers live behind the **${ICON} options button just below the message box** (they show a 🔒); they all unlock after your first recharge.`,
  `🌱 This build ran on the **free Weak engine** — the engine available on a free account. Open the **${ICON} options button just below the message box** to see every tier — Normal, Strong, Powerful and Full Team unlock after your first recharge.`,
  `🌱 You're building on the **free Weak engine**. The stronger tiers show a 🔒 in the **${ICON} options button (just below the message box)** — they all unlock once you recharge.`,
];

// One natural translation per detectable Indian language. Same meaning as the English default:
// free Weak engine → other tiers behind the ⚙️ options button below the message box → first recharge unlocks.
const SINGLE_LANG_VARIANTS: Record<string, string> = {
  // Bengali
  bn: `🌱 আপনি এখন **ফ্রি Weak ইঞ্জিনে** আছেন — প্রতিটি নতুন অ্যাকাউন্ট এখান থেকেই শুরু হয়। বাকি tier-গুলি message box-এর ঠিক **নিচের ${ICON} options বোতামে** আছে (সেগুলিতে 🔒 দেখাবে); প্রথম recharge করলেই সব খুলে যায়।`,
  // Punjabi (Gurmukhi)
  pa: `🌱 ਤੁਸੀਂ ਹੁਣ **ਫ੍ਰੀ Weak ਇੰਜਣ** 'ਤੇ ਹੋ — ਹਰ ਨਵਾਂ account ਇੱਥੋਂ ਹੀ ਸ਼ੁਰੂ ਹੁੰਦਾ ਹੈ। ਬਾਕੀ tier message box ਦੇ ਹੇਠਾਂ **${ICON} options ਬਟਨ** ਵਿੱਚ ਹਨ (ਉਹਨਾਂ 'ਤੇ 🔒 ਦਿਖੇਗਾ); ਪਹਿਲੀ recharge ਕਰਦੇ ਹੀ ਸਭ ਖੁੱਲ੍ਹ ਜਾਂਦੇ ਹਨ।`,
  // Gujarati
  gu: `🌱 તમે અત્યારે **ફ્રી Weak એન્જિન** પર છો — દરેક નવું account અહીંથી જ શરૂ થાય છે. બાકીના tier message box ની **નીચે ${ICON} options બટન** માં છે (તેમના પર 🔒 દેખાશે); પહેલી recharge કરતાં જ બધા ખૂલી જાય છે.`,
  // Odia
  or: `🌱 ଆପଣ ବର୍ତ୍ତମାନ **ମାଗଣା Weak ଇଞ୍ଜିନ୍‌** ରେ ଅଛନ୍ତି — ପ୍ରତ୍ୟେକ ନୂଆ account ଏଠାରୁ ଆରମ୍ଭ ହୁଏ। ଅନ୍ୟ tier ଗୁଡ଼ିକ message box ର **ତଳେ ${ICON} options ବଟନ୍‌** ରେ ଅଛି (ସେଥିରେ 🔒 ଦେଖାଯିବ); ପ୍ରଥମ recharge କଲେ ସବୁ ଖୋଲିଯାଏ।`,
  // Tamil
  ta: `🌱 நீங்கள் இப்போது **இலவச Weak இன்ஜினில்** உள்ளீர்கள் — ஒவ்வொரு புதிய கணக்கும் இங்கிருந்தே தொடங்குகிறது. மற்ற tier-கள் message box-ன் **கீழே ${ICON} options பொத்தானில்** உள்ளன (அவற்றில் 🔒 தெரியும்); முதல் recharge செய்தவுடன் அனைத்தும் திறக்கும்.`,
  // Telugu
  te: `🌱 మీరు ప్రస్తుతం **ఉచిత Weak ఇంజిన్** పై ఉన్నారు — ప్రతి కొత్త account ఇక్కడి నుండే మొదలవుతుంది. మిగతా tier-లు message box కి **కింద ${ICON} options బటన్** లో ఉన్నాయి (వాటిపై 🔒 కనిపిస్తుంది); మొదటి recharge చేయగానే అన్నీ అన్‌లాక్ అవుతాయి.`,
  // Kannada
  kn: `🌱 ನೀವು ಈಗ **ಉಚಿತ Weak ಎಂಜಿನ್** ನಲ್ಲಿದ್ದೀರಿ — ಪ್ರತಿ ಹೊಸ account ಇಲ್ಲಿಂದಲೇ ಪ್ರಾರಂಭವಾಗುತ್ತದೆ. ಉಳಿದ tier-ಗಳು message box ನ **ಕೆಳಗಿನ ${ICON} options ಬಟನ್** ನಲ್ಲಿವೆ (ಅವುಗಳ ಮೇಲೆ 🔒 ಕಾಣಿಸುತ್ತದೆ); ಮೊದಲ recharge ಮಾಡಿದ ತಕ್ಷಣ ಎಲ್ಲವೂ ಅನ್‌ಲಾಕ್ ಆಗುತ್ತವೆ.`,
  // Malayalam
  ml: `🌱 നിങ്ങൾ ഇപ്പോൾ **സൗജന്യ Weak എൻജിനിലാണ്** — ഓരോ പുതിയ account-ഉം ഇവിടെ നിന്നാണ് തുടങ്ങുന്നത്. ബാക്കി tier-കൾ message box-ന്റെ **താഴെയുള്ള ${ICON} options ബട്ടണിലാണ്** (അവയിൽ 🔒 കാണാം); ആദ്യ recharge ചെയ്യുമ്പോൾ എല്ലാം അൺലോക്ക് ആകും.`,
  // Urdu (Arabic script → LanguageDetect code 'ar')
  ar: `🌱 آپ اِس وقت **مفت Weak انجن** پر ہیں — ہر نیا اکاؤنٹ یہیں سے شروع ہوتا ہے۔ باقی tiers message box کے **نیچے ${ICON} options بٹن** میں ہیں (اُن پر 🔒 نظر آئے گا)؛ پہلی recharge کرتے ہی سب کھل جاتے ہیں۔`,
};

/**
 * The localized weak-tier welcome notice. `langCode` is LanguageDetect's code ('hi', 'ta', 'bn', … or
 * null/undefined for Latin-script/English/Hinglish). Hindi and English rotate between three phrasings via
 * `seed`; every other supported language returns its single natural translation; unknown/non-Indian scripts
 * fall back to English. `seed` is any integer (rotates, never throws). Pure & deterministic.
 */
export function weakTierWelcomeNotice(langCode: string | null | undefined, seed: number): string {
  const idx = (arr: string[]): number =>
    Math.abs(Math.trunc(Number.isFinite(seed) ? seed : 0)) % arr.length;

  if (langCode === 'hi') return HINDI_VARIANTS[idx(HINDI_VARIANTS)];
  if (langCode && SINGLE_LANG_VARIANTS[langCode]) return SINGLE_LANG_VARIANTS[langCode];
  return ENGLISH_VARIANTS[idx(ENGLISH_VARIANTS)];
}

// ── WEAK-tier BUILD-FAILED guidance (admin spec 2026-08-02) ──────────────────────────────────────
//
// When a build on the WEAK tier (the free engine, or a paid user who explicitly picked Weak) FAILS to
// produce a working app, the user is told — in THEIR OWN language — the honest, actionable reason:
// the Weak engine is the likely cause for a COMPLEX app, and a stronger tier (Strong or higher, via the
// ⚙️ options button just below the message box) is what such apps need. Shown ONLY when a real build
// attempt failed on the weak tier (never on an infra/sandbox failure, which short-circuits earlier), so
// the message is honest — it never blames the tier for a platform outage.
//
// WHITE-LABEL LAW: names only NavBharatAI's own tiers ("Weak" / "Strong") — NEVER a provider/model name
// (GLM/Kimi/Claude/…). "A stronger engine" is a capability statement, not a vendor. Reuses the SAME vetted
// per-language vocabulary as the welcome notice ("free Weak engine", "⚙️ options button below the
// message box"), so the translations stay consistent and correct. Pure & deterministic.

const FAILED_HINDI =
  `⚡ यह app **फ्री Weak इंजन** पर बन रही थी, इसलिए यह पूरी नहीं बन पाई — यह एक **complex app** है और ऐसी apps के लिए ज़्यादा powerful इंजन चाहिए। Message box के **नीचे ${ICON} options बटन** को खोलकर **Strong (या उससे ऊपर) tier** चुनें और यही app दोबारा भेजें — तब यह सही बन जाएगी।`;

const FAILED_ENGLISH =
  `⚡ This app was building on the **free Weak engine**, so it couldn't be finished — it's a **complex app**, and apps like this need a stronger engine. Open the **${ICON} options button just below the message box**, choose the **Strong tier (or higher)**, and send the same request again — it'll build correctly then.`;

// One faithful translation per detectable Indian language (same meaning as the English default), reusing
// each language's already-vetted "free Weak engine" + "⚙️ options button" phrasing from the welcome notice.
const FAILED_SINGLE_LANG: Record<string, string> = {
  bn: `⚡ এই app **ফ্রি Weak ইঞ্জিনে** তৈরি হচ্ছিল, তাই এটি সম্পূর্ণ হয়নি — এটি একটি **complex app**, আর এমন app-এর জন্য আরও শক্তিশালী ইঞ্জিন দরকার। message box-এর **নিচের ${ICON} options বোতাম** খুলে **Strong (বা তার উপরের) tier** বেছে নিন এবং একই request আবার পাঠান — তখন এটি ঠিকমতো তৈরি হবে।`,
  pa: `⚡ ਇਹ app **ਫ੍ਰੀ Weak ਇੰਜਣ** 'ਤੇ ਬਣ ਰਹੀ ਸੀ, ਇਸ ਲਈ ਪੂਰੀ ਨਹੀਂ ਬਣ ਸਕੀ — ਇਹ ਇੱਕ **complex app** ਹੈ ਅਤੇ ਅਜਿਹੀਆਂ apps ਲਈ ਵੱਧ ਤਾਕਤਵਰ ਇੰਜਣ ਚਾਹੀਦਾ ਹੈ। message box ਦੇ ਹੇਠਾਂ **${ICON} options ਬਟਨ** ਖੋਲ੍ਹ ਕੇ **Strong (ਜਾਂ ਉੱਪਰਲਾ) tier** ਚੁਣੋ ਅਤੇ ਉਹੀ request ਦੁਬਾਰਾ ਭੇਜੋ — ਫਿਰ ਇਹ ਸਹੀ ਬਣ ਜਾਵੇਗੀ।`,
  gu: `⚡ આ app **ફ્રી Weak એન્જિન** પર બની રહી હતી, તેથી પૂરી બની શકી નહીં — આ એક **complex app** છે અને આવી apps માટે વધુ powerful એન્જિન જોઈએ. message box ની **નીચે ${ICON} options બટન** ખોલીને **Strong (કે તેથી ઉપરનું) tier** પસંદ કરો અને એ જ request ફરી મોકલો — પછી આ બરાબર બની જશે.`,
  or: `⚡ ଏହି app **ମାଗଣା Weak ଇଞ୍ଜିନ୍‌** ରେ ତିଆରି ହେଉଥିଲା, ତେଣୁ ପୂରା ହୋଇପାରିଲା ନାହିଁ — ଏହା ଏକ **complex app**, ଏବଂ ଏଭଳି app ପାଇଁ ଅଧିକ ଶକ୍ତିଶାଳୀ ଇଞ୍ଜିନ୍‌ ଦରକାର। message box ର **ତଳେ ${ICON} options ବଟନ୍‌** ଖୋଲି **Strong (କିମ୍ବା ତା'ଠାରୁ ଉପର) tier** ବାଛନ୍ତୁ ଓ ସେହି request ପୁଣି ପଠାନ୍ତୁ — ତେବେ ଏହା ଠିକ୍‌ ଭାବେ ତିଆରି ହେବ।`,
  ta: `⚡ இந்த app **இலவச Weak இன்ஜினில்** உருவாகிக் கொண்டிருந்தது, அதனால் முழுமையாக உருவாகவில்லை — இது ஒரு **complex app**, இதுபோன்ற app-களுக்கு வலிமையான இன்ஜின் தேவை. message box-ன் **கீழே உள்ள ${ICON} options பொத்தானைத்** திறந்து **Strong (அல்லது அதற்கு மேல்) tier**-ஐத் தேர்ந்தெடுத்து அதே request-ஐ மீண்டும் அனுப்புங்கள் — அப்போது சரியாக உருவாகும்.`,
  te: `⚡ ఈ app **ఉచిత Weak ఇంజిన్** పై తయారవుతోంది, అందుకే పూర్తి కాలేదు — ఇది ఒక **complex app**, ఇలాంటి app-లకు మరింత శక్తివంతమైన ఇంజిన్ కావాలి. message box కి **కింద ఉన్న ${ICON} options బటన్** తెరిచి **Strong (లేదా పైన) tier** ఎంచుకుని అదే request మళ్లీ పంపండి — అప్పుడు ఇది సరిగ్గా తయారవుతుంది.`,
  kn: `⚡ ಈ app **ಉಚಿತ Weak ಎಂಜಿನ್** ನಲ್ಲಿ ತಯಾರಾಗುತ್ತಿತ್ತು, ಆದ್ದರಿಂದ ಪೂರ್ಣಗೊಳ್ಳಲಿಲ್ಲ — ಇದು ಒಂದು **complex app**, ಇಂತಹ app-ಗಳಿಗೆ ಹೆಚ್ಚು ಶಕ್ತಿಶಾಲಿ ಎಂಜಿನ್ ಬೇಕು. message box ನ **ಕೆಳಗಿನ ${ICON} options ಬಟನ್** ತೆರೆದು **Strong (ಅಥವಾ ಮೇಲಿನ) tier** ಆಯ್ಕೆಮಾಡಿ ಅದೇ request ಮತ್ತೆ ಕಳುಹಿಸಿ — ಆಗ ಇದು ಸರಿಯಾಗಿ ತಯಾರಾಗುತ್ತದೆ.`,
  ml: `⚡ ഈ app **സൗജന്യ Weak എൻജിനിൽ** നിർമ്മിക്കുകയായിരുന്നു, അതിനാൽ പൂർത്തിയായില്ല — ഇതൊരു **complex app** ആണ്, ഇത്തരം app-കൾക്ക് കൂടുതൽ കരുത്തുള്ള എൻജിൻ വേണം. message box-ന്റെ **താഴെയുള്ള ${ICON} options ബട്ടൺ** തുറന്ന് **Strong (അല്ലെങ്കിൽ അതിനു മുകളിലുള്ള) tier** തിരഞ്ഞെടുത്ത് അതേ request വീണ്ടും അയയ്ക്കുക — അപ്പോൾ ഇത് ശരിയായി നിർമ്മിക്കപ്പെടും.`,
  ar: `⚡ یہ app **مفت Weak انجن** پر بن رہی تھی، اِس لیے مکمل نہیں ہو سکی — یہ ایک **complex app** ہے اور ایسی apps کے لیے زیادہ طاقتور انجن چاہیے۔ message box کے **نیچے ${ICON} options بٹن** کھول کر **Strong (یا اُس سے اوپر) tier** منتخب کریں اور وہی request دوبارہ بھیجیں — تب یہ درست بن جائے گی۔`,
};

/**
 * The localized WEAK-tier "this build failed — switch to a stronger tier" guidance. `langCode` is
 * LanguageDetect's code ('hi', 'ta', 'bn', … or null/undefined for Latin-script/English/Hinglish).
 * Returns the user's-language message; unknown/non-Indian scripts fall back to English. Pure.
 */
export function weakTierBuildFailedNotice(langCode: string | null | undefined): string {
  if (langCode === 'hi') return FAILED_HINDI;
  if (langCode && FAILED_SINGLE_LANG[langCode]) return FAILED_SINGLE_LANG[langCode];
  return FAILED_ENGLISH;
}
