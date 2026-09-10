/**
 * SITE UPTIME — "your site is down" reaches the OWNER, not only our Monitor (ROADMAP §13, 1.8).
 *
 * The platform has watched itself since 2026-08-23 (`monitorAlerts`). Nothing watched the apps our
 * users PUBLISHED: a connected domain could answer errors for a day and the first person to notice
 * would be a customer. Every host with a paid tier sends an "it's down" mail; we did not.
 *
 * WHO IS WATCHED. Apps with a CONNECTED CUSTOM DOMAIN — which is the paid Custom Domain plan by
 * construction (connect is gated by it), so the probe cost scales with revenue, not with signups.
 * A probe per free app would be §💰's category 3. The twin (`www`) is not probed separately: it
 * redirects to the canonical, which is what is checked.
 *
 * 🔒 THREE RULES, so the alert is worth reading:
 *   1. TWO consecutive failures before an alert, never one — a deploy in progress or a blip must not
 *      wake anyone. And `unknown` (WE could not reach it from here) is not a failure of THEIR site;
 *      it neither counts toward the two nor resets them.
 *   2. ONE alert per outage, then quiet for a cooldown (6h default) while it stays down; a recovery
 *      is announced once. A bell that rings every 15 minutes gets muted.
 *   3. Never a vendor name, never our probe's internals — the message says the domain, when, and what
 *      to do.
 *
 * PURE decisions here; the probe, the store and the schedule are in siteUptimeSweep.ts.
 */

/** What the last probe said — `checkDomainServing`'s states, reduced to what the decision needs. */
export type ProbeOutcome = 'up' | 'down' | 'unknown';

export interface UptimeRecord {
  domain: string;
  workspaceId: string;
  userId: string;
  /** Consecutive DOWN probes. Reset by an UP; untouched by UNKNOWN. */
  failures: number;
  /** True once an outage alert has been sent and no recovery has been announced since. */
  alerted: boolean;
  lastAlertAt: number | null;
  lastOkAt: number | null;
  lastCheckedAt: number | null;
  lastOutcome: ProbeOutcome | null;
}

export type UptimeAction = 'none' | 'alert-down' | 'alert-up';

export const FAILURES_BEFORE_ALERT = 2;

export function cooldownMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.SITE_UPTIME_COOLDOWN_HOURS);
  return (Number.isFinite(raw) && raw >= 1 ? Math.min(72, raw) : 6) * 3_600_000;
}

export function sweepEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.SITE_UPTIME_SWEEP ?? '').trim().toLowerCase() !== 'off';
}

export function maxDomainsPerSweep(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.SITE_UPTIME_MAX_DOMAINS);
  return Number.isFinite(raw) && raw > 0 ? Math.min(5_000, Math.floor(raw)) : 500;
}

export function emptyRecord(domain: string, workspaceId: string, userId: string): UptimeRecord {
  return { domain, workspaceId, userId, failures: 0, alerted: false, lastAlertAt: null, lastOkAt: null, lastCheckedAt: null, lastOutcome: null };
}

/** `checkDomainServing` → the three outcomes the decision cares about. */
export function outcomeFromServing(state: string | null | undefined): ProbeOutcome {
  if (state === 'serving') return 'up';
  if (state === 'error' || state === 'nothing_published') return 'down';
  return 'unknown';
}

/** The whole rule, in one place. PURE. */
export function decideUptime(
  prev: UptimeRecord,
  outcome: ProbeOutcome,
  nowMs: number,
  cooldown: number = cooldownMs(),
): { next: UptimeRecord; action: UptimeAction } {
  const next: UptimeRecord = { ...prev, lastCheckedAt: nowMs, lastOutcome: outcome };
  if (outcome === 'unknown') return { next, action: 'none' };
  if (outcome === 'up') {
    next.failures = 0;
    next.lastOkAt = nowMs;
    if (prev.alerted) {
      next.alerted = false;
      return { next, action: 'alert-up' };
    }
    return { next, action: 'none' };
  }
  // down
  next.failures = prev.failures + 1;
  if (next.failures < FAILURES_BEFORE_ALERT) return { next, action: 'none' };
  const dueAgain = prev.lastAlertAt === null || nowMs - prev.lastAlertAt >= cooldown;
  if (!prev.alerted || dueAgain) {
    next.alerted = true;
    next.lastAlertAt = nowMs;
    return { next, action: 'alert-down' };
  }
  return { next, action: 'none' };
}

/** User-facing texts — NavBharatAI terms only (white-label law: no vendor, no probe internals). */
export function downMessage(domain: string, nowMs: number): string {
  const when = new Date(nowMs).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  return `Your site ${domain} is not answering (checked twice, last at ${when}). Open it to see what visitors see; if it shows an error page, press Publish once from the app — that usually fixes it. You will get one more message when it is back.`;
}

export function upMessage(domain: string, nowMs: number): string {
  const when = new Date(nowMs).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  return `Your site ${domain} is answering again (checked at ${when}). Nothing else to do.`;
}
