// AgentV3 — Proactive rate-limit pacer (admin-chosen 2026-07-18: "Proactive pacer + AIMD").
//
// The existing 429 handling is REACTIVE: fire a request, get a 429/timeout, back off + rotate keys. That
// wastes a full request round-trip (and tokens) on every throttle, and a burst of parallel calls can
// stampede a provider into a timeout storm (deep-test `e0db3243`: GLM timed out 23× and defeated the
// endgame repair). This adds a PROACTIVE layer:
//   1. a TOKEN BUCKET per key paces requests to stay UNDER the provider's per-second limit, so most 429s
//      never happen (no wasted request+backoff);
//   2. AIMD adaptive concurrency (additive-increase / multiplicative-decrease) self-tunes how many calls
//      run at once from the real 429/timeout signal — on a throttle it HALVES concurrency (provider
//      recovers, timeouts stop), on sustained success it slowly ramps back up. No manual tuning.
//
// The math (TokenBucket + AimdConcurrency) is PURE and clock-injected → fully unit-testable without any
// timers or providers. The thin async gate (`RateLimitPacer.run`) is the only impure part (real clock +
// setTimeout + an in-flight counter). Default-OFF (see pacerEnabled) — a flag-gated, additive layer that
// never changes today's behaviour until turned on, and never REMOVES the reactive backoff/rotation.

/** A classic token bucket. Refills at `ratePerSec` up to `burst`; each request takes 1 token. Pure. */
export class TokenBucket {
  private tokens: number;
  private lastRefillMs: number;

  constructor(private readonly ratePerSec: number, private readonly burst: number, nowMs: number) {
    this.tokens = Math.max(0, burst);
    this.lastRefillMs = nowMs;
  }

  private refill(nowMs: number): void {
    if (nowMs <= this.lastRefillMs) return;
    const gained = ((nowMs - this.lastRefillMs) / 1000) * this.ratePerSec;
    this.tokens = Math.min(this.burst, this.tokens + gained);
    this.lastRefillMs = nowMs;
  }

  /** Take one token if available (returns true) — otherwise leave the bucket unchanged (false). */
  tryTake(nowMs: number): boolean {
    this.refill(nowMs);
    if (this.tokens >= 1) { this.tokens -= 1; return true; }
    return false;
  }

  /** Milliseconds until at least one token is available (0 when one is ready now). */
  msUntilToken(nowMs: number): number {
    this.refill(nowMs);
    if (this.tokens >= 1) return 0;
    if (this.ratePerSec <= 0) return Number.POSITIVE_INFINITY;
    return Math.ceil(((1 - this.tokens) / this.ratePerSec) * 1000);
  }
}

/**
 * AIMD adaptive concurrency limit. Additive-increase (+1 permit per full window of successes) while calls
 * succeed; multiplicative-decrease (halve) the instant a throttle (429/timeout) is seen. Clamped to
 * [min, max]. Pure — the caller just reports outcomes. This is the same control law TCP uses to find a
 * link's real capacity without being told it.
 */
export class AimdConcurrency {
  private limitF: number;

  constructor(private readonly min: number, private readonly max: number, start?: number) {
    this.min = Math.max(1, Math.floor(min));
    this.max = Math.max(this.min, Math.floor(max));
    this.limitF = Math.min(this.max, Math.max(this.min, start ?? this.min));
  }

  /** The current integer concurrency permit count. */
  get limit(): number {
    return Math.max(this.min, Math.min(this.max, Math.floor(this.limitF)));
  }

  /** A successful call — gently raise the ceiling (+1 permit per ~`limit` successes). */
  onSuccess(): void {
    this.limitF = Math.min(this.max, this.limitF + 1 / Math.max(1, Math.floor(this.limitF)));
  }

  /** A 429 / timeout — back off hard (halve), never below the floor. */
  onThrottle(): void {
    this.limitF = Math.max(this.min, this.limitF / 2);
  }
}

/**
 * M5-S5.1 — a decaying throttle rate for a provider (EWMA of throttle=1 / ok=0) → an honest 0-100 health
 * score, so the 429 ceiling is MEASURABLE (the GLM-storm the reports keep showing). Pure. 100 = no recent
 * throttles, 0 = every recent call throttled. Exposed as pacer telemetry (like concurrencyLimit); USING it
 * to reorder providers touches the model-routing policy and is a deliberate, admin-signed-off follow-up.
 */
export class ThrottleHealth {
  private ewma = 0;
  private samples = 0;
  constructor(private readonly alpha = 0.2) {
    this.alpha = Math.min(1, Math.max(0.01, alpha));
  }
  /** Record one call outcome. */
  record(throttled: boolean): void {
    this.ewma = (1 - this.alpha) * this.ewma + this.alpha * (throttled ? 1 : 0);
    this.samples++;
  }
  /** 0-100; 100 = healthy. 100 before any samples (unknown = assume healthy, so it never penalises blind). */
  get score(): number {
    return this.samples === 0 ? 100 : Math.round((1 - this.ewma) * 100);
  }
  /** The decaying throttle ratio in [0,1]. */
  get throttleRate(): number { return this.ewma; }
  /** How many outcomes have been recorded. */
  get count(): number { return this.samples; }
}

