import { describe, it, expect } from 'vitest';
import { trimReportForStorage, saveDiagnosticsHistory, listDiagnosticsHistory, getDiagnosticsHistoryItem } from './DiagnosticsStore';
import type { BuildDiagnosticsReport } from './BuildDiagnostics';

function baseReport(over: Partial<BuildDiagnosticsReport> = {}): BuildDiagnosticsReport {
  return {
    schema: 'navbharatai.v3.build-diagnostics/1',
    startedAt: 1000,
    counts: { total: 0, errors: 0, warnings: 0, autoResolved: 0, unresolved: 0 },
    issues: [],
    problems: [],
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

// P-REPORT.4 — history. Firestore is unreachable under VITEST (VITEST-skip, same contract as
// saveDiagnostics/loadDiagnostics above) — these confirm the best-effort, never-throws contract
// rather than real persistence (that is verified against real Firestore, like FirestoreConversationStore).
describe('saveDiagnosticsHistory / listDiagnosticsHistory / getDiagnosticsHistoryItem (VITEST-skip, best-effort)', () => {
  it('saveDiagnosticsHistory never throws, even for a settled report, with no reachable Firestore', async () => {
    const settled = baseReport({ endedAt: 2000, ok: true });
    await expect(saveDiagnosticsHistory('ws-1', settled)).resolves.toBeUndefined();
  });

  it('saveDiagnosticsHistory is a no-op for a report that has not settled yet (endedAt unset)', async () => {
    const unsettled = baseReport(); // no endedAt
    await expect(saveDiagnosticsHistory('ws-1', unsettled)).resolves.toBeUndefined();
  });

  it('listDiagnosticsHistory resolves to [] (never throws) when Firestore is unreachable', async () => {
    await expect(listDiagnosticsHistory('ws-1')).resolves.toEqual([]);
  });

  it('getDiagnosticsHistoryItem resolves to null (never throws) when Firestore is unreachable', async () => {
    await expect(getDiagnosticsHistoryItem('ws-1', '2000')).resolves.toBeNull();
  });
});
