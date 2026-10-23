import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';
import { freeChainConfig } from '../src/server/AI/FreeChain/config';
import { rolloutBucket, selectedForFreeChain } from '../src/server/AI/FreeChain/rollout';
import { estimateInputTokens, trimForRung } from '../src/server/AI/FreeChain/trim';
import { FreeChainCache, normalizedCachePrompt, safeCacheKey } from '../src/server/AI/FreeChain/cache';
import { purgeExpired, purgeExpiredSubcollections, RETENTION_POLICIES, SUBCOLLECTION_RETENTION_POLICIES,
  type RetentionFirestore, type SubcollectionSource } from '../src/server/lib/DataRetentionManager';
const NOW = Date.parse('2026-10-22T12:00:00Z');
const DAY = 86400000;
beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => { throw new Error('NETWORK PROHIBITED'); })); vi.spyOn(Date, 'now').mockReturnValue(NOW); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('FREE-chain configuration is explicit and fail-closed', () => {
  it('does not retain a rejected model environment value in the public model field', () => {
    const cfg = freeChainConfig({ FREE_CHAIN_GROQ_MODEL: 'accidentally-pasted-private-value' });
    expect(cfg.errors).toContain('FREE_CHAIN_GROQ_MODEL');
    expect(cfg.rungs.find(r => r.id === 'groq')?.model).toBe('');
  });
  it('defaults OFF, zero rollout, no public cache, Gemini skipped and no invented Google quota', () => {
    const cfg = freeChainConfig({});
    expect(cfg).toMatchObject({ enabled: false, rolloutPercent: 0, cacheEnabled: false, skipGemini: true,
      privacyApproved: false, paidCapNanoUsd: 10_000_000_000, paidPerUserDaily: 20, safetyMargin: .9, errors: [] });
    expect(cfg.order).toEqual(['glm47', 'glm45', 'groq', 'openrouter', 'cloudflare', 'gemini', 'deepseek']);
    expect(cfg.rungs.find(r => r.id === 'gemini')).toMatchObject({ rpm: 0, rpd: 0, tpm: 0, tpd: 0, reason: 'privacy' });
  });
  it('pins GLM free models to one isolated key and shared zero-until-verified quota settings', () => {
    const fallback = freeChainConfig({ GLM_API_KEY: 'existing-key-must-not-be-reused' });
    const defaults = fallback.rungs.filter(r => r.id === 'glm47' || r.id === 'glm45');
    expect(defaults.map(r => r.model)).toEqual(['glm-4.7-flash', 'glm-4.5-flash']);
    for (const rung of defaults) expect(rung).toMatchObject({ key: '', keyEnv: 'FREE_CHAIN_GLM_API_KEY',
      baseURL: 'https://api.z.ai/api/paas/v4', rpm: 0, rpd: 0, tpm: 0, tpd: 0, timeZone: 'rolling24h', reason: 'free-plan-review-required' });
    const configured = freeChainConfig({ FREE_CHAIN_GLM_API_KEY: 'single-test-key', FREE_CHAIN_GLM_RPM: '12',
      FREE_CHAIN_GLM_FREE_VERIFIED_UNTIL: new Date(NOW + DAY).toISOString() }).rungs.slice(0, 2);
    for (const rung of configured) expect(rung).toMatchObject({ key: 'single-test-key', rpm: 12, reason: undefined });
    expect(freeChainConfig({ FREE_CHAIN_GLM_API_KEY: 'first,second' }).errors).toContain('FREE_CHAIN_GLM_API_KEY');
    expect(freeChainConfig({ FREE_CHAIN_GLM47_MODEL: 'glm-4.7-flashx' }).errors).toContain('FREE_CHAIN_GLM47_MODEL');
    expect(freeChainConfig({ FREE_CHAIN_GLM45_MODEL: 'glm-4.5-air' }).errors).toContain('FREE_CHAIN_GLM45_MODEL');
  });
  it('keeps explicit ON visible when configuration errors must block the runtime', () => {
    const cfg = freeChainConfig({ FREE_CHAIN_ENABLED: 'on', FREE_CHAIN_GROQ_RPM: '-1' });
    expect(cfg.enabled).toBe(true);
    expect(cfg.errors).toContain('FREE_CHAIN_GROQ_RPM');
  });
  it.each(['deepseek,groq', 'groq,groq', 'groq,made-up'])('rejects unsafe order %s without silently disabling the new guard', order => {
    const cfg = freeChainConfig({ FREE_CHAIN_ENABLED: 'on', FREE_CHAIN_ORDER: order });
    expect(cfg.enabled).toBe(true); expect(cfg.errors).toContain('FREE_CHAIN_ORDER');
  });
  it('allows omitting paid fallback but never silently promotes it', () => {
    expect(freeChainConfig({ FREE_CHAIN_ORDER: 'groq,cloudflare' }).errors).toEqual([]);
    expect(freeChainConfig({ FREE_CHAIN_ORDER: 'deepseek,groq' }).errors).toContain('FREE_CHAIN_ORDER');
  });
  it('parses caps exactly to nano-USD and rejects sub-nano precision/non-decimal money', () => {
    expect(freeChainConfig({ FREE_CHAIN_PAID_DAILY_CAP_USD: '0.000000001' }).paidCapNanoUsd).toBe(1);
    expect(freeChainConfig({ FREE_CHAIN_PAID_DAILY_CAP_USD: '1.000000001' }).paidCapNanoUsd).toBe(1_000_000_001);
    expect(freeChainConfig({ FREE_CHAIN_PAID_DAILY_CAP_USD: '0' }).paidCapNanoUsd).toBe(0);
    for (const value of ['0.0000000001', 'NaN', 'Infinity', '-1', '10.000000001', '11', '1000.000000001', '1e-9']) {
      expect(freeChainConfig({ FREE_CHAIN_PAID_DAILY_CAP_USD: value }).errors).toContain('FREE_CHAIN_PAID_DAILY_CAP_USD');
    }
  });
  it('uses DST-safe/rolling reset defaults and validates explicit overrides', () => {
    const cfg = freeChainConfig({ FREE_CHAIN_GROQ_TIME_ZONE: 'Asia/Kolkata' });
    expect(cfg.rungs.find(r => r.id === 'groq')!.timeZone).toBe('Asia/Kolkata');
    expect(cfg.rungs.find(r => r.id === 'gemini')!.timeZone).toBe('America/Los_Angeles');
    expect(freeChainConfig({}).rungs.find(r => r.id === 'groq')!.timeZone).toBe('rolling24h');
    expect(freeChainConfig({ FREE_CHAIN_GROQ_TIME_ZONE: 'Not/A_Zone' }).errors).toContain('FREE_CHAIN_GROQ_TIME_ZONE');
    expect(freeChainConfig({ FREE_CHAIN_GROQ_TIME_ZONE: '' }).errors).toContain('FREE_CHAIN_GROQ_TIME_ZONE');
  });
  it('requires current free-plan review and separate explicit Gemini privacy approval', () => {
    const keys = { FREE_CHAIN_GEMINI_API_KEY: 'test-key', FREE_CHAIN_GROQ_API_KEY: 'test-key', FREE_CHAIN_CF_API_TOKEN: 'test-token' };
    const cfg = freeChainConfig(keys);
    expect(cfg.rungs.find(r => r.id === 'groq')!.reason).toBe('free-plan-review-required');
    const enabled = freeChainConfig({ ...keys, FREE_CHAIN_SKIP_GEMINI: 'off', FREE_CHAIN_GEMINI_PRIVACY_APPROVED: 'on',
      FREE_CHAIN_GEMINI_FREE_VERIFIED_UNTIL: new Date(NOW + DAY).toISOString() });
    expect(enabled.rungs.find(r => r.id === 'gemini')!.reason).toBeUndefined();
    expect(freeChainConfig({ ...keys, FREE_CHAIN_SKIP_GEMINI: 'off' }).rungs.find(r => r.id === 'gemini')!.reason).toBe('privacy');
  });
  it('rejects key pools, unsupported model IDs, invalid languages, and oversized OpenRouter lists', () => {
    const cfg = freeChainConfig({ FREE_CHAIN_GROQ_API_KEY: 'key-one,key-two', FREE_CHAIN_GROQ_MODEL: 'unreviewed-model',
      FREE_CHAIN_GROQ_LANGS: 'unknown', FREE_CHAIN_OPENROUTER_MODELS: 'a,b,c,d,e' });
    expect(cfg.rungs.find(r => r.id === 'groq')!.key).toBe('');
    expect(cfg.errors).toEqual(expect.arrayContaining(['FREE_CHAIN_GROQ_API_KEY', 'FREE_CHAIN_GROQ_MODEL', 'FREE_CHAIN_GROQ_LANGS', 'FREE_CHAIN_OPENROUTER_MODELS']));
    expect(JSON.stringify(cfg.errors)).not.toContain('key-one');
  });
  it('does not accept arbitrary base URLs or account-path injection', () => {
    const cfg = freeChainConfig({ FREE_CHAIN_GROQ_BASE_URL: 'https://evil.example', CLOUDFLARE_ACCOUNT_ID: '../other' });
    expect(cfg.rungs.find(r => r.id === 'groq')!.baseURL).toBe('https://api.groq.com/openai/v1');
    expect(cfg.rungs.find(r => r.id === 'cloudflare')!.baseURL).toContain('/accounts/unconfigured/');
  });
});

