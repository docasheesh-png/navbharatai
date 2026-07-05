// AgentV3 power levels — the admin-authorized billing + reasoning-effort tiers
// (admin aashishcpmt09 / doc.asheesh, 2026-06-27).
//
// NavBharatAI Pro v3.0 runs on NavBharatAI's own Anthropic account (see CLAUDE.md
// §"NavBharatAI Pro v3.0 — admin-authorized billing override"). The user picks a
// POWER LEVEL; each level maps to a Claude Opus reasoning-effort setting and a
// billing multiplier applied to the real Opus-equivalent token cost.
//
//   Power OFF (normal)  → Sonnet/Gemini/Haiku routing; the engine may escalate to
//                         Opus at its LOWEST effort as the ceiling. Billed at the
//                         normal Sonnet-equivalent rate (unchanged) — no surprise.
//   Power 5×  (mini)    → Opus, effort "low"    — minimum Opus power.
//   Power 10× (medium)  → Opus, effort "medium".
//   Power 20× (max)     → Opus, effort "max"    — ultracode, maximum reasoning.
//
// `effort` is the Opus 4.8 `output_config.effort` lever (GA, no beta header):
// low | medium | high | xhigh | max. budget_tokens is REMOVED on Opus 4.8 — depth
// is controlled by effort only, paired with adaptive thinking. PURE module so the
// mapping is unit-testable without any provider key.

import { NORMAL_MULTIPLIER, OPUS_MULTIPLIER } from './pricing';

/** The four user-facing power levels. 'off' is normal (Power toggle OFF). */
export type PowerLevel = 'off' | 'mini' | 'medium' | 'max';

/** Claude Opus reasoning-effort values (output_config.effort). */
export type ClaudeEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface PowerSpec {
  /** The level itself. */
  level: PowerLevel;
  /** True for any Opus power level (real Opus × 2). False for normal mode. */
  powerMode: boolean;
  /**
   * Opus reasoning effort for this level. Undefined in normal mode so Sonnet/Haiku
   * run at their own default (effort errors on Haiku 4.5, so we never force it for
   * a non-Opus run). The Opus normal-mode ESCALATION ceiling uses 'low' explicitly.
   */
  effort?: ClaudeEffort;
  /** Effort to use when normal mode escalates up to Opus (the "lowest version" ceiling). */
  ceilingEffort: ClaudeEffort;
  /** Billing multiplier applied to the (real) Opus-equivalent token cost. */
  multiplier: number;
}

const SPECS: Record<PowerLevel, PowerSpec> = {
  off: { level: 'off', powerMode: false, effort: undefined, ceilingEffort: 'low', multiplier: NORMAL_MULTIPLIER },
  mini: { level: 'mini', powerMode: true, effort: 'low', ceilingEffort: 'low', multiplier: OPUS_MULTIPLIER },
  medium: { level: 'medium', powerMode: true, effort: 'medium', ceilingEffort: 'low', multiplier: OPUS_MULTIPLIER },
  max: { level: 'max', powerMode: true, effort: 'max', ceilingEffort: 'low', multiplier: OPUS_MULTIPLIER },
};

/**
 * Normalise any power input to a PowerLevel. Accepts the new PowerLevel strings,
 * the legacy `onlyOpus` boolean (true → 'mini', the cheapest Opus tier), and any
 * unknown value (→ 'off'). This keeps every existing caller working unchanged.
 */
export function toPowerLevel(input: PowerLevel | boolean | string | undefined | null): PowerLevel {
  if (input === true) return 'mini';
  if (input === false || input == null) return 'off';
  if (input === 'off' || input === 'mini' || input === 'medium' || input === 'max') return input;
  return 'off';
}

/** Resolve the full spec (effort + billing multiplier + Opus flag) for a power input. */
export function powerSpec(input: PowerLevel | boolean | string | undefined | null): PowerSpec {
  return SPECS[toPowerLevel(input)];
}
