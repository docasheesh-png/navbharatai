// THE CLOCK MUST FIT THE ASK — why a build that ran for ten minutes wrote zero files.
//
// 🔴 THE DEFECT, and it is arithmetic rather than opinion (autopsy 4efab9d7, 2026-09-15). The admin
// asked the exact right question: *"builder ne ek bhi file kyu nahi banayi?"*
//
// The build loop authorises the model to produce **32,000 output tokens** per turn
// (`buildMaxTokensPerTurn`). The cheap-floor rung gave it **60 seconds**
// (`AGENTV3_CHEAP_FLOOR_TIMEOUT_MS`, default 60_000, handed to `new OpenAI({ timeout })`). Those two
// numbers were set years apart by different changes and nothing ever compared them.
//
// From that build's OWN two successful turns — same model, same night, same prompt shape:
//     111 output tokens → 7,466 ms      182 output tokens → 9,631 ms
//     ⇒ ≈ 4.1 s fixed overhead + ≈ 30.5 ms per output token
// So in 60 seconds that model could emit **about 1,830 tokens**. We had authorised **32,000** — more
// than seventeen times what the clock could carry, and about sixteen minutes of generation.
//
// Which is why turns 1 and 2 passed and turn 3 died: the first two emitted 111 and 182 tokens (tool
// calls with no content). Turn 3 was THE TURN THAT WRITES THE FILES — the one that actually uses the
// budget — and it could not fit, on any key. The eight GLM failures in that report are spaced
// 60,006 / 60,010 / 60,007 / 60,005 / 60,003 / 60,004 / 60,004 ms apart: a seven-millisecond spread
// across seven gaps. That is not a provider failing. **That is our own clock, firing eight times.**
// The turn then hit its own 480 s ceiling having learned nothing, and the app was reported as not
// built. So the engine was structurally incapable of writing a file whenever the floor was slow —
// not unlucky, incapable.
//
// 🔑 THE INVARIANT THIS MODULE EXISTS TO HOLD: **never authorise more output than the clock can
// carry.** When the two disagree, the ASK is clamped to the CLOCK — and that is the whole point,
// because the two failure modes are not equally bad:
//
//     TRUNCATION  (finish_reason: 'length')  the files written so far COME BACK. The truncation
//                                            guard already names the one file that was cut.
//     TIMEOUT     (our clock kills the call) NOTHING comes back. Ten minutes, zero files.
//
// A turn that asks for more than it can deliver converts a recoverable partial success into a total
// loss. Clamping the ask makes the worst case "one file short" instead of "no app".
//
// PURE. No I/O, no clock, no env read except through the named getters below.

/**
 * Milliseconds per output token the floor is expected to sustain.
 *
 * MEASURED, not guessed: 30.5 ms/token from the two successful turns of build 4efab9d7 (above), on a
 * night that provider was visibly degraded. A healthy flash model is several times quicker, so sizing
 * to this is deliberately conservative — it is the rate we are still willing to WAIT for, and a
 * provider slower than this is one we would rather fall past than sit behind.
 * Env-tunable (`AGENTV3_FLOOR_MS_PER_TOKEN`); junk falls back to the measured value.
 */
export const FLOOR_MS_PER_OUTPUT_TOKEN_DEFAULT = 30;
/** Connection, prompt upload and first-token latency, before generation starts. */
export const FLOOR_CALL_OVERHEAD_MS = 5_000;
/**
 * The ceiling on one floor call.
 *
 * Sized against the turn budget rather than picked: a build turn gets 480 s, the in-run bench retires
 * a provider FAMILY after 2 consecutive timeouts (PR #2951), so the worst case a healthy ladder must
 * absorb is 2 × this before it reaches the next vendor. At 150 s that is 300 s, leaving 180 s for the
 * vendor behind it. Raising this without re-checking that sum is how a slow provider eats a whole turn
 * again.
 *
 * ⚠️ AND THAT SUM NO LONGER DESCRIBES A STREAMED CALL — read this before reasoning from the paragraph
 * above (2026-09-16). With `AGENTV3_STREAM_BUILD_CALLS` on, `OpenAiToolRunner` bounds the call with
 * `streamHardCapMs()` (300 s) INSTEAD of this constant, which that path never consults. So the
 * arithmetic becomes 2 × 300 s = 600 s against a 480 s turn — there is no 180 s reserve left for the
 * vendor behind it.
 *
 * 🔑 WHY THAT IS STILL SAFE, and the one case where it is not. A streamed call is bounded by SILENCE:
 * a genuine stall fires at `streamIdleMs()` (60 s), not at 300 s, so the ceiling is reached only by a
 * provider that is actively emitting — and one that emits an ANSWER returns it as a truncated turn
 * rather than dying. The exposure is the narrow case autopsy ee20478d already named: a reasoning model
 * that streams `reasoning_content` and nothing else can now hold a rung for 300 s instead of 150 s
 * before yielding nothing. It ends as our-clock (`BUDGET_REACHED_MESSAGE`), so it correctly does NOT
 * bench the provider — which also means nothing shortens its second attempt.
 *
 * Left as measured behaviour rather than re-tuned on a guess: the honest input is what real streamed
 * builds do, which is what `USAGE_NOT_REPORTED` and the report's timing lines exist to show.
 */