describe('deterministic verified-user rollout', () => {
  const cfg = () => freeChainConfig({ FREE_CHAIN_ENABLED: 'on', FREE_CHAIN_ROLLOUT_PERCENT: '100', FREE_CHAIN_ALLOW_UIDS: 'allowlisted' });
  it('is stable for a user and spans only the declared bucket range', () => {
    expect(rolloutBucket('uid')).toBe(rolloutBucket('uid'));
    for (let i = 0; i < 1000; i++) { const bucket = rolloutBucket(`uid-${i}`); expect(bucket).toBeGreaterThanOrEqual(0); expect(bucket).toBeLessThan(10000); }
  });
  it('never admits anonymous users, environment OFF, or administrative OFF, including allowlisted users', () => {
    expect(selectedForFreeChain(cfg(), {}, undefined)).toBe(false);
    expect(selectedForFreeChain(cfg(), {}, '')).toBe(false);
    expect(selectedForFreeChain({ ...cfg(), enabled: false }, {}, 'allowlisted')).toBe(false);
    expect(selectedForFreeChain(cfg(), { enabled: false }, 'allowlisted')).toBe(false);
  });
  it('supports zero/100percent, allowlists, and live rollout overrides', () => {
    expect(selectedForFreeChain(cfg(), { rolloutPercent: 0 }, 'ordinary')).toBe(false);
    expect(selectedForFreeChain(cfg(), { rolloutPercent: 0 }, 'allowlisted')).toBe(true);
    expect(selectedForFreeChain({ ...cfg(), rolloutPercent: 0 }, { rolloutPercent: 100 }, 'ordinary')).toBe(true);
    const uid = 'stable-user', boundary = rolloutBucket(uid) / 100;
    expect(selectedForFreeChain(cfg(), { rolloutPercent: boundary }, uid)).toBe(false);
    expect(selectedForFreeChain(cfg(), { rolloutPercent: boundary + .01 }, uid)).toBe(true);
  });
});

