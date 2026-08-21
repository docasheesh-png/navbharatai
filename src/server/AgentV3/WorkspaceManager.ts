// GA-1 — Multi-Workspace Manager. Listing + switching + a live-deployment dot already exist (the
// `/conversations` routes; conversationId == workspaceId, #837). The two real gaps were QUOTA and a
// true cascade CLEANUP: deleting a project ran a SHALLOW conversation delete that left the workspace's
// files, plan, memory, diagnostics and deployment docs ORPHANED in Firestore forever. This module adds
// the orchestrator that fixes that (rule 4 — root-cause), plus the pure quota logic.
//
// `purgeWorkspace` is DEPENDENCY-INJECTED (each store's delete is passed in) so it is fully unit-testable
// and decoupled — and BEST-EFFORT by construction: one store failing never aborts the rest, and it
// returns an honest per-store report instead of throwing. The pure quota helpers have no I/O.

/** Per-store outcome of a cascade purge. */
export interface PurgeStoreResult {
  store: string;
  ok: boolean;
  error?: string;
}

export interface PurgeResult {
  workspaceId: string;
  /** One entry per store the purge fanned out to, in deletion order. */
  stores: PurgeStoreResult[];
  /** True only when EVERY store's delete succeeded. */
  ok: boolean;
}

/** The per-store delete operations `purgeWorkspace` fans out to (injected for testability). */
export interface PurgeDeps {
  removeConversation: (workspaceId: string) => Promise<void>;
  purgeFiles: (workspaceId: string) => Promise<void>;
  deletePlan: (workspaceId: string) => Promise<void>;
  deleteMemory: (workspaceId: string) => Promise<void>;
  deleteDiagnostics: (workspaceId: string) => Promise<void>;
  /**
   * The deployment registry entry. ⚠️ Deliberately NOT a delete (2026-08-21).
   *
   * Purging the record used to leave the published app LIVE at its public URL while erasing the only
   * entry admin takedown reads from — an app nobody could find, manage or remove, still holding one of
   * the platform's scarce Firebase channels. Retaining a marked record keeps it reachable whatever we
   * later decide about taking such apps offline.
   */
  releaseDeployment: (workspaceId: string) => Promise<void>;
}

/**
 * Cascade-delete EVERY per-workspace store for one project so nothing is orphaned. Best-effort: a store
 * that throws is recorded as failed and the rest still run (never throws). Returns an honest report.
 * `workspaceId === conversationId` (#837), so the conversation delete is keyed on the same id.
 */
export async function purgeWorkspace(deps: PurgeDeps, workspaceId: string): Promise<PurgeResult> {
  const stores: PurgeStoreResult[] = [];
  const run = async (store: string, fn: (id: string) => Promise<void>) => {
    try {
      await fn(workspaceId);
      stores.push({ store, ok: true });
    } catch (e) {
      stores.push({ store, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  };
  // Order: conversation first (the user-visible record), then the data it owned.
  await run('conversation', deps.removeConversation);
  await run('files', deps.purgeFiles);
  await run('plan', deps.deletePlan);
  await run('memory', deps.deleteMemory);
  await run('diagnostics', deps.deleteDiagnostics);
  await run('deployment', deps.releaseDeployment);
  return { workspaceId, stores, ok: stores.every((s) => s.ok) };
}

export interface WorkspaceQuota {
  workspaceCount: number;
  /** 0 = unlimited / display-only (never blocks). */
  workspaceLimit: number;
  overLimit: boolean;
}

/** The per-user workspace cap from the env (`AGENTV3_MAX_WORKSPACES`), or 0 (unlimited) when unset/invalid. Pure. */
export function maxWorkspacesLimit(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number((env.AGENTV3_MAX_WORKSPACES || '').trim());
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}

/** Compute a user's workspace quota verdict. Pure. `overLimit` is only true when a positive limit is set
 *  AND the count exceeds it (so an unset/0 limit never blocks — it is display-only). */
export function computeWorkspaceQuota(workspaceCount: number, workspaceLimit: number): WorkspaceQuota {
  const count = Math.max(0, Math.floor(workspaceCount || 0));
  const limit = Math.max(0, Math.floor(workspaceLimit || 0));
  return { workspaceCount: count, workspaceLimit: limit, overLimit: limit > 0 && count > limit };
}
