
import { IEventBus } from './eventbus/IEventBus';
import { EventType } from './eventbus/EventTypes';
import { exec } from 'child_process';
import util from 'util';
import path from 'path';
import { AutoRepairEngine } from './autorepair/AutoRepairEngine';
import { EvaluationStatus } from '../QualityEvaluationEngine/QualityTypes';

const execPromise = util.promisify(exec);

export class BuildManager {
    constructor(private eventBus: IEventBus, private workspacesRoot: string) {}

    private createEvent(type: EventType, workspaceId: string, payload: Record<string, unknown> = {}): any {
        return {
            eventId: Math.random().toString(36).substring(7),
            correlationId: 'correlation-id',
            workspaceId,
            sender: 'BuildManager',
            timestamp: new Date(),
            type,
            payload
        };
    }

    async build(workspaceId: string): Promise<{ success: boolean; logs: string }> {
         console.log('[ENTER] BuildManager.build', { workspaceId });
         const workspacePath = path.join(this.workspacesRoot, workspaceId);
         
         const runBuild = async () => {
             console.log('[ENTER] BuildManager.runBuild', { workspacePath });
             const { stdout, stderr } = await execPromise('npm run build', { cwd: workspacePath });
             return { stdout, stderr };
         };

         try {
             // 1. Install dependencies
             console.log('[BuildManager] Installing dependencies');
             await this.eventBus.publish(this.createEvent(EventType.DEPENDENCIES_INSTALLED, workspaceId));
             await execPromise('npm install', { cwd: workspacePath });

             // 2. Build
             console.log('[BuildManager] Starting build');
             await this.eventBus.publish(this.createEvent(EventType.BUILD_STARTED, workspaceId));
             const { stdout, stderr } = await runBuild();
             
             console.log('[BuildManager] Build completed successfully');
             await this.eventBus.publish(this.createEvent(EventType.BUILD_COMPLETED, workspaceId, { output: stdout }));
             return { success: true, logs: stdout + stderr };
         } catch (e: any) {
             console.error('[BuildManager] Build failed, attempting repair:', e.message);
             await this.eventBus.publish(this.createEvent(EventType.REPAIR_STARTED, workspaceId));
             
             const repairEngine = new AutoRepairEngine();
             const report = {
                 buildStatus: EvaluationStatus.FAIL,
                 lintStatus: EvaluationStatus.SKIPPED,
                 runtimeStatus: EvaluationStatus.SKIPPED,
                 securityStatus: EvaluationStatus.SKIPPED,
                 architectureStatus: EvaluationStatus.SKIPPED,
                 errors: [e.message],
                 warnings: [],
                 recommendations: [],
                 overallScore: 0
             };
             
             console.log('[BuildManager] Running repair engine');
             const repairResult = await repairEngine.runRepair(workspaceId, report);
             
             if (repairResult.success) {
                 console.log('[BuildManager] Repair successful, rebuilding...');
                 await this.eventBus.publish(this.createEvent(EventType.REPAIR_COMPLETED, workspaceId));
                 
                 try {
                     const { stdout, stderr } = await runBuild();
                     await this.eventBus.publish(this.createEvent(EventType.BUILD_COMPLETED, workspaceId, { output: stdout }));
                     return { success: true, logs: stdout + stderr };
                 } catch (e2: any) {
                     console.error('[BuildManager] Rebuild failed after repair:', e2.message);
                     await this.eventBus.publish(this.createEvent(EventType.BUILD_FAILED, workspaceId, { error: e2.message }));
                     return { success: false, logs: e2.message };
                 }
             } else {
                 console.error('[BuildManager] Repair failed.');
                 await this.eventBus.publish(this.createEvent(EventType.BUILD_FAILED, workspaceId, { error: e.message }));
                 return { success: false, logs: e.message };
             }
         }
    }
}
