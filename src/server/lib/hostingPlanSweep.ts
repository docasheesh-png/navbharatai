/**
 * Hosting-plan lifecycle sweep (admin 2026-08-06: "jab app down hategi hi nahi, to user renewal kyu
 * karega? … 5 din pahle reminder"). The enforcement that makes the ₹99 plan a real subscription:
 *
 *   T-5d/3d/1d   → renewal reminder (in-app notification; names the exact ₹ shortfall when the
 *                  wallet cannot cover it — the user knows precisely what to do).
 *   T-0          → lazy auto-renew fires wherever the plan is next read; the sweep also tries it.
 *   T+0..3d      → ONE grace message: the plan HAS ended, N days before the domain pauses.
 *   T+3d (grace) → still unpaid ⇒ the LAPSE, which is a DEMOTION TO THE FREE TIER:
 *                    • every custom domain of that user is DETACHED and marked suspended, and
 *                    • apps above the FREE published-app allowance are genuinely taken offline
 *                      (channel deleted, marked `plan_paused` — files kept, nothing deleted).
 *   re-purchase  → suspended domains are RE-ATTACHED automatically (reattachSuspendedDomains);
 *                  paused apps go back up when the owner opens one and presses Publish. That step is
 *                  MANUAL on purpose: republishing re-runs a real sandbox build, so auto-restoring a
 *                  dozen apps inside a sweep would spend real money and fail often. A button that only
 *                  looked like a one-tap restore would be worse than the honest instruction.
 *
 * ⚠️ THE LINE THAT USED TO STAND HERE — "THE APP ITSELF NEVER GOES DOWN" — IS NO LONGER TRUE, and it
 * is replaced rather than deleted so the change of policy is legible. Admin 2026-09-10: "user ka month
 * complete ho gaya, tab to app offline honi chahiye, nahi to user recharge hi nahi karega." The
 * demotion is the version of that which is FAIR: a lapsed payer falls back to exactly what a free
 * account gets, never below it. Switching them off entirely would have left someone who paid strictly
 * worse than someone who never paid a rupee, and their site's own visitors would have paid for it too.
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
  decidePlanSweepStep, hostingPlansEnabled, planPriceInr, planDays,
  invalidatePlanCache, type PlanSweepAction, type HostingPlanRecord,
  appsToPauseOnLapse, type PausableApp,
} from './hostingPlan';
import { LEGACY_HOSTING_PLAN_ID, isKnownPlanId, tierForPlanId } from '../../lib/hostingTiers';
import { saveNotification } from './AdminNotificationStore';
import { firebaseDomainLinksForUser, setDomainSuspended, type DomainLinkRecord } from './firebaseDomainLink';
import { deleteCustomDomain, attachCustomDomain } from './firebaseCustomDomain';
import { publishedAppCap } from './HostingQuota';
import { deploymentStore } from '../AgentV3/DeploymentStore';
import { FirebaseHostingDeployer } from '../AgentV3/Deployment';

export interface SweepDeps {
  notify: (userId: string, message: string) => Promise<unknown>;
  detachDomain: (workspaceId: string, domain: string) => Promise<unknown>;
  /** Every deployment record this user holds — the input to the lapse demotion. */
  appsForUser: (userId: string) => Promise<PausableApp[]>;
  /**
   * Take ONE app genuinely offline: delete its live Hosting channel, then mark it `plan_paused`.
   *
   * 🔒 THE CHANNEL DELETE MUST SUCCEED BEFORE THE REGISTRY MOVES. A record saying "paused" over a
   * site that is still serving is the fake status this codebase's own unpublish route warns about —
   * and here it would be worse, because the user would be told to renew to get back something that
   * never went away. Throwing leaves the app live AND active, which the next sweep retries.
   */
  pauseApp: (workspaceId: string) => Promise<unknown>;
  /** `redirectTarget` is the canonical host when re-attaching a `www` twin (ROADMAP §13, 1.2). */
  attachDomain: (workspaceId: string, domain: string, redirectTarget?: string) => Promise<unknown>;
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
  attachDomain: (workspaceId, domain, redirectTarget) => attachCustomDomain(workspaceId, domain, redirectTarget ? { redirectTarget } : undefined),
  linksForUser: (userId) => firebaseDomainLinksForUser(userId),
  setSuspended: (domain, reason) => setDomainSuspended(domain, reason),
  appsForUser: (userId) => deploymentStore.listByUser(userId, 500),
  pauseApp: async (workspaceId) => {
    // Real removal first — see the interface note. If this throws, nothing is marked.
    await new FirebaseHostingDeployer().deleteChannel(workspaceId);
    await deploymentStore.setStatus(workspaceId, 'plan_paused');
  },
  now: () => new Date(),
};

