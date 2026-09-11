// THE USER MUST SEE SOMETHING WITHIN A BLINK — even when the answer honestly needs a moment.
//
// ── THE STALL THIS CLOSES (read from the chat route, 2026-09-11) ──────────────────────────────────
// A chat message that mentions "aaj", "latest", "price", "rate", "score", "weather", "news", "kaun",
// "kitna" — i.e. most everyday questions — is GROUNDED: the server runs a live lookup, then reads the
// top page, and ONLY THEN lets the model start speaking. The budgets are real: a web search bounded at
// six seconds followed by a page read bounded at four. So the worst case is **ten seconds of a
// completely blank screen**, and from the user's chair a working feature is indistinguishable from a
// broken one. The everyday questions are the slowest ones, which is exactly backwards.
//
// ── WHAT THIS FIXES, AND WHAT IT DELIBERATELY DOES NOT ───────────────────────────────────────────
// It does NOT make the lookup faster by skipping it — that would trade a correct answer for a quick
// one, and the grounding exists because the model's training data goes stale. What it removes is the
// SILENCE: the moment the route decides to ground, the stream opens and says so, so the first thing on
// screen arrives in a fraction of a second and the wait has a visible reason.
//
// 🔒 WHY A STATUS IS SAFE TO ADD TO AN EXISTING STREAM. It rides its own SSE field (`s`), and the
// client appends only `c` to the answer. An older client therefore IGNORES it entirely — the deploy is
// behaviour-identical until the client half ships, and a client that never gets the status still
// renders a perfect answer. A status is never part of the reply text and is never stored in history.
//
// 🔒 WHITE-LABEL. The line says what NavBharatAI is doing, never who it asks. No vendor, no model, no
// "searching Google" — the same law the build narration follows.
//
// PURE — no I/O, no clock, no Express.

import { needsLiveSearch } from './liveSearchContext';

/**
 * The one status line shown while a grounded answer is being prepared, or '' when nothing will be
 * fetched and the model answers immediately.
 *
 * Returning '' for the ordinary case is the important half: a status on a message that was never going
 * to wait would be a spinner for nothing, which teaches users to distrust the one that means something.
 */
export function groundingStatusFor(message: string): string {
  return needsLiveSearch(String(message ?? '')) ? GROUNDING_STATUS : '';
}

/**
 * Honest, specific, and short. "Checking live sources" is literally what happens next, it explains why
 * this particular answer is worth a moment, and it names nobody.
 */
export const GROUNDING_STATUS = 'Checking live sources for the latest…';

/** Milliseconds past which a first token is worth flagging in the logs as slow. */
export const SLOW_FIRST_TOKEN_MS = 2_500;

export interface FirstTokenFacts {
  /** ms from the request arriving to the first word of the answer leaving us. */
  ms: number;
  /** Did this message take the live-lookup path? */
  grounded: boolean;
  tier: string;
}

/**
 * The single line the server logs about how fast a reply started.
 *
 * It exists because every claim about chat speed in this repo has so far been read off the CODE rather
 * than measured — including the ten-second figure above, which is a budget, not an observation. A
 * grounded and an ungrounded reply are reported separately, because averaging them hides the only
 * number that matters: the two paths have completely different costs.
 */
export function firstTokenLog(f: FirstTokenFacts): string {
  const ms = Math.max(0, Math.round(Number(f?.ms) || 0));
  const path = f?.grounded ? 'grounded' : 'direct';
  const slow = ms >= SLOW_FIRST_TOKEN_MS ? ' SLOW' : '';
  return `[CHAT_TTFT] tier=${f?.tier ?? 'unknown'} path=${path} firstTokenMs=${ms}${slow}`;
}
