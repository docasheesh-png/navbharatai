import { describe, expect, it } from 'vitest';
import { parsePublicProductTariff, parsePublicTariffHtml } from '../scripts/lib/routerOnePublicTariff';
const component = (name: string, price: string) => ({ name, price, referenceQuantity: { value: 1000000, unitText: 'tokens' } });
const offer = () => ({ priceCurrency: 'USD', priceSpecification: { priceComponent: [
  component('Input tokens', '0.60'), component('Output tokens', '2.40'),
  component('Cache write tokens', '0.60'), component('Cached input tokens', '0.012'),
] } });
const product = () => ({ '@type': 'Product', sku: 'synthetic-model', offers: [offer()] });
const parse = (v: unknown) => parsePublicProductTariff(v, 'synthetic-model', 'https://router.one/models/synthetic-model', 1000);
describe('offline observed public JSON-LD tariff contract', () => {
  it('accepts explicit units and exact identity without authorizing billing', () => {
    expect(parse(product())).toMatchObject({ kind: 'parsed-public-tariff', billingAuthorized: false,
      snapshot: { model: 'synthetic-model', bands: [{ aboveInputTokens: -1, inputUsdPerMillion: '0.60', cacheReadUsdPerMillion: '0.012' }] } });
  });
  it('supports a graph but rejects multiple product identities', () => {
    expect(parse({ '@graph': [product()] })).toMatchObject({ kind: 'parsed-public-tariff' });
    expect(parse([product(), product()])).toMatchObject({ kind: 'unpriceable' });
    expect(parse({ ...product(), sku: 'different' })).toMatchObject({ kind: 'unpriceable' });
  });
  it.each(['EUR', '$undefined', null])('rejects unsupported currency %s', currency => {
    expect(parse({ ...product(), offers: [{ ...offer(), priceCurrency: currency }] })).toMatchObject({ kind: 'unpriceable' });
  });
  it('rejects unknown, absent and duplicate components', () => {
    for (const components of [offer().priceSpecification.priceComponent.slice(1),
      [...offer().priceSpecification.priceComponent, component('Input tokens', '1')],
      [...offer().priceSpecification.priceComponent, component('Image tokens', '1')]]) {
      expect(parse({ ...product(), offers: [{ ...offer(), priceSpecification: { priceComponent: components } }] })).toMatchObject({ kind: 'unpriceable' });
    }
  });
  it('rejects missing units and per-token numbers instead of guessing a multiplier', () => {
    for (const value of [1, '1000000', null]) {
      const p = product(); (p.offers[0].priceSpecification.priceComponent[0].referenceQuantity as Record<string, unknown>).value = value;
      expect(parse(p)).toMatchObject({ kind: 'unpriceable', reason: 'unsupported-token-unit' });
    }
  });
  it('requires contiguous nonoverlapping complete whole-request tiers', () => {
    const tiers = (min: number, max = 272000) => ({ ...product(), offers: [
      { ...offer(), eligibleQuantity: { maxValue: max, unitText: 'input tokens' } },
      { ...offer(), eligibleQuantity: { minValue: min, unitText: 'input tokens' } },
    ] });
    expect(parse(tiers(272001))).toMatchObject({ kind: 'parsed-public-tariff', snapshot: { bands: [
      { aboveInputTokens: -1 }, { aboveInputTokens: 272000 },
    ] } });
    for (const min of [272000, 272002, -1, 1.5]) expect(parse(tiers(min))).toMatchObject({ kind: 'unpriceable' });
    expect(parse({ ...product(), offers: [{ ...offer(), eligibleQuantity: { maxValue: 272000, unitText: 'input tokens' } }] })).toMatchObject({ kind: 'unpriceable' });
  });
  it('excludes distinct cache-write tariffs until Chat usage can price them', () => {
    const p = product(); p.offers[0].priceSpecification.priceComponent[2].price = '0.75';
    expect(parse(p)).toMatchObject({ kind: 'unpriceable', reason: 'unsupported-chat-cache-write-tariff' });
  });
  it.each(['$undefined', '-1', '1e-4', 'NaN'])('rejects malformed price %s', price => {
    const p = product(); p.offers[0].priceSpecification.priceComponent[0].price = price;
    expect(parse(p)).toMatchObject({ kind: 'unpriceable' });
  });
});

describe('inert JSON-LD extraction', () => {
  const html = (body: string) => `<html><script>throw new Error('must not execute')</script><script type="application/ld+json">${body}</script></html>`;
  const parseHtml = (body: string) => parsePublicTariffHtml(body, 'synthetic-model', 'https://router.one/models/synthetic-model', 1000);
  it('ignores executable scripts and reads only valid JSON-LD', () => {
    expect(parseHtml(html(JSON.stringify(product())))).toMatchObject({ kind: 'parsed-public-tariff' });
    expect(parseHtml(html('{broken'))).toMatchObject({ kind: 'unpriceable', reason: 'invalid-jsonld' });
    expect(parseHtml('<script>window.price = 1</script>')).toMatchObject({ kind: 'unpriceable' });
  });
  it('rejects duplicate products across scripts', () => {
    const block = html(JSON.stringify(product()));
    expect(parseHtml(block + block)).toMatchObject({ kind: 'unpriceable' });
  });
});
