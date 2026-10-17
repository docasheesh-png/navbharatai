// AgentV3 — A MODEL TURN THAT ONLY UPDATES THE PLAN.
//
// 🔴 WHY (autopsy 9c612cdb, 2026-10-12, Q-987). Five of the full builder's 22 turns called update_todo and
// nothing else — 20.2 s of model time and a full ~40k-token prompt each, for a list the platform already
// advances by itself as files land (PlanProgress.ts). The architect prompt said "Begin by calling update_todo
// … keep it updated as you progress", and neither it nor the tool's own description said WHEN: a model that
// narrates through tool calls therefore spent a whole turn on every tick. Nothing measured it either — the
// report kept only a tool-call COUNT per model call, so the habit was visible only to someone reading all 22.
//
// The fix has three parts, in the order they act:
//   1. the contract says it: `TODO_RIDES_WITH_WORK` is in the update_todo description and in every
//      instruction that asks a writer to keep the plan (architect prompt, the delegation note, the
//      blueprint block, the task tool) — the first attempt is the right one;
//   2. a mechanical hand-back: the FIRST todo-only turn of a run gets `TODO_ONLY_TURN_STEER` appended to
//      its tool result (AgentRunner) — a rule that exists only as prose is a preference;
//   3. a measurement: every lane that can write counts its turns into ONE tally (`noteTodoOnlyTurn`), and the
//      REPORT carries `TODO_ONLY_TURNS` on every build (`todoOnlyTurnsLine`, emitted when the report is
//      serialized — Q-1030), so the next report says whether 1 and 2 worked.
//
// 🔒 NEVER TOLD, NEVER STEERED: a run that cannot write. The plan-approval lane offers ONLY update_todo and
// is told to end its turn after it; the planner roles have no writer tool. Telling either to pair the plan
// with a write it cannot make would be an instruction it cannot follow — and would contradict the one job the
// plan lane has. So BOTH channels ask the same question, `runCanWrite`: `isTodoOnlyTurn` (the hand-back)
// returns false for them, and `catalogForTools` (the update_todo CONTRACT they read) leaves the rule out.
//
// A LEAF — no runtime imports — so the tool catalog, the prompts and the runner can all read it.

/** The rule, said once and read everywhere a writer is asked to keep the plan. */
export const TODO_RIDES_WITH_WORK =
  'Send update_todo in the SAME turn as your other tool calls (reads included), never as a turn of its own: '
  + 'mark the PREVIOUS step done alongside the next step\'s work. A turn that only updates the plan makes the '
  + 'user wait for a whole model call that builds nothing — and the plan already advances as each file lands.';

/** The tools whose presence makes a run a WRITER run — the only kind that is told to pair the plan. */
const WRITER_TOOLS: ReadonlySet<string> = new Set(['write_file', 'edit_file']);

/**
 * Is a run offered these tools a WRITER run — one that could do real work in the same turn as a plan update?
 * The one answer both the update_todo contract (`catalogForTools`) and the hand-back (`isTodoOnlyTurn`) read,
 * so the two can never disagree about which lanes the rule is for. PURE.
 */
export function runCanWrite(offeredTools: readonly string[]): boolean {
  return Array.isArray(offeredTools) && offeredTools.some((t) => WRITER_TOOLS.has(t));
}

/**
 * Did this turn do nothing but update the plan? True only when every tool call of the turn is update_todo
 * AND the run was offered a writer tool (so it could have done real work in the same turn). PURE.
 */
export function isTodoOnlyTurn(toolNames: readonly string[], offeredTools: readonly string[]): boolean {
  if (!Array.isArray(toolNames) || toolNames.length === 0) return false;
  if (!toolNames.every((n) => n === 'update_todo')) return false;
  return runCanWrite(offeredTools);
}

/** Appended to the tool result of the FIRST todo-only turn in a run — once, so it never becomes noise. */
export const TODO_ONLY_TURN_STEER =
  '[PLAN] This turn only updated the plan, so the user waited for a model call that built nothing. '
  + TODO_RIDES_WITH_WORK;

/** The admin-report sentence for `TODO_ONLY_TURNS`. Never user-facing. PURE. */
export function todoOnlyTurnsNote(turns: number, latencyMs: number, firstInRun?: number): string {
  const n = Number.isFinite(turns) && turns > 0 ? Math.floor(turns) : 0;
  if (n === 0) return 'No model turn while the app was generated was spent only on updating the plan (update_todo with no other tool call).';
  const secs = Math.max(0, Math.round((Number.isFinite(latencyMs) ? latencyMs : 0) / 100) / 10);
  return `${n} model turn(s) while the app was generated did nothing but update the plan (update_todo with no other tool call) — ${secs}s of model time `
    + 'that built nothing. The first one in each run was handed back with the rule to send update_todo together with '
    + 'the next step\'s tool calls (autopsy 9c612cdb).'
    + splitOfRepeats(n, firstInRun);
}

