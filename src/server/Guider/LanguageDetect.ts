/**
 * Lightweight language detection so the guider can talk back to the user in their
 * OWN language. Deterministic + dependency-free (a heuristic over the script and a
 * few common-word markers). The interpret model can override this with a more
 * precise label; this is the safe fallback.
 */

const DEVANAGARI = /[ऀ-ॿ]/;
const ARABIC = /[؀-ۿ]/;
const BENGALI = /[ঀ-৿]/;
const TAMIL = /[஀-௿]/;
const TELUGU = /[ఀ-౿]/;
const GUJARATI = /[઀-૿]/;
const CJK = /[一-鿿]/;

// Common romanized-Hindi (Hinglish) markers — latin script but Hindi words.
const HINGLISH_MARKERS = [
  'karo', 'kaise', 'kya', 'nahi', 'haan', 'krdo', 'kar do', 'banao', 'chahiye',
  'bana', 'theek', 'thik', 'mujhe', 'aap', 'hai', 'kyu', 'kyun', 'matlab', 'sahi',
];

/**
 * Return a short language label for the given user text:
 *   'hi' (Hindi/Devanagari), 'hinglish' (romanized Hindi), 'en' (English),
 *   plus a few other Indic/major scripts. Defaults to 'en'.
 */
export function detectLanguage(text: string): string {
  const t = (text || '').trim();
  if (!t) return 'en';
  if (DEVANAGARI.test(t)) return 'hi';
  if (BENGALI.test(t)) return 'bn';
  if (TAMIL.test(t)) return 'ta';
  if (TELUGU.test(t)) return 'te';
  if (GUJARATI.test(t)) return 'gu';
  if (ARABIC.test(t)) return 'ur';
  if (CJK.test(t)) return 'zh';

  const lower = ` ${t.toLowerCase()} `;
  const hinglishHits = HINGLISH_MARKERS.filter(m => lower.includes(` ${m} `) || lower.includes(`${m} `)).length;
  if (hinglishHits >= 2) return 'hinglish';

  return 'en';
}

/** Human-readable instruction fragment telling a model which language to reply in. */
export function languageDirective(language: string): string {
  switch (language) {
    case 'hi': return 'Reply in Hindi (Devanagari script).';
    case 'hinglish': return 'Reply in Hinglish (romanized Hindi in Latin script), the same casual style the user used.';
    case 'bn': return 'Reply in Bengali.';
    case 'ta': return 'Reply in Tamil.';
    case 'te': return 'Reply in Telugu.';
    case 'gu': return 'Reply in Gujarati.';
    case 'ur': return 'Reply in Urdu.';
    case 'zh': return 'Reply in Chinese.';
    default: return 'Reply in English.';
  }
}
