/**
 * Router One catalog sync engine (owner 2026-11-01): a fixed ROUTER_ONE_MODEL goes stale when prices move.
 * Periodically (and on admin refresh) pull GET {base}/models, keep coding-capable (tool-calling) chat
 * models, rank cheapest-first, and feed that list to the Pro Router One path (z@gmail.com pin + public
 * fallback). Persisted to Firestore; on ANY failure the last good ranking stays active (never breaks).
 *
 * Env:
 *   ROUTER_ONE_SYNC            off ⇒ engine disabled, ROUTER_ONE_MODEL used as before (default on when key set)
 *   ROUTER_ONE_MODEL_MODE      synced (default) | env | auto
 *                              synced: ranked cheapest coding models, then ROUTER_ONE_MODEL, then "auto"
 *                              env:    only ROUTER_ONE_MODEL (old behaviour)
 *                              auto:   Router One's own "auto" router only
 *   ROUTER_ONE_SYNC_TOP        how many ranked models to try in order (default 3, max 10)
 *   ROUTER_ONE_SYNC_INTERVAL_MIN  refresh period (default 360 = 6h, min 15)
 *   ROUTER_ONE_MAX_OUT_PER_M   optional USD/1M output-token ceiling for candidates
 *   ROUTER_ONE_EXCLUDE         comma list of model ids (or substrings) never to use
 */
import { routerOnePublicPrices, type RouterOnePublicPriceSource } from './publicPriceSource';
import { getServerDb } from '../../lib/serverDb';

export const ROUTER_ONE_CATALOG_DOC = 'live_ai_registry/router-one-catalog';
export const ROUTER_ONE_AUTO_MODEL = 'auto';

export interface RouterOneModelEntry { id: string; inPerM: number; outPerM: number; tools: boolean; ctx: number | null }
export interface RouterOneRanking { syncedAt: number; ranked: RouterOneModelEntry[]; total: number; source: 'live' | 'store' }

const on = (v: unknown) => ['on', 'true', '1', 'yes'].includes(String(v ?? '').trim().toLowerCase());
const off = (v: unknown) => ['off', 'false', '0', 'no'].includes(String(v ?? '').trim().toLowerCase());
const rec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Price → USD per 1M tokens. Accepts per-token strings/numbers (OpenRouter style, < 0.01) or per-1M. */
function perM(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return n > 0 && n < 0.01 ? n * 1_000_000 : n;
}
function pick(o: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
}
const NON_CHAT = /(embed|embedding|whisper|tts|speech|audio|image|dall-?e|imagen|vision-only|moderation|rerank|ocr|video|sora|flux|stable-diffusion)/i;
const CODING_HINT = /(coder|code|codex|claude|gpt|deepseek|qwen|glm|kimi|grok|gemini|minimax|mistral|devstral|llama)/i;