export const FLOOR_TIMEOUT_CAP_MS = 150_000;
/** Below this, a call cannot deliver anything useful — a floor under the floor. */
export const FLOOR_TIMEOUT_MIN_MS = 20_000;

function envNumber(raw: string | undefined, fallback: number): number {
  const n = Number(String(raw ?? '').trim());
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function floorMsPerOutputToken(env: NodeJS.ProcessEnv = process.env): number {
  return envNumber(env.AGENTV3_FLOOR_MS_PER_TOKEN, FLOOR_MS_PER_OUTPUT_TOKEN_DEFAULT);
}

/** How long a call needs to deliver `maxTokens` of output at the floor rate. Capped. Pure. */
export function floorTimeoutForTokens(maxTokens: number, env: NodeJS.ProcessEnv = process.env): number {
  const tokens = Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : 0;
  const needed = FLOOR_CALL_OVERHEAD_MS + tokens * floorMsPerOutputToken(env);
  return Math.max(FLOOR_TIMEOUT_MIN_MS, Math.min(FLOOR_TIMEOUT_CAP_MS, Math.round(needed)));
}

/** How many output tokens a call can honestly deliver inside `timeoutMs`. Pure; never negative. */
export function floorMaxTokensForTimeout(timeoutMs: number, env: NodeJS.ProcessEnv = process.env): number {
  const ms = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 0;
  const usable = ms - FLOOR_CALL_OVERHEAD_MS;
  if (usable <= 0) return 0;
  return Math.max(1, Math.floor(usable / floorMsPerOutputToken(env)));
}

export interface FloorBudget {
  /** What to authorise the model to produce — never more than the clock can carry. */
  maxTokens: number;
  /** True when the caller's ask was larger than the clock and had to be cut down. */
  clamped: boolean;
  /** The ask the caller made, kept so the report can say what was reduced and why. */
  requested: number;
  /** True when the clamp was deliberately not applied because this rung always reasons. */
  reasoningUnclamped?: boolean;
}

/**
 * 🔴 THE CLAMP IS INVERTED FOR A MODEL THAT ALWAYS REASONS — autopsy f5351721, 2026-09-17.
 *
 * Everything above justifies clamping on ONE asymmetry, stated at the top of this file:
 *
 *     TRUNCATION (we ran out of ceiling)  →  the files written so far COME BACK.
 *     TIMEOUT    (we ran out of clock)    →  NOTHING comes back.
 *
 * **For a forced-reasoning rung both halves of that are false, and they are false in opposite
 * directions.** Its thinking is billed to the same `max_tokens` and emitted BEFORE any content, so
 * running out of CEILING is the total loss (`finish_reason: 'length'`, no text, no tool call —
 * `turnStarvedItsBudget`). Meanwhile running out of CLOCK under streaming keeps whatever had already
 * arrived. The clamp is therefore trading the recoverable outcome for the unrecoverable one — the
 * exact inversion of the reason it exists.
 *
 * THE EVIDENCE, from the build that produced this (Strong tier, `glm-5.3`, 30 calls):
 *   • 3 calls returned reasoning and nothing else, each authorised exactly 9,833 tokens.
 *   • The first of them finished **131 seconds** into a 300-second clock. It did not run out of time;
 *     it ran out of ceiling with **58% of its clock unused.**
 *   • The calls that DID succeed used 8,651 / 9,199 / 9,746 output tokens — the ceiling is 9,833, so
 *     every first turn was a coin flip decided by how long the model happened to think.
 *
 * ⚠️ AND THE FIX IS NOT A FASTER RATE CONSTANT — that was measured and rejected. Across 73 real calls
 * in the reports to hand, `FLOOR_MS_PER_OUTPUT_TOKEN_DEFAULT` is well calibrated: kimi-k2.6 aggregates
 * to **30.5 ms/token** against our 30, and the fleet median is 25.1 with a p90 of 48.1. Lowering it to
 * suit the one fast model would under-bound every slow one and re-open the class this file was written
 * for. The rate is right; applying it to tokens that are not the answer is what is wrong.
 *
 * 🔒 WHY UNCLAMPING CANNOT MAKE THINGS WORSE, which is what made it shippable without a tier change:
 * the clock still bounds the call. A slow forced-reasoning rung is still cut at the same moment it is
 * cut today, still with no answer, and still throws to the next rung — identical. What changes is only
 * the case where the answer WOULD have fitted and our own ceiling stopped it first.
 */
export const REASONING_UNCLAMP_OFF = 'off';

/** Kill switch. `off` restores the pre-2026-09-17 behaviour exactly: every rung is clamped. */
export function reasoningUnclampEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_REASONING_UNCLAMP ?? '').trim().toLowerCase() !== REASONING_UNCLAMP_OFF;
}

