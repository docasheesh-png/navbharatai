// THE NAVBHARATAI DEVELOPER API — the pure rules behind Developer Tools → NavBharatAI API.
//
// 🔴 WHY THIS EXISTS (admin 2026-09-17, on seeing the API Keys card at the bottom of My Profile):
// two of its three scopes did nothing, and the whole thing sat where a non-technical user would meet
// it first. The admin's brief, in their words: *"system working hona chahiye, api keys farzi nahi ho,
// kam kare"* — and the reason a real API matters at all: *"ho sakta hai, user apna ai banaye aur hamare
// api key dal ke chalaye"*. A person builds their own AI program, drops in a NavBharatAI key, and it
// answers. That is the door this module opens.
//
// THREE LAWS SHAPE EVERY DECISION HERE:
//
//   • THE ONE-WALLET LAW. An answer served through a key costs exactly what the same answer costs in
//     the app, drawn from the SAME balance, by the SAME `chargeForAiTurns`. A free-model answer is ₹0
//     here exactly as it is there. Nothing here invents a price.
//   • THE WHITE-LABEL LAW. The response says `model: "navbharatai"` and nothing else, ever. A developer
//     is a user; the vendor behind the answer is admin-only.
//   • THE CAP IS THE REAL DEFENCE (the same lesson `appAiGateway.ts` records at length). A key is a
//     secret the holder may paste somewhere it should not go. Every key therefore carries a DAILY ₹
//     CEILING the holder sets, so a leaked key can cost at most one day's cap — never the wallet.
//
// 🔑 OPENAI-COMPATIBLE ON PURPOSE. `POST /chat/completions` with `messages: [{role, content}]` in and
// `choices[0].message.content` out is the shape every AI SDK on earth already speaks. A developer
// points their existing client at our base URL and it works; a bespoke shape would cost them a
// rewrite for no gain. Non-streaming only for now — said plainly rather than half-built.
//
// PURE — no I/O, no clock, no env. The route owns every byte of I/O.

import type { ApiScope } from './ApiKeyManager';

// ── Per-key daily cap ────────────────────────────────────────────────────────────────────────────

/**
 * What one key may spend in a day, in rupees, unless the holder chooses otherwise.
 *
 * ₹50 is deliberately modest. This is a secret that lives outside the app — in a script, a server, a
 * teammate's laptop — and the failure the holder would never forgive is a leaked key emptying their
 * balance overnight. A floor to raise from, per key, on the screen where the key is made.
 */
export const DEFAULT_KEY_DAILY_CAP_INR = 50;
export const MIN_KEY_DAILY_CAP_INR = 1;
/** The most any single key may be allowed to spend in a day. Above this the wallet itself is the cap. */
export const MAX_KEY_DAILY_CAP_INR = 1000;

/**
 * Read a requested cap. Junk, blank or absent ⇒ the default; out of range ⇒ clamped. PURE.
 *
 * ⚠️ Blank means UNSET, not zero — `Number('')` is 0 — and a zero cap would be a key that can never
 * answer, which nobody types on purpose.
 */
export function normalizeDailyCapInr(v: unknown): number {
  const text = String(v ?? '').trim();
  if (!text) return DEFAULT_KEY_DAILY_CAP_INR;
  const n = Number(text);
  if (!Number.isFinite(n)) return DEFAULT_KEY_DAILY_CAP_INR;
  return Math.min(MAX_KEY_DAILY_CAP_INR, Math.max(MIN_KEY_DAILY_CAP_INR, Math.round(n)));
}

// ── The chat request ─────────────────────────────────────────────────────────────────────────────

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

/** The most conversation one request may carry. Enough for a real assistant, bounded for the wallet. */
export const MAX_CHAT_MESSAGES = 40;
export const MAX_CHAT_TOTAL_CHARS = 24_000;

export type ChatRequestVerdict =
  | { ok: true; system: string; messages: ChatMessage[] }
  | { ok: false; reason: 'no-messages' | 'bad-message' | 'too-many' | 'too-long' | 'no-user-turn' };

/**
 * Read an OpenAI-shaped request body into what the engine needs. PURE, total, never throws.
 *
 * Accepts `messages: [...]` (the standard), and as a courtesy `prompt: "..."` for a one-liner. A
 * `system` role message is folded into the system prompt; the last message must be the user's, or
 * there is nothing to answer.
 */
