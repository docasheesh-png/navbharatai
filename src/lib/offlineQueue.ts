/**
 * P3.2 — Offline-first write queue.
 *
 * Buffers fire-and-forget writes that FAIL because the device is offline, and replays
 * them when connectivity returns. To stay break-proof on a production app that also
 * handles payments and builds, replay is STRICTLY ALLOWLISTED to endpoints that are
 * idempotent / harmless to duplicate or lose (telemetry + client error logs). A
 * payment or build is NEVER queued or replayed.
 *
 * Pairs with the service-worker read-cache (network-first → cache fallback) so the app
 * also *reads* last-known data offline.
 */

/** Path prefixes whose POSTs are safe to queue + replay (idempotent / harmless). */
export const REPLAYABLE_WRITE_PATHS = [
  '/api/analytics/event',
  '/api/logs/error',
] as const;

/** Pure (unit-tested): is this URL safe to queue + replay offline? */
export function isReplayable(url: string): boolean {
  let path = url;
  try { path = new URL(url, 'http://x').pathname; } catch { /* already a path */ }
  return REPLAYABLE_WRITE_PATHS.some((p) => path === p || path.startsWith(p));
}

export interface QueuedWrite {
  id: string;
  url: string;
  body: string;
  ts: number;
}

/** Pluggable store so the queue is testable without a real IndexedDB. */
export interface QueueStore {
  add(entry: QueuedWrite): Promise<void>;
  getAll(): Promise<QueuedWrite[]>;
  remove(id: string): Promise<void>;
}

const DB_NAME = 'navbharat_offline_queue';
const STORE = 'writes';

/** IndexedDB-backed store (browser default). */
export class IDBQueueStore implements QueueStore {
  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async add(entry: QueuedWrite): Promise<void> {
    const db = await this.open();
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(entry);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }
  async getAll(): Promise<QueuedWrite[]> {
    const db = await this.open();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readonly');
      const out: QueuedWrite[] = [];
      const cur = tx.objectStore(STORE).openCursor();
      cur.onsuccess = () => { const c = cur.result; if (c) { out.push(c.value as QueuedWrite); c.continue(); } else res(out); };
      cur.onerror = () => rej(cur.error);
    });
  }
  async remove(id: string): Promise<void> {
    const db = await this.open();
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }
}

let seq = 0;
function newId(): string { return `w-${Date.now()}-${(seq++).toString(36)}`; }

export class OfflineQueue {
  constructor(
    private store: QueueStore,
    private fetchFn: typeof fetch = (...a: Parameters<typeof fetch>) => fetch(...a),
  ) {}

  /**
   * POST a fire-and-forget write. On success it goes straight out. On a NETWORK failure
   * (offline) for an allowlisted endpoint, it is queued for replay. Non-allowlisted
   * endpoints are NOT queued (they just fail, exactly as before). Never throws.
   */
  async postWithFallback(url: string, body: string): Promise<{ sent: boolean; queued: boolean }> {
    try {
      await this.fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      return { sent: true, queued: false };
    } catch {
      if (isReplayable(url)) {
        try { await this.store.add({ id: newId(), url, body, ts: Date.now() }); return { sent: false, queued: true }; }
        catch { return { sent: false, queued: false }; }
      }
      return { sent: false, queued: false };
    }
  }

  /** Replay all queued writes; remove each on success, keep on failure. Returns count flushed. */
  async flush(): Promise<number> {
    let flushed = 0;
    let entries: QueuedWrite[];
    try { entries = await this.store.getAll(); } catch { return 0; }
    for (const e of entries) {
      try {
        await this.fetchFn(e.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: e.body });
        await this.store.remove(e.id);
        flushed++;
      } catch { /* still offline — keep it for the next flush */ }
    }
    return flushed;
  }
}

// Browser singleton + auto-flush on reconnect. Guarded so it's inert in non-browser/test.
export const offlineQueue = new OfflineQueue(
  typeof indexedDB !== 'undefined' ? new IDBQueueStore() : { add: async () => {}, getAll: async () => [], remove: async () => {} },
);

/** Wire reconnect-driven replay. Call once at app startup. */
export function installOfflineQueueFlush(): void {
  if (typeof window === 'undefined') return;
  const flush = () => { void offlineQueue.flush(); };
  window.addEventListener('online', flush);
  // Also attempt a flush on load (covers writes queued in a previous session).
  flush();
}
