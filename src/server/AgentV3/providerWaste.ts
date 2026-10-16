// HOW MUCH OF A BUILD'S WALL CLOCK WENT INTO PROVIDER CALLS THAT PRODUCED NOTHING.
//
// 🔴 WHY IT EXISTS BEFORE ANY FIX (autopsy `21b431e1`, 2026-09-22). That build sat through FIVE
// failed provider attempts — three 60-second timeouts and two calls abandoned for crawling — and the
// ladder still finished on rung 2 of 5. The obvious reading is "the bench is too slow"; the honest
// answer is that nobody knows, because the bench's trigger is a COUNT (two consecutive timeouts on a
// family) and the cost is a CLOCK, and the two were never compared. Three minutes of a 480-second
// turn is 37% of the user's wait; three minutes of a 30-minute build is noise. The same five
// timeouts mean opposite things in those two builds, and no report could tell them apart.
//
// **Nothing reads this.** It changes no routing, benches nothing, costs no model call. It is the
// number the bench's trigger will be re-chosen from — or, just as usefully, the number that shows
// the trigger was right all along and the five timeouts were cheap.
//
// ⚠️ OUR OWN CLOCK ENDING IS NOT A PROVIDER'S WASTE, and the distinction is the one `recordProviderFallback`
// already had to learn (autopsy bb688add): a lane that ran out of ITS budget mid-call is our
// accounting, not the vendor's failure. Callers pass the kind; this module never guesses it.
//
// Pure: an accumulator with no I/O, created per build and thrown away with it.

/** `silent` (autopsy 303e8a6f): given up on before the provider produced a single byte — not a slow answer (`crawl`). */
export type WasteKind = 'timeout' | 'crawl' | 'silent' | 'rate-limit' | 'error';

export interface WasteLedger {
  /** Milliseconds spent inside attempts that returned nothing, by kind. */
  msByKind: Record<WasteKind, number>;
  /** How many such attempts, by kind. */
  callsByKind: Record<WasteKind, number>;
  /** Milliseconds by provider family, so a single bad vendor is visible as one. */
  msByFamily: Record<string, number>;
}

export function emptyWasteLedger(): WasteLedger {
  return {
    msByKind: { timeout: 0, crawl: 0, silent: 0, 'rate-limit': 0, error: 0 },
    callsByKind: { timeout: 0, crawl: 0, silent: 0, 'rate-limit': 0, error: 0 },
    msByFamily: {},
  };
}

/** Record one attempt that produced nothing. Negative or unmeasured durations count as zero. Pure. */
export function recordWaste(ledger: WasteLedger, family: string, kind: WasteKind, ms: number): void {
  const safe = Number.isFinite(ms) && ms > 0 ? Math.round(ms) : 0;
  ledger.msByKind[kind] += safe;
  ledger.callsByKind[kind] += 1;
  const key = family || 'unknown';
  ledger.msByFamily[key] = (ledger.msByFamily[key] ?? 0) + safe;
}

export function totalWasteMs(ledger: WasteLedger): number {
  return (Object.values(ledger.msByKind) as number[]).reduce((a, b) => a + b, 0);
}

export function totalWasteCalls(ledger: WasteLedger): number {
  return (Object.values(ledger.callsByKind) as number[]).reduce((a, b) => a + b, 0);
}

const sec = (ms: number): string => `${Math.round(Math.max(0, ms) / 100) / 10}s`;

/**
 * The admin-only report line.
 *
 * ⚠️ IT REPORTS A SHARE ONLY WHEN IT WAS GIVEN A REAL TOTAL. A percentage of an unknown denominator
 * is the shape of number that gets quoted later as if it were measured — the `E2B_USD_PER_HOUR`
 * lesson. `buildMs` absent (or zero) means the line states the seconds and stops. Pure.
 */
export function wasteSummary(ledger: WasteLedger, buildMs?: number): string {
  const calls = totalWasteCalls(ledger);
  // ⚠️ NOT "every model call returned something" (autopsy 0d297b25): a call OUR clock stopped is
  // deliberately not a provider's waste (`wasteKindFor` returns null for it), so it never reaches this
  // ledger — and that report said "every call returned something" beside a 90-second planner call that
  // returned nothing at all. The zero is about PROVIDERS, and the sentence now says only that.
  if (calls === 0) return 'Provider time: no engine wasted any time this build (a call stopped by our own clock is not counted here, nor one the user stopped — see PROVIDER_FALLBACK / LLM_CALL_BUDGET_ENDED / LLM_CALL_STOPPED).';
  const total = totalWasteMs(ledger);
  const kinds = (Object.keys(ledger.msByKind) as WasteKind[])
    .filter((k) => ledger.callsByKind[k] > 0)
    .map((k) => `${ledger.callsByKind[k]} ${k} (${sec(ledger.msByKind[k])})`);
  const families = Object.entries(ledger.msByFamily)
    .sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([f, ms]) => `${f} ${sec(ms)}`);
  const share = typeof buildMs === 'number' && buildMs > 0
    ? ` — ${Math.round((total / buildMs) * 100)}% of the build's clock`
    : '';
  return `Provider time wasted: ${sec(total)} across ${calls} call(s) that returned nothing${share}. `
    + `By kind: ${kinds.join(', ')}. By engine: ${families.join(', ')}.`;
}

/**
 * Did OUR ENGINE, not the request, take the build's time? (autopsy 67a2b0a2, 2026-10-15)
 *
 * A third of the build's clock spent inside calls that returned nothing is not a prompt problem. That build ran
 * 10.1 minutes and wrote no file; 315 s of it (52%) went to three calls that answered nothing, and the user was
 * told to "add a bit more detail about what the app should do" — for a clear five-part request. The ledger that
 * could tell the two apart already existed and was reported once for the admin; nothing user-facing read it.
 *
 * The threshold is a third, not a share of one failure: a single 15 s silent first rung (which every build now
 * pays) is ~1-2% of a normal build and must never read as an outage — PAWTRACE's 398db9f3 lost 15 s of 1,510 s.
 * `buildMs` unknown or zero is NOT evidence of an outage (false = today's wording). PURE.
 */
export const ENGINE_TIME_DOMINATES_SHARE = 1 / 3;
export function engineTimeDominated(ledger: WasteLedger, buildMs: number): boolean {
  const ms = Number(buildMs);
  if (!Number.isFinite(ms) || ms <= 0) return false;
  return totalWasteMs(ledger) / ms >= ENGINE_TIME_DOMINATES_SHARE;
}
