import { describe, expect, it } from 'vitest';
import { ABORT_OUTCOME_CODES } from '../src/server/AgentV3/abortOutcome';
import { BuildDiagnostics, etaAccuracy, renderDiagnosticsText } from '../src/server/AgentV3/BuildDiagnostics';
import { buildAdminReportRecord } from '../src/server/AgentV3/AdminBuildReportStore';

const MIN = 60_000;
const promise = { estimateMs: 3 * MIN, lowMs: 2 * MIN, highMs: 4 * MIN, evidenced: true };

describe('a stopped build cannot meet its delivery ETA', () => {
  it.each(Object.entries(ABORT_OUTCOME_CODES))('%s cannot earn an inside-band delivery score', (_cause, code) => {
    const accuracy = etaAccuracy(promise, 0, 3 * MIN, code)!;
    expect(accuracy.actualMs).toBe(3 * MIN);
    expect(accuracy.ratio).toBe(1);
    expect(accuracy.withinBand).toBe(true); // elapsed-time arithmetic remains available
    expect(accuracy.untested).toBe(true);
    expect(accuracy.line).toContain(`cut short (${code})`);
    expect(accuracy.line).not.toContain('landed');
  });

  it.each([
    ['below the band', 2 * MIN - 1],
    ['at the lower bound', 2 * MIN],
    ['at the upper bound', 4 * MIN],
  ])('futility %s leaves completion time untested', (_label, elapsed) => {
    const accuracy = etaAccuracy(promise, 0, elapsed, ABORT_OUTCOME_CODES.futile)!;
    expect(accuracy.untested).toBe(true);
    expect(accuracy.line).not.toMatch(/landed|UNDER the band/);
  });

  it.each([ABORT_OUTCOME_CODES.futile, ABORT_OUTCOME_CODES.userStopped])('a %s stop past the band preserves the elapsed lower-bound miss', (code) => {
    const accuracy = etaAccuracy(promise, 0, 4 * MIN + 1, code)!;
    expect(accuracy.untested).toBeUndefined();
    expect(accuracy.withinBand).toBe(false);
    expect(accuracy.ratio).toBeGreaterThan(4 / 3);
    expect(accuracy.line).toContain('OVER');
    expect(accuracy.line).toContain('cut short');
    expect(accuracy.line).not.toContain('landed');
  });

  it.each(['OUTCOME_BUILD_SUCCESS', 'OUTCOME_ADVISORY_CAPPED', ''])('keeps the existing delivered/advisory/legacy measurement for %s', (code) => {
    const accuracy = etaAccuracy(promise, 0, 3 * MIN, code)!;
    expect(accuracy.untested).toBeUndefined();
    expect(accuracy.withinBand).toBe(true);
    expect(accuracy.line).toContain('landed INSIDE');
  });

  it('the retained futility report reaches text and admin aggregation without earning ETA accuracy', () => {
    // 78e7e226: exact retained clock/band, with no prompt, provider rejection or generated code copied.
    let now = 1_792_427_397_310;
    const diagnostics = new BuildDiagnostics({ buildId: '78e7e226', workspaceId: 'eta-fixture', prompt: 'Build the requested app.', now: () => now });
    diagnostics.setEtaPromise({ estimateMs: 715_506, lowMs: 470_075, highMs: 960_937, evidenced: true, key: 'game', source: 'platform' });
    now += 600_219;
    diagnostics.record({ phase: 'build', severity: 'error', code: ABORT_OUTCOME_CODES.futile, message: 'The build stopped without artifact progress.', autoResolved: false });
    now = 1_792_428_004_562;
    diagnostics.finish(false, 'Stopped because the build was not progressing.');
    const report = diagnostics.report();
    expect(report.etaAccuracy).toMatchObject({ actualMs: 607_252, withinBand: true, untested: true, key: 'game', source: 'platform' });
    expect(report.etaAccuracy?.ratio).toBeCloseTo(0.848702876);
    expect(renderDiagnosticsText(report)).toContain('cut short (OUTCOME_FUTILE)');
    expect(renderDiagnosticsText(report)).not.toContain('landed INSIDE');
    const stored = buildAdminReportRecord(report, { userId: null, email: null, workspaceId: 'eta-fixture', reportedAt: now, userNote: '' });
    expect(stored.meta.etaRatio).toBeUndefined();
    expect(stored.meta.etaWithinBand).toBeUndefined();
    expect(stored.meta.etaEvidenced).toBe(true);
    expect(stored.meta.etaKey).toBe('game');
  });

  it('serialization observes a late terminal outcome without losing user-wait subtraction', () => {
    let now = 0;
    const diagnostics = new BuildDiagnostics({ buildId: 'late', workspaceId: 'eta-fixture', prompt: 'Build an app.', now: () => now });
    diagnostics.setEtaPromise(promise);
    diagnostics.addUserWait(2 * MIN);
    now = 5 * MIN;
    diagnostics.finish(false, 'Stopped.');
    diagnostics.record({ phase: 'build', severity: 'error', code: ABORT_OUTCOME_CODES.futile, message: 'Futile.', autoResolved: false });
    const accuracy = diagnostics.report().etaAccuracy;
    expect(accuracy).toMatchObject({ actualMs: 3 * MIN, untested: true });
    expect(accuracy?.line).toContain("not counting 2.0 min");
  });
});