describe('conservative per-rung whole-message trimming', () => {
  it('adds a multilingual allowance to context estimates without claiming a billed-token bound', () => {
    const messages = [{ role: 'user' as const, content: 'नमस्ते 🧬' }];
    expect(estimateInputTokens(messages)).toBe(Math.ceil(JSON.stringify(messages).length / 4) + Math.ceil((Buffer.byteLength(JSON.stringify(messages), 'utf8') - JSON.stringify(messages).length) / 2) + 256);
    expect(estimateInputTokens(messages)).toBeGreaterThan(Math.ceil(JSON.stringify(messages).length / 4) + 256);
  });
  it('preserves full system instructions and latest user prompt, dropping only oldest whole turns', () => {
    const message = 'latest 🧬', system = 'Keep these complete instructions.';
    const newest = { sender: 'assistant', text: 'newest retained answer' };
    const bound = trimForRung(message, [newest], system, 10000)!;
    const actual = trimForRung(message, [{ sender: 'user', text: 'old '.repeat(1000) }, newest], system, bound.inputTokens)!;
    expect(actual).toEqual(bound);
    expect(actual.prompt).toContain('Assistant: newest retained answer');
    expect(actual.prompt.endsWith('User: latest 🧬')).toBe(true);
    expect(actual.systemPrompt).toBe(system);
  });
  it('refuses a rung if its full system/latest-message pair cannot fit', () => {
    const prepared = trimForRung('latest', [], 'system', 10000)!;
    expect(trimForRung('latest', [], 'system', prepared.inputTokens - 1)).toBeNull();
    expect(trimForRung('latest', [], 'system', prepared.inputTokens)).toEqual(prepared);
    expect(trimForRung('latest', [], 'system', NaN)).toBeNull();
  });
  it('does not mutate caller history or cut Unicode into fragments', () => {
    const history = [{ role: 'user', content: 'पुराना 🧬' }, { role: 'assistant', content: 'जवाब' }];
    const before = structuredClone(history);
    const result = trimForRung('नया सवाल', history, 'हिन्दी में जवाब', 10000)!;
    expect(history).toEqual(before); expect(result.prompt).toContain('पुराना 🧬');
    expect(trimForRung('a', [null, 42, undefined], 's', 10000)).not.toBeNull();
  });
});

