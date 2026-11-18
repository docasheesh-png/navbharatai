/**
 * DiscountedTokens — Pro BUILDER rung for NORMAL and STRONG, right before the first Sonnet/Opus rung (owner 2026-11-17:
 * "apke sabhi suggestion approved" — the recommendation was Normal and Strong, before Sonnet, never Weak).
 *
 * WHY THERE. DiscountedTokens sells OpenAI's own models (gpt-6-sol …) under list price. On Normal and Strong the next
 * rung is Sonnet/Opus, the dearest in the chain, so a cheaper strong model before it saves the most where it matters,
 * and Claude stays behind it as the trusted last word — DiscountedTokens states that "availability and model identity
 * are not independently guaranteed", so it is placed BEFORE Claude, never instead of it. Not Weak: Weak already has
 * five engines ahead of its ladder and a free build should not pay a premium model's price.
 *
 * ITS OWN FALLBACK (owner 2026-11-17: "sabse pahle sasta aur accha, response na aaye to 2nd, fail to 3rd, phir aage
 * badho"). The rung factory makes one runner per model, so the models here ARE that order: up to three — the owner's
 * comma list in DISCOUNTEDTOKENS_MODEL, else the shared model rule over its published prices (strong coding family,
 * cheapest first) — after which the chain moves on to Sonnet. Never a model without a known price.
 *
 * PRICE (honest billing, "a cost is never invented"). Each model is billed at DiscountedTokens' own published price
 * (DISCOUNTEDTOKENS_PUBLISHED_RATES, copied from its rates page by the owner on 2026-11-18), or at the owner's account
 * rate when DISCOUNTEDTOKENS_BUILDER_RATE_IN/_OUT are set. A model with neither is never run. The markup applies on top
 * of that real cost, as for every engine.
 *
 *   DISCOUNTEDTOKENS_API_KEY            required (the key the Test Chat Bot uses)
 *   DISCOUNTEDTOKENS_BUILDER_RATE_IN/_OUT  optional: the owner's account rate, overriding the published prices
 *   DISCOUNTEDTOKENS_BUILDER_ENABLED    default ON; only an explicit off removes it
 *   DISCOUNTEDTOKENS_MODEL              optional comma list, the owner's order
 *
 * BRAND: reports as the neutral `ENGINE_DT`; its error text has the supplier's name and host swapped for that label.
 */
import { parseEnvFlag } from '../lib/envFlag';
import { resellerGatewayState, RESELLER_MODEL_LADDER_MAX } from '../lib/resellerGateways';
import { chooseModels } from '../lib/modelChoice';
import type { NamedRunner } from './providers/MultiProviderTurnRunner';
import type { TokenRate } from './pricing';
import type { RunTurnParams, TurnRunner } from './ClaudeClient';
import type { LadderRung } from './tierLadder';

export const DISCOUNTEDTOKENS_BUILDER_LABEL = 'ENGINE_DT';

