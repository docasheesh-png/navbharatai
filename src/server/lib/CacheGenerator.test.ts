import { describe, it, expect } from 'vitest';
import { generateCacheIntegration, isCacheProvider } from './CacheGenerator';

describe('generateCacheIntegration — Redis (ioredis)', () => {
  const c = generateCacheIntegration('redis');

  it('emits get/set(TTL)/del helpers that JSON-serialise values', () => {
    const server = c.files['server/lib/cache.ts'];
    expect(server).toContain("import IORedis from 'ioredis'");
    expect(server).toContain('export async function cacheGet<T>(key: string)');
    expect(server).toContain('export async function cacheSet(key: string, value: unknown, ttlSeconds: number)');
    expect(server).toContain('export async function cacheDel(key: string)');
    expect(server).toContain("client.set(key, JSON.stringify(value), 'EX', ttlSeconds)"); // TTL set
    expect(server).toContain('JSON.parse(raw)');
    expect(server).toContain('REDIS_URL');
  });

  it('declares REDIS_URL + ioredis dep + honest instructions + blank .env.example', () => {
    expect(c.envKeys).toEqual(['REDIS_URL']);
    expect(c.dependency).toEqual({ name: 'ioredis', version: '^5' });
    expect(c.files['.env.example']).toBe('REDIS_URL=\n');
    expect(c.instructions).toContain('never stores');
  });
});

describe('generateCacheIntegration — Upstash (HTTP)', () => {
  const c = generateCacheIntegration('upstash');

  it('emits an HTTP-based cache with ex TTL, for serverless/edge', () => {
    const server = c.files['server/lib/cache.ts'];
    expect(server).toContain("import { Redis } from '@upstash/redis'");
    expect(server).toContain('client.set(key, value, { ex: ttlSeconds })');
    expect(server).toContain('UPSTASH_REDIS_REST_URL');
    expect(server).toContain('UPSTASH_REDIS_REST_TOKEN');
    expect(c.envKeys).toEqual(['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']);
    expect(c.dependency).toEqual({ name: '@upstash/redis', version: '^1' });
  });
});

describe('.env.example safety + provider guard', () => {
  it('.env.example carries NO real values (blank RHS only) for both providers', () => {
    for (const p of ['redis', 'upstash'] as const) {
      const env = generateCacheIntegration(p).files['.env.example'];
      for (const line of env.split('\n').filter(Boolean)) expect(line).toMatch(/=$/);
    }
  });

  it('isCacheProvider accepts the two supported providers, rejects everything else', () => {
    expect(isCacheProvider('redis')).toBe(true);
    expect(isCacheProvider('upstash')).toBe(true);
    expect(isCacheProvider('dynamodb')).toBe(false);
    expect(isCacheProvider(undefined)).toBe(false);
  });
});
