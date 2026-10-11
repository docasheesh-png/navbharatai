// ONE BOUNDED, O(1) IN-PROCESS CACHE — the only shape a per-instance map may take (performance audit, 2026-10-11).
//
// 🔴 THE CLASS THIS KILLS. Each Cloud Run instance runs one Node.js event loop, so a per-request cost in a
// shared map is paid by every user on that instance. The audit measured two copies of the same mistake:
//   • the bot guard (`adaptiveRateLimit.ts`) walked its WHOLE address map on every `/api` request once it
//     held 10,000 addresses, and only dropped addresses idle for 5 minutes, so the map kept growing.
//     Same build, same 100 connections: 1,162 req/s with 1,000 addresses → 486 req/s with a fresh address per
//     request; ~38% of all CPU in that loop; memory 304 → 750 MB in 60 s;
//   • `TTLCache.set` (`AgentV3/PromptCache.ts`) walked every entry on every write, to purge expired ones.
// And a dozen caches (hosting plan, own AI keys, uid → email, creator names, web-risk verdicts, the Doctor AI
// stores…) had no size bound at all.
//
// The rule this module makes the only path: a cache has a MAXIMUM SIZE, every get/set/delete is O(1), the
// least recently used entry is evicted when it is full, and expired entries are dropped lazily on read (or by
// an explicit `sweep()` a caller may run on a timer — never per request). `tests/boundedCaches.test.ts` keeps
// new unbounded caches out.
//
// PURE apart from `Date.now()`, which every method takes as an optional `now` so tests control time.

export interface BoundedCacheOptions {
  /** Hard ceiling on entries. The least recently used entry is evicted past it. */
  maxEntries: number;
  /** Time to live per entry in ms. Omit (or 0) for no expiry: entries leave only by eviction or delete. */
  ttlMs?: number;
}

interface Slot<V> {
  value: V;
  /** Absolute expiry (ms since epoch); `Infinity` when the cache has no TTL. */
  expiresAt: number;
}

/**
 * A Map with a size bound and LRU eviction. Insertion order doubles as recency order: `get` and `set` move
 * the key to the newest position, and eviction removes the first key — both O(1).
 */
export class BoundedCache<K, V> {
  private readonly map = new Map<K, Slot<V>>();
  readonly maxEntries: number;
  readonly ttlMs: number;

  constructor(opts: BoundedCacheOptions) {
    if (!Number.isFinite(opts.maxEntries) || opts.maxEntries < 1) {
      throw new Error('BoundedCache needs a finite maxEntries of at least 1.');
    }
    this.maxEntries = Math.floor(opts.maxEntries);
    this.ttlMs = opts.ttlMs && opts.ttlMs > 0 ? opts.ttlMs : 0;
  }

  /** Entries currently held, expired ones included until they are read or swept. */
  get size(): number {
    return this.map.size;
  }

  /** The live value, or `undefined`. A hit becomes the most recently used entry. */
  get(key: K, now: number = Date.now()): V | undefined {
    const slot = this.map.get(key);
    if (!slot) return undefined;
    if (slot.expiresAt <= now) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, slot);
    return slot.value;
  }

  /** Like `get`, but does not change recency. */
  peek(key: K, now: number = Date.now()): V | undefined {
    const slot = this.map.get(key);
    if (!slot || slot.expiresAt <= now) return undefined;
    return slot.value;
  }

  has(key: K, now: number = Date.now()): boolean {
    return this.peek(key, now) !== undefined;
  }

  /** Store a value (its TTL restarts), then evict the least recently used entries past the bound. */
  set(key: K, value: V, now: number = Date.now(), ttlMs: number = this.ttlMs): this {
    this.map.delete(key);
    this.map.set(key, { value, expiresAt: ttlMs > 0 ? now + ttlMs : Infinity });
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      this.map.delete(oldest.value);
    }
    return this;
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  /**
   * Drop expired entries. O(n), so it is for a TIMER (or a test), never for a request path. Returns how many
   * entries were removed.
   */
  sweep(now: number = Date.now()): number {
    let removed = 0;
    for (const [k, slot] of this.map) {
      if (slot.expiresAt <= now) {
        this.map.delete(k);
        removed++;
      }
    }
    return removed;
  }

  /** Live entries, oldest first. O(n): for admin views and tests. */
  entries(now: number = Date.now()): Array<[K, V]> {
    const out: Array<[K, V]> = [];
    for (const [k, slot] of this.map) if (slot.expiresAt > now) out.push([k, slot.value]);
    return out;
  }
}
