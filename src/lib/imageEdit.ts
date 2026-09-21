// Editing a picture the USER already has — the shared rule, for every surface that does it
// (admin-asked 2026-09-21: "image to image ka option bhi add karo, user apni photo dal kar usme kuch
// badalwana chahe to woh badala ja sake" and, in the same message, "image+text to image me image
// badal jane ka dar hai, isko acche se karna!!!!!!").
//
// 🔴 THE FEAR IS THE SPECIFICATION. "Image badal jane ka dar" is not a worry about quality — it is
// the exact failure mode of image editing: somebody uploads their shop photo, asks for a blue
// awning, and gets back a DIFFERENT shop. Everything in this module exists to make the returned
// picture recognisably the one that went in.
//
// 🔒 PURE. No DOM, no env, no I/O — so `src/lib` (the pickers), `src/server/lib` (the paid adapter)
// and `src/server/routes` (the free route and free chat) all read the same rule, the way
// `imageSize.ts` is shared. Two copies of "how far may an edit move?" is two different answers.

/**
 * What kind of edit this is, derived from what the user sent — never a control they must get right.
 *
 * `directed` — a picture AND words ("make the shirt red"). The user named one thing to change and
 *              means everything else to stay.
 * `reimagine` — a picture and NO words. There is no instruction to follow, so a stylistic re-render
 *              is the only thing that could have been meant.
 */
export type ImageEditIntent = 'directed' | 'reimagine';

/**
 * How far the result may move from the original, 0..1 (the diffusion `strength` knob: 0 returns the
 * input, 1 ignores it).
 *
 * 🔴 THESE TWO NUMBERS WERE THE WRONG WAY ROUND, and that inversion IS the admin's reported fear.
 * The paid adapter shipped `image-to-image: 0.65` and `image-text-to-image: 0.85`, justified as "a
 * reference WITH words is a directed edit and needs ROOM to follow them". It is the opposite: words
 * say WHAT to change, they never ask for MORE to change. At 0.85 the model is re-rolling most of the
 * picture, which is precisely how a user's own photo comes back as somebody else's.
 *
 * So the directed edit gets the LEAST freedom of the two, and the wordless re-imagining — where the
 * user asked for no specific thing and a re-render is the whole request — gets more.
 */
export const EDIT_STRENGTH: Record<ImageEditIntent, number> = {
  directed: 0.35,
  reimagine: 0.6,
};

/** The most an explicit strength may be, however it arrives. Above this the input stops mattering. */
export const MAX_EDIT_STRENGTH = 0.85;

/**
 * The strength to send. An explicit, in-range value from the caller always wins — but it is CLAMPED,
 * because "keep my photo" is the promise this whole module makes and a stray 1.0 would break it
 * silently, with a successful-looking response.
 *
 * PURE.
 */
export function editStrengthFor(intent: ImageEditIntent, explicit?: unknown): number {
  const n =
    typeof explicit === 'number'
      ? explicit
      : typeof explicit === 'string' && explicit.trim() !== ''
        ? Number(explicit)
        : Number.NaN;
  // Out of range is JUNK, not "a lot" — a 9 that clamped to the ceiling would be this function
  // deciding that a malformed field meant the most destructive edit it can make.
  if (Number.isFinite(n) && n > 0 && n <= 1) return Math.min(MAX_EDIT_STRENGTH, n);
  return EDIT_STRENGTH[intent];
}

/**
 * What the model is told about the picture it was handed.
 *
 * The strength knob only exists on diffusion hosts. The FREE tier's editing rung is a multimodal
 * model that takes an image and an instruction and has no such dial at all — for it, this sentence
 * IS the fidelity control, which is why the wording is a shared constant and not a string typed at
 * two call sites.
 */
export const PRESERVE_DIRECTIVE =
  'This is an edit of the supplied photograph, not a new picture. Return the SAME image with only ' +
  'the requested change applied. Keep the same subject, the same faces and identity, the same pose, ' +
  'the same framing and crop, the same camera angle, the same lighting and the same background. ' +
  'Do not redraw, restyle, recompose, beautify or replace anything that was not asked for. ' +
  'Every part of the picture the instruction does not mention must come back unchanged.';

/** The same promise for a picture with NO instruction — keep it recognisably itself. */
export const REIMAGINE_DIRECTIVE =
  'Re-render the supplied photograph. Keep the same subject, the same composition and the same ' +
  'framing so the result is recognisably the same picture.';

const MAX_INSTRUCTION_CHARS = 1_400;

