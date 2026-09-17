// AgentV3 — A MEASUREMENT BEATS A PREDICTION ABOUT THE SAME THING.
//
// 🔴 ROOT CAUSE (autopsy, build e706e068, 2026-09-17 — a School ERP on the free Weak engine).
//
// The readiness gate said, at t+1440s:
//
//     1 unresolved import(s) — THE BUILD WILL FAIL: App.tsx -> ./components/TransportRequest
//
// Seventy-two seconds later, at t+1512s, the platform RAN the production build:
//
//     PROD_BUILD_OK — "The production build succeeded — this app is ready to publish and to package."
//
// Same file tree, no writes in between. One of those is a static PREDICTION about what `npm run build`
// would do; the other is the recorded result of actually doing it. Nothing reconciled them, so the
// falsified prediction went on to count as a build-breaking blocker, the release gate went RED, the
// verdict flipped to NOT ok, and the build was made free — while the app rendered in a real browser
// and its production bundle sat on disk.
//
// 🔑 THE RULE, stated once: when we have RUN the thing a finding merely predicted, the run wins.
// This is one named door of the shared EVIDENCE LEDGER that `CLAUDE.md` records as an open root cause
// (autopsy 697b38ee) — the class is unchanged; this specific contradiction can no longer happen.
//
// ⚠️ NARROW ON PURPOSE, in three independent ways, because a gate that forgives too much is worse
// than one that nags:
//   1. Only a blocker whose CLAIM IS ABOUT `npm run build` is eligible (see `predictsBuildFailure`).
//      "2 fake/incomplete code issue(s)" is NOT about building and is never touched — that one is
//      about whether we finished the work, and a production build compiles a placeholder happily.
//   2. Only a production build that genuinely RAN and exited 0 clears anything. `PROD_BUILD_FAILED`
//      and `PROD_BUILD_UNVERIFIED` clear nothing — an absence of proof is not proof.
//   3. Only a prediction made BEFORE the build ran is cleared. A finding recorded afterwards is
//      describing a tree the build never saw.
//
// Nothing is hidden: a cleared blocker stays on the timeline as resolved, beside one honest line
// saying the real build contradicted it.
//
// PURE — no I/O, no clock. Never throws.

/**
 * Is this readiness blocker a PREDICTION that `npm run build` will fail?
 *
 * Matched against the exact sentences `Readiness.ts` composes, which are the only two findings in the
 * whole suite that forecast the production build:
 *   • `N unresolved import(s) — the build will fail: <sample>`
 *   • `N server-only Node builtin import(s) in front-end code — these break the browser build: <sample>`
 *
 * ⚠️ Matched on the CLAIM, not on a code or a count, because that is what makes the rule defensible:
 * the only findings a successful build may overrule are the ones that said it would not succeed.
 * A new finding that forecasts the build must add its wording here deliberately — silence is the safe
 * default, since an unmatched blocker simply keeps standing.
 */
export function predictsBuildFailure(message: string | null | undefined): boolean {
  const m = String(message ?? '');
  if (!m) return false;
  if (/\bthe build will fail\b/i.test(m)) return true;
  if (/\bbreak the browser build\b/i.test(m)) return true;
  return false;
}

/** What the production build gate concluded, in the only two shapes that matter here. */
export type ProdBuildOutcome = 'PROD_BUILD_OK' | 'PROD_BUILD_FAILED' | 'PROD_BUILD_UNVERIFIED' | string;

/**
 * May a production-build result clear build-failure predictions?
 *
 * ONLY an `ok` verdict that actually RAN. `judgeProdBuild` already separates "it failed" from "we
 * could not check" — conflating the second with success here would turn a missing sandbox into a
 * clean bill of health, which is the fake-success this whole area exists to prevent.
 */
export function prodBuildOverrulesPredictions(code: ProdBuildOutcome, ran: boolean): boolean {
  return ran === true && code === 'PROD_BUILD_OK';
}

/**
 * The one line recorded when a real build overrules a forecast. Names BOTH sides, so the report
 * explains the contradiction instead of quietly dropping one half of it.
 */
export function overruledByRealBuildMessage(count: number): string {
  const n = Math.max(1, Math.floor(count) || 1);
  return `${n} readiness finding(s) predicted that the production build would fail. It was then RUN and it `
    + `SUCCEEDED, so the prediction is superseded by the result — the finding is kept on the timeline as `
    + `resolved rather than counted against this app.`;
}
