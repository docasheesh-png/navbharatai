// PROJECT REVISIONS — which version is the project's verified head, and what each version was made from.
//
// An edit starts from a verified revision and may replace it only by promotion: an atomic compare-and-swap
// against the revision the edit started from. A candidate that fails validation, a crash before promotion, a
// duplicate request and two edits racing each other all leave the head exactly where it was.
//
// This module holds the PURE half (manifests, hashes, base verification, the promotion contract) and the two
// stores behind it: an in-memory one (unit tests, and any process with no Firestore) and a Firestore one whose
// promotion is a transaction. It does NOT own the files themselves — those stay in the existing durable
// workspace store and restore points; a revision records their identity (path → sha256) so a base can be
// PROVEN complete before an edit is allowed to start from it.
//
// A revision is immutable. Restoring an old one creates a NEW revision of kind `restore` pointing at the one it
// restored, so history only ever grows and a restore is itself reversible.

import { sha256 } from './editPromotionGate';
import { getServerDb } from '../lib/serverDb';

export type RevisionKind = 'baseline' | 'edit' | 'restore';

export interface RevisionValidation {
  /** The server's own browser visit rendered the candidate. */
  previewGreen: boolean;
  /** Digest of the exact built artifact that was validated, when one was built (never invented). */
  artifactDigest?: string;
  /** A hash of the runtime configuration that applies (feature flags such as the camera mode). */
  configHash?: string;
  /** Short names of the checks that ran, e.g. `edit-gate`, `preview-render`. */
  checks: string[];
}

export interface RevisionRecord {
  id: string;
  projectId: string;
  parentId: string | null;
  /** Idempotency key: the same edit can promote at most once. */
  editId: string;
  kind: RevisionKind;
  /** Hash over the sorted manifest — two revisions with the same sourceHash hold the same files. */
  sourceHash: string;
  /** path → sha256, or null when the project is too large to list (then `sourceHash` is the only identity). */
  manifest: Record<string, string> | null;
  fileCount: number;
  /** The conversation message that asked for this revision. */
  messageId?: string;
  messageText?: string;
  /** For `restore`: the revision whose files were put back. */
  restoredFrom?: string;
  gate?: { verdict: 'promote' | 'reject'; stats: Record<string, number>; reasons: string[] };
  validation: RevisionValidation;
  createdAt: number;
}

export const MAX_MANIFEST_PATHS = 4_000;

/** path → sha256 of the content. PURE. */
export function manifestOf(files: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of Object.keys(files ?? {}).sort()) out[p] = sha256(files[p] ?? '');
  return out;
}

export function sourceHashOf(manifest: Readonly<Record<string, string>>): string {
  const lines = Object.keys(manifest).sort().map((p) => `${p}\0${manifest[p]}`);
  return sha256(lines.join('\n'));
}

export function revisionIdOf(projectId: string, parentId: string | null, sourceHash: string, editId: string): string {
  return sha256(`${projectId}\0${parentId ?? ''}\0${sourceHash}\0${editId}`).slice(0, 32);
}

export interface RevisionDraft {
  projectId: string;
  parentId: string | null;
  editId: string;
  kind: RevisionKind;
  files: Readonly<Record<string, string>>;
  messageId?: string;
  messageText?: string;
  restoredFrom?: string;
  gate?: RevisionRecord['gate'];
  validation: RevisionValidation;
  now: number;
}

/** Build the immutable record for a candidate. PURE. */
export function buildRevision(d: RevisionDraft): RevisionRecord {
  const manifest = manifestOf(d.files);
  const fileCount = Object.keys(manifest).length;
  const sourceHash = sourceHashOf(manifest);
  const rec: RevisionRecord = {
    id: revisionIdOf(d.projectId, d.parentId, sourceHash, d.editId),
    projectId: d.projectId,
    parentId: d.parentId,
    editId: d.editId,
    kind: d.kind,
    sourceHash,
    manifest: fileCount <= MAX_MANIFEST_PATHS ? manifest : null,
    fileCount,
    validation: d.validation,
    createdAt: d.now,
  };
  // Optional fields are set only when real: an `undefined` value is one Firestore refuses to store.
  if (d.messageId) rec.messageId = d.messageId;
  if (d.messageText) rec.messageText = d.messageText.slice(0, 500);
  if (d.restoredFrom) rec.restoredFrom = d.restoredFrom;
  if (d.gate) rec.gate = d.gate;
  return rec;
}

