/**
 * serverDb shim — proves the admin-backed modular API keeps CLIENT-SDK semantics, so a migrated
 * money-path file's body is unchanged. The one that bites on a money path is `snap.exists()` (a
 * METHOD here) vs admin's `snap.exists` (a PROPERTY) — a getDoc that returned the raw admin snapshot
 * would make `if (snap.exists())` throw "not a function" and silently fail the credit. These tests
 * lock that mapping (and transaction/query/path mapping) against a fake admin Firestore.
 */
import { describe, it, expect } from 'vitest';
import {
  doc, collection, getDoc, setDoc, updateDoc, deleteDoc, addDoc, getDocs,
  query, where, orderBy, limit, runTransaction,
} from './serverDb';

/** Minimal fake admin Firestore: records ops and serves docs from an in-memory map keyed by path. */
function makeFakeDb(seed: Record<string, any> = {}) {
  const store: Record<string, any> = { ...seed };
  const ops: any[] = [];
  const makeDocRef = (path: string): any => ({
    path,
    id: path.split('/').pop(),
    async get() {
      return {
        exists: Object.prototype.hasOwnProperty.call(store, path),
        id: path.split('/').pop(),
        ref: makeDocRef(path),
        data: () => store[path],
        get: (f: string) => store[path]?.[f],
      };
    },
    async set(data: any, options?: any) { ops.push({ op: 'set', path, data, options }); store[path] = options?.merge ? { ...store[path], ...data } : data; },
    async update(data: any) { ops.push({ op: 'update', path, data }); store[path] = { ...store[path], ...data }; },
    async delete() { ops.push({ op: 'delete', path }); delete store[path]; },
  });
  const makeQuery = (basePath: string, filters: any[] = []): any => ({
    basePath, filters,
    where(field: string, op: string, value: any) { return makeQuery(basePath, [...filters, { t: 'where', field, op, value }]); },
    orderBy(field: string, dir: string) { return makeQuery(basePath, [...filters, { t: 'orderBy', field, dir }]); },
    limit(n: number) { return makeQuery(basePath, [...filters, { t: 'limit', n }]); },
    async get() {
      let docs = Object.keys(store)
        .filter((p) => p.startsWith(basePath + '/'))
        .map((p) => ({ path: p, data: store[p] }));
      for (const f of filters) {
        if (f.t === 'where') docs = docs.filter((d) => d.data?.[f.field] === f.value);
        if (f.t === 'limit') docs = docs.slice(0, f.n);
      }
      return {
        empty: docs.length === 0,
        size: docs.length,
        docs: docs.map((d) => ({ exists: true, id: d.path.split('/').pop(), ref: makeDocRef(d.path), data: () => d.data, get: (k: string) => d.data?.[k] })),
      };
    },
  });
  const db: any = {
    doc: (path: string) => makeDocRef(path),
    collection: (path: string) => ({
      ...makeQuery(path),
      async add(data: any) { const id = `auto_${ops.length}`; const p = `${path}/${id}`; ops.push({ op: 'add', path: p, data }); store[p] = data; return makeDocRef(p); },
    }),
    async runTransaction(fn: any) {
      const t = {
        async get(ref: any) { return ref.get(); },
        set(ref: any, data: any, options?: any) { ops.push({ op: 'tx.set', path: ref.path, data, options }); store[ref.path] = options?.merge ? { ...store[ref.path], ...data } : data; },
        update(ref: any, data: any) { ops.push({ op: 'tx.update', path: ref.path, data }); store[ref.path] = { ...store[ref.path], ...data }; },
        delete(ref: any) { ops.push({ op: 'tx.delete', path: ref.path }); delete store[ref.path]; },
      };
      return fn(t);
    },
  };
  return { db, store, ops };
}

