// AgentV3 — A MODEL TURN THAT ONLY UPDATES THE PLAN.
//
// 🔴 WHY (autopsy 9c612cdb, 2026-10-12, Q-944). Five of the full builder's 22 turns called update_todo and
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
//   3. a measurement: every such turn is counted, and the route reports `TODO_ONLY_TURNS` on every build,
//      so the next report says whether 1 and 2 worked.
//
// 🔒 NEVER STEERED: a run that cannot write. The plan-approval lane offers ONLY update_todo and is told to
// end its turn after it; the planner roles have no writer tool. Telling either to pair the plan with a write
// it cannot make would be an instruction it cannot follow — `isTodoOnlyTurn` returns false for them.
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
 * Did this turn do nothing but update the plan? True only when every tool call of the turn is update_todo
 * AND the run was offered a writer tool (so it could have done real work in the same turn). PURE.
 */
export function isTodoOnlyTurn(toolNames: readonly string[], offeredTools: readonly string[]): boolean {
  if (!Array.isArray(toolNames) || toolNames.length === 0) return false;
  if (!toolNames.every((n) => n === 'update_todo')) return false;
  return Array.isArray(offeredTools) && offeredTools.some((t) => WRITER_TOOLS.has(t));
}

/** Appended to the tool result of the FIRST todo-only turn in a run — once, so it never becomes noise. */
export const TODO_ONLY_TURN_STEER =
  '[PLAN] This turn only updated the plan, so the user waited for a model call that built nothing. '
  + TODO_RIDES_WITH_WORK;

/** The admin-report sentence for `TODO_ONLY_TURNS`. Never user-facing. PURE. */
export function todoOnlyTurnsNote(turns: number, latencyMs: number): string {
  const n = Number.isFinite(turns) && turns > 0 ? Math.floor(turns) : 0;
  if (n === 0) return 'No model turn while the app was generated was spent only on updating the plan (update_todo with no other tool call).';
  const secs = Math.max(0, Math.round((Number.isFinite(latencyMs) ? latencyMs : 0) / 100) / 10);
  return `${n} model turn(s) while the app was generated did nothing but update the plan (update_todo with no other tool call) — ${secs}s of model time `
    + 'that built nothing. The first one in each run was handed back with the rule to send update_todo together with '
    + 'the next step\'s tool calls (autopsy 9c612cdb).';
}
