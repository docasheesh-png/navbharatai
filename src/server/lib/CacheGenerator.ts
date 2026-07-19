// U-4 (verified recipe modules) — object-cache generator (Redis + Upstash).
//
// Real, working key/value caching generated into the app, Bring-Your-Own-infra (the user points the recipe
// at their own Redis via .env; NavBharatAI never stores the connection). Caching is what makes an app fast:
// store an expensive result (a DB query, an API response, a computed page) under a key with a TTL and serve
// it instantly next time. Each recipe is a SERVER helper: cacheGet<T>(key), cacheSet(key, value, ttlSeconds)
// and cacheDel(key), JSON-serialised so any value round-trips. Provider by deployment:
//   • redis   — a standard Redis over TCP (ioredis; any Redis host). The default.
//   • upstash — Upstash Redis over HTTP (@upstash/redis), for serverless/edge where a TCP socket isn't allowed.
// PURE builders; the generated code is correct and complete — no TODO stubs (the real-features rule). Unit-tested.

export type CacheProvider = 'redis' | 'upstash';

export interface CacheConfig {
  provider: CacheProvider;
  files: Record<string, string>;
  envKeys: string[];
  dependency: { name: string; version: string };
  instructions: string;
}

const ENV_EXAMPLE = '.env.example';

// ── Redis over TCP (ioredis) ─────────────────────────────────────────────────────────────────────────────
const REDIS_SERVER = `import IORedis from 'ioredis';

// Bring-Your-Own Redis — REDIS_URL (e.g. redis://default:password@host:6379). Never hardcode it.
const client = new IORedis(process.env.REDIS_URL as string);

// Read a cached value (JSON-parsed), or null if the key is missing/expired.
export async function cacheGet<T>(key: string): Promise<T | null> {
  const raw = await client.get(key);
  return raw ? (JSON.parse(raw) as T) : null;
}

// Store a value under \`key\` for \`ttlSeconds\` (the value is JSON-serialised so objects round-trip).
export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  await client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
}

// Remove a cached key.
export async function cacheDel(key: string): Promise<void> {
  await client.del(key);
}
`;

// ── Upstash Redis over HTTP (@upstash/redis) ─────────────────────────────────────────────────────────────
const UPSTASH_SERVER = `import { Redis } from '@upstash/redis';

// Bring-Your-Own Upstash Redis — REST URL + token from the Upstash console. HTTP-based, so it works in
// serverless/edge runtimes where a raw TCP socket isn't available. Never hardcode them.
const client = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL as string,
  token: process.env.UPSTASH_REDIS_REST_TOKEN as string,
});

// Read a cached value, or null if the key is missing/expired. (@upstash/redis deserialises JSON for you.)
export async function cacheGet<T>(key: string): Promise<T | null> {
  return (await client.get<T>(key)) ?? null;
}

// Store a value under \`key\` for \`ttlSeconds\`.
export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  await client.set(key, value, { ex: ttlSeconds });
}

// Remove a cached key.
export async function cacheDel(key: string): Promise<void> {
  await client.del(key);
}
`;

const REDIS_INSTRUCTIONS =
  'Redis caching wired (ioredis). Point REDIS_URL at your own Redis (Redis Cloud/Upstash/self-hosted) in .env ' +
  '— NavBharatAI never stores it. Import cacheGet/cacheSet/cacheDel and wrap expensive work: try cacheGet ' +
  'first, else compute + cacheSet with a TTL. Values are JSON-serialised so objects round-trip.';

const UPSTASH_INSTRUCTIONS =
  'Upstash Redis caching wired (HTTP — works in serverless/edge). Paste UPSTASH_REDIS_REST_URL + ' +
  'UPSTASH_REDIS_REST_TOKEN from the Upstash console into .env — NavBharatAI never stores them. Import ' +
  'cacheGet/cacheSet/cacheDel and wrap expensive work: try cacheGet first, else compute + cacheSet with a TTL.';

export function generateCacheIntegration(provider: CacheProvider): CacheConfig {
  if (provider === 'redis') {
    return {
      provider,
      files: {
        'server/lib/cache.ts': REDIS_SERVER,
        [ENV_EXAMPLE]: 'REDIS_URL=\n',
      },
      envKeys: ['REDIS_URL'],
      dependency: { name: 'ioredis', version: '^5' },
      instructions: REDIS_INSTRUCTIONS,
    };
  }
  return {
    provider,
    files: {
      'server/lib/cache.ts': UPSTASH_SERVER,
      [ENV_EXAMPLE]: 'UPSTASH_REDIS_REST_URL=\nUPSTASH_REDIS_REST_TOKEN=\n',
    },
    envKeys: ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
    dependency: { name: '@upstash/redis', version: '^1' },
    instructions: UPSTASH_INSTRUCTIONS,
  };
}

export function isCacheProvider(v: unknown): v is CacheProvider {
  return v === 'redis' || v === 'upstash';
}
