
import { mkdir, writeFile, readFile, readdir, rm, stat, rename, appendFile, cp } from 'node:fs/promises';
import { join, resolve, relative, dirname } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { WorkspaceConfig } from './types.js';
import { workspaceEventBus } from './WorkspaceEvents.js';

export class WorkspaceManager {
    private workspacesRoot: string;

    constructor() {
        this.workspacesRoot = resolve(process.cwd(), 'workspaces');
    }

    private securePath(path: string): string {
        const fullPath = resolve(this.workspacesRoot, path);
        if (!fullPath.startsWith(this.workspacesRoot)) {
            throw new Error('Security Error: Path traversal attempted');
        }
        return fullPath;
    }

    async createWorkspace(projectName: string): Promise<string> {
        const workspaceId = uuidv4();
        const path = join(this.workspacesRoot, workspaceId);
        
        await mkdir(path, { recursive: true });
        
        const config: WorkspaceConfig = {
            workspaceId,
            projectName,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            status: 'active'
        };
        
        await writeFile(join(path, 'workspace.json'), JSON.stringify(config, null, 2));
        await mkdir(join(path, '.snapshots'), { recursive: true });
        
        await workspaceEventBus.emitEvent('WORKSPACE_CREATED', workspaceId);
        return workspaceId;
    }

    async writeFile(workspaceId: string, path: string, content: string): Promise<void> {
        const fullPath = this.securePath(join(workspaceId, path));
        
        // Fix #1: Ensure parent directory exists
        await mkdir(dirname(fullPath), { recursive: true });
        
        await writeFile(fullPath, content);
        await workspaceEventBus.emitEvent('FILE_CREATED', workspaceId, path);
    }

    async readFile(workspaceId: string, path: string): Promise<string> {
        const fullPath = this.securePath(join(workspaceId, path));
        return await readFile(fullPath, 'utf8');
    }
    
    // Fix #2: Recursive file tree listing
    async listFiles(workspaceId: string): Promise<string[]> {
        const fullPath = this.securePath(workspaceId);
        
        const walk = async (dir: string): Promise<string[]> => {
            const files = await readdir(dir, { withFileTypes: true });
            let paths: string[] = [];
            
            for (const file of files) {
                const res = join(dir, file.name);
                
                // Ignore artifacts
                if (file.name === '.snapshots' || file.name === 'workspace.json') continue;
                
                if (file.isDirectory()) {
                    paths = paths.concat(await walk(res));
                } else {
                    paths.push(relative(fullPath, res));
                }
            }
            return paths;
        };

        return await walk(fullPath);
    }

    async createDirectory(workspaceId: string, path: string): Promise<void> {
        const fullPath = this.securePath(join(workspaceId, path));
        await mkdir(fullPath, { recursive: true });
        await workspaceEventBus.emitEvent('DIRECTORY_CREATED', workspaceId, path);
    }

    async deleteDirectory(workspaceId: string, path: string): Promise<void> {
        const fullPath = this.securePath(join(workspaceId, path));
        await rm(fullPath, { recursive: true, force: true });
        await workspaceEventBus.emitEvent('DIRECTORY_DELETED', workspaceId, path);
    }

    async renameFile(workspaceId: string, oldPath: string, newPath: string): Promise<void> {
        const oldFullPath = this.securePath(join(workspaceId, oldPath));
        const newFullPath = this.securePath(join(workspaceId, newPath));
        
        // Ensure parent directory exists for new path
        await mkdir(dirname(newFullPath), { recursive: true });
        
        await rename(oldFullPath, newFullPath);
        await workspaceEventBus.emitEvent('FILE_RENAMED', workspaceId, `${oldPath} to ${newPath}`);
    }

    async deleteFile(workspaceId: string, path: string): Promise<void> {
        const fullPath = this.securePath(join(workspaceId, path));
        await rm(fullPath);
        await workspaceEventBus.emitEvent('FILE_DELETED', workspaceId, path);
    }

    async createSnapshot(workspaceId: string): Promise<string> {
        const snapshotId = uuidv4();
        const sourceDir = this.securePath(workspaceId);
        const snapshotDir = this.securePath(join(workspaceId, '.snapshots', snapshotId));
        
        await mkdir(snapshotDir, { recursive: true });
        
        const files = await readdir(sourceDir);
        for (const file of files) {
            if (file === '.snapshots') continue;
            await cp(join(sourceDir, file), join(snapshotDir, file), { recursive: true });
        }
        
        await workspaceEventBus.emitEvent('SNAPSHOT_CREATED', workspaceId, snapshotId);
        return snapshotId;
    }
    
    async restoreSnapshot(workspaceId: string, snapshotId: string): Promise<void> {
        const sourceDir = this.securePath(workspaceId);
        const snapshotDir = this.securePath(join(workspaceId, '.snapshots', snapshotId));
        
        // Clear workspace except .snapshots
        const files = await readdir(sourceDir);
        for (const file of files) {
            if (file === '.snapshots') continue;
            await rm(join(sourceDir, file), { recursive: true, force: true });
        }
        
        // Restore from snapshot
        const snapFiles = await readdir(snapshotDir);
        for (const file of snapFiles) {
            await cp(join(snapshotDir, file), join(sourceDir, file), { recursive: true });
        }
        
        await workspaceEventBus.emitEvent('SNAPSHOT_RESTORED', workspaceId, snapshotId);
    }

    async deleteWorkspace(workspaceId: string): Promise<void> {
        const path = this.securePath(workspaceId);
        await rm(path, { recursive: true, force: true });
        await workspaceEventBus.emitEvent('WORKSPACE_DELETED', workspaceId);
    }
}
