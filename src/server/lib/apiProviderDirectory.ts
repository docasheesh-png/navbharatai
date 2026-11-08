/**
 * THE API PROVIDER DIRECTORY — every outside API NavBharatAI pays for or depends on, where its balance is, and
 * (where the provider offers it) the live balance itself (admin 2026-11-03: "ek audit scan chalao. dekho ham kon
 * kon se api call kar rahe hai … admin panel me api provider ka option banao, waha sabhi api aur balance check ka
 * link button banao. aim: one click par, dekh len kon se api provider ka balance low/khatam hai").
 *
 * 🔒 THREE STATES, NEVER A FOURTH (the second absolute rule):
 *   · a REAL balance, read now from the provider's own documented balance API with our own key;
 *   · an honest "the provider has no balance API — open its billing page", with the link;
 *   · an honest failure ("the balance API refused this key: HTTP 401"), never a number we made up.
 * A provider with no live check is never shown as "OK". It is shown as "check manually".
 *
 * 🔒 NO SECRET EVER LEAVES THIS MODULE. `configured` is presence only; key values are never returned, logged or
 * put in an error. Error text is our own sentence plus an HTTP status — never the provider's body.
 *
 * 🔒 THE LIST IS LOCKED TO THE CODE: `tests/everyApiProviderHasABalanceLink.test.ts` scans the AI routing code for
 * every `*_API_KEY` it reads and fails when one is in neither this directory nor that test's reasoned exemptions.
 * A new paid provider cannot be wired in without its billing link appearing here.
 */

import { parseEnvNumber } from './envNumber';

export type ApiProviderGroup = 'ai' | 'service' | 'registered';

/** How the live balance is read. Only providers with a documented, key-authenticated balance endpoint. */
export type BalanceProbe = 'openrouter' | 'deepseek' | 'moonshot';

export interface ApiProviderEntry {
  id: string;
  name: string;
  group: ApiProviderGroup;
  /** Any one of these set ⇒ configured. Names only. */
  envKeys: readonly string[];
  /**
   * Where NavBharatAI uses this account — the features that stop or degrade when its balance runs out. Taken from
   * the code that reads the key (admin 2026-11-03: "yeh api keys kaha use hoti hai, woh bhi likho"). Plain words.
   */
  usedFor: readonly string[];
  /** Where the admin checks balance / billing. null = not known (said so on screen). */
  billingUrl: string | null;
  /** What to look at on that page, in one line. */
  billingHint: string;
  balance?: BalanceProbe;
  /** True when the account runs on the server's own Google identity rather than a key. */
  serverIdentity?: boolean;
}

