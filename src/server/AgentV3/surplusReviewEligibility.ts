/** Provider eligibility only: the caller still owns tier, successful-build and attempt guards. */
export function isBuildReviewProviderEligible(
  provider: string | null | undefined,
  hasActiveSurplusSession: boolean,
): boolean {
  if (/^(GLM|KIMI)$/i.test(provider ?? '')) return true;
  // A label or enabled flag is not session authority. Only an admitted session can review Surplus.
  return hasActiveSurplusSession === true && /^SURPLUS$/i.test(provider ?? '');
}
