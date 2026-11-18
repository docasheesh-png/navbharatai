/**
 * Traffic Manager V2, P1: the READ-ONLY registry snapshot (owner-approved plan, 2026-11-17).
 *
 * One place that answers "which providers and models does NavBharatAI call, what does each depend on, and where
 * is each fact defined?" — built by READING the modules that already define those facts, never by copying them:
 *   · providers ........ `PROVIDER_FAMILIES` (lib/providerSwitches.ts — the real kill switch)
 *   · billing/balance .. `API_PROVIDERS` (lib/apiProviderDirectory.ts)
 *   · Free Chat models . `freeChainConfig(env)` (AI/FreeChain/config.ts), with the rung's configured price
 *   · builder models ... `tierLadder(level, env)` and `PLAN_RUNG` (AgentV3/tierLadder.ts), env overrides included
 *   · reseller gateways  `RESELLER_GATEWAYS` (lib/resellerGateways.ts)
 *   · upstreams ........ `upstreamFamilies.ts`
 *
 * NOTHING READS THIS SNAPSHOT TO ROUTE YET. Building it calls no provider, reads no secret value, writes nothing.
 * Catalogs that live only at runtime (the gateway's reviewed Firestore catalog, the live OpenRouter free list, the
 * Surplus offer snapshot) are not static facts and join in P2, when the control store exists.
 */
import { freeChainConfig, type ProviderId } from '../FreeChain/config';
import { PLAN_RUNG, tierLadder, type LadderProvider } from '../../AgentV3/tierLadder';
import type { PowerLevel } from '../../AgentV3/powerLevel';
import { nemotronBaseUrl } from '../../AgentV3/nemotron';
import { API_PROVIDERS } from '../../lib/apiProviderDirectory';
import { PROVIDER_FAMILIES } from '../../lib/providerSwitches';
import { RESELLER_GATEWAY_IDS } from '../../lib/resellerGateways';
import { PROVIDER_UPSTREAM, routeDependencies } from './upstreamFamilies';
import type { ModelRecord, ProviderRecord, RegistrySnapshot, RegistrySource, RegistrySurface } from './types';

/**
 * Free Chat rung id → the provider account it calls. A `Record` over the chain's own id type, so adding a rung to
 * `PROVIDER_IDS` without saying which account it uses is a TYPE error, not a silent gap.
 */
export const FREE_CHAIN_RUNG_PROVIDER: Readonly<Record<ProviderId, string>> = Object.freeze({
  glm47: 'glm', glm45: 'glm', glmflashx: 'glm', groq: 'groq', gemini: 'gemini', geminipaid: 'gemini',
  cloudflare: 'cloudflare', nvidia: 'nvidia', openrouter: 'openrouter', modelscope: 'modelscope',
  bluesminds: 'bluesminds', requesty: 'requesty', llm7: 'llm7', cheapinf: 'cheaperinference',
  llama8b: 'deepinfra', dsv4flash: 'deepinfra', gpt5nano: 'openai', deepseek: 'deepseek',
});

/** Builder ladder provider → account. NEMOTRON is served through whatever host its base URL names. */
export function ladderProviderAccount(provider: LadderProvider, env: NodeJS.ProcessEnv = process.env): string {
  switch (provider) {
    case 'GLM': return 'glm';
    case 'KIMI': return 'kimi';
    case 'OPENAI': return 'openai';
    case 'CLAUDE': case 'CLAUDE_HAIKU': case 'CLAUDE_OPUS': return 'anthropic';
    case 'NEMOTRON': {
      let host = '';
      try { host = new URL(nemotronBaseUrl(env)).hostname.toLowerCase(); } catch { host = ''; }
      if (host === 'openrouter.ai' || host.endsWith('.openrouter.ai')) return 'openrouter';
      if (host.endsWith('nvidia.com')) return 'nvidia';
      if (host.endsWith('deepinfra.com')) return 'deepinfra';
      return 'unknown-host';
    }
  }
}

