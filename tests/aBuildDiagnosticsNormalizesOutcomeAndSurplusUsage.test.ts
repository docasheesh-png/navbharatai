import { describe, expect, it } from 'vitest';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';

describe('diagnostic outcomes and provider usage notes retain their actual meaning', () => {
  it('does not let the generic info-note adapter demote build outcomes', () => {
    const diagnostics = new BuildDiagnostics();
    diagnostics.record({
      phase: 'build',
      severity: 'info',
      code: 'OUTCOME_ASKED_USER',
      message: 'Build outcome: ASKED_USER',
      autoResolved: true,
    });
    diagnostics.record({
      phase: 'build',
      severity: 'info',
      code: 'OUTCOME_EMPTY_BUILD',
      message: 'Build outcome: EMPTY',
      autoResolved: true,
    });

    const report = diagnostics.report();
    const asked = report.issues.find(issue => issue.code === 'OUTCOME_ASKED_USER');
    const empty = report.issues.find(issue => issue.code === 'OUTCOME_EMPTY_BUILD');
    expect(asked).toMatchObject({ severity: 'info', autoResolved: false });
    expect(empty).toMatchObject({ severity: 'error', autoResolved: false });
    expect(report.problems.some(issue => issue.code === 'OUTCOME_EMPTY_BUILD')).toBe(true);
  });

  it('does not recommend the streaming flag for SURPLUS non-streaming calls', () => {
    const diagnostics = new BuildDiagnostics();
    diagnostics.record({
      phase: 'build',
      severity: 'warning',
      code: 'USAGE_NOT_REPORTED',
      message: 'A provider returned no token usage',
      detail: 'SURPLUS (qwen3-coder) did not report usage; AGENTV3_STREAM_BUILD_CALLS and stream_options.include_usage may be the cause.',
      autoResolved: true,
    });
    const issue = diagnostics.report().issues.find(item => item.code === 'USAGE_NOT_REPORTED');
    expect(issue?.severity).toBe('warning');
    expect(issue?.detail).toContain('non-streaming runner (stream: false)');
    expect(issue?.detail).toContain('unmeasured');
    expect(issue?.detail).toContain('do not infer zero cost or change the global streaming flag');
    expect(issue?.detail).not.toContain('AGENTV3_STREAM_BUILD_CALLS');
  });

  it('keeps streaming guidance for providers that are not SURPLUS', () => {
    const diagnostics = new BuildDiagnostics();
    const detail = 'GLM streamed response may omit usage unless AGENTV3_STREAM_BUILD_CALLS is disabled.';
    diagnostics.record({
      phase: 'build',
      severity: 'warning',
      code: 'USAGE_NOT_REPORTED',
      message: 'A provider returned no token usage',
      detail,
      autoResolved: true,
    });
    const issue = diagnostics.report().issues.find(item => item.code === 'USAGE_NOT_REPORTED');
    expect(issue?.detail).toBe(detail);
  });
});
