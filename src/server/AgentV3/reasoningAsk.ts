// THE MINIMUM OUTPUT ASK FOR A RUNG THAT ALWAYS REASONS.
//
// 🔴 THE REPORT (build 681bd91b, 2026-09-17). A single-file AI-chat app was DONE at minute 4:45 — preview
// live, screenshot taken, console clean — and then spent **26 more minutes** in "Type-checking… fixing",
// because the repair call was hard-coded `maxTokens: 8000` and the rung that answered it, `glm-5.3`,
// bills its thinking to that same ceiling. Every attempt returned nothing. The mega-roadmap planner had
// already done the same at minute 0 with a hard-coded `4000`: KIMI starved, then GLM starved, and the
// plan arrived 154 s late on the third rung.
//
// WHY THE EXISTING UNCLAMP DID NOT HELP. `reconcileFloorBudget` LIFTS a clock-derived clamp for a model
// that always reasons — it "keeps the caller's ask". Here the caller's ask WAS the ceiling. Nothing in
// the stack raises an ask that a call site wrote too small for the model that will answer it, and the
// call site cannot know which rung will answer: the runner decides that, one rung at a time.
//
// 🔒 SO THE RAISE HAPPENS IN THE RUNNER, AT THE MOMENT THE RUNG IS KNOWN, and only for a model this
// repo has MEASURED to reason before every answer (`modelAlwaysReasons` — a positive test, never an
// assumption about a vendor). The CLOCK still bounds the call exactly as before: authorising tokens does
// not spend them, and a slow rung is cut at the same moment it is cut today. `AGENTV3_REASONING_UNCLAMP=off`
// turns this off with the rest of the unclamp family, because it is the same decision.
//
// THE NUMBER, from the repo's own evidence rather than a guess: on `glm-5.3` the calls that SURVIVED a
// 9,833 ceiling used 8,651 / 9,199 / 9,746 tokens (CLAUDE.md, autopsy f5351721), and the ones that
// starved were authorised 4,000 / 4,833 / 8,000. Twelve thousand clears every measured survivor with
// room for the answer itself. Retune `REASONING_MIN_ASK` from measurement, never from a feeling.

import { modelAlwaysReasons } from './providers/glmThinking';
import { reasoningUnclampEnabled } from './floorBudget';

export const REASONING_MIN_ASK = 12_000;

/**
 * The output ask to send a rung: the caller's, raised to `REASONING_MIN_ASK` only when the rung's model
 * is measured to always reason and the unclamp family is on. Pure.
 */
export function reasoningAwareAsk(
  requested: number | undefined,
  modelId: string | undefined | null,
  env: NodeJS.ProcessEnv = process.env,
): number | undefined {
  if (!modelAlwaysReasons(modelId)) return requested;
  if (!reasoningUnclampEnabled(env)) return requested;
  const ask = Number.isFinite(requested) && (requested as number) > 0 ? Math.floor(requested as number) : 0;
  return Math.max(ask, REASONING_MIN_ASK);
}
