import { WorkspaceMutationEngine } from '../../mutation/WorkspaceMutationEngine';
import { WorkspaceManager } from '../../WorkspaceManager';
import { WorkspacePatchBatch } from '../../mutation/MutationTypes';
import { Patch } from '../IGenerationEngine';
import { v4 as uuidv4 } from 'uuid';

export class PatchToWorkspaceBridge {
    constructor(
        private mutationEngine: WorkspaceMutationEngine,
        private workspaceManager: WorkspaceManager
    ) {}

    async applyPatches(workspaceId: string, patches: Patch[]): Promise<void> {
        for (const patch of patches) {
            await this.workspaceManager.writeFile(workspaceId, patch.path, patch.content);
        }
    }
}
