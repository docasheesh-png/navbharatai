// AgentV3 — the WEAK-tier welcome notice for free users (admin final spec 2026-07-12).
//
// A brand-new free user (₹500 welcome credits, clamped to the 'weak' tier) must be TOLD, in their own
// language, right in the first reply: you are on the free Weak engine, the tier selector lives behind the
// 🎚️ settings button just LEFT of the message box, and a recharge of ANY amount (even ₹1) unlocks every
// tier (Normal → Full Team). Honest — it never claims a free user can switch without recharging.
//
// Deterministic + pure: the caller passes the detected language code (LanguageDetect) and a seed; the
// notice rotates between a few phrasings (same meaning, different words — the admin explicitly asked that
// repeated notices not read identically). Hand-written variants exist for Hindi (Devanagari) and a
// default English that reads naturally for Hinglish/Latin-script users too; other languages fall back to
// English (the conversational AI answers follow-up questions in the user's language — see the
// AppKnowledgeBase Power entry).

const HINDI_VARIANTS: string[] = [
  '🌱 आप अभी **Weak (फ्री) इंजन** पर हैं — नए users के लिए यही tier चालू रहता है। Tier बदलने का option message box के ठीक **बाएँ 🎚️ settings बटन** में है; किसी भी amount (₹1 भी) का recharge करते ही **Normal से Full Team तक** सारे tiers खुल जाएँगे।',
  '🌱 यह build **Weak (फ्री) मोड** में चली — free account पर यही इंजन available है। Message box के **बाएँ तरफ़ 🎚️ settings** में सारे tiers दिखेंगे; recharge (कोई भी राशि) करते ही Normal, Strong, Powerful और Full Team सब unlock हो जाते हैं।',
  '🌱 आप **फ्री Weak इंजन** पर build कर रहे हैं। बाक़ी powerful tiers 🎚️ settings (message box के ठीक बाएँ) में 🔒 दिखेंगे — पहला recharge करते ही (चाहे ₹1 का) वे सब आपके लिए खुल जाएँगे।',
];

const ENGLISH_VARIANTS: string[] = [
  '🌱 You are on the **Weak (free) engine** — the tier every new account starts on. The tier selector lives behind the **🎚️ settings button just left of the message box**; recharge any amount (even ₹1) and every tier from **Normal to Full Team** unlocks.',
  '🌱 This build ran in **Weak (free) mode** — the engine available on a free account. Open **🎚️ settings (just left of the message box)** to see all tiers; your first recharge (any amount) unlocks Normal, Strong, Powerful and Full Team.',
  '🌱 You are building on the **free Weak engine**. The stronger tiers show a 🔒 in **🎚️ settings (left of the message box)** — they all unlock the moment you make your first recharge, even ₹1.',
];

/**
 * The localized weak-tier welcome notice. `langCode` is LanguageDetect's code ('hi', 'ta', … or
 * null/undefined for Latin-script/English/Hinglish); only 'hi' has hand-written variants today, everything
 * else uses English. `seed` picks the phrasing variant (any integer; rotates, never throws). Pure.
 */
export function weakTierWelcomeNotice(langCode: string | null | undefined, seed: number): string {
  const variants = langCode === 'hi' ? HINDI_VARIANTS : ENGLISH_VARIANTS;
  const i = Math.abs(Math.trunc(Number.isFinite(seed) ? seed : 0)) % variants.length;
  return variants[i];
}
