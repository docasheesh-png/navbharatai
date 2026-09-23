// AgentV3 — may the fast lane start on the rung this build would open on?
//
// 🔴 THE LANE THAT COULD NOT FINISH (autopsy ac41a924, 2026-09-23; the same shape was recorded as an
// OPEN item one autopsy earlier). A Devanagari prompt for a news site was read as COMPLEX, so the build
// opened past the flash rung, on `kimi-k2.7-code`. The fast lane's first act is ONE plan call bounded
// at 90 s — a cap sized for a rung that answers directly. `kimi-k2.7-code` always reasons before it
// writes a word (it is in `MEASURED_ALWAYS_REASONS` because it starved its output budget doing exactly
// that), so the plan call hit the cap with nothing back, the lane gave up, and the full builder then
// built the whole app on the SAME model in five and a half minutes. Ninety seconds — 13% of the build
// — bought nothing, and the report blamed "the build's time budget".
//
// So the question is asked BEFORE the lane starts, from facts already held: which rung opens this
// build, and does that model always reason? If it does, the lane is skipped and the reason recorded.
// Nothing about the ladder, the models or the full builder changes; only a lane that cannot finish is
// no longer started.
//
// PURE — the route supplies the tier's rungs and which of them have a key.

import { openingRung, type LadderRung } from './tierLadder';
import { modelAlwaysReasons } from './providers/glmThinking';

export interface FastLaneRungDecision {
  /** The rung the fast lane would open on, or null when no keyed rung exists. */
  rung: LadderRung | null;
  /** True when the fast lane should not start. */
  skip: boolean;
  /** Admin-only reason (names the model — never shown to a user). Empty when not skipped. */
  reason: string;
}

/** `AGENTV3_FASTLANE_REASONING_GATE=off` restores the pre-2026-09-23 behaviour exactly. */
export function fastLaneReasoningGateEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_FASTLANE_REASONING_GATE ?? '').trim().toLowerCase() !== 'off';
}

export function fastLaneRungDecision(
  rungs: readonly LadderRung[],
  opts: { complex: boolean; isKeyed?: (rung: LadderRung) => boolean; enabled?: boolean },
): FastLaneRungDecision {
  // The lane skips keyless rungs exactly like the chain it runs on, so its opener is the first KEYED
  // rung at or after the ladder's opening position.
  const keyed = opts.isKeyed ?? (() => true);
  const openedAt = openingRung(rungs, { complex: opts.complex });
  const rung = rungs.slice(Math.max(0, openedAt - 1)).find(keyed) ?? null;
  if (opts.enabled === false || !rung) return { rung, skip: false, reason: '' };
  if (!modelAlwaysReasons(rung.model)) return { rung, skip: false, reason: '' };
  return {
    rung,
    skip: true,
    reason: `The build opens on ${rung.provider} ${rung.model}, which always reasons before it answers; the fast lane's single plan call is bounded for a rung that answers directly, so it would spend its cap and hand over with nothing. Going straight to the full builder on the same model.`,
  };
}
