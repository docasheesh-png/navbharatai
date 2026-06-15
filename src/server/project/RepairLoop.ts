/**
 * Phase 4 — Real auto-repair loop.
 *
 * The old engine "scored" output with regex and shipped apps with known broken
 * references anyway. This loop instead: verify (ProjectVerifier) → if real errors
 * exist, ask a fixer to produce surgical FileEdit ops → apply via EditEngine
 * (snapshotted/reversible) → re-verify → repeat, up to `maxAttempts`. It stops
 * when clean, when the fixer proposes nothing, or when it stops making progress.
 *
 * The fixer (AI call) is INJECTED, so the loop is pure orchestration and fully
 * unit-testable without a live model.
 */
import { VirtualFileSystem } from './ProjectModel';
import { ProjectVersionStore } from './VersionStore';
import { verifyProject, type ProjectIssue, type VerifyResult } from './ProjectVerifier';
import { applyEdits, type FileEdit } from './EditEngine';

/** Produces surgical edits to resolve the given issues for the current VFS. */
export type FixGenerator = (issues: ProjectIssue[], vfs: VirtualFileSystem) => Promise<FileEdit[]>;

export interface RepairResult {
  ok: boolean;
  attempts: number;
  finalVerify: VerifyResult;
  /** Snapshot id captured before the FIRST repair attempt (full rollback point). */
  rollbackSnapshotId?: string;
}

export interface RepairOptions {
  generateFixes: FixGenerator;
  versions?: ProjectVersionStore;
  maxAttempts?: number;
}

export async function autoRepair(vfs: VirtualFileSystem, opts: RepairOptions): Promise<RepairResult> {
  const maxAttempts = opts.maxAttempts ?? 3;
  let attempts = 0;
  let verify = verifyProject(vfs);
  let rollbackSnapshotId: string | undefined;
  let prevErrorCount = verify.errors;

  while (!verify.ok && attempts < maxAttempts) {
    const errorIssues = verify.issues.filter(i => i.severity === 'error');
    const edits = await opts.generateFixes(errorIssues, vfs);
    if (!edits || edits.length === 0) break; // fixer gave up — don't loop pointlessly

    const res = applyEdits(vfs, edits, opts.versions, `auto-repair attempt ${attempts + 1}`);
    if (attempts === 0) rollbackSnapshotId = res.snapshotId;
    attempts++;

    verify = verifyProject(vfs);
    // Bail if no progress (avoid burning attempts on an unfixable issue).
    if (verify.errors >= prevErrorCount) break;
    prevErrorCount = verify.errors;
  }

  return { ok: verify.ok, attempts, finalVerify: verify, rollbackSnapshotId };
}