/**
 * The full instruction an editing model receives: the user's own words first (so a model that reads
 * the front of the prompt most strongly reads THEIR request), then the promise about everything
 * else.
 *
 * ⚠️ NO ART DIRECTION. The free route's `craftImagePrompt` layer adds composition, framing and
 * margin rules — correct for a picture being invented, and actively harmful here, because every one
 * of those sentences is an instruction to RE-COMPOSE the photograph the user asked us to keep. An
 * edit must never go through it.
 *
 * PURE.
 */
export function buildEditInstruction(words: string, intent?: ImageEditIntent): string {
  const said = String(words || '').trim().slice(0, MAX_INSTRUCTION_CHARS);
  const kind: ImageEditIntent = intent || (said ? 'directed' : 'reimagine');
  if (kind === 'reimagine') return REIMAGINE_DIRECTIVE;
  return `Apply this change to the photograph: ${said}\n\n${PRESERVE_DIRECTIVE}`;
}

/** Which of the two this payload is. Pure, and the one place the question is answered. */
export function editIntentFor(words: string): ImageEditIntent {
  return String(words || '').trim() ? 'directed' : 'reimagine';
}

// ── Does an attached picture + this message mean "change it"? ──────────────────────────────────
//
// Used by FREE CHAT, where an attached image has always meant "read this for me". Editing it is a
// new meaning for the same gesture, so the detection is PRECISION-FIRST in the describing direction:
// a message that does not clearly ask for a change is a question about the picture, and gets the
// answer it has always got. The costs are asymmetric exactly as `IntentClassifier` describes —
// describing when they wanted an edit costs one follow-up message, editing when they wanted an
// answer replaces the picture they were asking about.

const CHANGE_VERBS = [
  // English
  'change', 'edit', 'replace', 'remove', 'erase', 'delete', 'swap', 'recolour', 'recolor',
  'repaint', 'retouch', 'restore', 'colourise', 'colorize', 'colourize', 'colorise',
  'brighten', 'darken', 'blur', 'sharpen', 'crop out', 'cut out', 'turn it into', 'turn this into',
  'make it', 'make this', 'make the', 'add a', 'add an', 'add some', 'put a', 'put an',
  // Hinglish (Latin)
  'badal do', 'badal de', 'badlo', 'badal dijiye', 'badal kar', 'hata do', 'hata de', 'hatao',
  'mita do', 'mitao', 'jod do', 'joddo', 'lagado', 'laga do', 'lagao', 'daal do', 'dal do',
  'bana do', 'bana de', 'kar do', 'kar de', 'theek karo', 'sahi karo', 'saaf karo',
];
const DEV_CHANGE = 'बदल दो|बदलो|बदल|हटा दो|हटाओ|मिटा दो|जोड़ दो|जोड़ो|लगा दो|लगाओ|ठीक करो|साफ़ करो|साफ करो';

/**
 * Words that mean the user is ASKING ABOUT the picture, not asking us to change it. These veto, and
 * they veto deliberately hard: "what colour should I make this?" contains "make" and is a question.
 */
const ASK_VERBS = [
  'what', 'which', 'who', 'why', 'how much', 'how many', 'how do i', 'how to', 'explain',
  'describe', 'read', 'translate', 'summarise', 'summarize', 'identify', 'count', 'tell me',
  'kya', 'kaun', 'kyun', 'kyu', 'kitna', 'kitne', 'kaise', 'batao', 'bataiye', 'padho', 'padh',
  'samjhao', 'likha hai', 'kya hai',
];
const DEV_ASK = 'क्या|कौन|क्यों|कितना|कितने|कैसे|बताओ|बताइए|पढ़ो|समझाओ';

function esc(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
const CHANGE_RE = new RegExp(`(?:^|[^a-z])(?:${CHANGE_VERBS.map(esc).join('|')})(?:[^a-z]|$)`, 'i');
const DEV_CHANGE_RE = new RegExp(DEV_CHANGE);
const ASK_RE = new RegExp(`(?:^|[^a-z])(?:${ASK_VERBS.map(esc).join('|')})(?:[^a-z]|$)`, 'i');
const DEV_ASK_RE = new RegExp(DEV_ASK);

/**
 * True when an attached picture plus this message is an EDIT request rather than a question.
 *
 * 🔒 The veto wins. A message carrying both ("what is this? remove the background") is answered,
 * because the answer is cheap and reversible and the edit is neither — and because the user can
 * simply say "remove the background" on its own, which this returns true for.
 *
 * PURE.
 */
export function looksLikeImageEdit(message: string): boolean {
  const raw = String(message || '').trim();
  if (!raw || raw.length > 2_000) return false;
  if (ASK_RE.test(raw) || DEV_ASK_RE.test(raw)) return false;
  return CHANGE_RE.test(raw) || DEV_CHANGE_RE.test(raw);
}
