import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { abortOutcomeFor, ABORT_OUTCOME_CODES } from '../src/server/AgentV3/abortOutcome';
import { abortSummary, type AbortCause } from '../src/server/AgentV3/buildAbortCause';
import { classifyFailureReason, OUTCOME_REASONS, OTHER_REASON } from '../src/lib/failureReason';
import { OUTCOME_TO_CATEGORY } from '../src/server/lib/BuildRetrospectiveEngine';
import { categorizeBuildFailures, isUserStoppedBuild } from '../src/server/lib/buildFailureCategory';
import { deriveRootCause, stoppedByUser, isAppFinding } from '../src/server/AgentV3/BuildDiagnostics';

/**
 * 🔴 THE "OTHER" BUCKET, ROOT-CAUSED (admin's failure table, 2026-09-18).
 *
 * 381 built, 153 failed, and the top reason for the biggest row — General, 106 failures — was *"Other
 * (not yet in the known pattern list)"*, 45 times. The admin asked for failures to be driven to zero at
 * "deep DNA level". A failure nobody can name cannot be fixed at any level.
 *
 * Nine causes abort a build. Only the two deadline causes recorded an `OUTCOME_*` code. The other seven
 * ended a build with no outcome, so `deriveRootCause` headlined whatever warning was loudest and the
 * classifier filed the sentence as "Other". Every one of the nine abort sentences and every fallback
 * sentence `deriveRootCause` writes was run through the classifier with no code — ALL came back `other`.
 * That measurement is pinned below as the first case, so the bug stays reproducible.
 */

const ALL_CAUSES: readonly AbortCause[] = [
  'user-stop', 'watchdog', 'advisory-cap', 'deploy-drain', 'lock-reclaimed', 'reaper', 'cost-cap', 'futile', 'unknown',
];

/** The union as WRITTEN in the source, so a tenth cause added to the type is a tenth cause here. */
function causesInSource(): string[] {
  const src = readFileSync(join(process.cwd(), 'src/server/AgentV3/buildAbortCause.ts'), 'utf8');
  const block = src.slice(src.indexOf('export type AbortCause ='), src.indexOf('const TAG ='));
  return [...block.matchAll(/^\s*\|\s*'([a-z-]+)'/gm)].map((m) => m[1]);
}

const issue = (code: string, message: string, severity: 'info' | 'warning' | 'error' = 'error', autoResolved = false) =>
  ({ ts: 1, phase: 'build', severity, code, message, autoResolved }) as never;

describe('THE BUG, measured: an aborted build with no outcome is unnameable', () => {
  it('every abort sentence, on its own, classifies as "other"', () => {
    for (const cause of ALL_CAUSES) for (const saved of [true, false]) {
      const text = abortSummary(cause, { minutes: 30, builtSomething: saved });
      expect(classifyFailureReason(text).key, `${cause} saved=${saved}`).toBe(OTHER_REASON.key);
    }
  });

  it('and the loudest unrelated warning became the root cause of a build the cost ceiling stopped', () => {
    // A provider fallback outranks nothing — but with no outcome recorded it is the "most severe
    // unresolved" issue, so it was headlined. Exactly what the admin's "Other" samples looked like.
    const rc = deriveRootCause({
      ok: false,
      issues: [issue('PROVIDER_FALLBACK', 'Provider GLM failed — falling back to the next provider', 'warning')],
    });
    expect(classifyFailureReason(rc).key).toBe(OTHER_REASON.key);
  });
});