export type BaseState = 'no-head' | 'verified' | 'partial' | 'stale';

export interface BaseVerification {
  state: BaseState;
  /** In the head revision but absent from the hydrated workspace. */
  missing: string[];
  /** In the hydrated workspace but not in the head revision. */
  extra: string[];
  /** In both, with different content. */
  differing: string[];
}

/**
 * Is the hydrated workspace the head revision, complete? `partial` = it is missing files the head has (an
 * incomplete hydration: the dangerous case, because an edit would then be built over a fragment). `stale` = it
 * differs in content or holds files the head does not. PURE.
 */
export function verifyBase(head: RevisionRecord | null, hydrated: Readonly<Record<string, string>>): BaseVerification {
  if (!head) return { state: 'no-head', missing: [], extra: [], differing: [] };
  const live = manifestOf(hydrated);
  if (head.manifest === null) {
    return { state: sourceHashOf(live) === head.sourceHash ? 'verified' : 'stale', missing: [], extra: [], differing: [] };
  }
  const missing: string[] = [], extra: string[] = [], differing: string[] = [];
  for (const [p, h] of Object.entries(head.manifest)) {
    if (!(p in live)) missing.push(p);
    else if (live[p] !== h) differing.push(p);
  }
  for (const p of Object.keys(live)) if (!(p in head.manifest)) extra.push(p);
  const state: BaseState = missing.length === 0 && extra.length === 0 && differing.length === 0
    ? 'verified'
    : missing.length > 0 && differing.length === 0 ? 'partial' : 'stale';
  return { state, missing, extra, differing };
}

// ── store ───────────────────────────────────────────────────────────────────────────────────────────────

export type PromoteResult =
  | { ok: true; rev: RevisionRecord; duplicate: boolean }
  | { ok: false; reason: 'conflict'; head: RevisionRecord | null };

export interface RevisionStore {
  head(projectId: string): Promise<RevisionRecord | null>;
  get(projectId: string, id: string): Promise<RevisionRecord | null>;
  list(projectId: string, limit?: number): Promise<RevisionRecord[]>;
  /**
   * Atomically make `rev` the head IF the head is still `expectedParentId` (null = no head yet). The same
   * `editId` promotes at most once: a repeat returns the revision it already made.
   */
  promote(projectId: string, expectedParentId: string | null, rev: RevisionRecord): Promise<PromoteResult>;
}

export class InMemoryRevisionStore implements RevisionStore {
  private heads = new Map<string, string>();
  private revs = new Map<string, Map<string, RevisionRecord>>();
  private byEdit = new Map<string, string>();

  async head(projectId: string): Promise<RevisionRecord | null> {
    const id = this.heads.get(projectId);
    return id ? this.revs.get(projectId)?.get(id) ?? null : null;
  }
  async get(projectId: string, id: string): Promise<RevisionRecord | null> {
    return this.revs.get(projectId)?.get(id) ?? null;
  }
  async list(projectId: string, limit = 50): Promise<RevisionRecord[]> {
    return [...(this.revs.get(projectId)?.values() ?? [])].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }
  async promote(projectId: string, expectedParentId: string | null, rev: RevisionRecord): Promise<PromoteResult> {
    const dupId = this.byEdit.get(`${projectId}\0${rev.editId}`);
    if (dupId) return { ok: true, rev: this.revs.get(projectId)!.get(dupId)!, duplicate: true };
    const current = this.heads.get(projectId) ?? null;
    if (current !== expectedParentId) return { ok: false, reason: 'conflict', head: await this.head(projectId) };
    if (!this.revs.has(projectId)) this.revs.set(projectId, new Map());
    this.revs.get(projectId)!.set(rev.id, rev);
    this.byEdit.set(`${projectId}\0${rev.editId}`, rev.id);
    this.heads.set(projectId, rev.id);
    return { ok: true, rev, duplicate: false };
  }
}

const REV_COLLECTION = 'project_revisions_v3';

