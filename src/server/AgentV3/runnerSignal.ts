// THE STOP SIGNAL OF THE RUNNER THAT IS EXECUTING RIGHT NOW (autopsy aba63ead / failedbr #2475, 2026-11-19).
//
// 🔴 WHAT HAPPENED. A Weak game build's click explorer found two covered buttons and started a repair pass
// with a 150 s budget. The repair's runner delegated to a `debugger` specialist through the `task` tool.
// At 592 s the budget ended, the repair was aborted ('repair-budget') and its files were put back
// (EXPLORE_REPAIR_UNDONE). The specialist did not stop: it made five more edits and ran `npm run build`
// until 660 s, and the build saved those unverified edits as "the project's verified version". The
// explorer's verdict, the release gate and the preview proof had all been taken on the version BEFORE them.
//
// 🔑 THE CLASS. `makeSubAgentSpawn` is built once per build and handed the BUILD's signal. Every runner
// that shares the build's dispatcher — the explorer repair, the game repair, the green repair, a heal
// runner — spawns its specialists through that one closure, so a child only ever stopped when the WHOLE
// build stopped. A pass's own stop never reached it. The same zombie-write class the SimpleBuilder (July)
// and OneShotBuilder (a38c6fef) lanes were fixed for, on the road neither fix could see: delegation.
//
// 🧬 THE FIX, IN TWO LAYERS.
//  1. `AgentRunner.run` executes inside `runWithRunnerSignal(its signal)`. A child is spawned with
//     `childStopSignal(buildSignal)`: it stops when the build stops OR when the runner that spawned it
//     stops, carrying that stop's own cause (so a 'repair-budget' child reports a pass budget, not a crash).
//  2. A write made inside a runner whose own pass budget has ended is refused at the actuator's choke
//     point (`greenFreeze.assertWriteAllowed`) — the tool that was already in flight when the budget
//     ended cannot land after the pass's files were put back. Only the pass-budget causes: the user's own
//     Stop and the build-level causes keep today's "end between turns, lose no written file" contract.
//
// PURE apart from the AsyncLocalStorage zone. Kill switch: AGENTV3_CHILD_INHERITS_RUNNER_STOP=off.

import { AsyncLocalStorage } from 'node:async_hooks';
import { abortCauseOf, type AbortCause } from './buildAbortCause';

const zone = new AsyncLocalStorage<{ signal: AbortSignal | undefined }>();

export function childInheritsRunnerStopEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_CHILD_INHERITS_RUNNER_STOP ?? '').trim().toLowerCase() !== 'off';
}

/** Run `fn` as the runner whose stop signal is `signal`. Nested runners each open their own zone. */
export function runWithRunnerSignal<T>(signal: AbortSignal | undefined, fn: () => Promise<T>): Promise<T> {
  return zone.run({ signal }, fn);
}

/** The stop signal of the runner executing now, or undefined outside every runner. */
export function currentRunnerSignal(): AbortSignal | undefined {
  return zone.getStore()?.signal;
}

/**
 * The signal a delegated child runs under: the build's, joined with the spawning runner's own. The first
 * to abort wins and its reason (and so its recorded cause) is the child's. With no runner zone, or the
 * zone's signal IS the build's, it is the build's signal unchanged — byte-identical to before.
 */
export function childStopSignal(buildSignal: AbortSignal | undefined, env: NodeJS.ProcessEnv = process.env): AbortSignal | undefined {
  if (!childInheritsRunnerStopEnabled(env)) return buildSignal;
  const runner = currentRunnerSignal();
  if (!runner || runner === buildSignal) return buildSignal;
  if (!buildSignal) return runner;
  return AbortSignal.any([buildSignal, runner]);
}

/** A pass's own budget — it ends that pass and its files are put back; never the build's ending. */
export const PASS_BUDGET_CAUSES: ReadonlySet<AbortCause> = new Set<AbortCause>(['review-budget', 'recheck-budget', 'repair-budget']);

export function isPassBudgetCause(cause: AbortCause | null | undefined): boolean {
  return !!cause && PASS_BUDGET_CAUSES.has(cause);
}

/**
 * The pass-budget cause that ended the runner executing now, or null when it is still running (or ended
 * for any other reason). A write made while this is non-null would land after the pass was undone.
 */
export function stoppedPassCause(env: NodeJS.ProcessEnv = process.env): AbortCause | null {
  if (!childInheritsRunnerStopEnabled(env)) return null;
  const signal = currentRunnerSignal();
  if (!signal?.aborted) return null;
  const cause = abortCauseOf(signal);
  return isPassBudgetCause(cause) ? cause : null;
}

export class StoppedPassWriteError extends Error {
  constructor(readonly path: string, readonly cause: AbortCause) {
    super(`WRITE REFUSED — this repair pass already ran out of its time (${cause}), and its changes were put back. `
      + `A write to ${path} now would land on the restored app without being checked, so it was not saved. Stop here.`);
    this.name = 'StoppedPassWriteError';
  }
}
