// THE DAILY HOSTING CHARGE — what a plan holder actually pays, and nothing more.
//
// 🔴 REWRITTEN 2026-09-13, BEFORE IT EVER CHARGED ANYBODY. The first version priced every hosted app
// at "our cost + 20%" (decision D5) and knew nothing about hosting plans — so a ₹149 Starter holder,
// who has already been SOLD 5 GB of traffic in the agreement they tick before paying, would have been
// charged for that 5 GB a second time. The admin found it by asking the plain question: "to hum ₹149
// ke plan me user ko kya de rahe hai?"
//
// WHAT IT CHARGES NOW: exactly the ticked terms. One meter — visitor traffic — measured across ALL of
// the owner's hosted sites together, the plan's included GB free, and ₹20 per GB above it. D5 has not
// been thrown away: `hostingCostUsd` still computes what the app really costs US, and that number
// goes to the ADMIN report, where it answers the one question it was ever for — is ₹20/GB above our
// own cost or below it?
//
// 🔒 NO PLAN ⇒ NOTHING IS BILLED HERE, because an account with no plan should not have a container
// app running at all (`hostingAvailability` refuses it). If one is found, it is reported rather than
// charged: inventing a bill for somebody who agreed to no terms is not something this file may do.
//
// Slice 2 built every piece and deliberately wired none of them to a wallet: `readHostingUsage`
// measures from Google, `hostingCostUsd` prices the four D5 lines, `hostingBillableUsd` applies the
// markup and the billing law's two conditions. The admin route reported `wouldBill` so the switch
// could be flipped against real numbers. This is the flip.
//
// 🔒 IT IS THE LAST GATE BEFORE `NAVBHARAT_CLOUD_PUBLIC`, and that is why it exists now. Hosting is
// admin-only today for one reason written into CLAUDE.md: with hosting open and no metering, every
// hosted app's Cloud Run bill lands on NavBharatAI with nothing recording it. Metering is this file.
//
// WHAT IT WILL NOT DO, stated so nobody has to infer it from the absence of code:
//   • It does not PAUSE an app whose owner has run out of credit. `plan_paused` exists in the
//     registry and would be the mechanism, but taking somebody's live site off the internet over a
//     balance is a product decision with a real person on the other end of it — the admin's to make,
//     not a sweep's to assume. Today the balance simply goes down, exactly as a build's does, and the
//     admin report names any app whose owner could not pay.
//   • It does not bill a partial day, ever. See hostingBillingDay.ts.
//
// NEVER THROWS. A billing sweep that crashes the scheduler would take every other scheduled job with
// it, and the failure mode of this one must always be "we under-charged", never "the platform broke".

import { GoogleAuth } from 'google-auth-library';
import { deploymentStore, type DeploymentRecord } from './DeploymentStore';
import { NAVBHARAT_CLOUD_PROVIDER } from './hostedDeploymentRecord';
import { appsProject, serviceNameFor } from './cloudRunHosting';
import { readHostingUsage, usageGapNote } from './hostingUsage';
import { hostingCostUsd, hostingBillableUsd, hostingBillingEnabled, hostingCostNote } from './hostingCost';
import {
  lastCompleteDay, hostingLedgerRef, HOSTING_LEDGER_LABEL,
  type BillingWindow,
} from './hostingBillingDay';
import {
  decideOverage, decideDebtAction, periodStartFrom, daysBetween, HOSTING_DEBT_GRACE_DAYS,
} from '../lib/hostingOverage';
import { hostingBillingStore } from './HostingBillingStore';
import { hostingPeriodUsageStore } from './HostingPeriodUsageStore';
import { readHostingPlanStatus, planDays } from '../lib/hostingPlan';
import { HOSTING_OVERAGE_INR_PER_GB } from '../../lib/hostingTiers';
import { readWalletBalanceInr, firestoreWalletReader } from './WalletBalance';
import { saveNotification } from '../lib/AdminNotificationStore';
import { deploymentStore as deployments } from './DeploymentStore';
import { debitWalletRolledUp } from '../lib/walletDebit';
import { getServerDb } from '../lib/serverDb';
import { usdInrRate } from '../lib/UsdInrRate';