/** True when an error looks like a rate-limit / throttle / timeout the AIMD should back off on. */
export function isThrottleSignal(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  if (status === 429 || status === 529 || status === 408) return true;
  const msg = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase();
  return /\b(429|rate.?limit|too many requests|timed out|timeout|etimedout|econnreset|overloaded|throttl)/.test(msg);
}

/** OFF by default — a flag-gated, additive rollout. `AGENTV3_RATE_PACER=on` enables it. */
export function pacerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AGENTV3_RATE_PACER === 'on';
}

export interface PacerConfig {
  /** Steady-state requests/sec target per key (token refill rate). */
  ratePerSec: number;
  /** Bucket size — the largest instantaneous burst allowed. */
  burst: number;
  /** AIMD concurrency floor / ceiling. */
  minConcurrency: number;
  maxConcurrency: number;
}

/** Read the pacer config from env with margin-safe defaults (tunable without a deploy). */
export function pacerConfigFromEnv(env: NodeJS.ProcessEnv = process.env): PacerConfig {
  const num = (name: string, def: number): number => {
    const n = Number(env[name]);
    return Number.isFinite(n) && n > 0 ? n : def;
  };
  return {
    ratePerSec: num('AGENTV3_PACER_RATE_PER_SEC', 8),
    burst: num('AGENTV3_PACER_BURST', 8),
    minConcurrency: num('AGENTV3_PACER_MIN_CONCURRENCY', 2),
    maxConcurrency: num('AGENTV3_PACER_MAX_CONCURRENCY', 8),
  };
}

/**
 * The impure async gate that combines the two: before a call it waits for (a) a concurrency permit and
 * (b) a token; it runs the call; it reports the outcome to the AIMD (a throttle → halve, success → grow).
 * One pacer instance per key/provider. `run` NEVER changes the result of `fn` — it only paces WHEN it
 * runs and adapts concurrency; a thrown error propagates unchanged (the caller's reactive backoff/rotation
 * still handles it). Keyed sleeps are bounded so a misconfig can't hang a build.
 */
export class RateLimitPacer {
  private readonly bucket: TokenBucket;
  private readonly aimd: AimdConcurrency;
  private readonly healthT = new ThrottleHealth();
  private inFlight = 0;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    cfg: PacerConfig,
    deps: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
  ) {
    this.now = deps.now ?? (() => Date.now());
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.bucket = new TokenBucket(cfg.ratePerSec, cfg.burst, this.now());
    this.aimd = new AimdConcurrency(cfg.minConcurrency, cfg.maxConcurrency);
  }

  /** Current adaptive concurrency permit count (for telemetry/tests). */
  get concurrencyLimit(): number { return this.aimd.limit; }

  /** Provider throttle-health 0-100 (for telemetry/tests); 100 = no recent 429s. M5-S5.1. */
  get healthScore(): number { return this.healthT.score; }

  /** The decaying throttle ratio [0,1] observed for this provider (for telemetry/tests). */
  get throttleRate(): number { return this.healthT.throttleRate; }

  private async waitForSlot(): Promise<void> {
    // Wait until in-flight is under the (possibly-shrinking) AIMD limit. Bounded poll so it can't spin.
    let guard = 0;
    while (this.inFlight >= this.aimd.limit && guard++ < 10_000) {
      await this.sleep(25);
    }
  }

  private async waitForToken(): Promise<void> {
    let guard = 0;
    for (;;) {
      const wait = this.bucket.msUntilToken(this.now());
      if (wait <= 0 && this.bucket.tryTake(this.now())) return;
      if (!Number.isFinite(wait) || guard++ > 10_000) return; // never hang on a misconfig
      await this.sleep(Math.min(wait, 1000));
    }
  }

  /** Pace + run `fn`. Adapts concurrency from the outcome; re-throws any error unchanged. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.waitForSlot();
    await this.waitForToken();
    this.inFlight++;
    try {
      const out = await fn();
      this.aimd.onSuccess();
      this.healthT.record(false);
      return out;
    } catch (err) {
      if (isThrottleSignal(err)) { this.aimd.onThrottle(); this.healthT.record(true); }
      else this.aimd.onSuccess(); // a non-throttle failure isn't a capacity signal — don't shrink for it
      throw err;
    } finally {
      this.inFlight--;
    }
  }
}

// One shared pacer per provider/key, so ALL concurrent builds pace against the SAME bucket (global
// per-provider pacing is what actually prevents a stampede). Lazily created from the live env config.
const sharedPacers = new Map<string, RateLimitPacer>();

/** Get (or lazily create) the process-wide pacer for a provider/key, e.g. 'GLM' / 'KIMI'. */
export function getSharedPacer(key: string): RateLimitPacer {
  let p = sharedPacers.get(key);
  if (!p) { p = new RateLimitPacer(pacerConfigFromEnv()); sharedPacers.set(key, p); }
  return p;
}

/** Test-only: clear the shared registry so config changes take effect between cases. */
export function _resetSharedPacers(): void { sharedPacers.clear(); }
