import { describe, it, expect, afterEach } from 'vitest';
import { issueBillOfSupply, receiptIdFor } from '../src/server/lib/receiptStore';

function fakeDb() {
  const docs = new Map<string, any>();
  const db = {
    docs,
    collection: (c: string) => ({ doc: (id: string) => ({ key: `${c}/${id}` }) }),
    runTransaction: async (fn: (t: any) => Promise<any>) => {
      const writes: Array<[string, any]> = [];
      const t = {
        get: async (r: { key: string }) => ({ exists: docs.has(r.key), data: () => docs.get(r.key) }),
        set: (r: { key: string }, v: any, o?: { merge?: boolean }) => writes.push([r.key, o?.merge ? { ...(docs.get(r.key) ?? {}), ...v } : v]),
      };
      const out = await fn(t);
      for (const [k, v] of writes) docs.set(k, v);
      return out;
    },
  };
  return db;
}
const line = { description: 'Pro plan', quantity: 1, unit: '30 days', unitPaise: 49900, amountPaise: 49900 };
const input = { ownerId: 'u1', sourceRef: 'plan_pro_2026-11-12', customer: { id: 'u1', name: null, email: null }, lines: [line], now: new Date('2026-10-13T10:00:00Z') };

afterEach(() => { delete process.env.METERING_V1; });

describe('METERING_V1 receipt hook', () => {
  it('flag off ⇒ nothing is written', async () => {
    const db = fakeDb();
    expect(await issueBillOfSupply(db, input)).toBeNull();
    expect(db.docs.size).toBe(0);
  });
  it('flag on ⇒ one numbered Bill of Supply, and a retry returns the same one', async () => {
    process.env.METERING_V1 = '1';
    const db = fakeDb();
    const a = await issueBillOfSupply(db, input);
    const b = await issueBillOfSupply(db, input);
    expect(a?.number).toBe('NB-BOS-202610-000001');
    expect(b?.number).toBe(a?.number);
    expect(db.docs.get('bill_of_supply_counters/global')).toEqual({ seq: 1 });
    expect(a?.title).toBe('Bill of Supply');
    expect(JSON.stringify(a)).not.toMatch(/GSTIN|CGST|SGST|IGST|Tax Invoice/);
    const c = await issueBillOfSupply(db, { ...input, sourceRef: 'other' });
    expect(c?.number).toBe('NB-BOS-202610-000002');
  });
  it('a store failure never throws into the purchase', async () => {
    process.env.METERING_V1 = '1';
    const db = { collection: () => ({ doc: () => ({}) }), runTransaction: async () => { throw new Error('down'); } };
    await expect(issueBillOfSupply(db, input)).resolves.toBeNull();
  });
  it('ids are safe document ids', () => {
    expect(receiptIdFor('u/1', 'a b')).toBe('u_1__a_b');
  });
});
