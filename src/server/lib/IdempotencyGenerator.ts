// U-4 (verified recipe modules) — idempotency-key middleware (dependency-free).
//
// The classic double-charge bug: a user taps "Pay" twice, or the network drops the response so the client
// retries, and the same POST runs twice — two orders, two charges. The industry fix (Stripe, PayPal, …) is an
// Idempotency-Key: the client sends a unique key with the request; the server runs the work ONCE per key and
// replays the SAME response for any repeat. This recipe ships that as an Express middleware backed by an
// in-process store with a TTL. It caches only NON-5xx responses, so a transient server error can still be
// retried, and returns 409 while the first request is still in flight (no duplicate concurrent run). No
// dependency, no env keys. Honest scope: the in-memory store is per-instance — for multi-instance / serverless
// it must be swapped for a shared store (Redis); the store is a tiny interface so that swap is a few lines.
// PURE builder; correct and complete — no TODO stubs (the real-features rule). Unit-tested.

export interface IdempotencyConfig {
  files: Record<string, string>;
  instructions: string;
}

const IDEMPOTENCY_SERVER = `import type { Request, Response, NextFunction } from 'express';

interface CachedResponse { status: number; body: unknown; }
interface Entry { state: 'pending' | 'done'; response?: CachedResponse; expiresAt: number; }

// The store interface — swap this in-memory implementation for a Redis-backed one (get/set/delete with TTL)
// to make idempotency work across multiple instances / a serverless deployment.
export interface IdempotencyStore {
  get(key: string): Entry | undefined;
  set(key: string, entry: Entry): void;
  delete(key: string): void;
}

// A simple in-process store with lazy TTL expiry. Per-instance only (see the module note).
export function createMemoryStore(): IdempotencyStore {
  const map = new Map<string, Entry>();
  return {
    get(key) {
      const e = map.get(key);
      if (e && e.expiresAt < Date.now()) { map.delete(key); return undefined; }
      return e;
    },
    set(key, entry) { map.set(key, entry); },
    delete(key) { map.delete(key); },
  };
}

// Express middleware. Guard your non-idempotent mutations (POST /orders, POST /pay) with it. A request that
// carries an "Idempotency-Key" header runs its handler ONCE; any repeat with the same key replays the stored
// response. Requests WITHOUT the header pass straight through (idempotency is opt-in per request).
//   const store = createMemoryStore();
//   app.post('/pay', idempotency(store), payHandler);
export function idempotency(store: IdempotencyStore, opts?: { ttlMs?: number }) {
  const ttlMs = opts?.ttlMs ?? 24 * 60 * 60 * 1000; // 24h
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.get('Idempotency-Key');
    if (!key) { next(); return; } // opt-in: no key → normal handling

    // Scope the key by method + path so the same key on two different routes can't collide.
    const cacheKey = req.method + ' ' + (req.originalUrl || req.url) + ' ' + key;
    const existing = store.get(cacheKey);
    if (existing) {
      if (existing.state === 'done' && existing.response) {
        res.status(existing.response.status).json(existing.response.body);
        return;
      }
      // Still in flight — tell the client to back off rather than run a duplicate.
      res.status(409).json({ error: 'A request with this Idempotency-Key is already being processed.' });
      return;
    }

    store.set(cacheKey, { state: 'pending', expiresAt: Date.now() + ttlMs });

    // Capture the response body so a repeat can replay it. Only cache NON-5xx (a transient server error must
    // stay retryable); a 5xx clears the key so the client can try again.
    const originalJson = res.json.bind(res);
    res.json = (body: unknown): Response => {
      if (res.statusCode < 500) {
        store.set(cacheKey, { state: 'done', response: { status: res.statusCode, body }, expiresAt: Date.now() + ttlMs });
      } else {
        store.delete(cacheKey);
      }
      return originalJson(body);
    };
    // If the handler never sends JSON (or throws before responding), don't leave a stuck 'pending' key.
    res.on('finish', () => { const e = store.get(cacheKey); if (e && e.state === 'pending') store.delete(cacheKey); });
    next();
  };
}
`;

const INSTRUCTIONS =
  'Idempotency wired at server/lib/idempotency.ts (no dependency). Create one store — const store = ' +
  'createMemoryStore() — and guard every non-idempotent mutation with it: app.post("/pay", ' +
  'idempotency(store), payHandler). The client sends a unique "Idempotency-Key" header per logical action; ' +
  'the handler then runs ONCE per key and any retry (double-tap, dropped-response re-send) replays the same ' +
  'response instead of charging/creating twice. A 5xx is not cached (stays retryable); a still-in-flight ' +
  'repeat gets 409. IMPORTANT (honest): the in-memory store is per-instance — for multiple instances or a ' +
  'serverless deploy, swap createMemoryStore() for a Redis-backed IdempotencyStore. No API key needed.';

export function generateIdempotencyIntegration(): IdempotencyConfig {
  return {
    files: { 'server/lib/idempotency.ts': IDEMPOTENCY_SERVER },
    instructions: INSTRUCTIONS,
  };
}
