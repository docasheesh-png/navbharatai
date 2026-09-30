// A PLANNER OR A REPAIR IS ASKED FOR AN ANSWER, NOT A DELIBERATION.
//
// 🔴 AUTOPSY 6a5fb04b (2026-09-30). The mega-app roadmap planner ran on `glm-4.7-flashx`, a model that
// CAN be told not to reason (`glmCanDisableThinking`), and came back with 4,000 output tokens, 62 s of
// wall clock, `stop=max_tokens` and 151 characters of text — a plan cut off after its first sentence,
// so the guardrail threw it away and the build "proceeded directly". The same planner spent 3,543
// output tokens on autopsy Study-Racer (2026-09-25), recorded then as a pricing problem.
//
// 🔑 THE CAUSE IS ONE MISSING FIELD. `glmThinkingParam` sends `thinking: disabled` only when the turn
// carries `thinking: false`; with the field ABSENT it sends nothing, and "nothing" means the provider's
// DEFAULT effort (glmThinking.ts already records this for 5.3-flash: "sending NO field does not mean
// think less"). The architect and the fast lane's generation calls pass the build's `thinking` setting;
// the three planners (roadmap, blueprint, Project Mode) and the fast lane's repair calls never did. So
// the calls that most need their whole allowance for the ANSWER were the ones spending it on reasoning.
//
// FIXED AT THE FACTORY, the same way `withStopSignal` is: every call from a wrapped runner that does not
// say otherwise is `thinking: false`, so the next planner or repair written is correct without anyone
// remembering. An explicit `thinking: true` from a caller is kept exactly.
//
// PURE — no I/O.

/** A runner whose calls default to `thinking: false`; a caller's explicit value is kept. */
export function withAnswerNotDeliberation<R extends { runTurn(params: P): Promise<T> }, P extends { thinking?: boolean }, T>(runner: R): R {
  return {
    ...runner,
    runTurn: (params: P) => runner.runTurn({ ...params, thinking: typeof params.thinking === 'boolean' ? params.thinking : false }),
  } as R;
}
