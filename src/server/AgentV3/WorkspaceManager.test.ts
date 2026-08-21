import { describe, it, expect, vi } from 'vitest';
import { purgeWorkspace, computeWorkspaceQuota, maxWorkspacesLimit, type PurgeDeps } from './WorkspaceManager';

const okDeps = (): PurgeDeps => ({
  removeConversation: vi.fn(async () => {}),
  purgeFiles: vi.fn(async () => {}),
  deletePlan: vi.fn(async () => {}),
  deleteMemory: vi.fn(async () => {}),
  deleteDiagnostics: vi.fn(async () => {}),
  releaseDeployment: vi.fn(async () => {}),
});

describe('purgeWorkspace — cascade cleanup (GA-1, orphan-leak fix)', () => {
  it('calls EVERY per-workspace store with the workspaceId (no orphans left)', async () => {
    const deps = okDeps();
    const r = await purgeWorkspace(deps, 'ws-1');
    // The regression: a shallow delete used to touch ONLY the conversation. Every store must be purged.
    for (const fn of Object.values(deps)) {
      expect(fn).toHaveBeenCalledWith('ws-1');
      expect(fn).toHaveBeenCalledTimes(1);
    }
    expect(r.ok).toBe(true);
    expect(r.stores.map((s) => s.store)).toEqual(['conversation', 'files', 'plan', 'memory', 'diagnostics', 'deployment']);
    expect(r.stores.every((s) => s.ok)).toBe(true);
  });

  it('is best-effort: one store failing never aborts the rest, and is reported honestly', async () => {
    const deps = okDeps();
    (deps.purgeFiles as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('firestore down'));
    const r = await purgeWorkspace(deps, 'ws-2');
    // Every OTHER store still ran despite the files failure.
    expect(deps.removeConversation).toHaveBeenCalled();
    expect(deps.releaseDeployment).toHaveBeenCalled();
    expect(r.ok).toBe(false);
    const files = r.stores.find((s) => s.store === 'files')!;
    expect(files.ok).toBe(false);
    expect(files.error).toContain('firestore down');
    // The 5 healthy stores are still ok:true.
    expect(r.stores.filter((s) => s.ok).length).toBe(5);
  });

  it('never throws even if multiple stores fail', async () => {
    const deps = okDeps();
    (deps.deletePlan as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('a'));
    (deps.deleteMemory as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('b'));
    await expect(purgeWorkspace(deps, 'ws-3')).resolves.toMatchObject({ ok: false });
  });
});

describe('computeWorkspaceQuota + maxWorkspacesLimit (pure)', () => {
  it('unlimited (limit 0) never over-limit; a positive limit blocks only when exceeded', () => {
    expect(computeWorkspaceQuota(50, 0)).toEqual({ workspaceCount: 50, workspaceLimit: 0, overLimit: false });
    expect(computeWorkspaceQuota(5, 10).overLimit).toBe(false);
    expect(computeWorkspaceQuota(10, 10).overLimit).toBe(false); // at the limit, not over
    expect(computeWorkspaceQuota(11, 10).overLimit).toBe(true);
  });

  it('reads AGENTV3_MAX_WORKSPACES; unset/invalid → 0 (unlimited)', () => {
    expect(maxWorkspacesLimit({ AGENTV3_MAX_WORKSPACES: '25' } as NodeJS.ProcessEnv)).toBe(25);
    expect(maxWorkspacesLimit({} as NodeJS.ProcessEnv)).toBe(0);
    expect(maxWorkspacesLimit({ AGENTV3_MAX_WORKSPACES: 'abc' } as NodeJS.ProcessEnv)).toBe(0);
    expect(maxWorkspacesLimit({ AGENTV3_MAX_WORKSPACES: '-3' } as NodeJS.ProcessEnv)).toBe(0);
  });
});
