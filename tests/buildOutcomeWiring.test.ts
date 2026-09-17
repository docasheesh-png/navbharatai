import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { scoreBuildOutcome, complaintInText } from '../src/server/AgentV3/buildOutcomeSignals';

/**
 * OPTION A WIRING — "poochho mat, naapo".
 *
 * The pure scorer and the store helpers have their own tests. These pin the five places the route has
 * to touch for any of it to be real: open a record when a build ends, and record each of the four
 * signals. Drop any one and nothing fails — the admin simply stops hearing about a class of bad build,
 * which is indistinguishable from there being none.
 */
const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
const surface = readFileSync(join(process.cwd(), 'src/components/agentv3/PreviewSurface.tsx'), 'utf8');

/**
 * 🔴 A GUARD BOUNDED BY A BYTE COUNT BREAKS ON THE NEXT CORRECT LINE (2026-09-17).
 *
 * The two `finalizeOnDeadline` guards below sliced a FIXED 9000 / 14000 characters from the function
 * header. An unrelated, correct three-line addition earlier in that function pushed
 * `buildDiagRef?.finish(...)` from offset 8,924 to 9,080 — past the window — and the guard failed
 * against code that still did exactly what the guard exists to require.
 *
 * That is the third guard in this repo to break on its own formatting in one day (the release-gate
 * count guard pinned an `issues.filter(...)` shape; a constructor-arity guard counted commas inside a
 * doc comment). The pattern is the same every time: **the guard measured the text instead of the
 * claim**, and a session then has to decide whether the code or the guard is wrong — which is exactly
 * the doubt a guard is supposed to remove.
 *
 * So the window is now the function's REAL extent, found by matching braces from its header. It cannot
 * be outgrown, and it still proves what the assertions mean: these lines are inside THIS function, in
 * THIS order. Strictly stronger than the byte count it replaces — never weaker.
 */
function functionBody(src: string, header: string): string {
  const at = src.indexOf(header);
  if (at < 0) return '';
  const open = src.indexOf('{', at + header.length - 1);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return src.slice(at, i + 1); }
  }
  return src.slice(at); // unbalanced — fall back to the remainder rather than to nothing
}

describe('a record is opened for every build that ends', () => {
  it('startBuild runs in the FINALLY, so every ending is covered', () => {
    const fin = route.indexOf('clearInterval(diagHeartbeatTimer);');
    expect(fin).toBeGreaterThan(-1);
    expect(route.slice(fin, fin + 1400)).toContain('buildOutcomeStore.startBuild(');
  });

  it('it carries whether the build CLAIMED success — only a claimed success can be a silent failure', () => {
    expect(route).toContain('buildResultRef?.ok === true');
  });
});

describe('the four signals are recorded', () => {
  it('preview dwell, from the keep-alive ping', () => {
    const i = route.indexOf("app.post('/api/agentv3/preview-keepalive'");
    const body = route.slice(i, i + 2200);
    expect(body).toContain('previewFirstSeenAt');
    expect(body).toContain('previewLastSeenAt');
    // After the response: this endpoint's only job is to keep a page alive, never to slow it down.
    expect(body.indexOf('res.status(200).json({ ok: true, held })')).toBeLessThan(body.indexOf('noteBuildOutcome'));
  });

  it('a complaint in the user’s next message', () => {
    expect(route).toContain('if (complaintInText(prompt))');
    expect(route).toContain('{ complained: true }');
  });

  it('a PERSON pressing Diagnose — not the watchdog doing its job', () => {
    // The distinction is the whole guard against a false alarm on every routine auto-heal.
    expect(route).toContain("req.body?.userInitiated === true");
    expect(route).toContain('{ askedForRepair: true }');
    expect(surface).toContain('const runDiagnose = useCallback(async (userInitiated = false)');
    expect(surface).toContain('runDiagnose(true)');
  });

  it('publishing the app', () => {
    expect(route).toContain('{ invested: true }');
  });
});

describe('the report cannot be sent twice, or wrongly attributed', () => {
  it('the send is CLAIMED transactionally before the record is built', () => {
    const i = route.indexOf('async function noteBuildOutcome(');
    const body = route.slice(i, i + 4000);
    expect(body.indexOf('claimReport(')).toBeLessThan(body.indexOf('buildAdminReportRecord('));
  });

  it('identity comes from the verified TOKEN, never the request body', () => {
    const i = route.indexOf('async function outcomeIdentity(');
    const body = route.slice(i, i + 700);
    expect(body).toContain('verifyFirebaseToken(req)');
    expect(body).not.toContain('req.body');
  });

  it('the admin can tell an automatic report from a person pressing Report', () => {
    expect(route).toContain('autoReportReason(judgement)');
  });

  it('the whole feature has a kill switch', () => {
    expect(route).toContain('buildOutcomeTrackingEnabled()');
  });
});

