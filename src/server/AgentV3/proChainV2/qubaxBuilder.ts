/**
 * Qubax — Pro Chain V2 BUILDER adapter (written from zero; the AI-chat Qubax files are not used).
 *
 * The chat path (lib/qubax.ts, qubaxSelector.ts, qubaxPriceFeed.ts) is a reviewed, evidence-gated text
 * transport with no tool calling. The builder needs OpenAI-style tool calls and streaming, so this module
 * only answers three builder questions and leaves the call itself to the builder's ordinary
 * OpenAI-protocol runner (OpenAiToolRunner, the same one every GLM/KIMI/Router One rung uses):
 *
 *   1. Is it configured?          QUBAX_API_KEY present (same key the chat uses; the chat flag QUBAX_ENABLED
 *                                 is NOT required and NOT changed). `PRO_CHAIN_V2_QUBAX=off` removes it.
 *   2. Which models?              QUBAX_BUILDER_MODELS (comma list) or a coding default, filtered by Qubax's own
 *                                 public catalogue (GET /v1/models): `capabilities.tools === true`, ready, long
 *                                 enough context. If the catalogue is unreachable the configured list is used as-is.
 *   3. What does a token cost?    The catalogue's own per-token USD price (×1e6 → per MTok). Unknown ⇒ undefined,
 *                                 and the caller bills a conservative ESTIMATE that is labelled as one.
 *
 * The catalogue is a free public GET, fetched lazily (only when a v2 runner is built) and cached.
 */
import { parseEnvFlag } from '../../lib/envFlag';
import type { TokenRate } from '../pricing';

export const QUBAX_BUILDER_BASE_URL = 'https://api.qubax.ai/v1';
/** Coding/tool-capable defaults — every one of these listed `capabilities.tools: true` in the 2026-11-15 catalogue. */
export const QUBAX_BUILDER_DEFAULT_MODELS: readonly string[] = ['glm-5.3', 'kimi-k2.7-code', 'glm-5.2'];
/** Non-reasoning instruct model for the one-word scope classifier (8-token answers). */
export const QUBAX_BUILDER_DEFAULT_SCOPE_MODEL = 'qwen3-235b-a22b-2507';
export const QUBAX_CATALOG_TTL_MS = 10 * 60_000;
const CATALOG_TIMEOUT_MS = 8_000;
const CATALOG_MAX_BYTES = 6_000_000;
const MIN_CONTEXT = 64_000;
// Weak's final guard sees ENGINE_QX rather than the underlying model. Enforce the
// no-Claude-through-a-reseller policy before an opaque supplier rung is created.
const CLAUDE_FAMILY = /claude|anthropic|sonnet|opus|haiku|fable/i;

export interface QubaxCatalogEntry {
  id: string;
  tools: boolean;
  ready: boolean;
  contextLength: number;
  maxOutput: number;
  rate?: TokenRate;
}

type Catalog = { at: number; entries: Map<string, QubaxCatalogEntry> };
let cache: Catalog | null = null;
let inflight: Promise<void> | null = null;

export function qubaxBuilderApiKey(env: NodeJS.ProcessEnv = process.env): string {
  return String(env.QUBAX_API_KEY ?? '').trim();
}
export function qubaxBuilderEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseEnvFlag(env.PRO_CHAIN_V2_QUBAX) !== false && qubaxBuilderApiKey(env) !== '' && qubaxBuilderModels(env).models.length > 0;
}

function perMTok(raw: unknown): number | undefined {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n * 1_000_000 : undefined;
}

