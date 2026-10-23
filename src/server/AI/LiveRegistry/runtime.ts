import { refreshGatewayCatalog } from '../InferenceGateway/catalogRefresh';
import { assertAiAvailable } from '../../lib/aiMaintenance';
import { parseEnvFlag } from '../../lib/envFlag';
import { getServerDb } from '../../lib/serverDb';
import { audit } from '../../lib/audit';
import { FirestoreRegistryStore } from './store';
import { RegistrySynchronizer, retryAfterMs, type RegistryConfig } from './sync';
import { FreeRoutingError, StrictFreeDispatcher, type FreeTextRequest, type FreeToolRequest } from './dispatcher';
import { hedgeFreeChat } from './chatHedge';
import { eligibility } from './eligibility';
import type { AdminRegistryView } from './types';
function bounded(value: string | undefined, fallback: number, min: number, max: number) {
  const n = Number(value); return Number.isSafeInteger(n) && n >= min && n <= max ? n : fallback;
}
export function registryConfig(env: NodeJS.ProcessEnv = process.env): RegistryConfig {
  return { enabled: parseEnvFlag(env.LIVE_MODEL_REGISTRY_ENABLED) === true,
    strictFreeModulesEnabled: parseEnvFlag(env.STRICT_FREE_MODULES_ENABLED) === true,
    // Retired: Pro App Builder is not part of the Free product rollout.
    strictFreeWeakEnabled: false,
    apiKey: (env.OPENROUTER_API_KEY ?? '').trim(),
    syncIntervalMs: bounded(env.LIVE_MODEL_SYNC_INTERVAL_MS, 300000, 60000, 3600000),
    metadataTtlMs: bounded(env.LIVE_MODEL_METADATA_TTL_MS, 600000, 60000, 3600000) };
}
export function strictFreeModulesEnabled(): boolean { return registryConfig().strictFreeModulesEnabled; }
export function strictFreeWeakEnabled(): boolean { return registryConfig().strictFreeWeakEnabled; }
let instance: { store: FirestoreRegistryStore; sync: RegistrySynchronizer; dispatcher: StrictFreeDispatcher } | null = null;
function runtime() {
  if (!instance) {
    const db = getServerDb(); if (!db) throw new FreeRoutingError('FREE_REGISTRY_STORE_UNAVAILABLE');
    const store = new FirestoreRegistryStore(db);
    instance = { store, sync: new RegistrySynchronizer(store, registryConfig), dispatcher: new StrictFreeDispatcher(store, registryConfig) };
  }
  return instance;
}
export async function strictFreeText(input: FreeTextRequest) { await assertAiAvailable(); return runtime().dispatcher.text(input); }
export async function strictFreeChat(input: FreeTextRequest) {
  await assertAiAvailable();
  if (parseEnvFlag(process.env.FREE_CHAT_HEDGE_ENABLED) !== true) return runtime().dispatcher.text(input);
  return hedgeFreeChat(attempt => runtime().dispatcher.text(attempt), input, { delayMs: bounded(process.env.FREE_CHAT_HEDGE_DELAY_MS, 1500, 100, 10000) });
}
export async function strictFreeToolTurn(input: FreeToolRequest) { await assertAiAvailable(); return runtime().dispatcher.toolTurn(input); }
/** Metadata-only preflight before allocating a paid sandbox. It does not execute inference or promise future quota. */
export async function assertStrictFreeToolAvailable(maxOutputTokens = 8192): Promise<void> {
  const cfg = registryConfig();
  if (!cfg.enabled || !cfg.apiKey) throw new FreeRoutingError('FREE_REGISTRY_NOT_CONFIGURED');
  const { store } = runtime(); const state = await store.routingState(); const now = Date.now();
  if (!state.manifest || state.manifest.expiresAt <= now) throw new FreeRoutingError('FREE_REGISTRY_STALE');
  for (const model of state.models) {
    if (model.supportedCapabilities.includes('tools') && model.supportedCapabilities.includes('tool_choice:auto') && model.supportedCapabilities.includes('max_tokens')
      && model.contextWindow > Math.min(maxOutputTokens, 1024) && (model.maximumOutputTokens === null || model.maximumOutputTokens >= Math.min(maxOutputTokens, 1024))
      && eligibility(model, state.controls[model.exactModelId], state.health[model.exactModelId], now).status === 'VERIFIED_FREE'
      && await store.recheck(model, now)) return;
  }
  throw new FreeRoutingError('NO_VERIFIED_FREE_TOOL_MODEL');
}