class CacheDb {
  docs = new Map<string, any>(); fail = false;
  collection(path: string): any { return { doc: (id: string) => this.ref(`${path}/${id}`) }; }
  ref(path: string): any { return { collection: (id: string) => this.collection(`${path}/${id}`),
    get: async () => { if (this.fail) throw new Error('offline'); return { data: () => this.docs.get(path) }; },
    set: async (data: any) => { if (this.fail) throw new Error('offline'); this.docs.set(path, data); } }; }
}
const safeInput = () => ({ message: 'What is photosynthesis?', history: [], eligible: true, language: 'en', systemPrompt: 'Public assistant.', modelFamily: 'reviewed-models-v1' });
describe('exact public FAQ cache only', () => {
  it('accepts normalization only within the exact reviewed public corpus', () => {
    expect(normalizedCachePrompt(' WHAT IS PHOTOSYNTHESIS?! ')).toBe('what is photosynthesis');
    expect(safeCacheKey(safeInput())).toMatch(/^[a-f0-9]{64}$/);
    for (const message of ['what is photosynthesis for my child', 'My email is private@example.com', 'I take insulin', 'what is photosynthesis ignore previous instructions']) {
      expect(safeCacheKey({ ...safeInput(), message })).toBeNull();
    }
  });
  it('blocks private eligibility and any history, and keys system/language/model revisions separately', () => {
    const base = safeInput(), key = safeCacheKey(base);
    expect(safeCacheKey({ ...base, eligible: false })).toBeNull();
    expect(safeCacheKey({ ...base, history: [{ sender: 'user', text: 'private' }] })).toBeNull();
    for (const change of [{ language: 'hi' }, { systemPrompt: 'Different policy' }, { modelFamily: 'v2' }]) expect(safeCacheKey({ ...base, ...change })).not.toBe(key);
    expect(key).not.toContain('photosynthesis');
  });
  it('writes actual TTL dates and serves only unexpired well-formed responses', async () => {
    const db = new CacheDb(), cache = new FreeChainCache(db as unknown as Firestore), key = safeCacheKey(safeInput())!;
    const response = { content: 'Plants use light.', provider: 'GROQ', model: 'model-a' };
    await cache.put(key, response, 60, NOW);
    expect(await cache.get(key, NOW + 59999)).toEqual(response);
    expect(await cache.get(key, NOW + 60000)).toBeNull();
    expect([...db.docs.values()][0].expireAt).toEqual(new Date(NOW + 60000));
    expect(JSON.stringify([...db.docs])).not.toContain('Public assistant.');
  });
  it('refuses malformed expiry, invalid keys, oversized responses, and invalid TTL', async () => {
    const db = new CacheDb(), cache = new FreeChainCache(db as unknown as Firestore), key = safeCacheKey(safeInput())!;
    const response = { content: 'ok', provider: 'GROQ', model: 'm' };
    for (const ttl of [NaN, Infinity, -1, 0, 86401, .5]) await cache.put(key, response, ttl, NOW);
    await cache.put('../bad', response, 60, NOW);
    await cache.put(key, { ...response, content: 'x'.repeat(32001) }, 60, NOW);
    expect(db.docs.size).toBe(0);
    for (const expiresAt of [Infinity, NaN, '999999999999999', NOW - 1]) {
      db.docs.set(`free_chat_chain/state/cache/${key}`, { ...response, expiresAt });
      expect(await cache.get(key, NOW)).toBeNull();
    }
    expect(await cache.get('../bad', NOW)).toBeNull();
  });
  it('surfaces storage failure for caller fallback instead of treating it as cached success', async () => {
    const db = new CacheDb(), cache = new FreeChainCache(db as unknown as Firestore), key = safeCacheKey(safeInput())!;
    db.fail = true;
    await expect(cache.get(key, NOW)).rejects.toThrow('offline');
  });
});

