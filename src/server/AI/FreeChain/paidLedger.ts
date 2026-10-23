/** Shared schema and writer for the ONE owner-funded platform-free budget. No database initialization. */
import { createHash } from 'node:crypto';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { checkedAdd, DAY_MS, FreeChainDataError, nonnegativeInteger, validTime, type DayWindow } from './quota';
import { NANO_USD, SPEND_ALERT_THRESHOLDS, spendThresholds, validPaidCapNanoUsd,
  type PaidBudgetPolicy, type SpendDay } from './spendCap';
export const FREE_CHAIN_COLLECTION = 'free_chat_chain';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
type Raw = Record<string, unknown>;
export function readData(snapshot: { exists: boolean; data(): unknown }): unknown {
  if (!snapshot.exists) return undefined;
  const data = snapshot.data();
  if (!data || typeof data !== 'object') throw new FreeChainDataError('Missing existing document data');
  return data;
}
export function readSpendDay(raw: unknown, window: DayWindow): SpendDay {
  if (raw === undefined) return { ...window, heldNanoUsd: 0, spentNanoUsd: 0, requests: 0, pending: 0, alertedPercent: [] };
  const d = raw as SpendDay & { version: number };
  if (!d || d.version !== 1 || d.key !== window.key || d.startAt !== window.startAt || d.resetAt !== window.resetAt
    || ![d.heldNanoUsd, d.spentNanoUsd, d.requests, d.pending].every(nonnegativeInteger)
    || !nonnegativeInteger(d.conservativePending ?? 0) || (d.conservativePending ?? 0) > d.requests
    || d.pending + (d.conservativePending ?? 0) > d.requests || d.heldNanoUsd < d.pending || (d.pending === 0 && d.heldNanoUsd !== 0)
    || !Array.isArray(d.alertedPercent) || d.alertedPercent.some(t => !SPEND_ALERT_THRESHOLDS.includes(t))
    || new Set(d.alertedPercent).size !== d.alertedPercent.length) throw new FreeChainDataError('Malformed spend day');
  checkedAdd(d.heldNanoUsd, d.spentNanoUsd);
  return { key: d.key, startAt: d.startAt, resetAt: d.resetAt, heldNanoUsd: d.heldNanoUsd,
    spentNanoUsd: d.spentNanoUsd, requests: d.requests, pending: d.pending,
    ...(d.conservativePending === undefined ? {} : { conservativePending: d.conservativePending }), alertedPercent: d.alertedPercent };
}
export function readPaidPolicy(raw: unknown): PaidBudgetPolicy | null {
  if (raw === undefined) return null;
  const p = raw as PaidBudgetPolicy & Raw;
  if (!p || p.kind !== 'paid_budget_policy' || p.version !== 1 || !nonnegativeInteger(p.revision) || p.revision < 1
    || !validPaidCapNanoUsd(p.capNanoUsd) || !nonnegativeInteger(p.updatedAt)
    || (p.source !== 'deployment' && p.source !== 'admin' && p.source !== 'safety') || 'expiresAt' in p || 'expireAt' in p) {
    throw new FreeChainDataError('Malformed paid budget policy');
  }
  validTime(p.updatedAt);
  return { kind: p.kind, version: p.version, revision: p.revision, capNanoUsd: p.capNanoUsd, updatedAt: p.updatedAt, source: p.source };
}
/** Same atomic administrator notifications and retention rules as the original store writer. */
export function writeSpendDay(tx: Transaction, db: Pick<Firestore, 'doc'>, day: SpendDay, capNanoUsd: number, now: number, adminEmails: () => string[]): void {
  const reached = spendThresholds(day, capNanoUsd);
  const alertedPercent = [...day.alertedPercent, ...reached];
  const committed = checkedAdd(day.heldNanoUsd, day.spentNanoUsd);
  const recipients = [...new Set(adminEmails().map(email => email.trim().toLowerCase()).filter(Boolean))].slice(0, 50);
  for (const threshold of reached) for (const email of recipients) {
    const id = `free-chat-spend_${day.key}_${threshold}_${hash(email)}`;
    tx.set(db.doc(`admin_notifications/${id}`), {
      id, message: `FREE chat paid-fallback budget reached ${threshold}% for ${day.key} (Asia/Kolkata): `
        + `$${(committed / NANO_USD).toFixed(4)} committed of $${(capNanoUsd / NANO_USD).toFixed(2)}. `
        + 'Committed includes maximum-cost holds with unknown usage. Open Admin → FREE Chat Chain.',
      target: { type: 'user', email }, createdAt: now, createdBy: 'free-chat-chain',
    });
  }
  tx.set(db.doc(`${FREE_CHAIN_COLLECTION}/paid_day_${day.key}`), { ...day, alertedPercent, kind: 'paid_day', version: 1,
    capNanoUsd, updatedAt: now,
    // Pending holds and conservative reconciliations never expire their original accounting day.
    ...(day.pending === 0 && (day.conservativePending ?? 0) === 0 ? { expiresAt: new Date(Math.max(now, day.resetAt) + 90 * DAY_MS) } : {}),
  });
}

/** Existing UID-wide daily guard, shared across legacy and gateway paid attempts. */
export function paidUserDocumentPath(day: string, uidHash: string): string {
  return `${FREE_CHAIN_COLLECTION}/paid_user_${day}_${uidHash}`;
}
export function readPaidUser(value: unknown, day: string, uidHash: string): number {
  const user = value as Raw | undefined;
  if (user !== undefined && (!user || user.kind !== 'paid_user' || user.day !== day
    || user.uidHash !== uidHash || !nonnegativeInteger(user.requests))) throw new FreeChainDataError('Malformed per-user count');
  return (user?.requests as number | undefined) ?? 0;
}
export function writePaidUser(tx: Transaction, db: Pick<Firestore, 'doc'>, window: DayWindow, uidHash: string, requests: number): void {
  if (!nonnegativeInteger(requests)) throw new FreeChainDataError('Invalid per-user count');
  tx.set(db.doc(paidUserDocumentPath(window.key, uidHash)), { kind: 'paid_user', day: window.key, uidHash, requests,
    expiresAt: new Date(window.resetAt + 90 * DAY_MS) });
}