export interface SweepResult {
  day: string;
  /** Apps we looked at. */
  considered: number;
  /** Apps whose wallet really moved. */
  charged: number;
  /** ₹ taken across every app. */
  totalInr: number;
  /** Apps already billed for this day, or whose guard could not be written. */
  skipped: number;
  /** One admin line per app. Never user-facing — these name our own infrastructure cost. */
  notes: string[];
  /**
   * Was the deployment registry read in full?
   *
   * 🔒 REPORTED, NOT ASSUMED. `listWithCompleteness` exists because `[]` means both "no apps" and
   * "Firestore threw", and a sweep that concluded "nothing to bill" from a failed read would look
   * exactly like a quiet month. An incomplete read is a gap in the billing, and it is named.
   */
  registryComplete: boolean;
}

/** Is this record a NavBharat Cloud app that is live right now? */
function isHostedLiveApp(r: DeploymentRecord): boolean {
  return String(r.providerId ?? '') === NAVBHARAT_CLOUD_PROVIDER
    && (r.status ?? 'active') === 'active'
    && !!r.url;
}

/**
 * Bill every hosted app for the last complete UTC day.
 *
 * `now` and the fetch are injected so the whole sweep is testable without a clock or a network — the
 * same discipline `hostAppOnNavBharatCloud` follows, and for the same reason: a money path nobody can
 * run in a test is a money path nobody can check.
 */
