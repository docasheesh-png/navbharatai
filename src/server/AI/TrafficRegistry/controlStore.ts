/**
 * Traffic Manager V2, P2: the Firestore control store — versioned, atomic, audited (owner requirements 1 and 6).
 *
 *   admin_traffic_control/current                 the document in force (one read per instance per sync)
 *   admin_traffic_control_revisions/{000000042}   an immutable copy of every revision (created, never updated)
 *   admin_traffic_control_audit/{auto id}         who, when, why, from which revision to which, what changed
 *
 * Every change is ONE transaction that (a) refuses unless the stored revision is the one the admin saw, (b) writes
 * the new current document, (c) CREATES the revision copy (a create fails if it exists, so history cannot be
 * rewritten), and (d) creates the audit row. All three land or none does. A rollback is an ordinary change whose
 * body is an older revision's body, so it is audited and versioned like any other.
 *
 * Server-only: `firestore.rules` denies every client read and write (default-deny), and these are admin-SDK writes.
 */
import type { Firestore } from 'firebase-admin/firestore';
import { bodyOf, ControlInputError, parseControlBody, parseControlDoc, type ControlBody, type ControlDoc } from './controlTypes';

export const TRAFFIC_CONTROL_COLLECTION = 'admin_traffic_control';
export const TRAFFIC_CONTROL_REVISIONS_COLLECTION = 'admin_traffic_control_revisions';
export const TRAFFIC_CONTROL_AUDIT_COLLECTION = 'admin_traffic_control_audit';
const CURRENT = 'current';

export class ControlConflictError extends Error {}

export interface ControlAuditRow {
  atMs: number;
  actor: string;
  reason: string;
  kind: 'change' | 'rollback';
  fromRevision: number;
  toRevision: number;
  /** Plain list of what changed (`global.gateway: on → off`), at most 40 lines; never a secret or prompt. */
  changes: string[];
}

export const revisionDocId = (revision: number): string => String(revision).padStart(9, '0');

