
import { WorkspaceMetadata } from '../types/workspace';

export interface IWorkspaceRepository {
    register(workspace: WorkspaceMetadata): Promise<void>;
    update(workspaceId: string, updates: Partial<WorkspaceMetadata>): Promise<void>;
    get(workspaceId: string): Promise<WorkspaceMetadata | undefined>;
    delete(workspaceId: string): Promise<void>;
    list(): Promise<WorkspaceMetadata[]>;
}
