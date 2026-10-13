// RESELL LIFECYCLE — what happens to a paid server or database when its 30 days end.
//
// Found by the purchase audit (2026-10-13): a server (₹149), a small database (₹49) or a private
// database (₹1,499) is charged once, for 30 days, and nothing ever looked at it again.
//   • server — the Cloud Run service kept running after day 30, and the quote then called it
//     "already runs a server, nothing extra" — so it could never be billed again. Free hosting on
//     our bill, for ever.
//   • dedicated_db — the Supabase project kept running (our cost), and the next "start database"
//     created a SECOND project for the same app, orphaning the first.
//   • shared_db — the data API already refuses calls after expiry (gateSharedCall), so it was the
//     only one that ended. The user was never told.
//
// This module decides, PURELY, what is due for one row: a reminder before expiry, or the lapse after a
// short grace. The add-on terms say "for 30 days" and never promised automatic renewal, so nothing here
// charges anyone. Renewal stays a deliberate purchase. The sweep below applies the decision with every
// side effect injected, so a test proves the order. OFF unless RESELL_EXPIRY_SWEEP=on.

import type { HostingAddonRecord } from '../../lib/hostingAddons';

export type DeliveredAddonId = 'server' | 'shared_db' | 'dedicated_db';
const DELIVERED = new Set<string>(['server', 'shared_db', 'dedicated_db']);
const DAY = 24 * 60 * 60 * 1000;

/** Days before expiry the owner is told. */
export const RESELL_REMINDER_DAYS: readonly number[] = [3, 1];
/** Days after expiry before a server is taken down. Matches the plan's grace window. */
export const RESELL_GRACE_DAYS = 3;

export interface ResellRow extends HostingAddonRecord {
  /** Reminder dedupe: `${days}` → the expiresAt it was sent for. */
  remindedFor?: Record<string, string>;
  /** Set once the lapse was applied (server down / owner told). A row with this is finished. */
  lapsedAt?: string | null;
}

export type ResellRowAction =
  | { kind: 'remind'; days: number }
  | { kind: 'lapse' }
  | null;

export function isDeliveredRow(row: unknown): row is ResellRow {
  if (!row || typeof row !== 'object') return false;
  const r = row as Partial<ResellRow>;
  return typeof r.ref === 'string' && DELIVERED.has(String(r.addonId)) && typeof r.expiresAt === 'string';
}

/** PURE. What is due for this row at `nowMs`. */
export function decideResellRow(row: ResellRow, nowMs: number): ResellRowAction {
  if (row.lapsedAt) return null;
  const exp = Date.parse(row.expiresAt);
  if (!Number.isFinite(exp)) return null;
  if (nowMs >= exp + RESELL_GRACE_DAYS * DAY) return { kind: 'lapse' };
  if (nowMs >= exp) return null; // inside grace: the one reminder for day 1 already went out
  const daysLeft = (exp - nowMs) / DAY;
  // The tightest window that is due and not yet sent for THIS expiry.
  const due = [...RESELL_REMINDER_DAYS].sort((a, b) => a - b).find((d) => daysLeft <= d);
  if (due === undefined) return null;
  if (row.remindedFor?.[String(due)] === row.expiresAt) return null;
  return { kind: 'remind', days: due };
}

/**
 * True when this app still has a private database whose period ended but that was never removed.
 * Creating another one would orphan it (it keeps costing us and holds the user's data).
 */
export function hasLapsedDedicatedDb(rows: unknown, workspaceId: string, nowMs: number): boolean {
  if (!Array.isArray(rows) || !workspaceId) return false;
  return rows.some((r) => isDeliveredRow(r)
    && r.addonId === 'dedicated_db'
    && String(r.proof || '').startsWith(`db:${workspaceId}:`)
    && Date.parse(r.expiresAt) <= nowMs);
}

export function addonLabel(id: DeliveredAddonId): string {
  return id === 'server' ? 'extra server' : id === 'shared_db' ? 'small database' : 'private database';
}

