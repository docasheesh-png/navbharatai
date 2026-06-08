import { QualityEvaluationEngine } from '../../QualityEvaluationEngine/QualityEvaluationEngine';
import { QualityReport } from '../../QualityEvaluationEngine/QualityTypes';

export class RepairValidator {
    private engine = new QualityEvaluationEngine();
    
    async validate(workspaceId: string, oldReport: QualityReport): Promise<{ passed: boolean, newReport: QualityReport }> {
        const newReport = await this.engine.evaluate(workspaceId);
        
        // PASS: newScore > oldReport.overallScore
        // RETRY: newScore >= oldReport.overallScore
        // FAIL: newScore < oldReport.overallScore
        
        const passed = newReport.overallScore > oldReport.overallScore;
        
        return { passed, newReport };
    }
}
