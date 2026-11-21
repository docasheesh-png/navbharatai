// failedbr #1619, #1564, #1537 (2026-11-20): turns answered with a question to the user (TURN_ANSWERED_A_QUESTION) were
// reported "Build did not succeed, but no specific error was captured" — a silent crash, in the report's words.
import { describe, expect, it } from 'vitest';
import { deriveRootCause } from '../src/server/AgentV3/BuildDiagnostics';

const issue = (code: string, severity: 'info' | 'warning' | 'error' = 'info') => ({ ts: 1, phase: 'build' as const, severity, code, message: code, autoResolved: true });

describe('a question turn is not a silent failure (failedbr #1619, #1564, #1537)', () => {
  it('names the question', () => {
    const rc = deriveRootCause({ ok: false, issues: [issue('BUILD_NUDGE_STOOD_DOWN'), issue('TURN_ANSWERED_A_QUESTION')] } as never);
    expect(rc).toMatch(/asked the user a question instead of building/);
  });
  it('a failure with nothing recorded keeps the old line', () => {
    expect(deriveRootCause({ ok: false, issues: [issue('BUILD_NUDGE_STOOD_DOWN')] } as never)).toBe('Build did not succeed, but no specific error was captured.');
  });
});
