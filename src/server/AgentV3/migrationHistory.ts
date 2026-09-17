// GA-6 — Persistent engineering memory, migration-history slice.
//
// The `run_migrations` tool (ToolDispatcher) detects the migration tool, runs each command in the
// sandbox, and reports the REAL exit codes — but it persisted NOTHING across builds. So a follow-up
// build had no memory of which schema was applied, when, or whether it succeeded, and could blindly
// re-run migrations. This slice records each migration run per project and feeds a compact history
// back into the tool's output so the agent SEES prior applied migrations before re-running.
//
// PURE CORE (foldMigrationRun / summarizeMigrationHistory) is unit-tested and I/O-free; the Firestore
// load/record wrappers VITEST-skip (getServerDb() returns null under test), are best-effort, and never
// throw — mirroring TechnicalDebtTracker. Keyed by workspaceId (the ToolDispatcher has no userId).
//
// Collection: `migrationHistory/{projectId}`.

import { doc, getDoc, setDoc, getServerDb as getDb } from '../lib/serverDb';
import type { MigrationTool } from './MigrationPlanner';

/** One recorded migration run for a project. */
export interface MigrationRun {
  tool: MigrationTool;
  commands: string[];
  ok: boolean;
  exitCodes: number[];
  /** ISO timestamp of when the run finished. */
  ranAt: string;
}

interface StoredMigrationHistory {
  runs: MigrationRun[];
  updatedAt?: string;
}

const MAX_RUNS = 50;
const SUMMARY_LIMIT = 5;

/** Append a run to the history (capped, newest last). Pure — returns a NEW array. */
export function foldMigrationRun(existing: MigrationRun[] | null | undefined, run: MigrationRun, cap = MAX_RUNS): MigrationRun[] {
  const base = Array.isArray(existing) ? existing : [];
  const next = [...base, run];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/** A compact read-back block of the latest migration runs, or '' when empty. Pure. */
export function summarizeMigrationHistory(runs: ReadonlyArray<MigrationRun> | null | undefined, limit = SUMMARY_LIMIT): string {
  if (!runs || runs.length === 0) return '';
  const latest = runs.slice(-limit);
  const lines = latest.map((r) => {
    const cmd = r.commands && r.commands.length ? r.commands.join(' && ') : '(no command)';
    return `  • ${String(r.ranAt).slice(0, 10)} ${r.tool}: ${cmd} → ${r.ok ? 'ok' : 'FAILED'}`;
  });
  return `Prior migrations for this project:\n${lines.join('\n')}`;
}

/** Load a project's migration history ([] when none / unavailable). Best-effort, never throws. */
/**
 * The read, with the ONE distinction `loadMigrationHistory` throws away: did we READ the document, or
 * merely fail to?
 *
 * 🔴 WHY IT MATTERS (2026-09-17, third instance of one class in one day). `loadMigrationHistory`
 * answers `[]` for BOTH *"this project has no history"* and *"the read failed"*, and
 * `recordMigrationRun` folds that answer into a new list and writes it back with `{ merge: false }`.
 * So a transient Firestore blip does not "start fresh" — it REPLACES a project's whole migration
 * history with the single run that happened to be in flight.
 *
 * The same shape, fixed the same day, in: `FirestoreWorkspaceMemoryStore` (one Planner chat turn
 * could delete a workspace's entire memory) and `WorkspaceFileStore`'s shrink guard (a failed read
 * made the guard see an empty index and authorise the wipe it exists to prevent).
 *
 * `ok: false` means only "we do not know". It is never a licence to overwrite.
 */
export async function loadMigrationHistoryResult(
  projectId: string,
): Promise<{ ok: true; runs: MigrationRun[] } | { ok: false }> {
  const db = getDb();
  // No Firestore configured at all (tests, local dev) is a KNOWN state, not a failed read: there is
  // no document, and nothing a write could destroy.
  if (!db || !projectId) return { ok: true, runs: [] };
  try {
    const snap = await getDoc(doc(db, 'migrationHistory', projectId));
    if (!snap.exists()) return { ok: true, runs: [] };
    const data = snap.data() as StoredMigrationHistory | undefined;
    return { ok: true, runs: Array.isArray(data?.runs) ? data!.runs : [] };
  } catch {
    return { ok: false };
  }
}

/**
 * ⚠️ READ-ONLY CALLERS ONLY. It collapses "no history" and "could not read" into `[]`, which is fine
 * for the read-back block the agent is shown — an empty block is honest there. A caller that goes on
 * to WRITE must use `loadMigrationHistoryResult`, or it will replace a real history with one run.
 */
export async function loadMigrationHistory(projectId: string): Promise<MigrationRun[]> {
  const result = await loadMigrationHistoryResult(projectId);
  return result.ok ? result.runs : [];
}

/** Append one migration run to the project's history. Best-effort, never throws. */
export async function recordMigrationRun(projectId: string, run: MigrationRun): Promise<void> {
  const db = getDb();
  if (!db || !projectId) return;
  try {
    const existing = await loadMigrationHistoryResult(projectId);
    // 🔒 COULD NOT READ ⇒ DO NOT WRITE. The write below is a full replace, so folding one run into an
    // assumed-empty history would delete every earlier run. Losing ONE run's record is strictly
    // better: the history exists so the agent can see what it already migrated, and a missing entry
    // costs it one fact, while a wiped history costs it all of them.
    if (!existing.ok) return;
    const runs = foldMigrationRun(existing.runs, run);
    await setDoc(doc(db, 'migrationHistory', projectId), { runs, updatedAt: run.ranAt }, { merge: false });
  } catch (err) {
    console.error('[MIGRATION-HISTORY] recordMigrationRun failed:', err);
  }
}
