// AgentV3 — runtime-error auto-fix loop (R4 §2.3).
//
// A build can compile and even render, yet still throw runtime errors a static check never
// reveals (an undefined call, a failed fetch, a React render crash). The browser daemon already
// CAPTURES these (getConsoleErrors); this module turns detection into a closed loop: after a
// build, surface the captured runtime errors back to a repair pass that fixes them, re-runs, and
// re-verifies — and reports an honest WARNING if any remain. Pure, deterministic helpers here;
// the impure orchestration (capture → repair runner → re-capture) lives in the build route.

import { locationTag } from '../AppMakerLab/intelligence/LogIntelligenceEngine';
import { renderRepairGuidance } from './RuntimeErrorClassify';
import { envFlag } from '../lib/envFlag';

export interface RuntimeError {
  t: number;
  kind: string;
  text: string;
}

/**
 * The loop is OFF by default and enabled with AGENTV3_AUTOFIX=on. It runs an extra (paid) repair
 * pass, so — like escalation — it stays opt-in until the admin turns it on, never a surprise cost.
 */
export function autoFixEnabled(): boolean {
  return envFlag('AGENTV3_AUTOFIX');
}

/**
 * The post-build REVIEWER's [CRITICAL]-finding repair (C9) is ON by default — unlike the runtime
 * auto-fix loop above, which stays opt-in. Why the split (build report 2026-07-07): the reviewer
 * found a real [CRITICAL] on a successful build, but the repair was gated on the SAME opt-in
 * AGENTV3_AUTOFIX env (off in prod) — so v5.0 diagnosed its own defect and then knowingly shipped it,
 * which breaks the "complete app, perfectly" bar. This pass is tightly bounded (fires only when the
 * reviewer reported criticals on an OK build, one pass, 120s hard cap, deadline-headroom gated), so
 * its cost is small and only ever spent when something is genuinely broken.
 * Kill switch: AGENTV3_REVIEWER_AUTOFIX=off.
 */
export function reviewerAutoFixEnabled(): boolean {
  return process.env.AGENTV3_REVIEWER_AUTOFIX !== 'off';
}

/**
 * EXTENDS the C9 reviewer auto-fix to also repair FUNCTIONAL [WARNING] findings (not just
 * [CRITICAL]). OFF by default (canary — autopsy 2026-07-11): the Notes report's real bugs
 * ("auto-focus broke", "sort ignores edits", "isAtLimit blocks Add") were all warnings, so C9
 * skipped them and they shipped. Flip AGENTV3_REVIEW_AUTOFIX_WARNINGS=on after a few canary builds
 * prove the extra repair is clean. Only functional warnings are fixed (selectAutoFixableWarnings
 * filters out cosmetic/a11y/style), and it rides the SAME single bounded C9 repair pass — no new
 * cost path, never blocks a build.
 */
export function reviewerWarningAutoFixEnabled(): boolean {
  return envFlag('AGENTV3_REVIEW_AUTOFIX_WARNINGS');
}

export interface ReviewerAutofixRecord {
  severity: 'info' | 'warning';
  code: 'REVIEWER_AUTOFIX' | 'REVIEWER_AUTOFIX_INCOMPLETE';
  message: string;
  autoResolved: boolean;
}

/**
 * The HONEST diagnostics record for a reviewer-autofix pass.
 *
 * ROOT CAUSE (deep-test 2026-07-18): the build route emitted "Auto-fixed ${label} from the reviewer"
 * UNCONDITIONALLY after the repair runner returned — it never checked whether the repair actually
 * succeeded. On a build whose repair call FAILED (a duplicate-tool 400 killed the whole provider chain),
 * the report still claimed "✅ Auto-fixed 3 critical issue(s)" while those 3 criticals were STILL in the
 * shipped app, and the build stayed ok:true — a fake success (rule 5). This makes the record tell the
 * truth: only a SUCCESSFUL pass says "Auto-fixed"; a failed pass says the findings MAY STILL BE PRESENT
 * and is left UNRESOLVED (so it shows up honestly as an unresolved problem, not a green checkmark). Pure.
 */
export function reviewerAutofixOutcome(fixOk: boolean, label: string): ReviewerAutofixRecord {
  return fixOk
    ? { severity: 'info', code: 'REVIEWER_AUTOFIX', message: `Auto-fixed ${label} from the reviewer`, autoResolved: true }
    : { severity: 'warning', code: 'REVIEWER_AUTOFIX_INCOMPLETE', message: `Reviewer auto-fix did NOT complete — ${label} may still be present in the app.`, autoResolved: false };
}

