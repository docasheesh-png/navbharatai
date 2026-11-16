/**
 * IMAGE ANALYSIS ON THE ALWAYS-ON SUPPLIERS (owner t357u + t359u, 2026-11-16): "photo/image analysis me
 * bhi yahi 3 lagao mitrify, qubax, and cheaperinference - default on", target order
 * Mitrify/Qubax/CheaperInference (only those with real vision models) → GLM-4.6V Flash → Gemini
 * Flash-Lite → Gemini Flash.
 *
 * Which of the three can really read an image (checked 2026-11-16, never assumed):
 *   - Qubax: its public market (https://api.qubax.ai/v1/market/models) marks rows MULTIMODAL, and its
 *     Chat Completions endpoint is OpenAI-compatible. A row is used only when it is MULTIMODAL in the
 *     live feed AND its model family is one its maker documents as accepting images
 *     (QUBAX_VISION_MODELS). Anything else is not tried.
 *   - CheaperInference: its docs (https://api.cheaperinference.com/docs, "Images and vision") say
 *     vision models accept OpenAI `image_url` parts and that `capabilities.vision` in `GET /v1/models`
 *     is the authority. Only a catalog row with `capabilities.vision === true` and a posted token price
 *     is used.
 *   - Mitrify: NOT here. It publishes no API docs or catalog this server can read without a key, and
 *     its transport (`mitrify.ts`) rejects image content by design. Claiming it reads photos would be
 *     a fake rung, so it stays a Chat-only supplier.
 *
 * Images only: a PDF in the batch skips both (they would need a different request shape) and the
 * existing GLM → Google chain reads it, exactly as GLM already defers PDFs.
 *
 * Money: every call holds a ceiling quoted from the supplier's own posted per-token price against the
 * shared owner Free-tier paid budget BEFORE dispatch, and settles to the supplier-reported charge
 * (CheaperInference `billing.billed_cost_usd`) or to the reported tokens at the posted price (Qubax).
 * Missing evidence keeps the full hold. Nothing is billed to the user; no cost is invented.
 *
 * Brand: the reply text is all a user receives. Supplier and model names stay in server logs only.
 */
import { randomUUID } from 'node:crypto';
import { qubaxSwitchOn } from './alwaysOnSuppliers';
import { cheaperInferenceApiKeyConfigured, cheaperInferenceMode, CHEAPERINFERENCE_BASE_URL } from './cheaperInferencePolicy';
import { freeTierPaidCapNanoUsd } from './freeTierPaidCap';
import { QubaxPriceFeedStore } from './qubaxPriceFeedStore';
import { qubaxRequestCeilingNanoUsd } from './qubaxMarket';
import type { QubaxObservedPrice } from './qubaxPriceFeed';
import { maximumCostNanoUsd, usdToNanoUsd, type PaidReservation } from '../AI/FreeChain/spendCap';

export interface VisionSupplierAttachment { name: string; type: string; base64: string }
export interface VisionSupplierOptions { prompt: string; systemPrompt?: string; timeoutMs?: number; signal?: AbortSignal }
export type VisionSupplierId = 'QUBAX' | 'CHEAPERINFERENCE';
export interface VisionSupplierReply { text: string; model: string }

/** Model families whose makers document image input (Google Gemini 2.x/3.x Flash; Gemma 3 4B and larger). */
export const QUBAX_VISION_MODELS: readonly string[] = Object.freeze([
  'gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-3.1-flash-lite',
  'gemma-3-4b-it', 'gemma-3-12b-it', 'gemma-3-27b-it',
]);
const QUBAX_CHAT_URL = 'https://api.qubax.ai/v1/chat/completions';
export const VISION_SUPPLIER_MAX_OUTPUT_TOKENS = 1_500;
/** CheaperInference refuses bodies over 4.5 MB on the wire; stay under it for both suppliers. */
export const VISION_SUPPLIER_MAX_BODY_BYTES = 4_000_000;
const DEFAULT_TIMEOUT_MS = 28_000;
const CATALOG_TTL_MS = 10 * 60_000;
const CATALOG_TIMEOUT_MS = 5_000;