let _deps: SweepDeps = realDeps;
/** Test seam. */
export function _setSweepDepsForTests(deps: Partial<SweepDeps> | null): void {
  _deps = deps ? { ...realDeps, ...deps } : realDeps;
}

/**
 * User-facing texts — NavBharatAI terms only (White-Label Law: no vendor ever named).
 *
 * ⚠️ EVERY ONE OF THESE TAKES THE USER'S OWN PLAN ID, and that is not tidiness. They used to name
 * "Custom Domain" and quote `hostingPlanPriceInr()` — the ADVERTISED entry price. With two tiers and
 * a grandfathered ₹99 plan, that would tell a Growth customer their ₹499 plan renews at ₹149 and a
 * legacy holder that theirs renews at ₹149 when it renews at ₹99. A renewal notice that misstates
 * the amount about to leave someone's wallet is the worst kind of wrong message to send.
 */
export function planLabel(planId: string | null | undefined): string {
  if (String(planId ?? '') === LEGACY_HOSTING_PLAN_ID) return 'Custom Domain';
  return `${tierForPlanId(planId)?.name ?? 'Hosting'} hosting`;
}

export function reminderMessage(days: number, expiresAt: string, shortfallInr: number, planId?: string | null): string {
  const date = new Date(expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const label = planLabel(planId);
  const price = planPriceInr(planId);
  return shortfallInr > 0
    ? `Your ${label} plan ends on ${date} and your wallet is about ₹${shortfallInr} short of the ₹${price} renewal. Recharge before then to keep your domain live — otherwise the domain pauses (your app stays on its free NavBharatAI link).`
    : `Your ${label} plan renews on ${date} — ₹${price} will be taken from your wallet automatically. Nothing to do; this is just a heads-up ${days} day${days === 1 ? '' : 's'} ahead.`;
}

/**
 * The message sent once AFTER expiry, while the grace window is still running.
 *
 * It says the thing the pre-expiry reminders cannot: the plan is over NOW, and there are only N days
 * before the domain actually pauses. It names the shortfall when the wallet cannot cover the renewal,
 * for the same reason the pre-expiry reminder does — "recharge" is not actionable if you do not know
 * how much.
 */
export function graceMessage(graceDaysLeft: number, shortfallInr: number, planId?: string | null): string {
  const label = planLabel(planId);
  const price = planPriceInr(planId);
  const window = `${graceDaysLeft} day${graceDaysLeft === 1 ? '' : 's'}`;
  return shortfallInr > 0
    ? `Your ${label} plan has ended. You have ${window} left to renew before your domain pauses — your wallet is about ₹${shortfallInr} short of the ₹${price} renewal. Recharge and it renews automatically, with nothing interrupted. Your app stays live on its free NavBharatAI link either way.`
    : `Your ${label} plan has ended. You have ${window} left to renew before your domain pauses — ₹${price} from your wallet, and nothing is interrupted. Your app stays live on its free NavBharatAI link either way.`;
}

/**
 * The lapse message.
 *
 * ⚠️ IT NOW CARRIES TWO DIFFERENT PIECES OF BAD NEWS, and conflating them would leave the user
 * guessing which happened to them: the domain always pauses, and apps ABOVE the free allowance are
 * paused too. It names the COUNT rather than the list — a user with fifteen paused apps does not want
 * fifteen names in a notification, and the published-apps screen has the list.
 *
 * It also says, in the same breath, what did NOT happen: nothing was deleted, and the free apps are
 * still live. Bad news that omits the limits of the damage reads as worse than it is.
 */
export function lapseMessage(domains: string[], planId?: string | null, pausedApps = 0): string {
  const list = domains.length ? ` (${domains.join(', ')})` : '';
  const domainPart = domains.length
    ? `your domain${domains.length === 1 ? '' : 's'}${list} ${domains.length === 1 ? 'is' : 'are'} paused`
    : 'your plan benefits have stopped';
  const appPart = pausedApps > 0
    ? ` You are back on the free ${publishedAppCap()} published apps, so ${pausedApps} app${pausedApps === 1 ? '' : 's'} ${pausedApps === 1 ? 'has' : 'have'} been paused — nothing was deleted, and your files are all still here.`
    : ' Your apps are still live on their free NavBharatAI links — nothing was deleted.';
  return `Your ${planLabel(planId)} plan has ended, so ${domainPart}.${appPart} Renew from Billing → Plans: your domain reconnects on its own, and a paused app goes back online when you open it and press Publish.`;
}

export function renewedMessage(planId?: string | null): string {
  return `Your ${planLabel(planId)} plan auto-renewed for ${planDays(planId)} days (₹${planPriceInr(planId)} from your wallet). Your domain stays live.`;
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
      if (!snap.exists()) return { action: null as PlanSweepAction, userId: walletDocId, expiresAt: '', planId: null as string | null };
      const current = snap.data();
      const step = decidePlanSweepStep(current, _deps.now().toISOString());
      if (step.applied) t.set(ref, step.wallet);
      const plan = step.wallet.hostingPlan as HostingPlanRecord | undefined;
      return { action: step.action, userId: (current.userId as string) || walletDocId, expiresAt: plan?.expiresAt ?? '', planId: plan?.id ?? null };
    });
    const { action, userId } = outcome;
    if (!action) return null;
    invalidatePlanCache(userId);

    if (action.kind === 'remind') {
      await _deps.notify(userId, reminderMessage(action.days, outcome.expiresAt, action.shortfallInr, outcome.planId)).catch(() => null);
    } else if (action.kind === 'grace') {
      await _deps.notify(userId, graceMessage(action.graceDaysLeft, action.shortfallInr, outcome.planId)).catch(() => null);
    } else if (action.kind === 'renewed') {
      await _deps.notify(userId, renewedMessage(outcome.planId)).catch(() => null);
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
      /**
       * THE DEMOTION (admin 2026-09-10). Back to the free allowance: apps above it go genuinely
       * offline. Domain-holding apps keep the free slots — see `appsToPauseOnLapse` for why.
       *
       * `links` is read BEFORE suspension above, which is exactly "which apps had a real domain
       * pointed at them"; suspending the domain does not change that fact.
       *
       * Bounded and forgiving: one app that refuses to come down must not stop the rest, and it stays
       * ACTIVE (never marked paused) so the next sweep retries it instead of lying about it.
       */
      const pausedIds: string[] = [];
      try {
        const apps = await _deps.appsForUser(userId);
        const domainOwners = links.map((l) => l.workspaceId);
        for (const workspaceId of appsToPauseOnLapse(apps, publishedAppCap(), domainOwners)) {
          try {
            await _deps.pauseApp(workspaceId);
            pausedIds.push(workspaceId);
          } catch { /* stays live and active; the next sweep tries again */ }
        }
      } catch { /* the domain half of the lapse already happened and must not be undone by this */ }

      await _deps.notify(userId, lapseMessage(detached, outcome.planId, pausedIds.length)).catch(() => null);
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
      // ⚠️ Asks the CATALOGUE, not one constant. The old `!== HOSTING_PLAN_ID` test would have
      // skipped every Starter and Growth wallet — no reminders, no renewals, no lapses, and nothing
      // failing anywhere to say so.
      if (!isKnownPlanId((walletDoc.data()?.hostingPlan as HostingPlanRecord | undefined)?.id)) continue;
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
        await _deps.attachDomain(link.workspaceId, link.domain, link.alternateOf ?? undefined);
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
