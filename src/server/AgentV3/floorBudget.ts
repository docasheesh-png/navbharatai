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
// 🔑 THE DEFAULT BUDGET RULE: fit the authorised output to the estimated capacity of the clock.
// Forced-reasoning rungs can keep the full ask instead; see REASONING_UNCLAMP_OFF below. Otherwise,
// when the two disagree, the ASK is clamped to the CLOCK — and that is the whole point,
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
  /** Authorised output allowance, not measured usage; forced-reasoning rungs may keep the full ask. */
  maxTokens: number;
  /** True when the caller's ask was larger than the clock and had to be cut down. */
  clamped: boolean;
  /** The ask the caller made, kept so the report can say what was reduced and why. */
  requested: number;
  /** The clock/rate clamp was bypassed; another ceiling may still reduce the caller's ask. */
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
 *   • The calls that DID succeed used 8,651 / 9,199 / 9,746 output tokens, close to the 9,833 ceiling.
 *     Those measurements show why the clamp warranted investigation, not that every turn would fail.
 *
 * ⚠️ AND THE FIX IS NOT A FASTER RATE CONSTANT — that was measured and rejected. Across 73 real calls
 * in the reports to hand, `FLOOR_MS_PER_OUTPUT_TOKEN_DEFAULT` is well calibrated: kimi-k2.6 aggregates
 * to **30.5 ms/token** against our 30, and the fleet median is 25.1 with a p90 of 48.1. Lowering it to
 * suit the one fast model would under-bound every slow one and re-open the class this file was written
 * for. The rate is right; applying it to tokens that are not the answer is what is wrong.
 *
 * 🔒 THE CLOCK STILL APPLIES: lifting this clamp does not extend the call's time bound or change
 * its tier. Keeping the full ask can permit an answer that the reduced allowance would have cut off;
 * it does not guarantee an answer, identical consumption, or success on a later call.
 */
export const REASONING_UNCLAMP_OFF = 'off';

/** Kill switch for this module's forced-reasoning bypass; the streaming budget policy is separate. */
export function reasoningUnclampEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_REASONING_UNCLAMP ?? '').trim().toLowerCase() !== REASONING_UNCLAMP_OFF;
}

/**
 * Reconcile the caller's token ask with the clock the call actually has. Pure.
 *
 * `timeoutMs` must be the EFFECTIVE clock — after `turnDeadline` has reconciled the runner's own bound
 * with the lane's remaining budget. Calls subject to the clamp use that clock's estimated output
 * capacity; forced-reasoning calls may keep the full ask while the same time bound still applies.
 */
export function reconcileFloorBudget(
  requestedMaxTokens: number,
  timeoutMs: number,
  env: NodeJS.ProcessEnv = process.env,
  opts: { alwaysReasons?: boolean } = {},
): FloorBudget {
  const requested = Number.isFinite(requestedMaxTokens) && requestedMaxTokens > 0 ? Math.floor(requestedMaxTokens) : 0;
  const affordable = floorMaxTokensForTimeout(timeoutMs, env);
  // A rung whose thinking is billed to this same ceiling keeps the caller's ask; both that allowance
  // and the clock still bound the call. See REASONING_UNCLAMP_OFF above for why the clamp is lifted.
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
// In those reports, FLOOR_TIMEOUT_CAP_MS (150_000) − FLOOR_CALL_OVERHEAD_MS (5_000) = 145_000 ms
// ÷ 30 ms/token = **4,833**, matching the reported `outputTokens: 4833` on three Kimi calls in
// 58fe8254 and three GLM calls in ee20478d. That historical cap is not a universal allowance: streamed
// calls, lane deadlines, caller asks and the reasoning unclamp can yield different budgets. The
// granted allowance alone does not establish how many tokens a later call actually consumed.
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
 * The legacy marker a starved turn is reported under, not a measurement of tokens consumed.
 * The predicate also accepts reasoning-only turns without a length stop; keep this marker stable
 * for existing classifiers and reports, and explain the narrower evidence in the surrounding prose.
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
  /** The turn was marked truncated; this flag carries no measured token consumption. */
  truncated?: boolean;
  /** The provider returned reasoning and nothing else (OpenAI-compatible `reasoning_content`). */
  reasoningOnly?: boolean;
}

/**
 * Did this turn return no usable text or tool call while truncated or reasoning-only? PURE.
 *
 * Deliberately provider-INDEPENDENT: either a truncation flag or a reasoning-only flag is sufficient
 * when there is no usable output. A reasoning-only turn need not have a `length` stop. These flags
 * establish neither measured token consumption nor that the whole authorised allowance was used.
 * A vendor-specific field as the only signal is how this class hid across two vendors.
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
 * Marks a starvation with the clock/rate clamp bypassed, not necessarily the full ask granted.
 *
 * 🔒 THE HONESTY HALF OF THE UNCLAMP (rule 5). Both the forced-reasoning path and streamingBudget
 * can set this flag. The streaming path may still cap the grant below the ask at a model ceiling.
 * Report the actual granted allowance and the clock/rate-clamp bypass, not full-request equality,
 * measured consumption or a prediction that no other budget could succeed. The legacy marker stays
 * unchanged for classifiers; its surrounding prose identifies which clamp was bypassed.
 */
export const STARVED_UNCLAMPED_MARK = 'the ceiling was not reduced';

/** Was this starvation marked as bypassing the clock/rate clamp? PURE. */
export function isUnclampedStarvation(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error ?? '');
  return text.includes(STARVED_BUDGET_MESSAGE) && text.includes(STARVED_UNCLAMPED_MARK);
}

