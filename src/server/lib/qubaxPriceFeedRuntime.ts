import type { Scheduler } from './ScheduledJobs';
import { QUBAX_PRICE_FEED_INTERVAL_MS } from './qubaxPriceFeed';
import { QubaxPriceFeedStore, syncQubaxPriceFeed } from './qubaxPriceFeedStore';

export const QUBAX_PRICE_FEED_JOB = 'qubax-public-price-feed';
type Env = Record<string, string | undefined>;
export function qubaxPriceFeedEnabled(env: Env = process.env): boolean {
  // Default on. An explicit 0 is the only off switch. A key does not change this, and the feed does not authorize a call.
  return env.QUBAX_PRICE_FEED_ENABLED !== '0';
}
export async function refreshQubaxPriceFeed(env: Env = process.env) {
  if (!qubaxPriceFeedEnabled(env)) return { status: 'disabled' as const };
  try {
    const { getServerDb } = await import('./serverDb');
    const db = getServerDb();
    if (!db) return { status: 'unavailable' as const };
    const result = await syncQubaxPriceFeed(new QubaxPriceFeedStore(db));
    if (result.status === 'synced') void import('./qubaxProbe').then(probe => probe.runScheduledQubaxProbe(env)).catch(() => {});
    return result;
  } catch { return { status: 'unavailable' as const }; }
}
export function registerQubaxPriceFeed(scheduler: Pick<Scheduler, 'register' | 'runNow'>, env: Env = process.env): void {
  if (!qubaxPriceFeedEnabled(env)) return;
  scheduler.register({ id: QUBAX_PRICE_FEED_JOB, exclusive: true, schedule: { kind: 'everyMs', ms: QUBAX_PRICE_FEED_INTERVAL_MS },
    handler: async () => { await refreshQubaxPriceFeed(env); } });
  // Both startup and authenticated external ticks enter the same durable fence.
  void scheduler.runNow(QUBAX_PRICE_FEED_JOB).catch(() => {});
}
