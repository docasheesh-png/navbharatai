/** Dedicated image metadata is NOT a text-model price or permission to run inference. */
export const IMAGE_CATALOG_URL = 'https://openrouter.ai/api/v1/images/models';
export const IMAGE_DISCOVERY_TTL_MS = 60 * 60 * 1000;
const MAX_MODELS = 1000;
const MAX_BODY_BYTES = 4_000_000;
export interface ImagePriceLine { billable: string; unit: string; costUsd: string; variant: string | null }
export interface ImageDiscoveryEndpoint {
  providerTag: string | null;
  pricing: ImagePriceLine[];
  eligibilityStatus: 'PAID' | 'UNKNOWN';
  eligibilityReason: string;
}
export interface ImageDiscoverySnapshot {
  fetchedAt: number;
  expiresAt: number;
  models: Array<{
    exactModelId: string; displayName: string;
    eligibilityStatus: 'PAID' | 'UNKNOWN' | 'VERIFIED_FREE';
    eligibilityReason: string; endpoints: ImageDiscoveryEndpoint[];
  }>;
  limitations: string[];
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const safeId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.:-]+$/.test(id) && id.length <= 256 && !id.includes('..');
/** Construct from validated exact IDs, never follow catalog-supplied links. */
export function imageEndpointUrl(id: string): string {
  if (!safeId(id)) throw new Error('Invalid image model ID');
  return `${IMAGE_CATALOG_URL}/${id}/endpoints`;
}
async function readJson(url: string, fetcher: typeof fetch, signal: AbortSignal): Promise<unknown> {
  if (url !== IMAGE_CATALOG_URL && !/^https:\/\/openrouter\.ai\/api\/v1\/images\/models\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.:-]+\/endpoints$/.test(url)) throw new Error('Image catalog URL rejected');
  const response = await fetcher(url, { method: 'GET', redirect: 'error', signal, headers: { Accept: 'application/json' } });
  if (!response.ok) {
    const error = new Error(`Image catalog HTTP ${response.status}`) as Error & { status: number; retryAfter: string | null };
    error.status = response.status; error.retryAfter = response.headers.get('retry-after'); throw error;
  }
  if (response.redirected || (response.url && response.url !== url)) throw new Error('Image catalog redirect rejected');
  if (Number(response.headers.get('content-length')) > MAX_BODY_BYTES || !response.body) throw new Error('Invalid image catalog body');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength; if (size > MAX_BODY_BYTES) throw new Error('Image catalog body too large');
      chunks.push(part.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function decimal(value: unknown): string | null {
  // The dedicated API returns JSON numbers. Never use arithmetic to decide zero.
  const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : typeof value === 'string' ? value : '';
  return /^(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(text) && text.length <= 128 ? text : null;
}
const zero = (value: string): boolean => /^0(?:\.0+)?(?:[eE][+-]?\d+)?$/.test(value);
function endpoint(raw: unknown): ImageDiscoveryEndpoint {
  if (!object(raw)) throw new Error('Invalid image endpoint');
  const providerTag = typeof raw.provider_tag === 'string' && /^[a-zA-Z0-9_./:-]{1,200}$/.test(raw.provider_tag) ? raw.provider_tag : null;
  const pricing: ImagePriceLine[] = [];
  let malformed = !Array.isArray(raw.pricing) || raw.pricing.length === 0 || raw.pricing.length > 1000;
  if (Array.isArray(raw.pricing) && raw.pricing.length <= 1000) for (const line of raw.pricing) {
    if (!object(line)) { malformed = true; continue; }
    const costUsd = decimal(line.cost_usd);
    if (!costUsd || typeof line.billable !== 'string' || !/^[a-z_]{1,80}$/.test(line.billable) || typeof line.unit !== 'string' || !/^[a-z_]{1,80}$/.test(line.unit) || (line.variant !== undefined && (typeof line.variant !== 'string' || line.variant.length > 100))) { malformed = true; continue; }
    pricing.push({ billable: line.billable, unit: line.unit, costUsd, variant: typeof line.variant === 'string' ? line.variant : null });
  }
  // An endpoint is labelled PAID only when every advertised output variant costs money.
  // Mixed tiers stay UNKNOWN so a future free tier is never hidden by a paid sibling.
  const outputs = pricing.filter(p => p.billable === 'output_image');
  const paid = !malformed && outputs.length > 0 && outputs.every(p => !zero(p.costUsd));
  return {
    providerTag, pricing, eligibilityStatus: paid ? 'PAID' : 'UNKNOWN',
    eligibilityReason: paid ? 'All advertised output-image variants have positive charges.' : malformed ? 'Image pricing is missing or malformed; inference is not authorized.' : 'Potential zero-price tier or incomplete fee coverage; account, terms and safe image dispatch remain unverified.',
  };
}
/** All-or-nothing metadata scan. Caller retains the previous snapshot on rejection.
 * Dedicated catalog has no price fingerprint or documented pagination. A complete
 * hourly endpoint scan detects unchanged-ID price transitions without 5-minute fanout.
 * This function NEVER performs inference or marks a model VERIFIED_FREE.
 */
export async function discoverImageModels(fetcher: typeof fetch = fetch, now: () => number = Date.now, previous?: ImageDiscoverySnapshot): Promise<ImageDiscoverySnapshot> {
  const start = now();
  if (previous && previous.fetchedAt <= start && previous.expiresAt > start && previous.expiresAt <= previous.fetchedAt + IMAGE_DISCOVERY_TTL_MS) return previous;
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const raw = await readJson(IMAGE_CATALOG_URL, fetcher, controller.signal);
    if (!object(raw) || !Array.isArray(raw.data) || !raw.data.length || raw.data.length > MAX_MODELS || (raw.total_count !== undefined && raw.total_count !== raw.data.length) || (object(raw.links) && raw.links.next)) throw new Error('Incomplete image catalog');
    const ids = new Set<string>();
    const rows = raw.data.map(row => {
      if (!object(row) || !safeId(row.id) || ids.has(row.id) || !object(row.architecture) || !Array.isArray(row.architecture.output_modalities) || !row.architecture.output_modalities.includes('image')) throw new Error('Invalid image catalog model');
      ids.add(row.id);
      return { id: row.id, name: typeof row.name === 'string' ? row.name.slice(0, 300) : row.id };
    });
    const models: ImageDiscoverySnapshot['models'] = new Array(rows.length);
    let index = 0;
    await Promise.all(Array.from({ length: Math.min(4, rows.length) }, async () => {
      while (index < rows.length) {
        const i = index++; const row = rows[i];
        const payload = await readJson(imageEndpointUrl(row.id), fetcher, controller.signal);
        if (!object(payload) || payload.id !== row.id || !Array.isArray(payload.endpoints) || payload.endpoints.length > 100) throw new Error('Invalid image endpoint catalog');
        const endpoints = payload.endpoints.map(endpoint);
        const paid = endpoints.length > 0 && endpoints.every(e => e.eligibilityStatus === 'PAID');
        models[i] = { exactModelId: row.id, displayName: row.name, endpoints, eligibilityStatus: paid ? 'PAID' : 'UNKNOWN', eligibilityReason: paid ? 'Every advertised image endpoint has positive output charges.' : 'No verified-free image endpoint; existing funded image service is unchanged.' };
      }
    }));
    if (controller.signal.aborted || now() >= start + 90_000) throw new Error('Image discovery timed out');
    const snapshot: ImageDiscoverySnapshot = { fetchedAt: start, expiresAt: start + IMAGE_DISCOVERY_TTL_MS, models, limitations: [
      'Metadata only. No image inference or provider probe is performed.',
      'Hourly endpoint scans can detect price changes only after publication and the next successful scan.',
      'Dedicated Image API does not document chat-style maximum-price protection. Zero-price metadata alone never authorizes inference.',
      'Account availability, applicable fees, provider terms and a safe image adapter must be verified before automatic free preference can activate.',
    ] };
    if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > 650_000) throw new Error('Image discovery snapshot too large');
    return snapshot;
  } finally { controller.abort(); clearTimeout(timeout); }
}
