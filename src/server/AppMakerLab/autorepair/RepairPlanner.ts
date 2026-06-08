import { FailureClassification, RepairStrategy, RepairAction, RepairActionType, RootCause } from './AutoRepairTypes';

export class RepairPlanner {
    plan(classification: FailureClassification, strategy: RepairStrategy, rootCause: RootCause): RepairAction[] {
        const actions: RepairAction[] = [];
        const targetFile = rootCause.file;

        const calculateRisk = (strategy: RepairStrategy, file: string): number => {
            let risk = 1;
            if (file === 'package.json') risk += 5;
            if (file.endsWith('.ts')) risk += 2;
            if (strategy === RepairStrategy.REFACTOR_DEPENDENCY) risk += 3;
            // Ensure risk is 1-10
            return Math.min(10, Math.max(1, risk));
        };

        switch (strategy) {
            case RepairStrategy.INSTALL_DEPENDENCY:
                actions.push({
                    type: RepairActionType.INSTALL_DEPENDENCY,
                    targetFile: 'package.json',
                    reason: `Dependency missing: ${rootCause.reason}`,
                    expectedOutcome: 'Dependency installed',
                    riskScore: calculateRisk(strategy, 'package.json'),
                    content: '{"dependencies": {}}'
                });
                break;
            case RepairStrategy.UPDATE_TYPE:
            case RepairStrategy.UPDATE_IMPORT:
                actions.push({
                    type: RepairActionType.UPDATE_IMPORT,
                    targetFile: targetFile,
                    reason: `Unresolved import: ${rootCause.reason}`,
                    expectedOutcome: 'Import path fixed',
                    riskScore: calculateRisk(strategy, targetFile),
                    content: '// Updated import'
                });
                break;
            case RepairStrategy.REFACTOR_DEPENDENCY:
                actions.push({
                    type: RepairActionType.UPDATE_CONFIGURATION,
                    targetFile: targetFile,
                    reason: `Architecture violation: ${rootCause.reason}`,
                    expectedOutcome: 'Circular dependency refactored',
                    riskScore: calculateRisk(strategy, targetFile),
                    content: '// Updated dependency'
                });
                break;
        }

        return actions;
    }
}