export function readChatCompletionRequest(body: unknown): ChatRequestVerdict {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  let raw: unknown[] = [];
  if (Array.isArray(b.messages)) raw = b.messages;
  else if (typeof b.prompt === 'string' && b.prompt.trim()) raw = [{ role: 'user', content: b.prompt }];
  if (raw.length === 0) return { ok: false, reason: 'no-messages' };
  if (raw.length > MAX_CHAT_MESSAGES) return { ok: false, reason: 'too-many' };

  const systemParts: string[] = [];
  const messages: ChatMessage[] = [];
  let total = 0;
  for (const m of raw) {
    const msg = (m && typeof m === 'object' ? m : {}) as Record<string, unknown>;
    const role = String(msg.role ?? '').trim();
    const content = typeof msg.content === 'string' ? msg.content : contentFromParts(msg.content);
    if (content === null) return { ok: false, reason: 'bad-message' };
    total += content.length;
    if (total > MAX_CHAT_TOTAL_CHARS) return { ok: false, reason: 'too-long' };
    if (role === 'system') { if (content.trim()) systemParts.push(content.trim()); continue; }
    if (role !== 'user' && role !== 'assistant') return { ok: false, reason: 'bad-message' };
    messages.push({ role, content });
  }
  if (messages.length === 0 || messages[messages.length - 1].role !== 'user') return { ok: false, reason: 'no-user-turn' };
  if (!messages[messages.length - 1].content.trim()) return { ok: false, reason: 'no-user-turn' };
  return { ok: true, system: systemParts.join('\n\n'), messages };
}

/** OpenAI also allows `content: [{type:'text', text}]`. Text parts are joined; anything else is refused. */
function contentFromParts(v: unknown): string | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const part of v) {
    const p = (part && typeof part === 'object' ? part : {}) as Record<string, unknown>;
    if (p.type === 'text' && typeof p.text === 'string') out.push(p.text);
    else return null;
  }
  return out.join('\n');
}

/**
 * The system prompt every API answer is produced under.
 *
 * 🔒 WHITE-LABEL LAW, applied to a program somebody else wrote. The developer's own instructions
 * come AFTER this on purpose: they shape the assistant's job, they do not get to rename the engine.
 */
export const DEVELOPER_API_SYSTEM_PROMPT =
  'You are NavBharatAI, answering through the NavBharatAI API for a developer\'s own program. ' +
  'Never name, hint at, or speculate about which AI model, company or provider is answering — ' +
  'if asked, say you are NavBharatAI. Answer helpfully, accurately and concisely, in the language the user writes in.';

/**
 * Fold a conversation into the single prompt the shared chain accepts. PURE.
 *
 * The professional chain takes one prompt, not a message list; earlier turns are presented as a
 * transcript so the model keeps the thread, and the final user turn is asked plainly.
 */
export function foldMessagesToPrompt(messages: readonly ChatMessage[]): string {
  if (messages.length === 0) return '';
  const last = messages[messages.length - 1];
  const earlier = messages.slice(0, -1);
  if (earlier.length === 0) return last.content;
  const transcript = earlier
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');
  return `[Conversation so far]\n${transcript}\n\n[Now answer this]\nUser: ${last.content}`;
}

// ── The spend decision ───────────────────────────────────────────────────────────────────────────

export type KeyRefusal = 'key-cap' | 'wallet-empty';
export type KeyDecision = { allow: true } | { allow: false; reason: KeyRefusal };

/**
 * May this key answer one more question right now? PURE.
 *
 * The key's own cap comes FIRST: it is the holder's stated limit for this key, and it must bite even
 * on an account with plenty of balance — that is the whole point of a per-key ceiling. The wallet
 * check is skipped for a free-listed account (the admin/test courtesy every other assistant honours);
 * the cap never is, because a leaked key is a leaked key whoever owns it.
 *
 * An UNREADABLE balance (`null`) is allowed through — fail-open, matching every other money gate on
 * the platform; the debit still records the debt honestly.
 */
export function keyDecision(input: {
  spentTodayInr: number;
  capInr: number;
  walletBalanceInr: number | null;
  freeListed: boolean;
}): KeyDecision {
  const spent = Number.isFinite(input.spentTodayInr) ? Math.max(0, input.spentTodayInr) : 0;
  const cap = Number.isFinite(input.capInr) && input.capInr > 0 ? input.capInr : DEFAULT_KEY_DAILY_CAP_INR;
  if (spent >= cap) return { allow: false, reason: 'key-cap' };
  if (!input.freeListed && input.walletBalanceInr !== null && input.walletBalanceInr <= 0) {
    return { allow: false, reason: 'wallet-empty' };
  }
  return { allow: true };
}

