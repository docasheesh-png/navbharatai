import { parseEnvFlag } from '../../lib/envFlag';
import { usdToNanoUsd, DEFAULT_PAID_CAP_NANO_USD, OWNER_PAID_DAILY_CEILING_NANO_USD, NANO_USD } from './spendCap';
import { dailyWindow } from './quota';
import { DEFAULT_ADMISSION_QUEUE_LIMITS } from './admissionQueue';
// Cache only identifier validation, never a quota window or eligibility decision. IANA
// identifiers are stable within this process; actual reservations still compute fresh DST windows.
const validatedTimezones = new Set<string>();
function validateTimezone(timeZone: string): void {
  if (validatedTimezones.has(timeZone)) return;
  dailyWindow(Date.now(), timeZone);
  if (validatedTimezones.size >= 32) validatedTimezones.clear();
  validatedTimezones.add(timeZone);
}
/**
 * Owner tier order (2026-10-23): Tier 1 true-free → Tier 2 gateways → Tier 3 cheapest paid.
 * Terms-blocked providers stay REGISTERED (visible in admin, documented) but can never dispatch
 * unless the owner records written commercial permission. See docs/FREE_CHAT_CHAIN.md §Tiers.
 */
export const PROVIDER_IDS = [
  // Tier 1 — true free
  'glm47', 'glm45', 'groq', 'gemini', 'cloudflare', 'nvidia',
  // Tier 2 — limited free gateways
  'openrouter', 'modelscope', 'bluesminds', 'requesty', 'llm7',
  // Tier 3 — cheapest paid, shared owner budget; always after every free rung
  'glmflashx', 'nemotron', 'gpt5nano', 'deepseek',
] as const;
/** Paid rungs. Each reserves against the one shared owner-funded daily budget before dispatch. */
export const PAID_PROVIDER_IDS = ['glmflashx', 'nemotron', 'gpt5nano', 'deepseek'] as const;
/** Free/gateway providers whose published terms forbid production or third-party serving. */
export const TERMS_BLOCKED_IDS = ['nvidia', 'modelscope', 'llm7'] as const;
/** Gateways whose free-tier terms/limits could not be verified from official docs. */
export const TERMS_UNVERIFIED_IDS = ['bluesminds', 'requesty'] as const;
export const DEFAULT_ORDER = ['glm47', 'glm45', 'groq', 'gemini', 'cloudflare', 'openrouter', 'glmflashx', 'nemotron', 'gpt5nano', 'deepseek'] as const;
export function isPaidRung(id: string): boolean { return (PAID_PROVIDER_IDS as readonly string[]).includes(id); }
export type ProviderId = typeof PROVIDER_IDS[number];
export type ReplyLanguage = 'hi' | 'hinglish' | 'en' | 'other';
export interface RungConfig {
  id: ProviderId; model: string; key: string; keyEnv: string; baseURL: string;
  configured: boolean; reason?: string; languages: ReplyLanguage[];
  maxInputTokens: number; maxOutputTokens: number;
  rpm: number; rpd: number; tpm: number; tpd: number; timeZone: string;
  verifiedUntil: number; streamUsage: boolean;
  /** USD per 1M tokens used for paid reservations. Zero for free rungs. */
  priceIn: number; priceOut: number;
}
export interface FreeChainConfig {
  enabled: boolean; rolloutPercent: number; allowUids: string[]; order: ProviderId[];
  skipGemini: boolean; privacyApproved: boolean; ttftMs: number; cacheEnabled: boolean; cacheTtlS: number;
  paidCapNanoUsd: number; paidPerUserDaily: number; safetyMargin: number;
  queue: { maxActive: number; maxQueued: number; maxWaitMs: number; perUserActive: number; perUserQueued: number };
  deepseekPrices: { input: number; output: number; cached: number };
  openRouterModels: string[]; rungs: RungConfig[]; errors: string[];
  /** Max PHYSICAL provider attempts per turn (owner spec: 3-4). Skipped rungs do not count. */
  maxAttempts: number;
  /** Spread users across equal-cost free Tier-1 rungs by a stable uid hash (continuity + load spread). */
  stickySpread: boolean;
}
const MODELS: Record<ProviderId, string> = {
  glm47: 'glm-4.7-flash', glm45: 'glm-4.5-flash',
  // Existing Google projects may retain 2.5; availability must be verified before activation.
  gemini: 'gemini-2.5-flash-lite', groq: 'openai/gpt-oss-120b',
  cloudflare: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', openrouter: '', deepseek: 'deepseek-flash',
  // Registered-but-blocked rungs: ids from official docs, never dispatched without written permission.
  nvidia: 'nvidia/nemotron-3-nano-30b-a3b', modelscope: 'Qwen/Qwen3-32B', llm7: 'default',
  bluesminds: 'openai/gpt-oss-20b', requesty: 'deepinfra/nvidia/Nemotron-3-Nano-30B-A3B',
  // Tier 3 paid (verified 2026-10-23 from official price pages, see docs).
  glmflashx: 'glm-4.7-flashx', nemotron: 'nvidia/Nemotron-3-Nano-30B-A3B', gpt5nano: 'gpt-5-nano',
};
/** Official list prices, USD / 1M tokens (in, out). Env may RAISE, never lower, a reservation price. */
const PAID_PRICES: Record<string, [number, number]> = { glmflashx: [0.07, 0.40], nemotron: [0.05, 0.20], gpt5nano: [0.05, 0.40] };
const BASE_URLS: Partial<Record<ProviderId, string>> = {
  nvidia: 'https://integrate.api.nvidia.com/v1', modelscope: 'https://api-inference.modelscope.cn/v1',
  llm7: 'https://api.llm7.io/v1', bluesminds: 'https://api.bluesminds.com/v1', requesty: 'https://router.requesty.ai/v1',
  glmflashx: 'https://api.z.ai/api/paas/v4', nemotron: 'https://api.deepinfra.com/v1/openai', gpt5nano: 'https://api.openai.com/v1',
};
const PREFIX: Record<ProviderId, string> = { glm47: 'GLM', glm45: 'GLM', gemini: 'GEMINI', groq: 'GROQ', cloudflare: 'CF', openrouter: 'OPENROUTER', deepseek: 'DEEPSEEK',
  nvidia: 'NVIDIA', modelscope: 'MODELSCOPE', llm7: 'LLM7', bluesminds: 'BLUESMINDS', requesty: 'REQUESTY', glmflashx: 'GLMX', nemotron: 'DEEPINFRA', gpt5nano: 'OPENAI' };