export function resellReminderMessage(row: ResellRow, days: number): string {
  const what = addonLabel(row.addonId as DeliveredAddonId);
  const date = new Date(row.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const after = row.addonId === 'server'
    ? `the server is taken down ${RESELL_GRACE_DAYS} days after that. Your code is kept.`
    : row.addonId === 'shared_db'
      ? 'the data API stops answering on that date. Your records are kept.'
      : 'it stops being covered on that date. Your data is kept until you remove it.';
  return `Your ${what} ends in ${days} day${days === 1 ? '' : 's'} (${date}). It does not renew by itself — start it again from Publish to keep it; otherwise ${after}`;
}

export function resellLapseMessage(row: ResellRow, serverDown: boolean): string {
  if (row.addonId === 'server') {
    return serverDown
      ? 'Your extra server\'s 30 days ended, so it was taken down. Nothing was deleted — start it again from Publish whenever you want.'
      : 'Your extra server\'s 30 days ended. We could not take it down yet and will try again. Nothing more was charged.';
  }
  if (row.addonId === 'shared_db') {
    return 'Your small database\'s 30 days ended, so its API has stopped. Your records are kept — start it again from Publish to switch it back on.';
  }
  return 'Your private database\'s 30 days ended. Your data is kept. Start it again from Publish, or remove it from Publish if you no longer need it.';
}

export interface ResellSweepDeps {
  /** Wallet docs that hold add-ons: [docId, data]. */
  listWallets: () => Promise<Array<{ id: string; data: Record<string, any> }>>;
  /** Write back one row (reminder/lapse markers only — never the balance). Return false on failure. */
  patchRow: (walletId: string, ref: string, patch: Partial<ResellRow>) => Promise<boolean>;
  notify: (userId: string, message: string) => Promise<unknown>;
  teardownServer: (workspaceId: string) => Promise<{ ok: boolean }>;
  now: () => number;
}

export interface ResellSweepReport {
  reminded: number;
  lapsed: number;
  serverTeardownFailed: number;
  /** Private databases past their period — reported for the admin; never deleted by a sweep. */
  dedicatedLapsed: string[];
}

function workspaceFromProof(proof: string | undefined): string | null {
  const m = /^(?:ws|db):([^:]{8,}):/.exec(String(proof || ''));
  return m ? m[1] : null;
}

/** Never throws. One bad row never stops the rest. */
export async function sweepResellAddons(deps: ResellSweepDeps): Promise<ResellSweepReport> {
  const report: ResellSweepReport = { reminded: 0, lapsed: 0, serverTeardownFailed: 0, dedicatedLapsed: [] };
  let wallets: Array<{ id: string; data: Record<string, any> }> = [];
  try { wallets = await deps.listWallets(); } catch { return report; }
  const nowMs = deps.now();
  for (const w of wallets) {
    const rows = Array.isArray(w.data?.hostingAddons) ? w.data.hostingAddons : [];
    const userId = String(w.data?.userId || w.id);
    for (const row of rows) {
      if (!isDeliveredRow(row)) continue;
      try {
        const action = decideResellRow(row, nowMs);
        if (!action) continue;
        if (action.kind === 'remind') {
          const ok = await deps.patchRow(w.id, row.ref, { remindedFor: { ...(row.remindedFor || {}), [String(action.days)]: row.expiresAt } });
          if (!ok) continue; // not marked ⇒ not sent, so a retry cannot send it twice
          await deps.notify(userId, resellReminderMessage(row, action.days)).catch(() => null);
          report.reminded++;
          continue;
        }
        // lapse
        let serverDown = true;
        if (row.addonId === 'server') {
          const ws = workspaceFromProof(row.proof);
          serverDown = ws ? (await deps.teardownServer(ws).catch(() => ({ ok: false }))).ok : false;
          if (!serverDown) { report.serverTeardownFailed++; continue; } // retried next pass, not marked
        }
        if (row.addonId === 'dedicated_db') report.dedicatedLapsed.push(`${userId}:${row.ref}`);
        const ok = await deps.patchRow(w.id, row.ref, { lapsedAt: new Date(nowMs).toISOString() });
        if (!ok) continue;
        await deps.notify(userId, resellLapseMessage(row, serverDown)).catch(() => null);
        report.lapsed++;
      } catch { /* next row */ }
    }
  }
  return report;
}