/** Parse Qubax's public /v1/models body. Rows that cannot be read are skipped, never guessed. PURE. */
export function parseQubaxCatalog(body: unknown): Map<string, QubaxCatalogEntry> {
  const out = new Map<string, QubaxCatalogEntry>();
  const data = (body as { data?: unknown })?.data;
  if (!Array.isArray(data)) return out;
  for (const row of data) {
    const m = row as Record<string, any>;
    const id = typeof m?.id === 'string' ? m.id.trim() : '';
    if (!id) continue;
    const caps = (m.capabilities ?? {}) as Record<string, unknown>;
    const features = Array.isArray(m.supported_features) ? m.supported_features : [];
    const params = Array.isArray(m.supported_parameters) ? m.supported_parameters : [];
    const tools = caps.tools === true || features.includes('tools') || params.includes('tools');
    const price = Array.isArray(m.pricing) ? m.pricing.find((p: any) => p?.label === 'token') : undefined;
    const input = perMTok(price?.prompt);
    const output = perMTok(price?.completion);
    const cacheRead = perMTok(price?.input_cache_read);
    // A price of exactly 0 on both sides is NOT trusted as "free" — no rate, so the caller estimates.
    const rate: TokenRate | undefined = input !== undefined && output !== undefined && (input > 0 || output > 0)
      ? { inputPerMTok: input, outputPerMTok: output, ...(cacheRead !== undefined && cacheRead > 0 ? { cacheReadPerMTok: cacheRead } : {}) }
      : undefined;
    out.set(id, {
      id, tools, ready: m.is_ready !== false,
      contextLength: Number(m.context_length) || 0,
      maxOutput: Number(m.max_output_length) || 0,
      ...(rate ? { rate } : {}),
    });
  }
  return out;
}

/** Refresh the cached catalogue if stale. Never throws; a failure keeps the last good copy. */
export async function refreshQubaxBuilderCatalog(
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now(),
  force = false,
): Promise<void> {
  if (!force && cache && now - cache.at < QUBAX_CATALOG_TTL_MS) return;
  if (inflight) return inflight;
  inflight = (async () => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), CATALOG_TIMEOUT_MS);
    try {
      const res = await fetchImpl(`${QUBAX_BUILDER_BASE_URL}/models`, { signal: ctl.signal, headers: { accept: 'application/json' } });
      if (!res.ok) return;
      const len = Number(res.headers.get('content-length') ?? 0);
      if (len > CATALOG_MAX_BYTES) return;
      const text = await res.text();
      if (text.length > CATALOG_MAX_BYTES) return;
      const entries = parseQubaxCatalog(JSON.parse(text));
      if (entries.size > 0) cache = { at: now, entries };
    } catch { /* keep the last good catalogue */ } finally {
      clearTimeout(timer);
      inflight = null;
    }
  })();
  return inflight;
}

/** Kick a background refresh when stale (used at runner construction, which is synchronous). */
export function ensureQubaxBuilderCatalog(fetchImpl: typeof fetch = fetch, now: number = Date.now()): void {
  if (cache && now - cache.at < QUBAX_CATALOG_TTL_MS) return;
  void refreshQubaxBuilderCatalog(fetchImpl, now);
}

export function qubaxCatalogEntry(model: string | undefined): QubaxCatalogEntry | undefined {
  return model ? cache?.entries.get(model) : undefined;
}

/** The catalogue's own USD/MTok rate for a model, or undefined when unknown. */
export function qubaxCatalogRate(model: string | undefined): TokenRate | undefined {
  return qubaxCatalogEntry(model)?.rate;
}

/** Test seam only. */
export function __setQubaxBuilderCatalogForTests(entries: Map<string, QubaxCatalogEntry> | null, at = Date.now()): void {
  cache = entries ? { at, entries } : null;
  inflight = null;
}

function usable(e: QubaxCatalogEntry | undefined): boolean {
  return !!e && e.tools && e.ready && e.contextLength >= MIN_CONTEXT;
}

/**
 * The builder's Qubax models, in order. A configured/default id the catalogue says cannot call tools
 * (or is not ready) is dropped; when the catalogue is unknown the list is kept as configured. If the
 * catalogue rejects EVERY configured id, the list is kept too — the call itself is the final judge and
 * the report names the failure, rather than this module silently inventing a different model. PURE
 * over (env, cache).
 */
export function qubaxBuilderModels(env: NodeJS.ProcessEnv = process.env): { models: string[]; verifiedByCatalog: boolean } {
  const configured = String(env.QUBAX_BUILDER_MODELS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const list = (configured.length ? configured : [...QUBAX_BUILDER_DEFAULT_MODELS]).filter((model) => !CLAUDE_FAMILY.test(model));
  if (!cache) return { models: list, verifiedByCatalog: false };
  const kept = list.filter((m) => usable(cache!.entries.get(m)));
  return kept.length ? { models: kept, verifiedByCatalog: true } : { models: list, verifiedByCatalog: false };
}

export function qubaxBuilderScopeModel(env: NodeJS.ProcessEnv = process.env): string {
  return String(env.QUBAX_BUILDER_SCOPE_MODEL ?? '').trim() || QUBAX_BUILDER_DEFAULT_SCOPE_MODEL;
}
