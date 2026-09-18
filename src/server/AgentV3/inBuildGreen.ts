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

export type AttemptOutcome =
  | { kind: 'proven' }
  /** The app rendered, but a file was written while the browser was open — the bytes are not the proof. */
  | { kind: 'raced' }
  | { kind: 'not-rendered' }
  | { kind: 'inconclusive' };

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
  if (input.shot.source !== 'browser' || input.verdict.inconclusive || input.verdict.serverDown) return { kind: 'inconclusive' };
  if (!input.verdict.rendered) return { kind: 'not-rendered' };
  if (input.writesAfter !== input.writesBefore) return { kind: 'raced' };
  return { kind: 'proven' };
}

/** The admin-only timeline line for each outcome. Only `proven` is worth a user-facing word. */
export function inBuildGreenNote(outcome: AttemptOutcome, facts: { elapsedMs: number; fileCount?: number }): {
  code: string; severity: 'info'; message: string; autoResolved: true;
} {
  const secs = Math.max(0, Math.round(facts.elapsedMs / 1000));
  switch (outcome.kind) {
    case 'proven':
      return {
        code: 'IN_BUILD_GREEN', severity: 'info', autoResolved: true,
        message: `The app rendered in a real browser ${secs}s into this build — ${facts.fileCount ?? 0} file(s) recorded as the last known good. If a later step breaks the app, this version is what comes back.`,
      };
    case 'raced':
      return {
        code: 'IN_BUILD_GREEN_RACED', severity: 'info', autoResolved: true,
        message: `The app rendered ${secs}s into this build, but a file was written while it was being opened, so the state on disk is not the state that was proven — no snapshot taken; will try again.`,
      };
    case 'not-rendered':
      return {
        code: 'IN_BUILD_GREEN_NOT_YET', severity: 'info', autoResolved: true,
        message: `Opened the app ${secs}s into this build; it had not rendered yet. Nothing recorded.`,
      };
    default:
      return {
        code: 'IN_BUILD_GREEN_UNCHECKED', severity: 'info', autoResolved: true,
        message: `Opened the app ${secs}s into this build but could not tell whether it rendered (no real-browser capture, or the server was down). Nothing recorded.`,
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
