// WHICH MODELS ACCEPT A "TURN THINKING OFF" REQUEST — and the 280 failures that made this necessary.
//
// 🔴 THE INCIDENT (build report `58fe8254`, workspace `…f769ced8`, 2026-09-15). ONE free build recorded
// `providerFailures: { GLM: 280 }`, every one of them the SAME hard 400:
//
//     "This model always engages in thinking and cannot be disabled; please use low, high, or max"
//
// At the time, `glm-5.3-flash` LED the Weak and Normal ladders and `glm-5.3` led Strong, so this was
// not an edge case: **every build on every tier opened on a rung that could not succeed**, and the
// chain spent its whole budget falling through it — `GLM → GLM#2 → … and 80 more` on one build.
//
// ⚠️ THAT SENTENCE IS HISTORY, NOT THE CURRENT LADDER — and it is written in the past tense for a
// reason this repo has already paid for (2026-09-15: four comments claiming GPT was on the Weak ladder
// stayed true for one day and wrong for weeks, because `tsc` and `vitest` cannot read a comment). The
// lead rung moved to `glm-4.7-flashx` on 2026-09-17 — partly BECAUSE of this very defect, since 4.x
// can be told not to reason and 5.3 cannot. **`TIER_LADDERS` in tierLadder.ts is the only place a rung
// exists; do not restate it here.** This module needs no ladder knowledge at all: `glmCanDisableThinking`
// is a numeric family test, so a rung added later is covered the day it ships.
//
// 🔎 THE CLASS WAS ALREADY ROOT-CAUSED HERE, FOR THE OTHER VENDOR, AND THE SIBLING WAS NEVER HUNTED.
// `models.ts`'s `modelSupportsAdaptiveThinking` exists because of the identical failure on Anthropic
// (2026-07-05): a Haiku turn sent `thinking: { type: 'adaptive' }`, got a hard 400, and "burned the
// ENTIRE provider-fallback chain". Its docblock states the cure in one sentence:
//
//   "a MISSING thinking/effort param never 400s (we merely lose the reasoning display), whereas an
//    UNSUPPORTED one is a fatal request error."
//
// That guard was applied to the Claude client and not to the OpenAI-compatible one — which is exactly
// the shape this repo keeps paying for (`a38c6fef`: the instance was fixed, the class was not).
//
// 🔒 NOTE WHAT THE CLAUDE SIDE DOES, because it is the correct design and this module copies it:
// `ClaudeClient` sends the param ONLY to turn thinking **on** (`if (params.thinking && extendedReasoning)`)
// and otherwise omits it entirely. It never asks a model to turn thinking OFF. The GLM path did, and an
// always-reasoning model can only answer that with an error.
//
// ⚠️ DEFAULT-DENY ON AN UNKNOWN ID, deliberately, for the reason models.ts already gives: a model we do
// not recognise keeps its own default (it may think, which costs output tokens) and the call SUCCEEDS.
// The other direction — assume it can be disabled — is precisely how a new model id reproduces this
// incident on its first day in the ladder.

/** GLM's request extension: `{ thinking: { type } }`, or nothing at all. */
export type GlmThinkingLevel = 'enabled' | 'disabled' | 'low' | 'high' | 'max';
export type GlmThinkingParam = Record<string, never> | { thinking: { type: GlmThinkingLevel } };

/**
 * What to send when the caller wants thinking OFF and the model refuses to turn it off.
 *
 * 🔴 "CANNOT BE DISABLED" IS NOT "CANNOT BE REDUCED", AND THE PROVIDER SAID SO IN THE SAME SENTENCE
 * (autopsy ee20478d, 2026-09-15). The 400 that produced this module reads, in full:
 *
 *     "This model always engages in thinking and cannot be disabled; please use low, high, or max"
 *
 * The first clause was acted on and **the second was not**. This module's first version sent NO
 * thinking field at all in that case — which does not mean "think less", it means "use your DEFAULT
 * effort". On glm-5.3-flash that default consumed the entire 4,833-token output ceiling on three
 * consecutive turns and produced no text and no tool call: a build that wrote nothing in five minutes
 * while every call returned HTTP 200.
 *
 * `low` is the provider's own lowest named level, so the user's "thinking off" preference is honoured
 * as closely as the model permits, and the reasoning stops crowding out the answer.
 *
 * ⚠️ IT IS A DELIBERATE, SELF-CORRECTING BET. The three level names come from the provider's error
 * text, not from a document this session could read, so the exact field shape is unverified. That is
 * why `isThinkingParamRejection` exists and why the runner drops the field and retries ONCE when a
 * model rejects it: if the bet is wrong, the cost is one extra round-trip on the first call of the
 * process and then byte-identical behaviour to before. A bet that cannot be checked would not be
 * acceptable here; one that checks itself on first contact is.
 */
