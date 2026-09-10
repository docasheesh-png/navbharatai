/**
 * THE UPTIME SWEEP — probe every connected domain, tell its owner when it is down (ROADMAP §13, 1.8).
 *
 * Runs every 15 minutes on ONE instance (`exclusive` in the scheduler — probing the same site from
 * every instance would multiply both cost and false positives). The probe is `checkDomainServing`:
 * SSRF-guarded (the domain is user-supplied), bounded, and honest about "unknown" — which
 * `decideUptime` then refuses to count as the site's failure.
 *
 * Two channels, both best-effort and neither able to break the sweep: the in-app bell
 * (`saveNotification`, which the plan sweep already uses) and email, when the platform's alert mailer
 * is configured — sent to the OWNER's address, resolved from their verified account, never to the
 * admin list. Every dependency is injectable so the orchestration is tested without a network.
 */
import * as admin from 'firebase-admin';
import { checkDomainServing } from './domainServingCheck';
import { activeDomainLinks, type DomainLinkRecord } from './firebaseDomainLink';
import { saveNotification } from './AdminNotificationStore';
import { resolveEmailConfig, sendAlertEmail } from './alertEmail';
import { siteUptimeStore } from './siteUptimeStore';
import {
  decideUptime, outcomeFromServing, downMessage, upMessage, sweepEnabled, maxDomainsPerSweep,
  cooldownMs, type UptimeRecord, type ProbeOutcome,
} from './siteUptime';

export interface SweepDeps {
  links: (limit: number) => Promise<DomainLinkRecord[]>;
  probe: (domain: string) => Promise<ProbeOutcome>;
  load: (domain: string, workspaceId: string, userId: string) => Promise<UptimeRecord>;
  save: (rec: UptimeRecord) => Promise<void>;
  notify: (userId: string, message: string) => Promise<unknown>;
  /** Email the owner. Resolves false when not configured or not sent — never throws. */
  email: (userId: string, message: string) => Promise<boolean>;
  now: () => number;
  env: NodeJS.ProcessEnv;
}

async function ownerEmail(userId: string): Promise<string | null> {
  try {
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
    const u = await admin.auth().getUser(userId);
    return u.email && u.emailVerified !== false ? u.email : null;
  } catch {
    return null;
  }
}

export const realDeps: SweepDeps = {
  links: (limit) => activeDomainLinks(limit),
  probe: async (domain) => outcomeFromServing((await checkDomainServing(domain).catch(() => null))?.state),
  load: (domain, ws, uid) => siteUptimeStore.get(domain, ws, uid),
  save: (rec) => siteUptimeStore.set(rec),
  notify: (userId, message) => saveNotification({ message, target: { type: 'user', userId }, createdBy: 'system' }),
  email: async (userId, message) => {
    const cfg = resolveEmailConfig();
    if (!cfg.configured) return false;
    const to = await ownerEmail(userId);
    if (!to) return false;
    const r = await sendAlertEmail({ ...cfg, to: [to] }, message, {
      footer: '— NavBharatAI\nOpen your app → Publish to see the live status, or reply to this email for help.',
    }).catch(() => ({ sent: false }));
    return r.sent === true;
  },
  now: () => Date.now(),
  env: process.env,
};

export interface SweepSummary {
  probed: number;
  alertedDown: number;
  alertedUp: number;
  skipped: 'disabled' | null;
}

/** One pass. Bounded concurrency; a single domain's failure never stops the rest. Never throws. */
export async function runSiteUptimeSweep(deps: Partial<SweepDeps> = {}): Promise<SweepSummary> {
  const d: SweepDeps = { ...realDeps, ...deps };
  if (!sweepEnabled(d.env)) return { probed: 0, alertedDown: 0, alertedUp: 0, skipped: 'disabled' };
  const links = await d.links(maxDomainsPerSweep(d.env)).catch(() => [] as DomainLinkRecord[]);
  const summary: SweepSummary = { probed: 0, alertedDown: 0, alertedUp: 0, skipped: null };
  const cooldown = cooldownMs(d.env);
  const queue = [...links];
  const worker = async () => {
    for (let link = queue.shift(); link; link = queue.shift()) {
      try {
        const prev = await d.load(link.domain, link.workspaceId, link.userId);
        const outcome = await d.probe(link.domain);
        const now = d.now();
        const { next, action } = decideUptime(prev, outcome, now, cooldown);
        summary.probed += 1;
        await d.save(next);
        if (action === 'alert-down') {
          summary.alertedDown += 1;
          const msg = downMessage(link.domain, now);
          await d.notify(link.userId, msg).catch(() => null);
          await d.email(link.userId, msg).catch(() => false);
        } else if (action === 'alert-up') {
          summary.alertedUp += 1;
          const msg = upMessage(link.domain, now);
          await d.notify(link.userId, msg).catch(() => null);
          await d.email(link.userId, msg).catch(() => false);
        }
      } catch { /* one domain must not stop the rest; the next sweep retries it */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(5, Math.max(1, queue.length)) }, worker));
  return summary;
}
