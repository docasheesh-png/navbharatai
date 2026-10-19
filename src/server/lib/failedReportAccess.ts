/** Separate, revocable report-only bearer credentials. Never share the admin session. */
import { createHash, randomBytes } from 'node:crypto';
import { getServerDb } from './serverDb';
import { adminUsername } from './adminAuth';
import { FailedReportsInputError } from './failedBuildReports';
import type { FailedReportAccess } from '../../lib/failedBuildReports';

const COLLECTION = 'admin_failed_report_access';
const TTL = 30 * 24 * 60 * 60_000;
export function reportTokenHash(token: string): string { return createHash('sha256').update(token).digest('hex'); }
export function newReportToken(): string { return `nbfr_${randomBytes(32).toString('base64url')}`; }
export async function reportTokenOk(header: unknown, now = Date.now()): Promise<boolean> {
  if (typeof header !== 'string' || !/^Bearer nbfr_[A-Za-z0-9_-]{43}$/.test(header)) return false;
  const db = getServerDb();
  if (!db) throw new Error('Report access storage unavailable.');
  const doc = await db.collection(COLLECTION).doc(reportTokenHash(header.slice(7))).get();
  const d = doc.data();
  return !!d && d.owner === adminUsername() && d.scope === 'failed-reports:read' &&
    typeof d.expiresAt === 'number' && d.expiresAt > now;
}
export async function createReportAccess(label: string, now = Date.now()): Promise<FailedReportAccess & { token: string }> {
  const db = getServerDb();
  if (!db) throw new Error('Report access storage unavailable.');
  const token = newReportToken();
  const meta = { id: reportTokenHash(token), label, createdAt: now, expiresAt: now + TTL };
  // A bounded platform credential registry, not an ever-growing token log. The transaction prevents
  // concurrent creates from bypassing the cap; expired entries remain visible so the owner can revoke them.
  await db.runTransaction(async (tx) => {
    const existing = await tx.get(db.collection(COLLECTION).limit(100));
    if (existing.size >= 100) throw new FailedReportsInputError('Revoke an old credential before creating another (limit 100).');
    tx.create(db.collection(COLLECTION).doc(meta.id), { ...meta, owner: adminUsername(), scope: 'failed-reports:read' });
  });
  return { ...meta, token };
}
export async function listReportAccess(): Promise<FailedReportAccess[]> {
  const db = getServerDb();
  if (!db) throw new Error('Report access storage unavailable.');
  const docs = await db.collection(COLLECTION).orderBy('createdAt', 'desc').limit(100).get();
  return docs.docs.flatMap((doc) => {
    const d = doc.data();
    return [{ id: doc.id, label: String(d.label), createdAt: Number(d.createdAt), expiresAt: Number(d.expiresAt) }];
  });
}
export async function revokeReportAccess(id: string): Promise<void> {
  const db = getServerDb();
  if (!db) throw new Error('Report access storage unavailable.');
  await db.collection(COLLECTION).doc(id).delete();
}
