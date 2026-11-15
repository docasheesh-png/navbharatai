import { describe, expect, it, vi } from 'vitest';
import deepseek from './fixtures/routerOnePublicTariffs/deepseek-jsonld.json';
import { parsePublicProductTariff } from '../src/server/AI/RouterOne/publicTariff';
import type { PublicPriceSnapshot } from '../src/server/AI/RouterOne/publicPriceSource';
import {
  cataloguePricedRouterOneClient, cataloguePricedRouterOneText, runInRouterOneAccountingScope,
  currentRouterOneCatalogueReceipts, type CatalogueAttemptStore,
} from '../src/server/AI/RouterOne/catalogueAccounting';
import { estimateCatalogueChatCost } from '../src/server/AI/RouterOne/catalogueMath';
import type { OpenAiChatClient, OpenAiChatStream } from '../src/server/AgentV3/providers/OpenAiToolRunner';

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
