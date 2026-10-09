/**
 * P2a — DO NOT CLAMP A STREAMING CALL'S OUTPUT TO THE CLOCK (fix/build-reliability, AGENTV3_STREAM_NO_CLAMP).
 *
 * `reconcileFloorBudget` sizes max_tokens by an assumed 30 ms/token against the call's timeout — a
 * guard that made sense for a NON-streaming call, where a long answer and a hung provider look the
 * same until the timeout fires. With streaming on (production: AGENTV3_STREAM_BUILD_CALLS=on) a hang
 * is detected directly by the IDLE timer, so the clamp only buys truncated files: a 300 s ceiling
 * became ~9,833 tokens, a 150 s one ~4,833, and an App.tsx bigger than that was cut mid-write.
 *
 * With the flag on AND streaming: ask for what the caller asked, bounded only by what the MODEL can
 * emit (`modelMaxOutputTokens`). The idle + hard-cap stream timers still bound the call in time.
 * Values below are conservative published-or-observed ceilings — an ESTIMATE where marked, and any
 * model not listed gets AGENTV3_STREAM_MAX_OUTPUT_DEFAULT (16,000).
 */
import { reliabilityFlag, reliabilityInt } from './flags';
import type { FloorBudget } from '../floorBudget';

const MODEL_MAX_OUTPUT: Array<{ re: RegExp; tokens: number }> = [
  { re: /kimi/i, tokens: 32_000 }, // estimate — Moonshot K2 family supports long outputs
  { re: /glm-5|glm-4\.[5-9]/i, tokens: 32_000 }, // estimate — Z.ai GLM 4.5+ coding models
  { re: /glm/i, tokens: 16_000 },
  { re: /grok/i, tokens: 32_000 }, // estimate
  { re: /nemotron/i, tokens: 16_000 }, // estimate
];

export function modelMaxOutputTokens(model: string | undefined, env: NodeJS.ProcessEnv = process.env): number {
  const m = String(model ?? '');
  for (const { re, tokens } of MODEL_MAX_OUTPUT) if (re.test(m)) return tokens;
  return reliabilityInt('AGENTV3_STREAM_MAX_OUTPUT_DEFAULT', 16_000, 1_000, env);
}

export function streamNoClampEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return reliabilityFlag('STREAM_NO_CLAMP', env);
}

/**
 * The streaming budget: the caller's ask, capped only by the model's own ceiling. Never LOWER than the
 * clamped budget would have been (so turning the flag on can only give a call more room, never less).
 */
export function streamingBudget(requested: number, model: string | undefined, clamped: FloorBudget, env: NodeJS.ProcessEnv = process.env): FloorBudget {
  const ask = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : clamped.maxTokens;
  const max = Math.max(clamped.maxTokens, Math.min(ask, modelMaxOutputTokens(model, env)));
  // `reasoningUnclamped: true` — the clock no longer sizes this call, so a starved answer must not be
  // "learned" as starvation-under-the-clamp (OpenAiToolRunner's rememberStarvedWhileClamped).
  return { ...clamped, maxTokens: max, clamped: false, requested: ask, reasoningUnclamped: true };
}