describe('the fix: every cause maps to exactly one outcome, exhaustively', () => {
  it('the list this test walks IS the union in the source — a tenth cause cannot hide', () => {
    expect(causesInSource().sort()).toEqual([...ALL_CAUSES].sort());
    expect(causesInSource().length).toBeGreaterThanOrEqual(9);
  });

  it('the two deadline causes are recorded by the finalizer, so the funnel yields nothing for them', () => {
    expect(abortOutcomeFor('watchdog')).toBeNull();
    expect(abortOutcomeFor('advisory-cap')).toBeNull();
  });

  it('every other cause yields an OUTCOME_* the panel and the retrospective both know', () => {
    for (const cause of ALL_CAUSES) {
      const o = abortOutcomeFor(cause);
      if (!o) continue;
      expect(o.code.startsWith('OUTCOME_'), cause).toBe(true);
      expect(OUTCOME_REASONS[o.code], `${cause} → ${o.code} has no panel label`).toBeTruthy();
      expect(OUTCOME_TO_CATEGORY[o.code], `${cause} → ${o.code} is unknown to the retrospective`).toBeTruthy();
      expect(classifyFailureReason(o.message, o.code, o.severity).key, cause).not.toBe(OTHER_REASON.key);
    }
  });

  it('a user stop is INFO and names the user; every platform stop is an ERROR that does not', () => {
    const user = abortOutcomeFor('user-stop');
    expect(user?.code).toBe(ABORT_OUTCOME_CODES.userStopped);
    expect(user?.severity).toBe('info');
    for (const cause of ['cost-cap', 'futile', 'deploy-drain', 'lock-reclaimed', 'reaper', 'unknown'] as const) {
      const o = abortOutcomeFor(cause);
      expect(o?.severity, cause).toBe('error');
      expect(o?.message, cause).not.toMatch(/by the user|you stopped/i);
    }
  });

  it('a stop on a PLATFORM-composed prompt is never filed as the user\'s doing (autopsy fdd59ef8)', () => {
    const o = abortOutcomeFor('user-stop', { platformComposed: true });
    expect(o?.code).toBe('OUTCOME_STOPPED');
    expect(o?.message).toMatch(/not by the user/i);
    expect(stoppedByUser([issue(o!.code, o!.message, o!.severity)])).toBe(false);
  });

  it('an abort with NO cause is honestly "stopped", never attributed', () => {
    const o = abortOutcomeFor('unknown');
    expect(o?.code).toBe('OUTCOME_STOPPED');
    expect(o?.message).toMatch(/no cause recorded/i);
  });

  it('no message names a vendor — the code is admin-only but the message reaches the report', () => {
    for (const cause of ALL_CAUSES) {
      const o = abortOutcomeFor(cause);
      if (o) expect(o.message).not.toMatch(/glm|kimi|claude|sonnet|opus|gemini|grok|anthropic|moonshot|z\.ai/i);
    }
  });
});

describe('the report reads it: the outcome is the root cause, whatever else was recorded', () => {
  it('the cost ceiling is named ahead of a louder provider warning', () => {
    const o = abortOutcomeFor('cost-cap')!;
    const rc = deriveRootCause({
      ok: false,
      issues: [
        issue('PROVIDER_FALLBACK', 'Provider GLM failed — falling back to the next provider', 'warning'),
        issue('COST_CEILING_REACHED', 'Build stopped at its cost ceiling', 'warning'),
        issue(o.code, o.message, o.severity),
      ],
    });
    expect(rc).toBe(o.message);
    expect(classifyFailureReason(rc, o.code, o.severity).key).toBe('cost-ceiling');
  });

  it('a user stop recorded at INFO still headlines the report — and reads as the user, not a failure', () => {
    const o = abortOutcomeFor('user-stop')!;
    const issues = [issue('TOOL_ERROR', 'Tool call failed: edit_file: old_string not found', 'error'), issue(o.code, o.message, 'info', true)];
    expect(deriveRootCause({ ok: false, issues })).toBe(o.message);
    expect(stoppedByUser(issues)).toBe(true);
  });

  it('🔒 how a build ended is not a finding about the app — none of these can be a "blocker"', () => {
    for (const cause of ALL_CAUSES) {
      const o = abortOutcomeFor(cause);
      if (o) expect(isAppFinding({ phase: 'build', code: o.code }), cause).toBe(false);
    }
  });
});

