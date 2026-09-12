// WHAT A FREE CHAT TURN IS ALLOWED TO COST — a ceiling, set by the admin, enforced by a test.
//
// ── WHY A CEILING AND NOT A LIST (admin-mandated 2026-09-12) ──────────────────────────────────────
// The admin was shown the platform's whole rate card, drew a line under `kimi-k2.7`, and said "bas
// yahi tak rakho". A LIST of allowed model ids would go stale the first time a model is renamed or a
// rung is added; a PRICE ceiling cannot. So the rule is stated in money: nothing dearer than
// `kimi-k2.7` may ever serve a turn on the FREE chat ladder, whatever it is called.
//
// ── WHY THE INDEX IS BLENDED, NOT THE OUTPUT RATE ────────────────────────────────────────────────
// Ordering by output price alone is WRONG for chat, and by a margin that flips the answer. A grounded
// chat turn sends a large system prompt, the history, and up to two fetched pages — and gets back a
// few hundred tokens. It is INPUT-heavy. On the card, `glm-4.7` ($0.60 in / $2.20 out) looks cheaper
// than `gemini-flash` ($0.30 / $2.50) if you read only the output column, and is in fact DEARER for
// chat: the two break even exactly when output tokens equal input tokens, which a chat turn never
// does. So the index weights input by `CHAT_INPUT_WEIGHT` and the ladder is ordered by that.
//
// ⚠️ THE WEIGHT IS AN ASSUMPTION AND IS LABELLED AS ONE. Nobody has measured this platform's real
// input:output ratio yet — the chat route's usage logging records tokens only when a provider reports
// them. Eight is a deliberate, conservative reading of the prompt sizes involved, not a measurement.
// When real numbers exist, retune this ONE constant; every ordering follows from it.

import { realRateFor } from '../AgentV3/providerRates';

/** Input tokens per output token on a typical grounded chat turn. An assumption — see above. */
export const CHAT_INPUT_WEIGHT = 8;

/**
 * What one chat turn on this model costs, in arbitrary comparable units. PURE.
 *
 * Only ever compared against another model's index or against the ceiling — the absolute value means
 * nothing on its own, which is why it carries no currency.
 */
export function chatCostIndex(provider: string, model?: string): number {
  const rate = realRateFor(provider, model);
  return CHAT_INPUT_WEIGHT * rate.inputPerMTok + rate.outputPerMTok;
}

/**
 * The admin's line: `kimi-k2.7`. Anything dearer than this may not serve a free chat turn.
 *
 * Derived from the rate card rather than hardcoded, so a repriced kimi moves the ceiling with it and
 * the rule stays the one the admin actually gave ("up to kimi-k2.7") rather than a number that was
 * true on one afternoon.
 */
export function freeTierCeiling(): number {
  return chatCostIndex('KIMI', 'kimi-k2.7');
}

/** May this model serve a FREE chat turn? PURE. */
export function allowedOnFreeTier(provider: string, model?: string): boolean {
  return chatCostIndex(provider, model) <= freeTierCeiling();
}