type Fetch = typeof fetch;
interface PaidStore {
  reservePaid(input: { uncappedRollout?: boolean; requestId: string; uid: string; maxCostNanoUsd: number; capNanoUsd: number; perUserLimit: number }): Promise<PaidReservation | null>;
  settlePaid(reservation: PaidReservation, actualNanoUsd: number): Promise<boolean>;
}
type QubaxRows = readonly QubaxObservedPrice[];
interface Deps { fetch: Fetch; store: () => PaidStore | null; qubaxRows: () => Promise<QubaxRows>; now: () => number }
let depsOverride: Partial<Deps> | null = null;
/** Tests inject fetch, the paid store and the feed database. `null` restores the real ones. */
export function setVisionSupplierDepsForTests(value: Partial<Deps> | null): void { depsOverride = value; cheapCatalog = null; }
let realStore: PaidStore | null = null;
async function deps(): Promise<Deps> {
  if (depsOverride?.qubaxRows && depsOverride.store) {
    return { fetch: depsOverride.fetch ?? fetch, now: depsOverride.now ?? Date.now, qubaxRows: depsOverride.qubaxRows, store: depsOverride.store };
  }
  // Lazy: Firestore and the FreeChain store load only when a photo actually reaches this rung.
  const { getServerDb } = await import('./serverDb');
  const db = (() => { try { return getServerDb(); } catch { return null; } })();
  if (!realStore && db) {
    const { FreeChainStore } = await import('../AI/FreeChain/store');
    realStore = new FreeChainStore(db) as unknown as PaidStore;
  }
  return {
    fetch: depsOverride?.fetch ?? fetch, now: depsOverride?.now ?? Date.now,
    // The reviewed live price feed (validated and expiry-checked by its store); no feed → no rows.
    qubaxRows: depsOverride?.qubaxRows ?? (async () => {
      if (!db) return [];
      const snapshot = await new QubaxPriceFeedStore(db).read().catch(() => null);
      return snapshot?.sources.find(source => source.source === 'qubax')?.rows ?? [];
    }),
    store: depsOverride?.store ?? (() => realStore),
  };
}

function imagesOnly(atts: VisionSupplierAttachment[]): VisionSupplierAttachment[] | null {
  if (!atts.length || atts.some(f => !f.type.startsWith('image/'))) return null;
  return atts;
}
/** Upper-bound input tokens: ~1.6k per image (as the existing vision hold) plus the text at 1 token / 2 chars. */
export function visionSupplierInputTokens(atts: VisionSupplierAttachment[], o: VisionSupplierOptions): number {
  return atts.length * 1_600 + Math.ceil(`${o.prompt}${o.systemPrompt ?? ''}`.length / 2) + 64;
}
function chatBody(model: string, atts: VisionSupplierAttachment[], o: VisionSupplierOptions): string {
  return JSON.stringify({
    model, max_tokens: VISION_SUPPLIER_MAX_OUTPUT_TOKENS, stream: false,
    messages: [
      ...(o.systemPrompt ? [{ role: 'system', content: o.systemPrompt }] : []),
      { role: 'user', content: [
        ...atts.map(f => ({ type: 'image_url', image_url: { url: `data:${f.type};base64,${f.base64}` } })),
        { type: 'text', text: o.prompt },
      ] },
    ],
  });
}
/** Exact decimal money (no float multiply). Anything unreadable is null: the hold then stays booked. */
function usdDecimalToNano(value: unknown): number | null {
  const raw = typeof value === 'number' && Number.isFinite(value) ? String(value) : typeof value === 'string' ? value.trim() : null;
  if (raw === null) return null;
  try { return usdToNanoUsd(raw); } catch { return null; }
}

/** Reserve, dispatch once, settle. Never throws: a failure returns null and the chain moves on. */
async function dispatchHeld(input: {
  d: Deps; supplier: VisionSupplierId; url: string; apiKey: string; model: string; body: string;
  ceilingNanoUsd: number; o: VisionSupplierOptions;
  actualNanoUsd: (json: any) => number | null;
}): Promise<VisionSupplierReply | null> {
  const store = input.d.store();
  const cap = freeTierPaidCapNanoUsd();
  if (!store || !(input.ceilingNanoUsd > 0) || !(cap > 0)) return null;
  const reservation = await store.reservePaid({ uncappedRollout: true, requestId: `vision-supplier:${randomUUID()}`,
    uid: 'free-tier-shared:vision-supplier', maxCostNanoUsd: input.ceilingNanoUsd, capNanoUsd: cap, perUserLimit: Number.MAX_SAFE_INTEGER }).catch(() => null);
  if (!reservation || !reservation.mayDispatch) return null;
  let entered = false;
  const timeout = AbortSignal.timeout(input.o.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = input.o.signal ? AbortSignal.any([input.o.signal, timeout]) : timeout;
  try {
    signal.throwIfAborted();
    entered = true;
    const response = await input.d.fetch(input.url, { method: 'POST', signal, redirect: 'error',
      headers: { authorization: `Bearer ${input.apiKey}`, 'content-type': 'application/json' }, body: input.body });
    const json: any = await response.json().catch(() => null);
    // A failed response can still carry a settled receipt; anything unproven keeps the full hold.
    const actual = json ? input.actualNanoUsd(json) : null;
    if (actual !== null) await store.settlePaid(reservation, Math.min(actual, Number.MAX_SAFE_INTEGER)).catch(() => false);
    if (!response.ok) { console.warn(`[VISION_SUPPLIER] ${input.supplier} ${input.model} HTTP ${response.status}`); return null; }
    const text = json?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) return null;
    return { text: text.trim(), model: input.model };
  } catch (error) {
    console.warn(`[VISION_SUPPLIER] ${input.supplier} ${input.model} failed: ${error instanceof Error ? error.name : 'error'}`);
    return null;
  } finally {
    if (!entered) await store.settlePaid(reservation, 0).catch(() => false);
  }
}

