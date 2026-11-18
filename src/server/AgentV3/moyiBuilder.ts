/**
 * Moyi API — Pro BUILDER rung (owner 2026-11-17: "moyi api ko bhi bluesminds ke baad lagao, its working").
 * Weak order is Surplus → Router One → BluesMinds → Moyi → the tier ladder.
 *
 * Moyi is an OpenAI-compatible reseller gateway. The builder calls it through the SAME rung factory every
 * GLM / Kimi / Router One / BluesMinds rung uses (`openAiCompatRunners` in routes/agentv3.ts →
 * OpenAiToolRunner), so tool calling, streaming, the size gate, the pacer, the bench and the fallthrough
 * are the ordinary ones. A turn it cannot do fails, and the chain moves on.
 *
 *   MOYI_API_KEY              required (the key the admin Test Chat Bot uses). No key ⇒ no rung. With the
 *                             key alone the rung is ON for every Weak user (owner 2026-11-17: "moyi ai ko
 *                             sabhi user ke liye default on kar do").
 *   MOYI_BUILDER_MODEL        optional comma list of model ids. UNSET (the default): the model ids are read
 *                             from Moyi's OWN `GET /models` list for this key (cached, refreshed in the
 *                             background) and the first that matches a priced row in MOYI_PUBLISHED_RATES is
 *                             used, in that table's order. No id is guessed: a model Moyi does not list is
 *                             never called. Until the list has been read once, a build runs without the rung.
 *   MOYI_BUILDER_RATE_IN/_OUT optional USD per 1M tokens. When set, they price every Moyi model (the owner's
 *                             real account rate wins). Unset ⇒ each model is priced from MOYI_PUBLISHED_RATES,
 *                             the prices on Moyi's own model page as the owner supplied it on 2026-11-16. A
 *                             model with neither is dropped: no price is invented.
 *   MOYI_BUILDER_ENABLED      default ON. Only an explicit off value (`off`/`0`/`false`/`no`) removes it.
 *   MOYI_BASE_URL             optional; default `https://api.moyi-api.com/v1`, held to Moyi's own domain
 *                             (resellerGateways.ts). The builder speaks the OpenAI format only, so it always
 *                             uses this endpoint, never Moyi's Anthropic-format one.
 *
 * NO CLAUDE THROUGH A RESELLER, AND NEVER ON WEAK. A model id that names a Claude family is dropped from
 * the list: Weak must never run Sonnet or Opus (CLAUDE.md), and Claude through any reseller has no owner
 * sign-off (ENV_REGISTRY.md, reseller gateways entry). `enforceNoClaude` matches rung NAMES, so it cannot
 * see a Claude model behind a neutral label; this filter is that net for this rung.
 *
 * BRAND: the rung reports as the neutral `ENGINE_MY`, and its error text has the supplier's name and host
 * swapped for that label before anything can show it.
 */
import { chooseModels } from '../lib/modelChoice';
import { parseEnvFlag } from '../lib/envFlag';
import { resellerGatewayState } from '../lib/resellerGateways';
import { fetchProviderModelIds } from '../lib/testChatBotOfficial';
import type { NamedRunner } from './providers/MultiProviderTurnRunner';
import type { TokenRate } from './pricing';
import type { RunTurnParams, TurnRunner } from './ClaudeClient';

export const MOYI_BUILDER_LABEL = 'ENGINE_MY';

/** Claude family names, in any spelling a gateway uses (`claude-…`, `anthropic/…`, bare tier words). */
const CLAUDE_FAMILY = /claude|anthropic|sonnet|opus|haiku|fable/i;

/**
 * Moyi's own published prices (USD per 1M tokens, Moyi's discounted price, base context tier), from the model
 * page the owner supplied on 2026-11-16, in the order the rung prefers them: the owner's 80%+-discount models
 * first, Grok first because it is NavBharatAI's own Engineer AI engine. "Fast" variants are priced higher and
 * are excluded. Long-context requests can cost more on Moyi (its page marks some rows "context-tiered");
 * the owner's MOYI_BUILDER_RATE_IN/_OUT override covers that when set.
 */
