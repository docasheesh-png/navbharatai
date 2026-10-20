/**
 * The cheap database is the one that starts: a namespace on the Firestore we already run,
 * plus the API on this server. Money moves only after the store exists. A wrong key does not
 * read records. The cap stops the API instead of growing our bill. The Billing button still
 * cannot sell it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { addonById } from '../src/lib/hostingAddons';
import { quoteDatabaseResell } from '../src/server/lib/resellQuote';
import { executeDatabaseResell } from '../src/server/lib/resellExecute';
import {
  SHARED_DATA_OPS_CAP, dataClientSource, hashApiKey, sanitizeRecord,
} from '../src/server/lib/sharedData';
import {
  createSharedDatabase, destroySharedDatabase, markSharedReady, runSharedData, type SharedDb,
} from '../src/server/lib/sharedDataStore';

const WS = 'agentv3-user1-sess';

function fakeDb(): { api: SharedDb; docs: Map<string, unknown> } {
  const docs = new Map<string, any>();
  function makeRef(path: string): any {
    return {
      path,
      async get() {
        const v = docs.get(path);
        return { exists: v !== undefined, data: () => v, ref: makeRef(path) };
      },
      collection(sub: string) { return makeCollection(`${path}/${sub}`); },
    };
  }
  function makeCollection(path: string) {
    const list = (pred: (data: any) => boolean, after = ''): any => ({
      where(field: string, _op: string, value: unknown) { return list((data) => pred(data) && data?.[field] === value, after); },
      orderBy() { return list(pred, after); },
      startAfter(value: string) { return list(pred, value); },
      limit(n: number) {
        return {
          async get() {
            const prefix = `${path}/`;
            const found: any[] = [];
            for (const [p, data] of docs) {
              if (!p.startsWith(prefix)) continue;
              const rest = p.slice(prefix.length);
              if (rest.includes('/') || !pred(data) || rest <= after) continue;
              found.push({ id: rest, data: () => data, ref: makeRef(p) });
            }
            const page = found.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).slice(0, n);
            return { empty: page.length === 0, size: page.length, docs: page };
          },
        };
      },
      where(field: string, _op: string, value: unknown) {
        return list((data) => data?.[field] === value);
      },
    });
    return { doc: (id: string) => makeRef(`${path}/${id}`), ...list(() => true) };
  }
  const api: SharedDb = {
    collection: (path: string) => makeCollection(path),
    batch() {
      const ops: Array<() => void> = [];
      return {
        delete(r: { path: string }) { ops.push(() => { docs.delete(r.path); }); },
        async commit() { ops.forEach((fn) => fn()); },
      };
    },
    async runTransaction(fn) {
      const writes = new Map<string, any>();
      const tx = {
        async get(r: { path: string }) {
          const v = writes.has(r.path) ? writes.get(r.path) : docs.get(r.path);
          return { exists: v != null, data: () => v, ref: r };
        },
        set(r: { path: string }, data: any, opts?: { merge?: boolean }) {
          const prev = writes.has(r.path) ? writes.get(r.path) : docs.get(r.path);
          writes.set(r.path, opts?.merge && prev ? { ...prev, ...data } : data);
        },
        delete(r: { path: string }) { writes.set(r.path, null); },
      };
      const result = await fn(tx);
      for (const [p, v] of writes) {
        if (v == null) docs.delete(p);
        else docs.set(p, v);
      }
      return result;
    },
  };
  return { api, docs };
}

describe('the cheap database quote', () => {
  it('starts at the shared price when Firestore can be reached, and not before', () => {
    const off = quoteDatabaseResell({ product: 'shared', plansOn: true, configured: false, workspaceId: WS, active: [], canPay: true });
    expect(off.canStart).toBe(false);
    expect(off.reason).toContain('Nothing was charged');
    expect(off.reason).toContain('Supabase');
    const on = quoteDatabaseResell({ product: 'shared', plansOn: true, configured: true, workspaceId: WS, active: [], canPay: true });
    expect(on.canStart).toBe(true);
    expect(on.priceInr).toBe(49);
    expect(on.reason).toContain(SHARED_DATA_OPS_CAP.toLocaleString('en-IN'));
    expect(on.reason).toContain('not a separate machine');
  });

  it('the catalogue still will not sell it from the Billing button, and the server price is unchanged', () => {
    expect(addonById('shared_db')).toMatchObject({ sellable: false, priceInr: 49 });
    expect(addonById('server')).toMatchObject({ sellable: false, priceInr: 149 });
    expect(addonById('dedicated_db')).toMatchObject({ sellable: false, priceInr: 1499 });
    expect(addonById('shared_db')?.unavailableReason || '').toMatch(/not/i);
  });

  it('a dedicated database is still the ₹1,499 quote, unchanged when product is omitted', () => {
    const q = quoteDatabaseResell({ plansOn: true, configured: true, workspaceId: WS, active: [], canPay: true });
    expect(q.priceInr).toBe(1499);
    expect(q.canStart).toBe(true);
  });
});

describe('the store', () => {
  it('charges nothing in the document, hides the key, and refuses a wrong key before writing a record', async () => {
    const { api, docs } = fakeDb();
    const now = Date.parse('2026-10-09T12:00:00.000Z');
    const made = await createSharedDatabase(api, { workspaceId: WS, ownerUid: 'user1', expiresAtMs: now + 86_400_000, nowMs: now });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(await markSharedReady(api, WS, now)).toBe(true);
    const stored = JSON.stringify([...docs.values()]);
    expect(stored).not.toContain(made.key);
    expect(stored).toContain(hashApiKey(made.key));

    const denied = await runSharedData(api, WS, {
      actorUid: 'user1', op: 'create', collection: 'orders', id: null, key: 'nb_not-the-key', nowMs: now, data: { item: 'chai' },
    });
    expect(denied.status).toBe(401);
    expect([...docs.keys()].some((k) => k.includes('/records/'))).toBe(false);

    const saved = await runSharedData(api, WS, {
      actorUid: 'user1', op: 'create', collection: 'orders', id: null, key: made.key, nowMs: now, data: { item: 'chai' },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.ok).toBe(true);
    const listed = await runSharedData(api, WS, {
      actorUid: 'user1', op: 'list', collection: 'orders', id: null, key: made.key, nowMs: now, data: null,
    });
    expect(listed.status).toBe(200);
    expect(listed.body.records).toEqual([{ id: saved.body.id, record: { item: 'chai' } }]);
  });

  it('stops at the operation cap and does not write the record', async () => {
    const { api, docs } = fakeDb();
    const now = Date.parse('2026-10-09T12:00:00.000Z');
    const made = await createSharedDatabase(api, { workspaceId: WS, ownerUid: 'user1', expiresAtMs: now + 86_400_000, nowMs: now });
    if (!made.ok) throw new Error('create');
    await markSharedReady(api, WS, now);
    const meta = docs.get(`nbai_app_data/${WS}`) as any; delete meta.opsUsed;
    docs.set(`nbai_app_data/${WS}/ops/0`, { n: SHARED_DATA_OPS_CAP });
    const blocked = await runSharedData(api, WS, {
      actorUid: 'user1', op: 'create', collection: 'orders', id: null, key: made.key, nowMs: now, data: { item: 'more' },
    });
    expect(blocked.status).toBe(429);
    expect(String(blocked.body.error)).toContain('nothing extra was charged');
    expect([...docs.keys()].some((k) => k.includes('/records/'))).toBe(false);
  });

  it('deletes the data before a caller could refund it', async () => {
    const { api, docs } = fakeDb();
    const now = Date.parse('2026-10-09T12:00:00.000Z');
    const made = await createSharedDatabase(api, { workspaceId: WS, ownerUid: 'user1', expiresAtMs: now + 86_400_000, nowMs: now });
    if (!made.ok) throw new Error('create');
    await markSharedReady(api, WS, now);
    await runSharedData(api, WS, { actorUid: 'user1', op: 'create', collection: 'orders', id: null, key: made.key, nowMs: now, data: { item: 'chai' } });
    const gone = await destroySharedDatabase(api, WS);
    expect(gone.ok).toBe(true);
    expect([...docs.keys()].some((k) => k.startsWith(`nbai_app_data/${WS}`))).toBe(false);
  });

  it('rejects a nested object and does not put the key in the client file', () => {
    expect(sanitizeRecord({ note: { secret: true } }).ok).toBe(false);
    const src = dataClientSource();
    expect(src).not.toMatch(/nb_[A-Za-z0-9_-]{20,}/);
    expect(src).toContain('VITE_NBAI_DATA_KEY');
    expect(src).not.toContain('data-nbai-badge');
    expect(src).not.toContain('display:none');
  });
});

describe('the wires', () => {
  it('clients cannot read the collection, and the data API is registered', () => {
    const rules = readFileSync(join(__dirname, '../firestore.rules'), 'utf8');
    const at = rules.indexOf('match /nbai_app_data/{document=**}');
    expect(at).toBeGreaterThan(-1);
    expect(rules.slice(at, at + 180)).toContain('allow read, write: if false');
    const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toContain('registerAppDataRoutes(app)');
    const resell = readFileSync(join(__dirname, '../src/server/routes/resellHosting.ts'), 'utf8');
    const createAt = resell.indexOf('createSharedDatabase(');
    const chargeAt = resell.indexOf("asCharge(who.uid, 'shared_db'");
    expect(createAt).toBeGreaterThan(-1);
    expect(chargeAt).toBeGreaterThan(createAt);
  });

  it('the charge still happens before the key is saved', async () => {
    const order: string[] = [];
    const r = await executeDatabaseResell({ agreedToTerms: true, workspaceId: WS }, {
      quoteInput: { product: 'shared', plansOn: true, configured: true, workspaceId: WS, active: [], canPay: true },
      create: async () => ({ ok: true, projectRef: 'sdabcdef12345678', url: 'https://navbharatai.com/api/v1/data/' + WS, env: { VITE_NBAI_DATA_KEY: 'nb_secret' } }),
      save: async () => { order.push('save'); return true; },
      charge: async () => { order.push('charge'); return { ok: true, charged: true, active: true }; },
      destroy: async () => ({ ok: true }),
      refund: async () => ({ ok: true }),
    });
    expect(order).toEqual(['charge', 'save']);
    expect(r.status).toBe(200);
    expect(String(r.body.message)).toContain('₹49');
    expect(r.body.env).toBeUndefined();
  });
});


describe('verified caller boundaries and pre-query admission', () => {
  async function setup() {
    const { api, docs } = fakeDb();
    const now = Date.parse('2026-10-20T12:00:00Z');
    const made = await createSharedDatabase(api, { workspaceId: WS, ownerUid: 'owner', expiresAtMs: now + 86_400_000, nowMs: now });
    if (!made.ok) throw Error('setup');
    await markSharedReady(api, WS, now);
    return { api, docs, now, key: made.key };
  }
  it('a copied public key alone has no authority; caller cannot read, overwrite or delete another user record', async () => {
    const { api, key, now } = await setup();
    const base = { collection: 'orders', id: null, key, nowMs: now, data: { item: 'private' } };
    expect((await runSharedData(api, WS, { ...base, op: 'create' })).status).toBe(401);
    const a = await runSharedData(api, WS, { ...base, op: 'create', actorUid: 'alice' });
    expect(a.status).toBe(200);
    for (const op of ['get', 'replace', 'delete'] as const) {
      expect((await runSharedData(api, WS, { ...base, id: String(a.body.id), op, actorUid: 'bob' })).status).toBe(404);
    }
    const bob = await runSharedData(api, WS, { ...base, op: 'list', data: null, actorUid: 'bob' });
    expect(bob.body.records).toEqual([]);
    const alice = await runSharedData(api, WS, { ...base, id: String(a.body.id), op: 'get', data: null, actorUid: 'alice' });
    expect(alice.body.record).toEqual({ item: 'private' });
    expect((await runSharedData(api, WS, { ...base, id: String(a.body.id), op: 'get', data: null, actorUid: 'owner' })).status).toBe(200);
  });
  it('old records stay owner-only and are not discarded during the counter migration', async () => {
    const { api, docs, key, now } = await setup();
    docs.set(`nbai_app_data/${WS}/records/orders_legacy`, { collection: 'orders', id: 'legacy', data: { value: 'kept' }, updatedAt: new Date(now).toISOString() });
    const base = { collection: 'orders', id: 'legacy', key, nowMs: now, data: null, op: 'get' as const };
    expect((await runSharedData(api, WS, { ...base, actorUid: 'alice' })).status).toBe(404);
    expect((await runSharedData(api, WS, { ...base, actorUid: 'owner' })).body.record).toEqual({ value: 'kept' });
  });
  it('exhausted requests reserve nothing and issue no record query, even on repeated attempts', async () => {
    const { api, docs, key, now } = await setup();
    const meta = docs.get(`nbai_app_data/${WS}`) as any;
    meta.opsUsed = SHARED_DATA_OPS_CAP;
    let recordQueries = 0;
    const collection = api.collection.bind(api);
    api.collection = (path) => { if (path.includes('/records')) recordQueries++; return collection(path); };
    for (let i = 0; i < 3; i++) expect((await runSharedData(api, WS, { actorUid: 'alice', op: 'list', collection: 'orders', id: null, key, nowMs: now, data: null })).status).toBe(429);
    expect(recordQueries).toBe(0);
    expect(meta.opsUsed).toBe(SHARED_DATA_OPS_CAP);
  });
  it('two concurrent admissions cannot both spend the last operation', async () => {
    const { api, docs, key, now } = await setup();
    const meta = docs.get(`nbai_app_data/${WS}`) as any; meta.opsUsed = SHARED_DATA_OPS_CAP - 1;
    // Model Firestore's serializable transaction contract instead of an interleavable Map.
    const raw = api.runTransaction.bind(api); let serial = Promise.resolve();
    api.runTransaction = ((fn: any) => {
      const next = serial.then(() => raw(fn)); serial = next.then(() => {}, () => {}); return next;
    }) as SharedDb['runTransaction'];
    const call = { actorUid: 'alice', op: 'create' as const, collection: 'orders', key, nowMs: now, data: { value: 'last' } };
    const results = await Promise.all([runSharedData(api, WS, { ...call, id: 'one' }), runSharedData(api, WS, { ...call, id: 'two' })]);
    expect(results.map(r => r.status).sort()).toEqual([200, 429]);
    expect([...docs.keys()].filter(k => k.includes('/records/'))).toHaveLength(1);
    expect((docs.get(`nbai_app_data/${WS}`) as any).opsUsed).toBe(SHARED_DATA_OPS_CAP);
  });
  it('walks beyond the first page without exposing somebody else’s rows', async () => {
    const { api, key, now } = await setup();
    for (let i = 0; i < 25; i++) expect((await runSharedData(api, WS, { actorUid: 'alice', op: 'create', collection: 'orders', id: `row${String(i).padStart(2, '0')}`, key, nowMs: now, data: { i } })).status).toBe(200);
    await runSharedData(api, WS, { actorUid: 'bob', op: 'create', collection: 'orders', id: 'privatebob', key, nowMs: now, data: { i: 99 } });
    const base = { actorUid: 'alice', op: 'list' as const, collection: 'orders', id: null, key, nowMs: now, data: null };
    const first = await runSharedData(api, WS, base);
    const second = await runSharedData(api, WS, { ...base, cursor: String(first.body.nextCursor) });
    expect((first.body.records as any[]).length).toBe(20);
    expect((second.body.records as any[]).length).toBe(5);
    expect(second.body.nextCursor).toBeNull();
    expect([...first.body.records as any[], ...second.body.records as any[]].some(r => r.id === 'privatebob')).toBe(false);
  });
});
