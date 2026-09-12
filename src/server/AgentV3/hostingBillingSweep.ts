// THE DAILY HOSTING CHARGE (ROADMAP §11 slice 2.1 / §13 item 2.1) — measure, price, debit, once.
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
  lastCompleteDay, decideHostingDebit, hostingLedgerRef, HOSTING_LEDGER_LABEL, hostingDebitNote,
  type BillingWindow,
} from './hostingBillingDay';
import { hostingBillingStore } from './HostingBillingStore';
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
  const win = opts?.window ?? lastCompleteDay(opts?.now ?? Date.now());
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

  const usdInr = usdInrRate();
  const billingEnabled = hostingBillingEnabled(env);
  const db = getServerDb() as unknown;

  for (const app of apps) {
    out.considered++;
    try {
      /**
       * 🔒 THE RECORDED NAME FIRST, and the derivation only as a fallback for records written before
       * that field existed. `serviceNameFor` folds the app's NAME into the service name, so an app
       * renamed after it was hosted would derive a service that does not exist — and this sweep would
       * then measure nothing and bill ₹0 for an app genuinely costing us money, with no error anywhere
       * to reveal it. The deploy knows the real name; it is now written down.
       */
      const serviceName = String(app.service ?? '').trim() || serviceNameFor(app.workspaceId, null);

      const measured = await readHostingUsage({
        token: String(token),
        projectId: String(project.projectId),
        serviceName,
        startIso: win.startIso,
        endIso: win.endIso,
        // Build minutes belong to the DEPLOY, not to a day of serving, and attributing a build to a
        // calendar day we did not observe would be an invented number. Named as a gap instead.
      }, opts?.fetchImpl ?? fetch);

      const cost = hostingCostUsd(measured.usage, env);
      const billable = hostingBillableUsd(cost, env);
      const ownerId = String(app.userId ?? '').trim();
      const decision = decideHostingDebit({
        billableUsd: billable,
        usdInr,
        ownerId: ownerId && ownerId !== 'anon' ? ownerId : null,
        billingEnabled,
      });

      const line = `${serviceName}: ${hostingDebitNote(decision, win.day)} ${hostingCostNote(cost, env)} ${usageGapNote(measured)}`.trim();
      if (!decision.charge) { out.notes.push(line); continue; }

      // The guard comes BEFORE the money. See HostingBillingStore — this ordering can only ever
      // under-charge, and under-charging is the side the billing law lets us be wrong on.
      const claimed = await hostingBillingStore.claim({
        workspaceId: app.workspaceId,
        day: win.day,
        userId: ownerId,
        billedInr: decision.billedInr,
        costUsd: cost.usd,
      });
      if (!claimed) {
        out.skipped++;
        out.notes.push(`${serviceName}: already billed for ${win.day}, or the guard could not be written — nothing charged.`);
        continue;
      }

      const res = await debitWalletRolledUp(db as never, ownerId, {
        billedInr: decision.billedInr,
        rollupRef: hostingLedgerRef(win.day),
        description: HOSTING_LEDGER_LABEL,
      }).catch(() => ({ ok: false as const, error: 'debit threw' }));

      if (!res.ok) {
        // The day stays reserved and `debited` stays false, so it shows up in `absorbed()` as an app
        // we hosted for free rather than as a charge nobody can find.
        out.notes.push(`${serviceName}: reserved ₹${decision.billedInr.toFixed(2)} for ${win.day} but the debit failed (${res.error}) — absorbed by NavBharatAI.`);
        continue;
      }

      await hostingBillingStore.markDebited(app.workspaceId, win.day, res.tokensDebited);
      out.charged++;
      out.totalInr = Math.round((out.totalInr + decision.billedInr) * 100) / 100;
      out.notes.push(line);
    } catch (e) {
      // One app's failure must never stop the rest of the sweep — the alternative is that a single
      // deleted service silently cancels billing for every other app on the platform.
      out.notes.push(`${app.workspaceId}: hosting billing failed (${e instanceof Error ? e.message : String(e)}) — nothing charged.`);
    }
  }

  return out;
}
