// A STREAMED CHAT TURN MUST BE ABLE TO END WITHOUT THE USER CLOSING THE TAB.
//
// 🔴 ROOT CAUSE (2026-09-17). The only thing that could end a streamed chat turn was
// `req.on('close')` — the CLIENT disconnecting. `routeDetailed` has a wall clock (`TIMEOUT_MS`);
// `routeStream` had none, and `streamSequential` awaits `p.executeStream(...)` with no bound at all.
// So a provider that accepted the connection and then never spoke stalled the turn for ever, while
// chat.ts's 20-second `: ping` keepalive — written to stop a proxy closing an IDLE connection —
// actively held the dead turn open. Same shape as the build-side autopsy where a heartbeat concealed
// a 160-second stall: the liveness signal made the stall invisible.
//
// ⚠️ AND IT WAS *INTRODUCED* BY A CORRECT FIX, WHICH IS WHY IT MUST BE WRITTEN DOWN. Before the money
// audit of 2026-09-12, every universe RACED its top two providers, and the race carried a 12-second
// commit timeout. Removing the race for FREE (rightly — it was billing two models for every turn)
// removed the only time bound on the path most users are on. A fix must never trade one problem for
// another; this is that trade, found and closed rather than left.
//
// 🔑 BOUNDED BY SILENCE, NOT BY DURATION — this repo already settled that argument on the build side
// (`AGENTV3_STREAM_IDLE_MS`): a provider still emitting tokens is not hung however slow it is, and a
// total clock cannot tell the two apart. So there are three bounds and they mean different things:
//
//   • FIRST TOKEN  — nothing has reached the user yet, so a stall here is CLEAN: the rung failed and
//                    the ladder may try the next one with nothing duplicated.
//   • IDLE         — text has already been shown. A second rung would repeat itself, so the turn ENDS
//                    with what was delivered. Partial and honest beats duplicated.
//   • HARD CAP     — an absolute backstop for a provider that dribbles a token forever.
//
// ⚠️ WHAT THIS CANNOT DO, said plainly rather than discovered later: `executeStream` takes no
// AbortSignal, so nothing here CANCELS the upstream call. It stops us WAITING on it. The provider may
// keep generating and we may still be billed for it — exactly the limitation the build-side cost
// ceiling records for an abandoned provider call. Stopping the wait is what the user feels.

/** Nothing has arrived yet: how long to wait for the FIRST token before the rung counts as failed. */
export const DEFAULT_FIRST_TOKEN_MS = 30_000;
/** Text is already flowing: how long a total silence may last before the turn is closed. */
export const DEFAULT_IDLE_MS = 30_000;
/** Absolute ceiling on one rung, however steadily it dribbles. */
export const DEFAULT_HARD_CAP_MS = 180_000;

/** Lower bounds, so a mistyped env can never make the watchdog fire on a healthy provider. */
const MIN_FIRST_TOKEN_MS = 5_000;
const MIN_IDLE_MS = 5_000;
const MIN_HARD_CAP_MS = 30_000;

export interface WatchdogLimits {
  firstTokenMs: number;
  idleMs: number;
  hardCapMs: number;
}

/**
 * Read one positive millisecond value, falling back to its default.
 *
 * An unreadable value falls back rather than disabling the bound: a value that is PRESENT and
 * unparseable can never have been intended as "wait for ever". Same reasoning `parseRolloutPercent`
 * and `buildCostCeilingUsd` already apply. PURE.
 */
