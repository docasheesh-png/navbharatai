import { RequirementIntelligenceEngine } from './intelligence/RequirementIntelligenceEngine';
import { AppMakerExecutionResult } from './types';
import { createConfiguredDispatcher } from './generator/EngineBootstrap';
import { ExecutionOrchestrator } from './generator/ExecutionOrchestrator';
import { InProcessEventBus } from './eventbus/InProcessEventBus';
import { EventHistoryStore } from './eventbus/EventHistoryStore';
import { EventType } from './eventbus/EventTypes';
import { CheckpointManager } from './checkpoint/CheckpointManager';
import { CheckpointStorage } from './checkpoint/CheckpointStorage';
import { BlueprintPlanner } from './generator/BlueprintPlanner';
import { MutationEngineFactory } from './mutation/MutationEngineFactory';
import { WorkspaceMutationEngine } from './mutation/WorkspaceMutationEngine';
import { WorkspaceManager } from './WorkspaceManager';
import { PatchToWorkspaceBridge } from './generator/bridge/PatchToWorkspaceBridge';
import { BuildManager } from './BuildManager';
import { BlueprintBuilder } from './intelligence/BlueprintBuilder';
import { ScaffoldGenerator } from './generator/ScaffoldGenerator';
import { AutoRepairEngine } from './repair/AutoRepairEngine';
import { LLMGenerationEngine } from './generator/LLMGenerationEngine';
import * as path from 'path';
import * as fs from 'fs/promises';
import { BuildJobManager, JobStatus } from './jobs/BuildJobManager';

export class AppMakerOrchestrator {
    static async execute(prompt: string, namespace: string = 'default'): Promise<AppMakerExecutionResult> {
        console.log("TRACE: AppMakerOrchestrator.execute START (Async Job Triggered)", { prompt });
        const jobId = await BuildJobManager.createJob(prompt);
        
        // Trigger background worker
        this.runBuildJob(jobId, prompt, namespace);

        return { 
            success: true, 
            files: [],
            message: `Build job ${jobId} started.` 
        };
    }

    static async runBuildJob(jobId: string, prompt: string, namespace: string) {
        try {
            await BuildJobManager.updateStatus(jobId, JobStatus.PLANNING, 10, "Starting planning...");
            
            const executionId = jobId; // Use jobId as executionId for consistency
            const engine = new RequirementIntelligenceEngine();
            const model = await engine.parse(prompt);
            
            const dispatcher = createConfiguredDispatcher();
            const eventBus = new InProcessEventBus(new EventHistoryStore(namespace));
            const checkpointManager = new CheckpointManager(new CheckpointStorage(), eventBus);
            const orchestrator = new ExecutionOrchestrator(eventBus, dispatcher, checkpointManager);

            const workspaceId = `workspace-${namespace}-${executionId}`;
            await eventBus.publish({ type: EventType.WORKSPACE_CREATED, workspaceId, timestamp: new Date() } as any);
 
            const workspaceManager = new WorkspaceManager(namespace as 'free'|'pro');
            
            // Execute scaffolding
            const scaffolder = new ScaffoldGenerator(workspaceManager);
            await scaffolder.generate({
                framework: 'vite-react',
                language: 'typescript',
                features: [],
                workspaceId
            });

            const blueprint = BlueprintBuilder.build(model);
            const planner = new BlueprintPlanner();
            const plan = planner.plan(blueprint, workspaceId, "correlation-id");
 
            await BuildJobManager.updateStatus(jobId, JobStatus.GENERATING, 30, "Generating code...");
            const patches = await orchestrator.execute(plan);
            
            await eventBus.publish({ type: EventType.FILES_GENERATED, workspaceId, timestamp: new Date() } as any);

            const { mutationEngine } = MutationEngineFactory.create(checkpointManager, namespace);
            const bridge = new PatchToWorkspaceBridge(mutationEngine, workspaceManager);
 
            await BuildJobManager.updateStatus(jobId, JobStatus.PATCHING, 60, "Applying patches...");
            await bridge.applyPatches(workspaceId, patches);
            
            await BuildJobManager.updateStatus(jobId, JobStatus.BUILDING, 80, "Building...");
            const buildManager = new BuildManager(eventBus, `/workspaces/${namespace}`);
            let buildResult = await buildManager.build(workspaceId);

            if (!buildResult.success) {
                await BuildJobManager.updateStatus(jobId, JobStatus.REPAIRING, 90, "Auto-repairing...");
                const { mutationEngine } = MutationEngineFactory.create(checkpointManager, namespace);
                const generationEngine = new LLMGenerationEngine(); 
                const repairEngine = new AutoRepairEngine(workspaceManager, mutationEngine, generationEngine);
                const repairResult = await repairEngine.repair(workspaceId, buildResult);
                if (repairResult.repaired) {
                    buildResult = await buildManager.build(workspaceId);
                }
            }
            
            // ... (persist telemetry logic as before) ...
            
            await BuildJobManager.updateStatus(jobId, JobStatus.PREVIEW_READY, 100, "Preview ready");
        } catch (error: any) {
            console.error(error);
            await BuildJobManager.updateStatus(jobId, JobStatus.FAILED, 0, `Error: ${error.message}`);
        }
    }
}
