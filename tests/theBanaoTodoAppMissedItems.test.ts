// AUTOPSY db07e0af, PART TWO (2026-10-13) — the items the first ledger missed, found when the admin asked
// "sab ho gaya??" and the report was read again, line by line:
//   Q-976  READY_BEFORE_END said "1 more step over 56s": it subtracted a mark measured from the RUNNER's start from
//          an end measured from the BUILD's start, so the fast lane's ~45 s before the runner began were counted as
//          work after the app was finished. About 11 s really ran.
//   Q-977  POST_GREEN_WRITES filed three of OUR files (the end-to-end suite and the architecture note) under
//          "build loop" — the model — because the passes that wrote them named no pass.
//   Q-978  An unimported component the model was handed and then left (LoadingSpinner) shipped. Layer one stops it
//          being planned (Q-925); this is layer two, the deterministic net.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readyOverrunNote, endOfTurnReadyMark } from '../src/server/AgentV3/doneSignal';
import { nameWords, leftoversToRemove, leftoverNote, applyLeftoverNet, applyLeftoverNetAfterBuild } from '../src/server/AgentV3/leftoverComponents';
import { BuildDiagnostics, PROCESS_ONLY_CODES } from '../src/server/AgentV3/BuildDiagnostics';
import { ToolDispatcher } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { FakeActuator } from './helpers/dispatcherHarness';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('Q-976 · the overrun is measured on one clock', () => {
  // The real numbers: the build began at 185.962 s, the runner ~45 s later; judged finished at runner +222.7 s;
  // the line was written at build +278.7 s.
  const T = 1_791_809_453_500;
  const mark = { step: 18, elapsedMs: 222_700, score: 86, at: T };
  it('🔴 with the absolute instant: ~11 s after the judgement, not 56', () => {
    expect(readyOverrunNote(mark, 19, 278_700, { endAt: T + 11_000 })).toBe('The app was judged finished at step 18 (86/100); the build then ran 1 more step(s) over 11s before it ended.');
  });
  it('the old arithmetic is what produced the 56 s', () => {
    const { at: _ignored, ...noInstant } = mark;
    expect(readyOverrunNote(noInstant, 19, 278_700)).toContain('over 56s');
  });
  it('the end-of-turn mark carries the instant it was judged', () => {
    const readiness = { score: 86, ready: true, blockers: [], warnings: [], tier: 'ok' } as never;
    const m = endOfTurnReadyMark({ existing: null, readiness, typeErrors: 0, editingExistingApp: false, wroteThisRun: true, step: 18, elapsedMs: 222_700, at: T });
    expect(m?.at).toBe(T);
  });
  it('both marks the runner makes carry it, and the route passes the end instant', () => {
    const runner = read('src/server/AgentV3/AgentRunner.ts');
    expect(runner).toContain('step: steps, elapsedMs: Date.now() - buildStartMs, at: Date.now(),');
    expect(runner).toContain('readyMark = { step: steps, elapsedMs: Date.now() - buildStartMs, score: readiness.score, at: Date.now() };');
    expect(read('src/server/routes/agentv3.ts')).toContain("projectModule: projectModuleRef?.name ?? null, endAt: Date.now() }),");
  });
});

