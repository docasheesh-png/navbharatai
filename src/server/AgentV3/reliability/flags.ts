/**
 * BUILD-RELIABILITY FLAGS (fix/build-reliability, 2026-10-09).
 *
 * Every change in the build-reliability series sits behind ONE of these flags, and every flag
 * defaults OFF — so with none set, every build is byte-identical to before this series. They are
 * read through `envFlag` (the one boolean parser), so `on` / `true` / `1` all enable.
 *
 * See docs/claude/ENV_REGISTRY.md → "Build reliability (fix/build-reliability)" for what each does,
 * how to switch it on, and how to verify it.
 */
import { parseEnvFlag } from '../../lib/envFlag';

export const RELIABILITY_FLAGS = {
  /** P4a — a build keeps the rung that last answered instead of re-opening every turn at rung 0. */
  STICKY_RUNG: 'AGENTV3_STICKY_RUNG',
  /** P4b — quality signals (truncation ×2, edit fail ×3, tsc errors not dropping) move the build UP one model. */
  QUALITY_ESCALATE: 'AGENTV3_QUALITY_ESCALATE',
  /** P4c — pass Kimi/GLM `reasoning_content` back on historical assistant messages. */
  REASONING_PASSBACK: 'AGENTV3_REASONING_PASSBACK',
  /** P3a — compact the model transcript by TOKEN budget (~50% of window) instead of a fixed message count. */
  TOKEN_COMPACT: 'AGENTV3_TOKEN_COMPACT',
  /** P3b — append the fresh content of recently-touched files as the last block the model reads. */
  WORKING_SET: 'AGENTV3_WORKING_SET',
  /** P2a — when streaming, do not clamp max_tokens to the clock (idle timeout guards the stream instead). */
  STREAM_NO_CLAMP: 'AGENTV3_STREAM_NO_CLAMP',
  /** P2b — a truncated write is buffered (never persisted) and finished with `append_file`. */
  RESUME_TRUNCATED: 'AGENTV3_RESUME_TRUNCATED',
  /** P2c — the ~200-line file rule in the system prompt. */
  FILE_SIZE_RULE: 'AGENTV3_FILE_SIZE_RULE',
  /** P5a — slim core system prompt + on-demand modules. */
  MODULAR_PROMPT: 'AGENTV3_MODULAR_PROMPT',
  /** P5b — refuse banned packages in code (bash installs + package.json writes). */
  BANNED_PACKAGE_GUARD: 'AGENTV3_BANNED_PACKAGE_GUARD',
  /** P5c — 16 core tools + `load_tools` instead of the full architect toolset. */
  CORE_TOOLSET: 'AGENTV3_CORE_TOOLSET',
  /** P6 — fast lane v2: export/import contract, topological waves, full dependency code, >12 files → agent loop. */
  FAST_LANE_V2: 'AGENTV3_FAST_LANE_V2',
} as const;

export type ReliabilityFlag = keyof typeof RELIABILITY_FLAGS;

/** Is this reliability flag on? Default OFF for every one of them. */
export function reliabilityFlag(flag: ReliabilityFlag, env: NodeJS.ProcessEnv = process.env): boolean {
  return parseEnvFlag(env[RELIABILITY_FLAGS[flag]]) ?? false;
}

/** Integer env knob with a default and a floor — for the tunables that ride along with a flag. */
export function reliabilityInt(name: string, fallback: number, min = 0, env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[name];
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const n = Number(String(raw).trim());
  return Number.isFinite(n) && n >= min ? Math.floor(n) : fallback;
}
