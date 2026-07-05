import { WorkspaceRegistry } from './WorkspaceRegistry';
import { GeneratedFile } from './types/files';
import { IWorkspaceManager } from './interfaces/IWorkspaceManager';
import { NotFoundError } from './errors/AppMakerErrors';

/**
 * CQRS command (write) side for workspaces — every state-mutating operation lives here.
 * It owns the write path only: create, save files, delete, and status transitions. Reads live in
 * WorkspaceQueryController. Separating them keeps the write path free of read concerns (and vice
 * versa), so each can evolve, be cached, or be routed independently (P4.1).
 */
export class WorkspaceCommandController {
    constructor(
        private manager: IWorkspaceManager,
        private registry: WorkspaceRegistry
    ) {}

    async createWorkspace(workspaceId: string, projectName: string, sourceType: 'generated' | 'cloned'): Promise<void> {
        await this.manager.createWorkspace(workspaceId);
        await this.registry.register({
            workspaceId,
            projectName,
            sourceType,
            status: 'ready',
            createdAt: new Date(),
            updatedAt: new Date()
        });
    }

    async saveFiles(workspaceId: string, files: GeneratedFile[]): Promise<void> {
        const metadata = await this.registry.get(workspaceId);
        if (!metadata) throw new NotFoundError("Workspace not found");

        await this.manager.saveFiles(workspaceId, files);
    }

    async deleteWorkspace(workspaceId: string): Promise<void> {
        await this.manager.deleteWorkspace(workspaceId);
        await this.registry.delete(workspaceId);
    }

    async updateStatus(workspaceId: string, status: 'idle' | 'creating' | 'ready' | 'error'): Promise<void> {
        await this.registry.update(workspaceId, { status });
    }
}
