import { rawErrorText } from '../../AgentV3/rawErrorDetail';
/**
 * Owner 2026-10-29: per-profile opt-out of Surplus → Weak fail-open (coding / Pro builder).
 * For these emails ONLY, a Surplus failure stays/fails on Surplus — no SURPLUS_FALLBACK to the
 * Weak ladder (GLM/Kimi). Everyone else keeps the existing fallback unchanged.
 */
const SURPLUS_NO_FALLBACK_EMAILS: ReadonlySet<string> = new Set(['z@gmail.com']);

/** Same owner debug profile by verified uid, so a token without an email claim can't silently fall back. */
const SURPLUS_NO_FALLBACK_UIDS: ReadonlySet<string> = new Set(['GiYNmFcDMVYSWW48Nrurm7j41gv1']);

export function surplusFallbackDisabledFor(email: string | null | undefined, uid?: string | null): boolean {
  if (typeof uid === 'string' && SURPLUS_NO_FALLBACK_UIDS.has(uid)) return true;
  return typeof email === 'string' && SURPLUS_NO_FALLBACK_EMAILS.has(email.trim().toLowerCase());
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
