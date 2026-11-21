// failedbr #1334 (2026-11-20): a stop the engine made on a request NavBharatAI composed was filed as USER_STOPPED_BUILD with
// the message "…not by the user" — and `stoppedByUser` told them apart by matching that sentence.
import { describe, expect, it } from 'vitest';
import { buildWasStopped, stoppedByUser, ENGINE_STOP_CODE } from '../src/server/AgentV3/BuildDiagnostics';

const row = (code: string, message: string) => ({ phase: 'build', severity: 'info', code, message, autoResolved: true }) as never;

describe('an engine stop has its own code (failedbr #1334)', () => {
  it('is a stop, and is not the user\'s', () => {
    const issues = [row(ENGINE_STOP_CODE, 'The build was stopped while working on a request NavBharatAI itself composed — not by the user.')];
    expect(buildWasStopped(issues)).toBe(true);
    expect(stoppedByUser(issues)).toBe(false);
  });
  it('the user\'s stop and a legacy engine record read as before', () => {
    expect(stoppedByUser([row('USER_STOPPED_BUILD', 'The user asked for this build to stop, and it was stopped.')])).toBe(true);
    expect(stoppedByUser([row('USER_STOPPED_BUILD', 'The build was stopped … — not by the user.')])).toBe(false);
  });
});
