/** Offline owner-budget proof: only confirmed, never-dispatched reservations may close at zero cost. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FreeChainStore } from '../src/server/AI/FreeChain/store';
import { cappedFreeTierRung, dispatchWithFreeTierPaidHold, reserveFreeTierPaid, estimateTextTokens, quoteFreeTierPaidNanoUsd, setFreeTierPaidStoreForTests } from '../src/server/lib/freeTierPaidCap';
const NOW = Date.parse('2026-10-26T12:00:00Z');
const DAY = 86_400_000;
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
class OfflineDb {
  docs = new Map<string, any>();
  private tail = Promise.resolve();
  doc(path: string) { return { path }; }
  async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.tail; this.tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      const writes = new Map<string, any>();
      const value = await fn({
        get: async ({ path }: { path: string }) => ({ exists: this.docs.has(path), data: () => structuredClone(this.docs.get(path)) }),
        set: ({ path }: { path: string }, data: any) => writes.set(path, structuredClone(data)),
      });
      for (const [path, data] of writes) this.docs.set(path, data);
      return value;
    } finally { release(); }
  }
}
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('NETWORK PROHIBITED'); }));
  vi.stubEnv('FREE_TIER_PAID_DAILY_CAP_USD', '10');
  vi.stubEnv('RATE_GEMINI_LITE_IN', '0.1'); vi.stubEnv('RATE_GEMINI_LITE_OUT', '0.4');
  vi.stubEnv('RATE_GEMINI_IN', '0.3'); vi.stubEnv('RATE_GEMINI_OUT', '2.5');
  vi.stubEnv('RATE_GPT_NANO_IN', '0.2'); vi.stubEnv('RATE_GPT_NANO_OUT', '1.25');
});
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); setFreeTierPaidStoreForTests(undefined); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('undispatched cancellation and the existing atomic settlement contract', () => {
  it.each(['execute', 'executeStream'] as const)('%s abort before adapter entry releases only its confirmed internal budget hold, never user wallet', async method => {
    const db = new OfflineDb(); const store = new FreeChainStore(db as never, { adminEmails: () => [] });
    let acknowledge!: () => void; const pendingAcknowledgement = new Promise<void>(resolve => { acknowledge = resolve; });
    let reservation: any;
    const reservePaid = vi.fn(async (input: any) => { reservation = await store.reservePaid(input, NOW); await pendingAcknowledgement; return reservation; });
    const settlePaid = vi.fn((held: any, actual?: number) => store.settlePaid(held, actual, NOW));
    setFreeTierPaidStoreForTests({ reservePaid, settlePaid });
    const execute = vi.fn(); const executeStream = vi.fn();
    const wrapped = cappedFreeTierRung({ name: 'VERTEX', priority: 1, pinnedModel: 'gemini-2.5-flash-lite', execute, executeStream, healthCheck: async () => true }, 'free-chat');
    const controller = new AbortController();
    const pending = (method === 'execute'
      ? wrapped.execute('hello', undefined, undefined, 'system', undefined, controller.signal)
      : wrapped.executeStream!('hello', 'system', () => {}, undefined, controller.signal)).catch(error => error);
    await flush(); expect(reservation).toBeTruthy(); controller.abort(new Error('caller left before dispatch')); acknowledge();
    expect(await pending).toBeInstanceOf(Error);
    expect(execute).not.toHaveBeenCalled(); expect(executeStream).not.toHaveBeenCalled(); expect(settlePaid).toHaveBeenCalledExactlyOnceWith(reservation, 0);
    expect(reservation.maxCostNanoUsd).toBe(3_283_800);
    expect(await store.spendSnapshot(NOW)).toMatchObject({ heldNanoUsd: 0, spentNanoUsd: 0, committedNanoUsd: 0, pending: 0, requests: 1 });
    expect(db.docs.get(`free_chat_chain/paid_reservation_${reservation.id}`)).not.toHaveProperty('expiresAt');
    expect(db.docs.get('free_chat_chain/paid_day_2026-10-26')).toHaveProperty('expiresAt');
    expect(await store.settlePaid(reservation, undefined, NOW + 400 * DAY)).toBe(false);
    expect((await store.spendSnapshot(NOW + DAY)).committedNanoUsd).toBe(0);
    expect((await store.spendSnapshot(NOW)).committedNanoUsd).toBe(0);
    expect([...db.docs.keys()].every(path => path.startsWith('free_chat_chain/'))).toBe(true);
  });
  it.each(['execute', 'executeStream'] as const)('%s pre-abort reserves nothing and cannot refund anything', async method => {
    const reservePaid = vi.fn(); const settlePaid = vi.fn(); setFreeTierPaidStoreForTests({ reservePaid, settlePaid });
    const execute = vi.fn(); const executeStream = vi.fn();
    const wrapped = cappedFreeTierRung({ name: 'VERTEX', priority: 1, pinnedModel: 'gemini-2.5-flash-lite', execute, executeStream, healthCheck: async () => true }, 'free-chat');
    const controller = new AbortController(); controller.abort(new Error('already cancelled'));
    const pending = method === 'execute' ? wrapped.execute('hello', undefined, undefined, undefined, undefined, controller.signal) : wrapped.executeStream!('hello', undefined, () => {}, undefined, controller.signal);
    await expect(pending).rejects.toThrow('already cancelled');
    expect(reservePaid).not.toHaveBeenCalled(); expect(settlePaid).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled(); expect(executeStream).not.toHaveBeenCalled();
  });
  it.each(['execute', 'executeStream'] as const)('%s cancellation after adapter entry retains uncertain spend', async method => {
    const db = new OfflineDb(); const store = new FreeChainStore(db as never, { adminEmails: () => [] });
    let reservation: any;
    const reservePaid = vi.fn(async (input: any) => { reservation = await store.reservePaid(input, NOW); return reservation; });
    const settlePaid = vi.fn((held: any, actual?: number) => store.settlePaid(held, actual, NOW)); setFreeTierPaidStoreForTests({ reservePaid, settlePaid });
    const entered = vi.fn();
    const execute = vi.fn(async (...args: any[]) => { entered(); const signal: AbortSignal = args[5]; await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); return {} as any; });
    const executeStream = vi.fn(async (...args: any[]) => { entered(); const signal: AbortSignal = args[4]; await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); return ''; });
    const wrapped = cappedFreeTierRung({ name: 'VERTEX', priority: 1, pinnedModel: 'gemini-2.5-flash-lite', execute, executeStream, healthCheck: async () => true }, 'free-chat');
    const controller = new AbortController(); const pending = (method === 'execute' ? wrapped.execute('hello', undefined, undefined, undefined, undefined, controller.signal) : wrapped.executeStream!('hello', undefined, () => {}, undefined, controller.signal)).catch(error => error);
    await flush(); expect(entered).toHaveBeenCalledOnce(); controller.abort(new Error('may already have cost money'));
    expect(await pending).toBeInstanceOf(Error); expect(settlePaid).not.toHaveBeenCalled();
    expect((await store.spendSnapshot(NOW)).heldNanoUsd).toBe(reservation.maxCostNanoUsd);
  });
  it.each(['lost-reserve-ack', 'settlement-error'] as const)('%s retains the hold rather than claiming an unconfirmed refund', async failure => {
    const db = new OfflineDb(); const store = new FreeChainStore(db as never, { adminEmails: () => [] });
    const controller = new AbortController(); let reservation: any;
    const reservePaid = vi.fn(async (input: any) => { reservation = await store.reservePaid(input, NOW); controller.abort(new Error('cancelled')); if (failure === 'lost-reserve-ack') throw new Error('unknown acknowledgement'); return reservation; });
    const settlePaid = vi.fn(async () => { throw new Error('storage unavailable'); }); setFreeTierPaidStoreForTests({ reservePaid, settlePaid });
    const execute = vi.fn(); const wrapped = cappedFreeTierRung({ name: 'VERTEX', priority: 1, pinnedModel: 'gemini-2.5-flash-lite', execute, healthCheck: async () => true }, 'free-chat');
    await expect(wrapped.execute('hello', undefined, undefined, undefined, undefined, controller.signal)).rejects.toBeInstanceOf(Error);
    expect(execute).not.toHaveBeenCalled(); expect(settlePaid).toHaveBeenCalledTimes(failure === 'lost-reserve-ack' ? 0 : 1);
    expect((await store.spendSnapshot(NOW)).heldNanoUsd).toBe(reservation.maxCostNanoUsd);
  });
  it('only an exact unused server-minted hold can cross the dispatch boundary once', async () => {
    const reservation = { id: 'synthetic', day: '2026-10-26', uidHash: 'owner', maxCostNanoUsd: 1, createdAt: NOW, mayDispatch: true };
    const settlePaid = vi.fn(async () => true); setFreeTierPaidStoreForTests({ reservePaid: vi.fn(async () => reservation), settlePaid });
    const hold = (await reserveFreeTierPaid({ surface: 'free-chat', model: 'gemini-2.5-flash-lite', inputTokens: 1, outputTokens: 1 }))!;
    const dispatch = vi.fn(async () => { throw new Error('ambiguous SDK entry'); });
    await expect(dispatchWithFreeTierPaidHold({ ...hold }, undefined, dispatch)).rejects.toThrow('not available');
    expect(dispatch).not.toHaveBeenCalled();
    await expect(dispatchWithFreeTierPaidHold(hold, undefined, dispatch)).rejects.toThrow('ambiguous SDK entry');
    const controller = new AbortController(); controller.abort();
    await expect(dispatchWithFreeTierPaidHold(hold, controller.signal, dispatch)).rejects.toThrow('not available');
    expect(dispatch).toHaveBeenCalledOnce(); expect(settlePaid).not.toHaveBeenCalled();
  });
  it('a pre-entry aborted receipt is consumed even when zero settlement fails', async () => {
    const reservation = { id: 'synthetic', day: '2026-10-26', uidHash: 'owner', maxCostNanoUsd: 1, createdAt: NOW, mayDispatch: true };
    const settlePaid = vi.fn(async () => { throw new Error('unknown settlement'); }); setFreeTierPaidStoreForTests({ reservePaid: vi.fn(async () => reservation), settlePaid });
    const hold = (await reserveFreeTierPaid({ surface: 'free-chat', model: 'gemini-2.5-flash-lite', inputTokens: 1, outputTokens: 1 }))!;
    const dispatch = vi.fn(); const controller = new AbortController(); controller.abort();
    await expect(dispatchWithFreeTierPaidHold(hold, controller.signal, dispatch)).rejects.toBeDefined();
    await expect(dispatchWithFreeTierPaidHold(hold, undefined, dispatch)).rejects.toThrow('not available');
    expect(dispatch).not.toHaveBeenCalled(); expect(settlePaid).toHaveBeenCalledExactlyOnceWith(reservation, 0);
  });
  it('a paid-tier null hold forwards the call without a budget operation, but still honors preabort', async () => {
    const reservePaid = vi.fn(); const settlePaid = vi.fn(); setFreeTierPaidStoreForTests({ reservePaid, settlePaid });
    const dispatch = vi.fn(async () => 'synthetic answer');
    expect(await dispatchWithFreeTierPaidHold(null, undefined, dispatch)).toBe('synthetic answer');
    const controller = new AbortController(); controller.abort();
    await expect(dispatchWithFreeTierPaidHold(null, controller.signal, dispatch)).rejects.toBeDefined();
    expect(dispatch).toHaveBeenCalledOnce(); expect(reservePaid).not.toHaveBeenCalled(); expect(settlePaid).not.toHaveBeenCalled();
  });
  it('quotes the exact unchanged default model holds for the same synthetic input', () => {
    const input = estimateTextTokens('hello', 'system'); expect(input).toBe(70);
    expect(quoteFreeTierPaidNanoUsd('gemini-2.5-flash-lite', input, 8192)).toBe(3_283_800);
    expect(quoteFreeTierPaidNanoUsd('gemini-2.5-flash', input, 8192)).toBe(20_501_000);
    expect(quoteFreeTierPaidNanoUsd('gpt-5-nano', input, 8192)).toBe(10_254_000);
  });
  it('existing zero-cost transaction is idempotent, owner-matched, original-day scoped and cannot authorize a replay', async () => {
    const db = new OfflineDb(); const store = new FreeChainStore(db as never, { adminEmails: () => [] });
    const input = { requestId: 'synthetic-reservation', uid: 'synthetic-owner', maxCostNanoUsd: 3_283_800, perUserLimit: 1 };
    const held = (await store.reservePaid(input, NOW))!;
    expect(await store.settlePaid({ ...held, uidHash: 'f'.repeat(64) }, 0, NOW)).toBe(false);
    expect(await Promise.all([store.settlePaid(held, 0, NOW + DAY), store.settlePaid(held, 0, NOW + DAY)])).toEqual([true, true]);
    expect(await store.spendSnapshot(NOW)).toMatchObject({ heldNanoUsd: 0, spentNanoUsd: 0, pending: 0, requests: 1 });
    expect((await store.reservePaid(input, NOW + DAY))?.mayDispatch).toBe(false);
    expect(await store.reservePaid({ ...input, requestId: 'another-request-same-day' }, NOW)).toBeNull();
    expect(await store.settlePaid(held, 1, NOW + DAY)).toBe(false);
    expect(db.docs.get(`free_chat_chain/paid_reservation_${held.id}`)).toMatchObject({ status: 'settled', actualCostNanoUsd: 0 });
    expect(db.docs.get(`free_chat_chain/paid_reservation_${held.id}`)).not.toHaveProperty('expiresAt');
  });
});
