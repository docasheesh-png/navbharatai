// Free-tier paid leaks (admin 2026-10-23): no gemini-2.5-pro / Grok / Claude on any Free path, one
// bill per Free professional answer, and ONE shared daily $ cap for every Free paid rung outside FreeChain.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  cappedFreeTierRung, freeTierPaidCapNanoUsd, FreeTierPaidCapError, isFreeTierPaidModelAllowed,
  quoteFreeTierPaidNanoUsd, reserveFreeTierPaid, setFreeTierPaidStoreForTests,
} from '../src/server/lib/freeTierPaidCap';
import { freeBusyMessage, isFreeTierUniverse } from '../src/server/lib/freeBusyMessage';
import { geminiVisionModels, glmVisionModels, grokVisionModels, vertexVisionModels } from '../src/server/lib/visionModels';
import { runVisionChain, visionProviderOrder, visionTier } from '../src/server/lib/visionChain';
import { visionProviderChain } from '../src/server/lib/visionDescribe';
import { isProviderHealthFailure } from '../src/server/AI/Router/AIRouter';
import { AIRouterManager } from '../src/server/AI/AIRouterManager';
import type { AIProvider } from '../src/server/AI/Router/ProviderTypes';

const FORBIDDEN = /gemini-[\d.]+-pro|grok|claude/i;
const openStore = () => ({
  reservePaid: vi.fn(async (i: any) => ({ id: 'a'.repeat(64), day: '2026-10-23', uidHash: 'b'.repeat(64), maxCostNanoUsd: i.maxCostNanoUsd, createdAt: 0, mayDispatch: true })),
  settlePaid: vi.fn(async () => true),
});
const closedStore = () => ({ reservePaid: vi.fn(async () => null), settlePaid: vi.fn(async () => true) });

afterEach(() => { vi.unstubAllEnvs(); setFreeTierPaidStoreForTests(undefined); vi.restoreAllMocks(); });
beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'log').mockImplementation(() => {}); });

describe('Free vision model allowlist (env cannot widen it)', () => {
  it('Free Google doors are flash-lite → flash even when VISION_* overrides name pro/grok', () => {
    vi.stubEnv('VISION_VERTEX_MODELS', 'gemini-2.5-pro,gemini-2.5-flash');
    vi.stubEnv('VISION_GEMINI_MODELS', 'gemini-2.5-pro');
    vi.stubEnv('VISION_GROK_MODELS', 'grok-4');
    expect(vertexVisionModels('free')).toEqual(['gemini-2.5-flash-lite', 'gemini-2.5-flash']);
    expect(geminiVisionModels('free')).toEqual(['gemini-2.5-flash-lite', 'gemini-2.5-flash']);
    expect(grokVisionModels('free')).toEqual([]);
    // Paid keeps its env-tunable list.
    expect(vertexVisionModels('paid')).toContain('gemini-2.5-pro');
  });
  it('GLM on Free stays on the $0 *v-flash ids', () => {
    vi.stubEnv('VISION_GLM_MODELS', 'glm-4.5v,glm-4.6v');
    expect(glmVisionModels('free')).toEqual(['glm-4.6v-flash']);
    vi.stubEnv('VISION_GLM_MODELS', 'glm-4.6v,glm-4.6v-flash');
    expect(glmVisionModels('free')).toEqual(['glm-4.6v-flash']);
  });
  it('Free vision order is GLM → Vertex → Gemini, no Grok/Claude; non-Claude callers count as Free', () => {
    expect(visionProviderOrder(false)).toEqual(['GLM', 'VERTEX', 'GEMINI']);
    expect(visionProviderOrder(true, 'free')).toEqual(['GLM', 'VERTEX', 'GEMINI']);
    expect(visionTier({ allowClaude: false })).toBe('free');
    expect(visionTier({ allowClaude: true, tier: 'free' })).toBe('free');
    expect(visionTier({ allowClaude: true })).toBe('paid');
  });
  it('Free professional describe uses Gemini only (no Grok, no Claude)', () => {
    expect(visionProviderChain({ freeTier: true, noClaude: true })).toEqual(['gemini']);
  });
});

