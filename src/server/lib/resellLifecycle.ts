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

/**
 * PRIVATE_DB_EXPIRY_POLICY — what happens to an expired, unrenewed private database (our Supabase org).
 *
 * Checked against Supabase's own docs (2026-10-13): "Paused projects do not incur any compute usage
 * charges" — BUT "Projects under a paid plan cannot be paused". Our resell org must be on a paid plan
 * (Free allows 2 projects), so on our org pausing is normally NOT possible and the project keeps
 * costing us (compute ~$10/month each, billed hourly; billing stops once a project is deleted). So:
 *   • PRIVATE_DB_ORG_PAUSABLE=on (only if the org is on the Free plan): pause it, keep the data.
 *   • otherwise (default): warn 3 days and 1 day before, then delete it
 *     PRIVATE_DB_DELETE_AFTER_DAYS (default 7) days after its period ended. Every step is in the admin log.
 */
export interface PrivateDbPolicy {
  pausable: boolean;
  deleteAfterDays: number;
}

export type PrivateDbAction =
  | { kind: 'pause' }
  | { kind: 'warn'; daysLeft: number; deleteAtMs: number }
  | { kind: 'delete' }
  | null;

export const PRIVATE_DB_WARN_DAYS: readonly number[] = [3, 1];

/** PURE. Only for a dedicated_db row the lapse already marked (not renewed). */
export function decidePrivateDb(row: ResellRow, nowMs: number, policy: PrivateDbPolicy): PrivateDbAction {
  if (row.addonId !== 'dedicated_db' || !row.lapsedAt || row.deletedAt) return null;
  if (policy.pausable) return row.pausedAt ? null : { kind: 'pause' };
  const exp = Date.parse(row.expiresAt);
  if (!Number.isFinite(exp)) return null;
  const deleteAtMs = exp + Math.max(1, policy.deleteAfterDays) * DAY;
  if (nowMs >= deleteAtMs) return { kind: 'delete' };
  const daysLeft = (deleteAtMs - nowMs) / DAY;
  const due = [...PRIVATE_DB_WARN_DAYS].sort((a, b) => a - b).find((d) => daysLeft <= d);
  if (due === undefined || row.remindedFor?.[`del${due}`] === row.expiresAt) return null;
  return { kind: 'warn', daysLeft: due, deleteAtMs };
}

export function privateDbWarnMessage(days: number, deleteAtMs: number): string {
  const date = new Date(deleteAtMs).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return `Your private database was not renewed. It will be DELETED in ${days} day${days === 1 ? '' : 's'} (${date}) with all its data. Renew it from Publish, or export your data before then. Renew nahi kiya to ${date} ko data delete ho jayega.`;
}

export interface ResellRow extends HostingAddonRecord {
  /** PRIVATE_DB_EXPIRY_POLICY markers. */
  pausedAt?: string | null;
  deletedAt?: string | null;
  /** Reminder dedupe: `${days}` → the expiresAt it was sent for. */
  remindedFor?: Record<string, string>;
  /** Set once the lapse was applied (server down / owner told). A row with this is finished. */
  lapsedAt?: string | null;
}

export type ResellRowAction =
  | { kind: 'remind'; days: number }
  | { kind: 'renew' }
  | { kind: 'lapse' }
  | null;

/** Reminder days for a row that auto-renews — the same 5/3/1 as hosting plans. */
export const RESELL_RENEW_REMINDER_DAYS: readonly number[] = [5, 3, 1];
/** A renewal may be taken this long before expiry, so a database API never goes dark at the boundary. */
export const RESELL_RENEW_LEAD_MS = 12 * 60 * 60 * 1000;

/** True when this row consented to auto-renew (its ticked terms said so) and it is still on. */
export function rowAutoRenews(row: ResellRow): boolean {
  return row.autoRenew === true && !!row.autoRenewAgreedAt;
}

export function isDeliveredRow(row: unknown): row is ResellRow {
  if (!row || typeof row !== 'object') return false;
  const r = row as Partial<ResellRow>;
  return typeof r.ref === 'string' && DELIVERED.has(String(r.addonId)) && typeof r.expiresAt === 'string';
}

/**
 * PURE. What is due for this row at `nowMs`.
 * `autoRenewOn` = RESELL_AUTO_RENEW is on AND this row consented. Then a renewal is attempted from
 * 12 h before expiry until the end of grace (the user may top up meanwhile), and only after grace
 * does the lapse happen.
 */
