/**
 * BR2388 (owner 2026-11-15) — "surplus kyu band hua? routerone kyu nahi chala??"
 *
 * Fix 1  visibility: a supplier-free gate / stage / HTTP status behind every folded "build engine
 *        temporarily unavailable", in the server log and the ADMIN report only. User copy unchanged.
 * Fix 2  a reserve refused by an unresolved lock retires that Router One key for the rest of THAT build
 *        (one refusal, not 28, and no Firestore transaction per try). Other gates and builds unchanged.
 * Fix 3  a call that ends without a complete receipt is settled by a labelled ESTIMATE from the published
 *        per-model tariff (same × 5/2 markup as verified billing) and its key released; existing locks
 *        self-heal on the next reserve. Verified receipts are unchanged.
 * Two-sided throughout: what must change, and what must not.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const circuitMocks = vi.hoisted(() => ({ death: vi.fn(), success: vi.fn() }));
vi.mock('../src/server/AI/SurplusRegistry/surplusAdmitCircuit', () => ({
  recordSurplusMidBuildDeath: (...a: unknown[]) => circuitMocks.death(...a),
  recordSurplusAdmitProbeSuccess: (...a: unknown[]) => circuitMocks.success(...a),
}));

import deepseek from './fixtures/routerOnePublicTariffs/deepseek-jsonld.json';
import type { Firestore } from 'firebase-admin/firestore';
import { parsePublicProductTariff } from '../src/server/AI/RouterOne/publicTariff';
import type { PublicPriceSnapshot } from '../src/server/AI/RouterOne/publicPriceSource';
import { RouterOneAccountingUnavailableError, routerOneAccountingGate } from '../src/server/AI/RouterOne/accounting';
import {
  cataloguePricedRouterOneClient, cataloguePricedRouterOneText, cataloguePricedRouterOneRunner, runInRouterOneAccountingScope,
  currentRouterOneCatalogueReceipts, routerOneCatalogueBuildCharges, isRouterOneEstimatedReceipt, isRouterOneCatalogueReceipt,
  FirestoreCatalogueAttemptStore, createRouterOneUncertainFence, recordRouterOneEstimatedBill, ROUTER_ONE_ESTIMATED_BILL_LABEL,
  type CatalogueAttemptStore, type RouterOneCatalogueReceipt,
} from '../src/server/AI/RouterOne/catalogueAccounting';
import { estimateCatalogueChatCost, CATALOGUE_ESTIMATE_LABELS } from '../src/server/AI/RouterOne/catalogueMath';
import {
  sanitizeEngineSafeDiag, tagEngineSafeDiag, readEngineSafeDiag, formatEngineSafeDiag, withEngineSafeDiag,
  stripEngineSafeDiag, isRestOfBuildSkip,
} from '../src/server/lib/engineSafeDiag';
import { PublicBuildEngineError, PUBLIC_BUILD_ENGINE_UNAVAILABLE } from '../src/server/lib/buildEngineError';
import { makeMultiProviderTurnRunner, sharedRateLimitCooldowns, type NamedRunner } from '../src/server/AgentV3/providers/MultiProviderTurnRunner';
import { makeSurplusTurnRunner, type SurplusTurnPermit } from '../src/server/AgentV3/providers/SurplusTurnRunner';
import type { OpenAiCompletionLike } from '../src/server/AgentV3/providers/OpenAiToolAdapter';
import { tryConsumeSurplusPreWriteFailOpen } from '../src/server/AI/SurplusRegistry/surplusPreWriteFailOpen';
import { BuildDiagnostics, userFacingReport } from '../src/server/AgentV3/BuildDiagnostics';
import type { OpenAiChatClient, OpenAiChatStream } from '../src/server/AgentV3/providers/OpenAiToolRunner';
import type { RunTurnParams, TurnResult, TurnRunner } from '../src/server/AgentV3/ClaudeClient';

const model = 'deepseek-v4.1-flash', source = 'https://router.one/models/deepseek-v4-1-flash', now = 1000000;
const binding = { uid: 'synthetic-user', buildId: 'synthetic-build', workspaceId: 'synthetic-workspace' };
const usage = { prompt_tokens: 10000, completion_tokens: 500, total_tokens: 10500, prompt_tokens_details: { cached_tokens: 6000 } };
const VERIFIED_COST = '3672000000000000', VERIFIED_SUBTOTAL = '9180000000000000';
function snapshot(): PublicPriceSnapshot {
  const result = parsePublicProductTariff(deepseek, model, source, now);
  if (result.kind !== 'parsed-public-tariff') throw new Error('fixture failed');
  return { ...result.snapshot, sourceSha256: 'a'.repeat(64), parserVersion: 'router-one-product-jsonld-v1' };
}
function harness(opts: { raw?: unknown; store?: Partial<CatalogueAttemptStore>; key?: string } = {}) {
  const raw = opts.raw ?? { model, usage, choices: [{ message: { content: 'done' } }] };
  const create = vi.fn(async () => raw);
  const store: CatalogueAttemptStore = { reserve: vi.fn(async () => {}), finish: vi.fn(async () => {}), releaseVerified: vi.fn(async () => {}), ...opts.store };
  const prices = { snapshot: vi.fn(async () => snapshot()) };
  const key = opts.key ?? `synthetic-credential-${crypto.randomUUID()}`;
  const client = cataloguePricedRouterOneClient({ chat: { completions: { create } } } as OpenAiChatClient, key, { store, prices, maxDurationMs: 60000, now: () => now });
  const call = () => cataloguePricedRouterOneText(() => client.chat.completions.create({ model, messages: [{ role: 'user', content: 'build me an app' }], max_tokens: 1000 }));
  return { create, store, prices, client, call, key };
}
const locked = () => new RouterOneAccountingUnavailableError('reserve_fenced_unresolved');
afterEach(() => { vi.restoreAllMocks(); sharedRateLimitCooldowns.reset(); });

describe('fix 1 — supplier-free diagnostics never change the public error', () => {
  it('a gate tag leaves message, own properties and JSON exactly as the public boundary requires', () => {
    const tagged = locked(), plain = new PublicBuildEngineError();
    expect(tagged.message).toBe(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
    // the same own properties as before this change (the pre-existing non-enumerable `code` only)
    expect(Object.getOwnPropertyNames(tagged).sort()).toEqual(['code', 'message', 'name', 'stack']);
    expect(Object.keys(tagged)).toEqual(Object.keys(plain));
    expect(JSON.stringify(tagged)).toBe(JSON.stringify(plain));
    expect(JSON.stringify(tagged)).not.toContain('reserve');
    expect(routerOneAccountingGate(tagged)).toBe('reserve_fenced_unresolved');
    expect(formatEngineSafeDiag(tagged)).toBe('[engine-diag: gate=reserve_fenced_unresolved]');
    expect(routerOneAccountingGate(plain)).toBeUndefined();
    expect(formatEngineSafeDiag(plain)).toBe('');
    expect(withEngineSafeDiag('unchanged', plain)).toBe('unchanged');
  });
  it('accepts only enumerated tokens and an integer HTTP status — anything else is dropped, not escaped', () => {
    expect(sanitizeEngineSafeDiag({ gate: 'sk-live-ABC123', stage: 'https://api.example.com/v1', reason: 'Kimi said no', safe: 'ok_token', status: 429.5 }))
      .toEqual({ safe: 'ok_token' });
    expect(sanitizeEngineSafeDiag({ status: 99 })).toEqual({});
    expect(sanitizeEngineSafeDiag({ status: 503 })).toEqual({ status: 503 });
    const e = tagEngineSafeDiag(new Error('x'), { gate: 'Bearer abc' });
    expect(readEngineSafeDiag(e)).toBeUndefined();
  });
  it('the admin report keeps the marker; the user report strips it (and stays supplier-free)', () => {
    const d = new BuildDiagnostics({ now: () => 1 });
    d.record({ phase: 'provider', severity: 'warning', code: 'PROVIDER_FALLBACK', autoResolved: true,
      message: 'Provider ENGINE_R1 failed — falling back to the next provider', detail: withEngineSafeDiag(PUBLIC_BUILD_ENGINE_UNAVAILABLE, locked()) });
    recordRouterOneEstimatedBill(d, { calls: 2, costUsd: 0.0012, billedUsd: 0.003, label: ROUTER_ONE_ESTIMATED_BILL_LABEL });
    const admin = JSON.stringify(d.report());
    expect(admin).toContain('[engine-diag: gate=reserve_fenced_unresolved]');
    expect(admin).toContain('estimated_cost_usd=0.001200');
    expect(admin).toContain('ENGINE_COST_ESTIMATED');
    const user = JSON.stringify(userFacingReport(d.report()));
    expect(user).not.toContain('engine-diag');
    expect(user).not.toContain('gate=');
    expect(user).not.toContain('estimated_cost_usd');
    expect(user.toLowerCase()).not.toContain('router');
    expect(user).toContain(PUBLIC_BUILD_ENGINE_UNAVAILABLE); // the user's own copy is unchanged
    expect(stripEngineSafeDiag('a [engine-diag: gate=no_key] b')).toBe('a b');
  });
  it('logs which gate refused, once, without key or supplier text', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = harness({ store: { reserve: vi.fn(async () => { throw locked(); }) } });
    await runInRouterOneAccountingScope(binding, async () => { await expect(h.call()).rejects.toThrow(PUBLIC_BUILD_ENGINE_UNAVAILABLE); });
    const lines = warn.mock.calls.map(c => String(c[0])).filter(l => l.startsWith('[ROUTER_ONE]'));
    expect(lines).toEqual(['[ROUTER_ONE] refused before dispatch: reserve_fenced_unresolved']);
    expect(lines.join(' ')).not.toContain(h.key);
  });
  it('a Surplus fold carries stage, reason and HTTP status — never the upstream body', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const permit: SurplusTurnPermit = {
      buildId: 'build-1', callId: 'call-1', model: 'reviewed-model', providerId: 'reviewed-provider', offerId: 'reviewed-offer',
      endpoint: 'https://api.surplusintelligence.ai/min90/v1', priceGeneration: 'generation-1', policyVersion: 'policy-1', maxTokens: 400,
      requestRouting: { reviewedRouting: { objective: 'price', pin: 'reviewed-provider' } },
      validateResponse: () => { throw new Error('PRIVATE_UPSTREAM_BODY'); },
    };
    const runner = makeSurplusTurnRunner({ authorize: vi.fn(async () => permit), dispatch: vi.fn(async () => ({ status: 429, body: 'PRIVATE_UPSTREAM_BODY' }) as unknown as OpenAiCompletionLike) });
    const params: RunTurnParams = { model: 'legacy', messages: [{ role: 'user', content: 'build' }], maxTokens: 500 };
    const error = await runner.runTurn(params).catch(e => e);
    expect(error.message).toBe(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
    expect(Object.getOwnPropertyNames(error).sort()).toEqual(['message', 'name', 'stack']);
    expect(formatEngineSafeDiag(error)).toMatch(/^\[engine-diag: stage=response_validation reason=invalid_completion safe=[a-z_]+ status=429\]$/);
    const logged = warn.mock.calls.map(c => String(c[0])).join('\n');
    expect(logged).toContain('[SURPLUS_TURN]');
    expect(logged).toContain('status=429');
    expect(logged).not.toContain('PRIVATE_');
    expect(JSON.stringify(error)).not.toContain('PRIVATE_');
  });
  it('the Surplus fail-open hands the marker to the admin report; an untagged failure keeps the old call', () => {
    const onFailOpen = vi.fn();
    const tagged = tagEngineSafeDiag(new PublicBuildEngineError(), { stage: 'response_validation', reason: 'invalid_completion', status: 503 });
    expect(tryConsumeSurplusPreWriteFailOpen({ state: { dropped: false }, userFilesWritten: () => 0, onFailOpen }, tagged)).toBe('mid_build_engine_unavailable');
    expect(onFailOpen).toHaveBeenCalledExactlyOnceWith('mid_build_engine_unavailable', '[engine-diag: stage=response_validation reason=invalid_completion status=503]');
    const plain = vi.fn();
    tryConsumeSurplusPreWriteFailOpen({ state: { dropped: false }, userFilesWritten: () => 0, onFailOpen: plain }, new PublicBuildEngineError());
    expect(plain).toHaveBeenCalledExactlyOnceWith('mid_build_engine_unavailable');
  });
});

describe('fix 2 — an unresolved lock skips the key for the rest of this build only', () => {
  it('one refusal: no further price fetch or reserve transaction in the same build', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = harness({ store: { reserve: vi.fn(async () => { throw locked(); }) } });
    await runInRouterOneAccountingScope(binding, async () => {
      const first = await h.call().catch(e => e);
      expect(isRestOfBuildSkip(first)).toBe(true);
      for (let i = 0; i < 27; i++) {
        const next = await h.call().catch(e => e);
        expect(next.message).toBe(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
        expect(routerOneAccountingGate(next)).toBe('build_skip_unresolved_lock');
        expect(isRestOfBuildSkip(next)).toBe(true);
      }
    });
    expect(h.store.reserve).toHaveBeenCalledTimes(1);
    expect(h.prices.snapshot).toHaveBeenCalledTimes(1);
    expect(h.create).not.toHaveBeenCalled();
  });
  it('does not leak to the next build, nor to another key in the same build', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let refuse = true;
    const reserve = vi.fn(async () => { if (refuse) throw locked(); });
    const h = harness({ store: { reserve } });
    await runInRouterOneAccountingScope(binding, async () => {
      await expect(h.call()).rejects.toThrow();
      const other = harness(); // a different key, same build
      await expect(other.call()).resolves.toMatchObject({ model });
      expect(other.store.reserve).toHaveBeenCalledTimes(1);
    });
    refuse = false;
    await runInRouterOneAccountingScope({ ...binding, buildId: 'next-build' }, async () => {
      await expect(h.call()).resolves.toMatchObject({ model });
    });
    expect(reserve).toHaveBeenCalledTimes(2);
  });
  it('every other gate keeps its old behaviour (asked again, never marked to skip)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const err of [new RouterOneAccountingUnavailableError('reserve_deadline'), new Error('database unavailable')]) {
      const h = harness({ store: { reserve: vi.fn(async () => { throw err; }) } });
      await runInRouterOneAccountingScope(binding, async () => {
        const a = await h.call().catch(e => e), b = await h.call().catch(e => e);
        expect(isRestOfBuildSkip(a)).toBe(false); expect(isRestOfBuildSkip(b)).toBe(false);
      });
      expect(h.store.reserve).toHaveBeenCalledTimes(2);
    }
  });
  const PARAMS: RunTurnParams = { model: 'm', messages: [{ role: 'user', content: 'fix the build' }] };
  const ok = (text: string): TurnResult => ({ text, toolUses: [], stopReason: 'end_turn',
    usage: { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, rawContent: [{ type: 'text', text }] });
  const calls = (r: TurnRunner) => (r.runTurn as ReturnType<typeof vi.fn>).mock.calls.length;
  it('the ladder retires that rung once per build, by rung name; other providers and builds are untouched', async () => {
    const r1: TurnRunner = { runTurn: vi.fn(async () => { const e = locked(); (await import('../src/server/lib/engineSafeDiag')).markRestOfBuildSkip(e, 'build_skip_unresolved_lock'); throw e; }) };
    const r1b: TurnRunner = { runTurn: vi.fn(async () => ok('second key')) };
    const next: TurnRunner = { runTurn: vi.fn(async () => ok('next rung')) };
    const benched = vi.fn();
    const chain = (): NamedRunner[] => [{ name: 'ENGINE_R1', runner: r1, modelId: model }, { name: 'KIMI', runner: next }];
    const dead = new Map<string, string>();
    const runner = makeMultiProviderTurnRunner(chain(), { deadRungs: dead, onProviderBenched: benched });
    for (let i = 0; i < 5; i++) expect((await runner.runTurn(PARAMS)).text).toBe('next rung');
    expect(calls(r1)).toBe(1);
    expect(calls(next)).toBe(5);
    expect(benched).toHaveBeenCalledTimes(1);
    expect(String(benched.mock.calls[0][1])).toContain('skipped for the rest of this build');
    // a second Router One key (another rung name) is not retired by the first key's lock
    const two = makeMultiProviderTurnRunner([{ name: 'ENGINE_R1#2', runner: r1b, reportAs: 'ENGINE_R1', modelId: model }, { name: 'KIMI', runner: next }], { deadRungs: dead });
    expect((await two.runTurn(PARAMS)).text).toBe('second key');
    // the next build starts with fresh memory and asks again
    const nextBuild = makeMultiProviderTurnRunner(chain(), { deadRungs: new Map() });
    await nextBuild.runTurn(PARAMS);
    expect(calls(r1)).toBe(2);
  });
  it('an ordinary public failure is not retired by this rule', async () => {
    const r1: TurnRunner = { runTurn: vi.fn(async () => { throw new PublicBuildEngineError(); }) };
    const next: TurnRunner = { runTurn: vi.fn(async () => ok('next rung')) };
    const runner = makeMultiProviderTurnRunner([{ name: 'ENGINE_R1', runner: r1, modelId: model }, { name: 'KIMI', runner: next }], { deadRungs: new Map() });
    await runner.runTurn(PARAMS); await runner.runTurn(PARAMS);
    expect(calls(r1)).toBe(2);
  });
});

describe('fix 3 — estimate settlement, in the owner\'s accuracy order', () => {
  const s = snapshot();
  it('a: usage with cached_tokens prices exactly like the verified receipt, labelled estimated', () => {
    const e = estimateCatalogueChatCost(s, usage, { requestInputTokens: 0, outputChars: 0 })!;
    expect(e.basis).toBe('usage-reported');
    expect(e.costAttoUsd).toBe(VERIFIED_COST);
    expect(e.modelSubtotalAttoUsd).toBe(VERIFIED_SUBTOTAL);
    expect(e.label).toMatch(/^Estimated/);
  });
  it('b: the provider cache alias is used when cached_tokens is missing; otherwise all input at full rate (conservative)', () => {
    const alias = estimateCatalogueChatCost(s, { prompt_tokens: 10000, completion_tokens: 500, prompt_cache_hit_tokens: 6000 }, { requestInputTokens: 0, outputChars: 0 })!;
    expect(alias.basis).toBe('usage-provider-cache-detail');
    expect(alias.costAttoUsd).toBe(VERIFIED_COST);
    const full = estimateCatalogueChatCost(s, { prompt_tokens: 10000, completion_tokens: 500 }, { requestInputTokens: 0, outputChars: 0 })!;
    expect(full.basis).toBe('usage-full-input-rate');
    expect(BigInt(full.costAttoUsd)).toBeGreaterThan(BigInt(VERIFIED_COST));
    expect(full.label).toMatch(/conservative/);
    expect(BigInt(full.modelSubtotalAttoUsd)).toBe(BigInt(full.costAttoUsd) * 5n / 2n);
  });
  it('c: no usage → input from the request heuristic, output from the content length', () => {
    const e = estimateCatalogueChatCost(s, undefined, { requestInputTokens: 1000, outputChars: 4001 })!;
    expect(e.basis).toBe('request-heuristic');
    expect(e).toMatchObject({ inputTokens: 1000, outputTokens: 1001, cacheReadTokens: null });
    expect(e.label).toMatch(/^Estimated/);
    expect(BigInt(e.modelSubtotalAttoUsd)).toBe(BigInt(e.costAttoUsd) * 5n / 2n);
  });
  it('an HTTP error with no usage is settled at an explicit, labelled zero', () => {
    const e = estimateCatalogueChatCost(s, undefined, { requestInputTokens: 1000, outputChars: 0, httpStatus: 503 })!;
    expect(e).toMatchObject({ basis: 'no-billable-response', costAttoUsd: '0', modelSubtotalAttoUsd: '0' });
  });
  it('every estimate label says estimated; only full-input-rate ones say conservative', () => {
    for (const [basis, label] of Object.entries(CATALOGUE_ESTIMATE_LABELS)) {
      expect(label).toMatch(/^Estimated/);
      if (basis === 'usage-full-input-rate' || basis === 'request-heuristic') expect(label).toMatch(/conservative/);
    }
  });
  it('a verified call is unchanged: calculated receipt, exact cost, no estimate label, released once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = harness();
    await runInRouterOneAccountingScope(binding, async () => {
      expect(await h.call()).toMatchObject({ model });
      const [r] = currentRouterOneCatalogueReceipts();
      expect(r).toMatchObject({ kind: 'catalogue-calculated', expenseEvidence: 'official-public-tariff', costAttoUsd: VERIFIED_COST });
      expect(r.estimateLabel).toBeUndefined();
      expect(isRouterOneEstimatedReceipt(r)).toBe(false);
    });
    expect(h.store.finish).toHaveBeenCalledTimes(1);
    expect(h.store.releaseVerified).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls.some(c => String(c[0]).startsWith('[ROUTER_ONE]'))).toBe(false);
  });
  it('missing usage is settled by estimate with the request size the reserve recorded, and the key is released', async () => {
    const h = harness({ raw: { model, choices: [{ message: { content: 'x'.repeat(400) } }] } });
    await runInRouterOneAccountingScope(binding, async () => {
      await h.call();
      const [r] = currentRouterOneCatalogueReceipts();
      expect(isRouterOneEstimatedReceipt(r)).toBe(true);
      expect(isRouterOneCatalogueReceipt(r)).toBe(true);
      expect(r).toMatchObject({ estimateBasis: 'request-heuristic', outputTokens: 100, expenseEvidence: 'official-public-tariff-estimate' });
      expect(r.inputTokens).toBeGreaterThan(0);
      expect((h.store.reserve as ReturnType<typeof vi.fn>).mock.calls[0][5]).toBe(r.inputTokens);
    });
    expect(h.store.releaseVerified).toHaveBeenCalledTimes(1);
  });
  it('the runner\'s usage carries the estimate, so billing prices it once with the same × 5/2 markup', async () => {
    const h = harness({ raw: { model, choices: [{ message: { content: 'x'.repeat(400) } }] } });
    const inner: TurnRunner = { runTurn: async () => { await h.client.chat.completions.create({ model, messages: [{ role: 'user', content: 'hi there' }], max_tokens: 1000 });
      return { text: 'kept', model, toolUses: [], stopReason: 'end_turn', rawContent: [], usage: { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } } as TurnResult; } };
    await runInRouterOneAccountingScope(binding, async () => {
      const r = await cataloguePricedRouterOneRunner(inner).runTurn({} as never);
      expect(r.text).toBe('kept');
      const receipt = r.usage.routerOneReceipt as RouterOneCatalogueReceipt;
      expect(isRouterOneEstimatedReceipt(receipt)).toBe(true);
      expect(r.usage).toMatchObject({ inputTokens: receipt.inputTokens, outputTokens: receipt.outputTokens });
      const entry = { model, routerOneReceipt: receipt, usage: r.usage };
      const charges = routerOneCatalogueBuildCharges([entry, entry], new Set()); // a late duplicate is never charged twice
      expect(charges.costUsd).toBe(Number(BigInt(receipt.costAttoUsd)) / 1e18);
      expect(charges.billedUsd).toBe(Number(BigInt(receipt.costAttoUsd) * 5n / 2n) / 1e18);
      expect(charges.estimated).toMatchObject({ calls: 1, label: ROUTER_ONE_ESTIMATED_BILL_LABEL });
    });
  });
  it('verified-only builds return exactly the old billing shape', async () => {
    const h = harness();
    await runInRouterOneAccountingScope(binding, async () => {
      await h.call();
      const [receipt] = currentRouterOneCatalogueReceipts();
      const entry = { model, routerOneReceipt: receipt, usage: { inputTokens: 10000, outputTokens: 500 } };
      expect(routerOneCatalogueBuildCharges([entry], new Set())).toEqual({ costUsd: 0.003672, billedUsd: 0.00918, absorbedUsd: 0 });
      expect(routerOneCatalogueBuildCharges([{ ...entry, unbilled: true }], new Set())).toEqual({ costUsd: 0.003672, billedUsd: 0, absorbedUsd: 0.003672 });
    });
  });
  it('a stream that ends early and a later finalizer settle the call exactly once', async () => {
    const stream: OpenAiChatStream = { async *[Symbol.asyncIterator]() { yield { model, choices: [{ delta: { content: 'abcd' } }] }; yield { model, usage }; } };
    const h = harness({ raw: stream });
    await runInRouterOneAccountingScope(binding, async () => {
      await cataloguePricedRouterOneText(async () => {
        const r = await h.client.chat.completions.create({ model, messages: [], max_tokens: 1000, stream: true });
        await (r as OpenAiChatStream)[Symbol.asyncIterator]().next();
      });
      expect(currentRouterOneCatalogueReceipts()).toHaveLength(1);
    });
    expect(h.store.finish).toHaveBeenCalledTimes(1);
  });
});

describe('fix 3 — existing locks self-heal on reserve (no manual Firestore write)', () => {
  function database() {
    const rows = new Map<string, Record<string, unknown>>(); let tail: Promise<unknown> = Promise.resolve();
    const db = { doc: (path: string) => ({ path }), runTransaction: (fn: (tx: unknown) => Promise<unknown>) => {
      const result = tail.then(async () => {
        const writes: Array<() => void> = [];
        const value = await fn({ get: async (ref: { path: string }) => ({ exists: rows.has(ref.path), data: () => rows.get(ref.path) }),
          create: (ref: { path: string }, v: Record<string, unknown>) => { if (rows.has(ref.path)) throw new Error('already exists'); writes.push(() => { rows.set(ref.path, v); }); },
          update: (ref: { path: string }, v: Record<string, unknown>) => { if (!rows.has(ref.path)) throw new Error('missing'); writes.push(() => { rows.set(ref.path, { ...rows.get(ref.path), ...v }); }); },
          set: (ref: { path: string }, v: Record<string, unknown>) => { writes.push(() => { rows.set(ref.path, v); }); } });
        for (const w of writes) w();
        return value;
      });
      tail = result.catch(() => {}); return result;
    } } as unknown as Firestore;
    return { db, rows };
  }
  it('a legacy production lock (pending row, recorded snapshot and request size) is settled by estimate and released', async () => {
    const { db, rows } = database(); let t = now;
    const store = new FirestoreCatalogueAttemptStore(db, () => t);
    await store.reserve(binding, 'old', 'key', snapshot(), t + 100, 2000);
    expect(rows.get('router_one_catalogue_attempts/old')).toMatchObject({ requestInputTokens: 2000 });
    await store.finish('old', 'key', { kind: 'pending', reason: 'incomplete-usage', requestId: null });
    t += 1000;
    await new FirestoreCatalogueAttemptStore(db, () => t).reserve(binding, 'new', 'key', snapshot(), t + 100);
    const healed = rows.get('router_one_catalogue_attempts/old')!;
    expect(healed).toMatchObject({ status: 'self-healed-estimate', absorbed: true,
      result: { kind: 'catalogue-estimated', basis: 'self-heal-request-heuristic', inputTokens: 2000 } });
    expect(BigInt((healed.result as { costAttoUsd: string }).costAttoUsd)).toBeGreaterThan(0n);
    expect((healed.result as { label: string }).label).toMatch(/^Estimated/);
    expect(rows.get('router_one_accounting_keys/key')).toMatchObject({ unresolved: {}, active: { new: t + 100 } });
  });
  it('a lock with no attempt row at all is settled at a labelled zero instead of blocking forever', async () => {
    const { db, rows } = database();
    rows.set('router_one_accounting_keys/key', { version: 2, active: {}, unresolved: { ghost: true } });
    await new FirestoreCatalogueAttemptStore(db).reserve(binding, 'new', 'key', snapshot(), Date.now() + 60000);
    expect(rows.get('router_one_catalogue_attempts/ghost')).toMatchObject({ status: 'self-healed-estimate', result: { basis: 'self-heal-unrecorded', costAttoUsd: '0' } });
  });
  it('the local uncertainty fence is bounded by the call deadline, and still fails closed when saturated', () => {
    const fence = createRouterOneUncertainFence(2);
    fence.add('k', 2000, 1000);
    expect(fence.has('k', 1999)).toBe(true);
    expect(fence.has('k', 2001)).toBe(false);
    fence.add('a', Number.POSITIVE_INFINITY, 3000); fence.add('b', Number.POSITIVE_INFINITY, 3000);
    fence.add('c', Number.POSITIVE_INFINITY, 3000);
    expect(fence.has('healthy', 3000)).toBe(true);
  });
});