describe('shared Free-tier daily $ cap', () => {
  it('FREE_TIER_PAID_DAILY_CAP_USD defaults to $10, clamps to the owner ceiling, invalid closes', () => {
    expect(freeTierPaidCapNanoUsd({})).toBe(10e9);
    expect(freeTierPaidCapNanoUsd({ FREE_TIER_PAID_DAILY_CAP_USD: '2.5' })).toBe(2.5e9);
    expect(freeTierPaidCapNanoUsd({ FREE_TIER_PAID_DAILY_CAP_USD: '500' })).toBe(17e9);
    expect(freeTierPaidCapNanoUsd({ FREE_TIER_PAID_DAILY_CAP_USD: 'lots' })).toBe(0);
  });
  it('only allowlisted cheap models can be priced; pro/grok are refused before dispatch', () => {
    expect(isFreeTierPaidModelAllowed('gemini-2.5-flash-lite')).toBe(true);
    expect(isFreeTierPaidModelAllowed('gemini-2.5-pro')).toBe(false);
    expect(isFreeTierPaidModelAllowed('grok-4')).toBe(false);
    expect(quoteFreeTierPaidNanoUsd('gemini-2.5-pro', 1000, 1000)).toBeNull();
    expect(quoteFreeTierPaidNanoUsd('gemini-2.5-flash', 1000, 1000)).toBeGreaterThan(0);
  });
  it('reserves against the shared store with the configured cap; fails closed without a store', async () => {
    vi.stubEnv('FREE_TIER_PAID_DAILY_CAP_USD', '3');
    const store = openStore(); setFreeTierPaidStoreForTests(store);
    expect(await reserveFreeTierPaid({ surface: 'sda-free', model: 'gemini-2.5-flash', inputTokens: 100, outputTokens: 100 })).not.toBeNull();
    expect(store.reservePaid.mock.calls[0][0]).toMatchObject({ capNanoUsd: 3e9 });
    setFreeTierPaidStoreForTests(null);
    expect(await reserveFreeTierPaid({ surface: 'sda-free', model: 'gemini-2.5-flash', inputTokens: 100, outputTokens: 100 })).toBeNull();
    setFreeTierPaidStoreForTests(closedStore());
    expect(await reserveFreeTierPaid({ surface: 'sda-free', model: 'gemini-2.5-flash', inputTokens: 100, outputTokens: 100 })).toBeNull();
  });
  it('a capped rung refuses with a non-health 402 (no breaker trip) and never calls the provider', async () => {
    setFreeTierPaidStoreForTests(closedStore());
    const base: AIProvider = { name: 'VERTEX', priority: 1, pinnedModel: 'gemini-2.5-flash', healthCheck: async () => true,
      execute: vi.fn(async () => ({ content: 'x', latencyMs: 1, provider: 'VERTEX', model: 'gemini-2.5-flash' })) as any,
      executeStream: vi.fn(async () => 'x') as any };
    const rung = cappedFreeTierRung(base, 'free-chat');
    const err = await rung.execute('hi').catch(e => e);
    expect(err).toBeInstanceOf(FreeTierPaidCapError);
    expect(isProviderHealthFailure(err)).toBe(false);
    await expect(rung.executeStream!('hi', undefined, () => {})).rejects.toBeInstanceOf(FreeTierPaidCapError);
    expect(base.execute).not.toHaveBeenCalled(); expect(base.executeStream).not.toHaveBeenCalled();
  });
  it('an admitted rung settles with the provider-reported usage', async () => {
    const store = openStore(); setFreeTierPaidStoreForTests(store);
    const base: AIProvider = { name: 'VERTEX', priority: 1, pinnedModel: 'gemini-2.5-flash-lite', healthCheck: async () => true,
      execute: async () => ({ content: 'ok', latencyMs: 1, provider: 'VERTEX', model: 'gemini-2.5-flash-lite', usage: { inputTokens: 100, outputTokens: 50 } }) as any };
    expect((await cappedFreeTierRung(base, 'professional-free-fallback').execute('hi')).content).toBe('ok');
    expect(store.settlePaid).toHaveBeenCalledOnce();
  });
  it('Free vision stops before any paid Google call when the cap is reached', async () => {
    setFreeTierPaidStoreForTests(closedStore());
    vi.stubEnv('GLM_API_KEY', ''); vi.stubEnv('GEMINI_API_KEY', 'test-only'); vi.stubEnv('GROK_API_KEY', 'test-only');
    const out = await runVisionChain([{ name: 'a.pdf', type: 'application/pdf', base64: 'AAAA' }], { prompt: 'read', allowClaude: false });
    expect(out).toBeNull();
  });
});

