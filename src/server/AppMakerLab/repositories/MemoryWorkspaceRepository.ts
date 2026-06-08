
import { WorkspaceMetadata } from '../types/workspace';
import { IWorkspaceRepository } from '../interfaces/IWorkspaceRepository';
import { NotFoundError } from '../errors/AppMakerErrors';

export class MemoryWorkspaceRepository implements IWorkspaceRepository {
    private workspaces: Map<string, WorkspaceMetadata> = new Map();

    async register(workspace: WorkspaceMetadata): Promise<void> {
        this.workspaces.set(workspace.workspaceId, workspace);
    }

    async update(workspaceId: string, updates: Partial<WorkspaceMetadata>): Promise<void> {
        const existing = this.workspaces.get(workspaceId);
        if (!existing) {
            throw new NotFoundError(`Workspace ${workspaceId} not found`);
        }
        this.workspaces.set(workspaceId, { ...existing, ...updates, updatedAt: new Date() });
    }

    async get(workspaceId: string): Promise<WorkspaceMetadata | undefined> {
        return this.workspaces.get(workspaceId);
    }

    async delete(workspaceId: string): Promise<void> {
        this.workspaces.delete(workspaceId);
    }

    async list(): Promise<WorkspaceMetadata[]> {
        return Array.from(this.workspaces.values());
    }
}
