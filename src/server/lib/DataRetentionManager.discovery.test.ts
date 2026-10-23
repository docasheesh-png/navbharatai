import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  purgeExpired, RETENTION_POLICIES, type RetentionFirestore, type RetentionPolicy,
} from './DataRetentionManager';

const NOW = Date.parse('2026-10-22T12:00:00Z');
const EXPIRED = new Date(NOW - 1);
const POLICY = RETENTION_POLICIES.find(p => p.collection === 'free_chat_chain')!;
type Row = Record<string, unknown>;

/** Real collection/document shape: parent deletion deliberately does not erase children. */
class DiscoveryFirestore {
  rows = new Map<string, Row>();
  children = new Map<string, Map<string, Row>>();
  events: string[] = [];
  discovery: 'ok' | 'missing' | 'failed' | 'malformed' = 'ok';
  failChildDeletion = false;
  neverDrains = false;
  seed(id: string, data: Row) { this.rows.set(id, data); }
  seedChild(parent: string, sub: string, id = 'child') {
    const key = `${parent}/${sub}`;
    if (!this.children.has(key)) this.children.set(key, new Map());
    this.children.get(key)!.set(id, { value: true });
  }
  ref(id: string) {
    const ref: any = {
      delete: async () => { this.events.push(`delete:${id}`); this.rows.delete(id); },
      collection: (sub: string) => ({ limit: (n: number) => ({ get: async () => {
        this.events.push(`query:${id}/${sub}`);
        const key = `${id}/${sub}`, kids = this.children.get(key) ?? new Map();
        const ids = this.neverDrains ? Array.from({ length: n }, (_, i) => `unending-${i}`) : [...kids.keys()].slice(0, n);
        return { docs: ids.map(child => ({ ref: { delete: async () => {
          if (this.failChildDeletion) throw new Error('Child delete failed');
          this.events.push(`delete:${key}/${child}`); kids.delete(child);
        } } })) };
      } }) }),
    };
    if (this.discovery !== 'missing') ref.listCollections = async () => {
      this.events.push(`discover:${id}`);
      if (this.discovery === 'failed') throw new Error('Discovery failed');
      if (this.discovery === 'malformed') return undefined;
      return [...this.children].filter(([key, kids]) => key.startsWith(`${id}/`) && kids.size)
        .map(([key]) => ({ id: key.slice(id.length + 1) }));
    };
    return ref;
  }
  collection() {
    return {
      where: (field: string, _operator: string, bound: Date) => {
        let cap = Infinity;
        const query = {
          limit: (limit: number) => { cap = limit; return query; },
          get: async () => ({ docs: [...this.rows].filter(([, data]) => data[field] instanceof Date && (data[field] as Date).getTime() < bound.getTime())
            .slice(0, cap).map(([id]) => ({ ref: this.ref(id) })) }),
        };
        return query;
      },
    };
  }
  db() { return this as unknown as RetentionFirestore; }
}

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => { throw new Error('NETWORK PROHIBITED'); })); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe('opt-in mixed-store child discovery', () => {
  it('is enabled only for the FREE chain and declares every actual state child', () => {
    expect(RETENTION_POLICIES.filter(p => p.discoverSubcollections).map(p => p.collection)).toEqual(['free_chat_chain']);
    expect(POLICY).toMatchObject({ timestampField: 'expiresAt', timestampKind: 'date', ttlDays: 0,
      subs: ['cache', 'sticky', 'actions', 'events', 'paid_month'], discoverSubcollections: true });
  });
  it('deletes an expired accounting leaf with one discovery and no child-document queries', async () => {
    const db = new DiscoveryFirestore(); db.seed('paid_user_old', { expiresAt: EXPIRED });
    expect((await purgeExpired(db.db(), NOW, [POLICY])).totalDeleted).toBe(1);
    expect(db.events).toEqual(['discover:paid_user_old', 'delete:paid_user_old']);
    expect(db.rows.size).toBe(0);
  });
  it('drains only present declared children, across pages, before the parent', async () => {
    const db = new DiscoveryFirestore(); db.seed('expired', { expiresAt: EXPIRED });
    for (let i = 0; i < 301; i++) db.seedChild('expired', 'cache', `row-${i}`);
    db.seedChild('expired', 'actions');
    const report = await purgeExpired(db.db(), NOW, [POLICY]);
    expect(report.totalDeleted).toBe(303);
    expect(report.collections[0].error).toBeUndefined();
    expect(db.events.at(-1)).toBe('delete:expired');
    expect(db.events.filter(e => e.startsWith('query:'))).toEqual(['query:expired/cache', 'query:expired/cache', 'query:expired/actions']);
    expect(db.children.get('expired/cache')!.size).toBe(0);
    expect(db.children.get('expired/actions')!.size).toBe(0);
  });
  it('retains unknown children, all known siblings, and the parent without partial deletion', async () => {
    const db = new DiscoveryFirestore(); db.seed('expired', { expiresAt: EXPIRED });
    db.seedChild('expired', 'cache'); db.seedChild('expired', 'unregistered');
    const report = await purgeExpired(db.db(), NOW, [POLICY]);
    expect(report.totalDeleted).toBe(0); expect(report.collections[0].error).toMatch(/unknown or malformed/);
    expect(db.events).toEqual(['discover:expired']);
    expect(db.rows.has('expired')).toBe(true);
    expect(db.children.get('expired/cache')!.size).toBe(1);
    expect(db.children.get('expired/unregistered')!.size).toBe(1);
  });
  it.each(['missing', 'failed', 'malformed'] as const)('retains parents and children on %s discovery', async discovery => {
    const db = new DiscoveryFirestore(); db.seed('expired', { expiresAt: EXPIRED }); db.seedChild('expired', 'cache'); db.discovery = discovery;
    const report = await purgeExpired(db.db(), NOW, [POLICY]);
    expect(report.totalDeleted).toBe(0); expect(report.collections[0].error).toBeTruthy();
    expect(db.rows.has('expired')).toBe(true); expect(db.children.get('expired/cache')!.size).toBe(1);
    expect(db.events.some(e => e.startsWith('delete:') || e.startsWith('query:'))).toBe(false);
  });
  it('retains the parent when deletion of a discovered known child fails', async () => {
    const db = new DiscoveryFirestore(); db.seed('expired', { expiresAt: EXPIRED }); db.seedChild('expired', 'cache'); db.failChildDeletion = true;
    const report = await purgeExpired(db.db(), NOW, [POLICY]);
    expect(report.collections[0].error).toMatch(/Child delete failed/);
    expect(db.rows.has('expired')).toBe(true); expect(db.children.get('expired/cache')!.size).toBe(1);
  });
  it('never treats the child-page safety ceiling as proof that all children are gone', async () => {
    const db = new DiscoveryFirestore(); db.seed('expired', { expiresAt: EXPIRED }); db.seedChild('expired', 'cache'); db.neverDrains = true;
    const report = await purgeExpired(db.db(), NOW, [POLICY]);
    expect(report.collections[0].error).toMatch(/drain incomplete/);
    expect(db.rows.has('expired')).toBe(true); expect(db.events).not.toContain('delete:expired');
  });
  it('never discovers or deletes non-expiring authority, pending holds, replay tombstones, or state children', async () => {
    const db = new DiscoveryFirestore();
    db.seed('paid_day_settled', { kind: 'paid_day', pending: 0, heldNanoUsd: 0, expiresAt: EXPIRED });
    db.seed('paid_day_pending', { kind: 'paid_day', pending: 1, heldNanoUsd: 100 });
    db.seed('paid_reservation_held', { kind: 'paid_reservation', status: 'held' });
    db.seed('paid_reservation_settled', { kind: 'paid_reservation', status: 'settled' });
    for (const kind of ['quota', 'neurons', 'cooldown']) db.seed(kind, { kind, updatedAt: 0 });
    db.seed('state', { controls: { enabled: false }, updatedAt: 0 });
    for (const sub of POLICY.subs!) db.seedChild('state', sub);
    db.seed('future', { expiresAt: new Date(NOW + 1) });
    const report = await purgeExpired(db.db(), NOW, [POLICY]);
    expect(report.totalDeleted).toBe(1);
    expect(db.events).toEqual(['discover:paid_day_settled', 'delete:paid_day_settled']);
    expect([...db.rows.keys()]).toEqual(['paid_day_pending', 'paid_reservation_held', 'paid_reservation_settled', 'quota', 'neurons', 'cooldown', 'state', 'future']);
    for (const sub of POLICY.subs!) expect(db.children.get(`state/${sub}`)!.size).toBe(1);
  });
  it('leaves non-opted-in policies on their existing declared-child queries without discovery', async () => {
    const db = new DiscoveryFirestore(); db.seed('expired', { expiresAt: EXPIRED }); db.discovery = 'failed';
    db.seedChild('expired', 'cache');
    const { discoverSubcollections: _discovery, ...ordinary } = POLICY;
    const report = await purgeExpired(db.db(), NOW, [ordinary]);
    expect(report.totalDeleted).toBe(2); expect(report.collections[0].error).toBeUndefined();
    expect(db.events.filter(e => e.startsWith('query:'))).toEqual(POLICY.subs!.map(sub => `query:expired/${sub}`));
    expect(db.events.some(e => e.startsWith('discover:'))).toBe(false); expect(db.events.at(-1)).toBe('delete:expired');
  });
  it('does not silently ignore discovery when combined with an unsupported fenced policy', async () => {
    const db = new DiscoveryFirestore(); db.seed('expired', { expiresAt: EXPIRED });
    const policy: RetentionPolicy = { ...POLICY, fenced: true };
    const report = await purgeExpired(db.db(), NOW, [policy]);
    expect(report.totalDeleted).toBe(0); expect(report.collections[0].error).toMatch(/not supported by fenced retention/);
    expect(db.events).toEqual([]); expect(db.rows.has('expired')).toBe(true);
  });
});
