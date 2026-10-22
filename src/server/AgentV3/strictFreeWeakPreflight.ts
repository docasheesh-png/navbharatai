/** Small request helpers keep policy branches out of the large chat handler (TS2563). */
export async function weakAwareEngineReady(tier: string, deps: {
  strictWeakEnabled(): boolean;
  assertFreeTools(maxOutputTokens: number): Promise<void>;
  legacyAvailable(tier: string): boolean;
}): Promise<boolean> {
  if (tier === 'weak' && deps.strictWeakEnabled()) {
    try { await deps.assertFreeTools(32768); return true; }
    catch { return false; }
  }
  return deps.legacyAvailable(tier);
}
interface FreeOutputLimitRecord {
  phase: 'provider'; severity: 'info'; code: 'FREE_OUTPUT_LIMIT'; autoResolved: true;
  message: string; detail: string;
}
/** One recorder per build. Observation failures never become inference retries. */
export function createFreeOutputLimitRecorder(record: (entry: FreeOutputLimitRecord) => void) {
  let lastFreeOutputLimit: number | undefined;
  return (usage: { selectedMaxOutputTokens?: number }): void => {
    const limit = usage.selectedMaxOutputTokens;
    if (!Number.isSafeInteger(limit) || !limit || limit === lastFreeOutputLimit) return;
    lastFreeOutputLimit = limit;
    try { record({ phase: 'provider', severity: 'info', code: 'FREE_OUTPUT_LIMIT', autoResolved: true,
      message: `The verified-free endpoint selected an output ceiling of ${limit} tokens for this turn.`,
      detail: 'The requested output budget is an upper bound. Endpoint and remaining-context limits can lower it; truncated writes retain the existing bounded recovery guards.' }); } catch { /* observation */ }
  };
}

export function engineUnavailableReply(tierName: string, strictWeak: boolean): { error: string; code: string } {
  return {
    error: tierName === 'Weak'
      ? (strictWeak
        ? 'The free engine is temporarily unavailable. Please try again shortly. No paid fallback was used.'
        : 'The free engine is temporarily unavailable. Please try again shortly, or add credits to build on the full engine.')
      : `The ${tierName} engine is temporarily unavailable. Please try again shortly, or pick another power level.`,
    code: tierName === 'Weak' ? 'WEAK_ENGINE_UNAVAILABLE' : 'ENGINE_UNAVAILABLE',
  };
}
