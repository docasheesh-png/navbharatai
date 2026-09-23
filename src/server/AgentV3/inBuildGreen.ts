// AgentV3 — IN-BUILD GREEN: a working app is never lost to later edits in the SAME build.
//
// ADMIN 2026-09-18, verbatim: "navbharatai dwara app banne ke baad tutni nahi chahiye!!!!!" — the same
// sentence they wrote on 2026-08-09, which GreenGuard was built to answer. GreenGuard answered it for
// TURNS: a turn that ends green becomes the last known good; a later turn that ends proven-broken is
// rolled back to it. Read from the route (the `decideGreenGuard` call at the end of a build):
//
//     before: { green: hasSnapshot }      ← hasSnapshot = a PREVIOUS build's green snapshot exists
//
// So on the FIRST build of a workspace — the case the admin describes, "4-5 min me app ban jati hai,
// phir 10-20 min aur chalti hai jisme app toot jati hai" — there is nothing to restore FROM. The app
// rendered at minute 2 and was broken at minute 6 by the same turn, and the guard's own principle
// ("a turn can help or do nothing, never harm") could not apply because it only ever compared a turn
// against the turn before it.
//
// THE PRINCIPLE, EXTENDED ONE LEVEL DOWN: a build's OWN first proven render is a last known good too.
//
// WHAT THIS DOES — and what it deliberately does not:
//   • The moment the app is proven to render in a REAL browser during the build (the same judge and
//     the same evidence bar as the late preview check: `analyzePreviewHtml`, `source === 'browser'`,
//     not inconclusive, not server-down), the current file set is saved as the workspace's last known
//     good — to the SAME key GreenGuard already reads at the end of the build. No new store, no new
//     decision logic: the end-of-build restore path consumes it unchanged.
//   • It does NOT freeze writes and it does NOT stop the build. The model keeps working — an app that
//     renders is not necessarily a finished app (a manifest may plan twenty files with eight written).
//     What changes is only the worst case: a later edit that breaks the app now ends with the version
//     that rendered, plus an honest note, instead of a broken app.
//   • It costs ONE browser open per attempt and ZERO model calls, and it never blocks the build: the
//     proof runs beside the loop, and every failure path leaves the build exactly as it was.
//
// 🔒 A RACE, NAMED AND HANDLED: the snapshot must be of the tree that RENDERED. The loop keeps
// writing while the browser is open, so a write during the proof means the bytes on disk are not the
// bytes that were proven. `attemptGuard` compares a write counter before and after; on a change the
// attempt is discarded (recorded, never silent) and a later trigger tries again. A snapshot that was
// never proven is worse than no snapshot — it would be RESTORED as "the working version".
//
// PURE — no I/O, no clock. The route owns the browser, the store and the timeline.

import type { PreviewVerdict } from './PreviewVerify';

/** Kill switch, honouring the project convention: `off` restores the pre-change behaviour exactly. */
export function inBuildGreenEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.AGENTV3_IN_BUILD_GREEN ?? '').trim().toLowerCase() !== 'off';
}

/**
 * Two attempts closer together than this are not two pieces of evidence — the app has not had time to
 * change. Bounds the browser opens a chatty loop (screenshot, console_errors, screenshot…) can cause
 * while the app is still not rendering.
 */
export const MIN_ATTEMPT_GAP_MS = 15_000;

/** What a browser capture must satisfy before it may become a last known good. */
export interface RenderShot {
  source?: 'browser' | 'curl';
}

/**
 * The ONE evidence bar, stated once — the same three refusals the late preview check and
 * `verifyAfterFix` already make:
 *   • a curl capture never runs the app's JavaScript, so its "render" is the static shell (adversarial
 *     review 2026-08-12) — never a proof;
 *   • `inconclusive` is IGNORANCE, not evidence of anything;
 *   • `serverDown` is the machine, not the app.
 * PURE.
 */