const DEFAULT_LIMITS: Record<ProviderId, [number, number, number, number]> = {
  // No guessed GLM/Gemini account quotas. Zero skips until configured from their account consoles.
  glm47: [0, 0, 0, 0], glm45: [0, 0, 0, 0],
  gemini: [0, 0, 0, 0], groq: [30, 1000, 8000, 200000], cloudflare: [60, 10000, 24000, 1000000],
  openrouter: [20, 50, 100000, 1000000], deepseek: [30, 1000, 2000000, 10000000],
  // LLM7 free token: 60/min, 100K tokens/24h (docs.llm7.io/limits). Others: no guessed quotas.
  nvidia: [0, 0, 0, 0], modelscope: [0, 0, 0, 0], llm7: [60, 250 * 24, 100000, 100000], bluesminds: [0, 0, 0, 0], requesty: [0, 0, 0, 0],
  // Paid rungs: the money cap is the real limit; these only bound bursts per instance pool.
  glmflashx: [60, 50000, 2000000, 100000000], nemotron: [60, 50000, 2000000, 100000000], gpt5nano: [60, 50000, 2000000, 100000000],
};
function list(value: string | undefined): string[] { return (value ?? '').split(',').map(v => v.trim()).filter(Boolean); }
export function freeChainConfig(env: NodeJS.ProcessEnv = process.env): FreeChainConfig {
  const errors: string[] = [];
  function num(name: string, fallback: number, min: number, max: number, integer = true): number {
    if (env[name] === undefined || env[name] === '') return fallback;
    const n = Number(env[name]);
    if (!Number.isFinite(n) || (integer && !Number.isSafeInteger(n)) || n < min || n > max) { errors.push(name); return fallback; }
    return n;
  }
  function money(name: string, fallback: number, min: number, max: number): number {
    const raw = env[name];
    if (raw === undefined || raw === '') return usdToNanoUsd(fallback);
    try {
      const value = usdToNanoUsd(raw.trim());
      if (value < usdToNanoUsd(min) || value > usdToNanoUsd(max)) throw new Error('Out of range');
      return value;
    } catch { errors.push(name); return usdToNanoUsd(fallback); }
  }
  function flag(name: string, fallback = false): boolean {
    if (env[name] === undefined || env[name] === '') return fallback;
    const value = parseEnvFlag(env[name]); if (value === null) { errors.push(name); return fallback; } return value;
  }
  const rawOrder = list(env.FREE_CHAIN_ORDER); const order: string[] = rawOrder.length ? rawOrder : [...DEFAULT_ORDER];
  if (order.some(p => !PROVIDER_IDS.includes(p as ProviderId)) || new Set(order).size !== order.length) errors.push('FREE_CHAIN_ORDER');
  // The paid rung can be disabled, never promoted above a free rung by configuration.
  // No paid rung may ever sit above a free rung, whatever the order says.
  const firstPaid = order.findIndex(isPaidRung);
  if (firstPaid >= 0 && order.slice(firstPaid).some(p => !isPaidRung(p))) errors.push('FREE_CHAIN_ORDER');
  const skipGemini = flag('FREE_CHAIN_SKIP_GEMINI', true);
  const privacyApproved = flag('FREE_CHAIN_GEMINI_PRIVACY_APPROVED');
  const rungs = PROVIDER_IDS.map((id): RungConfig => {
    const prefix = PREFIX[id]; const keyEnv = id === 'openrouter' ? 'OPENROUTER_API_KEY' : `FREE_CHAIN_${prefix}_${id === 'cloudflare' ? 'API_TOKEN' : 'API_KEY'}`;
    // One key per provider account. A comma/space list is rejected: rotating several free accounts to
    // multiply a free allowance violates every provider's terms (see docs: "Why no key pooling").
    const rawKey = (env[keyEnv] ?? '').trim(); const validKey = !!rawKey && !/[\s,]/.test(rawKey);
    const modelEnv = `FREE_CHAIN_${id === 'glm47' ? 'GLM47' : id === 'glm45' ? 'GLM45' : prefix}_MODEL`;
    const blocked = (TERMS_BLOCKED_IDS as readonly string[]).includes(id); const unverified = (TERMS_UNVERIFIED_IDS as readonly string[]).includes(id);
    const writtenApproval = (blocked || unverified) && parseEnvFlag(env[`FREE_CHAIN_${prefix}_WRITTEN_APPROVAL`]) === true;
    const model = (env[modelEnv] ?? MODELS[id]).trim();
    const allowed = id === 'gemini' ? ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.8-flash'].includes(model)
      : id === 'groq' ? ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'].includes(model) : model === MODELS[id];
    const verifiedUntil = Date.parse(env[`FREE_CHAIN_${prefix}_FREE_VERIFIED_UNTIL`] ?? '');
    const langs = list(env[`FREE_CHAIN_${prefix}_LANGS`]);
    if (langs.some(v => !['hi', 'hinglish', 'en', 'other'].includes(v))) errors.push(`FREE_CHAIN_${prefix}_LANGS`);
    if (rawKey && !validKey) errors.push(keyEnv);
    if (!allowed) errors.push(modelEnv);
    const account = env.CLOUDFLARE_ACCOUNT_ID ?? '';
    const baseURL = id === 'glm47' || id === 'glm45' ? 'https://api.z.ai/api/paas/v4'
      : id === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta/openai'
      : id === 'groq' ? 'https://api.groq.com/openai/v1'
      : id === 'cloudflare' ? `https://api.cloudflare.com/client/v4/accounts/${/^[a-f\d]{32}$/i.test(account) ? account : 'unconfigured'}/ai/v1`
      : id === 'deepseek' ? 'https://api.deepseek.com/v1' : BASE_URLS[id] ?? 'https://openrouter.ai/api/v1';
    let reason = !validKey ? 'unconfigured' : !allowed ? 'model-unverified' : undefined;
    if (id === 'cloudflare' && !/^[a-f\d]{32}$/i.test(account)) reason = 'account-unconfigured';
    if (['glm47', 'glm45', 'gemini', 'groq', 'cloudflare', 'llm7'].includes(id) && !(verifiedUntil > Date.now())) reason = 'free-plan-review-required';
    if (id === 'gemini' && (skipGemini || !privacyApproved)) reason = 'privacy';
    if (blocked && !writtenApproval) reason = 'terms-non-production';
    if (unverified && !writtenApproval) reason = 'terms-unverified';
    const paidPrice = PAID_PRICES[id];
    const priceIn = paidPrice ? num(`FREE_CHAIN_${prefix}_PRICE_IN_PER_MTOK`, paidPrice[0], paidPrice[0], 1000, false) : 0;
    const priceOut = paidPrice ? num(`FREE_CHAIN_${prefix}_PRICE_OUT_PER_MTOK`, paidPrice[1], paidPrice[1], 1000, false) : 0;
    // A paid rate card is an owner attestation with an expiry, like the free-plan attestation.
    if (paidPrice && !(Date.parse(env[`FREE_CHAIN_${prefix}_RATE_VERIFIED_UNTIL`] ?? '') > Date.now()) && !reason) reason = 'rate-card-unverified';
    const limits = DEFAULT_LIMITS[id];
    const defaultZone = id === 'gemini' ? 'America/Los_Angeles' : ['glm47', 'glm45', 'groq'].includes(id) ? 'rolling24h' : 'UTC';
    const timeZone = env[`FREE_CHAIN_${prefix}_TIME_ZONE`] ?? defaultZone;
    try { validateTimezone(timeZone); } catch { errors.push(`FREE_CHAIN_${prefix}_TIME_ZONE`); }
    return { id, model: allowed ? model : '', key: validKey ? rawKey : '', keyEnv, baseURL, configured: validKey, reason,
      languages: (langs.length ? langs : ['hi', 'hinglish', 'en', 'other']) as ReplyLanguage[],
      maxInputTokens: num(`FREE_CHAIN_${prefix}_MAX_INPUT_TOKENS`, id === 'groq' ? 6000 : 16000, 256, 100000),
      maxOutputTokens: num(`FREE_CHAIN_${prefix}_MAX_OUTPUT_TOKENS`, 1024, 64, 8192),
      rpm: num(`FREE_CHAIN_${prefix}_RPM`, limits[0], 0, 100000), rpd: num(`FREE_CHAIN_${prefix}_RPD`, limits[1], 0, 10000000),
      tpm: num(`FREE_CHAIN_${prefix}_TPM`, limits[2], 0, 100000000), tpd: num(`FREE_CHAIN_${prefix}_TPD`, limits[3], 0, 1000000000),
      // IANA zone handles Pacific daylight saving; Groq defaults conservatively rolling, not guessed midnight.
      timeZone,
      verifiedUntil: Number.isFinite(verifiedUntil) ? verifiedUntil : 0, streamUsage: id === 'gemini' || isPaidRung(id), priceIn, priceOut };
  });
  const config: FreeChainConfig = { enabled: flag('FREE_CHAIN_ENABLED'), rolloutPercent: num('FREE_CHAIN_ROLLOUT_PERCENT', 0, 0, 100),
    allowUids: list(env.FREE_CHAIN_ALLOW_UIDS), order: order as ProviderId[], skipGemini, privacyApproved,
    ttftMs: num('FREE_CHAIN_TTFT_MS', 6000, 1000, 30000), cacheEnabled: flag('FREE_CHAIN_CACHE_ENABLED'), cacheTtlS: num('FREE_CHAIN_CACHE_TTL_S', 86400, 60, 86400),
    paidCapNanoUsd: money('FREE_CHAIN_PAID_DAILY_CAP_USD', DEFAULT_PAID_CAP_NANO_USD / NANO_USD, 0, OWNER_PAID_DAILY_CEILING_NANO_USD / NANO_USD),
    queue: { maxActive: num('FREE_CHAIN_MAX_ACTIVE', 8, 1, 64), maxQueued: num('FREE_CHAIN_MAX_QUEUED', 64, 0, 1000), maxWaitMs: num('FREE_CHAIN_MAX_WAIT_MS', DEFAULT_ADMISSION_QUEUE_LIMITS.maxWaitMs, 100, 10000), perUserActive: num('FREE_CHAIN_PER_USER_ACTIVE', 1, 1, 8), perUserQueued: num('FREE_CHAIN_PER_USER_QUEUED', 1, 0, 16) },
    paidPerUserDaily: num('FREE_CHAIN_PAID_PER_USER_DAILY', 20, 0, 1000), safetyMargin: num('FREE_CHAIN_QUOTA_MARGIN', .9, .1, .95, false),
    deepseekPrices: { input: num('FREE_CHAIN_DEEPSEEK_PRICE_IN_PER_MTOK', .30, .30, 1000, false), output: num('FREE_CHAIN_DEEPSEEK_PRICE_OUT_PER_MTOK', 1.20, 1.20, 1000, false), cached: num('FREE_CHAIN_DEEPSEEK_PRICE_CACHED_IN_PER_MTOK', .006, .006, 1000, false) },
    openRouterModels: list(env.FREE_CHAIN_OPENROUTER_MODELS), rungs, errors,
    maxAttempts: num('FREE_CHAIN_MAX_ATTEMPTS', 4, 1, 6), stickySpread: flag('FREE_CHAIN_STICKY_SPREAD') };
  if (config.openRouterModels.length > 4 || config.openRouterModels.some(v => !/^[\w./:-]{1,200}$/.test(v))) errors.push('FREE_CHAIN_OPENROUTER_MODELS');
  // Preserve explicit ON even when invalid. Runtime must fail closed, not return to the legacy paid ladder.
  return config;
}
