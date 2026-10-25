/**
 * Weak-tier scope guidance codes — shared by the admission reply and the Pro panel CTA.
 * These are NOT build failures: coding did not start; the user should switch Power module.
 */
export const WEAK_SCOPE_STRONG = 'WEAK_SCOPE_STRONG';
export const WEAK_SCOPE_UNAVAILABLE = 'WEAK_SCOPE_UNAVAILABLE';

export type WeakScopeGuidanceCode = typeof WEAK_SCOPE_STRONG | typeof WEAK_SCOPE_UNAVAILABLE;

export function isWeakScopeGuidanceCode(code: string | undefined | null): code is WeakScopeGuidanceCode {
  return code === WEAK_SCOPE_STRONG || code === WEAK_SCOPE_UNAVAILABLE;
}
