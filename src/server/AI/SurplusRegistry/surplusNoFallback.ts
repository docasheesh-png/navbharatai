import { rawErrorText } from '../../AgentV3/rawErrorDetail';
/**
 * Owner 2026-10-29: per-profile opt-out of Surplus → Weak fail-open (coding / Pro builder).
 * For these emails ONLY, a Surplus failure stays/fails on Surplus — no SURPLUS_FALLBACK to the
 * Weak ladder (GLM/Kimi). Everyone else keeps the existing fallback unchanged.
 */
// The list lives in lib/zTestAccount.ts (one helper for every z@gmail.com special case).
// Owner 2026-11-02: z@gmail.com now routes like every other user of its tier — no profile opts out.
export function surplusFallbackDisabledFor(_email: string | null | undefined, _uid?: string | null): boolean {
  return false;
}

/**
 * Same profiles also see the REAL technical Surplus error in chat (no public scrub), so the
 * owner can DNA-fix from it. Returns undefined for everyone else (scrubbed copy unchanged).
 */
export function surplusRawErrorReporter(
  email: string | null | undefined,
  emit: (text: string) => void,
  uid?: string | null,
): ((error: unknown) => void) | undefined {
  if (!surplusFallbackDisabledFor(email, uid)) return undefined;
  return (error) => {
    try { emit(`🛠️ Surplus raw error (debug, this profile only): ${rawErrorText(error)}`); } catch { /* best-effort */ }
  };
}

/** Weak now uses the owner-confirmed fallback order for every profile. */
export function surplusFallbackDisabledForTier(tier: string, email?: string | null, uid?: string | null): boolean {
  return tier !== 'weak' && surplusFallbackDisabledFor(email, uid);
}
