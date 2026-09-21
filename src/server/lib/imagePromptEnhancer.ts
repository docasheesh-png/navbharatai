// The ⭐ prompt enhancer — the star left of Send turns a user's brief into a peak-level image prompt
// they can read and edit (admin 2026-09-21: "send button ke left me jo star hai, usko peak level
// promt banwana sikhao!" — "sabse bada realism lever").
//
// 🔑 WHAT IT IS, AND WHAT IT IS NOT. The craft layer (`imagePromptCraft.ts`) already adds art
// direction to EVERY send, silently, per purpose. This is different: it rewrites the user's OWN
// WORDS, on request, and puts the result back in their box — so they see it, can change it, and
// learn what a strong brief looks like. The craft layer still runs on top of whatever they send.
//
// 💸 IT RIDES THE FREE CHAT LADDER (`'navbharat'` — glm-4.7-flash led, ₹0), one short call, no
// tools, no history. A paying user is not charged for it and a free user costs the platform what a
// free chat turn does. It is a REQUEST, never automatic: a call the user did not ask for is spend
// nobody agreed to.
//
// 🔒 IT NEVER INVENTS A FACT. The one thing a rewrite can do wrong is drift: turn "Sharma Sweets,
// 98765 43210" into a beautiful brief that has lost the phone number, or add a slogan the user
// never wrote. So the model is told to keep every name, number and word-on-the-picture exactly, and
// the result is CHECKED: a number, an all-caps word or a Devanagari word present in the original and
// missing from the rewrite makes the rewrite unusable, and the user keeps their own words with an
// honest note. Precision over prettiness.
//
// 🔒 WHITE-LABEL: the reply is the prompt and nothing else. A failure is a branded sentence; the
// provider is never named.

export interface EnhanceInput {
  prompt: string;
  /** The picker's settings, so the rewrite agrees with them instead of arguing. */
  type?: string;
  style?: string;
  colorHint?: string;
}

export const ENHANCE_MAX_INPUT = 2_000;
export const ENHANCE_MAX_OUTPUT = 700;
export const ENHANCE_TIMEOUT_MS = 15_000;

export function enhancerSystemPrompt(): string {
  return [
    'You are a senior art director writing prompts for a text-to-image model.',
    'Rewrite the user\'s brief into ONE professional image prompt, in English, 40–80 words.',
    'Order: subject and action first; then composition and framing; lighting; camera or medium (lens, film look, or "flat vector" / "3D render" when the type asks for it); materials and textures; colour palette; mood; background; finish with quality words.',
    'Keep EVERY concrete fact the user gave — names, numbers, phone numbers, prices, objects, places, colours — exactly as written. Never add a slogan, a brand, a person, or any words to be drawn on the picture that the user did not write.',
    'Respect the chosen image type and style: a logo or icon is a flat, simple mark on a clean background, not a photograph; a photograph or cinematic style gets real camera language.',
    'If the brief is in Hindi or Hinglish, express its meaning in English but keep proper nouns as written.',
    'Output ONLY the prompt. No preamble, no quotes, no bullet points, no explanation.',
  ].join('\n');
}

export function enhancerUserMessage(input: EnhanceInput): string {
  const settings = [
    input.type ? `Image type: ${input.type}` : '',
    input.style ? `Style: ${input.style}` : '',
    input.colorHint && !/^no/i.test(input.colorHint) ? `Colour: ${input.colorHint}` : '',
  ].filter(Boolean).join('\n');
  return `${settings ? settings + '\n\n' : ''}Brief: ${String(input.prompt || '').slice(0, ENHANCE_MAX_INPUT).trim()}`;
}

