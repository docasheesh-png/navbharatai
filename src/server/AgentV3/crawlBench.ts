// AgentV3 — how long a rung abandoned for CRAWLING stays benched (autopsy 876afca9, 2026-09-30).
//
// 🔴 WHY: a stream that crawls below the usable rate is abandoned mid-answer and its rung benched
// (`isSlowStreamAbandon` in MultiProviderTurnRunner). That bench was for the WHOLE build, on ONE
// sample. In "Create a calculation app" GLM flashx answered the plan in 2.4 s, crawled once on the
// contract, and was then gone for ten minutes: every later call went to the reasoning rung, and the
// first repair round alone cost 10,616 tokens and 151 s. A crawl is weather, not a verdict about the
// model. The THROUGHPUT bench (slowRungBench.ts) is different: it needs three measured calls and is
// latched on purpose, so it is untouched here.
//
// THE RULE:
//   • first crawl abandon of a rung  → benched for a window (default 180 s), then re-probed once;
//   • a second crawl abandon of it   → benched for the rest of the build.
//   • at most TWO abandons per build, and the second only on a re-probe of the SAME rung. The old
//     "once per build" cap existed so bad weather at every vendor could never walk the whole ladder
//     and fail; allowing only the re-probed rung a second abandon keeps that property.
//
// Env `AGENTV3_CRAWL_BENCH_SECONDS`: unset or unreadable ⇒ 180; clamped to 30–1800; `off` ⇒ the old
// whole-build bench exactly (no re-probe, one abandon per build). Pure.

export const CRAWL_BENCH_DEFAULT_SECONDS = 180;
const MIN_SECONDS = 30;
const MAX_SECONDS = 1800;

/** The re-probe window in ms, or `null` when the bench must last the whole build (`off`). */
export function crawlBenchWindowMs(env: Record<string, string | undefined> = process.env): number | null {
  const raw = String(env.AGENTV3_CRAWL_BENCH_SECONDS ?? '').trim().toLowerCase();
  if (raw === 'off') return null;
  const n = raw === '' ? NaN : Number(raw);
  const seconds = Number.isFinite(n) ? Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, n)) : CRAWL_BENCH_DEFAULT_SECONDS;
  return Math.round(seconds * 1000);
}

/**
 * May this attempt walk away from its rung if it crawls? PURE.
 * `abandonsSoFar` is this build's total; `abandonsOfThisRung` is how often THIS rung was abandoned.
 */
export function mayAbandonCrawl(input: {
  hasNextRung: boolean;
  abandonsSoFar: number;
  abandonsOfThisRung: number;
  /** True only for a call made AFTER this rung's bench window expired — never a concurrent call. */
  isReprobe: boolean;
  windowMs: number | null;
}): boolean {
  if (!input.hasNextRung) return false; // a slow success beats a manufactured failure
  if (input.abandonsSoFar === 0) return true;
  // Only the re-probe of the rung we already walked away from once may be abandoned again. A call
  // that was merely IN FLIGHT beside the first abandon is not a re-probe, and rides it out as before.
  return input.windowMs !== null && input.isReprobe && input.abandonsOfThisRung === 1 && input.abandonsSoFar === 1;
}

/**
 * Until when is a rung benched after its Nth crawl abandon? `Infinity` = the rest of the build. PURE.
 */
export function crawlBenchUntil(abandonsOfThisRung: number, nowMs: number, windowMs: number | null): number {
  if (windowMs === null || abandonsOfThisRung >= 2) return Number.POSITIVE_INFINITY;
  return nowMs + windowMs;
}