/**
 * Reconcile the caller's token ask with the clock the call actually has. Pure.
 *
 * `timeoutMs` must be the EFFECTIVE clock — after `turnDeadline` has reconciled the runner's own bound
 * with the lane's remaining budget — because a lane with 30 seconds left must not authorise a
 * 32,000-token answer either. The whole rule in one line: ask for what you can be given.
 */
export function reconcileFloorBudget(
  requestedMaxTokens: number,
  timeoutMs: number,
  env: NodeJS.ProcessEnv = process.env,
  opts: { alwaysReasons?: boolean } = {},
): FloorBudget {
  const requested = Number.isFinite(requestedMaxTokens) && requestedMaxTokens > 0 ? Math.floor(requestedMaxTokens) : 0;
  const affordable = floorMaxTokensForTimeout(timeoutMs, env);
  // A rung whose thinking is billed to this same ceiling keeps the caller's ask; the clock remains the
  // only bound. See REASONING_UNCLAMP_OFF above for why this is the safe direction and not a widening.
  if (opts.alwaysReasons && requested > 0 && requested > affordable && reasoningUnclampEnabled(env)) {
    return { maxTokens: requested, clamped: false, requested, reasoningUnclamped: true };
  }
  if (requested <= 0) return { maxTokens: affordable, clamped: false, requested };
  if (requested <= affordable) return { maxTokens: requested, clamped: false, requested };
  return { maxTokens: affordable, clamped: true, requested };
}

// ─────────────────────────────────────────────────────────────────────────────
// THE OTHER HALF OF THE CLAMP: a budget small enough to be spent on NOTHING.
//
// 🔴 THE DEFECT THIS SECTION EXISTS FOR (autopsy ee20478d, 2026-09-15). The clamp above converts a
// TIMEOUT into a TRUNCATION, and justifies itself on the grounds that a truncation "returns the files
// written so far". That is true of a model that emits its tool calls as it goes. **It is false of a
// REASONING model, whose thinking is billed to the very same `max_tokens` and is emitted BEFORE any
// content exists.** Give such a model a budget smaller than its thinking and it returns
// `finish_reason: 'length'` with no text, no tool call and nothing to salvage — the total loss the
// clamp was written to prevent, arrived at by the clamp.
//
// The arithmetic, which is what makes this a fact rather than a reading: FLOOR_TIMEOUT_CAP_MS (150_000)
// − FLOOR_CALL_OVERHEAD_MS (5_000) = 145_000 ms ÷ 30 ms/token = **4,833**. That is a CONSTANT — the
// most any floor rung can ever be authorised, whatever it asks for. It is why report 58fe8254 shows
// `outputTokens: 4833` three times on Kimi and report ee20478d shows `outputTokens: 4833` three times
// on GLM, on different models, on different nights. Two vendors cannot independently stop at the same
// number. It was ours.
//
// In ee20478d all three calls returned `ok: true`, so not one of them appeared in the provider-failure
// ledger, and every honesty check the platform owns reads that ledger. The build wrote zero files in
// five minutes, reported "the model replied without building" — it never replied — and asked the user
// to buy a stronger engine for an arithmetic error of ours.
//
// 🔑 THE RULE: a turn that could not BEGIN an answer is a failure of that rung, never an answer from
// it. Naming it here, next to the clamp that causes it, so the two can never again be reasoned about
// separately.

