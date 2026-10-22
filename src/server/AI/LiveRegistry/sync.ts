import { randomUUID } from 'node:crypto';
import { endpointUrl, normalizeModel, parseCatalog, zero } from './eligibility';
import type { CatalogManifest, RegistryStore } from './types';
export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
export interface RegistryConfig {
  enabled: boolean; strictFreeModulesEnabled: boolean; strictFreeWeakEnabled: boolean; apiKey: string; syncIntervalMs: number; metadataTtlMs: number;
}
export type FetchLike = typeof fetch;

/** No arbitrary hosts, redirects, credentials in URL, or unbounded bodies. */
export async function catalogJson(url: string, apiKey: string | null, fetcher: FetchLike, signal: AbortSignal): Promise<unknown> {
  if (!url.startsWith(`${OPENROUTER_MODELS_URL}/`) && url !== OPENROUTER_MODELS_URL) throw new Error('Catalog URL rejected');
  const response = await fetcher(url, { redirect: 'error', signal, headers: apiKey ? { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } : { Accept: 'application/json' } });
  if (!response.ok) {
    const error = new Error(`Catalog HTTP ${response.status}`) as Error & { status: number; retryAfter: string | null };
    error.status = response.status; error.retryAfter = response.headers.get('retry-after'); throw error;
  }
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > 12_000_000) throw new Error('Catalog body too large');
  if (!response.body) throw new Error('Empty catalog body');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 12_000_000) throw new Error('Catalog body too large'); chunks.push(part.value); }
  } finally { await reader.cancel().catch(() => {}); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export function retryAfterMs(value: string | null | undefined, now: number): number | null {
  if (!value) return null;
  if (/^\d+$/.test(value)) return Math.min(86400000, Number(value) * 1000);
  const time = Date.parse(value); return Number.isFinite(time) ? Math.max(0, Math.min(86400000, time - now)) : null;
}
export class RegistrySynchronizer {
  private inFlight: Promise<{ status: 'synced' | 'held' | 'disabled'; version?: string }> | null = null;
  constructor(private readonly store: RegistryStore, private readonly config: () => RegistryConfig, private readonly fetcher: FetchLike = fetch, private readonly now = Date.now, private readonly delay = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(new Error('Aborted')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal.addEventListener('abort', onAbort, { once: true }); if (signal.aborted) onAbort();
  })) {}
  sync(): Promise<{ status: 'synced' | 'held' | 'disabled'; version?: string }> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.run().finally(() => { this.inFlight = null; }); return this.inFlight;
  }
  private async fetchCatalog(url: string, key: string | null, signal: AbortSignal): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      try { return await catalogJson(url, key, this.fetcher, signal); }
      catch (error) {
        const e = error as { status?: number; retryAfter?: string; retryAt?: number };
        const wait = retryAfterMs(e.retryAfter, this.now());
        if (wait !== null) e.retryAt = this.now() + wait;
        if (signal.aborted || attempt >= 2 || (e.status !== 429 && !(e.status && e.status >= 500)) || (wait !== null && wait > 10000)) throw error;
        await this.delay(wait ?? Math.floor(500 * 2 ** attempt * (0.8 + Math.random() * 0.4)), signal);
      }
    }
  }
  private async run(): Promise<{ status: 'synced' | 'held' | 'disabled'; version?: string }> {
    const cfg = this.config(); if (!cfg.enabled) return { status: 'disabled' };
    const lease = await this.store.claim(this.now(), 120000); if (!lease) return { status: 'held' };
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 90000);
    try {
      const previous = await this.store.read();
      const raw = parseCatalog(await this.fetchCatalog(OPENROUTER_MODELS_URL, null, controller.signal));
      let account = new Set<string>();
      if (cfg.apiKey) account = new Set(parseCatalog(await this.fetchCatalog(`${OPENROUTER_MODELS_URL}/user`, cfg.apiKey, controller.signal), true).filter(m => zero(m.pricing?.prompt) && zero(m.pricing?.completion)).map(m => m.id));
      const fetchedAt = this.now(); const version = randomUUID();
      const models = [];
      for (const model of raw) {
        let endpoints: unknown = null;
        if (account.has(model.id) && zero(model.pricing?.prompt) && zero(model.pricing?.completion)) {
          // A failed endpoint read cannot authorize this model, but does not erase the complete catalog.
          try { endpoints = await catalogJson(endpointUrl(model.id), cfg.apiKey || null, this.fetcher, controller.signal); } catch (error) {
            const e = error as { status?: number; retryAfter?: string; retryAt?: number };
            if (e.status === 429 || e.status === 401 || e.status === 403) {
              e.retryAt = this.now() + (retryAfterMs(e.retryAfter, this.now()) ?? 60000); throw error;
            }
            // Other endpoint failures classify this model UNKNOWN, never free by name.
          }
        }
        models.push(normalizeModel(model, endpoints, account.has(model.id), fetchedAt, cfg.metadataTtlMs, version));
      }
      if (controller.signal.aborted) throw new Error('Catalog sync timed out');
      const old = new Map(previous.models.map(m => [m.exactModelId, m]));
      const ids = new Set(models.map(m => m.exactModelId));
      const transitions = { discovered: 0, becameFree: 0, becamePaid: 0, removed: previous.models.filter(m => !ids.has(m.exactModelId)).length };
      for (const model of models) {
        const before = old.get(model.exactModelId);
        if (!before) transitions.discovered++;
        if (model.eligibilityStatus === 'VERIFIED_FREE' && before?.eligibilityStatus !== 'VERIFIED_FREE') transitions.becameFree++;
        if (model.eligibilityStatus === 'PAID' && before?.eligibilityStatus === 'VERIFIED_FREE') transitions.becamePaid++;
      }
      const manifest: CatalogManifest = { version, count: models.length, fetchedAt, expiresAt: fetchedAt + cfg.metadataTtlMs, accountVerified: !!cfg.apiKey, transitions };
      await this.store.publish(lease, models, manifest);
      return { status: 'synced', version };
    } catch (error) {
      const status = Number((error as { status?: number }).status);
      await this.store.fail(lease, this.now(), Number.isFinite(status) ? `Catalog HTTP ${status}` : 'Catalog sync failed validation or availability', (error as { retryAt?: number }).retryAt ?? this.now() + 30000).catch(() => {});
      throw new Error('Catalog sync failed; previous catalog retained and freshness gates remain enforced.');
    } finally { clearTimeout(timeout); controller.abort(); }
  }
}
