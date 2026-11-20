/** Synthetic first-reconnect-refusal regression cases. No customer report payload.
 * A setup refusal that never left workspace setup must not be scored as an
 * early delivery against the opening estimate, "the whole app" must not be
 * read as a request for a new complete product, and already-shipped first-
 * refusal, billing, privacy, and first-call window behaviour must hold.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { isExplicitCompleteBuild } from '../src/server/AgentV3/IntentClassifier';
import {
  BuildDiagnostics,
  ETA_UNTESTED_OUTCOMES,
  etaAccuracy,
  renderDiagnosticsText,
  userFacingReport,
} from '../src/server/AgentV3/BuildDiagnostics';
import { buildAdminReportRecord } from '../src/server/AgentV3/AdminBuildReportStore';
import { ABORT_OUTCOME_CODES } from '../src/server/AgentV3/abortOutcome';
import {
  SANDBOX_RECOVERY_FIRST_MESSAGE,
  SANDBOX_RECOVERY_REPEAT_MESSAGE,
  SandboxRecoveryUnavailableError,
} from '../src/server/AgentV3/SandboxRecoveryError';
import { buildExceptionDetails, publishBuildException, rethrowBuildSetupRecoveryUnavailable } from '../src/server/AgentV3/BuildRequestCoordination';
import { compactReportForRecord, trimReportForStorage } from '../src/server/AgentV3/DiagnosticsStore';
import { conversationToEvents } from '../src/components/agentv3/agentV3History';
import { recordOrEmitOpeningEta } from '../src/server/AgentV3/sandboxOpeningEta';

const RECOVERY_REASONS = [
  'identity-lookup',
  'identity-unavailable',
  'connect-unknown',
  'allocation-unrecorded',
  'allocation-lost',
  'winner-reconnect',
] as const;

/** Opening estimate shape for an unsized app that failed during setup. */
const SETUP_FAIL_PROMISE = {
  estimateMs: 348_206,
  lowMs: 237_555,
  highMs: 561_641,
  evidenced: true as const,
  key: 'app_unsized' as const,
  source: 'platform' as const,
};
const SETUP_FAIL_MS = 1_183;

function assertNoReasonToken(payload: unknown): void {
  const text = JSON.stringify(payload);
  for (const reason of RECOVERY_REASONS) {
    expect(text, `leaked reason ${reason}`).not.toContain(reason);
  }
}

function recordedSetupRefusal(reason: (typeof RECOVERY_REASONS)[number]) {
  const thrown = new SandboxRecoveryUnavailableError(reason);
  const details = buildExceptionDetails(thrown);
  let ts = 1;
  const diag = new BuildDiagnostics({ now: () => ts });
  diag.record({
    phase: 'sandbox',
    severity: 'error',
    code: thrown.code,
    message: thrown.message,
    autoResolved: false,
    ...(details.adminDetail ? { adminDetail: details.adminDetail } : {}),
  });
  ts += SETUP_FAIL_MS;
  diag.record({
    phase: 'sandbox',
    severity: 'error',
    code: 'OUTCOME_SANDBOX_UNAVAILABLE',
    message: 'Build outcome: SANDBOX_UNAVAILABLE — the build sandbox could not be recovered. Infrastructure condition, not the app or the prompt.',
    autoResolved: false,
  });
  diag.setEtaPromise(SETUP_FAIL_PROMISE);
  diag.finish(false, thrown.message);
  return { thrown, report: diag.report() };
}

function persistedConversationRecord(report: ReturnType<BuildDiagnostics['report']>) {
  return {
    id: 'agentv3-owner-br1986',
    status: 'error' as const,
    finalState: { ok: false, report: compactReportForRecord(report) },
  };
}

