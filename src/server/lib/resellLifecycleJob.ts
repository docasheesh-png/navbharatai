// Wires the pure resell sweep (resellLifecycle.ts) to Firestore, notifications and the scheduler.
// Registered only when RESELL_EXPIRY_SWEEP=on, and never under VITEST.
import { getServerDb, doc, runTransaction } from './serverDb';
import { scheduler } from './ScheduledJobs';
import { saveNotification } from './AdminNotificationStore';
import {
  resellExpirySweepEnabled, resellAutoRenewEnabled, privateDbExpiryPolicyEnabled, privateDbOrgPausable, privateDbDeleteAfterDays,
} from './purchaseAuditFlags';
import { platformSupabaseConfig } from './platformDatabase';
import { deleteProject, pauseProject } from './supabaseProvision';
import { appendAdminAudit } from './adminAuditLog';
import { computeResellRenewal } from './hostingAddonLedger';
import { extendSharedDatabase, type SharedDb } from './sharedDataStore';
import { addonById } from '../../lib/hostingAddons';
import {
  privateDbCostPlusEnabled, privateDbCostMultiplier, costPlusBreakdown, readPrivateDbUsage, PRIVATE_DB_COST_WARN_INR,
} from './privateDbCostPlus';
import { usdToInr } from './UsdInrRate';
import { sweepResellAddons, type ResellRow, type ResellSweepReport } from './resellLifecycle';

export const RESELL_EXPIRY_JOB = 'resell-expiry-sweep';
let registered = false;

export async function runResellExpirySweep(
  teardownServer: (workspaceId: string) => Promise<{ ok: boolean }>,
  limit = 300,
): Promise<ResellSweepReport | null> {
  if (!resellExpirySweepEnabled() && !resellAutoRenewEnabled()) return null;
  const db = getServerDb() as any;
  if (!db) return null;
  const report = await sweepResellAddons({
    autoRenewEnabled: resellAutoRenewEnabled(),
    privateDb: (() => {
      const cfg = platformSupabaseConfig();
      if (!privateDbExpiryPolicyEnabled() || !resellExpirySweepEnabled() || !cfg) return undefined;
      return {
        policy: { pausable: privateDbOrgPausable(), deleteAfterDays: privateDbDeleteAfterDays() },
        pause: (ref: string) => pauseProject(cfg.token, ref),
        remove: async (ref: string) => ({ ok: (await deleteProject(cfg.token, ref)).ok === true }),
        audit: (event: string, meta: Record<string, unknown>) => appendAdminAudit(event, meta),
      };
    })(),
    lapseEnabled: resellExpirySweepEnabled(),
    priceOf: (id) => addonById(id)?.priceInr ?? 0,
    renewRow: async (walletId, ref, expectedExpiresAt) => {
      // ONE transaction: read, debit, extend, write. The expiresAt check inside makes a concurrent
      // second run a no-op, and the ledger key refuses a second debit for the same period.
      // PRIVATE_DB_COST_PLUS: price the period that just ended BEFORE the transaction (network calls do
      // not belong inside it). Unreadable usage → no extra (never a guess); the ₹1,499 minimum still renews.
      let costPlus: { extraInr: number; note: string } | undefined;
      const cfg = platformSupabaseConfig();
      if (privateDbCostPlusEnabled() && cfg) {
        const snap0 = await db.collection('user_token_wallets').doc(walletId).get().catch(() => null);
        const row0 = (snap0?.data()?.hostingAddons ?? []).find((x: any) => x?.ref === ref);
        const projRef = row0?.addonId === 'dedicated_db' ? /^db:[^:]+:(.+)$/.exec(String(row0?.proof || ''))?.[1] : undefined;
        const usage = projRef ? await readPrivateDbUsage(cfg.token, projRef, 30 * 24) : null;
        if (usage) {
          const b = costPlusBreakdown(usage, privateDbCostMultiplier(), usdToInr(1));
          costPlus = { extraInr: b.extraInr, note: b.lines.join('; ') };
          await Promise.resolve(appendAdminAudit('resell.private_db.cost_plus', { walletId, ref, costUsd: b.costUsd, costPlusInr: b.costPlusInr, extraInr: b.extraInr, multiplier: b.multiplier })).catch(() => {});
          if (b.costPlusInr >= PRIVATE_DB_COST_WARN_INR) {
            await Promise.resolve(saveNotification({
              message: `Private database usage is high: this period it cost ₹${b.costPlusInr} at cost-plus (₹${b.extraInr} above the ₹1,499 minimum), charged with the renewal. ${b.lines.join(' · ')}`,
              target: { type: 'user', userId: walletId }, createdBy: 'system',
            })).catch(() => {});
          }
        }
      }
      const out = await runTransaction(db, async (t: any) => {
        const r = doc(db, 'user_token_wallets', walletId);
        const snap = await t.get(r);
        if (!snap.exists()) return { result: 'skip' as const };
        const o = computeResellRenewal(snap.data(), ref, expectedExpiresAt, new Date().toISOString(), costPlus);
        if (o.ok) { t.set(r, o.wallet); return { result: 'renewed' as const, row: o.row as ResellRow }; }
        return { result: (o.reason === 'insufficient' || o.reason === 'gift_only') ? 'insufficient' as const : 'skip' as const };
      });
      return out;
    },
    onRenewed: async (row) => {
      if (row.addonId !== 'shared_db') return;
      const ws = /^db:([^:]{8,}):/.exec(String(row.proof || ''))?.[1];
      if (ws) await extendSharedDatabase(db as unknown as SharedDb, ws, Date.parse(row.expiresAt), Date.now());
    },
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
  if (report.renewed || report.renewShort || report.reminded || report.lapsed || report.serverTeardownFailed || report.dedicatedLapsed.length) {
    console.log(`[resell-expiry] renewed ${report.renewed}, short ${report.renewShort}, reminded ${report.reminded}, lapsed ${report.lapsed}, server teardown failed ${report.serverTeardownFailed}, private databases past period ${report.dedicatedLapsed.length}`);
  }
  return report;
}

export function registerResellExpirySweep(teardownServer: (workspaceId: string) => Promise<{ ok: boolean }>): void {
  if (process.env.VITEST || registered || (!resellExpirySweepEnabled() && !resellAutoRenewEnabled())) return;
  registered = true;
  scheduler.register({
    id: RESELL_EXPIRY_JOB,
    exclusive: true,
    schedule: { kind: 'everyMs', ms: 6 * 60 * 60 * 1000 },
    handler: async () => { await runResellExpirySweep(teardownServer); },
  });
}