// ── The response ─────────────────────────────────────────────────────────────────────────────────

/** The one model name a caller ever sees. The vendor behind it is admin-only (White-Label Law). */
export const PUBLIC_MODEL_NAME = 'navbharatai';

export interface ChatCompletionUsage { prompt_tokens: number; completion_tokens: number; total_tokens: number }

/**
 * An OpenAI-shaped completion. PURE.
 *
 * `usage` is included ONLY when the provider reported it — a fabricated count would be the estimate
 * the wallet law forbids, and a developer may be metering on it. Absent means "not measured".
 */
export function chatCompletionResponse(
  content: string,
  opts: { id: string; createdMs: number; usage?: { inputTokens?: number; outputTokens?: number } | null },
): Record<string, unknown> {
  const inTok = Number(opts.usage?.inputTokens);
  const outTok = Number(opts.usage?.outputTokens);
  const measured = Number.isFinite(inTok) && Number.isFinite(outTok) && (inTok > 0 || outTok > 0);
  return {
    id: `chatcmpl-${opts.id}`,
    object: 'chat.completion',
    created: Math.floor(opts.createdMs / 1000),
    model: PUBLIC_MODEL_NAME,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    ...(measured
      ? { usage: { prompt_tokens: Math.round(inTok), completion_tokens: Math.round(outTok), total_tokens: Math.round(inTok + outTok) } as ChatCompletionUsage }
      : {}),
  };
}

export type ApiErrorCode =
  | 'missing_scope' | 'invalid_request' | 'content_policy' | 'daily_cap_reached'
  | 'insufficient_balance' | 'rate_limited' | 'engine_unavailable';

/** The error envelope every v1 route returns — one shape a client can branch on. PURE. */
export function apiError(code: ApiErrorCode, message: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { error: { code, message, ...extra } };
}

/**
 * The words a developer reads when a key is refused.
 *
 * 🔒 Branded, and honest about WHOSE limit it is — a cap the holder set is not a platform outage,
 * and telling them so is what lets them fix it in ten seconds on the Developer Tools page.
 */
export function refusalMessage(reason: KeyRefusal, capInr: number): string {
  switch (reason) {
    case 'key-cap':
      return `This key has reached its daily limit of ₹${capInr}. Raise the limit on the Developer Tools page, or use it again after midnight UTC.`;
    case 'wallet-empty':
      return 'Your NavBharatAI wallet is empty. Add balance in the app and this key will answer again.';
  }
}

/** The HTTP status for each refusal. 402 is the standard word for "pay first"; 429 for "too much today". */
export function refusalStatus(reason: KeyRefusal): number {
  return reason === 'wallet-empty' ? 402 : 429;
}

// ── Per-key rate limit ───────────────────────────────────────────────────────────────────────────

/** Requests one key may make per minute. A cap bounds rupees; this bounds the trickle a cap cannot see. */
export const KEY_REQUESTS_PER_MINUTE = 60;

export interface RateWindow { windowStartMs: number; count: number }

/**
 * Fixed-window counter for one key. PURE — returns the next state and whether this request is allowed.
 * The window is a minute, and the state is small enough to live in memory per instance: a burst that
 * slips through on a second instance still meets the ₹ cap, which is the defence that matters.
 */
export function takeRateSlot(prev: RateWindow | undefined, nowMs: number, limit = KEY_REQUESTS_PER_MINUTE): { next: RateWindow; allowed: boolean } {
  const windowMs = 60_000;
  if (!prev || nowMs - prev.windowStartMs >= windowMs) return { next: { windowStartMs: nowMs, count: 1 }, allowed: true };
  const count = prev.count + 1;
  return { next: { windowStartMs: prev.windowStartMs, count }, allowed: count <= limit };
}

// ── Which scope guards which door ────────────────────────────────────────────────────────────────

/** Stated here so a test can assert every scope is enforced by a real route. */
export const SCOPE_ROUTES: Readonly<Record<ApiScope, { method: 'GET' | 'POST'; path: string }>> = {
  'read:profile': { method: 'GET', path: '/api/v1/me' },
  'read:usage': { method: 'GET', path: '/api/v1/usage' },
  'read:builds': { method: 'GET', path: '/api/v1/builds' },
  'ai:chat': { method: 'POST', path: '/api/v1/chat/completions' },
};

/** The day a key's spend is counted against — UTC, on the server's clock, like every other rollup. */
export function keyDayKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}
