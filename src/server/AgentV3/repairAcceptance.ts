// AgentV3 — A REPAIR IS A HYPOTHESIS. IT MUST BE PROVEN BETTER BEFORE IT IS KEPT.
//
// THE DEFECT (admin, from a real build report 2026-08-23): a batch repair took the app from 4 compile
// errors to 41. A revert further downstream saved the build — but the admin's point is the sharper one:
// *that pass should never have been accepted in the first place.*
//
// THE ROOT CAUSE. SimpleBuilder's repair loop wrote whatever the model returned, unconditionally:
//
//     for (const f of fixed) byPath.set(f.path, f);
//     await deps.writeFiles(fixed);
//     verdict = await deps.verify();
//     if (!verdict.ok && verdict.errors === promptingErrors) break;   // <- the ONLY brake
//
// The only brake was byte-IDENTICAL errors. Four errors becoming forty-one is not identical, so the
// brake stayed off, the worse files were already committed to `byPath` and to the sandbox, and the next
// ladder rung began from the damaged state — each attempt compounding the last. The loop could measure
// whether it was STUCK; it could not measure whether it was going BACKWARDS.
//
// THE MISSING IDEA IS AN ACCEPTANCE TEST. Everywhere else this codebase treats a repair as a proposal
// that must earn its place — `verifyAfterFix` reverts a heal that breaks the render, `designHealGuard`
// restores a page a repair left unparseable, GreenGuard puts the last-known-good files back. The fast
// lane's own repair loop was the one place with no such gate, and it is the one that runs on nearly
// every build.
//
// WHAT "BETTER" MEANS HERE, and why it is a count and not a judgement: strictly fewer compiler
// diagnostics. Not "different errors" — a repair that trades four errors for four other errors may
// genuinely have fixed one and revealed one, and refusing that would stall real progress. Only a
// repair that leaves the compiler LOUDER is refused, because that is the one case where we know for
// certain the app moved away from working.
//
// PURE — no I/O, no clock. The caller performs the revert; this only decides.

import { countTscErrors } from './TscGate';

export interface RepairJudgementInput {
  /** The compiler output that PROMPTED this repair. */
  beforeErrors: string;
  /** The compiler output AFTER the repair was written. */
  afterErrors: string;
  /** Whether verify passed after the repair — a pass ends the argument. */
  afterOk: boolean;
  /** Whether the verification actually executed. A check that never ran proves nothing either way. */
  afterRan?: boolean;
  /** Paths the repair CREATED (they did not exist before it). */
  createdPaths?: readonly string[];
}

export type RepairAction =
  /** The repair stands. */
  | 'keep'
  /** It made things worse and every touched file already existed — put them back. */
  | 'revert'
  /** It made things worse but also created files, which cannot be un-created coherently. */
  | 'keep-and-stop';

export interface RepairJudgement {
  action: RepairAction;
  beforeCount: number;
  afterCount: number;
  /** An honest one-line explanation, safe to log. Never names a provider or a model. */
  reason: string;
}

/**
 * Decide what to do with a repair that has just been written and verified.
 *
 * `keep-and-stop` is the deliberately awkward case and deserves its name. When the repair also created
 * files, reverting only the overwrites would leave a HALF-APPLIED state — some files from before the
 * repair, some from after, agreeing with neither. This codebase has already ruled on that shape once:
 * green-freeze's full-deny exists because a pass that lands half a coordinated change is worse than one
 * that lands none of it. So the regression is kept (it is at least coherent, and the full builder can
 * work from it) and the LOOP STOPS, so a bad state is never compounded by another attempt on top of it.
 */
