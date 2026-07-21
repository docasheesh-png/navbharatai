import fs from 'fs/promises';
import path from 'path';
import { WorkspaceFileSummary } from './types/workspace';
import { IWorkspaceManager } from './interfaces/IWorkspaceManager';
import { FileSanitizer } from './FileSanitizer';
import { PersistenceError } from './errors/AppMakerErrors';
import { GeneratedFile } from './types/files';

export class WorkspaceManager implements IWorkspaceManager {
    private workspacesRoot: string;

    constructor(namespace: string = 'free') {
        const base = process.env.WORKSPACES_ROOT || '/workspaces';
        this.workspacesRoot = `${base}/${namespace}`;
    }

    async createWorkspace(id: string): Promise<string> {
        console.log('[ENTER] WorkspaceManager.createWorkspace', { id });
        await fs.mkdir(this.workspacesRoot, { recursive: true });
        const workspacePath = FileSanitizer.resolveSafePath(this.workspacesRoot, id);
        await fs.mkdir(workspacePath, { recursive: true });
        return workspacePath;
    }

    async loadWorkspace(workspaceId: string): Promise<WorkspaceFileSummary> {
        return this.getWorkspaceInfo(workspaceId);
    }

    async saveWorkspace(workspaceId: string, files: GeneratedFile[]): Promise<void> {
        return this.saveFiles(workspaceId, files);
    }

    async saveFiles(workspaceId: string, files: GeneratedFile[]): Promise<void> {
        for (const file of files) {
            await this.writeFile(workspaceId, file.path, file.content);
        }
    }

    async writeFile(workspaceId: string, filePath: string, content: string): Promise<void> {
        const workspacePath = FileSanitizer.resolveSafePath(this.workspacesRoot, workspaceId);
        const fullPath = FileSanitizer.resolveSafePath(workspacePath, filePath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, content, 'utf8');
    }

    async readFile(workspaceId: string, filePath: string): Promise<string> {
        const workspacePath = FileSanitizer.resolveSafePath(this.workspacesRoot, workspaceId);
        const fullPath = FileSanitizer.resolveSafePath(workspacePath, filePath);
        try {
            return await fs.readFile(fullPath, 'utf8');
        } catch (e) {
            throw new PersistenceError(`Cannot read file ${filePath}: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    async listFiles(workspaceId: string): Promise<string[]> {
        const workspacePath = FileSanitizer.resolveSafePath(this.workspacesRoot, workspaceId);
        
        const files: string[] = [];
        const walk = async (dir: string) => {
            const list = await fs.readdir(dir);
            for (const file of list) {
                const fullPath = path.resolve(dir, file);
                const stat = await fs.stat(fullPath);
                if (stat.isDirectory()) {
                    await walk(fullPath);
                } else {
                    files.push(path.relative(workspacePath, fullPath));
                }
            }
        };
        await walk(workspacePath);
        return files;
    }

    async getWorkspaceInfo(workspaceId: string): Promise<WorkspaceFileSummary> {
        const rootPath = FileSanitizer.resolveSafePath(this.workspacesRoot, workspaceId);
        const files = await this.listFiles(workspaceId);
        return {
            rootPath,
            files
        };
    }
    
    async deleteWorkspace(workspaceId: string): Promise<void> {
        const rootPath = FileSanitizer.resolveSafePath(this.workspacesRoot, workspaceId);
        await fs.rm(rootPath, { recursive: true, force: true });
    }
}
