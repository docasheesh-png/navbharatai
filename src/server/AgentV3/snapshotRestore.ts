import { abortCauseOf } from './buildAbortCause';
import { removablePaths } from './GreenGuard';

export interface SnapshotRestorePlan {
  write: Record<string, string>;
  remove: string[];
}

/** Sandbox operations that actually completed, plus anything that could not be confirmed. */
export interface SnapshotRestoreOutcome {
  restored: string[];
  removed: string[];
  failed: string[];
  stopped: boolean;
}

export interface SnapshotRestoreDeps {
  /** A safety undo may outlive its time budget, but never Stop or ownership of the workspace. */
  stopped: () => boolean;
  write: (path: string, content: string) => Promise<void>;
  remove: (path: string) => Promise<{ exitCode: number }>;
  /** Synchronous bookkeeping for completed sandbox operations, even if Stop arrived in flight. */
  captured?: (applied: SnapshotRestorePlan) => void;
  /** Persist ONLY completed writes. False means the durable copy was not confirmed. */
  persist?: (files: Record<string, string>) => Promise<boolean>;
  /** Forget ONLY confirmed sandbox deletions. False means the durable copy was not confirmed. */
  forget?: (paths: string[]) => Promise<boolean>;
}

/** Budget expiry must not strand a broken repair; Stop and a lost writer must not undo newer work. */
export function snapshotRestoreStopped(signal: AbortSignal | undefined): boolean {
  if (!signal?.aborted) return false;
  switch (abortCauseOf(signal)) {
    case 'watchdog': case 'advisory-cap': case 'cost-cap':
    case 'review-budget': case 'recheck-budget': case 'repair-budget':
      return false;
    default:
      return true;
  }
}

/**
 * The shared automatic-restore door. A planned rollback is not an applied rollback: check the live
 * writer before EVERY mutation, keep each completed operation, and never forget a file whose rm
 * failed. Per-path removes preserve partial success instead of treating a failed batch as success.
 */
export async function applySnapshotRestore(plan: SnapshotRestorePlan, d: SnapshotRestoreDeps): Promise<SnapshotRestoreOutcome> {
  const restored: string[] = [];
  const removed: string[] = [];
  const failed = new Set<string>();
  const landed: Record<string, string> = {};
  const removals = [...new Set(plan.remove)];
  const safeRemovals = new Set(removablePaths(removals));

  for (const [path, content] of Object.entries(plan.write)) {
    if (d.stopped()) break;
    try {
      await d.write(path, content);
      restored.push(path);
      landed[path] = content;
      d.captured?.({ write: { [path]: content }, remove: [] });
    } catch { failed.add(path); }
  }
  for (const path of removals) {
    if (d.stopped()) break;
    if (!safeRemovals.has(path)) { failed.add(path); continue; }
    try {
      const result = await d.remove(path);
      if (result.exitCode !== 0) { failed.add(path); continue; }
      removed.push(path);
      d.captured?.({ write: {}, remove: [path] });
    } catch { failed.add(path); }
  }

  // Recording an in-flight write above is truthful bookkeeping, not permission for another write.
  // A Stop during an await therefore holds the durable mutation as well as the next sandbox one.
  if (restored.length > 0 && d.persist) {
    try {
      if (d.stopped() || !(await d.persist(landed))) restored.forEach((p) => failed.add(p));
    } catch { restored.forEach((p) => failed.add(p)); }
  }
  if (removed.length > 0 && d.forget) {
    try {
      if (d.stopped() || !(await d.forget(removed))) removed.forEach((p) => failed.add(p));
    } catch { removed.forEach((p) => failed.add(p)); }
  }
  const written = new Set(restored);
  const deleted = new Set(removed);
  for (const path of Object.keys(plan.write)) if (!written.has(path)) failed.add(path);
  for (const path of removals) if (!deleted.has(path)) failed.add(path);
  return { restored, removed, failed: [...failed], stopped: d.stopped() };
}

export function snapshotRestoreComplete(plan: SnapshotRestorePlan, outcome: SnapshotRestoreOutcome): boolean {
  return !outcome.stopped && outcome.failed.length === 0
    && Object.keys(plan.write).every((p) => outcome.restored.includes(p))
    && plan.remove.every((p) => outcome.removed.includes(p));
}

export function snapshotRestoreDetail(outcome: SnapshotRestoreOutcome): string {
  return `restored: ${outcome.restored.join(', ') || '—'} · removed: ${outcome.removed.join(', ') || '—'} · failed: ${outcome.failed.join(', ') || '—'}${outcome.stopped ? ' · stopped before completion' : ''}`;
}

/** The live tree after a partial undo, so a later save cannot resurrect failed or already removed files. */
export function snapshotRestoredFiles(current: Record<string, string>, plan: SnapshotRestorePlan, outcome: SnapshotRestoreOutcome): Record<string, string> {
  const applied = { ...current };
  for (const path of outcome.restored) applied[path] = plan.write[path];
  for (const path of outcome.removed) delete applied[path];
  return applied;
}
