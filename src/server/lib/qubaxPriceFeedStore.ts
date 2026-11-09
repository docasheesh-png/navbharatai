import { randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { collectQubaxPrices, QUBAX_PRICE_FEED_INTERVAL_MS, validQubaxPriceSnapshot, type QubaxPriceSnapshot } from './qubaxPriceFeed';

/** Separate from qubax_catalog and qubax_chat_approvals; no customer data or history. */
export const QUBAX_PRICE_FEED_DOCUMENT = 'qubax_price_observations/active';
export const QUBAX_PRICE_FEED_LEASE_MS = 45_000;
const RETRY_MS = 30_000;
export interface QubaxPriceFeedLease { token: string; startedAtMs: number; expiresAtMs: number }
const time = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;

export class QubaxPriceFeedStore {
  constructor(private readonly db: Pick<Firestore, 'doc' | 'runTransaction'>, private readonly clock = Date.now) {}
  private ref() { return this.db.doc(QUBAX_PRICE_FEED_DOCUMENT); }
  async read(): Promise<QubaxPriceSnapshot | null> {
    const value: unknown = (await this.ref().get()).data()?.snapshot;
    return validQubaxPriceSnapshot(value, this.clock()) ? value : null;
  }
  async claim(): Promise<QubaxPriceFeedLease | null> {
    const now = this.clock();
    if (!time(now)) throw new Error('QUBAX_PRICE_FEED_CLOCK');
    return this.db.runTransaction(async tx => {
      const state = (await tx.get(this.ref())).data() ?? {};
      if (state.nextAllowedAtMs !== undefined && !time(state.nextAllowedAtMs)
        || state.lease != null && (typeof state.lease.token !== 'string' || !time(state.lease.expiresAtMs) || !time(state.lease.startedAtMs))) throw new Error('QUBAX_PRICE_FEED_STATE');
      if (state.lease?.expiresAtMs > now || state.nextAllowedAtMs > now) return null;
      const lease = { token: randomUUID(), startedAtMs: now, expiresAtMs: now + QUBAX_PRICE_FEED_LEASE_MS };
      tx.set(this.ref(), { lease, lastAttemptAtMs: now, nextAllowedAtMs: now + QUBAX_PRICE_FEED_INTERVAL_MS }, { merge: true });
      return lease;
    });
  }
  async publish(lease: QubaxPriceFeedLease, snapshot: QubaxPriceSnapshot): Promise<void> {
    // Snapshot immediately: mutation by a caller cannot race an awaited transaction.
    const value: unknown = JSON.parse(JSON.stringify(snapshot));
    const expected = { ...lease };
    await this.db.runTransaction(async tx => {
      const state = (await tx.get(this.ref())).data() ?? {}, now = this.clock();
      if (!validQubaxPriceSnapshot(value, now) || typeof expected.token !== 'string' || !expected.token
        || !time(expected.startedAtMs) || !time(expected.expiresAtMs) || expected.expiresAtMs !== expected.startedAtMs + QUBAX_PRICE_FEED_LEASE_MS
        || state.lease?.token !== expected.token || !time(state.lease.expiresAtMs) || state.lease.expiresAtMs !== expected.expiresAtMs
        || state.lease.expiresAtMs <= now || state.lease.startedAtMs !== expected.startedAtMs
        || value.startedAtMs < expected.startedAtMs || state.snapshot?.startedAtMs > value.startedAtMs) throw new Error('QUBAX_PRICE_FEED_FENCE');
      tx.set(this.ref(), { snapshot: value, lease: null, lastSuccessAtMs: now, lastError: null },
        { mergeFields: ['snapshot', 'lease', 'lastSuccessAtMs', 'lastError'] });
    });
  }
  async fail(lease: QubaxPriceFeedLease): Promise<void> {
    await this.db.runTransaction(async tx => {
      if ((await tx.get(this.ref())).data()?.lease?.token !== lease.token) return;
      // No snapshot timestamp is touched. A prior generation expires normally.
      tx.set(this.ref(), { lease: null, lastError: 'public_price_feed_unavailable', nextAllowedAtMs: this.clock() + RETRY_MS }, { merge: true });
    });
  }
}

export async function syncQubaxPriceFeed(store: Pick<QubaxPriceFeedStore, 'claim' | 'publish' | 'fail'>, transport: typeof fetch = fetch, clock: () => number = Date.now) {
  let lease: QubaxPriceFeedLease | null = null;
  try {
    lease = await store.claim(); // Store failure is fail-closed, before any HTTP request.
    if (!lease) return { status: 'held' as const };
    const snapshot = await collectQubaxPrices(transport, clock);
    await store.publish(lease, snapshot);
    return { status: 'synced' as const, version: snapshot.version, expiresAtMs: snapshot.expiresAtMs, canDispatch: false as const };
  } catch {
    if (lease) await store.fail(lease).catch(() => {});
    return { status: 'unavailable' as const };
  }
}
