// AgentV3 — the WEAK-tier welcome notice for free users (admin final spec 2026-07-12, improved 2026-07-13).
//
// A brand-new free user (welcome credits, clamped to the 'weak' tier) is TOLD, in THEIR OWN language,
// right in the first reply: you are on the free Weak engine, the other tiers live behind the options
// button (🎛️) just LEFT of the message box, and a recharge unlocks every tier (Normal → Full Team).
// Honest — it never claims a free user can switch without recharging.
//
// THREE admin-mandated improvements (2026-07-13):
//   1. LANGUAGE: the notice is now hand-translated into every major Indian language we can detect
//      (Hindi, Bengali, Punjabi, Gujarati, Odia, Tamil, Telugu, Kannada, Malayalam, Urdu) plus a natural
//      English default for Latin-script / Hinglish / anything else — so a user reads it in the language
//      they actually wrote in, not always English.
//   2. ICON: the emoji now matches the REAL control in the UI. The button just left of the message box
//      renders lucide's `SlidersHorizontal` (a horizontal sliders / mixer icon), so the notice uses 🎛️
//      (control knobs) — NOT the old 🎚️ (a single vertical fader), which looked nothing like the button
//      and confused users about where to tap.
//   3. NO "₹1" HINT: the notice no longer advertises that a ₹1 recharge unlocks everything — it just says
//      the first recharge unlocks all tiers (still true; we simply don't headline the minimum amount).
//
// Deterministic + pure: the caller passes the detected language code (LanguageDetect) and a seed. Hindi
// and English keep three rotating phrasings (repeats never read identically); every other language has a
// single, natural translation (the notice is shown at most once per user per server instance, so a user
// never sees two of them back-to-back). Unknown / non-Indian scripts (zh, ja, ko, ru, …) fall back to
// English; the conversational AI then answers any follow-up in the user's own language.

// The UI control the notice points at: lucide `SlidersHorizontal`, just left of the message box.
const ICON = '🎛️';

const HINDI_VARIANTS: string[] = [
  `🌱 आप अभी **फ्री Weak इंजन** पर हैं — हर नए account की शुरुआत यहीं से होती है। बाक़ी tiers message box के ठीक **बाएँ ${ICON} options बटन** में हैं (उन पर 🔒 दिखेगा); पहला recharge करते ही वे सब खुल जाते हैं।`,
  `🌱 यह build **फ्री Weak इंजन** पर चली — free account पर यही इंजन available है। सारे tiers देखने के लिए message box के **बाएँ ${ICON} options बटन** को खोलें — Normal, Strong, Powerful और Full Team पहले recharge के बाद unlock हो जाते हैं।`,
  `🌱 आप **फ्री Weak इंजन** पर build कर रहे हैं। ज़्यादा powerful tiers message box के **बाएँ ${ICON} options बटन** में 🔒 के साथ दिखेंगे — पहला recharge करते ही वे सब आपके लिए खुल जाएँगे।`,
];

const ENGLISH_VARIANTS: string[] = [
  `🌱 You're on the **free Weak engine** — the tier every new account starts on. The other tiers live behind the **${ICON} options button just left of the message box** (they show a 🔒); they all unlock after your first recharge.`,
  `🌱 This build ran on the **free Weak engine** — the engine available on a free account. Open the **${ICON} options button just left of the message box** to see every tier — Normal, Strong, Powerful and Full Team unlock after your first recharge.`,
  `🌱 You're building on the **free Weak engine**. The stronger tiers show a 🔒 in the **${ICON} options button (left of the message box)** — they all unlock once you recharge.`,
];

