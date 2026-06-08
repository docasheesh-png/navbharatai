import { RepairPlan, RepairResult } from './AutoRepairTypes';
import { QualityReport } from '../../QualityEvaluationEngine/QualityTypes';

export interface IAutoRepairEngine {
    planRepair(workspaceId: string, qualityReport: QualityReport): Promise<RepairPlan>;
    runRepair(workspaceId: string, qualityReport: QualityReport): Promise<RepairResult>;
}
