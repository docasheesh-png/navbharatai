/**
 * Admin 2026-11-03: "ek audit scan chalao. dekho ham kon kon se api call kar rahe hai … admin ko sabhi platform par
 * balance maintain kar ke rakhna hoga … one click par, dekh len kon se api provider ka balance low/khatam hai".
 *
 * Two things are locked here:
 *   1. THE AUDIT IS PERMANENT. Every `*_API_KEY` the AI routing code reads is either in the API provider directory
 *      (so the admin sees its billing link) or exempted below with a reason. A new paid provider wired in without a
 *      billing link fails this census — the list cannot quietly go stale the way a hand-kept list does.
 *   2. NOTHING IS FAKED. A live balance comes only from a provider's own balance API; a failure is a failure with
 *      our own sentence; a provider without a balance API is "manual", never "ok"; no key value ever leaves.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { API_PROVIDERS, levelOf, lowBalanceThresholdUsd, readApiProviderDirectory } from '../src/server/lib/apiProviderDirectory';
import { isApiProviderDirectory, sortProvidersForAttention } from '../src/lib/apiProvidersView';

/** The code that chooses and calls AI providers for NavBharatAI itself (not the apps it generates). */
const ROUTING_SOURCES = ['src/server/routes/agentv3.ts', 'src/server/AI', 'src/server/AgentV3/providers', 'server.ts'];

/** Keys that are read there but are not a separately billed account. Each says why. */
const EXEMPT: Readonly<Record<string, string>> = {};

function files(p: string): string[] {
  if (statSync(p).isFile()) return [p];
  return readdirSync(p).flatMap((n) => files(join(p, n)));
}

describe('🔒 the audit: every API key the routing code reads has a billing link', () => {
  const read = new Set<string>();
  for (const src of ROUTING_SOURCES) for (const f of files(src)) {
    if (!f.endsWith('.ts') || /\.test\.ts$/.test(f)) continue;
    for (const m of readFileSync(f, 'utf8').matchAll(/\b([A-Z][A-Z0-9_]*_API_KEY)\b/g)) read.add(m[1]);
  }
  const listed = new Set(API_PROVIDERS.flatMap((p) => p.envKeys));

  it('the scan found the keys (a scan that finds nothing proves nothing)', () => {
    expect(read.size).toBeGreaterThan(15);
  });
  it('each key is in the directory or exempted with a reason', () => {
    const missing = [...read].filter((k) => !listed.has(k) && !(k in EXEMPT)).sort();
    expect(missing, `add these to API_PROVIDERS (src/server/lib/apiProviderDirectory.ts) or EXEMPT with a reason`).toEqual([]);
  });
  it('every provider has a unique id, a name, and an https billing link or an honest null', () => {
    const ids = API_PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of API_PROVIDERS) {
      expect(p.name.length).toBeGreaterThan(1);
      expect(p.envKeys.length).toBeGreaterThan(0);
      expect(p.usedFor.length, `${p.id} must say where it is used`).toBeGreaterThan(0);
      if (p.billingUrl !== null) expect(new URL(p.billingUrl).protocol).toBe('https:');
      else expect(p.billingHint.length).toBeGreaterThan(10);
    }
  });
  it('the admin’s own list of 30 is all here', () => {
    expect(API_PROVIDERS.length).toBeGreaterThanOrEqual(30);
  });
});

type Reply = { status: number; body: unknown } | 'timeout';
function fakeFetch(replies: Record<string, Reply>) {
  const calls: Array<{ url: string; auth: string }> = [];
  const f = async (url: string, init: { headers: Record<string, string> }) => {
    calls.push({ url, auth: init.headers.Authorization });
    const r = replies[url];
    if (!r || r === 'timeout') throw new Error('network');
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
  };
  return { f, calls };
}
const SECRET = 'sk-synthetic-secret-value-123';

