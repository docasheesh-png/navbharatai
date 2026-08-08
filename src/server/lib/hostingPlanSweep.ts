/**
 * Hosting-plan lifecycle sweep (admin 2026-08-06: "jab app down hategi hi nahi, to user renewal kyu
 * karega? … 5 din pahle reminder"). The enforcement that makes the ₹99 plan a real subscription:
 *
 *   T-5d / T-1d  → renewal reminder (in-app notification; names the exact ₹ shortfall when the
 *                  wallet cannot cover it — the user knows precisely what to do).
 *   T-0          → lazy auto-renew fires wherever the plan is next read; the sweep also tries it.
 *   T+3d (grace) → still unpaid ⇒ the LAPSE: every custom domain of that user is DETACHED from
 *                  hosting (the paid feature stops), the link is marked suspended, the user is told.
 *                  THE APP ITSELF NEVER GOES DOWN — it stays live on its free NavBharatAI URL with
 *                  the badge; only the paid domain pauses. An angry user with a dead app leaves; a
 *                  user whose vanity domain paused recharges and comes back.
 *   re-purchase  → suspended domains are RE-ATTACHED automatically (reattachSuspendedDomains) —
 *                  renewal undoes the lapse without a single manual step.
 *
 * Scheduling is two-layered, honestly bounded by our infra (no external cron exists):
 *   • a periodic in-process sweep (registered at boot beside the wallet routes), and
 *   • the lazy paths (wallet reads renew; the sweep decision is pure and idempotent),
 * so a quiet instance can delay a reminder — but never double-send one (markers) and never lapse
 * early (grace is checked against absolute time, not sweep cadence). A guaranteed-delivery upgrade
 * (Cloud Scheduler hitting a sweep endpoint) is recorded as an open infra item in PROGRESS.md.
 *
 * All side effects are injectable for tests; every step is idempotent so overlapping sweeps from
 * two instances converge instead of double-acting (the wallet write is transactional; detach and
 * notifications key off markers written in that transaction).
 */

import { doc, runTransaction, getServerDb } from './serverDb';
import {
  decidePlanSweepStep, hostingPlansEnabled, hostingPlanPriceInr, HOSTING_PLAN_ID,
  invalidatePlanCache, type PlanSweepAction, type HostingPlanRecord,
} from './hostingPlan';
import { saveNotification } from './AdminNotificationStore';
import { firebaseDomainLinksForUser, setDomainSuspended, type DomainLinkRecord } from './firebaseDomainLink';
import { deleteCustomDomain, attachCustomDomain } from './firebaseCustomDomain';

export interface SweepDeps {
  notify: (userId: string, message: string) => Promise<unknown>;
  detachDomain: (workspaceId: string, domain: string) => Promise<unknown>;
  attachDomain: (workspaceId: string, domain: string) => Promise<unknown>;
  linksForUser: (userId: string) => Promise<DomainLinkRecord[]>;
  setSuspended: (domain: string, reason: string | null) => Promise<unknown>;
  /**
   * The clock the sweep judges plans against. Injectable because the decision is entirely about
   * TIME: with the real clock hard-wired, a fixture's "expires in 2 days" silently became "expires
   * in 8 hours" as the calendar moved, and the suite only failed days after the code was written
   * (it did, on 2026-08-08). A test that rots with the wall clock is not a test — this makes the
   * sweep's `now` an input like every other dependency.
   */
  now: () => Date;
}

const realDeps: SweepDeps = {
  notify: (userId, message) => saveNotification({ message, target: { type: 'user', userId }, createdBy: 'system' }),
  detachDomain: (workspaceId, domain) => deleteCustomDomain(workspaceId, domain),
  attachDomain: (workspaceId, domain) => attachCustomDomain(workspaceId, domain),
  linksForUser: (userId) => firebaseDomainLinksForUser(userId),
  setSuspended: (domain, reason) => setDomainSuspended(domain, reason),
  now: () => new Date(),
};

let _deps: SweepDeps = realDeps;
/** Test seam. */
export function _setSweepDepsForTests(deps: Partial<SweepDeps> | null): void {
  _deps = deps ? { ...realDeps, ...deps } : realDeps;
}