/**
 * The HONEST user-facing summary for a build that finished with reviewer-CRITICAL findings that were
 * NOT verifiably fixed (the auto-fix pass never ran, failed, or was cut off by the wall-clock cap).
 *
 * ROOT CAUSE (deep-test 2026-07-21, SaaS-dashboard "fix network error"): the architect captured an
 * optimistic `{ ok:true, summary:"✅ No runtime errors — Console is clean" }` into `buildResultRef`
 * BEFORE the reviewer ran; the reviewer then found 2 [CRITICAL]s (a placeholder API URL that IS the
 * reported network error, + a wrong context null-check) and the C9 auto-fix was cut off mid-repair by
 * the 120s advisory cap ("🔧 fixing them now…"). Because nothing updated the already-captured verdict,
 * the deadline finalizer shipped `ok:true` + the "console clean" lie AND billed ₹125 for a broken app —
 * the failed-build "working app or free" guard never fired (it keys on `!result.ok`). Flipping the
 * verdict to NOT-ok when criticals remain unresolved makes the summary honest AND makes billing free
 * (the existing guard), and — on the finalizer path — keeps the build RESUMABLE so the next window
 * actually fixes the criticals. WHITE-LABEL: never names a provider/model (the specific findings stay
 * in the ADMIN-only diagnostics); the user only sees the honest count + the action. Pure.
 */
export function reviewCriticalUnresolvedSummary(count: number): string {
  const n = Math.max(1, count);
  const one = n === 1;
  return (
    `Your app is built and saved, but a final code review found ${n} critical issue${one ? '' : 's'} that ` +
    `${one ? "isn't" : "aren't"} resolved yet — so it isn't fully working. You have NOT been charged for ` +
    `this build. Reply "fix ${one ? 'it' : 'them'}" (or "continue") and I'll resolve ${one ? 'it' : 'them'} and finish.`
  );
}

/**
 * How long the C9 reviewer-critical REPAIR pass may run, SCALED to how many findings it must fix and
 * CLAMPED to the wall-clock headroom left. Pure + unit-tested (same idiom as reviewerBudgetMs).
 *
 * ROOT CAUSE (admin dashboard autopsy 2026-08-02): "Reviewer critical not resolved" was the TOP failure
 * pattern across user-submitted reports (5 of 17 failed, 29%). The repair pass had a FLAT 120s cap no
 * matter how many criticals it had to fix or how much build time remained — a 3-critical repair on the
 * cheap-coder heal chain routinely died mid-edit at 120s, and the criticals shipped unresolved. Bigger
 * repairs now get more time (up to 5 min) when the build actually HAS that time, and the cap shrinks
 * when the wall clock is nearly spent — so a repair is neither starved with headroom to spare, nor
 * started so large it gets cut off by the deadline (the exact "cut off mid-repair" failure recorded in
 * reviewCriticalUnresolvedSummary's history).
 */
export function reviewerFixBudgetMs(itemCount: number, headroomMs: number): number {
  const BASE = 120_000, PER_ITEM = 60_000, MIN = 60_000, MAX = 300_000, SAFETY = 30_000;
  const items = Number.isFinite(itemCount) && itemCount > 0 ? Math.floor(itemCount) : 1;
  const scaled = Math.min(BASE + Math.max(0, items - 1) * PER_ITEM, MAX);
  if (!Number.isFinite(headroomMs)) return scaled;             // no wall-clock cap → the scaled budget
  return Math.max(MIN, Math.min(scaled, headroomMs - SAFETY)); // else keep a 30s wall-clock safety margin
}

/**
 * Should the C9 repair get ONE more attempt after a failed pass? Pure. Bounds (all three protect the
 * "never loop / never overlap" invariants):
 *  - max 2 attempts total — a structural failure won't converge by hammering;
 *  - NEVER after a TIMEOUT — the raced-out runner may still be editing files in the background, and a
 *    second concurrent runner editing the same workspace is a corruption risk (the budget fix above is
 *    what attacks the timeout class);
 *  - only with real headroom (> 150s) — a retry that will itself be cut off just burns the wall clock.
 */
export function reviewerFixShouldRetry(attempt: number, headroomMs: number, timedOut: boolean): boolean {
  if (attempt >= 2) return false;
  if (timedOut) return false;
  if (!Number.isFinite(headroomMs)) return true;
  return headroomMs > 150_000;
}

/** Max repair attempts per build. Default 1, hard-capped at 3 so a flaky error can't loop forever. */
export function autoFixMaxAttempts(): number {
  const raw = Number(process.env.AGENTV3_AUTOFIX_ATTEMPTS);
  if (!Number.isInteger(raw) || raw < 1) return 1;
  return Math.min(raw, 3);
}

