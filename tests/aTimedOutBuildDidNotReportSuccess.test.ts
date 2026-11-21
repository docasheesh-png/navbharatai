// failedbr #1052, #1043 (2026-11-20): OUTCOME_RELEASE_GATE_RED said "The build reported success while the release gate was
// RED" on a build that had hit its 25-minute cap — the runner returns ok when it wrote files before the time ran out.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { releaseGateRedOutcomeMessage } from '../src/server/AgentV3/AutoFix';

describe('a timed-out build did not report success (failedbr #1052)', () => {
  it('says it ran out of time', () => {
    expect(releaseGateRedOutcomeMessage(1, true)).toMatch(/^The build ran out of time with files written, and the release gate was RED with 1 /);
  });
  it('an ordinary run reads as before', () => {
    expect(releaseGateRedOutcomeMessage(2, false)).toBe('The build reported success while the release gate was RED with 2 unresolved build-breaking issue(s) — the verdict has been corrected to NOT ok.');
  });
  it('🔒 the route passes the run\'s own timeout fact', () => {
    expect(readFileSync('src/server/routes/agentv3.ts', 'utf8')).toContain('releaseGateRedOutcomeMessage(gateBlockers, (settled as { timedOut?: boolean }).timedOut === true)');
  });
});