export function parseRouterOneCatalog(json: unknown): RouterOneModelEntry[] {
  const list = Array.isArray(json) ? json : rec(json) && Array.isArray(json.data) ? json.data : rec(json) && Array.isArray(json.models) ? json.models : [];
  const out: RouterOneModelEntry[] = [];
  for (const m of list) {
    if (!rec(m)) continue;
    const id = String(m.id ?? m.model ?? m.name ?? '').trim();
    if (!id || id.length > 200 || id === ROUTER_ONE_AUTO_MODEL) continue;
    const pr = rec(m.pricing) ? m.pricing : rec(m.price) ? m.price : m;
    const inPerM = perM(pick(pr, ['prompt', 'input', 'input_price', 'inputPrice', 'prompt_price', 'input_per_million']));
    const outPerM = perM(pick(pr, ['completion', 'output', 'output_price', 'outputPrice', 'completion_price', 'output_per_million']));
    if (inPerM === null || outPerM === null) continue;
    const params = [m.supported_parameters, m.capabilities, m.features, m.supported_features]
      .flatMap((x) => (Array.isArray(x) ? x.map(String) : rec(x) ? Object.entries(x).filter(([, v]) => v === true).map(([k]) => k) : []))
      .map((s) => s.toLowerCase());
    const declared = params.length > 0;
    const tools = params.some((p) => p.includes('tool') || p.includes('function')) || m.tool_call === true || m.supports_tools === true || m.function_calling === true;
    if (declared && !tools) continue;
    if (!declared && !(tools || CODING_HINT.test(id))) continue;
    if (NON_CHAT.test(id)) continue;
    const modality = String(rec(m.architecture) ? m.architecture.modality ?? '' : m.modality ?? '');
    if (modality && !/text->text|text\+image->text|^text$|chat/i.test(modality)) continue;
    const ctxRaw = Number(pick(m, ['context_length', 'context_window', 'max_context', 'contextLength']));
    const ctx = Number.isFinite(ctxRaw) && ctxRaw > 0 ? ctxRaw : null;
    if (ctx !== null && ctx < 32_000) continue; // builder prompts are long
    out.push({ id, inPerM, outPerM, tools: true, ctx });
  }
  return out;
}

/** Blended cost for a coding turn (input-heavy agent loop ≈ 3:1 in:out). Free (0/0) models excluded — unreliable for Pro. */
export function rankForCoding(entries: RouterOneModelEntry[], env: NodeJS.ProcessEnv = process.env): RouterOneModelEntry[] {
  const ceiling = Number(env.ROUTER_ONE_MAX_OUT_PER_M);
  const exclude = String(env.ROUTER_ONE_EXCLUDE ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const seen = new Set<string>();
  return entries
    .filter((e) => e.inPerM + e.outPerM > 0)
    .filter((e) => !(Number.isFinite(ceiling) && ceiling > 0 && e.outPerM > ceiling))
    .filter((e) => !exclude.some((x) => e.id.toLowerCase().includes(x)))
    .filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
    .sort((a, b) => (0.75 * a.inPerM + 0.25 * a.outPerM) - (0.75 * b.inPerM + 0.25 * b.outPerM) || a.id.localeCompare(b.id));
}

// ---- state (last good) ----
let lastGood: RouterOneRanking | null = null;
let lastError: { at: number; message: string } | null = null;
let inflight: Promise<RouterOneRanking | null> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

export function routerOneSyncEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !off(env.ROUTER_ONE_SYNC) && String(env.ROUTER_ONE_API_KEY ?? '').trim() !== '';
}
export function routerOneCatalogStatus() {
  return { enabled: routerOneSyncEnabled(), lastGood, lastError, mode: modelMode() };
}
function modelMode(env: NodeJS.ProcessEnv = process.env): 'synced' | 'env' | 'auto' {
  const m = String(env.ROUTER_ONE_MODEL_MODE ?? '').trim().toLowerCase();
  return m === 'env' || m === 'auto' ? m : 'synced';
}
/** Test hook. */
export function __setRouterOneRanking(r: RouterOneRanking | null) { lastGood = r; }

/**
 * Ordered model list for the Router One path. Never empty.
 * envModels = parsed ROUTER_ONE_MODEL (or default) from routerOne.ts.
 */
export function resolveRouterOneModels(envModels: string[], env: NodeJS.ProcessEnv = process.env, envModelExplicit = false): string[] {
  const mode = modelMode(env);
  if (mode === 'auto') return [ROUTER_ONE_AUTO_MODEL];
  if (mode === 'env' || off(env.ROUTER_ONE_SYNC) || !lastGood || lastGood.ranked.length === 0) return envModels;
  const top = Math.min(10, Math.max(1, Number(env.ROUTER_ONE_SYNC_TOP) || 3));
  const list = [...lastGood.ranked.slice(0, top).map((e) => e.id), ...(envModelExplicit ? envModels : []), ROUTER_ONE_AUTO_MODEL];
  return [...new Set(list)];
}

