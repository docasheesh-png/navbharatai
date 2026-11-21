// failedbr #1258, #1253 (2026-11-20): RELEASE_GATE said "Failed: 1 build-breaking blocker ($ ./node_modules/.bin/tsc --noEmit
// 2>&1 → exit 2)" and "Proven: the project typechecks" in one line — an earlier failed run counted beside the current pass.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BuildDiagnostics, isTypecheckCommand } from '../src/server/AgentV3/BuildDiagnostics';

function withFailedTsc(): BuildDiagnostics {
  const d = new BuildDiagnostics();
  d.recordCommand({ command: './node_modules/.bin/tsc --noEmit 2>&1', exitCode: 2, stdout: "server/index.ts(197,3): error TS2769: No overload matches this call." });
  return d;
}

describe('a passing typecheck answers the earlier failure (failedbr #1258)', () => {
  it('a current pass clears the stale blocker', () => {
    const d = withFailedTsc();
    expect(d.shippingIssueCount('error')).toBe(1);
    expect(d.answerTypecheckFailuresWhenProven('passed')).toBe(1);
    expect(d.shippingIssueCount('error')).toBe(0);
  });
  it('anything but a current pass leaves it standing', () => {
    for (const ev of ['failed', 'not-run', undefined]) {
      const d = withFailedTsc();
      expect(d.answerTypecheckFailuresWhenProven(ev)).toBe(0);
      expect(d.shippingIssueCount('error')).toBe(1);
    }
  });
  it('only typecheck commands are answered', () => {
    expect(isTypecheckCommand('./node_modules/.bin/tsc --noEmit 2>&1')).toBe(true);
    expect(isTypecheckCommand('npx vue-tsc --noEmit')).toBe(true);
    expect(isTypecheckCommand('npm run typecheck')).toBe(true);
    expect(isTypecheckCommand('npm run build')).toBe(false);
    expect(isTypecheckCommand('npm run db:push')).toBe(false);
  });
  it('🔒 the route answers before the gate counts blockers', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    const at = route.indexOf('buildDiag.answerTypecheckFailuresWhenProven(gateEvidence.typecheck)');
    expect(at).toBeGreaterThan(0);
    expect(route.indexOf("blockers: buildDiag.shippingIssueCount('error')", at)).toBeGreaterThan(at);
  });
});
