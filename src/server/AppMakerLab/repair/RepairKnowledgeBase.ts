
import { RepairPattern } from './types/RepairPattern';

export class RepairKnowledgeBase {
    private patterns: RepairPattern[] = []; // In-memory for V1, would be persistent in JSON/DB

    savePattern(pattern: RepairPattern) {
        this.patterns.push(pattern);
    }

    findPattern(fingerprint: string): RepairPattern | undefined {
        return this.patterns.find(p => p.fingerprint === fingerprint);
    }

    updateSuccessRate(patternId: string, success: boolean) {
        const pattern = this.patterns.find(p => p.patternId === patternId);
        if (pattern) {
            pattern.occurrences++;
            // Simple moving average update
            pattern.successRate = (pattern.successRate * (pattern.occurrences - 1) + (success ? 1 : 0)) / pattern.occurrences;
            pattern.updatedAt = new Date().toISOString();
        }
    }

    listPatterns(): RepairPattern[] {
        return this.patterns;
    }
}