export function isProvenGreenRender(shot: RenderShot, verdict: Pick<PreviewVerdict, 'rendered' | 'inconclusive' | 'serverDown'>): boolean {
  if (shot.source !== 'browser') return false;
  if (verdict.inconclusive || verdict.serverDown) return false;
  return verdict.rendered === true;
}

export interface AttemptState {
  enabled: boolean;
  /** The preview URL the build has published, if any. */
  previewUrl: string;
  /** Can this sandbox open a real browser at all? */
  hasBrowser: boolean;
  /** Already proven this build — one snapshot is the guarantee; a second would re-snapshot a mutated tree. */
  proven: boolean;
  inFlight: boolean;
  aborted: boolean;
  /** Epoch ms of the previous attempt, or 0. */
  lastAttemptAt: number;
}

/** Is an attempt worth a browser open right now? PURE. */
export function shouldAttemptInBuildProof(s: AttemptState, now: number): boolean {
  if (!s.enabled) return false;
  if (!s.previewUrl || !s.hasBrowser) return false;
  if (s.proven || s.inFlight || s.aborted) return false;
  if (s.lastAttemptAt > 0 && now - s.lastAttemptAt < MIN_ATTEMPT_GAP_MS) return false;
  return true;
}

/**
 * 🔴 "COULD NOT TELL" WAS THREE DIFFERENT FACTS WEARING ONE NAME (2026-09-19).
 *
 * `inconclusive` collapsed a curl fallback, an unpainted browser snapshot and a dead dev server into
 * ONE line — `IN_BUILD_GREEN_UNCHECKED`, whose message then had to hedge: "no real-browser capture,
 * or the server was down". Those three have nothing in common except our ignorance, and they have
 * completely different fixes: the first is the browser tooling not being installed yet, the second is
 * the app genuinely not having painted, the third is the machine. A report that cannot tell them
 * apart cannot be used to fix any of them — which is exactly the position this check was in.
 *
 * The older sibling of this very proof already did it right: `LAST_CHANCE_PROOF` records
 * `rendered=… · inconclusive=… · serverDown=…` in its detail and has a separate
 * `LAST_CHANCE_PROOF_UNAVAILABLE` for "could not open it at all". This is that discipline, applied to
 * the proof that was written second and inherited none of it.
 */
export type AttemptOutcome =
  | { kind: 'proven' }
  /**
   * A real browser saw a page — but it was our starter template ("Hello World"), because the app's root
   * component had not been rewritten yet (autopsy 3ab93068). Never a last known good: protecting it
   * would make a later restore hand the user back a blank template as "your working app".
   */
  | { kind: 'starter' }
  /** The app rendered, but a file was written while the browser was open — the bytes are not the proof. */
  | { kind: 'raced' }
  /** A real browser looked and the page carried a defect signal (an error overlay, an empty root). */
  | { kind: 'not-rendered' }
  /** The capture never ran the app's JavaScript (the curl fallback) — the browser was not available. */
  | { kind: 'no-browser' }
  /** The host or the dev server answered with its own error page. The machine, not the app. */
  | { kind: 'server-down' }
  /** A real browser looked and nothing had painted within its wait. Ignorance, not a defect. */
  | { kind: 'not-painted' }
  /**
   * The render WAS proven, but there was nothing to snapshot — collecting the workspace failed and the
   * build had captured no writes of its own. The one outcome where the app is fine and the protection
   * still did not happen, so it must never be reported as `proven`.
   */
  | { kind: 'nothing-to-save' }
  /**
   * The attempt never came back — its own budget ran out, or opening the app threw. We learned
   * NOTHING, and until 2026-09-19 that was recorded nowhere at all (see `inBuildGreenNote`).
   */
  | { kind: 'gave-up'; why?: string };

/**
 * Decide what a finished attempt means. `writesBefore`/`writesAfter` are the write counter read
 * immediately before the browser opened and immediately after the file set was collected. PURE.
 */
