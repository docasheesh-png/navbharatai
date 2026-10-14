// Purchase-audit flags (2026-10-13). Each one changes what happens to a live user's paid resource,
// so each is OFF unless the admin sets it to `on`. Documented in docs/claude/ENV_REGISTRY.md.
import { envFlag } from './envFlag';

/** Remind, then take down / mark lapsed, a paid server or database whose 30 days ran out. */
export function resellExpirySweepEnabled(): boolean {
  return envFlag('RESELL_EXPIRY_SWEEP', false);
}

/** On a plan lapse, also take down apps that run a server (free accounts get no server). */
export function lapsePausesServerAppsEnabled(): boolean {
  return envFlag('LAPSE_PAUSE_SERVER_APPS', false);
}

/** Refuse to create a second private database while an expired one for the same app still exists. */
export function resellDuplicateGuardEnabled(): boolean {
  return envFlag('RESELL_DUPLICATE_GUARD', false);
}

/** Paid servers / databases renew from the wallet like hosting plans (only rows whose terms said so). */
export function resellAutoRenewEnabled(): boolean {
  return envFlag('RESELL_AUTO_RENEW', false);
}

/** Pause (if possible) or warn-then-delete an expired, unrenewed private database. */
export function privateDbExpiryPolicyEnabled(): boolean {
  return envFlag('PRIVATE_DB_EXPIRY_POLICY', false);
}

/** Set ON only if the resell Supabase org is on the FREE plan — paid-plan projects cannot be paused. */
export function privateDbOrgPausable(): boolean {
  return envFlag('PRIVATE_DB_ORG_PAUSABLE', false);
}

/** Days after the period ended before an unrenewed private database is deleted. Default 7. */
export function privateDbDeleteAfterDays(): number {
  const n = Number(String(process.env.PRIVATE_DB_DELETE_AFTER_DAYS ?? '').trim());
  return Number.isFinite(n) && n >= 4 ? Math.floor(n) : 7;
}
