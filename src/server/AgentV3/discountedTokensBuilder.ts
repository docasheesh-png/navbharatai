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
 * comma list in DISCOUNTEDTOKENS_MODEL (cheapest good first, from their price page), else gpt-6-sol and then the key's
 * own /models list as far as it is already known — after which the chain moves on to Sonnet.
 *
 * PRICE (honest billing, "a cost is never invented"). DiscountedTokens' prices are on a page this platform cannot read,
 * and its OpenAI models have no published list price we hold. So the rung exists only once the owner sets the real
 * rate it pays: DISCOUNTEDTOKENS_BUILDER_RATE_IN / _OUT (USD per 1M tokens). Without both, no rung — and
 * `discountedTokensBuilderMissing` names exactly what to set.
 *
 *   DISCOUNTEDTOKENS_API_KEY            required (the key the Test Chat Bot uses)
 *   DISCOUNTEDTOKENS_BUILDER_RATE_IN/_OUT  required, the real rate
 *   DISCOUNTEDTOKENS_BUILDER_ENABLED    default ON; only an explicit off removes it
 *   DISCOUNTEDTOKENS_MODEL              optional comma list, the owner's order
 *
 * BRAND: reports as the neutral `ENGINE_DT`; its error text has the supplier's name and host swapped for that label.
 */
import { parseEnvFlag } from '../lib/envFlag';
import { resellerGatewayState, RESELLER_MODEL_LADDER_MAX } from '../lib/resellerGateways';
import { cachedProviderModels } from '../lib/providerModelPicker';
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

/** The real rate the owner pays, or undefined — never an invented one. */
export function discountedTokensBuilderRate(env: NodeJS.ProcessEnv = process.env): TokenRate | undefined {
  const input = rateOf(env.DISCOUNTEDTOKENS_BUILDER_RATE_IN), output = rateOf(env.DISCOUNTEDTOKENS_BUILDER_RATE_OUT);
  return input !== undefined && output !== undefined && (input > 0 || output > 0) ? { inputPerMTok: input, outputPerMTok: output } : undefined;
}

/** What is still missing before the rung can exist ([] = ready). For the admin, never the user. */
export function discountedTokensBuilderMissing(env: NodeJS.ProcessEnv = process.env): string[] {
  const missing: string[] = [];
  const state = resellerGatewayState('discountedtokens', env);
  if (!state.ready) missing.push('DISCOUNTEDTOKENS_API_KEY');
  if (!discountedTokensBuilderRate(env)) missing.push('DISCOUNTEDTOKENS_BUILDER_RATE_IN', 'DISCOUNTEDTOKENS_BUILDER_RATE_OUT');
  return missing;
}

export function discountedTokensBuilderEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseEnvFlag(env.DISCOUNTEDTOKENS_BUILDER_ENABLED) !== false && discountedTokensBuilderMissing(env).length === 0;
}

/** Up to three models, in the owner's order; else the default and then the key's own list as far as it is known. */
export function discountedTokensBuilderModels(env: NodeJS.ProcessEnv = process.env, listed: (base: string, key: string) => string[] = cachedProviderModels): string[] {
  const state = resellerGatewayState('discountedtokens', env);
  if (!state.ready) return [];
  const out = (state.models.length ? state.models : state.model ? [state.model] : []).slice(0, RESELLER_MODEL_LADDER_MAX);
  if (out.length < RESELLER_MODEL_LADDER_MAX) {
    for (const id of listed(state.baseUrl, state.apiKey)) { if (out.length >= RESELLER_MODEL_LADDER_MAX) break; if (!out.includes(id)) out.push(id); }
  }
  return out;
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