describe('BR1986: a setup refusal does not test the opening estimate', () => {
  it('a sandbox refusal inside the band is untested, not UNDER the band', () => {
    const accuracy = etaAccuracy(SETUP_FAIL_PROMISE, 0, SETUP_FAIL_MS, 'OUTCOME_SANDBOX_UNAVAILABLE')!;
    expect(accuracy.actualMs).toBe(SETUP_FAIL_MS);
    expect(accuracy.withinBand).toBe(false);
    expect(accuracy.untested).toBe(true);
    expect(accuracy.evidenced).toBe(true);
    expect(accuracy.line).toContain('cut short (OUTCOME_SANDBOX_UNAVAILABLE)');
    expect(accuracy.line).toContain('does not test completion time');
    expect(accuracy.line).not.toContain('UNDER the band');
    expect(accuracy.line).not.toContain('landed');
  });

  it.each(['OUTCOME_ENGINE_UNAVAILABLE', 'OUTCOME_ENGINE_TIMEOUT'] as const)(
    'sibling infrastructure stop %s inside the band is also untested',
    (code) => {
      const accuracy = etaAccuracy(SETUP_FAIL_PROMISE, 0, SETUP_FAIL_MS, code)!;
      expect(accuracy.untested).toBe(true);
      expect(accuracy.line).toContain(`cut short (${code})`);
      expect(accuracy.line).not.toContain('UNDER the band');
    },
  );

  it('a sandbox refusal past the band still reports the elapsed lower-bound miss', () => {
    const accuracy = etaAccuracy(SETUP_FAIL_PROMISE, 0, SETUP_FAIL_PROMISE.highMs + 1, 'OUTCOME_SANDBOX_UNAVAILABLE')!;
    expect(accuracy.untested).toBeUndefined();
    expect(accuracy.withinBand).toBe(false);
    expect(accuracy.line).toContain('OVER');
    expect(accuracy.line).toContain('cut short');
    expect(accuracy.line).not.toContain('landed');
  });

  it.each(['OUTCOME_BUILD_SUCCESS', 'OUTCOME_ADVISORY_CAPPED', ''] as const)(
    'keeps the existing delivered/advisory/legacy measurement for %s',
    (code) => {
      const accuracy = etaAccuracy(
        { estimateMs: 3 * 60_000, lowMs: 2 * 60_000, highMs: 4 * 60_000, evidenced: true },
        0,
        3 * 60_000,
        code,
      )!;
      expect(accuracy.untested).toBeUndefined();
      expect(accuracy.withinBand).toBe(true);
      expect(accuracy.line).toContain('landed INSIDE');
    },
  );

  it('the serialized setup-refusal report is untested and is not counted as ETA accuracy', () => {
    const { report } = recordedSetupRefusal('connect-unknown');
    expect(report.etaAccuracy).toMatchObject({
      actualMs: SETUP_FAIL_MS,
      untested: true,
      evidenced: true,
      key: 'app_unsized',
      source: 'platform',
    });
    expect(report.etaAccuracy?.line).not.toContain('UNDER the band');
    expect(renderDiagnosticsText(report)).toContain('cut short (OUTCOME_SANDBOX_UNAVAILABLE)');
    const stored = buildAdminReportRecord(report, { userId: null, email: null, workspaceId: 'eta-fixture', reportedAt: 1, userNote: '' });
    expect(stored.meta.etaRatio).toBeUndefined();
    expect(stored.meta.etaWithinBand).toBeUndefined();
    expect(stored.meta.etaEvidenced).toBe(true);
    expect(stored.meta.etaKey).toBe('app_unsized');
  });

  it('the untested set includes the infrastructure siblings and still includes abort outcomes', () => {
    expect(ETA_UNTESTED_OUTCOMES.has('OUTCOME_SANDBOX_UNAVAILABLE')).toBe(true);
    expect(ETA_UNTESTED_OUTCOMES.has('OUTCOME_ENGINE_UNAVAILABLE')).toBe(true);
    expect(ETA_UNTESTED_OUTCOMES.has('OUTCOME_ENGINE_TIMEOUT')).toBe(true);
    expect(ETA_UNTESTED_OUTCOMES.has(ABORT_OUTCOME_CODES.userStopped)).toBe(true);
    expect(ETA_UNTESTED_OUTCOMES.has('OUTCOME_BUILD_SUCCESS')).toBe(false);
  });
});

