import { describe, it, expect } from 'vitest';
import { trimReportForStorage } from './DiagnosticsStore';
import type { BuildDiagnosticsReport } from './BuildDiagnostics';

function baseReport(over: Partial<BuildDiagnosticsReport> = {}): BuildDiagnosticsReport {
  return {
    schema: 'navbharatai.v3.build-diagnostics/1',
    startedAt: 1000,
    counts: { total: 0, errors: 0, warnings: 0, autoResolved: 0, unresolved: 0 },
    issues: [],
    ...over,
  };
}

describe('trimReportForStorage', () => {
  it('keeps a small report intact and stays well under the 1 MB Firestore limit', () => {
    const r = baseReport({
      issues: [{ ts: 1, phase: 'build', severity: 'error', code: 'X', message: 'boom', autoResolved: false }],
      commands: [{ ts: 1, command: 'npm i', exitCode: 0, stdout: 'ok', stderr: '' }],
    });
    const trimmed = trimReportForStorage(r);
    expect(trimmed.issues).toHaveLength(1);
    expect(trimmed.commands).toHaveLength(1);
    expect(Buffer.byteLength(JSON.stringify(trimmed), 'utf8')).toBeLessThan(900 * 1024);
  });

  it('caps a huge report to fit Firestore — keeps the NEWEST detail, trims heavy channels', () => {
    const bigIssues = Array.from({ length: 2000 }, (_, i) => ({ ts: i, phase: 'build' as const, severity: 'info' as const, code: 'STEP', message: `step ${i} ${'x'.repeat(300)}`, autoResolved: true }));
    const bigCmds = Array.from({ length: 300 }, (_, i) => ({ ts: i, command: `cmd ${i}`, exitCode: 0, stdout: 'y'.repeat(4000), stderr: 'z'.repeat(4000) }));
    const bigLlm = Array.from({ length: 300 }, (_, i) => ({ ts: i, ok: true, promptPreview: 'p'.repeat(2000), responsePreview: 'r'.repeat(2000) }));
    const trimmed = trimReportForStorage(baseReport({ issues: bigIssues, commands: bigCmds, llmCalls: bigLlm }));
    expect(trimmed.issues!.length).toBeLessThanOrEqual(500);
    expect(trimmed.commands!.length).toBeLessThanOrEqual(40);
    expect(trimmed.llmCalls!.length).toBeLessThanOrEqual(40);
    // newest items are retained (issues end at step 1999)
    expect(trimmed.issues![trimmed.issues!.length - 1].message).toContain('step 1999');
    // heavy strings shrunk + total fits the doc limit
    expect(trimmed.commands![0].stdout.length).toBeLessThan(1600);
    expect(Buffer.byteLength(JSON.stringify(trimmed), 'utf8')).toBeLessThan(900 * 1024);
  });

  it('leaves the offending generatedFiles channel untouched (it is the bug evidence)', () => {
    const r = baseReport({ generatedFiles: [{ ts: 1, path: 'src/App.tsx', content: 'const x = 1;', note: 'referenced by a compile error' }] });
    expect(trimReportForStorage(r).generatedFiles).toEqual(r.generatedFiles);
  });
});
