// U-4 (verified recipe modules) — API rate-limiting generator (express-rate-limit: memory + Redis store).
//
// Real, working API rate limiting generated into the app — the front-line defence against abuse, brute-force
// and accidental request storms that a public API needs. Built on express-rate-limit (the Node standard).
// Two backing stores, chosen by how the app is deployed:
//   • memory — the default in-process counter. Perfect for a single instance / getting started. No infra.
//   • redis  — a shared counter across ALL instances (Bring-Your-Own Redis via REDIS_URL). Correct once the
//              app is horizontally scaled, where an in-memory limit would let N× the traffic through.
// PURE builders; the generated code is correct and complete — no TODO stubs (the real-features rule).
// Unit-tested.

export type RateLimitStore = 'memory' | 'redis';

export interface RateLimitConfig {
  store: RateLimitStore;
  files: Record<string, string>;
  envKeys: string[];
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const ENV_EXAMPLE = '.env.example';

// ── In-memory store (single instance) ────────────────────────────────────────────────────────────────────
const MEMORY_SERVER = `import rateLimit from 'express-rate-limit';

// A sensible default: 100 requests / 15 min per client, with the standard RateLimit-* headers. Mount it on
// your API — app.use('/api', apiLimiter) — or a sensitive route (login) with a tighter limit.
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: true, // send RateLimit-* headers so clients can back off
  legacyHeaders: false,
});
`;

// ── Redis store (distributed) ────────────────────────────────────────────────────────────────────────────
const REDIS_SERVER = `import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import IORedis from 'ioredis';

// Bring-Your-Own Redis — REDIS_URL. A SHARED counter across every instance, so the limit is correct after the
// app is horizontally scaled (an in-memory limit would let each instance allow the full quota independently).
const client = new IORedis(process.env.REDIS_URL as string);

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore({ sendCommand: (...args: string[]) => client.call(...args) as any }),
});
`;

const MEMORY_INSTRUCTIONS =
  'In-memory API rate limiting wired (express-rate-limit). Mount it: app.use("/api", apiLimiter). Great for a ' +
  'single instance; when you scale to multiple instances, re-run this recipe with the "redis" store so the ' +
  'limit is shared (an in-memory counter is per-instance, so N instances allow N× the traffic).';

const REDIS_INSTRUCTIONS =
  'Distributed API rate limiting wired (express-rate-limit + Redis). Point REDIS_URL at your own Redis in .env ' +
  '— NavBharatAI never stores it. Mount it: app.use("/api", apiLimiter). The counter is shared across all ' +
  'instances, so the limit stays correct once the app is horizontally scaled.';

export function generateRateLimitIntegration(store: RateLimitStore): RateLimitConfig {
  if (store === 'memory') {
    return {
      store,
      files: {
        'server/lib/rateLimit.ts': MEMORY_SERVER,
      },
      envKeys: [],
      dependencies: [{ name: 'express-rate-limit', version: '^7' }],
      instructions: MEMORY_INSTRUCTIONS,
    };
  }
  return {
    store,
    files: {
      'server/lib/rateLimit.ts': REDIS_SERVER,
      [ENV_EXAMPLE]: 'REDIS_URL=\n',
    },
    envKeys: ['REDIS_URL'],
    dependencies: [
      { name: 'express-rate-limit', version: '^7' },
      { name: 'rate-limit-redis', version: '^4' },
      { name: 'ioredis', version: '^5' },
    ],
    instructions: REDIS_INSTRUCTIONS,
  };
}

export function isRateLimitStore(v: unknown): v is RateLimitStore {
  return v === 'memory' || v === 'redis';
}