export const MOYI_PUBLISHED_RATES: ReadonlyArray<{ match: RegExp; rate: Readonly<TokenRate> }> = Object.freeze([
  { match: /grok-?4[.-]7(?![\d.])/i, rate: { inputPerMTok: 0.3, outputPerMTok: 0.9 } },
  { match: /gpt-?6[.-]1-terra/i, rate: { inputPerMTok: 0.171, outputPerMTok: 0.855 } },
  { match: /grok-?4[.-]6(?![\d.])/i, rate: { inputPerMTok: 0.3, outputPerMTok: 0.9 } },
  { match: /gpt-?5[.-]6-terra/i, rate: { inputPerMTok: 0.342, outputPerMTok: 2.052 } },
  { match: /deepseek-?v4[.-]1-flash/i, rate: { inputPerMTok: 0.1275, outputPerMTok: 0.51 } },
]);
/** How many of Moyi's listed models the rung tries, in order, before the chain moves on. */
export const MOYI_DEFAULT_MODEL_COUNT = 2;

const validId = (s: string) => /^[\w.:/@+-]{1,128}$/.test(s) && !CLAUDE_FAMILY.test(s) && !/fast/i.test(s);

function rate(raw: string | undefined): number | undefined {
  if (raw === undefined || String(raw).trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}
function ownerRate(env: NodeJS.ProcessEnv): TokenRate | null {
  const input = rate(env.MOYI_BUILDER_RATE_IN), output = rate(env.MOYI_BUILDER_RATE_OUT);
  return input !== undefined && output !== undefined && input + output > 0 ? { inputPerMTok: input, outputPerMTok: output } : null;
}
function publishedRate(model: string): TokenRate | null {
  const row = MOYI_PUBLISHED_RATES.find(r => r.match.test(model));
  return row ? { ...row.rate } : null;
}
/** The rate a Moyi turn on `model` is billed at: the owner's configured rate, else Moyi's published price, else null. */
export function moyiBuilderRate(env: NodeJS.ProcessEnv = process.env, model?: string): TokenRate | null {
  return ownerRate(env) ?? (model ? publishedRate(model) : null);
}

// ─── Moyi's own model list (the default when MOYI_BUILDER_MODEL is unset) ───────────────────────────────
const LIST_TTL_MS = 6 * 60 * 60_000;
const RETRY_AFTER_FAILURE_MS = 60_000;
let listed: { ids: string[]; at: number } | null = null;
let lastAttemptAt = 0;
let inFlight: Promise<void> | null = null;

/** Read Moyi's /models for this key into the cache. Never throws; a failure keeps the previous list. */
export function refreshMoyiModelList(env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch, now: () => number = Date.now): Promise<void> {
  if (inFlight) return inFlight;
  const gateway = resellerGatewayState('moyi', env);
  if (!gateway.ready) return Promise.resolve();
  lastAttemptAt = now();
  inFlight = fetchProviderModelIds(gateway.baseUrl, gateway.apiKey, fetchImpl)
    .then(result => { if (result.ok && result.ids.length) listed = { ids: result.ids, at: now() }; })
    .catch(() => undefined)
    .finally(() => { inFlight = null; });
  return inFlight;
}
function listedModelsFor(env: NodeJS.ProcessEnv, now: number): string[] {
  const stale = !listed || now - listed.at > LIST_TTL_MS;
  if (stale && !inFlight && now - lastAttemptAt > RETRY_AFTER_FAILURE_MS) void refreshMoyiModelList(env);
  if (!listed) return [];
  const ids = listed.ids.filter(validId);
  const picked: string[] = [];
  for (const row of MOYI_PUBLISHED_RATES) {
    const id = ids.find(candidate => row.match.test(candidate) && !picked.includes(candidate));
    if (id) picked.push(id);
    if (picked.length >= MOYI_DEFAULT_MODEL_COUNT) break;
  }
  return picked;
}

/** The models the rung runs, each with a known price: the owner's list when set, else Moyi's own listed models. */
export function moyiBuilderModels(env: NodeJS.ProcessEnv = process.env, now: number = Date.now()): string[] {
  const configured = String(env.MOYI_BUILDER_MODEL ?? '').split(',').map(s => s.trim()).filter(s => /^[\w.:/@+-]{1,128}$/.test(s) && !CLAUDE_FAMILY.test(s));
  if (configured.length) return configured.filter(model => moyiBuilderRate(env, model) !== null);
  // THE SHARED RULE (modelChoice.ts, admin 2026-11-18): from Moyi's own list, the strong coding families, cheapest by
  // Moyi's own price; with none strong, its priced models as before.
  const pricedListed = listedModelsFor(env, now).filter(model => moyiBuilderRate(env, model) !== null);
  const choice = chooseModels(pricedListed.map((id) => { const r = moyiBuilderRate(env, id)!; return { id, inputPerMTok: r.inputPerMTok, outputPerMTok: r.outputPerMTok }; }),
    { purpose: 'coding', max: pricedListed.length, noClaude: true, env });
  return choice.basis === 'strong' ? [...choice.models, ...pricedListed.filter((m) => !choice.models.includes(m))] : pricedListed;
}

/** TEST ONLY. */
export function __resetMoyiModelList(): void { listed = null; lastAttemptAt = 0; inFlight = null; }

/** Why the rung is absent, for the admin's eyes (names of env keys only); null when it is present. */
export function moyiBuilderMissing(env: NodeJS.ProcessEnv = process.env): string | null {
  if (parseEnvFlag(env.MOYI_BUILDER_ENABLED) === false) return 'MOYI_BUILDER_ENABLED is off';
  const gateway = resellerGatewayState('moyi', env);
  if (!gateway.ready) return gateway.configured ? 'MOYI_BASE_URL is not a valid Moyi endpoint' : 'MOYI_API_KEY is not set';
  if (!moyiBuilderModels(env).length) {
    return String(env.MOYI_BUILDER_MODEL ?? '').trim()
      ? 'MOYI_BUILDER_MODEL names no usable model (Claude models are not allowed; a model needs a price: set MOYI_BUILDER_RATE_IN/_OUT for one Moyi does not publish)'
      : 'Moyi’s model list has not been read yet, or it lists none of the priced models';
  }
  return null;
}
/** Default ON with the key alone (models and prices resolved as above); the explicit off value is the kill switch. */
export function moyiBuilderEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return moyiBuilderMissing(env) === null;
}

