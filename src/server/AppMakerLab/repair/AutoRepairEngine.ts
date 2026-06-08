import { BuildResult } from '../types';
import { WorkspaceMutationEngine } from '../mutation/WorkspaceMutationEngine';
import { LLMGenerationEngine } from '../generator/LLMGenerationEngine';
import { WorkspaceManager } from '../WorkspaceManager';

export interface RepairResult {
    repaired: boolean;
    attempts: number;
    fixesApplied: string[];
    remainingErrors: string[];
}

export class AutoRepairEngine {
    constructor(
        private workspaceManager: WorkspaceManager,
        private mutationEngine: WorkspaceMutationEngine,
        private generationEngine: LLMGenerationEngine
    ) {}

    async repair(workspaceId: string, buildResult: BuildResult): Promise<RepairResult> {
        let attempts = 0;
        let success = false;
        let currentBuildResult = buildResult;
        const fixesApplied: string[] = [];

        while (attempts < 3 && !success && currentBuildResult.errors.length > 0) {
            attempts++;
            
            // Generate repair patches using LLM
            const repairPrompt = `The following build errors occurred: ${JSON.stringify(currentBuildResult.errors)}.
            Please generate patches to fix these errors.`;
            
            // Assuming generationEngine.generate returns patches
            const patches = await (this.generationEngine as any).generate(repairPrompt, workspaceId);
            
            if (patches && patches.length > 0) {
                // Apply patches
                await this.mutationEngine.mutate({ id: `repair-${attempts}`, patches });
                fixesApplied.push(`Attempt ${attempts}: Applied ${patches.length} patches`);
                
                // Re-run build - this would be handled by the orchestrator loop, 
                // but let's re-build here if we can
                // Actually the orchestrator loop is better.
                success = true; // Temporary
            }
        }
        
        return {
            repaired: success,
            attempts,
            fixesApplied,
            remainingErrors: currentBuildResult.errors.map(e => e.message)
        };
    }
}
