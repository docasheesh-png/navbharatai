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
  /**
   * Consecutive UP probes while an outage is being announced as over. Absent on a legacy record,
   * which reads as 0 — so the worst a deploy can do is ask for one extra good probe before the
   * "it is back" message, never send a wrong one.
   */
  successes?: number;
  /** True once an outage alert has been sent and no recovery has been announced since. */
  alerted: boolean;
  lastAlertAt: number | null;
  lastOkAt: number | null;
  lastCheckedAt: number | null;
  lastOutcome: ProbeOutcome | null;
}

export type UptimeAction = 'none' | 'alert-down' | 'alert-up';

export const FAILURES_BEFORE_ALERT = 2;

/**
 * Good probes needed before an outage is declared OVER. Symmetric with FAILURES_BEFORE_ALERT, and
 * for the same reason.
 *
 * 🔴 WITHOUT THIS, A FLAPPING SITE SPAMS ITS OWNER, and the mechanism is worth naming because it is
 * subtle: recovery set `alerted = false`, and the next outage then took the `!prev.alerted` branch —
 * which does not consult the cooldown at all. So a host going down/up/down/up produced a mail on
 * EVERY transition, no matter how recent the last one. That is the same root cause the admin reported
 * on the Monitor mails the same day (2026-09-12): a recovery wiping the memory that the quiet period
 * depends on. Requiring the recovery to HOLD for two probes closes it without suppressing anything
 * real — a genuine outage after a genuine recovery still alerts immediately, which is the whole point
 * of not simply extending the cooldown across recoveries.
 */
export const SUCCESSES_BEFORE_CLEAR = 2;

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
      // One good probe is not a recovery — it is just as likely the good half of a flap. Announce the
      // all-clear only once it has held, so a wobbling host cannot mail its owner on every swing.
      next.successes = (prev.successes ?? 0) + 1;
      if (next.successes < SUCCESSES_BEFORE_CLEAR) return { next, action: 'none' };
      next.alerted = false;
      next.successes = 0;
      return { next, action: 'alert-up' };
    }
    next.successes = 0;
    return { next, action: 'none' };
  }
  // down
  next.failures = prev.failures + 1;
  // Any bad probe ends a recovery in progress: the site never actually came back.
  next.successes = 0;
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
