import { describe, it, expect } from 'vitest';
import { verifyRecordsLive, summarize, type RecordCheck } from './domainDnsVerify';

/**
 * ADMIN, 2026-08-21, connecting mitrify.com. The Publish sheet showed `ownership: missing` while all
 * THREE required records were live and byte-perfect in public DNS — verified by resolving them by
 * hand:
 *
 *   A    mitrify.com                  → 199.36.158.100                              ✓
 *   TXT  mitrify.com                  → hosting-site=nbai-709e5932ecaaf74b9c63      ✓
 *   TXT  _acme-challenge.mitrify.com  → y7xukjntdfGt5_a1CCdUm9f6EVYhhG6JQDgnOg3asi8 ✓
 *
 * The user had done everything right and the screen told them, in effect, that they had not — a state
 * indistinguishable from a typo, which is why correct records got edited over and over.
 */
const REAL = [
  { type: 'A', name: 'mitrify.com', value: '199.36.158.100' },
  { type: 'TXT', name: 'mitrify.com', value: 'hosting-site=nbai-709e5932ecaaf74b9c63' },
  { type: 'TXT', name: '_acme-challenge.mitrify.com', value: 'y7xukjntdfGt5_a1CCdUm9f6EVYhhG6JQDgnOg3asi8' },
];
const liveDeps = {
  a: async () => ['199.36.158.100'],
  txt: async (n: string) => (n.startsWith('_acme-challenge')
    ? ['y7xukjntdfGt5_a1CCdUm9f6EVYhhG6JQDgnOg3asi8']
    : ['hosting-site=nbai-709e5932ecaaf74b9c63']),
  cname: async () => [],
};

describe('verifyRecordsLive — the real mitrify.com case', () => {
  it('THE CASE THAT STARTED THIS: every record correct and live ⇒ nothing left for the user to do', () => {
    return verifyRecordsLive(REAL, liveDeps).then((r) => {
      expect(r.allSeen).toBe(true);
      expect(r.checks.every((c) => c.seen)).toBe(true);
      // The sentence whose absence had the admin re-editing correct records.
      expect(r.summary).toContain('correct and live');
      expect(r.summary).toContain('Nothing is left for you to do');
    });
  });

  it("🔒 a registrar's DISPLAY QUOTES are not a difference — Hostinger shows TXT wrapped in \" \"", async () => {
    // That is DNS presentation syntax, not part of the value. Comparing naively would report a
    // perfectly correct record as wrong — the exact false alarm this module exists to prevent.
    const r = await verifyRecordsLive([REAL[1]], {
      ...liveDeps, txt: async () => ['"hosting-site=nbai-709e5932ecaaf74b9c63"'],
    });
    expect(r.allSeen).toBe(true);
  });

  it('a trailing dot and different case are not differences either', async () => {
    const r = await verifyRecordsLive(
      [{ type: 'A', name: 'MITRIFY.COM.', value: '199.36.158.100' }],
      liveDeps,
    );
    expect(r.allSeen).toBe(true);
  });

  it('a long TXT split into 255-byte chunks is rejoined before comparing', async () => {
    const long = 'x'.repeat(300);
    const r = await verifyRecordsLive(
      [{ type: 'TXT', name: 'a.com', value: long }],
      { ...liveDeps, txt: async () => [long] },
    );
    expect(r.allSeen).toBe(true);
  });
});

describe('verifyRecordsLive — telling the three real states apart', () => {
  it('WRONG VALUE: shows what was found, and says the user must fix it', async () => {
    const r = await verifyRecordsLive([REAL[0]], { ...liveDeps, a: async () => ['1.2.3.4'] });
    expect(r.allSeen).toBe(false);
    expect(r.checks[0].found).toEqual(['1.2.3.4']);   // the wrong value is SHOWN, not just "missing"
    expect(r.summary).toContain('different value');
    expect(r.summary).toContain('Edit it at your registrar');
    // A user who has ALREADY fixed it still sees "wrong", because the old value stays in the
    // internet's caches for the record's TTL — hours on a registrar defaulting to 14400. Without this
    // they conclude the fix failed and edit a correct record again: the same loop, one step later.
    expect(r.summary).toContain('linger');
    expect(r.summary).toContain('clears by itself');
  });

  it('NOT PUBLISHED YET: says the registrar is still working, and that nothing is wrong', async () => {
    const notFound = Object.assign(new Error('nf'), { code: 'ENOTFOUND' });
    const r = await verifyRecordsLive([REAL[0]], { ...liveDeps, a: async () => { throw notFound; } });
    expect(r.allSeen).toBe(false);
    expect(r.checks[0].found).toEqual([]);
    expect(r.checks[0].lookupError).toBe('');  // an absent record is a STATE, not an error
    expect(r.summary).toContain('Not visible on the internet yet');
    expect(r.summary).toContain('Nothing is wrong');
  });

  it('OUR SIDE FAILED: says so, and does not blame the user', async () => {
    const r = await verifyRecordsLive([REAL[0]], {
      ...liveDeps, a: async () => { throw Object.assign(new Error('x'), { code: 'ESERVFAIL' }); },
    });
    expect(r.checks[0].lookupError).toBe('ESERVFAIL');
    expect(r.summary).toContain('our side, not yours');
  });

  it('a WRONG value outranks a missing one — only the wrong one needs the user to act', async () => {
    const checks: RecordCheck[] = [
      { type: 'TXT', name: 'a', expected: 'x', seen: false, found: [], lookupError: '' },
      { type: 'A', name: 'b', expected: '1.1.1.1', seen: false, found: ['9.9.9.9'], lookupError: '' },
    ];
    expect(summarize(checks)).toContain('different value');
  });

  it('never throws, and an empty record list produces no claim at all', async () => {
    await expect(verifyRecordsLive([], liveDeps)).resolves.toMatchObject({ allSeen: false, summary: '' });
    await expect(verifyRecordsLive(null, liveDeps)).resolves.toMatchObject({ checks: [] });
    expect(summarize([])).toBe('');
  });

  it('a record type we cannot check is UNCHECKED, never reported as missing', async () => {
    // Claiming a record is absent because we did not look is the same lie in the other direction.
    const r = await verifyRecordsLive([{ type: 'MX', name: 'a.com', value: 'mail' }], liveDeps);
    expect(r.checks[0].seen).toBe(false);
    expect(r.checks[0].lookupError).toContain('cannot check MX');
  });

  it('a hung resolver times out into an honest "unreadable", not a hung status page', async () => {
    const r = await verifyRecordsLive(
      [REAL[0]],
      { ...liveDeps, a: () => new Promise(() => {}) },   // never resolves
      20,
    );
    expect(r.checks[0].lookupError).toBe('timed out');
    expect(r.allSeen).toBe(false);
  });
});
