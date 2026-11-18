/**
 * Mitrify — Pro Chain V2 BUILDER adapter (written from zero; the AI-chat Mitrify files are not used).
 *
 * Mitrify is the owner's own OpenAI-compatible gateway (served from a second, independent Surplus
 * account). Its pilot documents `GET /v1/models` and `POST /v1/chat/completions` with
 * `Authorization: Bearer mtf_live_…` (docs/TEST_CHAT_BOT.md). The chat transport (lib/mitrify.ts) strips
 * tools on purpose; the builder needs them, so the builder calls Mitrify through the ordinary
 * OpenAI-protocol builder runner instead. Whether a given Mitrify model honours `tools` is a fact only a
 * real call settles — an unsupported model fails that turn and the report names it (admin-only).
 *
 *   MITRIFY_API_KEY           required (the same server key the chat uses; MITRIFY_CHAIN_ENABLED is NOT required).
 *   MITRIFY_BASE_URL          optional, default https://mitrify.com/v1 (shared with chat; read only).
 *   MITRIFY_BUILDER_MODEL     optional comma list; default MITRIFY_MODEL, else `mitrify/auto-cheap`.
 *   MITRIFY_BUILDER_RATE_IN / _OUT / _CACHE   optional USD per 1M tokens the owner's Mitrify account really
 *                             pays. Unset ⇒ the Surplus floor rate (glm-5.3-flash $0.15/$0.50, cache $0.03),
 *                             billed and LABELLED as an estimate.
 *   PRO_CHAIN_V2_MITRIFY=off  removes Mitrify from the chain.
 */
import { parseEnvFlag } from '../../lib/envFlag';
import type { TokenRate } from '../pricing';

export const MITRIFY_BUILDER_DEFAULT_BASE_URL = 'https://mitrify.com/v1';
export const MITRIFY_BUILDER_DEFAULT_MODEL = 'mitrify/auto-cheap';
/** Same figures as the Surplus stop-floor estimate (glm-5.3-flash, Z.ai's published page). */
export const MITRIFY_ESTIMATED_RATE: Readonly<TokenRate> = Object.freeze({ inputPerMTok: 0.15, outputPerMTok: 0.5, cacheReadPerMTok: 0.03 });

export function mitrifyBuilderApiKey(env: NodeJS.ProcessEnv = process.env): string {
  return String(env.MITRIFY_API_KEY ?? '').trim();
}
export function mitrifyBuilderEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseEnvFlag(env.PRO_CHAIN_V2_MITRIFY) !== false && mitrifyBuilderApiKey(env) !== '';
}
export function mitrifyBuilderBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = String(env.MITRIFY_BASE_URL ?? '').trim() || MITRIFY_BUILDER_DEFAULT_BASE_URL;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' ? raw.replace(/\/+$/, '') : MITRIFY_BUILDER_DEFAULT_BASE_URL;
  } catch { return MITRIFY_BUILDER_DEFAULT_BASE_URL; }
}
export function mitrifyBuilderModels(env: NodeJS.ProcessEnv = process.env): string[] {
  const list = String(env.MITRIFY_BUILDER_MODEL ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.length) return list;
  return [String(env.MITRIFY_MODEL ?? '').trim() || MITRIFY_BUILDER_DEFAULT_MODEL];
}

function rate(raw: string | undefined): number | undefined {
  if (raw === undefined || String(raw).trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** The owner-configured real rate, or undefined (⇒ the labelled estimate). PURE. */
export function mitrifyConfiguredRate(env: NodeJS.ProcessEnv = process.env): TokenRate | undefined {
  const input = rate(env.MITRIFY_BUILDER_RATE_IN);
  const output = rate(env.MITRIFY_BUILDER_RATE_OUT);
  if (input === undefined || output === undefined || (input === 0 && output === 0)) return undefined;
  const cache = rate(env.MITRIFY_BUILDER_RATE_CACHE);
  return { inputPerMTok: input, outputPerMTok: output, ...(cache !== undefined ? { cacheReadPerMTok: cache } : {}) };
}
