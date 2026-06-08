import { IAutoRepairEngine } from './IAutoRepairEngine';
import { RepairPlan, RepairResult, RepairAuditRecord, FailureClassification } from './AutoRepairTypes';
import { QualityReport } from '../../QualityEvaluationEngine/QualityTypes';
import { FailureClassifier } from './FailureClassifier';
import { RootCauseAnalyzer } from './RootCauseAnalyzer';
import { RepairKnowledgeBase } from './RepairKnowledgeBase';
import { RepairPlanner } from './RepairPlanner';
import { RepairExecutor } from './RepairExecutor';
import { RepairValidator } from './RepairValidator';
import { CheckpointManager } from '../checkpoint/CheckpointManager';
import { CheckpointStorage } from '../checkpoint/CheckpointStorage';
import { VCSProvider } from '../vcs/VCSProvider';
import { EventBus } from '../eventbus/EventBus';

export class AutoRepairEngine implements IAutoRepairEngine {
    private classifier = new FailureClassifier();
    private analyzer = new RootCauseAnalyzer();
    private planner = new RepairPlanner();
    private executor = new RepairExecutor();
    private validator = new RepairValidator();
    private eventBus = new EventBus();
    private checkpoint = new CheckpointManager(new CheckpointStorage(), this.eventBus);
    private vcs = new VCSProvider();

    async planRepair(workspaceId: string, qualityReport: QualityReport): Promise<RepairPlan> {
        // Assume failure is in the first error for now as per qualityReport structure
        const error = qualityReport.errors[0] || 'Unknown error';
        const classification = FailureClassifier.classify(error);
        const rootCauses = await this.analyzer.analyze(error, classification);
        const strategy = RepairKnowledgeBase.getStrategy(classification);
        const actions = this.planner.plan(classification, strategy, rootCauses[0]);
        
        return {
            classification,
            rootCauses,
            repairActions: actions,
            score: 0 // Assume scorer logic is in Phase 1
        };
    }

    async runRepair(workspaceId: string, qualityReport: QualityReport): Promise<RepairResult> {
        const auditTrail: RepairAuditRecord[] = [];
        let attempts = 0;
        let success = false;
        let finalQualityScore = qualityReport.overallScore;
        const plan = await this.planRepair(workspaceId, qualityReport);

        while (attempts < 3) {
            attempts++;
            const startTime = Date.now();
            this.eventBus.publish('REPAIR_STARTED', { workspaceId, attempt: attempts });
            
            await this.checkpoint.saveCheckpoint(workspaceId);
            
            try {
                const execResult = await this.executor.execute(plan.repairActions, workspaceId);
                this.eventBus.publish('REPAIR_EXECUTED', { workspaceId, attempt: attempts });
                
                const { passed, newReport } = await this.validator.validate(workspaceId, qualityReport);
                this.eventBus.publish('REPAIR_VALIDATED', { workspaceId, attempt: attempts });
                
                finalQualityScore = newReport.overallScore;
                
                auditTrail.push({
                    attempt: attempts,
                    classification: plan.classification,
                    rootCause: plan.rootCauses[0],
                    repairPlan: plan,
                    executionResult: execResult.success,
                    validationResult: passed,
                    qualityScoreBefore: qualityReport.overallScore,
                    qualityScoreAfter: newReport.overallScore,
                    durationMs: Date.now() - startTime,
                    timestamp: Date.now()
                });
                
                if (passed) {
                    await this.vcs.commit(workspaceId, `AutoRepair: ${plan.classification} ${Date.now()}`);
                    success = true;
                    this.eventBus.publish('REPAIR_SUCCEEDED', { workspaceId, attempt: attempts });
                    break;
                } else {
                    this.eventBus.publish('REPAIR_RETRY', { workspaceId, attempt: attempts });
                    await this.checkpoint.loadCheckpoint(workspaceId);
                    this.eventBus.publish('REPAIR_ROLLED_BACK', { workspaceId, attempt: attempts });
                }
            } catch (e: any) {
                await this.checkpoint.loadCheckpoint(workspaceId);
                this.eventBus.publish('REPAIR_FAILED', { workspaceId, attempt: attempts });
            }
        }
        
        return {
            success,
            attempts,
            repairsApplied: plan.repairActions,
            finalQualityScore,
            rollbackTriggered: !success,
            validationPassed: success,
            auditTrail
        };
    }
}
