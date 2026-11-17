/**
 * Traffic Manager V2, P1: SHARED UPSTREAM DEPENDENCIES (owner-mandated 2026-11-17: "Two resellers using the same
 * upstream must not be treated as independent fallbacks").
 *
 * Two facts are kept apart on purpose:
 *  · the provider's OWN outage domain (`family`) — a direct provider is its own upstream; a reseller is
 *    `reseller:<id>`, because its own gateway can fail even when its upstream is fine;
 *  · what a ROUTE (provider + model) may share — `dependsOn`. A reseller whose serving host is unknown is
 *    assumed to share the model maker's domain (a DeepSeek model sold by a reseller is most likely served by
 *    DeepSeek or by a host that also serves the direct DeepSeek rung). Unknown maker + unknown host ⇒ `unknown`,
 *    which is independent of NOTHING.
 *
 * Conservative by construction: an unproven independence is treated as a shared dependency. A wrong "shared"
 * costs a slightly less diverse fallback order; a wrong "independent" lets one outage take two rungs at once.
 *
 * This module only DESCRIBES. Family-wide suppression (P3) needs independent evidence and never follows from
 * this table alone (owner improvement #1, 2026-11-17).
 */
import type { UpstreamEvidence } from './types';

export const UNKNOWN = 'unknown';

/**
 * Every provider family that has a kill switch, with its upstream. Keyed EXACTLY by the ids in
 * `PROVIDER_FAMILIES` (providerSwitches.ts) — `upstreamFamilies.test.ts` fails when a family is added there and
 * not classified here, so a new provider cannot enter the registry unclassified.
 */
export const PROVIDER_UPSTREAM: Readonly<Record<string, { kind: 'direct' | 'reseller'; family: string; note?: string }>> = Object.freeze({
  // Direct: the provider serves from its own infrastructure.
  sarvam: { kind: 'direct', family: 'sarvam' },
  glm: { kind: 'direct', family: 'zhipu' },
  kimi: { kind: 'direct', family: 'moonshot' },
  anthropic: { kind: 'direct', family: 'anthropic' },
  // Gemini Developer API and Vertex are separate products on Google's shared model serving. Treated as ONE
  // domain: claiming them independent is the unsafe direction.
  gemini: { kind: 'direct', family: 'google' },
  vertex: { kind: 'direct', family: 'google' },
  openai: { kind: 'direct', family: 'openai' },
  xai: { kind: 'direct', family: 'xai' },
  deepinfra: { kind: 'direct', family: 'deepinfra' },
  groq: { kind: 'direct', family: 'groq' },
  deepseek: { kind: 'direct', family: 'deepseek' },
  cloudflare: { kind: 'direct', family: 'cloudflare' },
  pollinations: { kind: 'direct', family: 'pollinations' },
  // Bedrock serves Anthropic (and other) models on AWS's own infrastructure.
  bedrock: { kind: 'direct', family: 'aws' },
  nvidia: { kind: 'direct', family: 'nvidia' },
  modelscope: { kind: 'direct', family: 'alibaba' },
  // Routers and resellers: their serving host is not verified by us.
  openrouter: { kind: 'reseller', family: 'reseller:openrouter', note: 'Routes each model to one of several hosts; the host is chosen per request by OpenRouter.' },
  requesty: { kind: 'reseller', family: 'reseller:requesty', note: 'Model ids name the serving host (e.g. deepinfra/...).' },
  surplus: { kind: 'reseller', family: 'reseller:surplus' },
  'router-one': { kind: 'reseller', family: 'reseller:router-one' },
  qubax: { kind: 'reseller', family: 'reseller:qubax' },
  mitrify: { kind: 'reseller', family: 'reseller:mitrify' },
  cheaperinference: { kind: 'reseller', family: 'reseller:cheaperinference' },
  bluesminds: { kind: 'reseller', family: 'reseller:bluesminds' },
  llm7: { kind: 'reseller', family: 'reseller:llm7' },
  moyi: { kind: 'reseller', family: 'reseller:moyi' },
  discountedtokens: { kind: 'reseller', family: 'reseller:discountedtokens', note: 'Sells OpenAI models only; the serving host is not verified.' },
  mirapi: { kind: 'reseller', family: 'reseller:mirapi' },
});

/** Model maker from the model id. Order matters: the first match wins. `unknown` when nothing matches. */
const MAKERS: ReadonlyArray<[RegExp, string]> = [
  [/(^|\/)glm[-_]/i, 'zhipu'],
  [/(^|\/)kimi[-_]|moonshot/i, 'moonshot'],
  [/deepseek/i, 'deepseek'],
  [/(^|\/)(gpt-|gpt_|o[1-9](-|$)|codex|chatgpt)|openai\/gpt-oss/i, 'openai'],
  [/(^|\/)(gemini|gemma)/i, 'google'],
  [/claude|^(haiku|sonnet|opus)$/i, 'anthropic'],
  [/(^|\/)grok/i, 'xai'],
  [/llama|meta-llama/i, 'meta'],
  [/nemotron/i, 'nvidia'],
  [/qwen/i, 'alibaba'],
  [/mistral|mixtral|codestral/i, 'mistral'],
];

export function modelMaker(modelId: string): string {
  const id = String(modelId ?? '').trim();
  for (const [re, maker] of MAKERS) if (re.test(id)) return maker;
  return UNKNOWN;
}

/** Serving hosts a reseller's model id can name (Requesty style `host/maker/model`). */
const ROUTE_HOSTS: Readonly<Record<string, string>> = Object.freeze({
  deepinfra: 'deepinfra', groq: 'groq', together: 'together', fireworks: 'fireworks', openai: 'openai',
  anthropic: 'anthropic', google: 'google', vertex: 'google', 'aws-bedrock': 'aws', bedrock: 'aws',
});

/**
 * What a route (provider + model) may share with another route. Always includes the provider's own domain.
 * Throws for a provider with no classification: the census guarantees every known provider has one, so a throw
 * here is a programming error, never a silent "independent".
 */
export function routeDependencies(providerId: string, modelId: string): { dependsOn: string[]; evidence: UpstreamEvidence; maker: string } {
  const up = PROVIDER_UPSTREAM[providerId];
  if (!up) throw new Error(`Provider "${providerId}" has no upstream classification in upstreamFamilies.ts`);
  const maker = modelMaker(modelId);
  if (up.kind === 'direct') return { dependsOn: [up.family], evidence: 'direct', maker };
  if (providerId === 'requesty') {
    const host = String(modelId).split('/')[0]?.toLowerCase() ?? '';
    const served = ROUTE_HOSTS[host];
    if (served) return { dependsOn: uniq([up.family, served]), evidence: 'model-route', maker };
  }
  return { dependsOn: uniq([up.family, maker]), evidence: 'unverified', maker };
}

/**
 * May these two routes be used as INDEPENDENT fallbacks for each other? Only when their dependency sets share
 * nothing and neither contains `unknown`. Symmetric. Two routes on the same provider are never independent.
 */
export function independentRoutes(a: readonly string[], b: readonly string[]): boolean {
  if (a.includes(UNKNOWN) || b.includes(UNKNOWN)) return false;
  return !a.some(x => b.includes(x));
}

function uniq(values: string[]): string[] { return [...new Set(values)]; }