describe('BR1986: "the whole app" is a change of scope, not a new complete product', () => {
  it('independently written edit paraphrases are not explicit complete builds', () => {
    const edits = [
      'Please make the whole app easy to use on a phone, with no sideways scrolling.',
      'Make the entire application comfortable on a mobile screen and friendly to touch.',
      'Can you make the full website work well on a phone?',
      'Make the whole dashboard faster on small screens.',
      'Make the whole app ask for KYC before a payment is sent.',
      'poori app ko mobile par aaram se use karne layak banao, sideways scroll na ho',
      'poori application ko phone par comfortable bana do',
    ];
    for (const prompt of edits) {
      expect(isExplicitCompleteBuild(prompt), prompt).toBe(false);
    }
  });

  it('English and Hindi new-product neighbours still match', () => {
    expect(isExplicitCompleteBuild('Create a complete Hospital OPD Management System')).toBe(true);
    expect(isExplicitCompleteBuild('Create the complete Hospital OPD Management System')).toBe(true);
    expect(isExplicitCompleteBuild('build a complete e-commerce website')).toBe(true);
    expect(isExplicitCompleteBuild('Make a whole app for inventory management')).toBe(true);
    expect(isExplicitCompleteBuild('ek complete hospital OPD management system banao')).toBe(true);
  });

  it('a surgical edit and a reverse "complete" phrasing stay false', () => {
    expect(isExplicitCompleteBuild('add a logout button')).toBe(false);
    expect(isExplicitCompleteBuild('make the dashboard complete')).toBe(false);
    expect(isExplicitCompleteBuild('fix the header color')).toBe(false);
  });
});

describe('BR1986: the first reconnect refusal, billing, and estimate timing stay as shipped', () => {
  it('the first refusal keeps the existing goodbye, stays retryable, and bills 0', () => {
    const error = new SandboxRecoveryUnavailableError('connect-unknown');
    expect(error.message).toBe(SANDBOX_RECOVERY_FIRST_MESSAGE);
    expect(error.retryable).toBe(true);
    expect(error.repeated).toBe(false);
    let wrapped: unknown;
    try { rethrowBuildSetupRecoveryUnavailable(error); } catch (caught) { wrapped = caught; }
    const emit = vi.fn();
    publishBuildException(wrapped, undefined, emit);
    expect(emit.mock.calls.map(([event]) => event)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'error', code: 'SANDBOX_RECOVERY_UNAVAILABLE', retryable: true, message: SANDBOX_RECOVERY_FIRST_MESSAGE }),
      expect.objectContaining({ type: 'result', ok: false, billedUsd: 0, billedInr: 0, summary: SANDBOX_RECOVERY_FIRST_MESSAGE }),
    ]));
  });

  it('a repeated refusal is still a stronger goodbye and is not retryable', () => {
    const error = new SandboxRecoveryUnavailableError('connect-unknown', { repeated: true });
    expect(error.message).toBe(SANDBOX_RECOVERY_REPEAT_MESSAGE);
    expect(error.retryable).toBe(false);
  });

  it('a first attempt still shows the opening estimate before setup (BR1984 scope unchanged)', () => {
    const emitted: string[] = [];
    expect(recordOrEmitOpeningEta('⏱️ ~4–9 min', [], (text) => emitted.push(text))).toBeNull();
    expect(emitted).toEqual(['⏱️ ~4–9 min']);
    expect(recordOrEmitOpeningEta('⏱️ ~4–9 min', [{ ok: true, endedAt: 20, summary: 'ok' }], (text) => emitted.push(text))).toBeNull();
    expect(emitted).toEqual(['⏱️ ~4–9 min', '⏱️ ~4–9 min']);
  });
});

