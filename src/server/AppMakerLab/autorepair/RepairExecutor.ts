import { RepairAction } from './AutoRepairTypes';
import { WorkspaceMutationEngine } from '../mutation/WorkspaceMutationEngine';
import { WorkspacePatchBatch, WorkspacePatch } from '../mutation/MutationTypes';
import { WorkspaceManager } from '../WorkspaceManager';

export class RepairExecutor {
    private mutationEngine = new WorkspaceMutationEngine();
    private workspaceManager = new WorkspaceManager();

    async execute(actions: RepairAction[], workspaceId: string): Promise<{ success: boolean; patchesApplied: WorkspacePatch[]; errors: string[] }> {
        const patches: WorkspacePatch[] = await Promise.all(actions.map(async action => {
            const originalContent = await this.workspaceManager.readFile(workspaceId, action.targetFile);
            return {
                path: action.targetFile,
                content: action.content || originalContent,
                originalContent
            };
        }));
        
        const batch: WorkspacePatchBatch = {
            id: `repair-${Date.now()}`,
            patches
        };

        try {
            await this.mutationEngine.mutate(batch);
            return { success: true, patchesApplied: patches, errors: [] };
        } catch (e: any) {
            return { success: false, patchesApplied: [], errors: [e.message] };
        }
    }
}