/** Firestore-backed store. Promotion is a transaction, so the compare-and-swap is atomic across instances. */
export class FirestoreRevisionStore implements RevisionStore {
  constructor(private readonly db: FirebaseFirestore.Firestore) {}
  private doc(projectId: string) { return this.db.collection(REV_COLLECTION).doc(projectId); }

  async head(projectId: string): Promise<RevisionRecord | null> {
    const snap = await this.doc(projectId).get();
    const headId = snap.exists ? (snap.data() as { headId?: string }).headId : undefined;
    return headId ? this.get(projectId, headId) : null;
  }
  async get(projectId: string, id: string): Promise<RevisionRecord | null> {
    const s = await this.doc(projectId).collection('revs').doc(id).get();
    return s.exists ? (s.data() as RevisionRecord) : null;
  }
  async list(projectId: string, limit = 50): Promise<RevisionRecord[]> {
    const q = await this.doc(projectId).collection('revs').orderBy('createdAt', 'desc').limit(limit).get();
    return q.docs.map((d) => d.data() as RevisionRecord);
  }
  async promote(projectId: string, expectedParentId: string | null, rev: RevisionRecord): Promise<PromoteResult> {
    const root = this.doc(projectId);
    return this.db.runTransaction(async (tx): Promise<PromoteResult> => {
      const editRef = root.collection('byEdit').doc(rev.editId);
      const [rootSnap, editSnap] = await Promise.all([tx.get(root), tx.get(editRef)]);
      if (editSnap.exists) {
        const id = (editSnap.data() as { revisionId: string }).revisionId;
        const existing = await tx.get(root.collection('revs').doc(id));
        if (existing.exists) return { ok: true, rev: existing.data() as RevisionRecord, duplicate: true };
      }
      const current = rootSnap.exists ? ((rootSnap.data() as { headId?: string }).headId ?? null) : null;
      if (current !== expectedParentId) {
        const headSnap = current ? await tx.get(root.collection('revs').doc(current)) : null;
        return { ok: false, reason: 'conflict', head: headSnap && headSnap.exists ? (headSnap.data() as RevisionRecord) : null };
      }
      tx.set(root.collection('revs').doc(rev.id), rev);
      tx.set(editRef, { revisionId: rev.id, at: rev.createdAt });
      tx.set(root, { headId: rev.id, headSourceHash: rev.sourceHash, updatedAt: rev.createdAt }, { merge: true });
      return { ok: true, rev, duplicate: false };
    });
  }
}

let override: RevisionStore | null = null;
let memory: InMemoryRevisionStore | null = null;
let firestore: FirestoreRevisionStore | null = null;

/** The store in use. Tests inject one; under VITEST or with no Firestore it is in memory. */
export function getRevisionStore(): RevisionStore {
  if (override) return override;
  if (!process.env.VITEST) {
    try {
      const db = getServerDb();
      if (db) {
        if (!firestore) firestore = new FirestoreRevisionStore(db);
        return firestore;
      }
    } catch { /* no Firestore here: fall through to memory */ }
  }
  if (!memory) memory = new InMemoryRevisionStore();
  return memory;
}
export function setRevisionStoreForTests(s: RevisionStore | null): void { override = s; memory = null; }

/**
 * Promote a candidate, rebasing when another edit advanced the head first. `rebase(head)` is handed the new
 * head and must return a re-validated record built on it, or null to abandon (a conflict the caller cannot
 * resolve). Bounded: after `maxAttempts` the caller gets `conflict` and the head is untouched.
 */
export async function promoteWithRebase(
  store: RevisionStore,
  projectId: string,
  first: { expectedParentId: string | null; rev: RevisionRecord },
  rebase: (head: RevisionRecord | null) => Promise<RevisionRecord | null>,
  maxAttempts = 3,
): Promise<PromoteResult> {
  let expected = first.expectedParentId;
  let rev: RevisionRecord | null = first.rev;
  let last: PromoteResult = { ok: false, reason: 'conflict', head: null };
  for (let i = 0; i < maxAttempts && rev; i++) {
    last = await store.promote(projectId, expected, rev);
    if (last.ok || last.reason !== 'conflict') return last;
    expected = last.head?.id ?? null;
    rev = await rebase(last.head);
  }
  return last;
}