function rateOf(raw: string | undefined): number | undefined {
  if (raw === undefined || String(raw).trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * DiscountedTokens' own per-model prices, USD per 1M tokens, CALLABLE models only — copied from its "Compare model rates"
 * page as the owner supplied it on 2026-11-18 (the page this platform cannot read itself). Base token rates; the page
 * states they exclude cache, batch and long-context fees. Re-copy when the page changes; a model not here is never run
 * by the builder unless the owner prices it with DISCOUNTEDTOKENS_BUILDER_RATE_IN/_OUT.
 */
export const DISCOUNTEDTOKENS_PUBLISHED_RATES: Readonly<Record<string, Readonly<TokenRate>>> = Object.freeze({
  'gpt-6-sol': { inputPerMTok: 0.1, outputPerMTok: 0.5 },
  'gpt-6.1-sol': { inputPerMTok: 0.1, outputPerMTok: 0.5 },
  'gpt-5.6-terra': { inputPerMTok: 0.1, outputPerMTok: 0.6 },
  'gpt-5.6': { inputPerMTok: 0.2, outputPerMTok: 1.0 },
  'gpt-5.5': { inputPerMTok: 0.25, outputPerMTok: 1.5 },
  'gpt-5.6-sol': { inputPerMTok: 0.25, outputPerMTok: 1.5 },
  'codex-auto-review': { inputPerMTok: 0.25, outputPerMTok: 1.5 },
  'gpt-6-astra': { inputPerMTok: 0.5, outputPerMTok: 2.5 },
});

/** The rate a DiscountedTokens model is billed at: the owner's configured rate when set, else its published price; else none. */
export function discountedTokensBuilderRate(env: NodeJS.ProcessEnv = process.env, model?: string): TokenRate | undefined {
  const input = rateOf(env.DISCOUNTEDTOKENS_BUILDER_RATE_IN), output = rateOf(env.DISCOUNTEDTOKENS_BUILDER_RATE_OUT);
  if (input !== undefined && output !== undefined && (input > 0 || output > 0)) return { inputPerMTok: input, outputPerMTok: output };
  const id = String(model ?? '').trim().replace(/^openai\//i, '');
  const published = DISCOUNTEDTOKENS_PUBLISHED_RATES[id];
  return published ? { ...published } : undefined;
}

/** What is still missing before the rung can exist ([] = ready). For the admin, never the user. */
export function discountedTokensBuilderMissing(env: NodeJS.ProcessEnv = process.env): string[] {
  const missing: string[] = [];
  const state = resellerGatewayState('discountedtokens', env);
  if (!state.ready) missing.push('DISCOUNTEDTOKENS_API_KEY');
  else if (discountedTokensBuilderModels(env).length === 0) missing.push('a priced model (DISCOUNTEDTOKENS_MODEL names none with a published price; set DISCOUNTEDTOKENS_BUILDER_RATE_IN/_OUT)');
  return missing;
}

export function discountedTokensBuilderEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseEnvFlag(env.DISCOUNTEDTOKENS_BUILDER_ENABLED) !== false && discountedTokensBuilderMissing(env).length === 0;
}

/**
 * Up to three models, every one with a known price (published, or the owner's rate):
 *   - the owner's DISCOUNTEDTOKENS_MODEL list, in that order, when set;
 *   - otherwise THE SHARED RULE (modelChoice.ts) over every published model: strong coding family, cheapest first.
 * Never a model without a price — it could be billed below its real cost.
 */
export function discountedTokensBuilderModels(env: NodeJS.ProcessEnv = process.env): string[] {
  const state = resellerGatewayState('discountedtokens', env);
  if (!state.ready) return [];
  const priced = (id: string) => discountedTokensBuilderRate(env, id) !== undefined;
  if (state.models.length) return state.models.filter(priced).slice(0, RESELLER_MODEL_LADDER_MAX);
  const pool = Object.keys(DISCOUNTEDTOKENS_PUBLISHED_RATES).map((id) => { const r = discountedTokensBuilderRate(env, id)!; return { id, inputPerMTok: r.inputPerMTok, outputPerMTok: r.outputPerMTok }; });
  return chooseModels(pool, { purpose: 'coding', max: RESELLER_MODEL_LADDER_MAX, env }).models;
}

export function isDiscountedTokensBuilderLabel(provider: string | null | undefined): boolean {
  return String(provider ?? '').trim().toUpperCase().replace(/#\d+$/, '') === DISCOUNTEDTOKENS_BUILDER_LABEL;
}

/** Where the rung goes in a Normal/Strong ladder: before the first Sonnet/Opus rung, else at the end. PURE. */
export function beforeFirstClaudeRung(rungs: readonly LadderRung[]): number {
  const at = rungs.findIndex((r) => r.provider === 'CLAUDE' || r.provider === 'CLAUDE_OPUS');
  return at < 0 ? rungs.length : at;
}

/** Swap the supplier's own name (and host) for the neutral label in an error, in place. Never throws. */
export function neutraliseDiscountedTokensName(err: unknown): void {
  try {
    if (!(err instanceof Error) || typeof err.message !== 'string') return;
    const next = err.message.replace(/\b(?:[\w-]+\.)?discounted[\s-]?tokens(?:\.com)?\b/gi, DISCOUNTEDTOKENS_BUILDER_LABEL);
    if (next !== err.message) err.message = next;
  } catch { /* a frozen error keeps its text */ }
}

export type DiscountedTokensRungFactory = (label: string, apiKey: string, baseURL: string, models: string[]) => NamedRunner[];

/** The DiscountedTokens rungs (empty unless key, rate and switch all allow it), each with brand-neutral errors. */
export function discountedTokensBuilderRungs(factory: DiscountedTokensRungFactory, env: NodeJS.ProcessEnv = process.env): NamedRunner[] {
  if (!discountedTokensBuilderEnabled(env)) return [];
  const state = resellerGatewayState('discountedtokens', env);
  const models = discountedTokensBuilderModels(env);
  if (!state.ready || models.length === 0) return [];
  return factory(DISCOUNTEDTOKENS_BUILDER_LABEL, state.apiKey, state.baseUrl, models).map((rung) => ({ ...rung, runner: withNeutralErrors(rung.runner) }));
}

function withNeutralErrors(runner: TurnRunner): TurnRunner {
  const runTurn = async (params: RunTurnParams) => {
    try { return await runner.runTurn(params); } catch (err) { neutraliseDiscountedTokensName(err); throw err; }
  };
  return new Proxy(runner, {
    get(target, prop) {
      if (prop === 'runTurn') return runTurn;
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
