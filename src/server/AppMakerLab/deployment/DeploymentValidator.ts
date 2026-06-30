import { QualityEvaluationEngine } from '../../QualityEvaluationEngine/QualityEvaluationEngine';
import { PreviewRunner } from '../../PreviewRunner/PreviewRunner';
import { qualityThreshold, passesQualityGate, formatGateLine } from '../../QualityEvaluationEngine/qualityGate';

export class DeploymentValidator {
  private qualityEngine = new QualityEvaluationEngine();
  private previewRunner = new PreviewRunner();

  async validate(workspaceId: string): Promise<boolean> {
    // 1. Preview must come up.
    const previewResult = await this.previewRunner.runPreview(workspaceId);
    if (!previewResult) return false;

    // 2. Quality gate — block the deploy when the score is below the configurable threshold
    //    (QUALITY_GATE_THRESHOLD, default 0.8). P-TQA.6: never deploy a low-quality build.
    const report = await this.qualityEngine.evaluate(workspaceId);
    const threshold = qualityThreshold();
    const pass = passesQualityGate(report.overallScore, threshold);
    console.log(`[deploy] ${formatGateLine(report.overallScore, threshold)}`);
    return pass;
  }
}