export function decideResellRow(row: ResellRow, nowMs: number, autoRenewOn = false): ResellRowAction {
  if (row.lapsedAt) return null;
  const exp = Date.parse(row.expiresAt);
  if (!Number.isFinite(exp)) return null;
  if (nowMs >= exp + RESELL_GRACE_DAYS * DAY) return { kind: 'lapse' };
  if (autoRenewOn && nowMs >= exp - RESELL_RENEW_LEAD_MS) return { kind: 'renew' };
  if (nowMs >= exp) return null; // inside grace: the one reminder for day 1 already went out
  const daysLeft = (exp - nowMs) / DAY;
  // The tightest window that is due and not yet sent for THIS expiry.
  const days = autoRenewOn ? RESELL_RENEW_REMINDER_DAYS : RESELL_REMINDER_DAYS;
  const due = [...days].sort((a, b) => a - b).find((d) => daysLeft <= d);
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

export function resellRenewReminderMessage(row: ResellRow, days: number, priceInr: number): string {
  const what = addonLabel(row.addonId as DeliveredAddonId);
  const date = new Date(row.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return `Your ${what} renews on ${date} — ₹${priceInr} will be taken from your wallet (${days} day${days === 1 ? '' : 's'} to go). Don't want it? Turn auto-renew off on Publish and it simply ends on that date.`;
}

export function resellRenewedMessage(row: ResellRow, priceInr: number): string {
  const what = addonLabel(row.addonId as DeliveredAddonId);
  const until = new Date(row.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return `Receipt: your ${what} auto-renewed — ₹${priceInr} from your wallet, now paid until ${until}. It is in your wallet statement. Turn auto-renew off on Publish any time.`;
}

export function resellRenewShortMessage(row: ResellRow, priceInr: number): string {
  const what = addonLabel(row.addonId as DeliveredAddonId);
  return `Your ${what} could not auto-renew: the money you added is less than ₹${priceInr} (the welcome gift cannot pay for it). Top up within ${RESELL_GRACE_DAYS} days and it renews by itself — nothing is interrupted for a server; after that it is stopped.`;
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
  return 'Your private database\'s 30 days ended. Renew it from Publish to keep it. If it is not renewed it is paused, or — where pausing is not possible — deleted a few days later, with warnings first. Remove it from Publish if you no longer need it.';
}

export type RenewResult = 'renewed' | 'insufficient' | 'skip';

export interface ResellSweepDeps {
  /** RESELL_AUTO_RENEW. Omitted ⇒ off. */
  autoRenewEnabled?: boolean;
  /** RESELL_EXPIRY_SWEEP. Omitted ⇒ on (the sweep's original job). Off ⇒ no lapse is applied. */
  lapseEnabled?: boolean;
  /** One transaction: debit + extend, keyed on the expiresAt the sweep saw. */
  renewRow?: (walletId: string, ref: string, expectedExpiresAt: string) => Promise<{ result: RenewResult; row?: ResellRow }>;
  /** After a renewal, extend the resource itself (the small database's own expiry). */
  onRenewed?: (row: ResellRow) => Promise<unknown>;
  priceOf?: (addonId: string) => number;
  /** PRIVATE_DB_EXPIRY_POLICY. Omitted ⇒ the private database is only reported (old behaviour). */
  privateDb?: {
    policy: PrivateDbPolicy;
    pause: (projectRef: string) => Promise<{ ok: boolean }>;
    remove: (projectRef: string) => Promise<{ ok: boolean }>;
    audit: (event: string, meta: Record<string, unknown>) => void;
  };
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
  renewed: number;
  renewShort: number;
  privateDbWarned: number;
  privateDbPaused: number;
  privateDbDeleted: number;
}

function workspaceFromProof(proof: string | undefined): string | null {
  const m = /^(?:ws|db):([^:]{8,}):/.exec(String(proof || ''));
  return m ? m[1] : null;
}

/** Never throws. One bad row never stops the rest. */
export async function sweepResellAddons(deps: ResellSweepDeps): Promise<ResellSweepReport> {
  const report: ResellSweepReport = { reminded: 0, lapsed: 0, serverTeardownFailed: 0, dedicatedLapsed: [], renewed: 0, renewShort: 0, privateDbWarned: 0, privateDbPaused: 0, privateDbDeleted: 0 };
  const price = (id: string) => (deps.priceOf ? deps.priceOf(id) : 0);
  let wallets: Array<{ id: string; data: Record<string, any> }> = [];
  try { wallets = await deps.listWallets(); } catch { return report; }
  const nowMs = deps.now();
  for (const w of wallets) {
    const rows = Array.isArray(w.data?.hostingAddons) ? w.data.hostingAddons : [];
    const userId = String(w.data?.userId || w.id);
    for (const row of rows) {
      if (!isDeliveredRow(row)) continue;
      try {
        if (deps.privateDb && row.addonId === 'dedicated_db' && row.lapsedAt) {
          const pd = deps.privateDb;
          const act = decidePrivateDb(row, nowMs, pd.policy);
          const projectRef = /^db:[^:]{8,}:([A-Za-z0-9_-]{8,64})$/.exec(String(row.proof || ''))?.[1];
          if (!act || !projectRef) continue;
          const meta = { userId, ref: row.ref, projectRef, expiresAt: row.expiresAt };
          if (act.kind === 'warn') {
            const ok = await deps.patchRow(w.id, row.ref, { remindedFor: { ...(row.remindedFor || {}), [`del${act.daysLeft}`]: row.expiresAt } });
            if (!ok) continue;
            await deps.notify(userId, privateDbWarnMessage(act.daysLeft, act.deleteAtMs)).catch(() => null);
            pd.audit('resell.private_db.delete_warning', { ...meta, daysLeft: act.daysLeft });
            report.privateDbWarned++;
          } else if (act.kind === 'pause') {
            const r = await pd.pause(projectRef).catch(() => ({ ok: false }));
            pd.audit(r.ok ? 'resell.private_db.paused' : 'resell.private_db.pause_failed', meta);
            if (r.ok && await deps.patchRow(w.id, row.ref, { pausedAt: new Date(nowMs).toISOString() })) {
              await deps.notify(userId, 'Your private database was not renewed, so it was paused. Your data is kept — renew it from Publish to switch it back on.').catch(() => null);
              report.privateDbPaused++;
            }
          } else {
            const r = await pd.remove(projectRef).catch(() => ({ ok: false }));
            pd.audit(r.ok ? 'resell.private_db.deleted' : 'resell.private_db.delete_failed', meta);
            if (r.ok && await deps.patchRow(w.id, row.ref, { deletedAt: new Date(nowMs).toISOString() })) {
              await deps.notify(userId, 'Your private database was not renewed and has now been deleted, as the warnings said. Nothing more will be charged.').catch(() => null);
              report.privateDbDeleted++;
            }
          }
          continue;
        }
        const renews = !!deps.autoRenewEnabled && !!deps.renewRow && rowAutoRenews(row);
        const action = decideResellRow(row, nowMs, renews);
        if (!action) continue;
        if (action.kind === 'remind') {
          const ok = await deps.patchRow(w.id, row.ref, { remindedFor: { ...(row.remindedFor || {}), [String(action.days)]: row.expiresAt } });
          if (!ok) continue; // not marked ⇒ not sent, so a retry cannot send it twice
          await deps.notify(userId, renews
            ? resellRenewReminderMessage(row, action.days, price(row.addonId))
            : resellReminderMessage(row, action.days)).catch(() => null);
          report.reminded++;
          continue;
        }
        if (action.kind === 'renew') {
          const r = await deps.renewRow!(w.id, row.ref, row.expiresAt).catch(() => ({ result: 'skip' as const }));
          if (r.result === 'renewed') {
            const fresh = (r as { row?: ResellRow }).row ?? row;
            await deps.onRenewed?.(fresh).catch(() => null);
            await deps.notify(userId, resellRenewedMessage(fresh, price(row.addonId))).catch(() => null);
            report.renewed++;
          } else if (r.result === 'insufficient' && Date.parse(row.expiresAt) <= nowMs
            && row.remindedFor?.grace !== row.expiresAt) {
            // Told ONCE per period, and only after the date passed — before that the user may still top up.
            const ok = await deps.patchRow(w.id, row.ref, { remindedFor: { ...(row.remindedFor || {}), grace: row.expiresAt } });
            if (ok) {
              await deps.notify(userId, resellRenewShortMessage(row, price(row.addonId))).catch(() => null);
              report.renewShort++;
            }
          }
          continue;
        }
        if (deps.lapseEnabled === false) continue;
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