/**
 * The marker a starved turn is reported under.
 *
 * ⚠️ WORDED TO SURVIVE THE CLASSIFIERS, and each omission is deliberate. It must NOT match
 * `isTimeoutProviderError` (/timed? ?out|timeout/) or the provider would be benched for our budgeting;
 * nor `classifyProviderFailure`'s `context-length` test (/max tokens|token limit|too long/), which
 * would blame the prompt's size for a cap on the answer; nor `isModelUnavailableError`
 * (/model.{0,20}(?:unavailable|deprecated|retired)/), which would retire a perfectly reachable rung as
 * dead for ever. Changing this string means re-reading all three.
 */
export const STARVED_BUDGET_MESSAGE = 'the output budget ran out before the answer began';

/** The shape a starved turn is recognised by — a subset of TurnResult, so this stays pure. */
export interface StarvableTurn {
  text?: string;
  toolUses?: unknown[];
  /** finish_reason was 'length' — the answer was cut at the authorised ceiling. */
  truncated?: boolean;
  /** The provider returned reasoning and nothing else (OpenAI-compatible `reasoning_content`). */
  reasoningOnly?: boolean;
}

/**
 * Did this turn spend its whole budget without producing anything a caller can use? PURE.
 *
 * Deliberately provider-INDEPENDENT: it asks only "was anything produced, and was the answer cut", so
 * it is true for a vendor that reports `reasoning_content` and equally true for one that reports
 * nothing but a `length` stop. A vendor-specific field as the only signal is how this class hid for
 * two nights across two vendors.
 *
 * ⚠️ It is FALSE the moment ANY text or ANY tool call came back — a genuinely truncated tool call is a
 * partial success the truncation guard already salvages, and must keep flowing to the loop.
 */
export function turnStarvedItsBudget(turn: StarvableTurn | null | undefined): boolean {
  if (!turn) return false;
  const producedText = typeof turn.text === 'string' && turn.text.trim() !== '';
  const producedTools = Array.isArray(turn.toolUses) && turn.toolUses.length > 0;
  if (producedText || producedTools) return false;
  return Boolean(turn.truncated) || Boolean(turn.reasoningOnly);
}

/** Recognise the starved-budget failure by its marker, wherever it surfaced. PURE. */
export function isStarvedBudgetError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error ?? '');
  return text.includes(STARVED_BUDGET_MESSAGE);
}

/**
 * Marks a starvation that happened with the clamp ALREADY LIFTED.
 *
 * 🔒 THE HONESTY HALF OF THE UNCLAMP (rule 5). Once a forced-reasoning rung keeps the build loop's full
 * ask, "our own ceiling" stops being true — and it is the one sentence the admin report leads with. A
 * rung that starves on the full ask is telling us something completely different from one that starved
 * on a clamp: the first is a model that cannot finish thinking inside ANY budget one turn can carry,
 * the second was our arithmetic. Reporting them with the same words would send the next autopsy to the
 * wrong module.
 */
export const STARVED_UNCLAMPED_MARK = 'the ceiling was not reduced';

/** Did this starvation happen on a rung whose ask we had already stopped clamping? PURE. */
export function isUnclampedStarvation(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error ?? '');
  return text.includes(STARVED_BUDGET_MESSAGE) && text.includes(STARVED_UNCLAMPED_MARK);
}

/**
 * The line a starved rung throws — the marker first (the failure classifier reads the first line),
 * then the arithmetic, so the admin report carries the numbers instead of an adjective. PURE.
 */
export function starvedBudgetError(granted: number, requested: number, unclamped = false): Error {
  if (unclamped) {
    return new Error(
      `${STARVED_BUDGET_MESSAGE} — this rung was authorised the full ${granted} output tokens the build `
      + `asked for (${STARVED_UNCLAMPED_MARK}) and spent every one of them on reasoning before producing `
      + 'text or a tool call. This model needs more output than one turn can carry, so the ladder moved on.',
    );
  }
  const asked = requested > 0 && requested !== granted ? `, cut down from ${requested}` : '';
  return new Error(
    `${STARVED_BUDGET_MESSAGE} — this rung was authorised ${granted} output tokens${asked} `
    + 'and spent every one of them without producing text or a tool call. Our own ceiling, not this provider.',
  );
}
