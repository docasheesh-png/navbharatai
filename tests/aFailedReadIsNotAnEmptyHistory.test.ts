import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { foldMigrationRun, loadMigrationHistory, loadMigrationHistoryResult } from '../src/server/AgentV3/migrationHistory';

/**
 * 🔴 THE THIRD INSTANCE OF ONE CLASS IN ONE DAY (2026-09-17).
 *
 * THE CLASS, named so it is recognised the fourth time: **a read whose FAILURE is indistinguishable
 * from an EMPTY result, feeding a write that REPLACES the whole document.** Each instance reads as
 * ordinary defensive code — `catch { return []; }` — and each one turns a transient Firestore blip
 * into permanent data loss, because "there is nothing there" and "I could not see" produce the same
 * value and only one of them licenses an overwrite.
 *
 *  1. `FirestoreWorkspaceMemoryStore` — one Planner chat turn could delete a workspace's entire
 *     episode history and project graph.
 *  2. `WorkspaceFileStore`'s shrink guard — a failed read made the guard see an empty index and
 *     authorise the very wipe it was written to prevent ("49 files thi! 3 rah gayi kyu?!").
 *  3. **Here.** `loadMigrationHistory` answers `[]` for both cases; `recordMigrationRun` folds that
 *     into a new list and writes it back with `{ merge: false }` — replacing a project's whole
 *     migration history with the single run that happened to be in flight.
 *
 * ⚠️ WHAT THE SWEEP FOUND SAFE, recorded so nobody re-checks it: `UserLessonBrain.recordBuildLessons`
 * and `MistakeLedger.recordBuild` read INSIDE the same `try` as their write, so a throwing read skips
 * the write entirely. Every `tx.set` site is inside a Firestore transaction, where a failed read
 * aborts the transaction. `DecisionTraceManager` and `MegaRoadmapStore` write state their caller
 * already owns rather than folding a read into it. Those are not this class.
 */

describe('loadMigrationHistoryResult — "no history" and "could not read" are different answers', () => {
  it('reports a KNOWN empty history when Firestore is not configured', async () => {
    // Under VITEST there is no Firestore. That is a known state, not a failed read: there is no
    // document, so there is nothing a write could destroy.
    await expect(loadMigrationHistoryResult('ws-1')).resolves.toEqual({ ok: true, runs: [] });
  });

  it('an empty project id is also a known state, not a failure', async () => {
    await expect(loadMigrationHistoryResult('')).resolves.toEqual({ ok: true, runs: [] });
  });

  it('the read-only wrapper still answers [] — its callers only display the history', async () => {
    await expect(loadMigrationHistory('ws-1')).resolves.toEqual([]);
  });
});

describe('foldMigrationRun is unchanged — this fix adds a gate, it does not alter the fold', () => {
  const run = (tool: string) => ({ tool, commands: ['x'], ok: true, ranAt: '2026-09-17T00:00:00Z' });

  it('appends to an existing history', () => {
    expect(foldMigrationRun([run('a')], run('b')).map((r) => r.tool)).toEqual(['a', 'b']);
  });

  it('treats a null/undefined history as empty', () => {
    expect(foldMigrationRun(null, run('a')).map((r) => r.tool)).toEqual(['a']);
    expect(foldMigrationRun(undefined, run('a')).map((r) => r.tool)).toEqual(['a']);
  });

  it('caps the history from the OLD end, keeping the newest', () => {
    const existing = ['a', 'b', 'c'].map(run);
    expect(foldMigrationRun(existing, run('d'), 3).map((r) => r.tool)).toEqual(['b', 'c', 'd']);
  });
});

/** ⚠️ REVERSION GUARD — reads CODE with comments stripped, so prose can neither satisfy nor defeat it. */
describe('the writer refuses to fold into a history it could not read', () => {
  const code = readFileSync(join(__dirname, '../src/server/AgentV3/migrationHistory.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('recordMigrationRun uses the result-returning read, not the collapsing wrapper', () => {
    const fn = code.slice(code.indexOf('export async function recordMigrationRun'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    expect(body).toContain('loadMigrationHistoryResult(projectId)');
    expect(body).not.toContain('await loadMigrationHistory(');
  });

  it('…and returns BEFORE the write when the read was not ok', () => {
    const fn = code.slice(code.indexOf('export async function recordMigrationRun'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    expect(body).toContain('if (!existing.ok) return;');
    // Order is the whole fix: after the write, the guard would be decoration.
    expect(body.indexOf('if (!existing.ok) return;')).toBeLessThan(body.indexOf('setDoc('));
  });

  it('the write is still a full replace — the gate is what makes that safe', () => {
    // Not "switch to merge": the fold already produces the complete, capped list, and a merge would
    // leave the capped-off runs behind for ever. The read gate is the correct fix, not the write mode.
    expect(code).toContain('{ merge: false }');
  });

  it('the collapsing wrapper survives for read-only callers, and says so', () => {
    // `ToolDispatcher` shows the history to the agent; an empty block there is honest.
    expect(code).toContain('export async function loadMigrationHistory(');
    const raw = readFileSync(join(__dirname, '../src/server/AgentV3/migrationHistory.ts'), 'utf8');
    expect(raw).toContain('READ-ONLY CALLERS ONLY');
  });
});