export function attemptOutcome(input: {
  shot: RenderShot;
  verdict: Pick<PreviewVerdict, 'rendered' | 'inconclusive' | 'serverDown'>;
  writesBefore: number;
  writesAfter: number;
}): AttemptOutcome {
  // Order is the point: a capture that never ran the app's JavaScript makes every judgement below it
  // meaningless, and `analyzePreviewHtml` returns `serverDown` from its own early exit, never beside
  // a paint verdict. Each branch is one fact, so each can be reported as one fact.
  if (input.shot.source !== 'browser') return { kind: 'no-browser' };
  if (input.verdict.serverDown) return { kind: 'server-down' };
  if (input.verdict.inconclusive) return { kind: 'not-painted' };
  if (!input.verdict.rendered) return { kind: 'not-rendered' };
  if (input.writesAfter !== input.writesBefore) return { kind: 'raced' };
  return { kind: 'proven' };
}

/**
 * How long ONE in-build proof may take before it is abandoned. Deliberately SMALLER than
 * `browseUrl`'s own worst case (a 60 s wait for the browser tooling + a 30 s browse command + a 30 s
 * curl fallback), and that is a trade rather than an oversight: the write counter is read before the
 * browser opens and again after the files are collected, so the budget IS the race window. A longer
 * budget would mostly buy `raced` outcomes on a busy loop. So the attempt is cut short — and, since
 * 2026-09-19, it SAYS so instead of disappearing.
 */
export const IN_BUILD_PROOF_BUDGET_MS = 35_000;

/**
 * The code that says *"a real browser opened this app and it rendered"* — written HERE, read by the
 * evidence ledger (`renderProof.ts`).
 *
 * 🔴 It is a shared constant rather than a literal in two files because until 2026-09-21 this proof
 * reached NO reader at all. `provenFromTimeline` answered "did the app render?" from `APP_RENDERED`
 * alone, and this pass — which refuses a curl capture outright (`shot.source !== 'browser'` ⇒
 * `no-browser`), so its `proven` outcome is exactly as strong — recorded its proof and was never
 * asked. One actor proving a fact and another verdict denying it, in the same report, is the whole of
 * the EVIDENCE LEDGER root cause.
 *
 * ⚠️ ONLY the `proven` outcome carries it. `raced` also saw a render, but a file changed while the
 * browser was open, so the tree that rendered is not the tree on disk — the distinction this pass
 * exists to make, and it must not be blurred by the ledger.
 */
export const IN_BUILD_GREEN_CODE = 'IN_BUILD_GREEN' as const;

/**
 * The admin-only timeline line for each outcome. Only `proven` is worth a user-facing word.
 *
 * 🔴 `autoResolved` IS NOT DECORATION, AND IT USED TO BE WRONG ON EVERY FAILURE. It was `true` for
 * every outcome, including `raced`, `not-rendered` and the whole blind family — the same shape as the
 * `JOURNEY_PASSED` bug this repo has already paid for once, where a check that found nothing recorded
 * a passing code whose own message said it had not run. Nothing is being resolved when a proof fails,
 * so only `proven` claims it. Severity stays `info` for all of them, so this changes NO count and NO
 * gate: `shippingIssueCount` filters on `error` / `warning` and never reads an `info` line.
 */