/** Strip the shapes a chat model adds around an answer, and bound it. PURE. */
export function cleanEnhancedPrompt(raw: string | null | undefined): string {
  let t = String(raw ?? '').replace(/\r/g, '').trim();
  // "Here is your prompt:" / "Prompt:" / "Enhanced prompt —"
  t = t.replace(/^(?:here(?:'s| is)[^:\n]*:|(?:enhanced |improved |final )?prompt\s*[:—-])\s*/i, '');
  // A fenced or quoted answer.
  t = t.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
  t = t.replace(/^["“'`]+|["”'`]+$/g, '').trim();
  // One paragraph: the box is a single line and the engine reads a sentence, not a list.
  t = t.replace(/^\s*[-*•]\s+/gm, '').replace(/\s*\n+\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return t.slice(0, ENHANCE_MAX_OUTPUT);
}

/**
 * The facts a rewrite must not lose: digit runs of three or more (a phone number, a price, a
 * year), words in ALL CAPS of two or more letters (a shop name typed as SHARMA SWEETS), and any
 * Devanagari word. Deliberately NARROW — a capitalised English word at the start of a sentence is
 * not a fact — because a check that is too eager rejects every good rewrite. PURE.
 */
export function factsToKeep(original: string): string[] {
  const text = String(original ?? '');
  const out = new Set<string>();
  for (const m of text.match(/\d[\d\s-]{1,}\d/g) ?? []) {
    const digits = m.replace(/\D/g, '');
    if (digits.length >= 3) out.add(digits);
  }
  for (const m of text.match(/\b[A-Z]{2,}\b/g) ?? []) out.add(m);
  for (const m of text.match(/[ऀ-ॿ]+/g) ?? []) out.add(m);
  return Array.from(out);
}

/** Every kept fact must appear in the rewrite (digits compared without spaces or dashes). PURE. */
export function keepsTheFacts(original: string, enhanced: string): boolean {
  const flatDigits = String(enhanced ?? '').replace(/[\s-]/g, '');
  for (const fact of factsToKeep(original)) {
    if (/^\d+$/.test(fact)) { if (!flatDigits.includes(fact)) return false; continue; }
    if (!String(enhanced ?? '').includes(fact)) return false;
  }
  return true;
}

export type EnhanceOutcome =
  | { ok: true; prompt: string }
  | { ok: false; reason: 'empty' | 'unchanged' | 'lost-facts' | 'busy'; message: string };

/** The branded words for each failure. Names no vendor; says what the user still has. */
export function enhanceFailureMessage(reason: Exclude<EnhanceOutcome, { ok: true }>['reason']): string {
  if (reason === 'busy') return 'NavBharatAI could not improve the prompt just now — your words are kept. Try the star again in a moment.';
  if (reason === 'lost-facts') return 'The improved version dropped one of your details, so your own words are kept. Add more detail and try the star again.';
  if (reason === 'unchanged') return 'Your prompt is already specific — nothing to add. Press send.';
  return 'NavBharatAI could not improve the prompt just now — your words are kept.';
}

/**
 * Decide from a model's raw answer. PURE, so the whole rule is testable without a provider.
 */
export function decideEnhanced(original: string, raw: string | null | undefined, modelOk: boolean): EnhanceOutcome {
  if (!modelOk) return { ok: false, reason: 'busy', message: enhanceFailureMessage('busy') };
  const cleaned = cleanEnhancedPrompt(raw);
  if (!cleaned || cleaned.length < 12) return { ok: false, reason: 'empty', message: enhanceFailureMessage('empty') };
  if (cleaned.toLowerCase() === String(original ?? '').trim().toLowerCase()) {
    return { ok: false, reason: 'unchanged', message: enhanceFailureMessage('unchanged') };
  }
  if (!keepsTheFacts(original, cleaned)) return { ok: false, reason: 'lost-facts', message: enhanceFailureMessage('lost-facts') };
  return { ok: true, prompt: cleaned };
}

/** One model call, injectable. Returns the raw text and whether the router said it succeeded. */
export type EnhancerCall = (system: string, user: string) => Promise<{ content: string; ok: boolean }>;

export async function enhanceImagePrompt(input: EnhanceInput, call: EnhancerCall, timeoutMs = ENHANCE_TIMEOUT_MS): Promise<EnhanceOutcome> {
  const original = String(input.prompt ?? '').trim();
  if (!original) return { ok: false, reason: 'empty', message: enhanceFailureMessage('empty') };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const answer = await Promise.race([
      call(enhancerSystemPrompt(), enhancerUserMessage(input)),
      new Promise<{ content: string; ok: boolean }>((resolve) => {
        timer = setTimeout(() => resolve({ content: '', ok: false }), timeoutMs);
      }),
    ]);
    return decideEnhanced(original, answer.content, answer.ok);
  } catch {
    return { ok: false, reason: 'busy', message: enhanceFailureMessage('busy') };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
