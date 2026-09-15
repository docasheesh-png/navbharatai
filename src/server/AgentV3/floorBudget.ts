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
}

/**
 * Reconcile the caller's token ask with the clock the call actually has. Pure.
 *
 * `timeoutMs` must be the EFFECTIVE clock — after `turnDeadline` has reconciled the runner's own bound
 * with the lane's remaining budget — because a lane with 30 seconds left must not authorise a
 * 32,000-token answer either. The whole rule in one line: ask for what you can be given.
 */
export function reconcileFloorBudget(requestedMaxTokens: number, timeoutMs: number, env: NodeJS.ProcessEnv = process.env): FloorBudget {
  const requested = Number.isFinite(requestedMaxTokens) && requestedMaxTokens > 0 ? Math.floor(requestedMaxTokens) : 0;
  const affordable = floorMaxTokensForTimeout(timeoutMs, env);
  if (requested <= 0) return { maxTokens: affordable, clamped: false, requested };
  if (requested <= affordable) return { maxTokens: requested, clamped: false, requested };
  return { maxTokens: affordable, clamped: true, requested };
}
