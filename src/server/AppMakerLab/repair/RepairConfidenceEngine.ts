
import { RepairConfidenceResult } from './types/RepairConfidence';

export class RepairConfidenceEngine {
    evaluate(signals: RepairConfidenceResult['signals']): RepairConfidenceResult {
        let score = 0;
        if (signals.buildPass) score += 25;
        if (signals.lintPass) score += 20;
        if (signals.typePass) score += 20;
        if (signals.previewPass) score += 20;
        if (signals.architecturePass) score += 15;

        return {
            score,
            canAutoMerge: score >= 90,
            requiresEscalation: score < 70,
            signals
        };
    }
}
