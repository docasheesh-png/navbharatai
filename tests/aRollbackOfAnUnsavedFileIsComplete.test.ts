// failedbr #1808 (2026-11-20): the finishing-pass rollback removed `playwright.config.ts` and `e2e/smoke.spec.ts` from
// the sandbox, then listed both as FAILED and called the rollback incomplete: they had never been saved durably, the
// durable delete removed 0, and the restore door read `> 0` as "the forget failed".
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applySnapshotRestore, snapshotRestoreComplete } from '../src/server/AgentV3/snapshotRestore';
import { removeWorkspaceFilesResult } from '../src/server/AgentV3/WorkspaceFileStore';

describe('a rollback of files that were never saved durably is complete (failedbr #1808)', () => {
  const plan = { write: {}, remove: ['playwright.config.ts', 'e2e/smoke.spec.ts'] };
  const sandbox = { stopped: () => false, write: async () => {}, remove: async () => ({ exitCode: 0, stdout: '', stderr: '' }) };

  it('a forget that found nothing to remove completes the rollback', async () => {
    const outcome = await applySnapshotRestore(plan, { ...sandbox, forget: async () => true });
    expect(outcome.failed).toEqual([]);
    expect(snapshotRestoreComplete(plan, outcome)).toBe(true);
  });

  it('a forget that really failed still marks the files failed', async () => {
    const outcome = await applySnapshotRestore(plan, { ...sandbox, forget: async () => false });
    expect(outcome.failed.sort()).toEqual(['e2e/smoke.spec.ts', 'playwright.config.ts']);
  });

  it('the store says "nothing to do" apart from "could not": an empty request is ok, no store is not', async () => {
    expect(await removeWorkspaceFilesResult('ws', [])).toEqual({ removed: 0, ok: true });
    expect((await removeWorkspaceFilesResult('ws', ['a.ts'])).ok).toBe(false); // no Firestore in tests
  });

  it('the route reads the forget from `.ok`, never from a count', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toContain('forget: async (paths) => (await removeWorkspaceFilesResult(workspaceId, paths)).ok,');
    expect(route).not.toContain('forget: async (paths) => (await removeWorkspaceFiles(workspaceId, paths)) > 0');
  });
});