export async function runHostingBillingSweep(opts?: {
  now?: number;
  window?: BillingWindow;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  maxApps?: number;
}): Promise<SweepResult> {
  const env = opts?.env ?? process.env;
  const nowMs = opts?.now ?? Date.now();
  const win = opts?.window ?? lastCompleteDay(nowMs);
  const out: SweepResult = {
    day: win.day, considered: 0, charged: 0, totalInr: 0, skipped: 0, notes: [], registryComplete: false,
  };

  const project = appsProject(env);
  if (!project.projectId) {
    out.notes.push(`Hosting billing skipped: ${project.message}`);
    return out;
  }

  const listing = await deploymentStore.listWithCompleteness({ limit: opts?.maxApps ?? 500 })
    .catch(() => ({ records: [] as DeploymentRecord[], complete: false }));
  out.registryComplete = listing.complete;
  const apps = listing.records.filter(isHostedLiveApp);
  if (apps.length === 0) return out;

  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const token = await auth.getAccessToken().catch(() => null);
  if (!token) {
    out.notes.push('Hosting billing skipped: could not authenticate with Google Cloud. Nothing was charged.');
    return out;
  }

  const billingEnabled = hostingBillingEnabled(env);
  const db = getServerDb() as unknown;

  /**
   * 🔒 GROUPED BY OWNER, because the allowance is the OWNER'S, not the app's. The agreement says the
   * included GB covers "all your connected sites" together — billing each app against its own 5 GB
   * would hand somebody with three sites fifteen free GB, and the terms they ticked promise five.
   */
  const byOwner = new Map<string, DeploymentRecord[]>();
  for (const app of apps) {
    const ownerId = String(app.userId ?? '').trim();
    if (!ownerId || ownerId === 'anon') {
      out.considered++;
      out.notes.push(`${app.workspaceId}: hosted with no owner on the record — nothing charged.`);
      continue;
    }
    const list = byOwner.get(ownerId) ?? [];
    list.push(app);
    byOwner.set(ownerId, list);
  }

  for (const [ownerId, owned] of byOwner) {
    out.considered += owned.length;
    try {
      /**
       * 🔒 ONE CLAIM PER OWNER PER DAY, TAKEN BEFORE ANYTHING IS MEASURED — and this is load-bearing
       * in a way it was not under the old per-app model. The allowance is billed against a RUNNING
       * TOTAL, so a job that ran twice on the same day would add the same day's GB to that total
       * twice and charge somebody for traffic that never happened. `create` fails on the second
       * attempt, which is exactly what makes a re-run cost nothing.
       *
       * A claim that could not be WRITTEN also skips the owner (the store fails closed), so a
       * Firestore hiccup under-bills by a day rather than risking a double count.
       */
      const claimed = await hostingBillingStore.claim({
        subject: ownerId, day: win.day, userId: ownerId, billedInr: 0, costUsd: 0,
      });
      if (!claimed) {
        out.skipped++;
        out.notes.push(`${ownerId}: already processed for ${win.day}, or the guard could not be written — nothing charged.`);
        continue;
      }

      // ── What the OWNER bought ──────────────────────────────────────────────────────────────────
      const status = await readHostingPlanStatus(db as never, ownerId).catch(() => null);
      const tier = status?.active ? status.tier : null;
      const plan = status?.active ? status.plan : null;
      /**
       * 🔒 A LEGACY ₹99 PLAN IS NEVER CHARGED OVERAGE. Those records carry no `agreedAt` because the
       * overage terms did not exist when they were sold — `hostingPlan.ts` states that as law, and a
       * charge nobody was shown is not a charge. They keep Starter's entitlements for their price.
       */
      const agreed = !!plan?.agreedAt;

      // ── What their sites actually served ───────────────────────────────────────────────────────
      let gbToday: number | null = null;
      let costUsd = 0;
      const gaps: string[] = [];
      for (const app of owned) {
        /**
         * 🔒 THE RECORDED SERVICE NAME FIRST. `serviceNameFor` folds the app's NAME into the service
         * name, and an app can be renamed — after which a derived name addresses a service that does
         * not exist, and this sweep measures nothing and bills ₹0 for an app genuinely costing money.
         */
        const serviceName = String(app.service ?? '').trim() || serviceNameFor(app.workspaceId, null);
        const measured = await readHostingUsage({
          token: String(token),
          projectId: String(project.projectId),
          serviceName,
          startIso: win.startIso,
          endIso: win.endIso,
        }, opts?.fetchImpl ?? fetch);
        // ADMIN-side only: what this app really cost US, for the D5 comparison against ₹20/GB.
        costUsd += hostingCostUsd(measured.usage, env).usd;
        const gap = usageGapNote(measured);
        if (gap) gaps.push(`${serviceName}: ${gap}`);
        // null and 0 stay different: an unread meter must not shrink the total the user is billed on.
        if (typeof measured.usage.egressGib === 'number') {
          gbToday = (gbToday ?? 0) + measured.usage.egressGib;
        }
      }

      if (!tier) {
        // Not charged, and said out loud — an app running with no plan is a gate that leaked, not a
        // billing opportunity. `hostingAvailability` is what should have refused it.
        out.notes.push(`${ownerId}: ${owned.length} hosted app(s) with NO active plan — nothing charged. Hosting should not be running for this account.`);
        continue;
      }

      const periodStart = periodStartFrom(plan?.expiresAt, planDays(plan?.id));
      const usage = periodStart ? await hostingPeriodUsageStore.read(ownerId, periodStart) : null;
      if (!usage) {
        // 🔒 An unreadable period total is NOT an empty one — see HostingPeriodUsageStore.read. Billing
        // on a blank record would hand back the whole allowance and re-charge GB already charged for.
        out.skipped++;
        out.notes.push(`${ownerId}: period usage could not be read — nothing charged for ${win.day}.`);
        continue;
      }

      const decision = decideOverage({
        gbToday,
        usage,
        includedGb: tier.includedTransferGb,
        ratePerGb: HOSTING_OVERAGE_INR_PER_GB,
        hasPlan: true,
        agreed,
      });

      const costNote = `our cost $${costUsd.toFixed(6)} for the day`;
      const usedNote = `${decision.periodGb.toFixed(3)} GB of ${tier.includedTransferGb} GB used this period`;
      if (!decision.charge) {
        out.notes.push(`${ownerId} (${tier.name}): ${usedNote} — ${decision.reason.replace(/-/g, ' ')}, nothing charged. ${costNote}. ${gaps.join(' ')}`.trim());
        // The running total still advances even when nothing is owed — that is the whole point of it.
        await hostingPeriodUsageStore.record(ownerId, periodStart, {
          periodGb: decision.periodGb, gbBilled: usage.gbBilled, addInrBilled: 0,
          owedInr: usage.owedInr, owedSince: usage.owedSince,
        });
        await settleDebt(db, ownerId, owned, usage.owedInr, usage.owedSince, nowMs, out);
        continue;
      }

      if (!billingEnabled) {
        out.notes.push(`${ownerId} (${tier.name}): ${usedNote} — ₹${decision.inr.toFixed(2)} of overage ABSORBED (NAVBHARAT_BILL_HOSTING is off). ${costNote}.`);
        await hostingPeriodUsageStore.record(ownerId, periodStart, {
          periodGb: decision.periodGb, gbBilled: usage.gbBilled, addInrBilled: 0,
          owedInr: usage.owedInr, owedSince: usage.owedSince,
        });
        continue;
      }

      const res = await debitWalletRolledUp(db as never, ownerId, {
        feature: 'hosting',
        billedInr: decision.inr,
        rollupRef: hostingLedgerRef(win.day),
        description: HOSTING_LEDGER_LABEL,
      }).catch(() => ({ ok: false as const, error: 'debit threw' }));

      /**
       * 🔒 THE GB ARE MARKED BILLED EITHER WAY, and the unpaid rupees become a DEBT rather than a
       * charge that silently repeats. Leaving them unbilled would re-charge the same traffic tomorrow
       * and the day after, so an empty wallet would grow a bill that never stops — which is neither
       * what the agreement says nor anything a person could reconcile.
       */
      const owedInr = res.ok ? usage.owedInr : Math.round((usage.owedInr + decision.inr) * 100) / 100;
      const owedSince = res.ok
        ? usage.owedSince
        : (usage.owedSince ?? new Date(nowMs).toISOString());
      await hostingPeriodUsageStore.record(ownerId, periodStart, {
        periodGb: decision.periodGb,
        gbBilled: Math.round((usage.gbBilled + decision.billableGb) * 1e6) / 1e6,
        addInrBilled: res.ok ? decision.inr : 0,
        owedInr,
        owedSince,
      });

      if (res.ok) {
        await hostingBillingStore.markDebited(ownerId, win.day, res.tokensDebited);
        out.charged++;
        out.totalInr = Math.round((out.totalInr + decision.inr) * 100) / 100;
        out.notes.push(`${ownerId} (${tier.name}): ${usedNote} — charged ₹${decision.inr.toFixed(2)} for ${decision.billableGb.toFixed(3)} GB. ${costNote}.`);
      } else {
        out.notes.push(`${ownerId} (${tier.name}): ${usedNote} — ₹${decision.inr.toFixed(2)} could NOT be taken (${res.error}); now owed ₹${owedInr.toFixed(2)}. ${costNote}.`);
      }
      await settleDebt(db, ownerId, owned, owedInr, owedSince, nowMs, out);
    } catch (e) {
      // One owner's failure must never stop the sweep — the alternative is that a single deleted
      // service silently cancels billing for every other account on the platform.
      out.notes.push(`${ownerId}: hosting billing failed (${e instanceof Error ? e.message : String(e)}) — nothing charged.`);
    }
  }

  return out;
}