export const API_PROVIDERS: readonly ApiProviderEntry[] = [
  // ── AI providers ──
  { id: 'router-one', name: 'Router One', group: 'ai', envKeys: ['ROUTER_ONE_API_KEY'], usedFor: ['Pro builds on Weak power (the builder after Surplus)'], billingUrl: 'https://router.one/dashboard', billingHint: 'Dashboard → balance' },
  { id: 'surplus', name: 'Surplus', group: 'ai', envKeys: ['SURPLUS_API_KEY'], usedFor: ['Pro builds on Weak power (first choice)'], billingUrl: 'https://www.surplusintelligence.ai/app/buy/funding', billingHint: 'Funding → credits' },
  { id: 'cheaperinference', name: 'CheaperInference', group: 'ai', envKeys: ['CHEAPERINFERENCE_API_KEY'], usedFor: ['Free Chat (free-chat chain)'], billingUrl: 'https://www.cheaperinference.com/dashboard/billing', billingHint: 'Billing' },
  { id: 'mitrify', name: 'Mitrify gateway', group: 'ai', envKeys: ['MITRIFY_API_KEY'], usedFor: ['Reviewed text chat fallback (when enabled)'], billingUrl: null, billingHint: 'Check the gateway account manually; no verified billing URL or balance API is configured' },
  { id: 'glm', name: 'Z.ai / GLM', group: 'ai', envKeys: ['GLM_API_KEY', 'FREE_CHAIN_GLM_API_KEY', 'FREE_CHAIN_GLMX_API_KEY'], usedFor: ['Pro builds on every power level (main engine)', 'Chat replies (AI router)', 'Free Chat (free-chat chain)', 'Reading photos and PDFs in chat', 'Phone app (APK) build auto-repair', 'Build checks before a build starts (is the request clear, is it a build)'], billingUrl: 'https://z.ai/manage-apikey/billing', billingHint: 'Billing → balance and resource packs' },
  { id: 'kimi', name: 'Kimi / Moonshot', group: 'ai', envKeys: ['KIMI_API_KEY'], usedFor: ['Pro builds on every power level', 'Phone app (APK) build auto-repair'], billingUrl: 'https://platform.kimi.ai', billingHint: 'Platform → balance', balance: 'moonshot' },
  { id: 'openrouter', name: 'OpenRouter (Nemotron default)', group: 'ai', envKeys: ['OPENROUTER_API_KEY', 'NEMOTRON_API_KEY'], usedFor: ['Pro builds: Nemotron for planning on higher power levels', 'Free Chat (free-chat chain)', 'Admin \u2192 Live Model Registry'], billingUrl: 'https://openrouter.ai/settings/credits', billingHint: 'Settings → credits', balance: 'openrouter' },
  { id: 'deepinfra', name: 'DeepInfra', group: 'ai', envKeys: ['DEEPINFRA_API_KEY', 'DEEPINFRA_TOKEN', 'FREE_CHAIN_DEEPINFRA_API_KEY'], usedFor: ['Free Chat (free-chat chain)', 'Admin \u2192 DeepInfra comparison'], billingUrl: 'https://deepinfra.com/dash/account', billingHint: 'Account → billing' },
  { id: 'openai', name: 'OpenAI', group: 'ai', envKeys: ['OPENAI_API_KEY', 'FREE_CHAIN_OPENAI_API_KEY'], usedFor: ['Chat replies (AI router)', 'Free Chat (free-chat chain)', 'Searching a project’s code by meaning (only when this key is set)'], billingUrl: 'https://platform.openai.com/account/billing', billingHint: 'API billing (separate from a ChatGPT subscription)' },
  { id: 'anthropic', name: 'Anthropic / Claude', group: 'ai', envKeys: ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'], usedFor: ['Pro builds on Normal and Strong power (Claude)', 'Chat replies (AI router)', 'Doctor AI (Senior Doctor Assistant)', 'Reading photos and PDFs in chat', 'Phone app (APK) build auto-repair'], billingUrl: 'https://platform.claude.com/settings/billing', billingHint: 'API billing (separate from a Claude subscription)' },
  { id: 'gemini', name: 'Google Gemini API', group: 'ai', envKeys: ['GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'FREE_CHAIN_GEMINIPAID_API_KEY'], usedFor: ['Chat replies (AI router)', 'Image generation and photo editing', 'Reading photos and PDFs in chat', 'Doctor AI (Senior Doctor Assistant)', 'Free Chat (free-chat chain)', 'Memory search (fallback when Vertex is not used)'], billingUrl: 'https://aistudio.google.com/billing', billingHint: 'AI Studio → billing' },
  { id: 'vertex', name: 'Google Vertex AI', group: 'ai', envKeys: ['GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT'], usedFor: ['Memory search (embeddings), paid from Google Cloud credit', 'Gemini calls through Google Cloud'], billingUrl: 'https://console.cloud.google.com/billing', billingHint: 'Cloud Billing → the project’s billing account', serverIdentity: true },
  { id: 'groq', name: 'Groq', group: 'ai', envKeys: ['GROQ_API_KEY', 'FREE_CHAIN_GROQ_API_KEY'], usedFor: ['Free Chat (free-chat chain)'], billingUrl: 'https://console.groq.com', billingHint: 'Console → Settings → Billing' },
  { id: 'xai', name: 'xAI / Grok', group: 'ai', envKeys: ['XAI_API_KEY', 'GROK_API_KEY'], usedFor: ['Chat replies (AI router)', 'Image generation', 'Reading photos in chat'], billingUrl: 'https://console.x.ai/team/default/billing', billingHint: 'Billing → credits' },
  { id: 'cloudflare', name: 'Cloudflare Workers AI', group: 'ai', envKeys: ['CLOUDFLARE_AI_TOKEN', 'CLOUDFLARE_API_TOKEN'], usedFor: ['Free Chat (free-chat chain, Workers AI)', 'Image generation', 'Custom domains for published apps (DNS)'], billingUrl: 'https://dash.cloudflare.com/?to=/:account/ai/workers-ai', billingHint: 'Workers AI → usage' },
  { id: 'pollinations', name: 'Pollinations', group: 'ai', envKeys: ['POLLINATIONS_API_KEY'], usedFor: ['Image generation'], billingUrl: 'https://enter.pollinations.ai', billingHint: 'Dashboard → pollen' },
  { id: 'bedrock', name: 'AWS Bedrock / Nova Sonic', group: 'ai', envKeys: ['BEDROCK_API_KEY', 'AWS_ACCESS_KEY_ID'], usedFor: ['Voice chat (Nova Sonic, src/server/sonic) — including Doctor AI voice', 'Pro builds: a GLM model through AWS Bedrock (only when BEDROCK_API_KEY is set)'], billingUrl: 'https://console.aws.amazon.com/billing/home', billingHint: 'AWS Billing → bills and credits' },
  { id: 'deepseek', name: 'DeepSeek Direct', group: 'ai', envKeys: ['DEEPSEEK_API_KEY', 'FREE_CHAIN_DEEPSEEK_API_KEY'], usedFor: ['Free Chat (free-chat chain)'], billingUrl: 'https://platform.deepseek.com', billingHint: 'Platform → balance', balance: 'deepseek' },
  { id: 'custom-image', name: 'Custom image provider', group: 'ai', envKeys: ['IMAGE_API_KEY'], usedFor: ['Image generation through the provider named by IMAGE_PROVIDER'], billingUrl: null, billingHint: 'The provider is named by IMAGE_PROVIDER; its billing page depends on which one it is' },
  // ── Other API services ──
  { id: 'e2b', name: 'E2B (build sandboxes)', group: 'service', envKeys: ['E2B_API_KEY'], usedFor: ['Every Pro build: the cloud machine where the app is built, run and previewed'], billingUrl: 'https://console.e2b.dev/?tab=billing', billingHint: 'Billing → credits and usage' },
  { id: 'gcp', name: 'Google Cloud / Firebase', group: 'service', envKeys: ['GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT'], usedFor: ['The NavBharatAI servers (Cloud Run)', 'The database (Firestore) and file storage', 'Hosting for published apps (Firebase Hosting)'], billingUrl: 'https://console.cloud.google.com/billing', billingHint: 'Cloud Billing → Cloud Run, Firestore, Storage', serverIdentity: true },
  { id: 'brave', name: 'Brave Search', group: 'service', envKeys: ['BRAVE_API_KEY'], usedFor: ['Web search in chat and builds', 'Live facts in chat (news, air quality, transit)'], billingUrl: 'https://api-dashboard.search.brave.com', billingHint: 'API dashboard → usage and plan' },
  { id: 'render', name: 'Render', group: 'service', envKeys: ['RENDER_API_KEY'], usedFor: ['Deploying the backend of a user’s app'], billingUrl: 'https://dashboard.render.com', billingHint: 'Dashboard → billing' },
  { id: 'resend', name: 'Resend (email)', group: 'service', envKeys: ['RESEND_API_KEY'], usedFor: ['Alert emails to the admin'], billingUrl: 'https://resend.com/login', billingHint: 'Log in → billing / usage' },
  { id: 'rapidapi', name: 'RapidAPI', group: 'service', envKeys: ['RAPIDAPI_KEY'], usedFor: ['Live train status in chat', 'Government data sources'], billingUrl: 'https://rapidapi.com/developer/dashboard', billingHint: 'Dashboard → subscriptions / usage' },
  { id: 'cashfree', name: 'Cashfree (payments)', group: 'service', envKeys: ['CASHFREE_APP_ID', 'CASHFREE_SECRET_KEY', 'CASHFREE_CLIENT_SECRET'], usedFor: ['Users adding money to their wallet (payments)'], billingUrl: 'https://merchant.cashfree.com/auth/', billingHint: 'Merchant dashboard → settlements and account status' },
  // ── Registered only; not confirmed active ──
  { id: 'nvidia', name: 'NVIDIA Direct', group: 'registered', envKeys: ['FREE_CHAIN_NVIDIA_API_KEY'], usedFor: ['Free Chat (free-chat chain), when enabled'], billingUrl: 'https://build.nvidia.com/', billingHint: 'Developer platform → credits' },
  { id: 'modelscope', name: 'ModelScope', group: 'registered', envKeys: ['FREE_CHAIN_MODELSCOPE_API_KEY'], usedFor: ['Free Chat (free-chat chain), when enabled'], billingUrl: 'https://modelscope.cn/', billingHint: 'Platform → account' },
  { id: 'llm7', name: 'LLM7', group: 'registered', envKeys: ['FREE_CHAIN_LLM7_API_KEY'], usedFor: ['Free Chat (free-chat chain), when enabled'], billingUrl: 'https://llm7.io/', billingHint: 'Official website' },
  { id: 'bluesminds', name: 'BluesMinds', group: 'registered', envKeys: ['FREE_CHAIN_BLUESMINDS_API_KEY'], usedFor: ['Free Chat (free-chat chain), when enabled'], billingUrl: 'https://api.bluesminds.com/', billingHint: 'API platform' },
  { id: 'requesty', name: 'Requesty', group: 'registered', envKeys: ['FREE_CHAIN_REQUESTY_API_KEY'], usedFor: ['Free Chat (free-chat chain), when enabled'], billingUrl: 'https://app.requesty.ai/', billingHint: 'Dashboard → credits' },
];

/** Billing pages for the image providers IMAGE_PROVIDER can name (its value is a provider name, not a secret). */
const IMAGE_PROVIDER_BILLING: Readonly<Record<string, string>> = {
  // The names ImageAiGenerator accepts (navbharatai | openai | gemini | xai | pollinations | stability) and its aliases.
  openai: 'https://platform.openai.com/account/billing',
  chatgpt: 'https://platform.openai.com/account/billing',
  gemini: 'https://aistudio.google.com/billing',
  xai: 'https://console.x.ai/team/default/billing',
  grok: 'https://console.x.ai/team/default/billing',
  pollinations: 'https://enter.pollinations.ai',
  stability: 'https://platform.stability.ai/account/credits',
}

/** A balance below this (USD-equivalent) is shown as LOW. Env-overridable; a bad value falls back. */
export const DEFAULT_LOW_BALANCE_USD = 5;
export function lowBalanceThresholdUsd(env: NodeJS.ProcessEnv = process.env): number {
  // A cleared field is "not set", never a zero threshold (parseEnvNumber: blank ⇒ null).
  const n = parseEnvNumber(env.ADMIN_PROVIDER_LOW_BALANCE_USD);
  return n !== null && n >= 0 ? n : DEFAULT_LOW_BALANCE_USD;
}

export type BalanceState =
  | { kind: 'live'; amount: number; currency: string; level: 'ok' | 'low' | 'empty'; checkedAt: number }
  | { kind: 'failed'; reason: string; checkedAt: number }
  | { kind: 'manual'; reason: string }
  | { kind: 'not_configured' };

export interface ApiProviderRow {
  id: string;
  name: string;
  group: ApiProviderGroup;
  configured: boolean;
  /** Names of the keys that are set (never values). */
  configuredKeys: string[];
  usedFor: string[];
  billingUrl: string | null;
  billingHint: string;
  balance: BalanceState;
}

export interface ApiProviderDirectory {
  rows: ApiProviderRow[];
  lowBalanceUsd: number;
  checkedAt: number;
  counts: { total: number; configured: number; live: number; low: number; empty: number; failed: number; manual: number };
}

const present = (env: NodeJS.ProcessEnv, k: string): boolean => typeof env[k] === 'string' && (env[k] as string).trim().length > 0;

export function levelOf(amountUsd: number, lowUsd: number): 'ok' | 'low' | 'empty' {
  if (!(amountUsd > 0)) return 'empty';
  return amountUsd < lowUsd ? 'low' : 'ok';
}

type Fetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
const TIMEOUT_MS = 8_000;
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/** The probe's own request, and a strict shape check of the answer. Returns amount + currency, or a reason. */
async function probe(kind: BalanceProbe, env: NodeJS.ProcessEnv, fetchImpl: Fetch): Promise<{ amount: number; currency: string } | { reason: string }> {
  let url: string; let key: string | undefined;
  if (kind === 'openrouter') { url = 'https://openrouter.ai/api/v1/credits'; key = env.OPENROUTER_API_KEY; }
  else if (kind === 'deepseek') { url = 'https://api.deepseek.com/user/balance'; key = env.DEEPSEEK_API_KEY || env.FREE_CHAIN_DEEPSEEK_API_KEY; }
  else {
    // The balance endpoint exists only on the Moonshot platform. A KIMI_BASE_URL pointing elsewhere (a coding
    // plan endpoint, a proxy) has no such endpoint, and asking it would report a false failure.
    const base = (env.KIMI_BASE_URL || 'https://api.moonshot.ai/v1').replace(/\/+$/, '');
    let host = '';
    try { host = new URL(base).host; } catch { /* handled below */ }
    if (host !== 'api.moonshot.ai' && host !== 'api.moonshot.cn') return { reason: 'KIMI_BASE_URL does not point at the Moonshot platform, which is the only endpoint with a balance API.' };
    url = `${base}/users/me/balance`; key = env.KIMI_API_KEY;
  }
  if (!key || !key.trim()) {
    return { reason: kind === 'openrouter' ? 'Only OPENROUTER_API_KEY can read the OpenRouter balance; it is not set.' : 'The key this check needs is not set.' };
  }
  let res: Awaited<ReturnType<Fetch>>;
  try {
    res = await fetchImpl(url, { headers: { Authorization: `Bearer ${key.trim()}`, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    return { reason: 'The balance API did not answer in time.' };
  }
  if (!res.ok) return { reason: `The balance API refused the request (HTTP ${res.status}).` };
  let body: unknown;
  try { body = await res.json(); } catch { return { reason: 'The balance API answered with something that is not JSON.' }; }
  const b = body as Record<string, any>;
  if (kind === 'openrouter') {
    const total = num(b?.data?.total_credits); const used = num(b?.data?.total_usage);
    if (total === null || used === null) return { reason: 'The balance API answered in a shape this check does not know.' };
    return { amount: Math.round((total - used) * 100) / 100, currency: 'USD' };
  }
  if (kind === 'deepseek') {
    const infos = Array.isArray(b?.balance_infos) ? b.balance_infos : null;
    const first = infos?.find((i: any) => i?.currency === 'USD') ?? infos?.[0];
    const amount = num(first?.total_balance);
    if (amount === null || typeof first?.currency !== 'string') return { reason: 'The balance API answered in a shape this check does not know.' };
    return { amount, currency: first.currency };
  }
  const amount = num(b?.data?.available_balance);
  if (amount === null) return { reason: 'The balance API answered in a shape this check does not know.' };
  return { amount, currency: new URL(url).host === 'api.moonshot.cn' ? 'CNY' : 'USD' };
}

/** CNY is compared against the USD threshold at a fixed, conservative rate — a level hint, never a billed figure. */
const CNY_PER_USD = 7.3;

/**
 * Read the directory now. Presence from env, balances from the providers that have a balance API, all in parallel,
 * each bounded by its own timeout. Never throws for one provider's failure.
 */
export async function readApiProviderDirectory(opts: { env?: NodeJS.ProcessEnv; fetchImpl?: Fetch; now?: () => number } = {}): Promise<ApiProviderDirectory> {
  const env = opts.env ?? process.env;
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as Fetch);
  const now = opts.now ?? Date.now;
  const lowUsd = lowBalanceThresholdUsd(env);
  const rows = await Promise.all(API_PROVIDERS.map(async (p): Promise<ApiProviderRow> => {
    const configuredKeys = p.envKeys.filter((k) => present(env, k));
    const configured = configuredKeys.length > 0;
    let billingUrl = p.billingUrl;
    let billingHint = p.billingHint;
    if (p.id === 'custom-image') {
      const name = (env.IMAGE_PROVIDER || '').trim().toLowerCase();
      if (name) {
        billingUrl = IMAGE_PROVIDER_BILLING[name] ?? null;
        billingHint = billingUrl ? `IMAGE_PROVIDER is "${name}"` : `IMAGE_PROVIDER is "${name}" — no billing link is known for it yet`;
      } else billingHint = 'IMAGE_PROVIDER is not set, so the provider (and its billing page) is unknown';
    }
    let balance: BalanceState;
    if (!configured) balance = { kind: 'not_configured' };
    else if (!p.balance) balance = { kind: 'manual', reason: p.serverIdentity ? 'Billed to the Google Cloud billing account — open Cloud Billing.' : 'This provider has no balance API — open its billing page.' };
    else {
      const r = await probe(p.balance, env, fetchImpl).catch(() => ({ reason: 'The balance check failed unexpectedly.' }));
      const checkedAt = now();
      if ('reason' in r) balance = { kind: 'failed', reason: r.reason, checkedAt };
      else {
        const usd = r.currency === 'CNY' ? r.amount / CNY_PER_USD : r.amount;
        balance = { kind: 'live', amount: r.amount, currency: r.currency, level: levelOf(usd, lowUsd), checkedAt };
      }
    }
    return { id: p.id, name: p.name, group: p.group, configured, configuredKeys, usedFor: [...p.usedFor], billingUrl, billingHint, balance };
  }));
  const live = rows.filter((r) => r.balance.kind === 'live');
  return {
    rows,
    lowBalanceUsd: lowUsd,
    checkedAt: now(),
    counts: {
      total: rows.length,
      configured: rows.filter((r) => r.configured).length,
      live: live.length,
      low: live.filter((r) => r.balance.kind === 'live' && r.balance.level === 'low').length,
      empty: live.filter((r) => r.balance.kind === 'live' && r.balance.level === 'empty').length,
      failed: rows.filter((r) => r.balance.kind === 'failed').length,
      manual: rows.filter((r) => r.balance.kind === 'manual').length,
    },
  };
}
