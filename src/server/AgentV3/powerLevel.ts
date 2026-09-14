// AgentV3 power levels — the admin-authorized billing + reasoning-effort tiers
// (admin aashishcpmt09 / doc.asheesh, 2026-06-27; TIER→MODEL mapping redefined by the
// admin 2026-07-13 — see below).
//
// NavBharatAI Pro runs on NavBharatAI's own Anthropic account (see CLAUDE.md
// §"NavBharatAI Pro — admin-authorized billing override"). The user picks a
// POWER LEVEL; each level PINS the exact model that runs the build — the user's
// selection is what the backend calls, nothing else (admin fidelity rule 2026-07-13):
//
// 🔴 THREE TIERS, NOT FIVE (admin-mandated 2026-09-14: "inko simple 3 me badlo — weak, normal,
// strong. bas"). 'medium' (Powerful) and 'max' (Full Team) are RETIRED as choices.
//
//   Weak      ('weak')   → GLM/Kimi cheap floor ONLY. Claude NEVER runs — not the
//                          builder, not any heal gate (enforceNoClaude strips it from
//                          every chain). The FREE-tier engine. Bills cheap (× 1.2).
//   Normal    ('off')    → today's adaptive routing (Haiku/Sonnet ladder, cheap floor
//                          allowed, Sonnet escalation ceiling). Bills cheap/sonnet by
//                          what actually ran. UNCHANGED by every redefinition so far.
//   Strong    ('mini')   → the PAID PREMIUM tier, and now the ONLY one above Normal.
//                          Sonnet-pinned today; the admin's 2026-09-14 decision is that it
//                          becomes a LADDER (strong lead, Opus only when evidence demands)
//                          — that routing change is its own slice, see the note below.
//
// ⚠️ WHY THE INTERNAL KEYS DID NOT CHANGE. The three survivors keep the exact strings they
// have always had ('weak' / 'off' / 'mini'), so no stored preference, no persisted build
// record and none of the ~20 consumer modules has to be migrated. Only the two retired keys
// need handling, and `toPowerLevel` maps them UP to 'mini' rather than down to 'off': a user
// who had chosen Full Team picked the STRONGEST tier available, so the honest translation of
// their choice is the strongest tier that still exists. Mapping them to the default would
// silently downgrade the people paying most, with nothing on screen to reveal it.
//
// ⚠️ HISTORICAL BILLING IS DELIBERATELY NOT TOUCHED. `pricing.ts`'s `BillingPowerLevel` still
// accepts 'medium'/'max' because build records written before today carry those values and
// must keep pricing at the Opus rate they were actually billed at. Retiring a CHOICE is not
// the same as rewriting what already happened.
//
// `effort` is the Opus 4.8 `output_config.effort` lever (GA, no beta header):
// low | medium | high | xhigh | max. budget_tokens is REMOVED on Opus 4.8 — depth
// is controlled by effort only, paired with adaptive thinking. PURE module so the
// mapping is unit-testable without any provider key.

import { NORMAL_MULTIPLIER, SONNET_MULTIPLIER } from './pricing';

/**
 * The user-facing power levels (admin UI redesign 2026-07-12). Internal keys are kept stable for
 * back-compat; the UI relabels them:
 *   'weak'   → "Weak"        — cheap floor (GLM/Kimi) ONLY, never Claude. The FREE-tier engine.
 *   'off'    → "Normal"      — adaptive routing (the paid default).
 *   'mini'   → "Strong"      — the paid premium tier, and the only one above Normal since 2026-09-14.
 */
export type PowerLevel = 'weak' | 'off' | 'mini';

/**
 * The two tiers retired on 2026-09-14. Kept as a named type rather than loose strings so every place
 * that has to understand an OLD stored value says so out loud, and so deleting one later is a compile
 * error rather than a silent behaviour change.
 */
export type RetiredPowerLevel = 'medium' | 'max';

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
  // Strong = the one paid premium tier. Still Sonnet-pinned HERE; the admin's 2026-09-14 decision
  // turns it into a ladder (strong lead, Opus only on evidence) in its own routing slice, because
  // that change moves `powerMode`'s meaning at ~30 call sites and must not ride a UI change.
  mini: { level: 'mini', powerMode: true, pinnedModel: 'sonnet', effort: undefined, ceilingEffort: 'low', multiplier: SONNET_MULTIPLIER },
};

/**
 * Normalise any power input to a PowerLevel. Accepts the new PowerLevel strings,
 * the legacy `onlyOpus` boolean (true → 'mini', the cheapest Opus tier), and any
 * unknown value (→ 'off'). This keeps every existing caller working unchanged.
 */
export function toPowerLevel(input: PowerLevel | boolean | string | undefined | null): PowerLevel {
  if (input === true) return 'mini';
  if (input === false || input == null) return 'off';
  if (input === 'weak' || input === 'off' || input === 'mini') return input;
  // 🔴 THE RETIRED TIERS MAP **UP**, NOT DOWN (2026-09-14). 'medium' and 'max' were the two tiers
  // ABOVE Strong, so whoever stored one had deliberately chosen the strongest engine on offer. Letting
  // them fall through to the default below would hand exactly those users the middle tier, with
  // nothing on screen to say their choice had been changed — a silent downgrade of the people paying
  // most. 'mini' is now the top of the ladder, so it is the honest translation of "give me the best".
  if (input === 'medium' || input === 'max') return 'mini';
  return 'off';
}

/** Resolve the full spec (pinned model + effort + billing multiplier) for a power input. */
export function powerSpec(input: PowerLevel | boolean | string | undefined | null): PowerSpec {
  return SPECS[toPowerLevel(input)];
}
