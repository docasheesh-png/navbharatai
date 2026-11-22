// A TYPECHECK THAT RAN IS NOT "NO TYPECHECK" (failedbr #2490, Q-3249). The platform's correction told the user "no typecheck ran
// on this build" while the same report showed 5 write-time typecheck runs (the last clean) and a clean tsc. 🧬 Class: a lying
// analyzer — the claim audit read only the gate's evidence, which the write-time typecheck never moves.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeTimeTypecheckRan } from '../src/server/AgentV3/writeTimeTypecheck';
import { auditSummaryClaims } from '../src/server/AgentV3/claimAudit';

describe('the claim audit counts a write-time compile', () => {
  it('runs that looked at the project count; runs that never looked do not', () => {
    expect(writeTimeTypecheckRan({ runs: 5, notRunRuns: 0 })).toBe(true);           // #2490
    expect(writeTimeTypecheckRan({ runs: 4, notRunRuns: 4 })).toBe(false);          // a missing binary is not a run (12c642ed)
    expect(writeTimeTypecheckRan({ runs: 0, notRunRuns: 0 })).toBe(false);
    expect(writeTimeTypecheckRan(null)).toBe(false);
  });
  it('"typecheck clean" is not contradicted when a typecheck ran; it still is when none did', () => {
    const summary = 'Map badal diya hai aur app chalu hai (preview 200, typecheck clean).';
    const kinds = (ran: boolean) => auditSummaryClaims(summary, { typecheckRan: ran } as Parameters<typeof auditSummaryClaims>[1]).map((c) => c.kind);
    expect(kinds(true)).not.toContain('typecheck-clean');
    expect(kinds(false)).toContain('typecheck-clean');
  });
  it('the route asks both sources', () => {
    const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toContain("typecheckRan: gateEvidence.typecheck !== 'not-run' || writeTimeTypecheckRan(dispatcher.writeTypecheckStats()),");
  });
});