export function describeChanges(before: ControlBody, after: ControlBody): string[] {
  const out: string[] = [];
  if (before.global.gateway !== after.global.gateway) out.push(`global.gateway: ${before.global.gateway} → ${after.global.gateway}`);
  const keys = (a: object, b: object) => [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  for (const k of keys(before.surfaces, after.surfaces)) {
    const x = before.surfaces[k as keyof ControlBody['surfaces']] ?? 'env'; const y = after.surfaces[k as keyof ControlBody['surfaces']] ?? 'env';
    if (x !== y) out.push(`surface ${k}: ${x} → ${y}`);
  }
  const show = (c?: { state: string; trafficCapPct: number }) => c ? `${c.state}${c.trafficCapPct < 100 ? ` (${c.trafficCapPct}%)` : ''}` : 'default';
  for (const k of keys(before.providers, after.providers)) {
    const x = show(before.providers[k]); const y = show(after.providers[k]);
    if (x !== y) out.push(`provider ${k}: ${x} → ${y}`);
  }
  for (const k of keys(before.models, after.models)) {
    const a = before.models[k]; const b = after.models[k];
    if (show(a) !== show(b)) out.push(`model ${k}: ${show(a)} → ${show(b)}`);
    if (JSON.stringify(a?.admission ?? null) !== JSON.stringify(b?.admission ?? null)) out.push(`model ${k}: admission evidence updated`);
  }
  return out.slice(0, 40);
}

export class TrafficControlStore {
  constructor(private readonly db: Firestore, private readonly now: () => number = Date.now) {}

  private current() { return this.db.collection(TRAFFIC_CONTROL_COLLECTION).doc(CURRENT); }

  /** The document in force, or null when nothing was ever saved (= the env and the code decide). */
  async read(): Promise<ControlDoc | null> {
    const snap = await this.current().get();
    return snap.exists ? parseControlDoc(snap.data()) : null;
  }

  async apply(args: { expectedRevision: unknown; body: unknown; actor: string; reason: unknown; kind?: 'change' | 'rollback' }): Promise<ControlDoc> {
    if (!Number.isSafeInteger(args.expectedRevision) || (args.expectedRevision as number) < 0) throw new ControlInputError('expectedRevision is required.');
    const reason = typeof args.reason === 'string' ? args.reason.trim() : '';
    if (reason.length < 5 || reason.length > 300) throw new ControlInputError('Give a reason of 5–300 characters. It is kept in the audit log.');
    const body = parseControlBody(args.body);
    const actor = String(args.actor || '').slice(0, 120) || 'admin';
    const now = this.now();
    return this.db.runTransaction(async tx => {
      const snap = await tx.get(this.current());
      const cur = snap.exists ? parseControlDoc(snap.data()) : null;
      const fromRevision = cur?.revision ?? 0;
      if (fromRevision !== args.expectedRevision) throw new ControlConflictError('The controls changed since you loaded them. Reload, check the latest revision, and try again.');
      const before = cur ? bodyOf(cur) : { global: { gateway: 'on' as const }, surfaces: {}, providers: {}, models: {} };
      const changes = describeChanges(before, body);
      if (!changes.length) throw new ControlInputError('Nothing changed. No revision was written.');
      const next: ControlDoc = { ...body, revision: fromRevision + 1, updatedAtMs: now, actor, reason };
      tx.set(this.current(), next);
      tx.create(this.db.collection(TRAFFIC_CONTROL_REVISIONS_COLLECTION).doc(revisionDocId(next.revision)), next);
      const row: ControlAuditRow = { atMs: now, actor, reason, kind: args.kind ?? 'change', fromRevision, toRevision: next.revision, changes };
      tx.create(this.db.collection(TRAFFIC_CONTROL_AUDIT_COLLECTION).doc(), row);
      return next;
    });
  }

  /** Make an older revision current again, as a NEW revision (history is never rewound). */
  async rollback(args: { expectedRevision: unknown; targetRevision: unknown; actor: string; reason: unknown }): Promise<ControlDoc> {
    if (!Number.isSafeInteger(args.targetRevision) || (args.targetRevision as number) < 1) throw new ControlInputError('targetRevision is required.');
    if (Number.isSafeInteger(args.expectedRevision) && (args.targetRevision as number) >= (args.expectedRevision as number)) {
      throw new ControlInputError('Roll back to an EARLIER revision than the current one.');
    }
    const snap = await this.db.collection(TRAFFIC_CONTROL_REVISIONS_COLLECTION).doc(revisionDocId(args.targetRevision as number)).get();
    if (!snap.exists) throw new ControlInputError(`Revision ${args.targetRevision} does not exist.`);
    const target = parseControlDoc(snap.data());
    return this.apply({ expectedRevision: args.expectedRevision, body: bodyOf(target), actor: args.actor,
      reason: `rollback to r${target.revision}: ${String(args.reason ?? '').trim()}`.slice(0, 300), kind: 'rollback' });
  }

  /** The latest revisions and audit rows, newest first, bounded. */
  async history(limit = 20): Promise<{ revisions: Array<Pick<ControlDoc, 'revision' | 'updatedAtMs' | 'actor' | 'reason'>>; audit: ControlAuditRow[] }> {
    const n = Math.max(1, Math.min(50, Math.floor(limit)));
    const [revs, rows] = await Promise.all([
      this.db.collection(TRAFFIC_CONTROL_REVISIONS_COLLECTION).orderBy('revision', 'desc').limit(n).get(),
      this.db.collection(TRAFFIC_CONTROL_AUDIT_COLLECTION).orderBy('atMs', 'desc').limit(n).get(),
    ]);
    return {
      revisions: revs.docs.map(d => { const x = d.data(); return { revision: Number(x.revision), updatedAtMs: Number(x.updatedAtMs), actor: String(x.actor ?? ''), reason: String(x.reason ?? '') }; }),
      audit: rows.docs.map(d => d.data() as ControlAuditRow),
    };
  }
}