// Noise that is not a real app defect — these should never trigger a repair pass.
const NOISE = [
  /favicon\.ico/i,
  /\.map(\b|$)/i, // sourcemap fetch failures
  /ResizeObserver loop/i, // benign browser warning
  /\[vite\] connecting/i,
  /\[vite\] connected/i,
  /Download the React DevTools/i,
  /DevTools failed to load source map/i,
  /Slow network is detected/i,
  /was preloaded using link preload but not used/i,
  /\[HMR\]/i, // hot-module-reload chatter
];

// M3-S3.1 — signatures that mean the RUNNING app actually crashed (white-screen / thrown render error /
// infinite loop), as opposed to a recoverable warning or console chatter. Used to tell a genuinely-broken
// preview apart from benign noise, so the "really works" verdict and the repair pass focus on real crashes.
const FATAL_RUNTIME_RE = [
  /cannot read (?:properties|property) of (?:undefined|null)/i,
  /\bis not a function\b/i,
  /\bis not defined\b/i, // ReferenceError
  /maximum update depth exceeded/i, // infinite render loop
  /rendered (?:more|fewer) hooks than/i, // Rules-of-Hooks crash
  /change in the order of hooks/i,
  /objects are not valid as a react child/i,
  /too many re-?renders/i,
  /minified react error/i, // prod React invariant
  /uncaught (?:typeerror|referenceerror|rangeerror)/i,
  /cannot access '[^']*' before initialization/i,
  /converting circular structure to json/i,
];

/**
 * True when a single runtime-error text is an app-CRASHING error (a real defect), not benign console
 * noise. Pure — noise-filtered first, then matched against the fatal signatures. M3-S3.1.
 */
export function isFatalRuntimeError(text: string): boolean {
  const t = String(text || '');
  if (!t.trim()) return false;
  if (NOISE.some((re) => re.test(t))) return false;
  return FATAL_RUNTIME_RE.some((re) => re.test(t));
}

/** How many of the captured runtime errors are app-crashing (real crashes, not chatter). Pure. */
export function fatalRuntimeErrorCount(errors: RuntimeError[]): number {
  const list = Array.isArray(errors) ? errors : [];
  return list.filter((e) => e && isFatalRuntimeError(e.text)).length;
}

/**
 * Keep only actionable runtime errors — drop known-benign noise and de-duplicate by text, so the
 * repair pass focuses on real defects. Non-array input yields an empty list (never throws).
 */
export function filterActionableErrors(errors: unknown): RuntimeError[] {
  if (!Array.isArray(errors)) return [];
  const seen = new Set<string>();
  const out: RuntimeError[] = [];
  for (const e of errors) {
    if (!e || typeof e !== 'object') continue;
    const text = typeof (e as RuntimeError).text === 'string' ? (e as RuntimeError).text.trim() : '';
    if (!text) continue;
    if (NOISE.some((re) => re.test(text))) continue;
    const key = text.slice(0, 200);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      t: typeof (e as RuntimeError).t === 'number' ? (e as RuntimeError).t : 0,
      kind: typeof (e as RuntimeError).kind === 'string' ? (e as RuntimeError).kind : 'error',
      text,
    });
  }
  return out;
}

/** Format the captured errors as a compact, readable list (capped) for a prompt or a message. */
export function formatRuntimeErrors(errors: RuntimeError[], max = 20): string {
  // P-AI.11 — append a parsed file:line:col + type hint (when extractable from the error text) so
  // the repair pass can jump straight to the failing location instead of re-deriving it.
  return errors.slice(0, max).map((e) => `- [${e.kind}] ${e.text}${locationTag(e.text)}`).join('\n');
}

/**
 * The repair instruction handed to a Claude-first runner on the SAME workspace. It tells the agent
 * exactly what is broken at runtime and to fix → reload → re-verify, without rebuilding from scratch.
 */
export function buildRepairPrompt(errors: RuntimeError[]): string {
  // B5 — hand the repair pass root-cause GROUPED guidance (crash-class first, each with a targeted hint
  // and the recipe to reach for) so it fixes the class, not just the symptom, and converges faster.
  const guidance = renderRepairGuidance(errors.map((e) => e.text));
  return [
    'The app you just built has RUNTIME errors captured in the browser while it was running',
    '(these do not show up in a successful build/compile). Fix them now without rebuilding from',
    'scratch — make the smallest targeted edits that resolve each one.',
    '',
    ...(guidance ? ['Grouped by likely root cause — fix the crash-class groups first:', '', guidance, ''] : []),
    'All captured errors (with a file:line hint where extractable):',
    formatRuntimeErrors(errors),
    '',
    'Steps: locate the cause with grep/read_file, apply a surgical edit_file fix, then RELOAD the',
    'preview and call console_errors again to confirm the errors are gone. Do not claim success',
    'until the runtime errors are actually cleared. If an error is benign or external (e.g. a',
    'third-party request you do not control), say so explicitly rather than forcing a change.',
  ].join('\n');
}

