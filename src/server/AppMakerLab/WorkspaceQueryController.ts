import { WorkspaceRegistry } from './WorkspaceRegistry';
import { WorkspaceMetadata, WorkspaceInfo } from './types/workspace';
import { IWorkspaceManager } from './interfaces/IWorkspaceManager';
import { NotFoundError } from './errors/AppMakerErrors';

/**
 * CQRS query (read) side for workspaces — every read-only lookup lives here and MUTATES NOTHING.
 * The command path (create/save/delete/status) lives in WorkspaceCommandController. Because reads
 * never mutate, this side is safe to cache, replicate, or fan out independently of writes (P4.1).
 */
export class WorkspaceQueryController {
    constructor(
        private manager: IWorkspaceManager,
        private registry: WorkspaceRegistry
    ) {}

    /** Full workspace view: registry metadata joined with the manager's on-disk file summary. */
    async getWorkspaceInfo(workspaceId: string): Promise<WorkspaceInfo> {
        const metadata = await this.registry.get(workspaceId);
        if (!metadata) throw new NotFoundError("Workspace not found");

        const info = await this.manager.getWorkspaceInfo(workspaceId);
        return {
            ...metadata,
            rootPath: info.rootPath,
            files: info.files
        };
    }

    /** Registry metadata only (no disk read). Undefined when the workspace does not exist. */
    async getMetadata(workspaceId: string): Promise<WorkspaceMetadata | undefined> {
        return this.registry.get(workspaceId);
    }

    /** List all known workspaces (metadata only). */
    async listWorkspaces(): Promise<WorkspaceMetadata[]> {
        return this.registry.list();
    }
}
