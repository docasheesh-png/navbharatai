/**
 * CheaperInference — one simple mode switch (owner 2026-10-26).
 *
 * Env: CHEAPERINFERENCE=off|admin|all  (also accepts CheaperInference=…)
 *   off   — never use (default)
 *   admin — ONLY verified admin Free Chat replies; free-chain ladder OFF for those
 *           replies so every admin answer comes from CheaperInference
 *   all   — would put this key on every Free Chat user. Keak terms §6 forbid shared
 *           access unless Keak has permitted it in writing, so `all` does not dispatch
 *           until CHEAPERINFERENCE_KEAK_WRITTEN_PERMISSION=on.
 *
 * Beam chat (model card, Reflection): reasoning effort is only low|medium|high|xhigh|max.
 * Admin sends `low` (the fastest allowed) and 2048 output tokens so thinking cannot
 * consume the whole reply. none/minimal are not on the Beam card and can 400.
 *
 * Official API (https://api.cheaperinference.com/docs):
 *   base URL  https://api.cheaperinference.com/v1
 *   auth      Authorization: Bearer ci_live_…
 *
 * Doctor AI and App Builder are untouched. No hardcoded keys. Default stays off.
 */
import { isAdminEmail } from './adminEmails';
import { parseEnvFlag } from './envFlag';
import type { GrantEmail } from '../AgentV3/featureFlag';

export const CHEAPERINFERENCE_BASE_URL = 'https://api.cheaperinference.com/v1';
export const CHEAPERINFERENCE_CHAT_MODEL_CANDIDATES = ['beam', 'beam-1.0-501b-a23b', 'deepseek-v4.1-flash-1017'] as const;
/**
 * Beam (Reflection) is a reasoning model. Catalog TTFT p90 ~5s is for first provider byte;
 * FreeChain only counts delta.content, so reasoning-before-content can burn the free-chat
 * 6s TTFT watchdog and surface as cheapinf:timeout. Exclusive admin waits longer.
 */
export const CHEAPERINFERENCE_ADMIN_FIRST_TOKEN_MS = 60_000;
/** Paid/all path still longer than free GLM/Groq, but not as patient as exclusive admin. */
export const CHEAPERINFERENCE_PAID_FIRST_TOKEN_MS = 30_000;

/** First-content grace for the cheapinf rung. Exclusive admin gets the long window. */
export function cheapinfFirstTokenMs(exclusiveAdmin: boolean, freeChainTtftMs = 6_000): number {
  const floor = exclusiveAdmin ? CHEAPERINFERENCE_ADMIN_FIRST_TOKEN_MS : CHEAPERINFERENCE_PAID_FIRST_TOKEN_MS;
  const base = Number.isFinite(freeChainTtftMs) ? Math.max(0, Math.floor(freeChainTtftMs)) : 0;
  return Math.max(floor, base);
}
export const CHEAPERINFERENCE_INDICATIVE_BEAM_USD_PER_MTOK = { input: 0.006, output: 0.022 } as const;

export type CheaperInferenceMode = 'off' | 'admin' | 'all';

/** Read CHEAPERINFERENCE or CheaperInference. Unknown values fail closed to off. */
export function cheaperInferenceMode(env: NodeJS.ProcessEnv = process.env): CheaperInferenceMode {
  const raw = (env.CHEAPERINFERENCE ?? env.CheaperInference ?? 'off').trim().toLowerCase();
  if (raw === 'admin' || raw === 'all' || raw === 'off') return raw;
  if (raw === '' || raw === 'false' || raw === '0' || raw === 'no') return 'off';
  return 'off';
}

export function cheaperInferenceApiKeyConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const key = (env.CHEAPERINFERENCE_API_KEY ?? '').trim();
  return !!key && !/[\s,]/.test(key);
}

/** Same admin check the rest of the server uses (verified grant email). */
export function isCheaperInferenceAdmin(email: GrantEmail | null | undefined): boolean {
  return isAdminEmail(email);
}

/** Admin exclusive path: mode=admin AND verified admin AND key present. */
export function cheaperInferenceExclusiveAdmin(
  email: GrantEmail | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return cheaperInferenceMode(env) === 'admin' && isCheaperInferenceAdmin(email) && cheaperInferenceApiKeyConfigured(env);
}

/** Keak terms §6: one key may not serve other users unless Keak allowed that product in writing. */
export function cheaperInferenceSharedAccessPermitted(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseEnvFlag(env.CHEAPERINFERENCE_KEAK_WRITTEN_PERMISSION) === true;
}

/** cheapinf rung may dispatch for everyone only in mode=all, with a key, and written permission. */
export function cheaperInferencePaidRungEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return cheaperInferenceMode(env) === 'all' && cheaperInferenceApiKeyConfigured(env) && cheaperInferenceSharedAccessPermitted(env);
}

/** Safe operator status — never returns the key. */
export function cheaperInferenceAdminStatus(env: NodeJS.ProcessEnv = process.env): {
  mode: CheaperInferenceMode;
  apiKeyConfigured: boolean;
  baseUrl: string;
  defaultModel: string;
  activationSafe: false;
} {
  return {
    mode: cheaperInferenceMode(env),
    apiKeyConfigured: cheaperInferenceApiKeyConfigured(env),
    baseUrl: CHEAPERINFERENCE_BASE_URL,
    defaultModel: (env.CHEAPERINFERENCE_MODEL ?? 'beam').trim() || 'beam',
    activationSafe: false,
  };
}
