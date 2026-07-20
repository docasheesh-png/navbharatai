// App-update chat notice — language detection + localized text (admin 2026-07-20: "language wahi
// ho jo user likh raha ho"). Pure + unit-tested: the update prompt shown as the first chat message
// speaks the language the user is typing in. Covered confidently: English, Hindi (Devanagari), and
// Hinglish (romanized Hindi) — the dominant inputs for this app. Any other script falls back to
// English (honest: we never ship a translation we can't stand behind — more languages are a simple
// map addition here when verified).

export type NoticeLang = 'en' | 'hi' | 'hinglish';

export interface NoticeText {
  /** The assistant-bubble body shown to the user. */
  body: string;
  /** The label on the store button. */
  button: string;
}

const NOTICE_TEXT: Record<NoticeLang, NoticeText> = {
  en: {
    body: 'A new version of NavBharatAI is available. Update now for the best experience.',
    button: 'Update',
  },
  hi: {
    body: 'NavBharatAI का नया वर्शन उपलब्ध है। बेहतर अनुभव के लिए अभी अपडेट करें।',
    button: 'अपडेट करें',
  },
  hinglish: {
    body: 'NavBharatAI ka naya version aa gaya hai! Behtar experience ke liye abhi update karein.',
    button: 'Update karein',
  },
};

// Romanized-Hindi (Hinglish) marker words that are NOT also common English words — one hit is a
// strong signal the user is typing Hinglish rather than English.
const HINGLISH_TOKENS = new Set([
  'hai', 'hain', 'kar', 'karo', 'karna', 'karke', 'karein', 'karunga', 'karenge', 'kiya',
  'nahi', 'nhi', 'naa', 'mat', 'kya', 'kyu', 'kyun', 'kyon',
  'banao', 'banana', 'bana', 'banaya', 'banade',
  'mujhe', 'mera', 'meri', 'mere', 'hume', 'humein', 'aap', 'tum', 'hum', 'tumhe', 'aapko',
  'chahiye', 'raha', 'rahe', 'rahi', 'hoga', 'hogi', 'hona', 'kaise', 'kaisa', 'kahan', 'kaha',
  'theek', 'thik', 'accha', 'acha', 'matlab', 'bhai', 'yaar', 'abhi', 'kaam', 'bolo', 'bol',
  'dekho', 'dekh', 'chalega', 'chal', 'wala', 'wali', 'kuch', 'sab', 'phir', 'lekin', 'par',
]);

const DEVANAGARI = /[ऀ-ॿ]/;

/**
 * Detect which of the covered languages the user is writing in, from a sample of their text.
 * Devanagari script → Hindi; else a Hinglish marker word → Hinglish; else English. Pure.
 */
export function detectNoticeLang(text: string | undefined | null): NoticeLang {
  const s = String(text ?? '').trim();
  if (!s) return 'en';
  if (DEVANAGARI.test(s)) return 'hi';
  const words = s.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  for (const w of words) {
    if (HINGLISH_TOKENS.has(w)) return 'hinglish';
  }
  return 'en';
}

/** The localized notice text for a detected language. Pure. */
export function updateNoticeText(lang: NoticeLang): NoticeText {
  return NOTICE_TEXT[lang] ?? NOTICE_TEXT.en;
}

/** Convenience: detect + resolve in one call. Pure. */
export function updateNoticeFor(text: string | undefined | null): NoticeText {
  return updateNoticeText(detectNoticeLang(text));
}