async function persist(r: RouterOneRanking): Promise<void> {
  const db = getServerDb();
  if (!db) return;
  await db.doc(ROUTER_ONE_CATALOG_DOC).set({ syncedAt: r.syncedAt, total: r.total, ranked: r.ranked.slice(0, 50) });
}
async function loadPersisted(): Promise<void> {
  const db = getServerDb();
  if (!db || lastGood) return;
  const snap = await db.doc(ROUTER_ONE_CATALOG_DOC).get();
  const d = snap.exists ? snap.data() : null;
  if (d && Array.isArray(d.ranked) && Number.isFinite(d.syncedAt)) {
    const ranked = (d.ranked as unknown[]).filter((e): e is RouterOneModelEntry => rec(e) && typeof e.id === 'string' && Number.isFinite(e.inPerM) && Number.isFinite(e.outPerM));
    if (ranked.length && !lastGood) lastGood = { syncedAt: d.syncedAt as number, ranked, total: Number(d.total) || ranked.length, source: 'store' };
  }
}

export async function syncRouterOneCatalog(opts: { fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv; priceSource?: Pick<RouterOnePublicPriceSource, 'snapshot'> } = {}): Promise<RouterOneRanking | null> {
  const env = opts.env ?? process.env;
  if (!routerOneSyncEnabled(env)) return lastGood;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const base = (String(env.ROUTER_ONE_BASE_URL ?? '').trim() || 'https://api.router.one/v1').replace(/\/+$/, '');
      const res = await (opts.fetchImpl ?? fetch)(`${base}/models`, {
        headers: { Authorization: `Bearer ${String(env.ROUTER_ONE_API_KEY).trim()}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`catalog HTTP ${res.status}`);
      const parsed = parseRouterOneCatalog(await res.json());
      // Legacy discovery prices are hints only. Rank solely on verified public tariffs.
      const verified: RouterOneModelEntry[] = [];
      const candidates = [...new Map(parsed.map(entry => [entry.id, entry])).values()].slice(0, 100);
      let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, async () => {
        while (cursor < candidates.length) {
          const entry = candidates[cursor++];
          try {
            const tariff = await (opts.priceSource ?? routerOnePublicPrices).snapshot(entry.id);
            verified.push({ ...entry, inPerM: Number(tariff.bands[0].inputUsdPerMillion), outPerM: Number(tariff.bands[0].outputUsdPerMillion) });
          } catch { /* unpriceable models are excluded; never guessed or zeroed */ }
        }
      }));
      const ranked = rankForCoding(verified, env);
      if (ranked.length === 0) throw new Error(`catalog had no priced coding models (${parsed.length} parsed)`);
      const next: RouterOneRanking = { syncedAt: Date.now(), ranked, total: parsed.length, source: 'live' };
      lastGood = next;
      lastError = null;
      await persist(next).catch((e) => console.warn(`[ENGINE_R1] catalog persist failed: ${e instanceof Error ? e.message : String(e)}`));
      return next;
    } catch (e) {
      lastError = { at: Date.now(), message: e instanceof Error ? e.message : String(e) };
      console.warn(`[ENGINE_R1] catalog sync failed (keeping last good): ${lastError.message}`);
      return lastGood;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Boot: restore persisted ranking, sync now, then every ROUTER_ONE_SYNC_INTERVAL_MIN. Idempotent. */
export function startRouterOneCatalogSync(env: NodeJS.ProcessEnv = process.env): void {
  if (timer || on(env.VITEST) || env.NODE_ENV === 'test') return;
  const minutes = Math.max(15, Number(env.ROUTER_ONE_SYNC_INTERVAL_MIN) || 360);
  void loadPersisted().catch(() => {}).finally(() => { void syncRouterOneCatalog().catch(() => {}); });
  timer = setInterval(() => { void syncRouterOneCatalog().catch(() => {}); }, minutes * 60_000);
  timer.unref?.();
}
