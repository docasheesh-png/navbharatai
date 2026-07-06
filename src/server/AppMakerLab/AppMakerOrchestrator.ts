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
import { LintFixGenerator } from './generator/LintFixGenerator';
import { LLMGenerationEngine } from './generator/LLMGenerationEngine';
import * as path from 'path';
import * as fs from 'fs/promises';
import { BuildJobManager, JobStatus } from './jobs/BuildJobManager';
import { log, withLogContext } from '../logger';
import { scopeChangeController } from './intelligence/ScopeChangeController';

export class AppMakerOrchestrator {
    static async execute(prompt: string, namespace: string = 'default', idempotencyKey?: string): Promise<AppMakerExecutionResult> {
        console.log("TRACE: AppMakerOrchestrator.execute START (Async Job Triggered)", { prompt });
        // P1.4 — when an idempotency key is supplied, a retried/duplicate request reuses the
        // same job instead of double-running. createJob returns the existing job id in that case.
        const existing = idempotencyKey ? await BuildJobManager.findExisting(idempotencyKey) : null;
        // Idempotent reuse: return the same in-flight/succeeded job, never a second build (or scope lock).
        if (existing) {
            return { success: true, files: [], message: `Build job ${existing.id} reused (idempotent).` };
        }

        // P-PME.6 — scope-change control: serialize builds per namespace. If a build is already running
        // for this workspace, DEFER this change (queued + applied after) instead of starting a second
        // build that would race the first and corrupt workspace state. submit() is atomic (decide +
        // mark-active) so two near-simultaneous requests can't both proceed.
        const decision = scopeChangeController.submit(namespace, prompt);
        if (decision.action === 'defer') {
            return { success: true, files: [], message: decision.message ?? 'Build in progress — your change was queued.' };
        }

        let jobId: string;
        try {
            jobId = await BuildJobManager.createJob(prompt, idempotencyKey);
        } catch (err) {
            // Never leave the namespace locked if we failed before the build even started.
            scopeChangeController.complete(namespace);
            throw err;
        }
        this.runBuildJob(jobId, prompt, namespace);

        return { success: true, files: [], message: `Build job ${jobId} started.` };
    }

    static async runBuildJob(jobId: string, prompt: string, namespace: string) {
      // P-BRE.3 — run the whole build under a log-correlation context so every structured
      // log emitted anywhere inside this build carries { jobId, namespace } and its traceId.
      return withLogContext({ jobId, namespace }, async () => {
        try {
            log.info('build started', { phase: 'planning' });
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
                // P-CGE.7 — cheap deterministic lint auto-fix BEFORE the expensive LLM repair. Resolves
                // the bulk of auto-fixable lint errors (unused imports, semicolons, quotes) with zero LLM
                // cost; if that alone makes the build pass, the LLM repair is skipped entirely.
                try {
                    const fix = await new LintFixGenerator().fix(workspaceId);
                    if (fix.ran) buildResult = await buildManager.build(workspaceId);
                } catch { /* best-effort — fall through to the LLM repair */ }
            }
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
            
            log.info('build completed', { phase: 'preview_ready' });
            await BuildJobManager.updateStatus(jobId, JobStatus.PREVIEW_READY, 100, "Preview ready");
        } catch (error: any) {
            log.error('build failed', { error: String(error?.message ?? error) });
            await BuildJobManager.updateStatus(jobId, JobStatus.FAILED, 0, `Error: ${error.message}`);
        } finally {
            // P-PME.6 — this build for `namespace` is finished (success OR failure): release the scope
            // lock and apply any changes the user queued mid-build. Each re-enters execute() — the first
            // proceeds, the rest re-queue behind it — so a mid-build change is never silently dropped.
            for (const queuedPrompt of scopeChangeController.complete(namespace)) {
                this.execute(queuedPrompt, namespace);
            }
        }
      });
    }
}
