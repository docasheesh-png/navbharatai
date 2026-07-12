// Deep-refresh-before-fix flow for a non-rendering in-browser preview.
//
// Admin request (2026-07-12): "jab preview me app na chale, to 'Fix with AI' par click karne se
// pehle ek DEEP REFRESH hona chahiye — ho sakta hai chal jaye." A blank/failed preview is very
// often NOT a code bug at all: it is a stale cached render, a transient cold-start collect miss,
// or a dev-server that went stale (admin report fae70e42: a blank WebGL canvas that fixed itself
// on a clean re-publish, with no code change). Spending an AI turn on that is pure waste — the
// build was fine.
//
// So the "Fix with AI" button on a broken preview must try the FREE, INSTANT fix first: a
// cache-bypassing recompile from the durable files (a "deep refresh"). If the app renders after
// that, the user never needed the AI — we stop. Only if it STILL fails do we hand the error to the
// AI. This helper is the pure decision core (no React) so the exact branch logic is unit-tested.

export type DeepRefreshOutcome = 'recovered' | 'sent-to-ai';

export interface DeepRefreshFlowDeps {
  /** Run the cache-bypassing recompile of the preview. Resolves true when the app now renders. */
  deepRefresh: () => Promise<boolean>;
  /** Called when the deep refresh recovered the preview — no AI fix is sent. */
  onRecovered: () => void;
  /** Called with the original error only when the deep refresh did NOT recover the preview. */
  onNeedsAi: (errorText: string) => void;
  /** The build/preview error text to hand to the AI as a fallback. */
  errorText: string;
}

/**
 * Try a deep refresh first; send the error to the AI only if it still fails.
 *
 * A `deepRefresh` that throws is treated the same as "did not recover" — a refresh failure must
 * never swallow the user's intent to fix, so we still fall through to the AI. Exactly one of
 * `onRecovered` / `onNeedsAi` fires.
 */
export async function fixWithAiAfterDeepRefresh(deps: DeepRefreshFlowDeps): Promise<DeepRefreshOutcome> {
  let recovered = false;
  try {
    recovered = await deps.deepRefresh();
  } catch {
    recovered = false; // a refresh error is not a recovery — fall through to the AI
  }
  if (recovered) {
    deps.onRecovered();
    return 'recovered';
  }
  deps.onNeedsAi(deps.errorText);
  return 'sent-to-ai';
}
