
import { RepairBudget } from './types/RepairBudget';

export class RepairBudgetManager {
    private budget: RepairBudget = {
        maxAttempts: 3,
        maxTokens: 200000,
        maxDurationMs: 300000
    };

    checkBudget(attempts: number, tokens: number, durationMs: number): boolean {
        return attempts <= this.budget.maxAttempts &&
               tokens <= this.budget.maxTokens &&
               durationMs <= this.budget.maxDurationMs;
    }
}
