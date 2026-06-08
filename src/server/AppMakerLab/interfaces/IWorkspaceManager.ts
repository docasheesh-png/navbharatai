
import { WorkspaceFileSummary } from '../types/workspace';
import { GeneratedFile } from '../types/files';

export interface IWorkspaceManager {
    createWorkspace(workspaceId: string): Promise<string>;
    saveFiles(workspaceId: string, files: GeneratedFile[]): Promise<void>;
    writeFile(workspaceId: string, filePath: string, content: string): Promise<void>;
    getWorkspaceInfo(workspaceId: string): Promise<WorkspaceFileSummary>;
    deleteWorkspace(workspaceId: string): Promise<void>;
}
