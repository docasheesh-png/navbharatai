import { WorkspaceRegistry } from './WorkspaceRegistry';
import { WorkspaceMetadata, WorkspaceInfo } from './types/workspace';
import { GeneratedFile } from './types/files';
import { IWorkspaceManager } from './interfaces/IWorkspaceManager';
import { NotFoundError } from './errors/AppMakerErrors';

export class WorkspaceController {
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

    async deleteWorkspace(workspaceId: string): Promise<void> {
        await this.manager.deleteWorkspace(workspaceId);
        await this.registry.delete(workspaceId);
    }

    async updateStatus(workspaceId: string, status: 'idle' | 'creating' | 'ready' | 'error'): Promise<void> {
        await this.registry.update(workspaceId, { status });
    }
}
