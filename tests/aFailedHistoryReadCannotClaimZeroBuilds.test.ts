import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import { BuildDiagnostics, type BuildDiagnosticsReport } from '../src/server/AgentV3/BuildDiagnostics';
import {
  listDiagnosticsHistory, listDiagnosticsHistoryResult, type DiagnosticsHistoryEntry,
} from '../src/server/AgentV3/DiagnosticsStore';
import { summarizeSession, sessionSummaryLine } from '../src/server/AgentV3/sessionSummary';
import { isUserStoppedBuild } from '../src/server/lib/buildFailureCategory';

// Execute the actual route's history-read continuation AND final session-summary branch, without
// importing its provider/server graph. AST boundaries fail closed if either production path moves.
// Only the database read and clock are injected; the recorder and cancellation/summary helpers are real.
const route = ts.createSourceFile('agentv3.ts', readFileSync('src/server/routes/agentv3.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const reads: ts.Expression[] = [];
const summaries: ts.IfStatement[] = [];
function visit(node: ts.Node): void {
  if (ts.isExpressionStatement(node) && ts.isVoidExpression(node.expression)
      && node.expression.getText(route).includes('buildDiag.setPriorFailedBuilds(')) {
    reads.push(node.expression.expression);
  }
  if (ts.isIfStatement(node) && node.expression.getText(route) === 'sessionHistoryForSummary') summaries.push(node);
  ts.forEachChild(node, visit);
}
visit(route);
if (reads.length !== 1 || summaries.length !== 1) throw new Error('Expected one production history read and one session finalizer');
const body = ts.transpileModule(`
  return async () => {
    let sessionHistoryForSummary = null;
    // Await only in the harness, so it can inspect the non-blocking production continuation.
    await ${reads[0].getText(route)};
    ${summaries[0].getText(route)}
    return { report: JSON.parse(JSON.stringify(buildDiag.report())), seed: sessionHistoryForSummary };
  };
`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

type HistoryResult = Awaited<ReturnType<typeof listDiagnosticsHistoryResult>>;
type HistoryReader = typeof listDiagnosticsHistoryResult;
type Observation = {
  report: BuildDiagnosticsReport;
  seed: { history: DiagnosticsHistoryEntry[]; startedAt: number } | null;
};
const START = 100_000;
const END = 160_000;
function runRoute(read: HistoryReader = listDiagnosticsHistoryResult): Promise<Observation> {
  const buildDiag = new BuildDiagnostics({ now: () => START });
  const env = {
    workspaceId: 'offline-history-workspace', buildStartedAt: START, buildDiag, buildDiagRef: buildDiag,
    listDiagnosticsHistoryResult: read,
    // Keep the legacy API available so reverting the production call reproduces its actual collapse.
    listDiagnosticsHistory: read === listDiagnosticsHistoryResult
      ? listDiagnosticsHistory
      : async (id: string, limit?: number) => (await read(id, limit)).entries,
    isUserStoppedBuild, summarizeSession, sessionSummaryLine, Date: { now: () => END },
  };
  return new Function(...Object.keys(env), body)(...Object.values(env))();
}
const entry = (id: string, extra: Partial<DiagnosticsHistoryEntry> = {}): DiagnosticsHistoryEntry => ({
  id, startedAt: 1_000, endedAt: 2_000,
  counts: { total: 0, errors: 0, warnings: 0, autoResolved: 0, unresolved: 0 },
  ...extra,
});
const reader = (result: HistoryResult) => vi.fn<HistoryReader>().mockResolvedValue(result);

afterEach(() => vi.restoreAllMocks());

describe('a failed history read cannot claim zero prior failures or a one-turn session', () => {
  it('reproduces the real unavailable-store contract through the production caller', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    // VITEST disables Firestore in the real store. No DB, credentials or network are used.
    await expect(listDiagnosticsHistoryResult('offline-history-workspace', 50)).resolves.toEqual({ entries: [], ok: false });
    await expect(listDiagnosticsHistory('offline-history-workspace', 50)).resolves.toEqual([]);
    const { report, seed } = await runRoute();
    expect(logged).toHaveBeenCalled();
    expect.soft(report).not.toHaveProperty('priorFailedBuilds');
    expect.soft(report).not.toHaveProperty('session');
    expect.soft(seed).toBeNull();
  });

  it.each([{ entries: [] }, { entries: [entry('partial', { ok: false })] }])('does not stamp or seed an unsuccessful read, even with partial rows: $entries', async ({ entries }) => {
    const read = reader({ entries, ok: false });
    const { report, seed } = await runRoute(read);
    expect(read).toHaveBeenCalledExactlyOnceWith('offline-history-workspace', 50);
    expect.soft(report).not.toHaveProperty('priorFailedBuilds');
    expect.soft(report).not.toHaveProperty('session');
    expect.soft(seed).toBeNull();
  });

  it('still reports a successful empty history as zero and summarizes the real elapsed build time', async () => {
    const read = reader({ entries: [], ok: true });
    const { report, seed } = await runRoute(read);
    expect(read).toHaveBeenCalledExactlyOnceWith('offline-history-workspace', 50);
    expect(report.priorFailedBuilds).toBe(0);
    expect(seed).toEqual({ history: [], startedAt: START });
    expect(report.session).toEqual({ turns: 1, elapsedMs: END - START, dataLossTotal: 0, failedTurns: 0, truncated: false, line: '' });
  });

  it('counts real earlier failures, not successful, unknown-outcome or user-cancelled builds', async () => {
    const entries = [
      entry('failed', { ok: false, dataLossCount: 2 }),
      entry('success', { ok: true }),
      entry('pending', { endedAt: undefined }),
      entry('stopped', { ok: false, userStopped: true }),
    ];
    const { report, seed } = await runRoute(reader({ entries, ok: true }));
    expect(report.priorFailedBuilds).toBe(1);
    expect(seed).toEqual({ history: entries, startedAt: START });
    expect(report.session).toMatchObject({ turns: 5, elapsedMs: END - 1_000, dataLossTotal: 2, failedTurns: 1, truncated: false });
  });

  it('preserves legacy cancellation-code exclusion from the prior-failure count', async () => {
    const stopped = { ...entry('legacy-stop', { ok: false }), outcomeCode: 'OUTCOME_USER_STOPPED' };
    const { report } = await runRoute(reader({ entries: [stopped], ok: true }));
    expect(report.priorFailedBuilds).toBe(0);
  });

  it('still treats a thrown read as best-effort unknown, not a build failure', async () => {
    const read = vi.fn<HistoryReader>().mockRejectedValue(new Error('synthetic read rejection'));
    const { report, seed } = await runRoute(read);
    expect.soft(report).not.toHaveProperty('priorFailedBuilds');
    expect.soft(report).not.toHaveProperty('session');
    expect.soft(seed).toBeNull();
  });
});
