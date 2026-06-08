import { WorkspaceMetadata } from './types/workspace';
import { IWorkspaceRepository } from './interfaces/IWorkspaceRepository';

export class WorkspaceRegistry {
    constructor(private repository: IWorkspaceRepository) {}

    async register(workspace: WorkspaceMetadata): Promise<void> {
        await this.repository.register(workspace);
    }

    async update(workspaceId: string, updates: Partial<WorkspaceMetadata>): Promise<void> {
        await this.repository.update(workspaceId, updates);
    }

    async get(workspaceId: string): Promise<WorkspaceMetadata | undefined> {
        return await this.repository.get(workspaceId);
    }

    async delete(workspaceId: string): Promise<void> {
        await this.repository.delete(workspaceId);
    }

    async list(): Promise<WorkspaceMetadata[]> {
        return await this.repository.list();
    }
}
