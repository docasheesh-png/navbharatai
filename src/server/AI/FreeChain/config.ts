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
export const PROVIDER_IDS = ['glm47', 'glm45', 'groq', 'openrouter', 'cloudflare', 'gemini', 'deepseek'] as const;
export type ProviderId = typeof PROVIDER_IDS[number];
export type ReplyLanguage = 'hi' | 'hinglish' | 'en' | 'other';
export interface RungConfig {
  id: ProviderId; model: string; key: string; keyEnv: string; baseURL: string;
  configured: boolean; reason?: string; languages: ReplyLanguage[];
  maxInputTokens: number; maxOutputTokens: number;
  rpm: number; rpd: number; tpm: number; tpd: number; timeZone: string;
  verifiedUntil: number; streamUsage: boolean;
}
export interface FreeChainConfig {
  enabled: boolean; rolloutPercent: number; allowUids: string[]; order: ProviderId[];
  skipGemini: boolean; privacyApproved: boolean; ttftMs: number; cacheEnabled: boolean; cacheTtlS: number;
  paidCapNanoUsd: number; paidPerUserDaily: number; safetyMargin: number;
  queue: { maxActive: number; maxQueued: number; maxWaitMs: number; perUserActive: number; perUserQueued: number };
  deepseekPrices: { input: number; output: number; cached: number };
  openRouterModels: string[]; rungs: RungConfig[]; errors: string[];
}
const MODELS: Record<ProviderId, string> = {
  glm47: 'glm-4.7-flash', glm45: 'glm-4.5-flash',
  // Existing Google projects may retain 2.5; availability must be verified before activation.
  gemini: 'gemini-2.5-flash', groq: 'openai/gpt-oss-120b',
  cloudflare: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', openrouter: '', deepseek: 'deepseek-flash',
};
const PREFIX: Record<ProviderId, string> = { glm47: 'GLM', glm45: 'GLM', gemini: 'GEMINI', groq: 'GROQ', cloudflare: 'CF', openrouter: 'OPENROUTER', deepseek: 'DEEPSEEK' };
const DEFAULT_LIMITS: Record<ProviderId, [number, number, number, number]> = {
  // No guessed GLM/Gemini account quotas. Zero skips until configured from their account consoles.
  glm47: [0, 0, 0, 0], glm45: [0, 0, 0, 0],
  gemini: [0, 0, 0, 0], groq: [30, 1000, 8000, 200000], cloudflare: [60, 10000, 24000, 1000000],
  openrouter: [20, 50, 100000, 1000000], deepseek: [30, 1000, 2000000, 10000000],
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
  const rawOrder = list(env.FREE_CHAIN_ORDER); const order = rawOrder.length ? rawOrder : [...PROVIDER_IDS];
  if (order.some(p => !PROVIDER_IDS.includes(p as ProviderId)) || new Set(order).size !== order.length) errors.push('FREE_CHAIN_ORDER');
  // The paid rung can be disabled, never promoted above a free rung by configuration.
  if (order.includes('deepseek') && order.at(-1) !== 'deepseek') errors.push('FREE_CHAIN_ORDER');
  const skipGemini = flag('FREE_CHAIN_SKIP_GEMINI', true);
  const privacyApproved = flag('FREE_CHAIN_GEMINI_PRIVACY_APPROVED');
  const rungs = PROVIDER_IDS.map((id): RungConfig => {
    const prefix = PREFIX[id]; const keyEnv = id === 'openrouter' ? 'OPENROUTER_API_KEY' : `FREE_CHAIN_${prefix}_${id === 'cloudflare' ? 'API_TOKEN' : 'API_KEY'}`;
    const rawKey = (env[keyEnv] ?? '').trim(); const validKey = !!rawKey && !/[\s,]/.test(rawKey);
    const modelEnv = `FREE_CHAIN_${id === 'glm47' ? 'GLM47' : id === 'glm45' ? 'GLM45' : prefix}_MODEL`;
    const model = (env[modelEnv] ?? MODELS[id]).trim();
    const allowed = id === 'gemini' ? ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.8-flash'].includes(model) : model === MODELS[id];
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
      : id === 'deepseek' ? 'https://api.deepseek.com/v1' : 'https://openrouter.ai/api/v1';
    let reason = !validKey ? 'unconfigured' : !allowed ? 'model-unverified' : undefined;
    if (id === 'cloudflare' && !/^[a-f\d]{32}$/i.test(account)) reason = 'account-unconfigured';
    if (['glm47', 'glm45', 'gemini', 'groq', 'cloudflare'].includes(id) && !(verifiedUntil > Date.now())) reason = 'free-plan-review-required';
    if (id === 'gemini' && (skipGemini || !privacyApproved)) reason = 'privacy';
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
      verifiedUntil: Number.isFinite(verifiedUntil) ? verifiedUntil : 0, streamUsage: id === 'gemini' || id === 'deepseek' };
  });
  const config: FreeChainConfig = { enabled: flag('FREE_CHAIN_ENABLED'), rolloutPercent: num('FREE_CHAIN_ROLLOUT_PERCENT', 0, 0, 100),
    allowUids: list(env.FREE_CHAIN_ALLOW_UIDS), order: order as ProviderId[], skipGemini, privacyApproved,
    ttftMs: num('FREE_CHAIN_TTFT_MS', 6000, 1000, 30000), cacheEnabled: flag('FREE_CHAIN_CACHE_ENABLED'), cacheTtlS: num('FREE_CHAIN_CACHE_TTL_S', 86400, 60, 86400),
    paidCapNanoUsd: money('FREE_CHAIN_PAID_DAILY_CAP_USD', DEFAULT_PAID_CAP_NANO_USD / NANO_USD, 0, OWNER_PAID_DAILY_CEILING_NANO_USD / NANO_USD),
    queue: { maxActive: num('FREE_CHAIN_MAX_ACTIVE', 8, 1, 64), maxQueued: num('FREE_CHAIN_MAX_QUEUED', 64, 0, 1000), maxWaitMs: num('FREE_CHAIN_MAX_WAIT_MS', DEFAULT_ADMISSION_QUEUE_LIMITS.maxWaitMs, 100, 10000), perUserActive: num('FREE_CHAIN_PER_USER_ACTIVE', 1, 1, 8), perUserQueued: num('FREE_CHAIN_PER_USER_QUEUED', 1, 0, 16) },
    paidPerUserDaily: num('FREE_CHAIN_PAID_PER_USER_DAILY', 20, 0, 1000), safetyMargin: num('FREE_CHAIN_QUOTA_MARGIN', .9, .1, .95, false),
    deepseekPrices: { input: num('FREE_CHAIN_DEEPSEEK_PRICE_IN_PER_MTOK', .30, .30, 1000, false), output: num('FREE_CHAIN_DEEPSEEK_PRICE_OUT_PER_MTOK', 1.20, 1.20, 1000, false), cached: num('FREE_CHAIN_DEEPSEEK_PRICE_CACHED_IN_PER_MTOK', .006, .006, 1000, false) },
    openRouterModels: list(env.FREE_CHAIN_OPENROUTER_MODELS), rungs, errors };
  if (config.openRouterModels.length > 4 || config.openRouterModels.some(v => !/^[\w./:-]{1,200}$/.test(v))) errors.push('FREE_CHAIN_OPENROUTER_MODELS');
  // Preserve explicit ON even when invalid. Runtime must fail closed, not return to the legacy paid ladder.
  return config;
}
