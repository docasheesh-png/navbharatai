/**
 * Weak-tier scope guidance codes — shared by the admission reply and the Pro panel CTA.
 * These are NOT build failures: coding did not start; the user may continue on Weak
 * (with an honest risk warning) or open Build options via Switch module.
 */
export const WEAK_SCOPE_STRONG = 'WEAK_SCOPE_STRONG';
export const WEAK_SCOPE_UNAVAILABLE = 'WEAK_SCOPE_UNAVAILABLE';

export type WeakScopeGuidanceCode = typeof WEAK_SCOPE_STRONG | typeof WEAK_SCOPE_UNAVAILABLE;

export function isWeakScopeGuidanceCode(code: string | undefined | null): code is WeakScopeGuidanceCode {
  return code === WEAK_SCOPE_STRONG || code === WEAK_SCOPE_UNAVAILABLE;
}

/** Structured card copy for the Pro panel — title + body, never Fix-with-AI failure framing. */
export function weakScopeGuidanceCard(code: WeakScopeGuidanceCode): {
  title: string;
  body: string;
  hint: string;
  /** Honest risk line under Continue with Weak — professional, non-technical. */
  risk: string;
} {
  if (code === WEAK_SCOPE_STRONG) {
    return {
      title: 'A stronger module fits this request',
      body: 'Weak is for lighter apps. Continue with Weak below, or open Build options with Switch module — or describe a smaller first version.',
      hint: 'Nothing was charged · coding has not started',
      risk: 'On Weak, app building may fail. High chance of failure.',
    };
  }
  return {
    title: 'Choose a module to continue',
    body: 'Weak could not confirm a fit for this request yet. Continue with Weak below, or open Build options with Switch module — or retry with a clearer, smaller version of the app.',
    hint: 'Nothing was charged · coding has not started',
    risk: 'On Weak, app building may fail. High chance of failure.',
  };
}
