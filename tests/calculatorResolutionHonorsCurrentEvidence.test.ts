import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';

const code = 'SIMPLE_BUILD_VERIFY_ERROR';
const finding = { phase: 'build' as const, severity: 'warning' as const, code,
  message: 'Fast-lane verify failed', detail: 'src/main.ts(1,1): error TS2322: Type mismatch.', autoResolved: false };
const command = './node_modules/.bin/tsc --noEmit';
const open = (d: BuildDiagnostics) => d.report().issues.find(i => i.code === code)?.autoResolved === false;

describe('calculator resolution respects current-source and native evidence', () => {
  it.each(['missing', 'stale', 'current'] as const)('handles a %s command revision', freshness => {
    const d = new BuildDiagnostics({ currentSourceRevision: () => 5 });
    d.record(finding);
    d.recordCommand({ command, exitCode: 0, stdout: '', stderr: '',
      ...(freshness === 'missing' ? {} : { typecheckProof: { revision: freshness === 'current' ? 5 : 4, project: true } }) });
    expect(open(d)).toBe(freshness !== 'current');
  });
  it('rejects a source change before direct resolution', () => {
    let revision = 5;
    const d = new BuildDiagnostics({ currentSourceRevision: () => revision });
    d.record(finding);
    revision = 6;
    expect(d.resolveCompilerFailuresOnRecheck(5)).toBe(0);
    expect(open(d)).toBe(true);
  });
  it('rejects missing or unreadable live revision proof', () => {
    const d = new BuildDiagnostics({ currentSourceRevision: () => { throw new Error('unavailable'); } });
    d.record(finding);
    expect(d.resolveCompilerFailuresOnRecheck(5)).toBe(0);
    expect(open(d)).toBe(true);
  });
  it('does not let generic tsc success refute a native Angular failure', () => {
    const d = new BuildDiagnostics({ currentSourceRevision: () => 5 });
    d.record(finding);
    d.recordCommand({ command: './node_modules/.bin/ng build --progress=false', exitCode: 1,
      stdout: 'Application bundle generation failed. error NG5002: bad template',
      typecheckProof: { revision: 5, project: true } });
    d.recordCommand({ command, exitCode: 0, stdout: '', stderr: '', typecheckProof: { revision: 5, project: true } });
    expect(d.typecheckEvidenceFromAgentCommands()).toBe('failed');
    expect(open(d)).toBe(true);
  });
  it('a fresh compiler pass does not clear mixed stylesheet evidence', () => {
    const d = new BuildDiagnostics({ currentSourceRevision: () => 5 });
    d.record({ ...finding, detail: finding.detail + '\nCSS class mismatch: missing class' });
    d.recordCommand({ command, exitCode: 0, stdout: '', stderr: '', typecheckProof: { revision: 5, project: true } });
    expect(open(d)).toBe(true);
  });
});

// Source integration guards only: not dynamic coverage of writes during a sandbox operation.
describe('route resolution retains source revision around compilation and style writes', () => {
  const src = readFileSync('src/server/routes/agentv3.ts', 'utf8');
  it('captures after dependency setup and guards settlement after stylesheet normalization', () => {
    const start = src.indexOf('const fastVerifyOnce =');
    const end = src.indexOf('const fastRepair =', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = src.slice(start, end);
    expect(block).toContain("await fastReconcileDependencies('verify');\n            const fastVerifyRevision");
    expect(block).toContain('fastVerifyRevision === getWorkspaceMemory(workspaceId).verificationRevision()');
    expect(block).toContain("buildDiag.evidenceLedger().facts.typecheck?.outcome !== 'failed'");
    expect(block.indexOf('fastVerifyRevision ===')).toBeGreaterThan(block.indexOf('spacingSnapNote(landed)'));
  });
  it('keeps runTsc proof current before resolving compiler-only findings', () => {
    const start = src.indexOf('const runTsc =');
    const end = src.indexOf('let check = await runTsc()', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = src.slice(start, end);
    expect(block).toContain("currentTypecheckProof({ outcome: 'passed', revision }, getWorkspaceMemory(workspaceId).verificationRevision()) === 'passed'");
    expect(block).toContain('buildDiag.resolveCompilerFailuresOnRecheck(revision)');
    expect(block).toContain("buildDiag.evidenceLedger().facts.typecheck?.outcome !== 'failed'");
  });
});
