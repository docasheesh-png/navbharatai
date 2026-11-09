import type { Scheduler } from './ScheduledJobs';
import { QUBAX_PRICE_FEED_INTERVAL_MS } from './qubaxPriceFeed';
import { QubaxPriceFeedStore, syncQubaxPriceFeed } from './qubaxPriceFeedStore';

export const QUBAX_PRICE_FEED_JOB = 'qubax-public-price-feed';
type Env = Record<string, string | undefined>;
export function qubaxPriceFeedEnabled(env: Env = process.env): boolean {
  // A key or inference switch never activates the public feed (or vice versa).
  return env.QUBAX_PRICE_FEED_ENABLED === '1';
}
export async function refreshQubaxPriceFeed(env: Env = process.env) {
  if (!qubaxPriceFeedEnabled(env)) return { status: 'disabled' as const };
  try {
    const { getServerDb } = await import('./serverDb');
    const db = getServerDb();
    if (!db) return { status: 'unavailable' as const };
    return await syncQubaxPriceFeed(new QubaxPriceFeedStore(db));
  } catch { return { status: 'unavailable' as const }; }
}
export function registerQubaxPriceFeed(scheduler: Pick<Scheduler, 'register' | 'runNow'>, env: Env = process.env): void {
  if (!qubaxPriceFeedEnabled(env)) return;
  scheduler.register({ id: QUBAX_PRICE_FEED_JOB, exclusive: true, schedule: { kind: 'everyMs', ms: QUBAX_PRICE_FEED_INTERVAL_MS },
    handler: async () => { await refreshQubaxPriceFeed(env); } });
  // Both startup and authenticated external ticks enter the same durable fence.
  void scheduler.runNow(QUBAX_PRICE_FEED_JOB).catch(() => {});
}
