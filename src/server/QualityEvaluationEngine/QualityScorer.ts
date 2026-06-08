import { QualityReport } from './QualityTypes';

export class QualityScorer {
    score(report: QualityReport): number {
        let score = 0;
        // Weights: Build 25, Lint 15, Runtime 25, Security 20, Architecture 15
        score += report.buildStatus === 'PASS' ? 25 : 0;
        score += report.lintStatus === 'PASS' ? 15 : 0;
        score += report.runtimeStatus === 'PASS' ? 25 : 0;
        score += report.securityStatus === 'PASS' ? 20 : 0;
        score += report.architectureStatus === 'PASS' ? 15 : 0;
        
        // Deductions
        score -= Math.min(10, report.errors.length * 2);
        score -= Math.min(5, report.warnings.length * 1);
        
        return Math.max(0, Math.min(100, score));
    }
}
