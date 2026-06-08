import { RepairPlan, RepairAction } from './AutoRepairTypes';

export class RepairScorer {
    score(actions: RepairAction[]): number {
        // Deterministic algorithmic scoring
        // Factors: Number of actions, risk scores
        let totalRisk = 0;
        actions.forEach(a => totalRisk += a.riskScore);
        
        // Simple weighted scoring: (100 - base risk) * (1 / (1 + actionCount))
        const score = Math.max(0, 100 - (totalRisk * 5)) / (1 + (actions.length * 0.1));
        
        return Math.floor(score);
    }
}