/** Honest warning shown when some runtime errors remain after the repair budget is spent. */
export function autoFixWarning(errors: RuntimeError[]): string {
  return [
    `⚠️ ${errors.length} runtime error(s) may still remain after auto-fix:`,
    formatRuntimeErrors(errors, 10),
    'The app was built, but please review these — they were detected in the browser at runtime.',
  ].join('\n');
}

/**
 * The HONEST runtime-verification verdict, recorded durably to the build diagnostics (so it folds into
 * the shipped health card) instead of a one-off narration line.
 *
 * ROOT CAUSE (rule 5 — the report must tell the truth): the loop treated an EMPTY console-error capture
 * as "ran clean", but an empty result also happens when the browser console could NOT be captured at all
 * (no live preview session / a stub sandbox) — so "runtime UNCHECKED" was silently reported as
 * "runtime clean", and residual errors after the repair budget were only an ephemeral narration line that
 * never reached the health card. `captured` (from the actuator) distinguishes "checked & clean" from
 * "couldn't check", and these records make each of the three real outcomes honest and durable. Pure.
 *
 * Shape matches BuildDiagnostics.record's BuildIssue (phase 'autofix'); kept structural to avoid a
 * circular import. All are advisory (warning/info) — the runtime loop never blocks a build.
 */
export interface RuntimeVerifyRecord {
  phase: 'autofix';
  severity: 'info' | 'warning';
  code: 'RUNTIME_VERIFIED' | 'RUNTIME_UNCHECKED' | 'RUNTIME_ERRORS_REMAIN';
  message: string;
  autoResolved: boolean;
}

/** The app ran in a real browser session and no actionable console errors remained — an honest positive. */
export function runtimeVerifiedRecord(): RuntimeVerifyRecord {
  return {
    phase: 'autofix',
    severity: 'info',
    code: 'RUNTIME_VERIFIED',
    message: 'Runtime verified — the app ran in the browser with no actionable console errors after build.',
    autoResolved: true,
  };
}

/**
 * The browser console could not be captured, so runtime was NOT verified — never a clean guarantee.
 *
 * `previewRendered` exists because the flat version of this record CONTRADICTED the rest of the report
 * (Shiv Medical Store, 2026-08-10). That build opened the app in a real browser, recorded
 * GREEN_GUARD_SAVE ("opened in a real browser and rendered") and told the user "confirmed it loads
 * successfully… with no console errors" — while this record simultaneously said the browser console
 * "could not be captured (no live preview session)". Both cannot be true, and a report that argues with
 * itself teaches the admin to trust none of it.
 *
 * The two questions are different and must be answered separately: DOES IT RUN was answered — the app
 * was seen rendering — while WERE THERE CONSOLE ERRORS was not. Saying so is honest; collapsing them
 * into "runtime NOT verified" is not, and neither is claiming clean.
 */
export function runtimeUncheckedRecord(opts?: { previewRendered?: boolean }): RuntimeVerifyRecord {
  if (opts?.previewRendered) {
    return {
      phase: 'autofix',
      severity: 'info',
      code: 'RUNTIME_UNCHECKED',
      message:
        'The app WAS opened in a real browser and rendered, but its console could not be captured on this ' +
        'run — so console errors specifically were not checked. Not a clean-console guarantee; the app is ' +
        'confirmed to render.',
      // The question this gate exists to answer — does the built app actually run — WAS answered.
      autoResolved: true,
    };
  }
  return {
    phase: 'autofix',
    severity: 'warning',
    code: 'RUNTIME_UNCHECKED',
    message:
      'Runtime was NOT verified — the browser console could not be captured (no live preview session), so ' +
      'runtime errors, if any, were not detected. This is not a clean-runtime guarantee.',
    autoResolved: false,
  };
}

/** Actionable runtime errors survived the repair budget — the build shipped but they may still be present. */
export function runtimeErrorsRemainRecord(errors: RuntimeError[]): RuntimeVerifyRecord {
  // M3-S3.1: name how many of the remaining errors are app-CRASHING (vs recoverable warnings), so the
  // admin report tells a genuinely-broken preview apart from console chatter instead of a flat count.
  const fatal = fatalRuntimeErrorCount(errors);
  const fatalNote = fatal > 0 ? ` ${fatal} of them crash the app at runtime.` : '';
  return {
    phase: 'autofix',
    severity: 'warning',
    code: 'RUNTIME_ERRORS_REMAIN',
    message:
      `${errors.length} runtime error(s) remained after the auto-fix budget was spent — the app was built, ` +
      `but these were detected in the browser at runtime and may still be present.${fatalNote}`,
    autoResolved: false,
  };
}