/** Directory rows that are deliberately not kill-switch families, each with its reason. */
export const DIRECTORY_ONLY: Readonly<Record<string, string>> = Object.freeze({
  'custom-image': 'An operator-configured image endpoint, not a fixed provider; its host is whatever the operator sets.',
});

const POWER_LEVELS: readonly PowerLevel[] = ['weak', 'off', 'mini'];

export function buildRegistrySnapshot(env: NodeJS.ProcessEnv = process.env): RegistrySnapshot {
  const notes: string[] = [];
  const directory = new Map(API_PROVIDERS.map(p => [p.id, p]));
  const resellers = new Set<string>(RESELLER_GATEWAY_IDS);

  const providers: ProviderRecord[] = PROVIDER_FAMILIES.map(f => {
    const up = PROVIDER_UPSTREAM[f.id];
    if (!up) throw new Error(`Kill-switch family "${f.id}" has no upstream classification`);
    const dir = directory.get(f.id);
    const sources: RegistrySource[] = ['provider-switch'];
    if (dir) sources.push('api-directory');
    if (resellers.has(f.id)) sources.push('reseller-gateway');
    if (up.note) notes.push(`${f.id}: ${up.note}`);
    return { id: f.id, name: f.name, kind: up.kind, family: up.family, evidence: up.kind === 'direct' ? 'direct' : 'unverified',
      killSwitch: true, inDirectory: !!dir, balanceProbe: dir?.balance ?? null, sources };
  });

  const models = new Map<string, ModelRecord>();
  const add = (providerId: string, modelId: string, surface: RegistrySurface, source: RegistrySource,
    offer?: ModelRecord['offers'][number]) => {
    const key = `${providerId}/${modelId}`;
    const existing = models.get(key);
    if (existing) {
      if (!existing.surfaces.includes(surface)) existing.surfaces.push(surface);
      if (!existing.sources.includes(source)) existing.sources.push(source);
      if (offer && !existing.offers.some(o => o.via === offer.via)) existing.offers.push(offer);
      return;
    }
    const dep = routeDependencies(providerId, modelId);
    models.set(key, { key, providerId, modelId, maker: dep.maker, dependsOn: dep.dependsOn, evidence: dep.evidence,
      surfaces: [surface], offers: offer ? [offer] : [], sources: [source] });
  };

  // Free Chat: every rung the chain defines, configured or not (an unconfigured rung is still an integration).
  const chain = freeChainConfig(env);
  for (const rung of chain.rungs) {
    const id = rung.id;
    const account = FREE_CHAIN_RUNG_PROVIDER[id];
    if (!rung.model) { notes.push(`Free Chat rung "${id}" has no fixed model; ${account === 'openrouter' ? 'the live free-model registry picks it at runtime' : 'its model is not configured'}.`); continue; }
    const priced = Number.isFinite(rung.priceIn) && Number.isFinite(rung.priceOut);
    add(account, rung.model, 'chat', 'free-chain', priced ? { via: `free-chain:${id}`, inPerM: rung.priceIn, outPerM: rung.priceOut, source: 'free-chain-config' } : undefined);
  }

  // Builder: the ladder IN FORCE per tier (an env override applies whole or not at all), plus each tier's plan rung.
  for (const level of POWER_LEVELS) {
    const ladder = tierLadder(level, env);
    if (ladder.rejected) notes.push(ladder.rejected);
    for (const rung of [...ladder.rungs, PLAN_RUNG[level]]) {
      const account = ladderProviderAccount(rung.provider, env);
      if (account === 'unknown-host') { notes.push(`Builder rung ${rung.provider}:${rung.model} points at a host the registry does not know.`); continue; }
      add(account, rung.model, 'builder', 'builder-ladder');
    }
  }

  return {
    schemaVersion: 1,
    providers: providers.sort((a, b) => a.id.localeCompare(b.id)),
    models: [...models.values()].sort((a, b) => a.key.localeCompare(b.key)),
    notes,
  };
}