export function judgeRepair(input: RepairJudgementInput): RepairJudgement {
  const beforeCount = countTscErrors(input?.beforeErrors);
  const afterCount = countTscErrors(input?.afterErrors);
  const created = (input?.createdPaths ?? []).filter((p) => typeof p === 'string' && p.length > 0);

  if (input?.afterOk) {
    return { action: 'keep', beforeCount, afterCount, reason: 'the app compiles after this repair' };
  }
  // A check that did not execute is not evidence of anything. Reverting on no evidence would throw away
  // a repair that may well have been correct — the same "absence of proof is not proof" mistake this
  // month's work has been removing everywhere else.
  if (input?.afterRan === false) {
    return { action: 'keep', beforeCount, afterCount, reason: 'the type-check could not run, so this repair was not judged' };
  }
  // No countable "before" means no baseline to compare against — today's behaviour, honestly.
  if (beforeCount === 0) {
    return { action: 'keep', beforeCount, afterCount, reason: 'no earlier error count to compare against' };
  }
  if (afterCount <= beforeCount) {
    return {
      action: 'keep',
      beforeCount,
      afterCount,
      reason: afterCount < beforeCount
        ? `errors went from ${beforeCount} to ${afterCount}`
        : `errors stayed at ${beforeCount} — different errors, so progress is still possible`,
    };
  }
  const worse = `this repair made the app worse — errors went from ${beforeCount} to ${afterCount}`;
  if (created.length > 0) {
    return {
      action: 'keep-and-stop',
      beforeCount,
      afterCount,
      reason: `${worse}. It also added ${created.length} new file${created.length === 1 ? '' : 's'}, so undoing it cleanly is not possible — stopping here instead of building on it.`,
    };
  }
  return { action: 'revert', beforeCount, afterCount, reason: `${worse} — putting the previous version back.` };
}

/**
 * THE SAME QUESTION, ASKED OF A RUNTIME REPAIR.
 *
 * The runtime-error auto-fix loop already has a net — `verifyAfterFix` snapshots the green app, applies
 * the repair, re-renders it and rolls back if it broke. That net is real, and an earlier note in this
 * session was WRONG to call the loop unguarded.
 *
 * But it asks only "does the app still RENDER". Rendering is a weaker test than working, and the gap it
 * leaves is exactly the one `judgeRepair` closes for compile errors: a repair that fixes one runtime
 * error while introducing two more still renders, so it is kept — and with the default of one attempt
 * it then ships. The user's app had one error before we touched it and three after, and every gate
 * said yes.
 *
 * So the rule is the same rule, and it lives here rather than in the route so "worse" can never come to
 * mean two different things in the two places a repair is judged. Only the unit of measurement differs:
 * compiler diagnostics there, actionable console errors here.
 */
export interface RuntimeRepairInput {
  /** Did the app still render after the repair? */
  stillRenders: boolean;
  /** Actionable runtime errors that PROMPTED the repair. */
  beforeCount: number;
  /** Actionable runtime errors after it. null = the console could not be read. */
  afterCount: number | null;
}

export interface RuntimeRepairJudgement {
  action: 'keep' | 'revert';
  reason: string;
}

export function judgeRuntimeRepair(input: RuntimeRepairInput): RuntimeRepairJudgement {
  if (!input?.stillRenders) {
    return { action: 'revert', reason: 'the app no longer rendered after this repair' };
  }
  // UNPROVEN IS NOT PROOF AGAINST. A console we could not read tells us nothing, and reverting a repair
  // that may well have been correct — throwing away a real fix on no evidence — is the same mistake in
  // the opposite direction. The existing net already treats an inconclusive render this way.
  if (typeof input.afterCount !== 'number') {
    return { action: 'keep', reason: 'the app still renders; its console could not be read, so the repair was not judged further' };
  }
  const before = Number.isFinite(input.beforeCount) ? Math.max(0, input.beforeCount) : 0;
  if (input.afterCount > before) {
    return {
      action: 'revert',
      reason: `the app still renders, but this repair left MORE runtime errors than it found (${before} → ${input.afterCount}) — putting the previous version back`,
    };
  }
  return {
    action: 'keep',
    reason: input.afterCount < before
      ? `runtime errors went from ${before} to ${input.afterCount}`
      : `runtime errors stayed at ${before} — different errors, so progress is still possible`,
  };
}
