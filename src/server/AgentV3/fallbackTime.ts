// TIME LOST BEFORE THE ANSWER IS FALLBACK TIME OF THE SAME TURN (failedbr #2525, Q-3465, 2026-11-26).
//
// The answered call of #2525 recorded latencyMs 83888, answerMs 4378 and fallbackMs 0: Surplus spent ~79 s refusing,
// the wrapper handed the SAME turn to the Weak chain, and that chain — which had failed nothing itself — reported no
// fallback time. Every wrapper that retries a turn on another runner (or on the same one after a failed attempt) owns
// the seconds before the answering attempt; this is the one place they are added, so the next wrapper cannot forget the
// rule in its own way. Earlier rows of the same class: Q-2073, Q-2116. PURE.

/** `result` with `lostMs` added to its `fallbackMs` (a missing or invalid value counts from zero; a bad `lostMs` adds nothing). */
export function addFallbackMs<T extends { fallbackMs?: number }>(result: T, lostMs: number): T {
  const lost = Number.isFinite(lostMs) && lostMs > 0 ? Math.round(lostMs) : 0;
  if (lost === 0) return result;
  const prior = typeof result.fallbackMs === 'number' && Number.isFinite(result.fallbackMs) && result.fallbackMs >= 0 ? result.fallbackMs : 0;
  return { ...result, fallbackMs: prior + lost };
}
