/**
 * BR2388 (owner 2026-11-15) — "surplus kyu band hua? routerone kyu nahi chala??"
 *
 * Fix 1  visibility: a supplier-free gate / stage / HTTP status behind every folded "build engine
 *        temporarily unavailable", in the server log and the ADMIN report only. User copy unchanged.
 * Fix 2  a reserve refused by an unresolved lock retires that Router One key for the rest of THAT build
 *        (one refusal, not 28, and no Firestore transaction per try). Other gates and builds unchanged.
 * Billing policy hold: missing/invalid usage remains pending, with no customer estimate charge.
 * Two-sided throughout: what must change, and what must not.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const circuitMocks = vi.hoisted(() => ({ death: vi.fn(), success: vi.fn() }));
vi.mock('../src/server/AI/SurplusRegistry/surplusAdmitCircuit', () => ({
  recordSurplusMidBuildDeath: (...a: unknown[]) => circuitMocks.death(...a),
  recordSurplusAdmitProbeSuccess: (...a: unknown[]) => circuitMocks.success(...a),
}));

import deepseek from './fixtures/routerOnePublicTariffs/deepseek-jsonld.json';
import { parsePublicProductTariff } from '../src/server/AI/RouterOne/publicTariff';
import type { PublicPriceSnapshot } from '../src/server/AI/RouterOne/publicPriceSource';
import { RouterOneAccountingUnavailableError, routerOneAccountingGate } from '../src/server/AI/RouterOne/accounting';
import {
  cataloguePricedRouterOneClient, cataloguePricedRouterOneText, runInRouterOneAccountingScope,
  currentRouterOneCatalogueReceipts,
  recordRouterOneEstimatedBill, ROUTER_ONE_ESTIMATED_BILL_LABEL,
  type CatalogueAttemptStore,
} from '../src/server/AI/RouterOne/catalogueAccounting';
import { estimateCatalogueChatCost } from '../src/server/AI/RouterOne/catalogueMath';
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

describe('estimate integrity: missing is not contradictory', () => {
  it.each([
    { ...usage, total_tokens: 1 },
    { prompt_tokens: 100, total_tokens: 1 },
    { completion_tokens: 100, total_tokens: 1 },
    { total_tokens: 1, cached_tokens: 2 },
    { ...usage, prompt_tokens: -1 },
    { ...usage, prompt_tokens_details: 'invalid' },
    { ...usage, prompt_tokens_details: { cached_tokens: 10001 } },
    { ...usage, cached_tokens: 5999 },
    { ...usage, prompt_cache_hit_tokens: 5999 },
    { ...usage, prompt_tokens_details: { cached_tokens: 6000, cache_write_tokens: 1 } },
  ])('rejects contradictory/malformed usage, rather than billing a fallback', async invalid => {
    expect(estimateCatalogueChatCost(snapshot(), invalid, { requestInputTokens: 100, outputChars: 100 })).toBeNull();
    const h = harness({ raw: { model, usage: invalid, choices: [{ message: { content: 'done' } }] } });
    await runInRouterOneAccountingScope(binding, async () => {
      await h.call();
      expect(currentRouterOneCatalogueReceipts()).toEqual([]);
    });
    expect(h.store.releaseVerified).not.toHaveBeenCalled();
    expect(h.store.finish).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.objectContaining({ kind: 'pending' }));
  });
  it('does not price a different response model with the requested model tariff', async () => {
    const h = harness({ raw: { model: 'different-model', usage, choices: [{ message: { content: 'done' } }] } });
    await runInRouterOneAccountingScope(binding, async () => {
      await h.call();
      expect(currentRouterOneCatalogueReceipts()).toEqual([]);
    });
    expect(h.store.releaseVerified).not.toHaveBeenCalled();
  });
  it('does not price conflicting stream receipts even when the last one alone is valid', async () => {
    const stream: OpenAiChatStream = { async *[Symbol.asyncIterator]() {
      yield { model, usage };
      yield { model, usage: { ...usage, completion_tokens: 501, total_tokens: 10501 } };
    } };
    const h = harness({ raw: stream });
    await runInRouterOneAccountingScope(binding, async () => {
      await cataloguePricedRouterOneText(async () => {
        const response = await h.client.chat.completions.create({ model, messages: [], max_tokens: 1000, stream: true });
        for await (const _chunk of response as OpenAiChatStream) { /* exhaust */ }
      });
      expect(currentRouterOneCatalogueReceipts()).toEqual([]);
    });
    expect(h.store.releaseVerified).not.toHaveBeenCalled();
  });
});

describe('policy hold preserves pending expense', () => {
  it('does not issue a billable estimate when genuine usage is missing', async () => {
    const h = harness({ raw: { model, choices: [{ message: { content: 'done' } }] } });
    await runInRouterOneAccountingScope(binding, async () => {
      await h.call();
      expect(currentRouterOneCatalogueReceipts()).toEqual([]);
      await expect(h.call()).rejects.toThrow();
    });
    expect(h.store.releaseVerified).not.toHaveBeenCalled();
    expect(h.store.finish).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.objectContaining({ kind: 'pending' }));
  });
});

describe('finalizers await shared persistence', () => {
  it('does not resolve the outer finalizer while an iterator close is still persisting', async () => {
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let signalStarted!: () => void;
    const started = new Promise<void>(resolve => { signalStarted = resolve; });
    const finish = vi.fn(async () => { signalStarted(); await held; });
    const stream: OpenAiChatStream = { async *[Symbol.asyncIterator]() {
      yield { model, choices: [{ delta: { content: 'abcd' } }] };
    } };
    const h = harness({ raw: stream, store: { finish } });
    let closed!: Promise<unknown>; let outerDone = false;
    await runInRouterOneAccountingScope(binding, async () => {
      const outer = cataloguePricedRouterOneText(async () => {
        const response = await h.client.chat.completions.create({ model, messages: [], max_tokens: 1000, stream: true });
        const iterator = (response as OpenAiChatStream)[Symbol.asyncIterator]();
        await iterator.next();
        closed = Promise.resolve(iterator.return?.());
        // Let close start persistence without awaiting its completion.
        await started;
      }).then(() => { outerDone = true; });
      await started;
      await Promise.resolve(); await Promise.resolve();
      expect(outerDone).toBe(false);
      expect(finish).toHaveBeenCalledTimes(1);
      release();
      await closed; await outer;
      expect(outerDone).toBe(true);
      expect(currentRouterOneCatalogueReceipts()).toEqual([]);
    });
  });
});
