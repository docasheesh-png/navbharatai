/**
 * Server-side Firestore access — ADMIN SDK, security-rules-BYPASSING.
 *
 * ── WHY THIS EXISTS (root cause, admin-mandated migration 2026-07-12) ──────────────────────────
 * The server used to reach Firestore through the CLIENT SDK (`firebase/firestore` modular API on a
 * handle set by `setDb()` in server.ts). The client SDK is UNAUTHENTICATED when run from the server
 * (`request.auth == null`), so every write is subject to Firestore security rules. On the old
 * AI-Studio database that "worked" only because its rules were wide open. The moment we migrated to
 * `navbharat-prod` — whose `firestore.rules` correctly default-DENY everything not explicitly allowed
 * and mark the money/workspace/secret collections `allow write: if false` (server-only) — EVERY
 * unauthenticated server write started failing with `PERMISSION_DENIED`:
 *   • payment_transactions / user_token_wallets  → Cashfree checkout + wallet credit/debit broke
 *   • user_secrets                                → saving a secret broke
 *   • user_workspaces                             → cloud sync broke
 *   • chat_*                                      → server-side chat persistence broke
 * The rules are RIGHT (a client must never write another user's wallet). The server must simply stop
 * pretending to be a client: it holds service-account credentials, so it should use the ADMIN SDK,
 * which bypasses security rules by design. This module is that single, shared admin binding.
 *
 * ── DESIGN: a drop-in for the `firebase/firestore` modular API ─────────────────────────────────
 * Every call site used the modular functions (`doc`, `getDoc`, `setDoc`, `updateDoc`, `deleteDoc`,
 * `runTransaction`, `collection`, `addDoc`, `getDocs`, `query`, `where`, `orderBy`, `limit`). Rather
 * than hand-rewrite each site to the admin namespaced API (where the subtle `snap.exists` PROPERTY vs
 * client `snap.exists()` METHOD trips silent bugs on a MONEY path), this module re-exports those exact
 * names, admin-backed, with identical semantics — so migrating a file is a one-line import swap and the
 * proven transaction/credit/debit logic above them is untouched. Fix-the-class, one implementation.
 *
 * ── NAMED-DATABASE TARGETING (verified, not guessed) ───────────────────────────────────────────
 * We target the `navbharat-prod` database with `getFirestore(app, databaseId)` — the API DESIGNED for
 * named databases, which returns a per-databaseId CACHED, distinct instance (probed: same id → same
 * instance; named ≠ default). We deliberately do NOT use `admin.firestore().settings({databaseId})`:
 * that mutates the shared default-app singleton and THROWS on the 2nd caller ("already been
 * initialized"), so with many stores only the first initializer wins and the rest silently get a dead
 * (null) handle. `getFirestore(app, id)` has no such collision.
 */
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { firestoreDatabaseId } from './firestoreDb';

/** Admin Firestore type alias — matches the `Firestore` type the migrated files imported. */
export type Firestore = admin.firestore.Firestore;

let _db: admin.firestore.Firestore | null = null;
let _injected = false;

/**
 * Test seam. Vitest never touches real Firestore, so tests inject a fake admin-shaped handle (or null)
 * and assert on it. Once injected, `getServerDb()` always returns the injection (even in non-VITEST).
 */
export function setServerDb(db: admin.firestore.Firestore | null): void {
  _db = db;
  _injected = true;
}

/**
 * The shared ADMIN Firestore handle, bound to the configured database (`navbharat-prod`). Lazily
 * initialized and cached. Returns null under VITEST (tests inject) or if firebase-admin cannot be
 * initialized — callers must guard `if (!db)` exactly as they did with the old client `getDb()`.
 */
export function getServerDb(): admin.firestore.Firestore | null {
  if (_injected) return _db;
  if (process.env.VITEST) return null;
  if (_db) return _db;
  try {
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
    const app = admin.app();
    const dbId = firestoreDatabaseId();
    // getFirestore(app, dbId) returns a per-databaseId CACHED instance (never throws, no settings
    // collision). Apply ignoreUndefinedProperties (matches the other stores' safety — an undefined
    // field must never throw on a money write); settings() only takes on a not-yet-used instance, so
    // guard it — if this instance was already used elsewhere the write path is still fully functional.
    const db = getFirestore(app, dbId);
    try { db.settings({ ignoreUndefinedProperties: true }); } catch { /* already initialized/used — reuse as-is */ }
    _db = db;
    return _db;
  } catch {
    return null;
  }
}

// ─────────────────────────── Modular-API shim (admin-backed) ───────────────────────────
// These mirror the `firebase/firestore` modular functions the server used, with identical call
// shapes and snapshot semantics (`snap.exists()` is a METHOD here, like the client SDK), so a
// migrated file's body is byte-for-byte unchanged — only its import line points here instead.

