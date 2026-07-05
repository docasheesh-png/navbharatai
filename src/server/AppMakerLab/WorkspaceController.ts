import { WorkspaceRegistry } from './WorkspaceRegistry';
import { WorkspaceInfo } from './types/workspace';
import { GeneratedFile } from './types/files';
import { IWorkspaceManager } from './interfaces/IWorkspaceManager';
import { WorkspaceCommandController } from './WorkspaceCommandController';
import { WorkspaceQueryController } from './WorkspaceQueryController';

/**
 * CQRS facade (P4.1): the command (write) and query (read) paths are now fully separated into
 * WorkspaceCommandController and WorkspaceQueryController. This class preserves the original
 * WorkspaceController API — delegating each call to the correct side — so existing callers are
 * unchanged, while `.commands` / `.queries` expose an explicit write-only or read-only handle for
 * code that wants to depend on just one side of the split.
 */
export class WorkspaceController {
    readonly commands: WorkspaceCommandController;
    readonly queries: WorkspaceQueryController;

    constructor(
        manager: IWorkspaceManager,
        registry: WorkspaceRegistry
    ) {
        this.commands = new WorkspaceCommandController(manager, registry);
        this.queries = new WorkspaceQueryController(manager, registry);
    }

    // ── Commands (write path → WorkspaceCommandController) ──────────────────────────
    createWorkspace(workspaceId: string, projectName: string, sourceType: 'generated' | 'cloned'): Promise<void> {
        return this.commands.createWorkspace(workspaceId, projectName, sourceType);
    }

    saveFiles(workspaceId: string, files: GeneratedFile[]): Promise<void> {
        return this.commands.saveFiles(workspaceId, files);
    }

    deleteWorkspace(workspaceId: string): Promise<void> {
        return this.commands.deleteWorkspace(workspaceId);
    }

    updateStatus(workspaceId: string, status: 'idle' | 'creating' | 'ready' | 'error'): Promise<void> {
        return this.commands.updateStatus(workspaceId, status);
    }

    // ── Queries (read path → WorkspaceQueryController) ──────────────────────────────
    getWorkspaceInfo(workspaceId: string): Promise<WorkspaceInfo> {
        return this.queries.getWorkspaceInfo(workspaceId);
    }
}