describe('localized busy line (silent fallback)', () => {
  it('answers in the user language', () => {
    expect(freeBusyMessage('मुझे बुखार है क्या करूँ')).toMatch(/व्यस्त/);
    expect(freeBusyMessage('mujhe batao kya karna hai')).toMatch(/Abhi AI thoda busy/);
    expect(freeBusyMessage('What is the capital of France?')).toMatch(/temporarily busy/);
    expect(isFreeTierUniverse('free')).toBe(true); expect(isFreeTierUniverse('pro')).toBe(false);
  });
});

describe('Free routers are capped, ordered cheapest-first and allowlisted', () => {
  beforeEach(() => AIRouterManager.reset());
  const rungs = (ns: 'free' | 'professional-free-fallback') => ((AIRouterManager.getRouter(ns) as any).providers as AIProvider[]);
  it('professional-free-fallback is flash-lite → flash', () => {
    expect(rungs('professional-free-fallback').map(p => p.pinnedModel)).toEqual(['gemini-2.5-flash-lite', 'gemini-2.5-flash']);
  });
  it('every paid Free rung is on the allowlist', () => {
    for (const ns of ['free', 'professional-free-fallback'] as const) {
      for (const p of rungs(ns)) if (p.pinnedModel) expect(isFreeTierPaidModelAllowed(p.pinnedModel)).toBe(true);
    }
  });
});

describe('CI guard: Free paths never name gemini-2.5-pro / grok', () => {
  const src = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');
  const body = (text: string, start: string) => {
    const i = text.indexOf(start); expect(i).toBeGreaterThan(-1);
    let depth = 0, j = text.indexOf('{', i);
    for (let k = j; k < text.length; k++) { if (text[k] === '{') depth++; else if (text[k] === '}' && --depth === 0) return text.slice(j, k + 1); }
    throw new Error('unbalanced');
  };
  const code = (t: string) => t.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  it('buildFree and buildProfessionalFreeFallback register no pro/grok/claude rung', () => {
    const mgr = src('src/server/AI/AIRouterManager.ts');
    expect(code(body(mgr, 'private static buildFree()'))).not.toMatch(FORBIDDEN);
    expect(code(body(mgr, 'private static buildProfessionalFreeFallback()'))).not.toMatch(FORBIDDEN);
    expect(code(body(mgr, 'private static buildProfessionalFree()'))).not.toMatch(FORBIDDEN);
  });
  it('the Free vision allowlist itself names no pro/grok model', () => {
    const vm = src('src/server/lib/visionModels.ts');
    expect(vm.match(/FREE_VISION_PAID_MODELS[^=]*=\s*Object\.freeze\(\[([^\]]*)\]/)![1]).not.toMatch(FORBIDDEN);
    const cap = src('src/server/lib/freeTierPaidCap.ts');
    expect(cap.match(/FREE_TIER_PAID_MODEL_ALLOWLIST[^=]*=\s*Object\.freeze\(\[([^\]]*)\]/)![1]).not.toMatch(FORBIDDEN);
  });
  it('the Free professional fallback is walked sequentially, never raced', () => {
    const pr = code(src('src/server/lib/professionalRouting.ts'));
    expect(pr).toMatch(/tier === 'free'\s*\?\s*await \(opts\?\.signal \? router\.route\(/);
  });
  it('resolved Free model lists contain no pro/grok under hostile env overrides', () => {
    vi.stubEnv('VISION_VERTEX_MODELS', 'gemini-2.5-pro'); vi.stubEnv('VISION_GEMINI_MODELS', 'gemini-3-pro,grok-4');
    vi.stubEnv('VISION_GROK_MODELS', 'grok-4'); vi.stubEnv('VISION_GLM_MODELS', 'grok-4');
    for (const list of [vertexVisionModels('free'), geminiVisionModels('free'), grokVisionModels('free'), glmVisionModels('free')]) {
      for (const m of list) expect(m).not.toMatch(FORBIDDEN);
    }
  });
});
