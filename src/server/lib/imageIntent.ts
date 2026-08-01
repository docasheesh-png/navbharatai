// NavBharatAI Free chat — image-generation intent detection (admin 2026-08-01).
//
// The admin wants: if a FREE-chat user's plain text asks to CREATE an image, NavBharatAI Free should just
// generate one (free, via Pollinations) inline in the chat — no separate tool trip. This module is the
// PURE decision: does this message ask to GENERATE a picture, and if so, what is the image prompt?
//
// Precision matters — a false positive turns an ordinary question ("how do I add an image to my app?")
// into a surprise picture. So a trigger requires a CREATE verb next to an IMAGE noun, or an explicit
// "<image-noun> of <thing>" / "draw <thing>" shape — and a set of HANDLING verbs (add/upload/resize/…)
// vetoes it. Bilingual: English + Hindi/Hinglish (Latin and Devanagari).

const CREATE_VERBS = [
  'generate', 'create', 'make', 'draw', 'design', 'render', 'paint', 'sketch', 'illustrate',
  'banao', 'banaao', 'banado', 'bana do', 'banade', 'bana de', 'bana', 'nikaal', 'nikaalo', 'bana ke do',
];
const IMAGE_NOUNS = [
  'image', 'images', 'picture', 'pic', 'pics', 'photo', 'photos', 'photograph', 'wallpaper', 'logo',
  'icon', 'poster', 'illustration', 'drawing', 'art', 'artwork', 'avatar', 'banner', 'sticker',
  'tasveer', 'tasvir', 'tsveer', 'chitra', 'photu',
];
// Words that mean the user wants to HANDLE/analyse an existing image, NOT generate one — these veto.
const HANDLING_VERBS = [
  'add', 'insert', 'upload', 'resize', 'crop', 'compress', 'edit', 'attach', 'embed', 'download',
  'analyse', 'analyze', 'describe', 'explain', 'read', 'lagau', 'lagana', 'lgau', 'kaise', 'how do i', 'how to',
];

const DEV_IMAGE = 'तस्वीर|तस्वीरें|फोटो|फ़ोटो|चित्र|इमेज|तस्वीर';
const DEV_CREATE = 'बनाओ|बना दो|बनाओ|बना|बनाकर';

function esc(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
const CREATE_RE = CREATE_VERBS.map(esc).join('|');
const NOUN_RE = IMAGE_NOUNS.map(esc).join('|');

// verb … noun   (generate a … logo)   OR   noun … verb   (logo banao)
const EN_VERB_NOUN = new RegExp(`\\b(${CREATE_RE})\\b[\\w\\s,'"-]{0,40}?\\b(${NOUN_RE})\\b`, 'i');
const EN_NOUN_VERB = new RegExp(`\\b(${NOUN_RE})\\b[\\w\\s,'"-]{0,40}?\\b(${CREATE_RE})\\b`, 'i');
// "<image-noun> of <thing>"  (a strong signal on its own)
const NOUN_OF = new RegExp(`\\b(${NOUN_RE})\\s+(of|showing|with)\\b`, 'i');
// "draw/sketch/paint <thing>"  (verb strongly implies an image even without the noun)
const DRAW_VERB = /\b(draw|sketch|paint|illustrate)\b\s+(me\s+|us\s+|a\s+|an\s+|the\s+)?[a-z0-9]/i;
const DEV_RE = new RegExp(`(${DEV_IMAGE})[\\s\\S]{0,40}?(${DEV_CREATE})|(${DEV_CREATE})[\\s\\S]{0,40}?(${DEV_IMAGE})`);

const HANDLING_RE = new RegExp(`\\b(${HANDLING_VERBS.map(esc).join('|')})\\b`, 'i');

/** Lead-in phrases stripped from the front of the prompt so the image model gets the SUBJECT, not the command. */
const LEADIN_RE = new RegExp(
  `^\\s*(please\\s+|kindly\\s+|can you\\s+|could you\\s+|mujhe\\s+|ek\\s+|a\\s+|an\\s+|the\\s+)*` +
  `(${CREATE_RE})\\b\\s*(me\\s+|us\\s+|for me\\s+)?` +
  `(a\\s+|an\\s+|the\\s+|ek\\s+|one\\s+)?` +
  `(${NOUN_RE})?\\s*(of|showing|with|:|=|for|,)?\\s*`,
  'i',
);

export interface ImageIntent {
  /** True → the message asks to GENERATE an image. */
  wants: boolean;
  /** The cleaned image prompt (subject), when wants is true. */
  prompt: string;
}

/**
 * Decide whether a Free-chat message is asking to GENERATE an image, and extract the image prompt. Pure.
 * A handling verb (add/upload/resize/explain/…) vetoes, so "how do I add an image?" never triggers.
 */
export function detectImageIntent(message: string): ImageIntent {
  const raw = String(message || '').trim();
  if (!raw || raw.length > 2000) return { wants: false, prompt: '' };
  const text = raw.toLowerCase();

  const hasDraw = DRAW_VERB.test(raw);
  // A handling verb vetoes — UNLESS it's a clean "draw X" (draw is unambiguous) or an explicit "noun of X".
  if (HANDLING_RE.test(text) && !hasDraw && !NOUN_OF.test(text)) return { wants: false, prompt: '' };

  const wants =
    EN_VERB_NOUN.test(text) || EN_NOUN_VERB.test(text) || NOUN_OF.test(text) || hasDraw || DEV_RE.test(raw);
  if (!wants) return { wants: false, prompt: '' };

  return { wants: true, prompt: extractImagePrompt(raw) };
}

/** Strip the command lead-in ("generate an image of", "banao", …) so the model gets the subject. */
export function extractImagePrompt(message: string): string {
  const raw = String(message || '').trim();
  let p = raw.replace(LEADIN_RE, '').trim();
  // Trailing Hindi "banao/bana do/…" (noun-verb order: "a red logo banao").
  p = p.replace(new RegExp(`\\b(${CREATE_RE})\\b\\s*[.!?]*$`, 'i'), '').trim();
  // Strip surrounding quotes and trailing punctuation.
  p = p.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').replace(/[.!?]+$/g, '').trim();
  // If stripping ate everything (e.g. the message was just "make an image"), fall back to the full message.
  return p.length >= 2 ? p : raw;
}