export const GLM_REDUCED_THINKING: GlmThinkingLevel = 'low';

/**
 * Can this GLM model be told NOT to reason? PURE.
 *
 * `true` only for the families that shipped with this feature and were observed to accept it; `false`
 * for the always-reasoning 5.3+ family, and `false` for anything unrecognised.
 *
 * ⚠️ The version test is a NUMERIC comparison, not a string match, so `glm-5.4`, `glm-6` and every
 * later id are covered the moment they exist — a list of exact ids would have to be edited by whoever
 * adds the next rung, and the whole point of this module is that nobody has to remember.
 */
export function glmCanDisableThinking(model: string | undefined | null): boolean {
  const m = String(model ?? '').toLowerCase().trim();
  if (!m.startsWith('glm-')) return false;            // not a GLM id → we know nothing → deny
  const version = /^glm-(\d+)(?:\.(\d+))?/.exec(m);
  if (!version) return false;                          // unparseable version → deny
  const major = Number(version[1]);
  const minor = Number(version[2] ?? 0);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return false;
  // 5.3 is the first family that always reasons. Anything at or above it cannot be disabled.
  if (major > 5) return false;
  if (major === 5 && minor >= 3) return false;
  return true;                                         // glm-4.x and glm-5.0/5.1/5.2 — the known-good set
}

/**
 * The `thinking` request field to merge into a GLM chat-completions call, or `{}` to send none. PURE.
 *
 * - not a boolean  → `{}`  (the caller has no opinion; unchanged from before this module existed)
 * - `true`         → `{ type: 'enabled' }` — asking a model to reason is accepted by every GLM model,
 *                    including the always-reasoning ones, so this needs no capability check
 * - `false`        → `{ type: 'disabled' }` where that is supported; otherwise `{ type: 'low' }` —
 *                    the provider's own lowest named level. Sending NOTHING was the bug: it selects
 *                    the model's DEFAULT effort, which is the most reasoning, not the least. See
 *                    GLM_REDUCED_THINKING above for why this is a safe bet rather than a guess.
 */
export function glmThinkingParam(model: string | undefined | null, thinking: unknown): GlmThinkingParam {
  if (typeof thinking !== 'boolean') return {};
  if (thinking) return { thinking: { type: 'enabled' } };
  return glmCanDisableThinking(model)
    ? { thinking: { type: 'disabled' } }
    : { thinking: { type: GLM_REDUCED_THINKING } };
}

/**
 * Did the provider reject our THINKING field specifically? PURE.
 *
 * Deliberately narrow. It must match a complaint about this one optional field and nothing else,
 * because the only action taken on a true answer is "drop the field and try again" — and retrying a
 * genuinely bad request (a malformed tool schema, an oversized prompt) without changing it would be a
 * retry loop around a deterministic failure, which the fourth absolute rule forbids by name.
 *
 * Matches the two shapes a rejection of an unknown enum value actually takes: the provider naming the
 * field, or naming thinking/reasoning in an invalid-parameter complaint.
 */
export function isThinkingParamRejection(error: unknown): boolean {
  const text = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase();
  if (!text) return false;
  if (!/\bthinking\b|\breasoning(?:_effort)?\b/.test(text)) return false;
  return /\b400\b|invalid|unsupported|unrecognized|unrecognised|not (?:a )?(?:valid|supported)|bad request|must be one of/.test(text);
}
