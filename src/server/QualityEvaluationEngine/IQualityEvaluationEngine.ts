import { QualityReport } from './QualityTypes';

export interface IQualityEvaluationEngine {
    evaluate(workspaceId: string): Promise<QualityReport>;
}