/**
 * Marks a starvation whose ceiling came from the CALLER'S DEADLINE, not from this module's cap.
 *
 * 🔴 THE REPORT WAS SENDING THE NEXT AUTOPSY TO THE WRONG MODULE (autopsy d98dae01, 2026-09-17). A
 * clamped starvation is reported with the sentence *"the ceiling is FLOOR_TIMEOUT_CAP_MS /
 * AGENTV3_FLOOR_MS_PER_TOKEN (see floorBudget.ts)"* — true of a rung bounded by its OWN clock, and
 * false whenever `turnDeadline` picked the lane's remaining budget instead.
 *
 * On that build the arithmetic says so exactly: the rung was authorised **2,314** tokens, and
 * 2,314 × 30 ms + 5,000 = **74,420 ms** — nothing like `FLOOR_TIMEOUT_CAP_MS` (150,000). It was the fast
 * lane's own plan cap (90 s, `preambleCapMs`) minus the 15.5 s a crawling rung had already spent.
 * Raising this module's own cap would not extend that lane deadline. The configured floor rate
 * still participates in converting the selected clock into an allowance; neither number is usage.
 *
 * ⚠️ IT IS MUTUALLY EXCLUSIVE WITH `STARVED_UNCLAMPED_MARK` by construction: the clock/rate-clamp
 * bypass takes the first branch, even if another ceiling reduced the ask. A test asserts that,
 * because two markers on one error would give the report contradictory budget provenance.
 */
export const STARVED_BY_LANE_MARK = 'the clock came from the lane that called it, not our own cap';

/** Did the LANE's remaining budget, rather than our cap, decide this starvation's ceiling? PURE. */
export function isLaneBoundStarvation(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error ?? '');
  return text.includes(STARVED_BUDGET_MESSAGE) && text.includes(STARVED_BY_LANE_MARK);
}

/**
 * Marks a starvation whose ceiling was the CALLER'S OWN ASK — nothing reduced it.
 *
 * 🔴 THE THIRD CASE, AND THE REPORT PRINTED THE FIRST ONE'S SENTENCE FOR IT FIFTEEN TIMES (autopsy
 * 57875eb3, 2026-09-17). A fast-lane repair asked for 8,000 tokens; the 300 s streamed clock could
 * carry ~9,800, so `reconcileFloorBudget` granted the ask unchanged — and `glm-5.3` returned reasoning
 * without an answer, thirteen calls in a row. Every one was reported as *"Our own ceiling … the ceiling is
 * FLOOR_TIMEOUT_CAP_MS / AGENTV3_FLOOR_MS_PER_TOKEN"*. Neither knob bounded that call. The number that
 * did is the CALLER's per-call `maxTokens`, which lives nowhere near this module.
 *
 * `granted === requested` (with `requested > 0`) is exactly the not-clamped case of
 * `reconcileFloorBudget` — the ask fitted the clock — so this fact is derivable from the two numbers
 * already passed and needs no new plumbing. It is mutually exclusive with BOTH other markers by
 * construction: a clock/rate-clamp bypass takes the branch above, and a lane clock that did not
 * reduce the ask did not bound it.
 */
export const STARVED_BY_ASK_MARK = 'the ceiling was the ask itself';

/** Did the caller's own, unreduced ask bound this starvation? PURE. */
export function isAskBoundStarvation(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error ?? '');
  return text.includes(STARVED_BUDGET_MESSAGE) && text.includes(STARVED_BY_ASK_MARK);
}

/**
 * The line a starved rung throws — the marker first (the failure classifier reads the first line),
 * then the arithmetic, so the admin report carries the numbers instead of an adjective. PURE.
 */
export function starvedBudgetError(
  granted: number,
  requested: number,
  unclamped = false,
  /**
   * The lane's remaining milliseconds, when THAT is what bounded the call (`turnDeadline`'s
   * `source === 'deadline'`). Omitted when the rung's own cap bounded it — see `STARVED_BY_LANE_MARK`
   * for why printing the wrong one costs an autopsy.
   */
  laneBoundMs?: number,
): Error {
  if (unclamped) {
    return new Error(
      `${STARVED_BUDGET_MESSAGE} — this rung was authorised ${granted} output tokens with the clock/rate `
      + `clamp bypassed (${STARVED_UNCLAMPED_MARK}); another ceiling may still reduce the caller's ask. No text or tool call was returned. `
      + 'The turn was truncated or returned reasoning only; authorised tokens are not measured usage. This does not predict the outcome of another call.',
    );
  }
  if (requested > 0 && requested === granted) {
    // Not clamped: the ask fitted the clock, so the ask IS the ceiling. See STARVED_BY_ASK_MARK.
    return new Error(
      `${STARVED_BUDGET_MESSAGE} — this rung was authorised the full ${granted} output tokens its caller `
      + `asked for (${STARVED_BY_ASK_MARK}: nothing reduced it, and the ask fitted the clock) but `
      + 'returned no text or tool call. The turn was truncated or returned reasoning only; the allowance is '
      + "the caller's own per-call ask, not this engine's cap or rate constant, and is not measured usage.",
    );
  }
  const asked = requested > 0 && requested !== granted ? `, cut down from ${requested}` : '';
  const lane = typeof laneBoundMs === 'number' && Number.isFinite(laneBoundMs) && laneBoundMs > 0
    ? ` ${STARVED_BY_LANE_MARK}: the lane that asked had ${Math.round(laneBoundMs)}ms left, which bounded `
      + `the ${granted}-token allowance at the configured floor rate. Inspect the lane's remaining clock `
      + "and that rate calculation, rather than treating this engine's own cap as the selected clock."
    : '';
  return new Error(
    `${STARVED_BUDGET_MESSAGE} — this rung was authorised ${granted} output tokens${asked} `
    + `but returned no text or tool call. The turn was truncated or returned reasoning only; the authorised ceiling is not measured usage.${lane}`,
  );
}
