// AgentV3 — A RUN-PROVEN APP IS NEVER FLIPPED TO "NOT BUILT" BY A VERDICT THAT ONLY READ THE CODE.
//
// 🔴 THE CLASS (admin, 2026-09-17, verbatim: "ek bar app ban jati hai, preview chalta bhi hai. par
// achanak se build fails aur bill = 0₹ — isko specially fix karna hai"). Autopsy e706e068: the
// School ERP rendered in a real browser (`RENDER_RESCUE`, 10:41:36), its production bundle compiled
// (`PROD_BUILD_OK`, 10:42:47), and 81 seconds later the release gate — counting static readiness
// findings about three stray files nothing imported — went RED, the verdict was flipped to NOT ok,
// and the user read "3 things are still broken … You have NOT been charged" beside a working login
// page. Autopsies 697b38ee and 4efab9d7 are the same shape with different static findings, and the
// admin's ruling on 4efab9d7 is the standing law: *"app bani = preview chala. agar preview chala gaya
// to ₹0 charge karoge to aise to mai barbad ho jaunga."*
//
// Each earlier fix closed one DOOR: a provider error is not an app finding (isAppFinding); a
// prediction about `npm run build` is superseded by running it (buildFailurePrediction.ts); a heal
// that re-judged READY clears the stale blocker (recordReadinessRecovery). This module closes the
// ROOM. Every late flip of `ok → false` in the route — the release gate's RED, the final syntax
// re-verify, the reviewer's unresolved [CRITICAL]s — now asks ONE question first: has this app
// already been proven to run, by evidence stronger than the finding that wants to fail it?
//
// 🔑 WHAT COUNTS AS PROOF, and what does not:
//   • A REAL browser rendered it this build (`shot.source === 'browser'`; a curl fallback's empty
//     shell proves nothing, the same rule Green Freeze applies), with no actionable console error.
//   • The production build, if it RAN, succeeded. `PROD_BUILD_FAILED` is a run that says the app
//     is broken and it VETOES; `not-run` (no build script, no time) neither helps nor hurts — the
//     render alone is then the evidence, which is exactly the admin's rule.
//   • No RUNTIME check failed: a page route that failed to render, a user journey that failed, a
//     deterministic runtime-crash proof (a Rules-of-Hooks violation renders once and white-screens on
//     the next interaction — the RENDER_RESCUE_BLOCKED case). Any of these is evidence the app does
//     not work, and a static finding beside it may well be the reason. The flip stands.
//   • The delivery was not a REFUSAL (a rendered golden template after "I will not build this" is
//     not the user's app), and the build was not stopped.
//
// ⚠️ THIS CHANGES THE VERDICT AND THE BILL, NOT THE FINDINGS. A held verdict keeps every blocker on
// the timeline, on the user's health card and in the gate's own RED sentence: "built, working,
// charged — and here are N things to fix before you ship it" is the honest statement. What it
// refuses to say is "not built", "not charged", about an app on the screen. The other direction —
// a static finding un-flipping a proven-broken app — cannot happen here by construction, because
// this only ever HOLDS an `ok: true`; it never creates one.
//
// PURE — no I/O, no clock. Never throws.

export type ProdBuildOutcome = 'ok' | 'failed' | 'not-run';

export interface RunEvidence {
  /** A real browser (not a curl fallback) rendered the app this build, with a clean console. */
  browserRendered: boolean;
  /** `judgeProdBuild`'s own verdict, or `not-run` when it never ran. Never a guess. */
  prodBuild: ProdBuildOutcome;
  /** The release gate's own runtime evidence — a `failed` in any of these is proof the app is broken. */
  previewFailed: boolean;
  pagesFailed: boolean;
  journeyFailed: boolean;
  /** `buildDiag.hasRuntimeCrashBlocker()` — the deterministic "crashes at runtime" proof. */
  runtimeCrashBlocker: boolean;
  /**
   * The model declined; whatever rendered is not the user's app. Read from the model's OWN answer,
   * captured once before the platform rewrites the summary (`turnAnswer.ts`) — reading
   * `result.summary` at the flip asks the question of our sentence, not the model's.
   */
  deliveryRefused: boolean;
  /** The build was aborted (user stop, watchdog, cost stop). */
  stopped: boolean;
}

export interface RunProof {
  /** True when the app has been proven to run by evidence a static finding cannot outrank. */
  proven: boolean;
  /** One line naming the evidence (proven) or the veto (not proven), for the admin timeline. */
  reason: string;
}

/**
 * Has this app already been proven to RUN?
 *
 * Every input defaults to the conservative side: an omitted or non-boolean flag reads as "not
 * proven" / "vetoed", so a caller that forgets a field gets today's behaviour (the flip), never a
 * held verdict on missing evidence.
 */
export function runProvenApp(ev: Partial<RunEvidence> | null | undefined): RunProof {
  const e = ev ?? {};
  if (e.browserRendered !== true) return { proven: false, reason: 'no real-browser render this build' };
  if (e.stopped === true) return { proven: false, reason: 'the build was stopped' };
  if (e.deliveryRefused === true) return { proven: false, reason: 'the delivery was a refusal, not the app' };
  if (e.prodBuild === 'failed') return { proven: false, reason: 'the production build RAN and failed' };
  if (e.previewFailed === true) return { proven: false, reason: 'a later preview check found it broken' };
  if (e.pagesFailed === true) return { proven: false, reason: 'a page route failed to render in a real browser' };
  if (e.journeyFailed === true) return { proven: false, reason: 'a real user journey failed' };
  if (e.runtimeCrashBlocker === true) return { proven: false, reason: 'a deterministic runtime-crash defect stands' };
  const build = e.prodBuild === 'ok' ? ' and its production build succeeded' : '';
  return { proven: true, reason: `a real browser rendered it with a clean console${build}` };
}

/** Which late flip asked, so the admin line says WHAT wanted to fail the build. */
export type LateFlip = 'release-gate-red' | 'final-syntax-error' | 'review-critical';

const FLIP_LABEL: Record<LateFlip, string> = {
  'release-gate-red': 'the release gate was RED on static findings',
  'final-syntax-error': 'the final syntax re-verify flagged a file that does not parse',
  'review-critical': 'the reviewer left [CRITICAL] findings it could not verify as fixed',
};

/**
 * The admin-only line recorded when a late flip was HELD. Names both sides — what wanted to fail the
 * build and what proved it runs — so the report explains the contradiction rather than dropping one
 * half of it. The findings themselves stay on the timeline untouched.
 */
export function verdictHeldMessage(flip: LateFlip, proof: RunProof, count: number): string {
  const n = Math.max(1, Math.floor(count) || 1);
  return `The verdict was kept at OK: ${FLIP_LABEL[flip]} (${n} finding(s)), but ${proof.reason} — `
    + 'a finding that only read the code cannot outrank a run. The finding(s) stay listed as things to fix; '
    + 'the app is built, working, and charged.';
}
