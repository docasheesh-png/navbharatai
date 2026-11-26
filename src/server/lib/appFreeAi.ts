// FREE AI FOR AN APP THE USER BUILT — the owner's own Z.ai key, on models that cost ₹0 (admin 2026-11-25).
//
// Admin, verbatim: *"navbharatai me jab bhi koi user ai banwaye, koi bhi ai … header me ❗ button me …
// login - sirf login kare … ganerate api - api keys copy kare … pest api keys … glm 4.5 flash, glm 4.6v
// flash glm 4.7 flash — yeh teeno free module hai. yahi use hone chahiye only!"*
//
// WHAT THIS IS, AND WHAT IT IS NOT. An app's assistant already answers with NO key at all, through
// NavBharatAI's own engine, charged to the owner's wallet (appAiAnswer.ts). That is the default and it
// does not change. This adds the owner's option to answer on THEIR OWN free account instead, so their
// app's AI costs them nothing — the same shape as the OpenAI/Anthropic own-key path beside it
// (appAiOwnKey.ts), with one hard extra rule:
//
// 🔒 ONLY THE THREE FREE MODELS, AND THE LIST IS AN ALLOWLIST, NEVER A NAME PATTERN.
// The key belongs to the USER. A paid model id on it spends the user's own money behind a button that
// said "free", so the id that may be sent is checked against an explicit list of three — the three that
// Z.ai's own price page prints as Free (quoted in `providerRates.ts`: "GLM-4.7-Flash FREE ·
// GLM-4.5-Flash FREE … GLM-4.6V-Flash FREE"). A matcher on the WORD "flash" would be wrong and this
// repo has already paid for that mistake three times: `glm-4.7-flashx` ($0.07/$0.40) and
// `glm-5.3-flash` ($0.15/$0.50) both contain "flash" and both cost money (see providerRates.ts's own
// warning beside those rows). So the override below can only NARROW the allowlist, never extend it.
//
// PURE — no I/O. The call itself lives in `appAiOwnKey.ts`, so every decision here is tested directly.

/** The vault name the owner's free-AI key is saved under. One constant: the route, the reader and the card. */
export const FREE_AI_KEY_NAME = 'ZAI_API_KEY';

/** Z.ai's OpenAI-compatible chat endpoint (international). The same base the platform's own GLM rungs use. */
export const FREE_AI_ENDPOINT = 'https://api.z.ai/api/paas/v4/chat/completions';

/** Where the owner makes the key. Quoted from Z.ai's own Quick Start, and from the admin's message. */
export const FREE_AI_KEY_PAGE = 'https://z.ai/manage-apikey/apikey-list';
/** Where the owner signs in / registers for the model API (NOT the chat product — that makes no API key). */
export const FREE_AI_LOGIN_PAGE = 'https://z.ai/model-api';

/**
 * THE ONLY MODELS THIS PATH MAY EVER SEND. Free on Z.ai's published price page; ids confirmed against
 * this repo's own live use of them (`weakBuildAdmission.ts`, `visionModels.ts`, `openAiCompatProvider`).
 */
export const FREE_AI_MODELS = Object.freeze({
  /** Default for every text question (admin: "normal chat ke liye default"). */
  chat: 'glm-4.7-flash',
  /** Automatic second try when the first is busy or rate-limited. Never offered as a choice. */
  fallback: 'glm-4.5-flash',
  /** Reserved for a question that carries an IMAGE. Not reachable yet — the app AI gateway carries no image. */
  vision: 'glm-4.6v-flash',
} as const);

/** Every id that is allowed on an owner's free key, in the order they are tried for a text question. */
export const FREE_AI_ALLOWED: readonly string[] = Object.freeze([
  FREE_AI_MODELS.chat,
  FREE_AI_MODELS.fallback,
  FREE_AI_MODELS.vision,
]);

/** True only for one of the three ids above. PURE. */
export function isFreeAiModel(model: string): boolean {
  return FREE_AI_ALLOWED.includes(String(model ?? '').trim().toLowerCase());
}

/**
 * The text ladder: the model to try first, then the one to try when it is busy.
 *
 * `APP_FREE_AI_MODELS` may NARROW this (a comma-separated list) — an id outside the allowlist is
 * dropped, and an override that leaves nothing falls back to the built-in order. It can never add a
 * paid id, which is the whole point of the allowlist above.
 */
export function freeAiTextLadder(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = String(env.APP_FREE_AI_MODELS ?? '').trim();
  const asked = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s && isFreeAiModel(s));
  // The vision id answers text too, but it is not put in a text ladder by default: it is the image
  // model, and a text question belongs on the text models.
  return asked.length > 0 ? asked : [FREE_AI_MODELS.chat, FREE_AI_MODELS.fallback];
}

/**
 * IS THIS "BUSY", i.e. worth the second rung? (admin: *"agar 4.7 busy ho ya limit lag jaye, to apne aap
 * isse jawab aaye"*).
 *
 * HTTP 429 is the plain case. Z.ai also answers its OWN business codes with 429 — its errors page lists
 * 1302 "Rate limit reached for requests", 1305 "service may be temporarily overloaded", 1308 "Usage
 * limit reached" — and a 5xx is a busy server by any reading. A 1113 ("insufficient balance") is NOT
 * busy: no amount of waiting fixes it, and on a free model it should never happen. PURE.
 */
export const FREE_AI_BUSY_CODES: readonly string[] = Object.freeze(['1302', '1305', '1308']);

export function isFreeAiBusy(status: number, body?: unknown): boolean {
  if (status === 429 || (status >= 500 && status <= 599)) return true;
  const code = (body as { error?: { code?: unknown } } | null | undefined)?.error?.code;
  return code != null && FREE_AI_BUSY_CODES.includes(String(code).trim());
}

/**
 * Does this look like a key at all, before a network call is spent on it?
 *
 * Deliberately shape-only and generous: Z.ai does not publish a key format, so anything that rejects a
 * real key would be worse than the one wasted request. It catches what people actually paste by
 * mistake — nothing, a sentence, a URL, the words from the page around the key.
 */
export function freeAiKeyLooksUsable(key: unknown): boolean {
  const k = String(key ?? '').trim();
  if (k.length < 20 || k.length > 400) return false;
  if (/\s/.test(k)) return false;
  return !/^https?:\/\//i.test(k);
}