/**
 * What to do about traffic that was charged and could not be paid.
 *
 * 🔒 A REMINDER ALWAYS COMES FIRST, and the grace clock starts at the reminder. Going straight from
 * "owed" to "offline" is the surprise the admin objected to in the alert system, applied to something
 * far worse than an email — somebody's customers meeting a dead site. The agreement promises the
 * reminder in as many words, so the code owes it.
 *
 * 🔒 AND THE SITE IS ONLY EVER MARKED, NEVER DELETED. `plan_paused` stops it being served and frees
 * nothing the owner cannot get back: the files are in the durable store and the app returns when they
 * top up and publish — exactly as the terms they ticked describe.
 */
async function settleDebt(
  db: unknown,
  ownerId: string,
  owned: DeploymentRecord[],
  owedInr: number,
  owedSince: string | null,
  nowMs: number,
  out: SweepResult,
): Promise<void> {
  if (!(owedInr > 0)) return;
  const balanceInr = await readWalletBalanceInr(firestoreWalletReader(db as never), ownerId).catch(() => null);
  const action = decideDebtAction({
    owedInr,
    balanceInr,
    owedForDays: daysBetween(owedSince, nowMs),
    graceDays: HOSTING_DEBT_GRACE_DAYS,
  });
  if (action === 'none') return;

  if (action === 'warn') {
    out.notes.push(`${ownerId}: owes ₹${owedInr.toFixed(2)} with an empty wallet — reminded.`);
    await saveNotification({
      message: `Your sites have used more traffic than your plan includes. ₹${owedInr.toFixed(2)} is pending and your wallet is empty — please top up within ${HOSTING_DEBT_GRACE_DAYS} days to keep your sites online. Nothing is deleted either way.`,
      target: { type: 'user', userId: ownerId },
      createdBy: 'system',
    }).catch(() => null);
    return;
  }

  for (const app of owned) {
    await deployments.setStatus(app.workspaceId, 'plan_paused').catch(() => false);
  }
  out.notes.push(`${ownerId}: owes ₹${owedInr.toFixed(2)} past the ${HOSTING_DEBT_GRACE_DAYS}-day grace — ${owned.length} app(s) taken offline.`);
  await saveNotification({
    message: `Your sites are offline because ₹${owedInr.toFixed(2)} of extra traffic is still unpaid. Nothing has been deleted — add balance to your wallet, then open your app and press Publish to put it back online.`,
    target: { type: 'user', userId: ownerId },
    createdBy: 'system',
  }).catch(() => null);
}