describe('BR1986: recovery reasons stay off every user-facing client path on a first refusal', () => {
  it.each(RECOVERY_REASONS)('userFacingReport and the SSE diagnostics event contain no %s token', (reason) => {
    const { thrown, report } = recordedSetupRefusal(reason);
    const user = userFacingReport(report);
    expect(user.issues.some((i) => 'adminDetail' in i || i.detail === reason)).toBe(false);
    expect(user.problems.some((i) => 'adminDetail' in i || i.detail === reason)).toBe(false);
    assertNoReasonToken(user);
    const emit = vi.fn();
    publishBuildException(thrown, userFacingReport(report), emit);
    assertNoReasonToken(emit.mock.calls);
    expect(JSON.stringify(emit.mock.calls)).toContain(SANDBOX_RECOVERY_FIRST_MESSAGE);
  });

  it.each(RECOVERY_REASONS)('compactReportForRecord and the GET conversation reopen contain no %s token', (reason) => {
    const { report } = recordedSetupRefusal(reason);
    const rec = persistedConversationRecord(report);
    assertNoReasonToken(rec);
    const response = { conversation: rec, workspaceState: undefined };
    assertNoReasonToken(response);
    assertNoReasonToken(conversationToEvents(rec));
  });

  it('the admin-gated stores and admin text view still show the reason', () => {
    const { report } = recordedSetupRefusal('connect-unknown');
    expect(report.issues.find((i) => i.code === 'SANDBOX_RECOVERY_UNAVAILABLE')?.adminDetail).toBe('connect-unknown');
    const stored = trimReportForStorage(report);
    expect(stored.issues.find((i) => i.code === 'SANDBOX_RECOVERY_UNAVAILABLE')?.adminDetail).toBe('connect-unknown');
    expect(renderDiagnosticsText(stored)).toContain('connect-unknown');
    expect(renderDiagnosticsText(userFacingReport(report))).not.toContain('connect-unknown');
  });

  it("a different code's user-facing detail is still kept (t311u)", () => {
    const diag = new BuildDiagnostics({ now: () => 1 });
    diag.record({
      phase: 'sandbox',
      severity: 'error',
      code: 'SANDBOX_UNAVAILABLE',
      message: 'The build sandbox could not be set up — the build cannot create files.',
      autoResolved: false,
      detail: 'the compiler said TS2307',
    });
    const issue = userFacingReport(diag.report()).issues.find((i) => i.code === 'SANDBOX_UNAVAILABLE');
    expect(issue?.detail).toBe('the compiler said TS2307');
    const compact = compactReportForRecord(diag.report());
    expect((compact.issues.find((i) => i.code === 'SANDBOX_UNAVAILABLE') ?? compact.problems.find((i) => i.code === 'SANDBOX_UNAVAILABLE'))?.detail).toBe('the compiler said TS2307');
  });
});

describe('BR1986: a pre-timer Surplus scope call is not reported as a zero-second first call', () => {
  it('a 2554ms call recorded 9ms after the timer starts is a window mismatch, not 0s', () => {
    let t = 1000;
    const d = new BuildDiagnostics({ now: () => t });
    t += 9;
    d.recordLlmCall({
      model: 'qwen3-coder',
      provider: 'SURPLUS',
      promptPreview: 'Build scope admission classification',
      latencyMs: 2554,
      inputTokens: 386,
      outputTokens: 2,
      ok: true,
    });
    const note = d.report().issues.find((i) => i.code === 'TIME_TO_FIRST_CALL')!.message;
    // Q-2746: the pre-build call is now named in plain words (started before the build's timer, not counted).
    expect(note).toContain('2.6s model call');
    expect(note).toContain("started before this build's timer");
    expect(note).not.toContain('first call itself then took 0s');
    expect(note).not.toContain('0s of preparation');
    expect(d.report().llmCalls?.[0].latencyMs).toBe(2554);
  });

  it('a compatible in-window call still reports preparation and model time normally', () => {
    let t = 1000;
    const d = new BuildDiagnostics({ now: () => t });
    t += 8000;
    d.recordLlmCall({ model: 'fixture', latencyMs: 2000, ok: true });
    const note = d.report().issues.find((i) => i.code === 'TIME_TO_FIRST_CALL')!.message;
    expect(note).toContain('6s of preparation');
    expect(note).toContain('then took 2s');
  });
});

describe('BR1986: source census', () => {
  it('ETA_UNTESTED_OUTCOMES in BuildDiagnostics names the infrastructure siblings', () => {
    const src = readFileSync('src/server/AgentV3/BuildDiagnostics.ts', 'utf8');
    const start = src.indexOf('export const ETA_UNTESTED_OUTCOMES');
    const block = src.slice(start, src.indexOf('];', start) + 2);
    expect(block).toContain("'OUTCOME_SANDBOX_UNAVAILABLE'");
    expect(block).toContain("'OUTCOME_ENGINE_UNAVAILABLE'");
    expect(block).toContain("'OUTCOME_ENGINE_TIMEOUT'");
    expect(block).toContain('OUTCOME_INITIAL_DECLINED');
    expect(block).toContain('OUTCOME_FINALIZATION_FAILED');
  });

  it('the definite-bare completeness helper is the only new complete-build branch', () => {
    const src = readFileSync('src/server/AgentV3/IntentClassifier.ts', 'utf8');
    expect(src).toContain('function isDefiniteBareAppCompleteness');
    expect(src).toContain('isDefiniteBareAppCompleteness(m, completeMatch.index, completeMatch[0])');
  });
});