// ─── Qubax ────────────────────────────────────────────────────────────────────────────────────────
export interface QubaxVisionRow { modelId: string; inputNanoUsdPerMillion: number; outputNanoUsdPerMillion: number }
/** The cheapest live MULTIMODAL row in a documented image-reading family, by the cost of this request. */
export function pickQubaxVisionRow(rows: readonly { sourceModelLabel: string; modality: string; inputNanoUsd: number | null; outputNanoUsd: number | null }[], inputTokens: number): QubaxVisionRow | null {
  const usable = rows.filter(r => r.modality === 'multimodal' && QUBAX_VISION_MODELS.includes(r.sourceModelLabel)
    && Number.isSafeInteger(r.inputNanoUsd) && (r.inputNanoUsd as number) > 0 && Number.isSafeInteger(r.outputNanoUsd) && (r.outputNanoUsd as number) > 0)
    .map(r => ({ modelId: r.sourceModelLabel, inputNanoUsdPerMillion: r.inputNanoUsd as number, outputNanoUsdPerMillion: r.outputNanoUsd as number }));
  usable.sort((a, b) => maximumCostNanoUsd(inputTokens, VISION_SUPPLIER_MAX_OUTPUT_TOKENS, a.inputNanoUsdPerMillion, a.outputNanoUsdPerMillion)
    - maximumCostNanoUsd(inputTokens, VISION_SUPPLIER_MAX_OUTPUT_TOKENS, b.inputNanoUsdPerMillion, b.outputNanoUsdPerMillion) || a.modelId.localeCompare(b.modelId));
  return usable[0] ?? null;
}
function reportedTokens(json: any): { input: number; output: number } | null {
  const u = json?.usage;
  return Number.isSafeInteger(u?.prompt_tokens) && u.prompt_tokens >= 0 && Number.isSafeInteger(u?.completion_tokens) && u.completion_tokens >= 0
    ? { input: u.prompt_tokens, output: u.completion_tokens } : null;
}

export async function tryQubaxVision(atts: VisionSupplierAttachment[], o: VisionSupplierOptions, env: NodeJS.ProcessEnv = process.env): Promise<VisionSupplierReply | null> {
  const images = imagesOnly(atts);
  const apiKey = env.QUBAX_API_KEY?.trim() ?? '';
  if (!images || !qubaxSwitchOn(env) || !apiKey || /[\s,]/.test(apiKey)) return null;
  const d = await deps();
  const rows = await d.qubaxRows().catch(() => [] as QubaxRows);
  const inputTokens = visionSupplierInputTokens(images, o);
  const row = pickQubaxVisionRow(rows, inputTokens);
  if (!row) return null;
  const body = chatBody(row.modelId, images, o);
  if (Buffer.byteLength(body, 'utf8') > VISION_SUPPLIER_MAX_BODY_BYTES) return null;
  // The same per-request money ceiling Chat's Qubax rung uses (QUBAX_MAX_USD_PER_REQUEST, default set in qubaxMarket).
  const ceilingNanoUsd = maximumCostNanoUsd(inputTokens, VISION_SUPPLIER_MAX_OUTPUT_TOKENS, row.inputNanoUsdPerMillion, row.outputNanoUsdPerMillion);
  const requestCeiling = qubaxRequestCeilingNanoUsd(env);
  if (!requestCeiling || ceilingNanoUsd > requestCeiling) return null;
  return dispatchHeld({ d, supplier: 'QUBAX', url: QUBAX_CHAT_URL, apiKey, model: row.modelId, body, o, ceilingNanoUsd,
    actualNanoUsd: json => { const t = reportedTokens(json); return t ? maximumCostNanoUsd(t.input, t.output, row.inputNanoUsdPerMillion, row.outputNanoUsdPerMillion) : null; } });
}

