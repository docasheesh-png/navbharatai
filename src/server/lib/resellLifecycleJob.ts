// Wires the pure resell sweep (resellLifecycle.ts) to Firestore, notifications and the scheduler.
// Registered only when RESELL_EXPIRY_SWEEP=on, and never under VITEST.
import { getServerDb, doc, runTransaction } from './serverDb';
import { scheduler } from './ScheduledJobs';
import { saveNotification } from './AdminNotificationStore';
import { resellExpirySweepEnabled } from './purchaseAuditFlags';
import { sweepResellAddons, type ResellRow, type ResellSweepReport } from './resellLifecycle';

export const RESELL_EXPIRY_JOB = 'resell-expiry-sweep';
let registered = false;

export async function runResellExpirySweep(
  teardownServer: (workspaceId: string) => Promise<{ ok: boolean }>,
  limit = 300,
): Promise<ResellSweepReport | null> {
  if (!resellExpirySweepEnabled()) return null;
  const db = getServerDb() as any;
  if (!db) return null;
  const report = await sweepResellAddons({
    listWallets: async () => {
      // `hasHostingAddons` is written by every add-on purchase (hostingAddonLedger), so this is an
      // equality on one field — no composite index.
      const snap = await db.collection('user_token_wallets').where('hasHostingAddons', '==', true).limit(limit).get();
      return snap.docs.map((d: any) => ({ id: d.id, data: d.data() }));
    },
    patchRow: async (walletId: string, ref: string, patch: Partial<ResellRow>) => {
      try {
        await runTransaction(db, async (t: any) => {
          const r = doc(db, 'user_token_wallets', walletId);
          const snap = await t.get(r);
          if (!snap.exists()) throw new Error('gone');
          const rows = Array.isArray(snap.data()?.hostingAddons) ? snap.data().hostingAddons : [];
          if (!rows.some((x: any) => x && x.ref === ref)) throw new Error('row gone');
          // Only the row's markers change. The balance and the ledger are never touched here.
          t.update(r, { hostingAddons: rows.map((x: any) => (x && x.ref === ref ? { ...x, ...patch } : x)) });
        });
        return true;
      } catch {
        return false;
      }
    },
    notify: (userId, message) => saveNotification({ message, target: { type: 'user', userId }, createdBy: 'system' }),
    teardownServer,
    now: () => Date.now(),
  });
  if (report.reminded || report.lapsed || report.serverTeardownFailed || report.dedicatedLapsed.length) {
    console.log(`[resell-expiry] reminded ${report.reminded}, lapsed ${report.lapsed}, server teardown failed ${report.serverTeardownFailed}, private databases past period ${report.dedicatedLapsed.length}`);
  }
  return report;
}

export function registerResellExpirySweep(teardownServer: (workspaceId: string) => Promise<{ ok: boolean }>): void {
  if (process.env.VITEST || registered || !resellExpirySweepEnabled()) return;
  registered = true;
  scheduler.register({
    id: RESELL_EXPIRY_JOB,
    exclusive: true,
    schedule: { kind: 'everyMs', ms: 6 * 60 * 60 * 1000 },
    handler: async () => { await runResellExpirySweep(teardownServer); },
  });
}
