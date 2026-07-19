import { describe, it, expect } from 'vitest';
import { generateRateLimitIntegration, isRateLimitStore } from './RateLimitGenerator';

describe('generateRateLimitIntegration — memory store', () => {
  const c = generateRateLimitIntegration('memory');

  it('emits an express-rate-limit middleware with standard headers and no infra', () => {
    const server = c.files['server/lib/rateLimit.ts'];
    expect(server).toContain("import rateLimit from 'express-rate-limit'");
    expect(server).toContain('export const apiLimiter = rateLimit({');
    expect(server).toContain('standardHeaders: true');
    expect(server).toContain('legacyHeaders: false');
    expect(server).not.toContain('RedisStore'); // memory store pulls in no Redis
  });

  it('needs no env keys, only the express-rate-limit dependency, no .env.example', () => {
    expect(c.envKeys).toEqual([]);
    expect(c.dependencies).toEqual([{ name: 'express-rate-limit', version: '^7' }]);
    expect(c.files['.env.example']).toBeUndefined();
    expect(c.instructions).toContain('single instance');
  });
});

describe('generateRateLimitIntegration — redis store (distributed)', () => {
  const c = generateRateLimitIntegration('redis');

  it('emits a Redis-backed store sharing the counter across instances', () => {
    const server = c.files['server/lib/rateLimit.ts'];
    expect(server).toContain("import { RedisStore } from 'rate-limit-redis'");
    expect(server).toContain("import IORedis from 'ioredis'");
    expect(server).toContain('store: new RedisStore(');
    expect(server).toContain('sendCommand: (...args: string[]) => client.call(...args)');
    expect(server).toContain('REDIS_URL');
  });

  it('declares REDIS_URL + all three deps + blank .env.example + honest instructions', () => {
    expect(c.envKeys).toEqual(['REDIS_URL']);
    expect(c.dependencies).toEqual([
      { name: 'express-rate-limit', version: '^7' },
      { name: 'rate-limit-redis', version: '^4' },
      { name: 'ioredis', version: '^5' },
    ]);
    expect(c.files['.env.example']).toBe('REDIS_URL=\n');
    expect(c.instructions).toContain('never stores');
    expect(c.instructions).toContain('horizontally scaled');
  });

  it('.env.example carries NO real value (blank RHS only)', () => {
    for (const line of c.files['.env.example'].split('\n').filter(Boolean)) expect(line).toMatch(/=$/);
  });
});

describe('isRateLimitStore — guard', () => {
  it('accepts the two supported stores, rejects everything else', () => {
    expect(isRateLimitStore('memory')).toBe(true);
    expect(isRateLimitStore('redis')).toBe(true);
    expect(isRateLimitStore('memcached')).toBe(false);
    expect(isRateLimitStore(undefined)).toBe(false);
  });
});