/** User-facing texts — NavBharatAI terms only (White-Label Law: no vendor ever named). */
export function reminderMessage(days: number, expiresAt: string, shortfallInr: number): string {
  const date = new Date(expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return shortfallInr > 0
    ? `Your Custom Domain plan ends on ${date} and your wallet is about ₹${shortfallInr} short of the ₹${hostingPlanPriceInr()} renewal. Recharge before then to keep your domain live — otherwise the domain pauses (your app stays on its free NavBharatAI link).`
    : `Your Custom Domain plan renews on ${date} — ₹${hostingPlanPriceInr()} will be taken from your wallet automatically. Nothing to do; this is just a heads-up ${days} day${days === 1 ? '' : 's'} ahead.`;
}

export function lapseMessage(domains: string[]): string {
  const list = domains.length ? ` (${domains.join(', ')})` : '';
  return `Your Custom Domain plan has ended, so your domain${domains.length === 1 ? '' : 's'}${list} ${domains.length === 1 ? 'is' : 'are'} paused. Your app is still live on its free NavBharatAI link — nothing was deleted. Renew the plan from Billing → Plans and your domain reconnects automatically.`;
}

export function renewedMessage(): string {
  return `Your Custom Domain plan auto-renewed for 30 days (₹${hostingPlanPriceInr()} from your wallet). Your domain stays live.`;
}

export function reattachedMessage(domains: string[]): string {
  return `Welcome back! Your domain${domains.length === 1 ? '' : 's'} (${domains.join(', ')}) ${domains.length === 1 ? 'is' : 'are'} reconnecting now — live again within a few minutes once the certificate re-issues.`;
}

/**
 * Sweep ONE wallet doc: transactional decision, then the decided side effects. Exported for tests
 * and for the lazy paths. Returns the action taken (null = nothing due). Never throws.
 */
export async function sweepOneWallet(db: any, walletDocId: string): Promise<PlanSweepAction> {
  try {
    const ref = doc(db, 'user_token_wallets', walletDocId);
    const outcome = await runTransaction(db, async (t: any) => {
      const snap = await t.get(ref);
      if (!snap.exists()) return { action: null as PlanSweepAction, userId: walletDocId, expiresAt: '' };
      const current = snap.data();
      const step = decidePlanSweepStep(current, _deps.now().toISOString());
      if (step.applied) t.set(ref, step.wallet);
      const plan = step.wallet.hostingPlan as HostingPlanRecord | undefined;
      return { action: step.action, userId: (current.userId as string) || walletDocId, expiresAt: plan?.expiresAt ?? '' };
    });
    const { action, userId } = outcome;
    if (!action) return null;
    invalidatePlanCache(userId);

    if (action.kind === 'remind') {
      await _deps.notify(userId, reminderMessage(action.days, outcome.expiresAt, action.shortfallInr)).catch(() => null);
    } else if (action.kind === 'renewed') {
      await _deps.notify(userId, renewedMessage()).catch(() => null);
    } else if (action.kind === 'lapse') {
      // Enforce: detach every ACTIVE link the user has. Idempotent — a re-run detaches nothing new.
      const links = (await _deps.linksForUser(userId)).filter((l) => !l.suspended);
      const detached: string[] = [];
      for (const link of links) {
        try {
          await _deps.detachDomain(link.workspaceId, link.domain);
          await _deps.setSuspended(link.domain, 'plan_lapsed');
          detached.push(link.domain);
        } catch { /* one stubborn domain must not block the rest; the next sweep retries it */ }
      }
      await _deps.notify(userId, lapseMessage(detached)).catch(() => null);
    }
    return action;
  } catch {
    return null;
  }
}

/**
 * The periodic sweep: every wallet whose plan is inside the reminder window, expired, or lapsed.
 * Firestore auto-indexes map subfields, so the inequality on `hostingPlan.expiresAt` needs no
 * composite index. Bounded per pass; the next pass picks up the rest. Never throws.
 */
export async function sweepHostingPlans(limit = 200): Promise<number> {
  if (!hostingPlansEnabled()) return 0;
  const db = getServerDb() as any;
  if (!db) return 0;
  try {
    const horizon = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    // ONE inequality on a single (auto-indexed) subfield — an equality+inequality combo on two
    // fields would demand a composite index and fail FAILED_PRECONDITION at runtime, which the
    // catch below would turn into a silent forever-no-op. The id check happens in memory instead.
    const snap = await db
      .collection('user_token_wallets')
      .where('hostingPlan.expiresAt', '<=', horizon)
      .limit(Math.max(1, limit))
      .get();
    let acted = 0;
    for (const walletDoc of snap.docs) {
      if ((walletDoc.data()?.hostingPlan as HostingPlanRecord | undefined)?.id !== HOSTING_PLAN_ID) continue;
      const action = await sweepOneWallet(db, walletDoc.id);
      if (action) acted++;
    }
    return acted;
  } catch {
    return 0;
  }
}

/**
 * Renewal undoes the lapse: re-attach every suspended domain of a user who just (re-)purchased.
 * Called (void, best-effort) from the purchase route. Notifies on success. Never throws.
 */
export async function reattachSuspendedDomains(userId: string): Promise<number> {
  try {
    const links = (await _deps.linksForUser(userId)).filter((l) => l.suspended === 'plan_lapsed');
    const restored: string[] = [];
    for (const link of links) {
      try {
        await _deps.attachDomain(link.workspaceId, link.domain);
        await _deps.setSuspended(link.domain, null);
        restored.push(link.domain);
      } catch { /* stays suspended; the user can also reconnect from the domain screen */ }
    }
    if (restored.length > 0) await _deps.notify(userId, reattachedMessage(restored)).catch(() => null);
    return restored.length;
  } catch {
    return 0;
  }
}

let _sweepTimer: ReturnType<typeof setInterval> | null = null;

/** Register the periodic sweep at boot (idempotent; no-op under VITEST). */
export function registerHostingPlanSweep(): void {
  if (process.env.VITEST || _sweepTimer) return;
  // First pass shortly after boot (instances recycle on every deploy — don't wait 6h to remind),
  // then every 6 hours. Cadence never affects CORRECTNESS: decisions are pure over absolute time.
  setTimeout(() => { void sweepHostingPlans(); }, 2 * 60 * 1000);
  _sweepTimer = setInterval(() => { void sweepHostingPlans(); }, 6 * 60 * 60 * 1000);
}
