// WHICH MODELS ACCEPT A "TURN THINKING OFF" REQUEST — and the 280 failures that made this necessary.
//
// 🔴 THE INCIDENT (build report `58fe8254`, workspace `…f769ced8`, 2026-09-15). ONE free build recorded
// `providerFailures: { GLM: 280 }`, every one of them the SAME hard 400:
//
//     "This model always engages in thinking and cannot be disabled; please use low, high, or max"
//
// `glm-5.3-flash` is the FIRST rung of the Weak and Normal ladders and the PLAN rung of all three
// (tierLadder.ts), and `glm-5.3` is the first rung of Strong. So this was not an edge case: since the
// 2026-09-14 ladder change, **every build on every tier opened on a rung that could not succeed**, and
// the chain spent its whole budget falling through it — `GLM → GLM#2 → … and 80 more` on one build.
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
export type GlmThinkingParam = Record<string, never> | { thinking: { type: 'enabled' | 'disabled' } };

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
 * - `false`        → `{ type: 'disabled' }` **only** where that is actually supported; otherwise `{}`,
 *                    because the honest outcome of "please do not reason" on a model that always
 *                    reasons is that it reasons anyway — not that the build fails
 */
export function glmThinkingParam(model: string | undefined | null, thinking: unknown): GlmThinkingParam {
  if (typeof thinking !== 'boolean') return {};
  if (thinking) return { thinking: { type: 'enabled' } };
  return glmCanDisableThinking(model) ? { thinking: { type: 'disabled' } } : {};
}
