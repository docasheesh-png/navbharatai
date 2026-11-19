import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { terminalOutcomeCode, terminalOutcomeRecord } from '../src/server/AgentV3/buildOutcomeSummaries';
import { publicBuildEngineError } from '../src/server/lib/buildEngineError';
import { classifyFailure } from '../src/server/lib/BuildRetrospectiveEngine';
import { isAppFinding } from '../src/server/AgentV3/BuildDiagnostics';

// failedbr 617–630: Surplus died mid-build → "ended without an outcome code".
describe('every terminal path names its outcome', () => {
  it('Surplus engine unavailable crash → OUTCOME_ENGINE_UNAVAILABLE (not UNEXPLAINED)', () => {
    expect(terminalOutcomeCode({ error: publicBuildEngineError('attempts_exhausted'), crashCode: 'BUILD_EXCEPTION' })).toBe('OUTCOME_ENGINE_UNAVAILABLE');
  });
  it('engine turn timeout → OUTCOME_ENGINE_TIMEOUT', () => {
    expect(terminalOutcomeCode({ error: publicBuildEngineError('turn_timeout'), crashCode: 'BUILD_EXCEPTION' })).toBe('OUTCOME_ENGINE_TIMEOUT');
  });
  it('sandbox-recovery crash (used to record none) → OUTCOME_SANDBOX_UNAVAILABLE', () => {
    expect(terminalOutcomeCode({ error: new Error('x'), crashCode: 'SANDBOX_RECOVERY_UNAVAILABLE' })).toBe('OUTCOME_SANDBOX_UNAVAILABLE');
  });
  it('not-ok result whose diagnostics say engine unavailable → ENGINE_UNAVAILABLE', () => {
    expect(terminalOutcomeCode({ messages: ['The build engine is temporarily unavailable. Please try again shortly.'] })).toBe('OUTCOME_ENGINE_UNAVAILABLE');
    expect(terminalOutcomeCode({ messages: ['DISCOUNT_BUILD_UNAVAILABLE previous_call_accounting_unavailable'] })).toBe('OUTCOME_ENGINE_UNAVAILABLE');
  });
  it('truly unknown stays OUTCOME_UNEXPLAINED', () => {
    expect(terminalOutcomeCode({ error: new Error('boom'), crashCode: 'BUILD_EXCEPTION' })).toBe('OUTCOME_UNEXPLAINED');
  });
  it('new outcomes are engine (not app) findings and classified non-unknown', () => {
    for (const code of ['OUTCOME_ENGINE_UNAVAILABLE', 'OUTCOME_ENGINE_TIMEOUT'] as const) {
      const rec = terminalOutcomeRecord(code);
      expect(rec.code).toBe(code);
      expect(isAppFinding({ code, severity: 'error', phase: 'build', message: rec.message } as never)).toBe(false);
      expect(classifyFailure('', code).category).not.toBe('unknown');
    }
  });
  it('route crash path stamps an outcome for EVERY crash code, not only BUILD_EXCEPTION', () => {
    const src = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(src).not.toContain("if (crash.code === 'BUILD_EXCEPTION') {\n          try {\n            if (!outcomeCodeOf");
    // Since failedbr #2449 the crash path also hands over the codes the run recorded (a sandbox ending is named).
    expect(src).toContain("terminalOutcomeRecord(terminalOutcomeCode({ error: err, crashCode: crash.code, codes: (buildDiagRef?.report()?.issues ?? []).map(i => String(i.code ?? '')) }), crash.phase)");
  });
});
