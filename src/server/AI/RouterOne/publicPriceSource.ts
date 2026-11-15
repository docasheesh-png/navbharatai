import { createHash } from 'node:crypto';
import { parsePublicTariffHtml } from './publicTariff';
import { catalogueSnapshotIssue, type CatalogueSnapshot } from './catalogueMath';
import { RouterOneAccountingUnavailableError } from './accounting';

export interface PublicPriceSnapshot extends CatalogueSnapshot {
  sourceSha256: string;
  parserVersion: 'router-one-product-jsonld-v1';
}
export const ROUTER_ONE_PRICE_MAX_AGE_MS = 5 * 60_000;
const SOURCE = 'https://router.one';
const LIMIT = 4_000_000;
/** No redirects, credentials, scripts or magnitude-based unit guesses. */
async function page(url: string, transport: typeof fetch): Promise<string> {
  const response = await transport(url, { redirect: 'error', headers: { Accept: 'text/html' }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok || !/text\/html/i.test(response.headers.get('content-type') ?? '') || !response.body) throw new RouterOneAccountingUnavailableError('public-price-source');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > LIMIT) throw new RouterOneAccountingUnavailableError('public-price-source');
      chunks.push(part.value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}
/** Model slugs are discovery hints only: the actual Product SKU must match exactly.
 * Unsupported aliases and variants are excluded, never translated into billable IDs.
 */
export class RouterOnePublicPriceSource {
  private index: { at: number; links: string[] } | null = null;
  private indexJob: Promise<string[]> | null = null;
  private readonly cache = new Map<string, PublicPriceSnapshot>();
  private readonly inflight = new Map<string, Promise<PublicPriceSnapshot>>();
  constructor(private readonly transport: typeof fetch = fetch, private readonly now = Date.now) {}
  async snapshot(model: string): Promise<PublicPriceSnapshot> {
    const cached = this.cache.get(model);
    if (cached && !catalogueSnapshotIssue(cached, this.now(), ROUTER_ONE_PRICE_MAX_AGE_MS)) return cached;
    const pending = this.inflight.get(model); if (pending) return pending;
    const job = this.load(model); this.inflight.set(model, job);
    try { return await job; } finally { this.inflight.delete(model); }
  }
  private async links(): Promise<string[]> {
    if (this.index && this.now() - this.index.at <= ROUTER_ONE_PRICE_MAX_AGE_MS) return this.index.links;
    if (this.indexJob) return this.indexJob;
    this.indexJob = (async () => {
      const html = await page(`${SOURCE}/models`, this.transport);
      const links = [...new Set([...html.matchAll(/\bhref\s*=\s*(["'])(\/models\/[a-z0-9-]+)\1/gi)].map(m => m[2]))];
      if (!links.length || links.length > 500) throw new RouterOneAccountingUnavailableError('public-price-source');
      this.index = { at: this.now(), links }; return links;
    })();
    try { return await this.indexJob; } finally { this.indexJob = null; }
  }
  private async load(model: string): Promise<PublicPriceSnapshot> {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,199}$/.test(model) || model === 'auto') throw new RouterOneAccountingUnavailableError('public-price-source');
    const links = await this.links();
    const slugHint = model.split('/').at(-1)!.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const path = `/models/${slugHint}`;
    if (!links.includes(path)) throw new RouterOneAccountingUnavailableError('public-price-source');
    const source = `${SOURCE}${path}`;
    const html = await page(source, this.transport);
    const fetchedAt = this.now();
    const parsed = parsePublicTariffHtml(html, model, source, fetchedAt);
    if (parsed.kind !== 'parsed-public-tariff') throw new RouterOneAccountingUnavailableError('public-price-source');
    const snapshot: PublicPriceSnapshot = Object.freeze({ ...parsed.snapshot,
      bands: Object.freeze(parsed.snapshot.bands.map(b => Object.freeze({ ...b }))),
      sourceSha256: createHash('sha256').update(html).digest('hex'), parserVersion: 'router-one-product-jsonld-v1' });
    this.cache.set(model, snapshot); return snapshot;
  }
}

export const routerOnePublicPrices = new RouterOnePublicPriceSource();