/**
 * How many of the turns were the first of a run (handed back) and how many came AFTER a hand-back. Autopsy
 * 398db9f3 (Q-1068): five turns were reported and the report could not say whether the once-per-run rule was
 * working (one per run) or too weak (several in one run) — so the split is now part of the line. PURE.
 */
function splitOfRepeats(n: number, firstInRun: number | undefined): string {
  if (typeof firstInRun !== 'number' || !Number.isFinite(firstInRun) || firstInRun < 0) return '';
  const first = Math.min(n, Math.floor(firstInRun));
  return ` ${first} of them were the first in a run (handed back); ${n - first} came after a hand-back in the same run.`;
}

/** The ONE running count of a build's plan-only turns, shared by every lane that can run a writer turn. */
export type TodoOnlyTally = { turns: number; latencyMs: number; firstInRun: number };

/**
 * Count one plan-only turn into the build's single tally.
 *
 * 🔴 ONE COUNTER, BECAUSE A COUNT KEPT AT ONE OF N CALL SITES IS NOT KEPT (Q-1030, 2026-10-15). The route
 * had this arithmetic inline in `baseRunnerOpts`, so every OTHER lane that wanted to count had to copy it —
 * and the sub-agent lane, which writes most of a build's files, simply never did (see SubAgentDeps). Lifting
 * the three lines here is what makes "every lane feeds the same tally" a one-line property of a lane rather
 * than three lines a lane can forget. PURE apart from the mutation of the tally it is handed.
 */
export function noteTodoOnlyTurn(tally: TodoOnlyTally, turn: { latencyMs: number; firstInRun?: boolean }): void {
  if (!tally) return;
  tally.turns += 1;
  if (turn?.firstInRun) tally.firstInRun += 1;
  tally.latencyMs += Math.max(0, Number(turn?.latencyMs) || 0);
}

/**
 * The `TODO_ONLY_TURNS` report line — every build, zero included, because a missing line reads as "none".
 *
 * 🔴 IT IS BUILT AT SERIALIZATION TIME, AND THAT POSITION IS THE FIX (Q-1030, 2026-10-15). It used to be
 * RECORDED by the route the moment generation ended — which is before the integrity, design, compile, hooks,
 * completion, guard, feature, vax, runtime, fix, repair and crit-fix runners have run even one turn. Every
 * one of those lanes shares `baseRunnerOpts`, so each was faithfully counted into a tally whose line had
 * already been written: the arithmetic was right and the number the admin read was wrong. Making the line a
 * property of the report rather than of a moment in the route is the same lesson `resolveRecoveredOnSuccess`
 * learned in BuildDiagnostics — a truth that arrives later cannot be stamped early. Info, never a cause.
 */
export function todoOnlyTurnsLine(tally: { turns: number; latencyMs: number; firstInRun?: number }): {
  phase: 'build'; severity: 'info'; code: 'TODO_ONLY_TURNS'; message: string; autoResolved: true;
} {
  return {
    phase: 'build', severity: 'info', code: 'TODO_ONLY_TURNS', autoResolved: true,
    message: todoOnlyTurnsNote(tally?.turns ?? 0, tally?.latencyMs ?? 0, tally?.firstInRun),
  };
}

// 🔴 AND THE HAND-BACK WAS READ AND IGNORED (autopsy ca99778e, 2026-10-17). The architect's first turn and three
// of the frontend sub-agent's turns (29.7 s) were plan-only, after the steer above. A rule a model may skip is a
// preference; the structural answer is that a turn CANNOT be plan-only when the plan tool is not on offer. After
// a plan-only turn, update_todo is withdrawn from the tools of the next turn(s) until the run does real work; a
// second plan-only turn withdraws it for the rest of the run. The plan keeps advancing by itself as files land
// (PlanProgress.ts), so nothing the user sees is lost. Kill switch `AGENTV3_TODO_WITHDRAW=off`. PURE.

export type TodoWithdrawal = 'offered' | 'until-work' | 'for-run';

export function todoWithdrawEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_TODO_WITHDRAW ?? '').trim().toLowerCase() !== 'off';
}

/** The withdrawal state after a turn. `plannedOnlyBefore` = this run already had a plan-only turn. PURE. */
export function nextTodoWithdrawal(
  state: TodoWithdrawal,
  turn: { todoOnly: boolean; didOtherWork: boolean; plannedOnlyBefore: boolean },
  env: NodeJS.ProcessEnv = process.env,
): TodoWithdrawal {
  if (!todoWithdrawEnabled(env)) return 'offered';
  if (state === 'for-run') return 'for-run';
  if (turn.todoOnly) return turn.plannedOnlyBefore ? 'for-run' : 'until-work';
  if (state === 'until-work' && turn.didOtherWork) return 'offered';
  return state;
}

/** The tools offered on the next call: update_todo removed while withdrawn (never on a run that cannot write). PURE. */
export function toolsThisTurn<T extends { name: string }>(tools: readonly T[], state: TodoWithdrawal): T[] {
  if (state === 'offered' || !runCanWrite(tools.map((t) => t.name))) return tools as T[];
  return tools.filter((t) => t.name !== 'update_todo');
}