describe('🔴 nothing is faked: live, failed, manual and not-set are four different answers', () => {
  it('OpenRouter, DeepSeek and Moonshot are read from their own balance APIs and graded', async () => {
    const { f, calls } = fakeFetch({
      'https://openrouter.ai/api/v1/credits': { status: 200, body: { data: { total_credits: 20, total_usage: 17.5 } } },
      'https://api.deepseek.com/user/balance': { status: 200, body: { is_available: true, balance_infos: [{ currency: 'USD', total_balance: '0.00' }] } },
      'https://api.moonshot.ai/v1/users/me/balance': { status: 200, body: { code: 0, data: { available_balance: 42.1 } } },
    });
    const d = await readApiProviderDirectory({ env: { OPENROUTER_API_KEY: SECRET, DEEPSEEK_API_KEY: SECRET, KIMI_API_KEY: SECRET }, fetchImpl: f as any, now: () => 1 });
    const by = (id: string) => d.rows.find((r) => r.id === id)!;
    expect(by('openrouter').balance).toMatchObject({ kind: 'live', amount: 2.5, currency: 'USD', level: 'low' });
    expect(by('deepseek').balance).toMatchObject({ kind: 'live', amount: 0, level: 'empty' });
    expect(by('kimi').balance).toMatchObject({ kind: 'live', amount: 42.1, level: 'ok' });
    expect(d.counts).toMatchObject({ live: 3, low: 1, empty: 1 });
    expect(calls.every((c) => c.auth === `Bearer ${SECRET}`)).toBe(true);
  });

  it('a refused or silent balance API is a failure with our own sentence, never a number', async () => {
    const { f } = fakeFetch({ 'https://openrouter.ai/api/v1/credits': { status: 401, body: { error: SECRET } }, 'https://api.deepseek.com/user/balance': 'timeout' });
    const d = await readApiProviderDirectory({ env: { OPENROUTER_API_KEY: SECRET, DEEPSEEK_API_KEY: SECRET }, fetchImpl: f as any });
    expect(d.rows.find((r) => r.id === 'openrouter')!.balance).toMatchObject({ kind: 'failed', reason: expect.stringContaining('HTTP 401') });
    expect(d.rows.find((r) => r.id === 'deepseek')!.balance).toMatchObject({ kind: 'failed' });
  });

  it('an answer in an unknown shape is a failure, not a zero', async () => {
    const { f } = fakeFetch({ 'https://openrouter.ai/api/v1/credits': { status: 200, body: { credits: 'lots' } } });
    const d = await readApiProviderDirectory({ env: { OPENROUTER_API_KEY: SECRET }, fetchImpl: f as any });
    expect(d.rows.find((r) => r.id === 'openrouter')!.balance.kind).toBe('failed');
  });

  it('a provider without a balance API is "manual", never "ok"; an unset key is "not configured"', async () => {
    const { f, calls } = fakeFetch({});
    const d = await readApiProviderDirectory({ env: { SURPLUS_API_KEY: SECRET }, fetchImpl: f as any });
    expect(d.rows.find((r) => r.id === 'surplus')!.balance.kind).toBe('manual');
    expect(d.rows.find((r) => r.id === 'groq')!.balance.kind).toBe('not_configured');
    expect(calls).toEqual([]); // nothing is called for a provider with no balance API
  });

  it('Mitrify is visible to operators without an invented billing link or balance API', async () => {
    const { f, calls } = fakeFetch({});
    const d = await readApiProviderDirectory({ env: { MITRIFY_API_KEY: SECRET }, fetchImpl: f as any });
    expect(d.rows.find(r => r.id === 'mitrify')).toMatchObject({ billingUrl: null, balance: { kind: 'manual' } });
    expect(calls).toEqual([]); expect(JSON.stringify(d)).not.toContain(SECRET);
  });

  it('Kimi on a non-Moonshot endpoint is not asked (it has no balance API) and says why', async () => {
    const { f, calls } = fakeFetch({});
    const d = await readApiProviderDirectory({ env: { KIMI_API_KEY: SECRET, KIMI_BASE_URL: 'https://api.kimi.com/coding/v1' }, fetchImpl: f as any });
    expect(d.rows.find((r) => r.id === 'kimi')!.balance).toMatchObject({ kind: 'failed', reason: expect.stringContaining('KIMI_BASE_URL') });
    expect(calls).toEqual([]);
  });

  it('🔒 no key value appears anywhere in the answer — only key NAMES', async () => {
    const { f } = fakeFetch({ 'https://openrouter.ai/api/v1/credits': { status: 500, body: { echo: SECRET } } });
    const env = Object.fromEntries(API_PROVIDERS.flatMap((p) => p.envKeys).map((k) => [k, SECRET]));
    const d = await readApiProviderDirectory({ env, fetchImpl: f as any });
    expect(JSON.stringify(d)).not.toContain(SECRET);
    expect(d.rows.find((r) => r.id === 'openrouter')!.configuredKeys).toEqual(['OPENROUTER_API_KEY', 'NEMOTRON_API_KEY']);
  });

  it('the custom image provider’s link follows IMAGE_PROVIDER, and an unknown one says so', async () => {
    const d1 = await readApiProviderDirectory({ env: { IMAGE_API_KEY: SECRET, IMAGE_PROVIDER: 'stability' } });
    expect(d1.rows.find((r) => r.id === 'custom-image')!.billingUrl).toBe('https://platform.stability.ai/account/credits');
    const d2 = await readApiProviderDirectory({ env: { IMAGE_API_KEY: SECRET } });
    expect(d2.rows.find((r) => r.id === 'custom-image')!.billingUrl).toBeNull();
  });

  it('the low threshold is configurable and grading is honest at the edges', () => {
    expect(lowBalanceThresholdUsd({})).toBe(5);
    expect(lowBalanceThresholdUsd({ ADMIN_PROVIDER_LOW_BALANCE_USD: '20' })).toBe(20);
    expect(lowBalanceThresholdUsd({ ADMIN_PROVIDER_LOW_BALANCE_USD: 'abc' })).toBe(5);
    expect(lowBalanceThresholdUsd({ ADMIN_PROVIDER_LOW_BALANCE_USD: '  ' })).toBe(5); // a cleared field is not a $0 threshold
    expect(lowBalanceThresholdUsd({ ADMIN_PROVIDER_LOW_BALANCE_USD: '0' })).toBe(0);
    expect(levelOf(0, 5)).toBe('empty');
    expect(levelOf(-1, 5)).toBe('empty');
    expect(levelOf(4.99, 5)).toBe('low');
    expect(levelOf(5, 5)).toBe('ok');
  });
});

