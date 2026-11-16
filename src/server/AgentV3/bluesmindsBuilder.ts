/**
 * BluesMinds — Pro BUILDER rung (owner t357u + t359u, 2026-11-16): "pro me - surplus - routerone ke baad
 * blushmind lagao! sabhi default on!!!" — Weak order is Surplus → Router One → BluesMinds → the tier ladder.
 *
 * BluesMinds is an OpenAI-compatible reseller (a "new-api" gateway: `POST /v1/chat/completions`, Bearer
 * key). The builder calls it through the SAME rung factory every GLM / Kimi / Router One rung uses
 * (`openAiCompatRunners` in routes/agentv3.ts → OpenAiToolRunner), so tool calling, streaming, the size
 * gate, the pacer, the bench and the fallthrough are the ordinary ones. Its default model
 * `openai/gpt-oss-20b` is an OpenAI open-weight model built for tool calling; whether this gateway honours
 * `tools` for it is a fact only a real call settles. A turn it cannot do fails, and the chain moves on.
 *
 *   FREE_CHAIN_BLUESMINDS_API_KEY  required (the key the admin Test Chat Bot already uses). No key ⇒ no rung.
 *   BLUESMINDS_BUILDER_ENABLED     default ON. Only an explicit off value (`off`/`0`/`false`/`no`) removes it.
 *   BLUESMINDS_BUILDER_MODEL       optional comma list, default `openai/gpt-oss-20b`.
 *   BLUESMINDS_BUILDER_RATE_IN / _OUT  optional USD per 1M tokens the owner's account really pays.
 *
 * PRICE (honest billing): BluesMinds publishes no dollar price, only new-api ratios
 * (GET https://api.bluesminds.com/api/pricing, read 2026-11-16: gpt-oss-20b model_ratio 0.03,
 * completion_ratio 0.12). On new-api, ratio 1 = $2 per 1M input tokens. We bill the DEARER reading of the
 * output field ($0.24/M, i.e. completion_ratio taken as an absolute ratio, not a 0.12× multiplier), so the
 * estimate can only over-state our cost. The reseller's top-up exchange rate is unverified; set
 * BLUESMINDS_BUILDER_RATE_IN/_OUT to the real figures once known.
 *
 * BRAND: the rung reports as the neutral `ENGINE_BM` (same rule as Router One's `ENGINE_R1`), and its error
 * text has the supplier's name swapped for that label before anything can show it.
 */
import { parseEnvFlag } from '../lib/envFlag';
import type { NamedRunner } from './providers/MultiProviderTurnRunner';
import type { TokenRate } from './pricing';
import type { RunTurnParams, TurnRunner } from './ClaudeClient';

export const BLUESMINDS_BUILDER_LABEL = 'ENGINE_BM';
export const BLUESMINDS_BUILDER_BASE_URL = 'https://api.bluesminds.com/v1';
export const BLUESMINDS_BUILDER_DEFAULT_MODEL = 'openai/gpt-oss-20b';
/** Published ratios → USD per 1M tokens, dearer reading (see header). */
export const BLUESMINDS_ESTIMATED_RATE: Readonly<TokenRate> = Object.freeze({ inputPerMTok: 0.06, outputPerMTok: 0.24 });

export function bluesmindsBuilderApiKey(env: NodeJS.ProcessEnv = process.env): string {
  return String(env.FREE_CHAIN_BLUESMINDS_API_KEY ?? '').trim();
}
/** Default ON; the explicit off value is the operator's emergency kill switch. A missing key skips it. */
export function bluesmindsBuilderEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseEnvFlag(env.BLUESMINDS_BUILDER_ENABLED) !== false && bluesmindsBuilderApiKey(env) !== '';
}
export function bluesmindsBuilderModels(env: NodeJS.ProcessEnv = process.env): string[] {
  const list = String(env.BLUESMINDS_BUILDER_MODEL ?? '').split(',').map(s => s.trim()).filter(s => /^[\w.:/-]{1,128}$/.test(s));
  return list.length ? list : [BLUESMINDS_BUILDER_DEFAULT_MODEL];
}

function rate(raw: string | undefined): number | undefined {
  if (raw === undefined || String(raw).trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}
/** The rate a BluesMinds builder turn is billed at: the owner's configured real rate, else the labelled estimate. */
export function bluesmindsBuilderRate(env: NodeJS.ProcessEnv = process.env): { rate: TokenRate; source: 'configured' | 'estimated' } {
  const input = rate(env.BLUESMINDS_BUILDER_RATE_IN), output = rate(env.BLUESMINDS_BUILDER_RATE_OUT);
  if (input !== undefined && output !== undefined && (input > 0 || output > 0)) return { rate: { inputPerMTok: input, outputPerMTok: output }, source: 'configured' };
  return { rate: { ...BLUESMINDS_ESTIMATED_RATE }, source: 'estimated' };
}
export function isBluesmindsBuilderLabel(provider: string | null | undefined): boolean {
  return String(provider ?? '').trim().toUpperCase().replace(/#\d+$/, '') === BLUESMINDS_BUILDER_LABEL;
}

/** Swap the supplier's own name (and host) for the neutral label in an error, in place. Never throws. */
export function neutraliseBluesmindsName(err: unknown): void {
  try {
    if (!(err instanceof Error) || typeof err.message !== 'string') return;
    const next = err.message.replace(/\b(?:api\.)?blue?s?minds(?:\.com)?\b/gi, BLUESMINDS_BUILDER_LABEL);
    if (next !== err.message) err.message = next;
  } catch { /* a frozen error keeps its text */ }
}

export type BluesmindsRungFactory = (label: string, apiKey: string, baseURL: string, models: string[]) => NamedRunner[];

/** The BluesMinds rungs (empty when switched off or keyless), each with brand-neutral errors. */
export function bluesmindsBuilderRungs(factory: BluesmindsRungFactory, env: NodeJS.ProcessEnv = process.env): NamedRunner[] {
  if (!bluesmindsBuilderEnabled(env)) return [];
  return factory(BLUESMINDS_BUILDER_LABEL, bluesmindsBuilderApiKey(env), BLUESMINDS_BUILDER_BASE_URL, bluesmindsBuilderModels(env))
    .map(rung => ({ ...rung, runner: withNeutralErrors(rung.runner) }));
}

/** Same runner (every method and field, `this` intact); only runTurn's thrown error is neutralised. */
function withNeutralErrors(runner: TurnRunner): TurnRunner {
  const runTurn = async (params: RunTurnParams) => {
    try { return await runner.runTurn(params); }
    catch (err) { neutraliseBluesmindsName(err); throw err; }
  };
  return new Proxy(runner, {
    get(target, prop) {
      if (prop === 'runTurn') return runTurn;
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
