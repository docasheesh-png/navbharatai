// AgentV3 power levels — the admin-authorized billing + reasoning-effort tiers
// (admin aashishcpmt09 / doc.asheesh, 2026-06-27; TIER→MODEL mapping redefined by the
// admin 2026-07-13 — see below).
//
// NavBharatAI Pro v3.0 runs on NavBharatAI's own Anthropic account (see CLAUDE.md
// §"NavBharatAI Pro v3.0 — admin-authorized billing override"). The user picks a
// POWER LEVEL; each level PINS the exact model that runs the build — the user's
// selection is what the backend calls, nothing else (admin fidelity rule 2026-07-13):
//
//   Weak      ('weak')   → GLM/Kimi cheap floor ONLY. Claude NEVER runs — not the
//                          builder, not any heal gate (enforceNoClaude strips it from
//                          every chain). The FREE-tier engine. Bills cheap (× 1.2).
//   Normal    ('off')    → today's adaptive routing (Haiku/Sonnet ladder, cheap floor
//                          allowed, Sonnet escalation ceiling). Bills cheap/sonnet by
//                          what actually ran. UNCHANGED by the 2026-07-13 redefinition.
//   Strong    ('mini')   → SONNET 100% (was Opus low). Pinned: the build + every heal
//                          gate run Sonnet; no cheap floor, no Opus. Bills Sonnet × 3.
//   Powerful  ('medium') → OPUS, effort 'medium' (was 'high'). Bills real Opus × 2.
//   Full Team ('max')    → OPUS, effort 'max' (ultracode). Bills real Opus × 2.
//
// `effort` is the Opus 4.8 `output_config.effort` lever (GA, no beta header):
// low | medium | high | xhigh | max. budget_tokens is REMOVED on Opus 4.8 — depth
// is controlled by effort only, paired with adaptive thinking. PURE module so the
// mapping is unit-testable without any provider key.

import { NORMAL_MULTIPLIER, SONNET_MULTIPLIER, OPUS_MULTIPLIER } from './pricing';

/**
 * The user-facing power levels (admin UI redesign 2026-07-12). Internal keys are kept stable for
 * back-compat; the UI relabels them:
 *   'weak'   → "Weak"        — cheap floor (GLM/Kimi) ONLY, never Claude. The FREE-tier engine.
 *   'off'    → "Normal"      — adaptive routing (the paid default).
 *   'mini'   → "Strong"      — Sonnet, pinned 100% (admin 2026-07-13; was Opus low).
 *   'medium' → "Powerful"    — Opus, medium effort (admin 2026-07-13; was high).
 *   'max'    → "Full Team"   — Opus, max effort (ultracode).
 */
export type PowerLevel = 'weak' | 'off' | 'mini' | 'medium' | 'max';

/** Claude Opus reasoning-effort values (output_config.effort). */
export type ClaudeEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface PowerSpec {
  /** The level itself. */
  level: PowerLevel;
  /** True for any PAID pinned tier (mini/medium/max) — gating, no cheap floor, no ladder. */
  powerMode: boolean;
  /**
   * 'weak' ONLY: route on the cheap floor (GLM/Kimi) alone and NEVER fall back to Claude — the free
   * tier. The route forces cheap-only routing (freeTierBuildActive) when this is set, so a free user's
   * build can never spend NavBharatAI's Claude budget. Bills at the cheap tier (× 1.2, like 'off').
   */
  cheapOnly?: boolean;
  /**
   * The exact Claude model a PAID pinned tier runs on (admin fidelity rule 2026-07-13: what the user
   * selected is what the backend calls). 'sonnet' for Strong ('mini'); 'opus' for Powerful/Full Team.
   * Undefined for 'weak'/'off' (weak never touches Claude; Normal keeps adaptive routing).
   */
  pinnedModel?: 'sonnet' | 'opus';
  /**
   * Claude reasoning effort for this level. Defined ONLY for the Opus tiers ('medium' → 'medium',
   * 'max' → 'max'). Undefined for weak/off/mini so Sonnet/Haiku run at their own default (forcing
   * effort on Haiku 4.5 errors; Strong-as-Sonnet deliberately uses Sonnet's default reasoning).
   */
  effort?: ClaudeEffort;
  /** Effort to use when normal mode escalates up to Opus (the "lowest version" ceiling). */
  ceilingEffort: ClaudeEffort;
  /** Billing multiplier applied per pricing.ts (cheap × 1.2 / Sonnet × 3 / real Opus × 2). */
  multiplier: number;
}

const SPECS: Record<PowerLevel, PowerSpec> = {
  // Weak = the FREE tier: cheap floor (GLM/Kimi) only, never Claude. Bills at the cheap rate (× 1.2).
  weak: { level: 'weak', powerMode: false, cheapOnly: true, effort: undefined, ceilingEffort: 'low', multiplier: NORMAL_MULTIPLIER },
  off: { level: 'off', powerMode: false, effort: undefined, ceilingEffort: 'low', multiplier: NORMAL_MULTIPLIER },
  // Admin tier→model redefinition (2026-07-13): Strong = SONNET pinned 100% (bills Sonnet × 3, the
  // "Sonnet actually ran" tier — billing follows the model that really works, never Opus rates for
  // Sonnet work); Powerful = Opus at effort 'medium' (was 'high'); Full Team = Opus at 'max'.
  mini: { level: 'mini', powerMode: true, pinnedModel: 'sonnet', effort: undefined, ceilingEffort: 'low', multiplier: SONNET_MULTIPLIER },
  medium: { level: 'medium', powerMode: true, pinnedModel: 'opus', effort: 'medium', ceilingEffort: 'low', multiplier: OPUS_MULTIPLIER },
  max: { level: 'max', powerMode: true, pinnedModel: 'opus', effort: 'max', ceilingEffort: 'low', multiplier: OPUS_MULTIPLIER },
};

/**
 * Normalise any power input to a PowerLevel. Accepts the new PowerLevel strings,
 * the legacy `onlyOpus` boolean (true → 'mini', the cheapest Opus tier), and any
 * unknown value (→ 'off'). This keeps every existing caller working unchanged.
 */
export function toPowerLevel(input: PowerLevel | boolean | string | undefined | null): PowerLevel {
  if (input === true) return 'mini';
  if (input === false || input == null) return 'off';
  if (input === 'weak' || input === 'off' || input === 'mini' || input === 'medium' || input === 'max') return input;
  return 'off';
}

/** Resolve the full spec (pinned model + effort + billing multiplier) for a power input. */
export function powerSpec(input: PowerLevel | boolean | string | undefined | null): PowerSpec {
  return SPECS[toPowerLevel(input)];
}
