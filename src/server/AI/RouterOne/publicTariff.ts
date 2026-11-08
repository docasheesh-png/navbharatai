/** Strict reader for observed public Product JSON-LD, not a supplier debit receipt.
 * Offline until authentic page fixtures and the production snapshot path are verified.
 */
import { catalogueSnapshotIssue, type CatalogueSnapshot, type CatalogueRateBand } from './catalogueMath';
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const array = (v: unknown): unknown[] => Array.isArray(v) ? v : [v];
const decimal = (v: unknown): string | null => {
  const s = typeof v === 'number' && Number.isFinite(v) ? String(v) : v;
  return typeof s === 'string' && /^(?:0|[1-9]\d{0,6})(?:\.\d{1,9})?$/.test(s) ? s : null;
};
export type PublicTariffResult = { kind: 'parsed-public-tariff'; billingAuthorized: false; snapshot: CatalogueSnapshot }
  | { kind: 'unpriceable'; billingAuthorized: false; reason: string };
const reject = (reason: string): PublicTariffResult => ({ kind: 'unpriceable', billingAuthorized: false, reason });
/** Input is a decoded JSON-LD script. No price inference from numeric magnitude. */
export function parsePublicProductTariff(document: unknown, model: string, source: string, fetchedAt: number): PublicTariffResult {
  const roots = array(document).flatMap(v => object(v) && Array.isArray(v['@graph']) ? v['@graph'] : [v]);
  const products = roots.filter(v => object(v) && v['@type'] === 'Product');
  if (products.length !== 1 || !object(products[0]) || products[0].sku !== model) return reject('ambiguous-product-or-model');
  const offers = array(products[0].offers);
  if (!offers.length || offers.length > 16) return reject('invalid-offers');
  const bands: Array<{ min: number; max: number; band: CatalogueRateBand }> = [];
  for (const offer of offers) {
    if (!object(offer) || offer['@type'] !== 'Offer' || typeof offer.name !== 'string' || !offer.name.startsWith('Pay-as-you-go, input rate per 1M tokens') || offer.priceCurrency !== 'USD' || !object(offer.priceSpecification)) return reject('invalid-currency-or-specification');
    if (offer.availability !== 'https://schema.org/InStock') return reject('unavailable-offer');
    if (offer.priceSpecification['@type'] !== 'CompoundPriceSpecification' || offer.priceSpecification.priceCurrency !== 'USD') return reject('conflicting-currency');
    const components = array(offer.priceSpecification.priceComponent);
    const names = ['Input tokens', 'Output tokens', 'Cache write tokens', 'Cached input tokens'];
    const prices = new Map<string, string>();
    for (const component of components) {
      if (!object(component) || typeof component.name !== 'string' || !names.includes(component.name)
        || prices.has(component.name)) return reject('ambiguous-components');
      if (component.priceCurrency !== undefined && component.priceCurrency !== 'USD') return reject('conflicting-currency');
      const quantity = component.referenceQuantity;
      if (!object(quantity) || quantity.value !== 1_000_000 || quantity.unitText !== 'tokens') return reject('unsupported-token-unit');
      const price = decimal(component.price);
      if (price === null) return reject('invalid-price');
      prices.set(component.name, price);
    }
    if (prices.size !== names.length) return reject('missing-component');
    if (decimal(offer.price) === null || decimal(offer.priceSpecification.price) === null
      || Number(offer.price) !== Number(prices.get('Input tokens')) || Number(offer.priceSpecification.price) !== Number(prices.get('Input tokens'))) return reject('conflicting-input-price');
    let min = 0, max = Number.MAX_SAFE_INTEGER;
    if (offer.eligibleQuantity !== undefined) {
      const q = offer.eligibleQuantity;
      if (!object(q) || q.unitText !== 'input tokens') return reject('unsupported-tier-unit');
      if (q.minValue !== undefined) {
        if (!Number.isSafeInteger(q.minValue) || (q.minValue as number) < 0) return reject('invalid-tier-boundary');
        min = q.minValue as number;
      }
      if (q.maxValue !== undefined) {
        if (!Number.isSafeInteger(q.maxValue) || (q.maxValue as number) < min) return reject('invalid-tier-boundary');
        max = q.maxValue as number;
      }
    }
    bands.push({ min, max, band: { aboveInputTokens: min - 1,
      inputUsdPerMillion: prices.get('Input tokens')!, outputUsdPerMillion: prices.get('Output tokens')!,
      cacheWriteUsdPerMillion: prices.get('Cache write tokens')!, cacheReadUsdPerMillion: prices.get('Cached input tokens')! } });
  }
  bands.sort((a, b) => a.min - b.min);
  if (bands[0].min !== 0 || bands.at(-1)!.max !== Number.MAX_SAFE_INTEGER
    || bands.some((b, i) => i > 0 && (bands[i - 1].max === Number.MAX_SAFE_INTEGER || b.min !== bands[i - 1].max + 1))) return reject('incomplete-or-overlapping-tiers');
  const snapshot: CatalogueSnapshot = { kind: 'posted-wallet-token-tariff', provider: 'ENGINE_R1', model,
    currency: 'USD', unit: 'USD/1000000-tokens', source, fetchedAt, bands: bands.map(b => b.band) };
  const issue = catalogueSnapshotIssue(snapshot, fetchedAt, 1);
  return issue ? reject(issue) : { kind: 'parsed-public-tariff', billingAuthorized: false, snapshot };
}

/** Decode inert JSON-LD only; never execute page scripts or Next Flight payloads. */
export function parsePublicTariffHtml(html: string, model: string, source: string, fetchedAt: number): PublicTariffResult {
  if (typeof html !== 'string' || html.length > 4_000_000) return reject('invalid-page-size');
  const roots: unknown[] = [];
  const script = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  for (const match of html.matchAll(script)) {
    const attributes = match[1];
    const types = [...attributes.matchAll(/(?:^|\s)type\s*=\s*(["'])(.*?)\1/gi)];
    if (types.length !== 1 || types[0][2].toLowerCase() !== 'application/ld+json') continue;
    try { roots.push(JSON.parse(match[2])); } catch { return reject('invalid-jsonld'); }
  }
  const flattened = roots.flatMap(root => array(root).flatMap(v => object(v) && Array.isArray(v['@graph']) ? v['@graph'] : [v]));
  return parsePublicProductTariff(flattened, model, source, fetchedAt);
}