export function inBuildGreenNote(outcome: AttemptOutcome, facts: { elapsedMs: number; fileCount?: number }): {
  code: string; severity: 'info'; message: string; autoResolved: boolean; detail?: string;
} {
  const secs = Math.max(0, Math.round(facts.elapsedMs / 1000));
  switch (outcome.kind) {
    case 'proven':
      return {
        code: IN_BUILD_GREEN_CODE, severity: 'info', autoResolved: true,
        message: `The app rendered in a real browser ${secs}s into this build — ${facts.fileCount ?? 0} file(s) recorded as the last known good. If a later step breaks the app, this version is what comes back.`,
      };
    case 'starter':
      return {
        code: 'IN_BUILD_GREEN_NOT_YET', severity: 'info', autoResolved: false,
        message: `Opened the app ${secs}s into this build; the page was still the starter template, not the app being built. Nothing recorded.`,
        detail: 'The entry file was byte-identical to the seeded starter and the page showed its heading. A starter is never saved as the last known good.',
      };
    case 'raced':
      return {
        code: 'IN_BUILD_GREEN_RACED', severity: 'info', autoResolved: false,
        message: `The app rendered ${secs}s into this build, but a file was written while it was being opened, so the state on disk is not the state that was proven — no snapshot taken; will try again.`,
      };
    case 'not-rendered':
      return {
        code: 'IN_BUILD_GREEN_NOT_YET', severity: 'info', autoResolved: false,
        message: `Opened the app ${secs}s into this build; it had not rendered yet. Nothing recorded.`,
      };
    case 'not-painted':
      return {
        code: 'IN_BUILD_GREEN_UNCHECKED', severity: 'info', autoResolved: false,
        message: `A real browser opened the app ${secs}s into this build and nothing had painted before it gave up waiting. Nothing recorded — and this is NOT evidence the app is broken.`,
        detail: 'The capture was a real browser; the page simply had no content yet. A later trigger looks again.',
      };
    case 'no-browser':
      return {
        code: 'IN_BUILD_GREEN_UNCHECKED', severity: 'info', autoResolved: false,
        message: `Looked at the app ${secs}s into this build, but the capture came back WITHOUT a real browser, so nothing could be proven. Nothing recorded.`,
        detail: 'The page was fetched without running its JavaScript (the curl fallback), which is what happens while the '
          + "sandbox's browser tooling is still installing or failed to install. A single-page app looks empty there whether it works or not.",
      };
    case 'nothing-to-save':
      return {
        code: 'IN_BUILD_GREEN_UNCHECKED', severity: 'info', autoResolved: false,
        message: `The app rendered ${secs}s into this build, but there were no files to record as the last known good, so nothing was protected.`,
        detail: 'Collecting the workspace did not return a file and the build had captured no writes of its own — '
          + 'the render is real, the snapshot is not. Reported separately because "it rendered" and "it is protected" are different facts.',
      };
    case 'server-down':
      return {
        code: 'IN_BUILD_GREEN_UNCHECKED', severity: 'info', autoResolved: false,
        message: `Looked at the app ${secs}s into this build and the server was not answering. Nothing recorded — that is the machine, not the app.`,
        detail: 'The host or the dev server returned its own error page, so the app was never reached.',
      };
    default:
      return {
        code: 'IN_BUILD_GREEN_UNCHECKED', severity: 'info', autoResolved: false,
        message: `The in-build proof could not complete ${secs}s into this build, so it learned nothing. Nothing recorded — a limit of the check, never a verdict about the app.`,
        detail: (outcome.kind === 'gave-up' && outcome.why ? `${outcome.why} · ` : '')
          + `budget ${Math.round(IN_BUILD_PROOF_BUDGET_MS / 1000)}s. Until 2026-09-19 this case recorded NOTHING AT ALL, so a proof that `
          + 'timed out and a proof that never ran looked identical in the report.',
      };
  }
}

/** What the USER is told the moment their app is first protected. One line, once. */
export function inBuildGreenNarration(): string {
  return '🛡️ Your app rendered — this working version is now protected. If anything later breaks it, this is what comes back.';
}

/**
 * Did the last known good come from THIS build rather than an earlier turn? Decides which honest
 * sentence the restore carries: "your change was not kept" is wrong for a first build whose own
 * earlier state was restored. PURE.
 */
export function snapshotIsFromThisBuild(snapshotAt: number | undefined, buildStartedAt: number): boolean {
  return typeof snapshotAt === 'number' && Number.isFinite(snapshotAt) && snapshotAt >= buildStartedAt;
}