export function isMoyiBuilderLabel(provider: string | null | undefined): boolean {
  return String(provider ?? '').trim().toUpperCase().replace(/#\d+$/, '') === MOYI_BUILDER_LABEL;
}

/** Swap the supplier's own name (and host) for the neutral label in an error, in place. Never throws. */
export function neutraliseMoyiName(err: unknown): void {
  try {
    if (!(err instanceof Error) || typeof err.message !== 'string') return;
    const next = err.message.replace(/\b(?:[\w-]+\.)*moyi(?:-api)?(?:\.com)?\b/gi, MOYI_BUILDER_LABEL);
    if (next !== err.message) err.message = next;
  } catch { /* a frozen error keeps its text */ }
}

export type MoyiRungFactory = (label: string, apiKey: string, baseURL: string, models: string[]) => NamedRunner[];

/** The Moyi rungs (empty when switched off, keyless, or no priced model is known yet), each with brand-neutral errors. */
export function moyiBuilderRungs(factory: MoyiRungFactory, env: NodeJS.ProcessEnv = process.env): NamedRunner[] {
  if (!moyiBuilderEnabled(env)) return [];
  const gateway = resellerGatewayState('moyi', env);
  if (!gateway.ready) return [];
  return factory(MOYI_BUILDER_LABEL, gateway.apiKey, gateway.baseUrl, moyiBuilderModels(env))
    .map(rung => ({ ...rung, runner: withNeutralErrors(rung.runner) }));
}

/** Same runner (every method and field, `this` intact); only runTurn's thrown error is neutralised. */
function withNeutralErrors(runner: TurnRunner): TurnRunner {
  const runTurn = async (params: RunTurnParams) => {
    try { return await runner.runTurn(params); }
    catch (err) { neutraliseMoyiName(err); throw err; }
  };
  return new Proxy(runner, {
    get(target, prop) {
      if (prop === 'runTurn') return runTurn;
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
