import { QualityEvaluationEngine } from '../../QualityEvaluationEngine/QualityEvaluationEngine';
import { PreviewRunner } from '../../PreviewRunner/PreviewRunner';

export class DeploymentValidator {
  private qualityEngine = new QualityEvaluationEngine();
  private previewRunner = new PreviewRunner();
  
  async validate(workspaceId: string): Promise<boolean> {
    // 1. Preview
    const previewResult = await this.previewRunner.runPreview(workspaceId);
    if (!previewResult) return false;
    
    // 2. Quality
    const report = await this.qualityEngine.evaluate(workspaceId);
    return report.overallScore >= 0.8;
  }
}