// One natural translation per detectable Indian language. Same meaning as the English default:
// free Weak engine → other tiers behind the 🎛️ options button left of the message box → first recharge unlocks.
const SINGLE_LANG_VARIANTS: Record<string, string> = {
  // Bengali
  bn: `🌱 আপনি এখন **ফ্রি Weak ইঞ্জিনে** আছেন — প্রতিটি নতুন অ্যাকাউন্ট এখান থেকেই শুরু হয়। বাকি tier-গুলি message box-এর ঠিক **বাঁ দিকের ${ICON} options বোতামে** আছে (সেগুলিতে 🔒 দেখাবে); প্রথম recharge করলেই সব খুলে যায়।`,
  // Punjabi (Gurmukhi)
  pa: `🌱 ਤੁਸੀਂ ਹੁਣ **ਫ੍ਰੀ Weak ਇੰਜਣ** 'ਤੇ ਹੋ — ਹਰ ਨਵਾਂ account ਇੱਥੋਂ ਹੀ ਸ਼ੁਰੂ ਹੁੰਦਾ ਹੈ। ਬਾਕੀ tier message box ਦੇ ਖੱਬੇ ਪਾਸੇ **${ICON} options ਬਟਨ** ਵਿੱਚ ਹਨ (ਉਹਨਾਂ 'ਤੇ 🔒 ਦਿਖੇਗਾ); ਪਹਿਲੀ recharge ਕਰਦੇ ਹੀ ਸਭ ਖੁੱਲ੍ਹ ਜਾਂਦੇ ਹਨ।`,
  // Gujarati
  gu: `🌱 તમે અત્યારે **ફ્રી Weak એન્જિન** પર છો — દરેક નવું account અહીંથી જ શરૂ થાય છે. બાકીના tier message box ની ડાબી બાજુ **${ICON} options બટન** માં છે (તેમના પર 🔒 દેખાશે); પહેલી recharge કરતાં જ બધા ખૂલી જાય છે.`,
  // Odia
  or: `🌱 ଆପଣ ବର୍ତ୍ତମାନ **ମାଗଣା Weak ଇଞ୍ଜିନ୍‌** ରେ ଅଛନ୍ତି — ପ୍ରତ୍ୟେକ ନୂଆ account ଏଠାରୁ ଆରମ୍ଭ ହୁଏ। ଅନ୍ୟ tier ଗୁଡ଼ିକ message box ର ବାମ ପାଖରେ **${ICON} options ବଟନ୍‌** ରେ ଅଛି (ସେଥିରେ 🔒 ଦେଖାଯିବ); ପ୍ରଥମ recharge କଲେ ସବୁ ଖୋଲିଯାଏ।`,
  // Tamil
  ta: `🌱 நீங்கள் இப்போது **இலவச Weak இன்ஜினில்** உள்ளீர்கள் — ஒவ்வொரு புதிய கணக்கும் இங்கிருந்தே தொடங்குகிறது. மற்ற tier-கள் message box-ன் இடதுபுறம் **${ICON} options பொத்தானில்** உள்ளன (அவற்றில் 🔒 தெரியும்); முதல் recharge செய்தவுடன் அனைத்தும் திறக்கும்.`,
  // Telugu
  te: `🌱 మీరు ప్రస్తుతం **ఉచిత Weak ఇంజిన్** పై ఉన్నారు — ప్రతి కొత్త account ఇక్కడి నుండే మొదలవుతుంది. మిగతా tier-లు message box కి ఎడమవైపు **${ICON} options బటన్** లో ఉన్నాయి (వాటిపై 🔒 కనిపిస్తుంది); మొదటి recharge చేయగానే అన్నీ అన్‌లాక్ అవుతాయి.`,
  // Kannada
  kn: `🌱 ನೀವು ಈಗ **ಉಚಿತ Weak ಎಂಜಿನ್** ನಲ್ಲಿದ್ದೀರಿ — ಪ್ರತಿ ಹೊಸ account ಇಲ್ಲಿಂದಲೇ ಪ್ರಾರಂಭವಾಗುತ್ತದೆ. ಉಳಿದ tier-ಗಳು message box ನ ಎಡಭಾಗದ **${ICON} options ಬಟನ್** ನಲ್ಲಿವೆ (ಅವುಗಳ ಮೇಲೆ 🔒 ಕಾಣಿಸುತ್ತದೆ); ಮೊದಲ recharge ಮಾಡಿದ ತಕ್ಷಣ ಎಲ್ಲವೂ ಅನ್‌ಲಾಕ್ ಆಗುತ್ತವೆ.`,
  // Malayalam
  ml: `🌱 നിങ്ങൾ ഇപ്പോൾ **സൗജന്യ Weak എൻജിനിലാണ്** — ഓരോ പുതിയ account-ഉം ഇവിടെ നിന്നാണ് തുടങ്ങുന്നത്. ബാക്കി tier-കൾ message box-ന്റെ ഇടതുവശത്തുള്ള **${ICON} options ബട്ടണിലാണ്** (അവയിൽ 🔒 കാണാം); ആദ്യ recharge ചെയ്യുമ്പോൾ എല്ലാം അൺലോക്ക് ആകും.`,
  // Urdu (Arabic script → LanguageDetect code 'ar')
  ar: `🌱 آپ اِس وقت **مفت Weak انجن** پر ہیں — ہر نیا اکاؤنٹ یہیں سے شروع ہوتا ہے۔ باقی tiers message box کے بائیں طرف **${ICON} options بٹن** میں ہیں (اُن پر 🔒 نظر آئے گا)؛ پہلی recharge کرتے ہی سب کھل جاتے ہیں۔`,
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
