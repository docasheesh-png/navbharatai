/**
 * Moyi API — Pro BUILDER rung (owner 2026-11-17: "moyi api ko bhi bluesminds ke baad lagao, its working").
 * Weak order is Surplus → Router One → BluesMinds → Moyi → the tier ladder.
 *
 * Moyi is an OpenAI-compatible reseller gateway. The builder calls it through the SAME rung factory every
 * GLM / Kimi / Router One / BluesMinds rung uses (`openAiCompatRunners` in routes/agentv3.ts →
 * OpenAiToolRunner), so tool calling, streaming, the size gate, the pacer, the bench and the fallthrough
 * are the ordinary ones. A turn it cannot do fails, and the chain moves on.
 *
 *   MOYI_API_KEY              required (the key the admin Test Chat Bot uses). No key ⇒ no rung.
 *   MOYI_BUILDER_MODEL        required comma list of model ids, exactly as Moyi's /models lists them.
 *                             There is NO default: the ids were never readable from the build environment,
 *                             and a guessed id would fail every Weak build's Moyi turn. Unset ⇒ no rung.
 *   MOYI_BUILDER_RATE_IN/_OUT required USD per 1M tokens the owner's Moyi account really pays for that
 *                             model. Unset ⇒ no rung: a rung without a real price cannot be billed honestly,
 *                             and no estimate is invented (BluesMinds had published ratios; Moyi's prices
 *                             differ per model and were seen only as a pasted page).
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
import { parseEnvFlag } from '../lib/envFlag';
import { resellerGatewayState } from '../lib/resellerGateways';
import type { NamedRunner } from './providers/MultiProviderTurnRunner';
import type { TokenRate } from './pricing';
import type { RunTurnParams, TurnRunner } from './ClaudeClient';

export const MOYI_BUILDER_LABEL = 'ENGINE_MY';

/** Claude family names, in any spelling a gateway uses (`claude-…`, `anthropic/…`, bare tier words). */
const CLAUDE_FAMILY = /claude|anthropic|sonnet|opus|haiku|fable/i;

export function moyiBuilderModels(env: NodeJS.ProcessEnv = process.env): string[] {
  return String(env.MOYI_BUILDER_MODEL ?? '').split(',').map(s => s.trim())
    .filter(s => /^[\w.:/@+-]{1,128}$/.test(s) && !CLAUDE_FAMILY.test(s));
}

function rate(raw: string | undefined): number | undefined {
  if (raw === undefined || String(raw).trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}
/** The owner's real Moyi rate, or null when it is not configured (then there is no rung). */
export function moyiBuilderRate(env: NodeJS.ProcessEnv = process.env): TokenRate | null {
  const input = rate(env.MOYI_BUILDER_RATE_IN), output = rate(env.MOYI_BUILDER_RATE_OUT);
  return input !== undefined && output !== undefined && input + output > 0 ? { inputPerMTok: input, outputPerMTok: output } : null;
}

/** Why the rung is absent, for the admin's eyes (names of env keys only); null when it is present. */
export function moyiBuilderMissing(env: NodeJS.ProcessEnv = process.env): string | null {
  if (parseEnvFlag(env.MOYI_BUILDER_ENABLED) === false) return 'MOYI_BUILDER_ENABLED is off';
  const gateway = resellerGatewayState('moyi', env);
  if (!gateway.ready) return gateway.configured ? 'MOYI_BASE_URL is not a valid Moyi endpoint' : 'MOYI_API_KEY is not set';
  if (!moyiBuilderModels(env).length) return 'MOYI_BUILDER_MODEL is not set (or names only Claude models, which are not allowed here)';
  if (!moyiBuilderRate(env)) return 'MOYI_BUILDER_RATE_IN and MOYI_BUILDER_RATE_OUT are not set';
  return null;
}
/** Default ON once the key, a model and a real rate exist; the explicit off value is the kill switch. */
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

/** The Moyi rungs (empty when switched off, keyless, model-less or rate-less), each with brand-neutral errors. */
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