// ─── CheaperInference ─────────────────────────────────────────────────────────────────────────────
export interface CheaperVisionModel { id: string; inputNanoUsdPerMillion: number; outputNanoUsdPerMillion: number; reasoning: boolean }
/** Rows the catalog itself marks vision-capable, on Chat Completions, with a posted token price. */
export function parseCheaperVisionCatalog(payload: unknown): CheaperVisionModel[] {
  const rows = payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data) ? (payload as { data: unknown[] }).data : [];
  const out: CheaperVisionModel[] = [];
  for (const raw of rows) {
    const row = raw as { id?: unknown; endpoint?: unknown; type?: unknown; capabilities?: { vision?: unknown; reasoning?: unknown }; pricing?: { currency?: unknown; input_per_million?: unknown; output_per_million?: unknown } };
    if (typeof row?.id !== 'string' || !/^[\w.:/-]{1,200}$/.test(row.id)) continue;
    if (row.capabilities?.vision !== true) continue;
    if (row.type !== undefined && row.type !== 'text') continue;
    if (row.endpoint !== undefined && row.endpoint !== '/v1/chat/completions') continue;
    if (row.pricing?.currency !== undefined && row.pricing.currency !== 'USD') continue;
    const input = usdDecimalToNano(row.pricing?.input_per_million), output = usdDecimalToNano(row.pricing?.output_per_million);
    if (input === null || output === null || input <= 0 || output <= 0) continue;
    out.push({ id: row.id, inputNanoUsdPerMillion: input, outputNanoUsdPerMillion: output, reasoning: row.capabilities?.reasoning === true });
  }
  return out;
}
/** Non-reasoning first (a reasoning model can spend the reply bound thinking), then the cheapest for this request. */
export function pickCheaperVisionModel(models: readonly CheaperVisionModel[], inputTokens: number): CheaperVisionModel | null {
  const cost = (m: CheaperVisionModel) => maximumCostNanoUsd(inputTokens, VISION_SUPPLIER_MAX_OUTPUT_TOKENS, m.inputNanoUsdPerMillion, m.outputNanoUsdPerMillion);
  return [...models].sort((a, b) => Number(a.reasoning) - Number(b.reasoning) || cost(a) - cost(b) || a.id.localeCompare(b.id))[0] ?? null;
}
let cheapCatalog: { atMs: number; models: CheaperVisionModel[] } | null = null;
async function cheaperVisionModels(d: Deps, apiKey: string, signal?: AbortSignal): Promise<CheaperVisionModel[]> {
  if (cheapCatalog && d.now() - cheapCatalog.atMs < CATALOG_TTL_MS) return cheapCatalog.models;
  const timeout = AbortSignal.timeout(CATALOG_TIMEOUT_MS);
  try {
    const response = await d.fetch(`${CHEAPERINFERENCE_BASE_URL}/models?type=text&vision=true`, { redirect: 'error',
      headers: { authorization: `Bearer ${apiKey}` }, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!response.ok) return [];
    const models = parseCheaperVisionCatalog(await response.json());
    cheapCatalog = { atMs: d.now(), models };
    return models;
  } catch { return []; }
}
function cheaperBilledNano(json: any): number | null {
  const billing = json?.billing;
  if (!billing || billing.status !== 'settled' || billing.currency !== 'USD') return null;
  return usdDecimalToNano(billing.billed_cost_usd);
}

export async function tryCheaperInferenceVision(atts: VisionSupplierAttachment[], o: VisionSupplierOptions, env: NodeJS.ProcessEnv = process.env): Promise<VisionSupplierReply | null> {
  const images = imagesOnly(atts);
  if (!images || cheaperInferenceMode(env) === 'off' || !cheaperInferenceApiKeyConfigured(env)) return null;
  const apiKey = (env.CHEAPERINFERENCE_API_KEY ?? '').trim();
  const d = await deps();
  const inputTokens = visionSupplierInputTokens(images, o);
  const model = pickCheaperVisionModel(await cheaperVisionModels(d, apiKey, o.signal), inputTokens);
  if (!model) return null;
  const body = chatBody(model.id, images, o);
  if (Buffer.byteLength(body, 'utf8') > VISION_SUPPLIER_MAX_BODY_BYTES) return null;
  // The docs cap a fallback route's charge at the maker's list price; the hold is the posted catalog
  // rate, and the settlement is the receipt CheaperInference returns with the reply.
  return dispatchHeld({ d, supplier: 'CHEAPERINFERENCE', url: `${CHEAPERINFERENCE_BASE_URL}/chat/completions`, apiKey, model: model.id, body, o,
    ceilingNanoUsd: maximumCostNanoUsd(inputTokens, VISION_SUPPLIER_MAX_OUTPUT_TOKENS, model.inputNanoUsdPerMillion, model.outputNanoUsdPerMillion),
    actualNanoUsd: cheaperBilledNano });
}
