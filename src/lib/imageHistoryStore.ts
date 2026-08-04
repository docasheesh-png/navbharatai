/**
 * AI Image Generator — PERSISTENT history store (admin 2026-07-24: "history save honi chahiye").
 *
 * ROOT CAUSE this closes: the generator kept its recents in a React `useState` array only — pure
 * in-memory, wiped on every reload / tab close / app restart. A generated image is a multi-MB `data:`
 * URL, so localStorage (5–10 MB, string-only) would overflow after a couple of images. IndexedDB is the
 * correct browser store for large binary-ish values and survives reloads/app restarts — so history
 * genuinely persists on the device.
 *
 * Mirrors the proven `IDBQueueStore` pattern (src/lib/offlineQueue.ts): a pluggable `ImageHistoryStore`
 * interface (so the logic is unit-testable with an in-memory fake, no real IndexedDB in tests) + an
 * IndexedDB implementation + a browser singleton that degrades to a no-op when IndexedDB is absent
 * (SSR / older WebView / tests) — the generator then simply behaves like today (session-only), never
 * breaking. Persistence is per-device/per-browser (not cross-device — that would need a server + auth).
 */

export interface ImageHistoryItem {
  id: string;
  url: string; // a `data:<mime>;base64,…` URL (multi-MB) — IndexedDB stores large values fine
  prompt: string;
  type: string;
  style: string;
  size: string;
  timestamp: number;
}

/** Pluggable store so the generator's persistence is testable without a real IndexedDB. */
export interface ImageHistoryStore {
  /** All saved items, NEWEST FIRST. */
  getAll(): Promise<ImageHistoryItem[]>;
  /** Insert/replace one item (then prune to the newest `IMAGE_HISTORY_MAX`). */
  save(item: ImageHistoryItem): Promise<void>;
  /** Delete one item by id. */
  remove(id: string): Promise<void>;
  /** Delete every saved item. */
  clear(): Promise<void>;
}

/** Keep at most this many images — bounded so IndexedDB can never grow without limit. */
export const IMAGE_HISTORY_MAX = 50;

/** Sort newest-first and cap to `max`. Pure + unit-tested. */
export function pruneHistory(items: ImageHistoryItem[], max: number = IMAGE_HISTORY_MAX): ImageHistoryItem[] {
  return [...items].sort((a, b) => b.timestamp - a.timestamp).slice(0, Math.max(0, max));
}

const DB_NAME = 'navbharat_image_history';
const STORE = 'images';

/** IndexedDB-backed store (the browser default). Never used in the 'node' test env. */
export class IDBImageHistoryStore implements ImageHistoryStore {
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

  async getAll(): Promise<ImageHistoryItem[]> {
    const db = await this.open();
    const items = await new Promise<ImageHistoryItem[]>((res, rej) => {
      const tx = db.transaction(STORE, 'readonly');
      const out: ImageHistoryItem[] = [];
      const cur = tx.objectStore(STORE).openCursor();
      cur.onsuccess = () => { const c = cur.result; if (c) { out.push(c.value as ImageHistoryItem); c.continue(); } else res(out); };
      cur.onerror = () => rej(cur.error);
    });
    return pruneHistory(items); // newest-first (IndexedDB iterates in key order, not time order)
  }

  async save(item: ImageHistoryItem): Promise<void> {
    const db = await this.open();
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(item);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    // Bound the store: drop anything past the newest IMAGE_HISTORY_MAX so it never grows unbounded.
    try {
      const all = await this.getAll();
      const keep = new Set(pruneHistory(all).map((i) => i.id));
      const stale = all.filter((i) => !keep.has(i.id));
      for (const s of stale) await this.remove(s.id);
    } catch { /* pruning is best-effort — a failure never blocks a save */ }
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

  async clear(): Promise<void> {
    const db = await this.open();
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }
}

/** An in-memory store — the no-IndexedDB fallback AND the test double (matches offlineQueue's MemStore). */
export class MemoryImageHistoryStore implements ImageHistoryStore {
  private items = new Map<string, ImageHistoryItem>();
  async getAll(): Promise<ImageHistoryItem[]> { return pruneHistory([...this.items.values()]); }
  async save(item: ImageHistoryItem): Promise<void> {
    this.items.set(item.id, item);
    const keep = new Set(pruneHistory([...this.items.values()]).map((i) => i.id));
    for (const id of [...this.items.keys()]) if (!keep.has(id)) this.items.delete(id);
  }
  async remove(id: string): Promise<void> { this.items.delete(id); }
  async clear(): Promise<void> { this.items.clear(); }
}

/** Browser singleton: real IndexedDB when available, else an inert in-memory store (never throws). */
export const imageHistoryStore: ImageHistoryStore =
  typeof indexedDB !== 'undefined' ? new IDBImageHistoryStore() : new MemoryImageHistoryStore();