function ms(raw: string | undefined, fallback: number, floor: number): number {
  const n = Number(String(raw ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(floor, Math.floor(n));
}

/** The configured limits. `CHAT_STREAM_WATCHDOG=off` restores the pre-2026-09-17 behaviour exactly. */
export function watchdogLimits(env: NodeJS.ProcessEnv = process.env): WatchdogLimits | null {
  if (String(env.CHAT_STREAM_WATCHDOG ?? '').trim().toLowerCase() === 'off') return null;
  return {
    firstTokenMs: ms(env.CHAT_STREAM_FIRST_TOKEN_MS, DEFAULT_FIRST_TOKEN_MS, MIN_FIRST_TOKEN_MS),
    idleMs: ms(env.CHAT_STREAM_IDLE_MS, DEFAULT_IDLE_MS, MIN_IDLE_MS),
    hardCapMs: ms(env.CHAT_STREAM_HARD_CAP_MS, DEFAULT_HARD_CAP_MS, MIN_HARD_CAP_MS),
  };
}

/** Why a watched stream stopped. `completed` is the provider finishing normally. */
export type WatchdogVerdict = 'completed' | 'first-token-timeout' | 'idle-timeout' | 'hard-cap' | 'failed';

export interface WatchedStream {
  verdict: WatchdogVerdict;
  /** True once ANY chunk reached the caller — the discriminator between "retry" and "end". */
  delivered: boolean;
  /** The provider's error, when it threw. */
  error?: unknown;
}

/**
 * Run one provider's stream under the three bounds above.
 *
 * 🔒 `onChunk` is wrapped rather than replaced: the caller's callback still receives every chunk, in
 * order, exactly as before — the wrapper only stamps the clock. A chunk that arrives AFTER the
 * watchdog has given up is dropped, because the caller has already moved on and delivering it would
 * interleave two rungs' text in one answer.
 *
 * Never throws: a provider error becomes `verdict: 'failed'`, which is what the ladder already knows
 * how to act on.
 */
export async function runWatchedStream(
  run: (onChunk: (text: string) => void) => Promise<unknown>,
  onChunk: (text: string) => void,
  limits: WatchdogLimits,
  now: () => number = Date.now,
): Promise<WatchedStream> {
  let delivered = false;
  let lastAt = now();
  let givenUp = false;
  const startedAt = lastAt;

  const wrapped = (text: string): void => {
    if (givenUp) return;              // the caller has moved on — never interleave two rungs
    lastAt = now();
    if (text) delivered = true;
    onChunk(text);
  };

  let timer: ReturnType<typeof setInterval> | undefined;
  const watchdog = new Promise<WatchdogVerdict>((resolve) => {
    // Polling rather than one scheduled deadline: the idle bound is a MOVING target (every chunk
    // resets it), and rescheduling a timer per chunk would allocate one per token on a fast stream.
    timer = setInterval(() => {
      const t = now();
      if (t - startedAt >= limits.hardCapMs) { givenUp = true; resolve('hard-cap'); return; }
      const silence = t - lastAt;
      if (!delivered && silence >= limits.firstTokenMs) { givenUp = true; resolve('first-token-timeout'); return; }
      if (delivered && silence >= limits.idleMs) { givenUp = true; resolve('idle-timeout'); return; }
    }, 1_000);
    if (typeof timer === 'object' && timer && 'unref' in timer) (timer as { unref(): void }).unref();
  });

  let error: unknown;
  try {
    const verdict = await Promise.race([
      run(wrapped).then<WatchdogVerdict>(() => 'completed').catch<WatchdogVerdict>((e) => { error = e; return 'failed'; }),
      watchdog,
    ]);
    // `error` is only ever set on the 'failed' branch, so it rides along without a second await —
    // re-running the provider to recover its message would spend a second call for a log line.
    return verdict === 'failed' ? { verdict, delivered, error } : { verdict, delivered };
  } finally {
    givenUp = true;
    if (timer) clearInterval(timer);
  }
}

/**
 * After a watched stream, may the ladder try the NEXT provider?
 *
 * Only when nothing reached the user. Once text is on screen a second rung would repeat itself, so a
 * mid-stream stall ENDS the turn with what was delivered — partial and honest beats duplicated. PURE.
 */
export function mayTryNextRung(w: Pick<WatchedStream, 'verdict' | 'delivered'>): boolean {
  if (w.verdict === 'completed') return false;
  return !w.delivered;
}

/**
 * Bound an ALREADY-COMMITTED stream by silence — the race path's half of the same rule.
 *
 * 🔎 SIBLING (rule 3). `routeStream`'s race carries a 12-second COMMIT timeout, which only asks
 * "did anyone start speaking?" Once a provider had committed, the final `await s1` was as unbounded
 * as the sequential path's — so a provider that spoke one word and then hung stalled a PRO or
 * PROFESSIONAL turn for ever. The commit timeout looked like a time bound and was not one.
 *
 * Deliberately narrower than `runWatchedStream`: text is already on screen here, so there is no
 * first-token case and no next rung to try. It only decides when to stop waiting. PURE apart from the
 * clock it is handed.
 */
export async function awaitWithIdleBound(
  stream: Promise<unknown>,
  lastChunkAt: () => number,
  startedAt: number,
  limits: WatchdogLimits,
  now: () => number = Date.now,
): Promise<'completed' | 'idle-timeout' | 'hard-cap'> {
  let timer: ReturnType<typeof setInterval> | undefined;
  const watchdog = new Promise<'idle-timeout' | 'hard-cap'>((resolve) => {
    timer = setInterval(() => {
      const t = now();
      if (t - startedAt >= limits.hardCapMs) return resolve('hard-cap');
      if (t - lastChunkAt() >= limits.idleMs) return resolve('idle-timeout');
    }, 1_000);
    if (typeof timer === 'object' && timer && 'unref' in timer) (timer as { unref(): void }).unref();
  });
  try {
    return await Promise.race([
      stream.then<'completed'>(() => 'completed').catch<'completed'>(() => 'completed'),
      watchdog,
    ]);
  } finally {
    if (timer) clearInterval(timer);
  }
}
