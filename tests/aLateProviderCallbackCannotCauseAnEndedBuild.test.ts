import { describe, expect, it } from 'vitest';
import { BuildDiagnostics, deriveRootCause } from '../src/server/AgentV3/BuildDiagnostics';

describe('late provider telemetry stays visible without becoming the cause of an earlier ending', () => {
  it('retains a late failed call and its usage while preserving the original causal assessment', () => {
    let time = 1_000;
    const diag = new BuildDiagnostics({ now: () => time });
    time = 2_000;
    diag.finish(false, 'The run ended without a recorded cause.');
    const cause = diag.report().rootCause;
    time = 3_600_000;
    diag.recordLlmCall({ model: 'test-model', provider: 'TEST', ok: false,
      error: 'The delayed provider call failed.', latencyMs: 3_599_000,
      inputTokens: 12, outputTokens: 7, toolCalls: 0 });
    const report = diag.report();
    expect(report.rootCause).toBe(cause);
    expect(report.llmCalls).toHaveLength(1);
    expect(report.llmCalls![0]).toMatchObject({ inputTokens: 12, outputTokens: 7 });
    expect(report.issues.some((i) => i.code === 'LLM_CALL_FAILED')).toBe(true);
    expect(report.endedAt).toBe(2_000);
  });

  it('keeps failures inside the recorded run and does not filter live reports', () => {
    const issue = { ts: 2_000, phase: 'provider', severity: 'error', code: 'LLM_CALL_FAILED',
      message: 'The provider failed before the run ended.', autoResolved: false } as const;
    expect(deriveRootCause({ issues: [issue], endedAt: 2_000, ok: false })).toBe(issue.message);
    expect(deriveRootCause({ issues: [issue], ok: false })).toBe(issue.message);
  });

  it('preserves terminal backfills recorded after finish instead of treating all bookkeeping as a late call', () => {
    const issue = { ts: 3_000, phase: 'build', severity: 'info', code: 'OUTCOME_USER_STOPPED',
      message: 'Build outcome: STOPPED BY THE USER.', autoResolved: true } as const;
    expect(deriveRootCause({ issues: [issue], endedAt: 2_000, ok: false })).toBe(issue.message);
  });
});
