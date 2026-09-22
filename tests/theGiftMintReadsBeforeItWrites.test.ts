import { describe, it, expect, vi } from 'vitest';

/**
 * FIRESTORE'S READ-BEFORE-WRITE RULE, HELD ON THE GIFT-CODE MINT.
 *
 * 🔴 THIS CAUGHT A REAL BUG IN THE PR THAT ADDED IT, and the failure it would have produced is the
 * worst-placed one in the whole feature. The first draft of `mintCodeForOrder` read the order
 * pointer, WROTE the code document, and only THEN read the buyer's daily tally. Firestore rejects a
 * transaction that reads after it writes — `payments.ts` carries the same note on its own
 * transaction — so the very FIRST real gift purchase would have thrown **after the money had already
 * left the buyer's account**, while they waited for a code that was never going to appear.
 *
 * ⚠️ NOTHING ELSE IN THIS REPO COULD HAVE SEEN IT. The transaction body only executes against a real
 * Firestore; the 31 pure and source-level cases in `aBoughtCodeIsSpentOnce` never enter it, `tsc` has
 * no opinion about call order, and "a get after a set" is not something a grep can ask. The only
 * honest way to hold the rule is to run the real function with a `tx` that enforces it.
 *
 * ⚠️ It lives in its OWN file because mocking `serverDb` is module-wide, and the sibling suite reads
 * the real sources on purpose.
 */

const calls: string[] = [];
let wrote = false;

vi.mock('../src/server/lib/serverDb', () => ({
  doc: (_db: unknown, path: string, id: string) => ({ __path: `${path}/${id}` }),
  runTransaction: async (_db: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({
    get: async (ref: { __path?: string }) => {
      // Exactly what Firestore does, and the whole point of this file.
      if (wrote) throw new Error('Firestore: transactions require all reads before any write');
      calls.push(`get:${ref?.__path ?? '?'}`);
      return { exists: () => false, data: () => ({}) };
    },
    set: (ref: { __path?: string }) => { wrote = true; calls.push(`set:${ref?.__path ?? '?'}`); },
    update: (ref: { __path?: string }) => { wrote = true; calls.push(`update:${ref?.__path ?? '?'}`); },
  }),
  getDoc: async () => ({ exists: () => false, data: () => ({}) }),
}));

const fixedBytes = (seed: number) => (n: number) =>
  Uint8Array.from({ length: n }, (_, i) => (seed + i * 7) % 256);

describe('minting a gift code obeys Firestore\'s read-before-write rule', () => {
  it('reads BOTH the order pointer and the daily tally before it writes anything', async () => {
    const { mintCodeForOrder } = await import('../src/server/lib/giftCodeStore');
    calls.length = 0;
    wrote = false;

    // A throw here IS the failure: the mocked `get` raises Firestore's own error on a late read.
    const code = await mintCodeForOrder({} as unknown, {
      orderId: 'ord_1', buyerUid: 'buyer', faceInr: 500, paidInr: 510, feeInr: 10,
      nowMs: Date.parse('2026-09-22T10:00:00.000Z'), randomBytes: fixedBytes(5),
    });
    expect(code.startsWith('NBGIFT-')).toBe(true);

    const firstSet = calls.findIndex((c) => c.startsWith('set:'));
    const lastGet = calls.map((c) => c.startsWith('get:')).lastIndexOf(true);
    expect(firstSet, 'the transaction must write something').toBeGreaterThan(-1);
    expect(lastGet, 'the transaction must read something').toBeGreaterThan(-1);
    expect(lastGet, `reads must all precede writes — order was ${calls.join(' → ')}`).toBeLessThan(firstSet);
  });

  it('it really reads TWO documents — one read would mean the tally is not in the conflict set', () => {
    // If the daily tally were read outside the transaction, two concurrent purchases could both see
    // the same count and the cap would drift. Two reads is what puts it in the conflict set.
    expect(calls.filter((c) => c.startsWith('get:'))).toHaveLength(2);
  });

  it('writes the code, its order pointer and the tally — three documents, one transaction', () => {
    expect(calls.filter((c) => c.startsWith('set:'))).toHaveLength(3);
  });
});