describe('the guarantees, executed rather than grepped', () => {
  it('an ordinary follow-up request never triggers a report', () => {
    expect(complaintInText('add a dark mode')).toBe(false);
    expect(scoreBuildOutcome({
      buildOk: true, complained: false, askedForRepair: false, invested: false, previewWatchedMs: null,
    }).verdict).toBe('unclear');
  });

  it('a green build the user says is broken does', () => {
    expect(scoreBuildOutcome({
      buildOk: true, complained: true, askedForRepair: false, invested: false, previewWatchedMs: null,
    }).verdict).toBe('bad');
  });
});

describe('the runtime auto-fix net asks "is it better", not just "does it paint"', () => {
  /**
   * `verifyAfterFix` already reverted a repair that stopped the app rendering. It did NOT notice a
   * repair that kept it rendering while tripling its runtime errors — which, with the default of one
   * attempt, then shipped. Same rule as the compile-side gate, same module.
   */
  it('the render check runs FIRST and short-circuits — a broken app is never console-counted', () => {
    const i = route.indexOf('const reRenderOk = async (): Promise<boolean> => {');
    expect(i).toBeGreaterThan(-1);
    const body = route.slice(i, i + 2200);
    expect(body.indexOf('if (!v.rendered) return false;')).toBeLessThan(body.indexOf('getConsoleErrors!(workspaceId, fixStart)'));
  });

  it('it counts the POST-repair console, from the moment the fix began', () => {
    const i = route.indexOf('const reRenderOk = async (): Promise<boolean> => {');
    const body = route.slice(i, i + 2200);
    // `fixStart` is stamped before the repair runs, and the browse above has just reloaded the page —
    // so this window holds the repaired app's errors, not the ones that prompted the repair.
    expect(body).toContain('getConsoleErrors!(workspaceId, fixStart)');
    expect(body).toContain('judgeRuntimeRepair({ stillRenders: true, beforeCount: captured.length');
  });

  it('an unreadable console keeps the repair rather than reverting on a guess', () => {
    const i = route.indexOf('const reRenderOk = async (): Promise<boolean> => {');
    const body = route.slice(i, i + 2200);
    expect(body).toContain('catch { afterCount = null;');
  });

  it('a reverted regression is recorded honestly, not silently undone', () => {
    expect(route).toContain("code: 'RUNTIME_FIX_REGRESSED'");
  });
});

describe('🔒 the wall-clock cap gets its own honest outcome code (admin diagnostics report, 2026-09-10)', () => {
  /**
   * A real build hit AGENTV3_MAX_BUILD_SECONDS's default at 29m59s and the diagnostics report gave no
   * way to tell — every OTHER recognised outcome (OUTCOME_BUILD_SUCCESS, OUTCOME_STOPPED,
   * OUTCOME_SYNTAX_ERROR, OUTCOME_PREVIEW_FAILED, …) is recorded here, but AgentRunner never touches
   * buildDiag itself; only the route does, from `result`. A reader was left to infer a timeout purely
   * from the coincidence of the duration, which is the "wrong verdict" the honesty rule forbids.
   */
  it('is recorded right where every build path converges on one `result`', () => {
    // ⚠️ BOUNDED BY REAL SYNTAX, NOT BY A BYTE DISTANCE (2026-09-17). This assertion used to slice a
    // fixed 2,200-character window after the anchor, and it has now broken TWICE on insertions that
    // changed no behaviour at all — a six-line comment once, and the stop back-fill after that. A
    // guard that fails on the LENGTH of what sits between two statements is a guard someone will
    // eventually weaken to get green, which is the opposite of what it is for. `PROGRESS.md` records
    // the rule this now follows: a source-reading guard parses the code and asserts the CLAIM.
    //
    // The claim is an ORDER: every build path converges on one `result`, and the timeout outcome is
    // recorded after that point, from `result`, inside a try/catch — not that it sits within N bytes.
    const CONVERGES = 'if (!result) result = await runner.run(buildPrompt);';
    const i = route.indexOf(CONVERGES);
    expect(i).toBeGreaterThan(-1);
    const timedOut = route.indexOf('if (result.timedOut === true)', i);
    expect(timedOut).toBeGreaterThan(i);
    // …and nothing re-runs the builder in between, so it really is the single convergence point.
    // The span starts AFTER the anchor statement ends — measuring from inside it would match that
    // statement's own `runner.run(` and fail on the code it is asserting about.
    expect(route.slice(i + CONVERGES.length, timedOut)).not.toContain('runner.run(');
    const body = route.slice(timedOut, route.indexOf('\n      }', timedOut));
    expect(body).toContain("code: 'OUTCOME_BUILD_TIMEOUT'");
    expect(body).toContain('buildDiag.record(');
  });

  it('severity follows which of the two buildTimedOut branches fired', () => {
    const i = route.indexOf('if (result.timedOut === true)');
    const body = route.slice(i, i + 900);
    // warning: files were genuinely saved (the common, resumable case) — error: nothing was built at all.
    expect(body).toContain("severity: result.ok ? 'warning' : 'error'");
  });

  it('never throws into the build — diagnostics recording is best-effort, like every sibling OUTCOME_* call', () => {
    const i = route.indexOf('if (result.timedOut === true)');
    const body = route.slice(i, i + 900);
    expect(body).toMatch(/try\s*\{[\s\S]*buildDiag\.record[\s\S]*\}\s*catch/);
  });
});

