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
      // The estimated share carries the SAME × 5/2 markup as verified billing — not cost, not a different rate.
      expect(charges.estimated!.costUsd).toBe(charges.costUsd);
      expect(charges.estimated!.billedUsd).toBe(charges.billedUsd);
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
  it('a stream closed AFTER the finalizer already settled it is ignored: no second receipt, no second write, build not stopped', async () => {
    const stream: OpenAiChatStream = { async *[Symbol.asyncIterator]() { yield { model, choices: [{ delta: { content: 'abcd' } }] }; yield { model, usage }; } };
    const h = harness({ raw: stream });
    await runInRouterOneAccountingScope(binding, async () => {
      let it!: AsyncIterator<unknown>;
      await cataloguePricedRouterOneText(async () => {
        const r = await h.client.chat.completions.create({ model, messages: [], max_tokens: 1000, stream: true });
        it = (r as OpenAiChatStream)[Symbol.asyncIterator]();
        await it.next();
      });
      expect(currentRouterOneCatalogueReceipts()).toHaveLength(1);
      await it.return?.(undefined); // the late close runs the stream's own settle path
      expect(currentRouterOneCatalogueReceipts()).toHaveLength(1);
    });
    expect(h.store.finish).toHaveBeenCalledTimes(1);
    expect(h.store.releaseVerified).toHaveBeenCalledTimes(1);
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
  // Side-effect guards (owner t311u: a fix must not create a new problem).
  it('an unresolved entry whose call is ALREADY settled is released only — never priced a second time', async () => {
    const { db, rows } = database();
    const settled = { callId: 'done', status: 'catalogue-calculated', result: { kind: 'catalogue-calculated', costAttoUsd: VERIFIED_COST } };
    rows.set('router_one_catalogue_attempts/done', settled);
    rows.set('router_one_accounting_keys/key', { version: 2, active: { done: Date.now() + 60000 }, unresolved: { done: true } });
    await new FirestoreCatalogueAttemptStore(db).reserve(binding, 'new', 'key', snapshot(), Date.now() + 60000);
    expect(rows.get('router_one_catalogue_attempts/done')).toEqual(settled);
    expect(rows.get('router_one_accounting_keys/key')).toMatchObject({ unresolved: {} });
    expect((rows.get('router_one_accounting_keys/key') as { active: Record<string, number> }).active.done).toBeUndefined();
  });
  it('a call still in flight (deadline not reached) is never self-healed by another reserve on the same key', async () => {
    const { db, rows } = database(); const t = now;
    const store = new FirestoreCatalogueAttemptStore(db, () => t);
    await store.reserve(binding, 'live', 'key', snapshot(), t + 60000, 500);
    await store.reserve(binding, 'second', 'key', snapshot(), t + 60000);
    expect(rows.get('router_one_catalogue_attempts/live')).toMatchObject({ status: 'reserved' });
    expect(rows.get('router_one_accounting_keys/key')).toMatchObject({ unresolved: {}, active: { live: t + 60000, second: t + 60000 } });
  });
  it('a successful (2xx) response without usage is estimated from size, never settled at zero', () => {
    const e = estimateCatalogueChatCost(snapshot(), undefined, { requestInputTokens: 1000, outputChars: 400, httpStatus: 200 })!;
    expect(e.basis).toBe('request-heuristic');
    expect(BigInt(e.costAttoUsd)).toBeGreaterThan(0n);
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

// ── Review round 2 (PR #4238) ─────────────────────────────────────────────────────────────────────────
import OpenAI from 'openai';
import { routerOneAccountingFetch } from '../src/server/AI/RouterOne/accounting';
import { recordRouterOneScopeUsage, routerOneNetworkSetupFailure } from '../src/server/AI/RouterOne/catalogueAccounting';

const sysErr = (code: string, message = code) => Object.assign(new Error(message), { code });
const fetchFailed = (cause: unknown) => Object.assign(new TypeError('fetch failed'), { cause });
const bigPrompt = 'x'.repeat(40000);

/** The scope-classifier ask, composed exactly like agentv3's routerOneScopeAsk: real SDK, real accounting fetch. */
async function scopeAskBilled(transport: typeof fetch, opts: { timeout?: number; signal?: AbortSignal } = {}) {
  const store: CatalogueAttemptStore = { reserve: vi.fn(async () => {}), finish: vi.fn(async () => {}), releaseVerified: vi.fn(async () => {}) };
  const key = `synthetic-credential-${crypto.randomUUID()}`;
  const sdk = new OpenAI({ apiKey: key, baseURL: 'https://engine.invalid/v1', timeout: opts.timeout ?? 60000, maxRetries: 0,
    fetch: routerOneAccountingFetch(transport, model, () => {}) });
  const ledger: Array<{ provider: string; usage: Record<string, unknown>; model?: string }> = [];
  let thrown: unknown;
  await runInRouterOneAccountingScope(binding, async () => {
    try {
      await cataloguePricedRouterOneText(() => cataloguePricedRouterOneClient(sdk as unknown as OpenAiChatClient, key,
        { store, prices: { snapshot: async () => snapshot() }, maxDurationMs: 60000, now: () => now })
        .chat.completions.create({ model, messages: [{ role: 'system', content: 'classify' }, { role: 'user', content: bigPrompt }], max_tokens: 1024 },
          opts.signal ? { signal: opts.signal } : undefined));
    } catch (e) { thrown = e; }
    recordRouterOneScopeUsage({ add: (provider, usage, m) => { ledger.push({ provider, usage: usage as unknown as Record<string, unknown>, model: m }); } });
  });
  const entries = ledger.map(e => ({ model: e.model, routerOneReceipt: e.usage.routerOneReceipt as RouterOneCatalogueReceipt,
    usage: { inputTokens: Number(e.usage.inputTokens), outputTokens: Number(e.usage.outputTokens) } }));
  return { thrown, store, receipts: entries.map(e => e.routerOneReceipt), charges: routerOneCatalogueBuildCharges(entries, new Set()) };
}

describe('review 2 — a call that never got any HTTP response is not billed (network setup failure)', () => {
  it('classifier: only DNS, refused, unreachable, TLS/cert and connect-timeout codes (anywhere in the cause chain) → setup failure', () => {
    for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'ERR_TLS_CERT_ALTNAME_INVALID',
      'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN', 'ERR_SSL_WRONG_VERSION_NUMBER']) {
      expect(routerOneNetworkSetupFailure(Object.assign(new Error('Connection error.'), { cause: fetchFailed(sysErr(code)) })), code).toBe(true);
    }
  });
  it('review 3: pre-socket DNS/bind and handshake-only TLS codes are setup failures in every wrapping; an after-dispatch code still wins', () => {
    for (const code of ['EAI_NONAME', 'EAI_FAIL', 'EAI_NODATA', 'EAI_ADDRFAMILY', 'EADDRNOTAVAIL', 'ERR_TLS_HANDSHAKE_TIMEOUT',
      'ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE', 'ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION', 'ERR_SSL_UNSUPPORTED_PROTOCOL', 'ERR_SSL_NO_PROTOCOLS_AVAILABLE']) {
      expect(routerOneNetworkSetupFailure(fetchFailed(sysErr(code))), code).toBe(true);
      expect(routerOneNetworkSetupFailure(Object.assign(new Error('Connection error.'), { name: 'APIConnectionError', cause: fetchFailed(sysErr(code)) })), code).toBe(true);
      expect(routerOneNetworkSetupFailure(fetchFailed(Object.assign(sysErr('ECONNRESET'), { cause: sysErr(code) }))), code).toBe(false);
      expect(routerOneNetworkSetupFailure(fetchFailed(sysErr(code)), true), code).toBe(false);
    }
  });
  it('classifier: timeouts, aborts, the caller\'s signal and unknown errors are NOT setup failures (supplier may have worked)', () => {
    const timeout = Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' });
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    expect(routerOneNetworkSetupFailure(timeout)).toBe(false);
    expect(routerOneNetworkSetupFailure(Object.assign(new Error('Connection error.'), { cause: abort }))).toBe(false);
    expect(routerOneNetworkSetupFailure(fetchFailed(sysErr('ETIMEDOUT')))).toBe(false);
    expect(routerOneNetworkSetupFailure(fetchFailed(sysErr('ECONNREFUSED')), true)).toBe(false);
    expect(routerOneNetworkSetupFailure(new Error('socket hang up'))).toBe(false);
    expect(routerOneNetworkSetupFailure(sysErr('ECONNRESET'))).toBe(false);
    expect(routerOneNetworkSetupFailure(undefined)).toBe(false);
  });
  it('classifier: connections dropped after the request may have been sent are after-dispatch, in every wrapping', () => {
    for (const code of ['ECONNRESET', 'ECONNABORTED', 'EPIPE', 'UND_ERR_SOCKET', 'UND_ERR_CLOSED']) {
      const undici = fetchFailed(sysErr(code, code === 'UND_ERR_SOCKET' ? 'other side closed' : code));
      expect(routerOneNetworkSetupFailure(undici), code).toBe(false);
      expect(routerOneNetworkSetupFailure(Object.assign(new Error('Connection error.'), { name: 'APIConnectionError', cause: undici })), code).toBe(false);
      // after-dispatch wins even if a setup-looking code also appears deeper in the chain
      expect(routerOneNetworkSetupFailure(fetchFailed(Object.assign(sysErr(code), { cause: sysErr('ECONNREFUSED') }))), code).toBe(false);
      // …and also when the setup-looking code is the OUTER one and the after-dispatch code is deeper
      expect(routerOneNetworkSetupFailure(Object.assign(sysErr('ECONNREFUSED'), { cause: sysErr(code) })), code).toBe(false);
    }
  });
  it('classifier: an error with NO code anywhere is decided conservatively (estimated, not zero)', () => {
    expect(routerOneNetworkSetupFailure(new TypeError('fetch failed'))).toBe(false);
    expect(routerOneNetworkSetupFailure(Object.assign(new Error('Connection error.'), { name: 'APIConnectionError', cause: new TypeError('fetch failed') }))).toBe(false);
    expect(routerOneNetworkSetupFailure(sysErr('EHOSTDOWN'))).toBe(false); // unlisted code → conservative
    expect(routerOneNetworkSetupFailure(fetchFailed(sysErr('ERR_SSL_DECRYPTION_FAILED_OR_BAD_RECORD_MAC')))).toBe(false); // mid-session TLS → estimated
    const loop: { code?: string; cause?: unknown } = {}; loop.cause = loop;
    expect(routerOneNetworkSetupFailure(loop)).toBe(false); // a cyclic chain terminates
  });
  it('scope-classifier billing path: connection refused with a 40k-char prompt → labelled zero, lock released, wallet $0, no "estimated" line', async () => {
    const r = await scopeAskBilled(async () => { throw fetchFailed(sysErr('ECONNREFUSED', 'connect ECONNREFUSED')); });
    expect(r.thrown).toBeTruthy();
    expect(r.receipts).toHaveLength(1);
    expect(r.receipts[0]).toMatchObject({ kind: 'catalogue-estimated', estimateBasis: 'no-response-network', costAttoUsd: '0', inputTokens: 0, outputTokens: 0 });
    expect(r.receipts[0].estimateLabel).toMatch(/^Estimated at zero/);
    expect(r.store.releaseVerified).toHaveBeenCalledTimes(1);
    expect(r.charges).toEqual({ costUsd: 0, billedUsd: 0, absorbedUsd: 0 });
  });
  for (const [label, err] of [['DNS ENOTFOUND', sysErr('ENOTFOUND')], ['DNS EAI_AGAIN', sysErr('EAI_AGAIN')], ['TLS', sysErr('ERR_TLS_CERT_ALTNAME_INVALID')],
    ['connect timeout', sysErr('UND_ERR_CONNECT_TIMEOUT')], ['unreachable', sysErr('EHOSTUNREACH')], ['DNS EAI_FAIL', sysErr('EAI_FAIL')], ['local bind', sysErr('EADDRNOTAVAIL')],
    ['TLS handshake', sysErr('ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE')]] as const) {
    it(`scope-classifier billing path: ${label} before any response → $0`, async () => {
      const r = await scopeAskBilled(async () => { throw fetchFailed(err); });
      expect(r.receipts[0]).toMatchObject({ estimateBasis: 'no-response-network', costAttoUsd: '0' });
      expect(r.charges.billedUsd).toBe(0);
    });
  }
  for (const [code, message] of [['ECONNRESET', 'read ECONNRESET'], ['UND_ERR_SOCKET', 'other side closed'], ['EPIPE', 'write EPIPE'],
    ['UND_ERR_CLOSED', 'The client is destroyed'], ['ECONNABORTED', 'connection aborted']] as const) {
    it(`other side (SDK-wrapped, real undici shape): ${code} after the request was sent is ESTIMATED from size, never $0`, async () => {
      const r = await scopeAskBilled(async () => { throw fetchFailed(sysErr(code, message)); });
      expect(r.thrown).toBeTruthy();
      expect(r.receipts[0]).toMatchObject({ estimateBasis: 'request-heuristic' });
      expect(r.receipts[0].inputTokens).toBeGreaterThan(5000);
      expect(r.charges.billedUsd).toBeGreaterThan(0);
      expect(r.store.releaseVerified).toHaveBeenCalledTimes(1);
    });
  }
  it('other side (SDK-wrapped): a bare fetch failure with no code at all is estimated (conservative), never $0', async () => {
    const r = await scopeAskBilled(async () => { throw new TypeError('fetch failed'); });
    expect(r.receipts[0]).toMatchObject({ estimateBasis: 'request-heuristic' });
    expect(r.charges.billedUsd).toBeGreaterThan(0);
  });
  it('through routerOneAccountingFetch WITHOUT the SDK (raw undici error rethrown): ECONNRESET is estimated, ECONNREFUSED is $0', async () => {
    const run = async (err: unknown) => {
      const store: CatalogueAttemptStore = { reserve: vi.fn(async () => {}), finish: vi.fn(async () => {}), releaseVerified: vi.fn(async () => {}) };
      const wrapped = routerOneAccountingFetch(async () => { throw err; }, model, () => {});
      const raw = { chat: { completions: { create: async () => { await wrapped('https://engine.invalid/v1/chat/completions', { method: 'POST' }); throw new Error('unreachable'); } } } };
      const client = cataloguePricedRouterOneClient(raw as unknown as OpenAiChatClient, 'synthetic-k', { store, prices: { snapshot: async () => snapshot() }, maxDurationMs: 60000, now: () => now });
      let receipt: RouterOneCatalogueReceipt | undefined, thrown: unknown;
      await runInRouterOneAccountingScope(binding, async () => {
        try { await cataloguePricedRouterOneText(() => client.chat.completions.create({ model, messages: [{ role: 'user', content: bigPrompt }], max_tokens: 1000 })); }
        catch (e) { thrown = e; }
        [receipt] = currentRouterOneCatalogueReceipts();
      });
      return { receipt: receipt!, thrown, store };
    };
    const reset = fetchFailed(sysErr('ECONNRESET', 'read ECONNRESET'));
    const r1 = await run(reset);
    expect(r1.thrown).toBe(reset); // the wrapper rethrows the transport error unchanged
    expect(r1.receipt).toMatchObject({ estimateBasis: 'request-heuristic' });
    expect(BigInt(r1.receipt.costAttoUsd)).toBeGreaterThan(0n);
    const refused = fetchFailed(sysErr('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:443'));
    const r2 = await run(refused);
    expect(r2.thrown).toBe(refused);
    expect(r2.receipt).toMatchObject({ estimateBasis: 'no-response-network', costAttoUsd: '0' });
    expect(r2.store.releaseVerified).toHaveBeenCalledTimes(1);
  });
  it('other side: an SDK timeout after dispatch keeps the request-size estimate (charged, labelled conservative)', async () => {
    const r = await scopeAskBilled((_i, init) => new Promise((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }), { timeout: 30 });
    expect(r.receipts[0]).toMatchObject({ estimateBasis: 'request-heuristic' });
    expect(r.receipts[0].inputTokens).toBeGreaterThan(5000);
    expect(r.charges.billedUsd).toBeGreaterThan(0);
    expect(r.charges.estimated).toMatchObject({ calls: 1 });
  });
  it('other side: the caller aborting after dispatch keeps the request-size estimate', async () => {
    const ac = new AbortController();
    const r = await scopeAskBilled((_i, init) => new Promise((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      setTimeout(() => ac.abort(), 5);
    }), { signal: ac.signal });
    expect(r.receipts[0]).toMatchObject({ estimateBasis: 'request-heuristic' });
    expect(r.charges.billedUsd).toBeGreaterThan(0);
  });
  it('other side: an HTTP response that arrived (2xx, no usage) is still estimated from size, never zeroed by this rule', async () => {
    const r = await scopeAskBilled(async () => new Response(JSON.stringify({ id: 'c', object: 'chat.completion', created: 1, model,
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'y'.repeat(400) } }] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    expect(r.thrown).toBeUndefined();
    expect(r.receipts[0]).toMatchObject({ estimateBasis: 'request-heuristic', outputTokens: 100 });
    expect(r.charges.billedUsd).toBeGreaterThan(0);
  });
  it('other side: a complete verified response through the same path is billed exactly as before', async () => {
    const r = await scopeAskBilled(async () => new Response(JSON.stringify({ id: 'c', object: 'chat.completion', created: 1, model, usage,
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    expect(r.receipts[0]).toMatchObject({ kind: 'catalogue-calculated', costAttoUsd: VERIFIED_COST });
    expect(r.charges).toEqual({ costUsd: 0.003672, billedUsd: 0.00918, absorbedUsd: 0 });
  });
  it('a request stopped after admission but before it was sent is settled at a labelled zero, and its key released', async () => {
    const ac = new AbortController();
    const store: CatalogueAttemptStore = { reserve: vi.fn(async () => { ac.abort(); }), finish: vi.fn(async () => {}), releaseVerified: vi.fn(async () => {}) };
    const create = vi.fn();
    const client = cataloguePricedRouterOneClient({ chat: { completions: { create } } } as unknown as OpenAiChatClient, 'synthetic-k',
      { store, prices: { snapshot: async () => snapshot() }, maxDurationMs: 60000, now: () => now });
    await runInRouterOneAccountingScope(binding, async () => {
      await expect(cataloguePricedRouterOneText(() => client.chat.completions.create({ model, messages: [{ role: 'user', content: bigPrompt }], max_tokens: 1000 }, { signal: ac.signal }))).rejects.toBeTruthy();
      const [r] = currentRouterOneCatalogueReceipts();
      expect(r).toMatchObject({ kind: 'catalogue-estimated', estimateBasis: 'not-dispatched', costAttoUsd: '0' });
    });
    expect(create).not.toHaveBeenCalled();
    expect(store.releaseVerified).toHaveBeenCalledTimes(1);
  });
  it('a ZERO estimate never produces the user-facing "estimated" line; a priced one does', () => {
    const zero = estimateCatalogueChatCost(snapshot(), undefined, { requestInputTokens: 9000, outputChars: 0, httpStatus: null, noResponse: 'network' })!;
    expect(zero).toMatchObject({ basis: 'no-response-network', costAttoUsd: '0' });
    const sent = estimateCatalogueChatCost(snapshot(), undefined, { requestInputTokens: 9000, outputChars: 0, httpStatus: null })!;
    expect(sent.basis).toBe('request-heuristic');
    // output already received means a response existed: the network rule can never zero it
    const partial = estimateCatalogueChatCost(snapshot(), undefined, { requestInputTokens: 9000, outputChars: 40, httpStatus: null, noResponse: 'network' })!;
    expect(partial.basis).toBe('request-heuristic');
    // a reported status means a response existed: the network rule can never zero it
    const withStatus = estimateCatalogueChatCost(snapshot(), undefined, { requestInputTokens: 9000, outputChars: 0, httpStatus: 200, noResponse: 'network' })!;
    expect(withStatus.basis).toBe('request-heuristic');
  });
});

describe('review 2 — user-visible estimate wording', () => {
  it('ENGINE_COST_ESTIMATED tells the user the cost was estimated, with no markup, tariff or supplier words; admin keeps the detail', () => {
    const d = new BuildDiagnostics({ now: () => 1 });
    recordRouterOneEstimatedBill(d, { calls: 1, costUsd: 0.001, billedUsd: 0.0025, label: ROUTER_ONE_ESTIMATED_BILL_LABEL });
    const user = userFacingReport(d.report());
    const issue = user.issues.find(i => i.code === 'ENGINE_COST_ESTIMATED')!;
    expect(issue.message).toBe('This step\'s cost was estimated because the engine did not return a full usage receipt.');
    const text = JSON.stringify(user).toLowerCase();
    for (const banned of ['markup', '5/2', 'x5', 'tariff', 'router', 'engine-diag', 'estimated_bill_usd']) expect(text, banned).not.toContain(banned);
    const admin = JSON.stringify(d.report());
    expect(admin).toContain('markup=same_as_verified_x5_2');
    expect(admin).toContain('estimated_bill_usd=0.002500');
  });
});

describe('review 2 — self-heal mutation gaps', () => {
  function database(opts: { retryOnce?: boolean } = {}) {
    const rows = new Map<string, Record<string, unknown>>(); let retried = false;
    const run = async (fn: (tx: unknown) => Promise<unknown>) => {
      const writes: Array<() => void> = [];
      const tx = { get: async (ref: { path: string }) => ({ exists: rows.has(ref.path), data: () => rows.get(ref.path) }),
        create: (ref: { path: string }, v: Record<string, unknown>) => { if (rows.has(ref.path)) throw new Error('already exists'); writes.push(() => { rows.set(ref.path, v); }); },
        update: (ref: { path: string }, v: Record<string, unknown>) => { if (!rows.has(ref.path)) throw new Error('missing'); writes.push(() => { rows.set(ref.path, { ...rows.get(ref.path), ...v }); }); },
        set: (ref: { path: string }, v: Record<string, unknown>) => { writes.push(() => { rows.set(ref.path, v); }); } };
      return { value: await fn(tx), writes };
    };
    const db = { doc: (path: string) => ({ path }), runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      if (opts.retryOnce && !retried) { retried = true; await run(fn); } // contention: first attempt's writes discarded, Firestore re-runs fn
      const { value, writes } = await run(fn);
      for (const w of writes) w();
      return value;
    } } as unknown as Firestore;
    return { db, rows };
  }
  const ghosts = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`ghost${i}`, true as const]));
  const healedRows = (rows: Map<string, Record<string, unknown>>) => [...rows.entries()].filter(([k, v]) => k.startsWith('router_one_catalogue_attempts/ghost') && v.status === 'self-healed-estimate').length;

  it('heals at most 25 per reserve; the rest stay unresolved AND that key state is persisted; the next reserve finishes the job', async () => {
    const { db, rows } = database();
    rows.set('router_one_accounting_keys/key', { version: 2, active: {}, unresolved: ghosts(30) });
    const err = await new FirestoreCatalogueAttemptStore(db).reserve(binding, 'new1', 'key', snapshot(), Date.now() + 60000).catch(e => e);
    expect(routerOneAccountingGate(err)).toBe('reserve_fenced_unresolved');
    expect(healedRows(rows)).toBe(25);
    const state = rows.get('router_one_accounting_keys/key') as { unresolved: Record<string, true>; active: Record<string, number> };
    expect(Object.keys(state.unresolved)).toHaveLength(5); // persisted, not just computed
    expect(state.active.new1).toBeUndefined(); // the refused call was not admitted
    expect(rows.has('router_one_catalogue_attempts/new1')).toBe(false);
    await new FirestoreCatalogueAttemptStore(db).reserve(binding, 'new2', 'key', snapshot(), Date.now() + 60000);
    expect(healedRows(rows)).toBe(30);
    expect(rows.get('router_one_accounting_keys/key')).toMatchObject({ unresolved: {} });
  });
  it('a retried transaction does not audit (or count) the same healed lock twice', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { db, rows } = database({ retryOnce: true });
    rows.set('router_one_accounting_keys/key', { version: 2, active: {}, unresolved: ghosts(3) });
    await new FirestoreCatalogueAttemptStore(db).reserve(binding, 'new', 'key', snapshot(), Date.now() + 60000);
    const healedAudits = log.mock.calls.map(c => String(c[0])).filter(l => l.startsWith('[AUDIT] ') && l.includes('ROUTER_ONE_LOCK_SELF_HEALED'));
    expect(healedAudits).toHaveLength(3);
    expect(new Set(healedAudits.map(l => JSON.parse(l.slice('[AUDIT] '.length)).callId)).size).toBe(3);
    expect(healedRows(rows)).toBe(3);
  });
});

// Pro Chain V2 (#4239) builds its Router One rungs in proChainV2TurnRunner and hands the build's shared
// `deadRungs` to makeMultiProviderTurnRunner — so the once-per-build lock skip must hold there too.
import { createProChainV2AgentRunner, createProChainV2BuildState } from '../src/server/AgentV3/proChainV2/agentRunner';
import { proChainV2Decision } from '../src/server/AgentV3/proChainV2/policy';
import { markRestOfBuildSkip } from '../src/server/lib/engineSafeDiag';

describe('review 2 — Pro Chain V2 builds get the same once-per-build Router One lock skip', () => {
  const PARAMS: RunTurnParams = { model: 'm', messages: [{ role: 'user', content: 'fix the build' }] };
  const ok = (text: string): TurnResult => ({ text, toolUses: [], stopReason: 'end_turn',
    usage: { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, rawContent: [{ type: 'text', text }] });
  const calls = (r: TurnRunner) => (r.runTurn as ReturnType<typeof vi.fn>).mock.calls.length;
  const v2Agent = (agent: string, state: ReturnType<typeof createProChainV2BuildState>, deadRungs: Map<string, string>, r1: TurnRunner, qx: TurnRunner) =>
    createProChainV2AgentRunner({
      agent, state, env: {}, surplusRecoverable: () => true,
      // exactly what proChainV2TurnRunner passes: the multi-provider runner with the build's deadRungs
      makeChain: (rungs, hooks) => makeMultiProviderTurnRunner(rungs, { onProviderUsed: u => hooks.onUsed(u), onProviderError: (n, e) => hooks.onFailed(n, e), deadRungs }),
      providers: [{ label: 'ENGINE_R1', rungs: [{ name: 'ENGINE_R1', runner: r1, modelId: model }] }, { label: 'ENGINE_QX', rungs: [{ name: 'ENGINE_QX', runner: qx, modelId: 'qx' }] }],
    });
  it('one lock refusal in agent A retires Router One for every agent of THAT build; the next build asks again', async () => {
    const r1: TurnRunner = { runTurn: vi.fn(async () => { throw markRestOfBuildSkip(locked()); }) };
    const qx: TurnRunner = { runTurn: vi.fn(async () => ok('qx')) };
    const state = createProChainV2BuildState(), dead = new Map<string, string>();
    const a = v2Agent('builder#1', state, dead, r1, qx), b = v2Agent('writer#1', state, dead, r1, qx);
    expect((await a.runTurn(PARAMS)).text).toBe('qx');
    for (let i = 0; i < 4; i++) { expect((await b.runTurn(PARAMS)).text).toBe('qx'); expect((await a.runTurn(PARAMS)).text).toBe('qx'); }
    expect(calls(r1)).toBe(1);
    const nextBuild = v2Agent('builder#1', createProChainV2BuildState(), new Map(), r1, qx);
    await nextBuild.runTurn(PARAMS);
    expect(calls(r1)).toBe(2);
  });
  it('an ordinary Router One failure in a v2 build is NOT build-wide (agent B still starts on Router One)', async () => {
    let n = 0;
    const r1: TurnRunner = { runTurn: vi.fn(async () => { if (n++ === 0) throw new PublicBuildEngineError(); return ok('r1'); }) };
    const qx: TurnRunner = { runTurn: vi.fn(async () => ok('qx')) };
    const state = createProChainV2BuildState(), dead = new Map<string, string>();
    expect((await v2Agent('builder#1', state, dead, r1, qx).runTurn(PARAMS)).text).toBe('qx');
    expect((await v2Agent('writer#1', state, dead, r1, qx).runTurn(PARAMS)).text).toBe('r1');
    expect(dead.size).toBe(0);
  });
  it('v2 stays off for everyone but the test profile, and off entirely under its kill switch (identity unchanged)', () => {
    expect(proChainV2Decision('weak', 'someone@example.com', 'u1', {}).enabled).toBe(false);
    expect(proChainV2Decision('weak', 'z@gmail.com', null, { PRO_CHAIN_V2: 'false' }).enabled).toBe(false);
    expect(proChainV2Decision('strong', 'z@gmail.com', null, {}).enabled).toBe(false);
  });
});