describe('serverDb shim — client-SDK-compatible admin binding', () => {
  it('doc(db, coll, id) joins segments into an admin doc path', () => {
    const { db } = makeFakeDb();
    const ref = doc(db, 'payment_transactions', 'ord_1');
    expect(ref.path).toBe('payment_transactions/ord_1');
    expect(ref.id).toBe('ord_1');
  });

  it('getDoc exposes exists() as a METHOD (not a property) — the money-path gotcha', async () => {
    const { db } = makeFakeDb({ 'user_token_wallets/u1': { remaining_balance: 100 } });
    const present = await getDoc(doc(db, 'user_token_wallets', 'u1'));
    expect(typeof present.exists).toBe('function');
    expect(present.exists()).toBe(true);
    expect(present.data().remaining_balance).toBe(100);

    const missing = await getDoc(doc(db, 'user_token_wallets', 'nope'));
    expect(missing.exists()).toBe(false);
  });

  it('setDoc writes, updateDoc merges a patch, deleteDoc removes', async () => {
    const { db, store } = makeFakeDb();
    const ref = doc(db, 'payment_transactions', 'ord_2');
    await setDoc(ref, { paymentStatus: 'PENDING', amountPaid: 50 });
    expect(store['payment_transactions/ord_2']).toEqual({ paymentStatus: 'PENDING', amountPaid: 50 });
    await updateDoc(ref, { paymentStatus: 'SUCCESS' });
    expect(store['payment_transactions/ord_2'].paymentStatus).toBe('SUCCESS');
    expect(store['payment_transactions/ord_2'].amountPaid).toBe(50);
    await deleteDoc(ref);
    expect(store['payment_transactions/ord_2']).toBeUndefined();
  });

  it('setDoc honors the { merge: true } option', async () => {
    const { db, store } = makeFakeDb({ 'user_token_wallets/u1': { a: 1 } });
    await setDoc(doc(db, 'user_token_wallets', 'u1'), { b: 2 }, { merge: true });
    expect(store['user_token_wallets/u1']).toEqual({ a: 1, b: 2 });
  });

  it('addDoc appends to a collection; getDocs + query/where/limit filter', async () => {
    const { db } = makeFakeDb();
    await addDoc(collection(db, 'user_secrets'), { user_id: 'u1', name: 'A' });
    await addDoc(collection(db, 'user_secrets'), { user_id: 'u2', name: 'B' });
    await addDoc(collection(db, 'user_secrets'), { user_id: 'u1', name: 'C' });
    const snap = await getDocs(query(collection(db, 'user_secrets'), where('user_id', '==', 'u1'), limit(5)));
    expect(snap.size).toBe(2);
    expect(snap.empty).toBe(false);
    const names = snap.docs.map((d) => d.data().name).sort();
    expect(names).toEqual(['A', 'C']);
    // each wrapped doc keeps client semantics
    expect(snap.docs[0].exists()).toBe(true);
    expect(typeof snap.docs[0].id).toBe('string');
  });

  it('runTransaction: tx.get returns a wrapped snapshot (exists() method) and tx.set/update commit', async () => {
    const { db, store } = makeFakeDb({ 'user_token_wallets/u1': { tokenBalance: 1000 } });
    const result = await runTransaction(db, async (tx) => {
      const snap = await tx.get(doc(db, 'user_token_wallets', 'u1'));
      expect(typeof snap.exists).toBe('function');
      const bal = snap.exists() ? snap.data().tokenBalance : 0;
      tx.update(doc(db, 'user_token_wallets', 'u1'), { tokenBalance: bal - 250 });
      tx.set(doc(db, 'payment_transactions', 'ord_9'), { paymentStatus: 'SUCCESS' });
      return bal - 250;
    });
    expect(result).toBe(750);
    expect(store['user_token_wallets/u1'].tokenBalance).toBe(750);
    expect(store['payment_transactions/ord_9'].paymentStatus).toBe('SUCCESS');
  });

  it('runTransaction: a claim on a missing doc reads exists()===false (coupon/verify TOCTOU path)', async () => {
    const { db, store } = makeFakeDb();
    const claimed = await runTransaction(db, async (tx) => {
      const snap = await tx.get(doc(db, 'payment_transactions', 'coupon_X_u1'));
      if (snap.exists()) return false;
      tx.set(doc(db, 'payment_transactions', 'coupon_X_u1'), { balanceAdded: 50 });
      return true;
    });
    expect(claimed).toBe(true);
    expect(store['payment_transactions/coupon_X_u1'].balanceAdded).toBe(50);
  });
});