export async function syncLiveModels() {
  if (!registryConfig().enabled) return { status: 'disabled' as const };
  try {
    const result = await runtime().sync.sync();
    audit('LIVE_MODEL_SYNC', { status: result.status, version: result.version ?? null });
    if (parseEnvFlag(process.env.INFERENCE_GATEWAY_ENABLED) === true) {
      // The existing startup/admin/scheduled sync also refreshes already reviewed gateway entries.
      // A failed refresh never renews approvals or authorizes the old registry generation.
      try {
        const db = getServerDb();
        if (db && (await db.doc('free_chat_chain/gateway_catalog').get()).exists) {
          const refreshed = await refreshGatewayCatalog(db, await runtime().store.read(), registryConfig().apiKey);
          audit('GATEWAY_CATALOG_REFRESH', { status: refreshed.status, updatedProfiles: refreshed.updatedProfiles });
        }
      } catch { audit('GATEWAY_CATALOG_REFRESH_FAILED', { reason: 'Reviewed gateway metadata was not refreshed.' }); }
    }
    return result;
  }
  catch (error) { audit('LIVE_MODEL_SYNC_FAILED', { reason: 'Catalog unavailable or invalid; strict freshness gate enforced.' }); throw error; }
}
export async function liveModelRegistryView(): Promise<AdminRegistryView> {
  const state = await runtime().store.read(); const history = await runtime().store.adminHistory(); const cfg = registryConfig(); const now = Date.now();
  const imageDiscovery = await runtime().store.imageState();
  const manifest = state.manifest ? (({ accountCredentialBinding: _private, ...publicManifest }) => publicManifest)(state.manifest) : null;
  return { ...state, manifest, ...history, imageDiscovery, enabled: cfg.enabled, strictFreeModulesEnabled: cfg.strictFreeModulesEnabled, strictFreeWeakEnabled: cfg.strictFreeWeakEnabled, configured: !!cfg.apiKey,
    syncIntervalMs: cfg.syncIntervalMs,
    limitations: [
      'Five-minute polling is not instantaneous provider price-change notification.',
      'Free inference does not mean free hosting, database operations, sandbox execution, or third-party tools.',
      'Account catalog membership is not proof of remaining quota or response quality; quota is handled at request time.',
      'The free-variant fee basis is OpenRouter’s documented free-endpoint contract, not an invented missing-price value.',
      'Other provider catalogs remain unverified; only the documented OpenRouter adapter can authorize free inference.',
      'History is bounded: 288 sync summaries and up to 4096 sampled routing audit slots; this view shows the latest 30 of each.',
      'Only Free modules use this rollout. Pro App Builder, including Weak, retains its legacy routing. Existing owner-funded daily image generation is an explicit exception.',
      'Terms approval records an administrator review only; it does not accept an external agreement.',
    ],
    models: state.models.map(model => {
      const health = state.health[model.exactModelId]; const decision = eligibility(model, state.controls[model.exactModelId], health, now);
      return { ...model, eligibilityStatus: decision.status, eligibilityReason: decision.reason,
        routable: cfg.enabled && (cfg.strictFreeModulesEnabled || cfg.strictFreeWeakEnabled) && !!cfg.apiKey && decision.status === 'VERIFIED_FREE',
        cooldownUntil: health?.cooldownUntil ?? 0, recentLatency: health?.latencyMs ?? null,
        recentSuccessRate: health?.attempts ? health.successes / health.attempts : null, lastErrorCode: health?.lastErrorCode ?? null };
    }),
  };
}
export async function controlLiveModel(modelId: string, action: 'disable' | 'enable' | 'approve-terms', actor: string, registryVersion: string, reason: string) {
  await runtime().store.control(modelId, action, actor, Date.now(), registryVersion, reason);
}

/** Separate hourly metadata scan. Never calls image inference or changes the existing funded image pipeline. */
export async function syncLiveImageModels() {
  if (!registryConfig().enabled) return { status: 'disabled' as const };
  const store = runtime().store; const lease = await store.claimImages(Date.now());
  if (!lease) return { status: 'held' as const };
  try {
    const { discoverImageModels } = await import('./imageDiscovery');
    const snapshot = await discoverImageModels();
    await store.publishImages(lease, snapshot, Date.now());
    audit('LIVE_IMAGE_MODEL_SYNC', { count: snapshot.models.length });
    return { status: 'published' as const };
  } catch (error) {
    const now = Date.now(); const retry = retryAfterMs((error as { retryAfter?: string }).retryAfter, now);
    await store.failImages(lease, now, now + (retry ?? 300000)).catch(() => {});
    audit('LIVE_IMAGE_MODEL_SYNC_FAILED', { reason: 'Metadata discovery unavailable; no inference performed.' });
    throw error;
  }
}
