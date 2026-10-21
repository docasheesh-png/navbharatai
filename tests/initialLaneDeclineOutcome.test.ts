import { describe, expect, it } from 'vitest';
import { BuildDiagnostics, etaAccuracy, isAppFinding, outcomeCodeOf, severityOfOutcome } from '../src/server/AgentV3/BuildDiagnostics';
import { buildFindingSuggestions } from '../src/server/AgentV3/buildFindingSuggestions';
import { buildHealthFromDiagnostics } from '../src/server/AgentV3/buildHealthCard';
import { classifyFailureReason } from '../src/lib/failureReason';
import { classifyFailure } from '../src/server/lib/BuildRetrospectiveEngine';

const CODE = 'OUTCOME_INITIAL_DECLINED';
const message = 'The initial lane declined; its original answer was preserved.';
const record = () => {
  const diag = new BuildDiagnostics();
  diag.record({ phase: 'build', code: CODE, severity: 'info', autoResolved: true, message });
  diag.finish(false, 'I cannot build that feature here.');
  return diag;
};

describe('an initial decline has a truthful non-delivery outcome, not a successful app', () => {
  it('keeps the known reason in the real diagnostic report', () => {
    const report = record().report();
    expect(outcomeCodeOf(report.issues)).toBe(CODE);
    expect(severityOfOutcome(report.issues)).toBe('info');
    expect(report.rootCause).toBe(message);
    expect(report.ok).toBe(false);
    expect(report.problems).toEqual([]);
  });
  it.each(['SIMPLE_BUILD_DECLINED', 'ONESHOT_DECLINED', CODE, 'OUTCOME_FINALIZATION_FAILED'])('%s is routing, not an app defect or next-step repair offer', (code) => {
    expect(isAppFinding({ phase: 'build', code })).toBe(false);
    // Classification is stable even if a future caller forgets autoResolved or changes severity.
    expect(buildFindingSuggestions([{ code, message, severity: 'warning', autoResolved: false }])).toEqual([]);
  });
  it('cannot prove a running app or be promoted by preview verification', () => {
    const diag = record();
    expect(diag.recordPreviewVerified()).toBe(false);
    expect(buildHealthFromDiagnostics(diag.report(), false)).toMatchObject({ ready: false, provenRunning: false, blockers: [], warnings: [] });
    const successful = new BuildDiagnostics();
    successful.record({ phase: 'build', code: 'OUTCOME_BUILD_PARTIAL', severity: 'info', autoResolved: true, message: 'Synthetic partial build' });
    expect(successful.recordPreviewVerified()).toBe(true);
    successful.finish(true, 'Synthetic app verified.');
    expect(buildHealthFromDiagnostics(successful.report(), true)).toMatchObject({ ready: true, provenRunning: true });
  });
  it('has neutral explicit panel and retrospective mappings without retry or policy claims', () => {
    const reason = classifyFailureReason(message, CODE, 'info');
    const retrospective = classifyFailure(message, CODE);
    expect(reason.key).toBe('initial-declined');
    expect(reason.label).toMatch(/declined/);
    expect(retrospective.category).toBe('incomplete');
    expect(retrospective.hint).toMatch(/original answer was preserved/);
    expect(`${reason.label} ${retrospective.hint}`).not.toMatch(/try again|retry|manual review|policy/i);
    expect(classifyFailureReason(message, 'OUTCOME_UNEXPLAINED', 'error').key).toBe('unexplained');
    expect(classifyFailure(message, 'OUTCOME_UNEXPLAINED').hint).toContain('retry');
  });
  it('names a later finalization failure without misdirecting the reader to app code', () => {
    expect(classifyFailureReason('Synthetic finalization exception', 'OUTCOME_FINALIZATION_FAILED', 'error').key).toBe('finalization-failed');
    const failure = classifyFailure('Synthetic finalization exception', 'OUTCOME_FINALIZATION_FAILED');
    expect(failure.category).toBe('incomplete');
    expect(failure.hint).toContain('while finalizing');
    expect(failure.hint).not.toMatch(/check the compiler|retry|manual review|policy/i);
  });
  const promise = { estimateMs: 180_000, lowMs: 120_000, highMs: 240_000, evidenced: true };
  it.each([CODE, 'OUTCOME_FINALIZATION_FAILED'])('%s leaves completed-delivery ETA untested within the promised band', (code) => {
    expect(etaAccuracy(promise, 0, 180_000, code)).toMatchObject({ withinBand: true, untested: true });
    expect(etaAccuracy(promise, 0, 180_000, code)?.line).not.toContain('landed');
  });
  it.each(['OUTCOME_BUILD_SUCCESS', 'OUTCOME_UNKNOWN_SYNTHETIC', ''])('preserves existing completion/unknown ETA behavior for %s', (code) => {
    const accuracy = etaAccuracy(promise, 0, 180_000, code);
    expect(accuracy?.untested).toBeUndefined();
    expect(accuracy?.line).toContain('landed INSIDE');
  });
});
