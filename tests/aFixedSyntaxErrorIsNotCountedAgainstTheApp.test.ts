// A FIXED SYNTAX ERROR IS NOT COUNTED AGAINST THE APP (Q-821, admin 2026-10-12: "sabhi ke liye han hai").
// The syntax gate's one repair pass records OUTCOME_SYNTAX_ERROR (ERROR) when it cannot clear a file. Later
// passes — the endgame repair, the render rescue — can make every file parse, and nothing answered the early
// line. The release gate runs BEFORE the final syntax re-check and counts every open ERROR, so a build whose
// files all parsed was turned RED, flipped to NOT ok and left free. THE CLASS: an early verdict that a later
// pass made untrue, still counted. The same files are now re-parsed before the gate counts, and again at the
// final re-check; a clean parse answers both the error and its warning. A file that still does not parse
// keeps its error — this only ever answers.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';
import { releaseGate } from '../src/server/AgentV3/releaseGate';

const syntaxFindings = (d: BuildDiagnostics) => {
  d.record({ phase: 'build', severity: 'warning', code: 'SYNTAX_ERROR_DETECTED', message: '1 generated file(s) do not parse (the app cannot compile)', autoResolved: false });
  d.record({ phase: 'build', severity: 'error', code: 'OUTCOME_SYNTAX_ERROR', message: 'After one repair pass, 1 file(s) STILL do not parse — the app cannot compile', autoResolved: false });
};

describe('the answer', () => {
  it('a clean re-parse answers the error AND its warning, and says so', () => {
    const d = new BuildDiagnostics();
    syntaxFindings(d);
    expect(d.hasOpenSyntaxFinding()).toBe(true);
    expect(d.shippingIssueCount('error')).toBe(1);
    expect(d.answerSyntaxOnCleanParse('before the release gate')).toBe(2);
    expect(d.hasOpenSyntaxFinding()).toBe(false);
    expect(d.shippingIssueCount('error')).toBe(0);
    expect(d.shippingIssueCount('warning')).toBe(0);
    const note = d.report().issues.find((i) => i.code === 'SYNTAX_RECHECK_CLEAN');
    expect(note).toMatchObject({ severity: 'info', autoResolved: true });
    expect(note?.message).toContain('before the release gate');
  });

  it('nothing open, nothing answered, nothing said', () => {
    const d = new BuildDiagnostics();
    expect(d.answerSyntaxOnCleanParse('x')).toBe(0);
    expect(d.report().issues.some((i) => i.code === 'SYNTAX_RECHECK_CLEAN')).toBe(false);
  });

  it('🔒 it is the error count the release gate reads — RED before, not RED after', () => {
    const d = new BuildDiagnostics();
    syntaxFindings(d);
    const evidence = { buildOk: true, preview: 'passed' as const };
    const before = releaseGate(evidence as never, { blockers: d.shippingIssueCount('error'), highSeverity: 0, warnings: d.shippingIssueCount('warning') });
    expect(before.state).toBe('red');
    d.answerSyntaxOnCleanParse('before the release gate');
    const after = releaseGate(evidence as never, { blockers: d.shippingIssueCount('error'), highSeverity: 0, warnings: d.shippingIssueCount('warning') });
    expect(after.state).not.toBe('red');
  });
});

describe('🔒 the wiring', () => {
  const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');

  it('the re-parse runs BEFORE the release gate counts the errors', () => {
    const recheck = route.indexOf("buildDiag.answerSyntaxOnCleanParse('before the release gate');");
    const gate = route.indexOf('let gate = releaseGate(gateEvidence, gateFindings(), gateQuality);');
    expect(recheck).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(recheck);
    expect(route.slice(recheck - 400, recheck)).toContain('buildDiag.hasOpenSyntaxFinding() && (await findSyntaxErrors(Object.fromEntries(writtenFiles))).length === 0');
  });

  it('the final re-check answers it too, and still records a file that does not parse', () => {
    const at = route.indexOf('const finalSyntaxErrors = await findSyntaxErrors(Object.fromEntries(writtenFiles));');
    const block = route.slice(at, at + 3200);
    expect(block).toContain("code: 'OUTCOME_SYNTAX_ERROR'");
    expect(block).toContain("} else if (buildDiag.hasOpenSyntaxFinding()) {");
    expect(block).toContain("buildDiag.answerSyntaxOnCleanParse('in the final build');");
  });
});