describe('🔒 a PERSISTED diagnostics report can never carry a stale success narration on a build that did not succeed (EduTube autopsy, 2026-09-14)', () => {
  /**
   * Real report: a mid-build `done` event ("Your EduTube app is live and ready … zero TypeScript
   * errors") set `BuildDiagnostics.summary` at minute 17; the build kept hitting real compile errors
   * for 12 more minutes and was then STOPPED by the wall-clock watchdog — but `finish(false, undefined)`
   * left that celebratory text as the report's PERSISTED `summary`, because `finish()` only overwrites
   * `this.summary` when a summary is actually passed. Anyone reading the report (admin dashboard, the
   * user's own download, the APK/build-report inboxes) saw success on a build that timed out.
   * `ingestEvent`'s `case 'done'` sets `this.summary` unconditionally on EVERY `done` event AgentRunner
   * emits, not only the terminal one, so `finish()` is the one place that can put an honest string back.
   */
  it('the watchdog finalizer computes an honest pause message BEFORE finishing the report, and passes it on the not-ok branch', () => {
    const i = route.indexOf('const finalizeOnDeadline = async () => {');
    expect(i).toBeGreaterThan(-1);
    const body = functionBody(route, 'const finalizeOnDeadline = async () => {');
    const pauseComputed = body.indexOf('const pauseMsgForReport = deadlinePauseMessage(writtenFiles.size);');
    const finishCall = body.indexOf('buildDiagRef?.finish(ok, ok ? buildResultRef?.summary : pauseMsgForReport.summary);');
    expect(pauseComputed).toBeGreaterThan(-1);
    expect(finishCall).toBeGreaterThan(-1);
    // Computed BEFORE finish() is called, and never `undefined` on the branch that means "did not succeed".
    expect(pauseComputed).toBeLessThan(finishCall);
    expect(body).not.toContain('buildDiagRef?.finish(ok, ok ? buildResultRef?.summary : undefined)');
  });

  it('the resumable-pause chat bubble and the persisted report summary are the SAME honest text — one computation, not two', () => {
    const body = functionBody(route, 'const finalizeOnDeadline = async () => {');
    // The `else` branch (not-ok, resumable) must reuse the same value rather than recomputing it —
    // two independent calls to deadlinePauseMessage() could disagree if writtenFiles.size changed
    // between them, silently reopening this exact class of contradiction.
    expect(body).toContain('const pauseMsg = pauseMsgForReport;');
    expect(body).not.toContain('const pauseMsg = deadlinePauseMessage(writtenFiles.size);');
  });

  it('the crash-path finalizer also passes an honest summary — the sibling call site (rule 3: hunt the siblings)', () => {
    const i = route.indexOf("buildDiagRef?.record({ phase: 'build', severity: 'error', code: 'BUILD_EXCEPTION'");
    expect(i).toBeGreaterThan(-1);
    const body = route.slice(i, i + 900);
    expect(body).not.toContain('buildDiagRef?.finish(false);');
    expect(body).toMatch(/buildDiagRef\?\.finish\(false, `Build stopped[\s\S]*errMsg[\s\S]*\)/);
  });
});
