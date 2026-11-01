import { describe, expect, it } from 'vitest';
import { cataloguePricedRouterOneClient, cataloguePricedRouterOneText, runInRouterOneAccountingScope, currentRouterOneCatalogueReceipts } from '../src/server/AI/RouterOne/catalogueAccounting';
import { createProviderUsageLedger } from '../src/server/AgentV3/ProviderUsageLedger';
import { decideBuildBilledUsd } from '../src/server/routes/agentv3';
import { applyBuildDiscount } from '../src/server/lib/buildDiscount';
import { proSandboxFee } from '../src/server/AgentV3/proSandboxFee';
import type { OpenAiChatClient } from '../src/server/AgentV3/providers/OpenAiToolRunner';
import type { PublicPriceSnapshot } from '../src/server/AI/RouterOne/publicPriceSource';
const model = 'synthetic-priced-model';
const snapshot: PublicPriceSnapshot = { kind: 'posted-wallet-token-tariff', provider: 'ENGINE_R1', model, currency: 'USD',
  unit: 'USD/1000000-tokens', source: 'https://router.one/models/synthetic-priced-model', fetchedAt: 1000,
  sourceSha256: 'a'.repeat(64), parserVersion: 'router-one-product-jsonld-v1',
  bands: [{ aboveInputTokens: -1, inputUsdPerMillion: '1', outputUsdPerMillion: '2', cacheReadUsdPerMillion: '0.1', cacheWriteUsdPerMillion: '1' }] };
async function ledger(phase?: string) {
  return runInRouterOneAccountingScope({ buildId: 'synthetic', uid: 'synthetic', workspaceId: 'synthetic' }, async () => {
    const client = cataloguePricedRouterOneClient({ chat: { completions: { create: async () => ({ model,
      usage: { prompt_tokens: 1000, completion_tokens: 500, prompt_tokens_details: { cached_tokens: 500 } }, choices: [] }) } } } as OpenAiChatClient,
      'synthetic', { prices: { snapshot: async () => snapshot }, store: { reserve: async () => {}, finish: async () => {} }, now: () => 1000 });
    await cataloguePricedRouterOneText(() => client.chat.completions.create({ model, max_tokens: 1000, messages: [] }));
    const l = createProviderUsageLedger();
    l.add('ENGINE_R1', { inputTokens: 1000, outputTokens: 500, cacheReadInputTokens: 500, routerOneReceipt: currentRouterOneCatalogueReceipts()[0] }, model, { phase });
    return l;
  });
}
describe('prospective Router One build settlement', () => {
  it('prices inclusive caches and applies 2.5 once, then discount and 2.5% sandbox subtotal fee', async () => {
    const l = await ledger();
    const result = decideBuildBilledUsd(l, l.total(), 'weak', 'synthetic', null, 99);
    // .0005 ordinary + .00005 cache + .001 output = .00155. No legacy 4x or VM markup.
    expect(result.realCostUsd).toBeCloseTo(.00155, 12);
    expect(result.effectiveBilledUsd).toBeCloseTo(.003875, 12);
    expect(result.sandboxUsd).toBe(99); // internal expense remains distinct
    const discount = applyBuildDiscount({ billedUsd: result.effectiveBilledUsd, floorUsd: result.realCostUsd, pct: 10 });
    expect(proSandboxFee(discount.payUsd).totalUsd).toBeCloseTo(.003875 * .9 * 1.025, 12);
    const floor = applyBuildDiscount({ billedUsd: result.realCostUsd * 1.1, floorUsd: result.realCostUsd, pct: 50 });
    expect(proSandboxFee(floor.payUsd).totalUsd).toBeCloseTo(.00155 * 1.025, 12);
  });
  it('isolates ordinary provider markup from Router One in mixed builds', async () => {
    const mixed = await ledger(), ordinary = createProviderUsageLedger();
    const u = { inputTokens: 1000, outputTokens: 100 };
    mixed.add('GLM', u, 'glm-5.2'); ordinary.add('GLM', u, 'glm-5.2');
    const base = decideBuildBilledUsd(ordinary, ordinary.total(), 'weak', 'synthetic', null);
    const result = decideBuildBilledUsd(mixed, mixed.total(), 'weak', 'synthetic', null);
    expect(result.effectiveBilledUsd).toBeCloseTo(base.effectiveBilledUsd + .003875, 12);
  });
  it('preserves barren-phase absorption with expense auditability', async () => {
    const l = await ledger('barren');
    const result = decideBuildBilledUsd(l, l.total(), 'weak', 'synthetic', null, 0, new Set(['barren']));
    expect(result.effectiveBilledUsd).toBe(0); expect(result.absorbedUnbilledUsd).toBeCloseTo(.00155, 12);
    expect(proSandboxFee(result.effectiveBilledUsd).feeUsd).toBe(0);
  });
});