describe('the panel: a user\'s own Stop leaves the failure tally', () => {
  const row = (id: string, extra: Partial<Parameters<typeof categorizeBuildFailures>[0][number]> = {}) => ({
    workspaceId: id, ok: false as boolean | null, prompt: 'a shop', rootCause: 'x', appSeenRunning: false, ...extra,
  });

  it('a NEW record (outcome code) and a LEGACY record (timeline read) are both recognised', () => {
    expect(isUserStoppedBuild({ outcomeCode: 'OUTCOME_USER_STOPPED', userStopped: null })).toBe(true);
    expect(isUserStoppedBuild({ outcomeCode: null, userStopped: true })).toBe(true);
    // Prose alone is NOT proof — the store reads the timeline, the panel does not read sentences.
    expect(isUserStoppedBuild({ outcomeCode: 'OUTCOME_BUILD_PARTIAL', userStopped: false })).toBe(false);
  });

  it('it is neither a failure nor a success, and the split still reconciles to the total', () => {
    const r = categorizeBuildFailures([
      row('stopped-new', { outcomeCode: 'OUTCOME_USER_STOPPED', outcomeSeverity: 'info' }),
      row('stopped-legacy', { userStopped: true }),
      row('really-failed', { outcomeCode: 'OUTCOME_FUTILE', outcomeSeverity: 'error', rootCause: abortOutcomeFor('futile')!.message }),
      row('fine', { ok: true }),
      row('running', { ok: null }),
    ]);
    expect(r.verdictSplit.userStopped).toBe(2);
    expect(r.failed).toBe(1);
    expect(r.ok).toBe(1);
    expect(r.unjudged).toBe(1);
    expect(r.overallFailureRatePct).toBe(50);
    expect(r.byReason.map((x) => x.key)).toEqual(['futile']);
    expect(r.byDomain.reduce((n, d) => n + d.total, 0)).toBe(2);
    const s = r.verdictSplit;
    expect(s.engineFailed + s.builtButJudgedFailed + s.evidenceUnknown + s.succeeded + s.unjudged + s.userStopped).toBe(r.totalBuilds);
  });

  it('🔒 a build the user stopped AFTER it succeeded is still a success (#3004)', () => {
    const r = categorizeBuildFailures([row('late-stop', { ok: true, userStopped: true })]);
    expect(r.ok).toBe(1);
    expect(r.verdictSplit.userStopped).toBe(0);
  });
});

describe('legacy records with no code: the engine\'s OWN fallback sentences get a stable name', () => {
  it('"no specific error was captured" is the engine saying it does not know — its own bucket, not "Other"', () => {
    for (const t of [
      'Build did not succeed, but no specific error was captured.',
      'This build ended without recording an outcome (cut off before it could report one) — the reason it stopped is not known, and no unresolved issue was recorded either.',
      'This build did not succeed, but NO unresolved problem was recorded — so why it failed is not known from this report. The most severe thing seen: x',
    ]) expect(classifyFailureReason(t).key, t.slice(0, 40)).toBe('no-cause-recorded');
  });

  it('the futility breaker\'s own warning and the USER-stop sentence are named too', () => {
    expect(classifyFailureReason('Build stopped because it was producing nothing').key).toBe('futile');
    expect(classifyFailureReason('The USER stopped this build — that is why it ended. Nothing failed.').key).toBe('user-stopped');
  });
});

/** ⚠️ REVERSION GUARD — the funnel must be wired in the route, not merely exist as a module. */
describe('the route records it at the one abort funnel', () => {
  const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
  it('reads the signal once, guards on "no outcome yet", and records what the mapping returns', () => {
    const at = route.indexOf('abortOutcomeFor(abortCauseOf(abort.signal)');
    expect(at).toBeGreaterThan(-1);
    const window = route.slice(at - 400, at + 900);
    expect(window).toContain('abort.signal.aborted && !outcomeCodeOf(buildDiag.report().issues)');
    expect(window).toContain('code: outcome.code');
    expect(window).toContain('severity: outcome.severity');
  });
});
