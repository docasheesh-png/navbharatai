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
