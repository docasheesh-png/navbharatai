import { describe, expect, it, vi } from 'vitest';
import deepseek from './fixtures/routerOnePublicTariffs/deepseek-jsonld.json';
import { parsePublicProductTariff } from '../src/server/AI/RouterOne/publicTariff';
import { RouterOnePublicPriceSource, type PublicPriceSnapshot } from '../src/server/AI/RouterOne/publicPriceSource';
import { cataloguePricedRouterOneClient, cataloguePricedRouterOneText, cataloguePricedRouterOneRunner,
  runInRouterOneAccountingScope, currentRouterOneCatalogueReceipts, routerOneCatalogueBuildCharges,
  isRouterOneCatalogueReceipt, type CatalogueAttemptStore } from '../src/server/AI/RouterOne/catalogueAccounting';
import type { OpenAiChatClient, OpenAiChatStream } from '../src/server/AgentV3/providers/OpenAiToolRunner';
import type { TurnRunner, TurnResult } from '../src/server/AgentV3/ClaudeClient';
import { createProviderUsageLedger } from '../src/server/AgentV3/ProviderUsageLedger';
import { realProviderCostUsd } from '../src/server/AgentV3/providerRates';
const model = 'deepseek-v4.1-flash', source = 'https://router.one/models/deepseek-v4-1-flash', now = 1000000;
const binding = { uid: 'synthetic-user', buildId: 'synthetic-build', workspaceId: 'synthetic-workspace' };
const usage = { prompt_tokens: 10000, completion_tokens: 500, total_tokens: 10500, prompt_tokens_details: { cached_tokens: 6000 } };
function snapshot(): PublicPriceSnapshot {
  const result = parsePublicProductTariff(deepseek, model, source, now);
  if (result.kind !== 'parsed-public-tariff') throw new Error('fixture failed');
  return { ...result.snapshot, sourceSha256: 'a'.repeat(64), parserVersion: 'router-one-product-jsonld-v1' };
}
function harness(raw: unknown = { model, usage, choices: [{ message: { content: 'done' } }] }) {
  const create = vi.fn(async () => raw);
  const store: CatalogueAttemptStore = { reserve: vi.fn(async () => {}), finish: vi.fn(async () => {}) };
  const prices = { snapshot: vi.fn(async () => snapshot()) };
  const client = cataloguePricedRouterOneClient({ chat: { completions: { create } } } as OpenAiChatClient, 'synthetic-credential', { store, prices, now: () => now });
  const call = () => cataloguePricedRouterOneText(() => client.chat.completions.create({ model, messages: [], max_tokens: 1000 }));
  return { create, store, prices, client, call };
}
describe('catalogue dispatch and pending spend fence', () => {
  it('persists the bound snapshot before calling; prices once without calling it settled expense', async () => {
    const h = harness(); const order: string[] = [];
    vi.mocked(h.store.reserve).mockImplementation(async () => { order.push('reserve'); });
    h.create.mockImplementation(async () => { order.push('dispatch'); return { model, usage, choices: [] }; });
    await runInRouterOneAccountingScope(binding, async () => {
      await h.call(); expect(order).toEqual(['reserve', 'dispatch']);
      const [receipt] = currentRouterOneCatalogueReceipts();
      expect(receipt).toMatchObject({ ...binding, kind: 'catalogue-calculated', settledWalletDebit: false, costAttoUsd: '3672000000000000', modelSubtotalAttoUsd: '9180000000000000' });
      expect(isRouterOneCatalogueReceipt(receipt)).toBe(true);
      expect(isRouterOneCatalogueReceipt({ ...receipt })).toBe(false);
      const ledger = createProviderUsageLedger();
      const attributed = { inputTokens: 10000, outputTokens: 500, cacheReadInputTokens: 6000, routerOneReceipt: receipt };
      ledger.add('ENGINE_R1', attributed, model); ledger.add('ENGINE_R1', attributed, model);
      expect(ledger.entries()).toHaveLength(1); expect(ledger.total().inputTokens).toBe(10000);
      expect(realProviderCostUsd(ledger.entries())).toBeCloseTo(0.003672, 12);
      expect(routerOneCatalogueBuildCharges(ledger.entries(), new Set())).toEqual({ costUsd: 0.003672, billedUsd: 0.00918, absorbedUsd: 0 });
      expect(routerOneCatalogueBuildCharges(ledger.entries(), new Set(['unused']))).toMatchObject({ billedUsd: 0.00918 });
      ledger.add('ENGINE_R1', { ...attributed, outputTokens: 501 }, model);
      expect(routerOneCatalogueBuildCharges(ledger.entries(), new Set()).billedUsd).toBe(0);
      expect(() => realProviderCostUsd(ledger.entries())).toThrow();
    });
  });
  it('rejects unpriceable/stale models or failed persistence before dispatch', async () => {
    for (const mode of ['price', 'stale', 'reserve']) {
      const h = harness();
      if (mode === 'price') h.prices.snapshot.mockRejectedValue(new Error('unpriceable'));
      if (mode === 'stale') h.prices.snapshot.mockResolvedValue({ ...snapshot(), fetchedAt: 1 });
      if (mode === 'reserve') vi.mocked(h.store.reserve).mockRejectedValue(new Error('database unavailable'));
      await expect(runInRouterOneAccountingScope(binding, h.call)).rejects.toThrow();
      expect(h.create).not.toHaveBeenCalled();
    }
  });
  it('preserves successful output with missing usage and blocks subsequent dispatch', async () => {
    const h = harness({ model, choices: [{ message: { content: 'preserve this' } }] });
    await runInRouterOneAccountingScope(binding, async () => {
      expect(await h.call()).toMatchObject({ choices: [{ message: { content: 'preserve this' } }] });
      expect(h.store.finish).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.objectContaining({ kind: 'pending', reason: 'incomplete-usage' }));
      await expect(h.call()).rejects.toThrow(); expect(h.create).toHaveBeenCalledTimes(1);
      expect(currentRouterOneCatalogueReceipts()).toEqual([]);
    });
  });
  it('does not replay a response when final persistence fails', async () => {
    const h = harness(); vi.mocked(h.store.finish).mockRejectedValue(new Error('write uncertain'));
    await runInRouterOneAccountingScope(binding, async () => {
      expect(await h.call()).toMatchObject({ model });
      await expect(h.call()).rejects.toThrow(); expect(h.create).toHaveBeenCalledTimes(1);
      expect(currentRouterOneCatalogueReceipts()).toEqual([]);
    });
  });
  it('requires a bound request scope and fences transport ambiguity', async () => {
    const h = harness(); await expect(h.call()).rejects.toThrow(); expect(h.create).not.toHaveBeenCalled();
    h.create.mockRejectedValue(new Error('connection lost'));
    await runInRouterOneAccountingScope(binding, async () => {
      await expect(h.call()).rejects.toThrow('connection lost');
      await expect(h.call()).rejects.toThrow(); expect(h.create).toHaveBeenCalledTimes(1);
      expect(h.store.finish).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.objectContaining({ kind: 'pending' }));
    });
  });
  it('observes final streaming usage; incomplete streams remain pending', async () => {
    const stream: OpenAiChatStream = { async *[Symbol.asyncIterator]() { yield { model, choices: [{ delta: { content: 'done' } }] }; yield { model, usage }; } };
    const h = harness(stream);
    await runInRouterOneAccountingScope(binding, async () => {
      await cataloguePricedRouterOneText(async () => {
        const r = await h.client.chat.completions.create({ model, messages: [], max_tokens: 1000, stream: true });
        for await (const _ of r as OpenAiChatStream) { /* consume */ }
      });
      expect(currentRouterOneCatalogueReceipts()).toHaveLength(1);
    });
    const partial = harness(stream);
    await runInRouterOneAccountingScope(binding, async () => {
      await cataloguePricedRouterOneText(async () => {
        const r = await partial.client.chat.completions.create({ model, messages: [], max_tokens: 1000, stream: true });
        await (r as OpenAiChatStream)[Symbol.asyncIterator]().next(); // same early-exit shape as runner deadlines
      });
      await expect(partial.call()).rejects.toThrow(); expect(currentRouterOneCatalogueReceipts()).toHaveLength(0);
    });
  });
  it('attaches issued evidence to runner results without changing output', async () => {
    const h = harness(); const inner = { runTurn: async () => { await h.client.chat.completions.create({ model, messages: [], max_tokens: 1000 });
      return { text: 'preserved', model, usage: { inputTokens: 10000, outputTokens: 500, cacheReadInputTokens: 6000, cacheCreationInputTokens: 0 } } as TurnResult; } } as TurnRunner;
    await runInRouterOneAccountingScope(binding, async () => {
      const r = await cataloguePricedRouterOneRunner(inner).runTurn({} as never);
      expect(r.text).toBe('preserved'); expect(isRouterOneCatalogueReceipt(r.usage.routerOneReceipt)).toBe(true);
    });
  });
});
describe('public-page source with synthetic HTTP responses', () => {
  it('requires a discovered URL and matching Product SKU; caches only fresh immutable snapshots', async () => {
    const html = `<script type="application/ld+json">${JSON.stringify(deepseek)}</script>`;
    const transport = vi.fn(async (url: string) => new Response(url.endsWith('/models') ? '<a href="/models/deepseek-v4-1-flash">model</a>' : html, { headers: { 'content-type': 'text/html' } }));
    let clock = now; const prices = new RouterOnePublicPriceSource(transport as typeof fetch, () => clock);
    const a = await prices.snapshot(model); expect(a.bands[0].cacheReadUsdPerMillion).toBe('0.012000');
    expect(Object.isFrozen(a.bands[0])).toBe(true); expect(a.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(await prices.snapshot(model)).toBe(a); expect(transport).toHaveBeenCalledTimes(2);
    clock += 300001; await prices.snapshot(model); expect(transport).toHaveBeenCalledTimes(4);
    await expect(prices.snapshot('auto')).rejects.toThrow();
    await expect(prices.snapshot('wrong-model')).rejects.toThrow();
  });
  it('fails closed on unavailable pages without returning a stale tariff', async () => {
    const transport = vi.fn(async () => new Response('denied', { status: 403 }));
    const prices = new RouterOnePublicPriceSource(transport as typeof fetch, () => now);
    await expect(prices.snapshot(model)).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