describe('Q-977 · every finishing write names its pass, so the post-green ledger never blames the model for ours', () => {
  const route = read('src/server/routes/agentv3.ts');
  const lines = route.split('\n');
  /** Line ranges of the passes that wrap their whole body in runInPass (incl. the post-green finishing
   *  rollback, finishingRecheck.ts, which writes under the named `green-guard-restore` pass). */
  const wrappedBlocks = lines.flatMap((l, i) => {
    if (!/await runInPass\('(?:starter-tests|production-defaults|green-guard-restore)'/.test(l)) return [];
    const indent = l.search(/\S/);
    let end = i + 1;
    // The pass ends at its own `});` — its body is not always indented under it.
    while (end < lines.length && !(lines[end].search(/\S/) <= indent && /^\s*\}\);/.test(lines[end]))) end++;
    return [[i, end] as const];
  });
  const inWrapped = (i: number) => wrappedBlocks.some(([a, b]) => i > a && i < b);

  it('the census: each finishing write is inside a named pass', () => {
    const sites = lines.flatMap((l, i) => (/noteFinishingWrite\(|finishingPaths\.add\(/.test(l) && !/const noteFinishingWrite/.test(l) ? [i] : []));
    expect(sites.length).toBeGreaterThanOrEqual(9);
    const unnamed = sites.filter((i) => {
      if (inWrapped(i)) return false;
      const writer = lines.slice(Math.max(0, i - 8), i + 1).reverse().find((l) => /writeFile\(/.test(l));
      return !writer || !/runInPass\(/.test(writer);
    }).map((i) => `${i + 1}: ${lines[i].trim()}`);
    expect(unnamed).toEqual([]);
  });
  it('the four that named nothing before', () => {
    expect(route).toContain("runInPass('e2e-scaffold', () => actuator.writeFile(workspaceId, path, content))");
    expect(route).toContain("runInPass('ambient-shim-cleanup', () => actuator.writeFile(workspaceId, path, stripped.source))");
    expect(route).toContain("runInPass('e2e-tsconfig-exclude', () => actuator.writeFile(workspaceId, 'tsconfig.json', excluded.text))");
    expect(route).toContain("runInPass('architecture-note', () => actuator.writeFile(workspaceId, path, content))");
  });
});

describe('Q-978 · a component nobody asked for and nothing shows is removed, not shipped', () => {
  it('name words', () => {
    expect(nameWords('src/components/LoadingSpinner.tsx')).toEqual(['loading', 'spinner']);
    expect(nameWords('src/components/todo-item.tsx')).toEqual(['todo', 'item']);
    expect(nameWords('src/components/UIButton.tsx')).toEqual(['button']);
  });
  it('🔴 the real case: "Banao" never named a spinner — removed', () => {
    expect(leftoversToRemove(['src/components/LoadingSpinner.tsx'], 'Banao')).toEqual({ remove: ['src/components/LoadingSpinner.tsx'], keep: [] });
  });
  it('a request that names it keeps it (an unfinished request, never a leftover)', () => {
    const d = leftoversToRemove(['src/components/LoadingSpinner.tsx'], 'make a todo app with a loading spinner');
    expect(d.remove).toEqual([]);
    expect(d.keep).toEqual([{ path: 'src/components/LoadingSpinner.tsx', word: 'loading' }]);
    expect(leftoversToRemove(['src/components/Charts.tsx'], 'show a chart of spending').keep).toHaveLength(1);
  });
  it('the kill switch turns it off', () => {
    expect(leftoversToRemove(['src/components/LoadingSpinner.tsx'], 'Banao', { AGENTV3_LEFTOVER_REMOVE: 'off' } as NodeJS.ProcessEnv).remove).toEqual([]);
  });
  it('🔴 end to end through the real recorder: removed, said, and the readiness line withdrawn', async () => {
    const d = new BuildDiagnostics('b', 'ws');
    d.ingestEvent({ type: 'done', ok: true, summary: 'built', readiness: { blockers: [], warnings: ['1 component(s) created but never used: src/components/LoadingSpinner.tsx (LoadingSpinner)', 'No tests at all'] } } as never);
    const removed = await applyLeftoverNet(
      { undefinedClassesNow: async () => ({ orphans: ['src/components/LoadingSpinner.tsx'] }), removeLeftoverFiles: async (p) => [...p] },
      d, 'Banao',
    );
    expect(removed).toEqual(['src/components/LoadingSpinner.tsx']);
    const r = d.report();
    expect(r.problems.map((p) => p.message)).not.toContain('1 component(s) created but never used: src/components/LoadingSpinner.tsx (LoadingSpinner)');
    expect(r.problems.map((p) => p.message)).toContain('No tests at all');
    expect(r.issues.find((i) => i.code === 'LEFTOVER_COMPONENTS')?.message).toContain('Removed 1 component file(s)');
    expect(PROCESS_ONLY_CODES.has('LEFTOVER_COMPONENTS')).toBe(true);
  });
  it('a readiness line that counted more than we removed (the user\'s own unused files) is left standing', async () => {
    const d = new BuildDiagnostics('b', 'ws');
    d.ingestEvent({ type: 'done', ok: true, summary: 'built', readiness: { blockers: [], warnings: ['2 component(s) created but never used: src/components/Old.tsx (Old), src/components/LoadingSpinner.tsx (LoadingSpinner)'] } } as never);
    await applyLeftoverNet({ undefinedClassesNow: async () => ({ orphans: ['src/components/LoadingSpinner.tsx'] }), removeLeftoverFiles: async (p) => [...p] }, d, 'Banao');
    expect(d.report().problems.map((p) => p.message)[0]).toContain('2 component(s) created but never used');
  });
  it('a kept file is said, and its warning stays', async () => {
    const d = new BuildDiagnostics('b', 'ws');
    await applyLeftoverNet({ undefinedClassesNow: async () => ({ orphans: ['src/components/LoadingSpinner.tsx'] }), removeLeftoverFiles: async () => { throw new Error('must not be called'); } }, d, 'todo app with a loading spinner');
    expect(leftoverNote([], [{ path: 'src/components/LoadingSpinner.tsx', word: 'loading' }])).toContain('stays an open warning');
    expect(d.report().issues.find((i) => i.code === 'LEFTOVER_COMPONENTS')?.message).toContain('Kept src/components/LoadingSpinner.tsx');
  });
  it('the dispatcher removes through the same confirm-and-forget path as the model\'s own deletes', async () => {
    class RmActuator extends FakeActuator {
      override async runCommand(_ws: string, cmd: string) {
        const m = /^rm -f -- '([^']+)'$/.exec(cmd);
        if (m) this.files.delete(m[1]);
        return { exitCode: 0, stdout: '', stderr: '' };
      }
    }
    const act = new RmActuator();
    act.files.set('src/components/LoadingSpinner.tsx', 'export default function LoadingSpinner() { return null; }');
    const s = new AgentEventStream();
    const d = new ToolDispatcher(act, 'ws-leftover', new WorkspaceState(s), s);
    const gone: string[] = [];
    d.setFileDeletionSink((p) => gone.push(...p));
    expect(await d.removeLeftoverFiles(['src/components/LoadingSpinner.tsx', '../etc/passwd', '/abs.tsx'])).toEqual(['src/components/LoadingSpinner.tsx']);
    expect(act.files.has('src/components/LoadingSpinner.tsx')).toBe(false);
    expect(gone).toEqual(['src/components/LoadingSpinner.tsx']);
  });
  it('the route runs it once, after the build loop, on a new app only', () => {
    // The guard moved into leftoverComponents.ts when #3698 was merged after #3692 (2026-10-13): the route handler is at
    // TypeScript's control-flow limit (TS2563) and one more `if (a && b && c && d)` crossed it. The facts still travel.
    expect(read('src/server/routes/agentv3.ts')).toContain('await applyLeftoverNetAfterBuild({ ok: result.ok === true, importTurn: isImportTurn, editMode: isEditMode, aborted: abort.signal.aborted }, dispatcher, buildDiag, checksRequest);');
  });
  it('the guard runs the net only for a finished, un-stopped NEW build (the condition that left the route)', async () => {
    const deps = { undefinedClassesNow: async () => ({ orphans: ['src/components/LoadingSpinner.tsx'] }), removeLeftoverFiles: async (p: readonly string[]) => [...p] };
    const report = { record: () => {}, retract: () => 0 };
    const ok = { ok: true, importTurn: false, editMode: false, aborted: false };
    expect(await applyLeftoverNetAfterBuild(ok, deps, report, 'todo app', {})).toEqual(['src/components/LoadingSpinner.tsx']);
    for (const facts of [{ ...ok, ok: false }, { ...ok, importTurn: true }, { ...ok, editMode: true }, { ...ok, aborted: true }]) {
      expect(await applyLeftoverNetAfterBuild(facts, deps, report, 'todo app', {})).toEqual([]);
    }
  });

});