describe('the screen: a checked body, and attention first', () => {
  it('the real server answer passes the shape check; a broken one does not', async () => {
    // What the route sends: the directory plus the admin's recorded logins (apiProvidersAdmin.ts).
    const dir = await readApiProviderDirectory({ env: {} });
    const d = { ...dir, rows: dir.rows.map((r) => ({ ...r, accountEmail: r.id === 'glm' ? 'owner@example.com' : null })), accountsAvailable: true };
    expect(isApiProviderDirectory(JSON.parse(JSON.stringify(d)))).toBe(true);
    expect(isApiProviderDirectory(JSON.parse(JSON.stringify(dir)))).toBe(false); // the raw directory lacks the login fields
    expect(isApiProviderDirectory({ rows: 'x' })).toBe(false);
    const bad = JSON.parse(JSON.stringify(d)); bad.rows[0].billingUrl = 'javascript:alert(1)';
    expect(isApiProviderDirectory(bad)).toBe(false);
  });
  it('empty, low, failed and manual rows come before healthy and unset ones', () => {
    const row = (id: string, balance: any) => ({ id, name: id, group: 'ai' as const, configured: true, configuredKeys: [], usedFor: [], accountEmail: null, billingUrl: null, billingHint: 'x', balance });
    const sorted = sortProvidersForAttention([
      row('unset', { kind: 'not_configured' }), row('ok', { kind: 'live', amount: 50, currency: 'USD', level: 'ok', checkedAt: 1 }),
      row('manual', { kind: 'manual', reason: 'x' }), row('failed', { kind: 'failed', reason: 'x', checkedAt: 1 }),
      row('low', { kind: 'live', amount: 1, currency: 'USD', level: 'low', checkedAt: 1 }), row('empty', { kind: 'live', amount: 0, currency: 'USD', level: 'empty', checkedAt: 1 }),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(['empty', 'low', 'failed', 'manual', 'ok', 'unset']);
  });
});