type AdminDocRef = admin.firestore.DocumentReference;
type AdminQuery = admin.firestore.Query;

/** Client-compatible document snapshot: `exists()` is a method (admin's is a property). */
export interface DocSnap {
  exists(): boolean;
  data(): any;
  id: string;
  ref: AdminDocRef;
  get(field: string): any;
}

function wrapDocSnap(snap: admin.firestore.DocumentSnapshot): DocSnap {
  return {
    exists: () => snap.exists,
    data: () => snap.data(),
    id: snap.id,
    ref: snap.ref,
    get: (field: string) => snap.get(field),
  };
}

/** Client-compatible query snapshot. `docs` are wrapped so `.exists()`/`.data()`/`.id` all work. */
export interface QuerySnap {
  docs: DocSnap[];
  empty: boolean;
  size: number;
  forEach(cb: (d: DocSnap) => void): void;
}

function wrapQuerySnap(qs: admin.firestore.QuerySnapshot): QuerySnap {
  const docs = qs.docs.map(wrapDocSnap);
  return { docs, empty: qs.empty, size: qs.size, forEach: (cb) => docs.forEach(cb) };
}

/** `doc(db, 'coll', 'id')` → admin `db.doc('coll/id')`. Variadic path segments (even count = doc). */
export function doc(db: any, ...segments: string[]): AdminDocRef {
  return db.doc(segments.join('/'));
}

/** `collection(db, 'coll')` → admin `db.collection('coll')` (odd segment count = collection path). */
export function collection(db: any, ...segments: string[]): admin.firestore.CollectionReference {
  return db.collection(segments.join('/'));
}

export async function getDoc(ref: AdminDocRef): Promise<DocSnap> {
  return wrapDocSnap(await ref.get());
}

export async function setDoc(ref: AdminDocRef, data: any, options?: { merge?: boolean }): Promise<void> {
  if (options) { await ref.set(data, options); } else { await ref.set(data); }
}

export async function updateDoc(ref: AdminDocRef, data: any): Promise<void> {
  await ref.update(data);
}

export async function deleteDoc(ref: AdminDocRef): Promise<void> {
  await ref.delete();
}

export async function addDoc(collRef: admin.firestore.CollectionReference, data: any): Promise<AdminDocRef> {
  return collRef.add(data);
}

export async function getDocs(q: AdminQuery): Promise<QuerySnap> {
  return wrapQuerySnap(await q.get());
}

// Query constraints are descriptors applied by `query()` — mirrors the modular where/orderBy/limit.
interface Constraint {
  _t: 'where' | 'orderBy' | 'limit';
  field?: string;
  op?: admin.firestore.WhereFilterOp;
  value?: any;
  dir?: admin.firestore.OrderByDirection;
  n?: number;
}

export function where(field: string, op: admin.firestore.WhereFilterOp, value: any): Constraint {
  return { _t: 'where', field, op, value };
}

export function orderBy(field: string, dir: admin.firestore.OrderByDirection = 'asc'): Constraint {
  return { _t: 'orderBy', field, dir };
}

export function limit(n: number): Constraint {
  return { _t: 'limit', n };
}

export function query(ref: AdminQuery, ...constraints: Constraint[]): AdminQuery {
  let q: AdminQuery = ref;
  for (const c of constraints) {
    if (c._t === 'where') q = q.where(c.field as string, c.op as admin.firestore.WhereFilterOp, c.value);
    else if (c._t === 'orderBy') q = q.orderBy(c.field as string, c.dir);
    else if (c._t === 'limit') q = q.limit(c.n as number);
  }
  return q;
}

/** Client-compatible transaction handle: `get()` returns a wrapped snapshot (`.exists()` method). */
export interface ServerTransaction {
  get(ref: AdminDocRef): Promise<DocSnap>;
  set(ref: AdminDocRef, data: any, options?: { merge?: boolean }): void;
  update(ref: AdminDocRef, data: any): void;
  delete(ref: AdminDocRef): void;
}

export async function runTransaction<T>(
  db: any,
  updateFn: (tx: ServerTransaction) => Promise<T>,
): Promise<T> {
  return db.runTransaction(async (t: admin.firestore.Transaction) => {
    const wrapped: ServerTransaction = {
      get: async (ref) => wrapDocSnap(await t.get(ref)),
      set: (ref, data, options) => { options ? t.set(ref, data, options) : t.set(ref, data); },
      update: (ref, data) => { t.update(ref, data); },
      delete: (ref) => { t.delete(ref); },
    };
    return updateFn(wrapped);
  });
}