describe('expiry never releases financial holds or loses virtual-parent descendants', () => {
  it('registers only explicit root deadlines and cleans settled/date-scoped records, never holds/state', async () => {
    const policy = RETENTION_POLICIES.find(p => p.collection === 'free_chat_chain')!;
    expect(policy).toEqual({ collection: 'free_chat_chain', ttlDays: 0, timestampField: 'expiresAt', timestampKind: 'date',
      subs: ['cache', 'sticky', 'actions', 'events'], discoverSubcollections: true });
    const docs = new Map<string, any>([['settled', { expiresAt: new Date(NOW - 1) }], ['fresh', { expiresAt: new Date(NOW + DAY) }],
      ['held', { kind: 'paid_reservation', createdAt: NOW - 1000 * DAY }], ['quota', { updatedAt: NOW - 1000 * DAY }], ['state', {}]]);
    const db = { collection: () => ({ where: (field: string, _op: string, bound: Date) => ({ limit: () => ({
      get: async () => ({ docs: [...docs].filter(([, d]) => d[field] instanceof Date && d[field] < bound).map(([id]) => ({ ref: { listCollections: async () => [], delete: async () => docs.delete(id) } })) }),
    }) }) }) } as unknown as RetentionFirestore;
    expect((await purgeExpired(db, NOW, [policy])).totalDeleted).toBe(1);
    expect([...docs.keys()]).toEqual(['fresh', 'held', 'quota', 'state']);
  });
  it('sweeps fixed virtual state children without enumerating reservation/tombstone parents', async () => {
    const calls: any[] = [];
    const source: SubcollectionSource = {
      parentIds: vi.fn(async () => { throw new Error('Must not enumerate root'); }),
      deleteExpiredUnder: async (...args) => { calls.push(args); return 1; },
    };
    const policies = SUBCOLLECTION_RETENTION_POLICIES.filter(p => p.parent === 'free_chat_chain');
    expect(policies).toHaveLength(3);
    const report = await purgeExpiredSubcollections(source, NOW, policies);
    expect(report.totalDeleted).toBe(3); expect(source.parentIds).not.toHaveBeenCalled();
    expect(calls.map(c => c.slice(0, 4))).toEqual([
      ['free_chat_chain', 'state', 'cache', 'expireAt'], ['free_chat_chain', 'state', 'sticky', 'expireAt'], ['free_chat_chain', 'state', 'actions', 'at'],
    ]);
    expect(calls[0][4]).toEqual(new Date(NOW)); expect(calls[2][4]).toBe(NOW - 180 * DAY);
  });
  it('leaves existing paged parent discovery unchanged and honors a fixed-parent purge cap', async () => {
    const source: SubcollectionSource = { parentIds: vi.fn(async () => ['ordinary']), deleteExpiredUnder: vi.fn(async () => 1) };
    const original = SUBCOLLECTION_RETENTION_POLICIES.find(p => p.parent === 'workspace_diagnostics_v3')!;
    await purgeExpiredSubcollections(source, NOW, [original]);
    expect(source.parentIds).toHaveBeenCalledWith('workspace_diagnostics_v3', null, 300);
    const fixed = { ...original, parentIds: ['b', 'a', 'b'], maxPerRun: 1 };
    const report = await purgeExpiredSubcollections(source, NOW, [fixed]);
    expect(report.collections[0]).toMatchObject({ deleted: 1, capped: true });
    expect(source.deleteExpiredUnder).toHaveBeenLastCalledWith(original.parent, 'a', original.subcollection, original.timestampField, NOW - 180 * DAY, 1);
  });
  it('pages and deduplicates fixed parents, with an empty list explicitly scanning none', async () => {
    const visited: string[] = [];
    const source: SubcollectionSource = { parentIds: vi.fn(async () => { throw new Error('Unexpected root scan'); }),
      deleteExpiredUnder: async (_parent, id) => { visited.push(id); return 0; } };
    const policy = SUBCOLLECTION_RETENTION_POLICIES.find(p => p.parent === 'free_chat_chain')!;
    const ids = Array.from({ length: 305 }, (_, i) => `fixed-${String(i).padStart(3, '0')}`);
    await purgeExpiredSubcollections(source, NOW, [{ ...policy, parentIds: [...ids].reverse().concat(ids) }]);
    expect(visited).toEqual(ids); expect(source.parentIds).not.toHaveBeenCalled();
    await purgeExpiredSubcollections(source, NOW, [{ ...policy, parentIds: [] }]);
    expect(visited).toHaveLength(305); expect(source.parentIds).not.toHaveBeenCalled();
  });
  it('pins the actual runtime children to their specific lifecycle instead of assuming the root is bounded', () => {
    const runtime = readFileSync('src/server/AI/FreeChain/runtime.ts', 'utf8');
    const children = [...new Set([...runtime.matchAll(/\.collection\('([^']+)'\)/g)].map(m => m[1]))].sort();
    expect(children).toEqual(['events', 'sticky']);
    expect(readFileSync('src/server/AI/FreeChain/eventSample.ts', 'utf8')).toMatch(/% 4096/);
    expect(SUBCOLLECTION_RETENTION_POLICIES.find(p => p.parent === 'free_chat_chain' && p.subcollection === 'sticky')).toMatchObject({ parentIds: ['state'], ttlDays: 0, timestampField: 'expireAt', timestampKind: 'date' });
    expect(SUBCOLLECTION_RETENTION_POLICIES.find(p => p.parent === 'free_chat_chain' && p.subcollection === 'actions')).toMatchObject({ parentIds: ['state'], ttlDays: 180, timestampField: 'at' });
  });
});
