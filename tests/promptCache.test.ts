import { describe, it, expect } from 'vitest';
import { TTLCache, hashKey, chatCacheEnabled } from '../src/server/AgentV3/PromptCache';

/** P-PE.1 — prompt/response cache (pure TTL+LRU). */

describe('PromptCache — TTLCache TTL', () => {
  it('returns a stored value before expiry, undefined after', () => {
    const c = new TTLCache<string>(10, 1000);
    c.set('k', 'v', 0);
    expect(c.get('k', 500)).toBe('v');
    expect(c.get('k', 1000)).toBeUndefined(); // expiresAt is exclusive (<= now → expired)
    expect(c.get('k', 1500)).toBeUndefined();
  });

  it('miss returns undefined', () => {
    const c = new TTLCache<string>();
    expect(c.get('nope')).toBeUndefined();
  });

  it('purges an expired entry on read (size shrinks)', () => {
    const c = new TTLCache<string>(10, 100);
    c.set('a', '1', 0);
    expect(c.size).toBe(1);
    expect(c.get('a', 200)).toBeUndefined();
    expect(c.size).toBe(0);
  });
});

describe('PromptCache — TTLCache LRU eviction', () => {
  it('evicts the oldest when over capacity', () => {
    const c = new TTLCache<string>(2, 10_000);
    c.set('a', '1', 0);
    c.set('b', '2', 0);
    c.set('c', '3', 0); // exceeds cap 2 → 'a' (oldest) evicted
    expect(c.get('a', 1)).toBeUndefined();
    expect(c.get('b', 1)).toBe('2');
    expect(c.get('c', 1)).toBe('3');
    expect(c.size).toBe(2);
  });

  it('a get refreshes recency so a later set evicts a different key', () => {
    const c = new TTLCache<string>(2, 10_000);
    c.set('a', '1', 0);
    c.set('b', '2', 0);
    c.get('a', 1); // 'a' now newest, 'b' oldest
    c.set('c', '3', 1); // evicts 'b'
    expect(c.get('b', 2)).toBeUndefined();
    expect(c.get('a', 2)).toBe('1');
    expect(c.get('c', 2)).toBe('3');
  });

  it('re-setting a key updates value without growing size', () => {
    const c = new TTLCache<string>(2, 10_000);
    c.set('a', '1', 0);
    c.set('a', '2', 0);
    expect(c.get('a', 1)).toBe('2');
    expect(c.size).toBe(1);
  });
});

describe('PromptCache — hashKey', () => {
  it('is deterministic and order-sensitive', () => {
    expect(hashKey(['chat', 'hello'])).toBe(hashKey(['chat', 'hello']));
    expect(hashKey(['chat', 'hello'])).not.toBe(hashKey(['hello', 'chat']));
  });
  it('differs for different content', () => {
    expect(hashKey(['chat', 'hi'])).not.toBe(hashKey(['chat', 'bye']));
  });
  it('produces an 8-char hex string', () => {
    expect(hashKey(['anything'])).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('PromptCache — chatCacheEnabled', () => {
  it('is on by default, off only when explicitly disabled', () => {
    const prev = process.env.AGENTV3_CHAT_CACHE;
    delete process.env.AGENTV3_CHAT_CACHE;
    expect(chatCacheEnabled()).toBe(true);
    process.env.AGENTV3_CHAT_CACHE = 'off';
    expect(chatCacheEnabled()).toBe(false);
    if (prev === undefined) delete process.env.AGENTV3_CHAT_CACHE;
    else process.env.AGENTV3_CHAT_CACHE = prev;
  });
});
