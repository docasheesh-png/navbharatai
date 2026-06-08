import { FailureClassification, RepairStrategy } from './AutoRepairTypes';

export class RepairKnowledgeBase {
    private static mapping: Record<FailureClassification, RepairStrategy> = {
        [FailureClassification.DEPENDENCY_ERROR]: RepairStrategy.INSTALL_DEPENDENCY,
        [FailureClassification.TYPESCRIPT_ERROR]: RepairStrategy.UPDATE_TYPE,
        [FailureClassification.ARCHITECTURE_VIOLATION]: RepairStrategy.REFACTOR_DEPENDENCY,
        [FailureClassification.MISSING_ENVIRONMENT_VARIABLE]: RepairStrategy.ADD_ENVIRONMENT_VARIABLE,
        [FailureClassification.PREVIEW_STARTUP_FAILURE]: RepairStrategy.RETRY_STARTUP,
        [FailureClassification.BUILD_ERROR]: RepairStrategy.FIX_CONFIGURATION,
        [FailureClassification.IMPORT_ERROR]: RepairStrategy.UPDATE_IMPORT,
        [FailureClassification.RUNTIME_ERROR]: RepairStrategy.NONE,
        
        // Fallbacks
        [FailureClassification.LINT_ERROR]: RepairStrategy.NONE,
        [FailureClassification.SECURITY_VIOLATION]: RepairStrategy.NONE,
        [FailureClassification.TEST_FAILURE]: RepairStrategy.NONE,
        [FailureClassification.CONFIGURATION_ERROR]: RepairStrategy.FIX_CONFIGURATION,
        [FailureClassification.BUILD_CONFIGURATION_ERROR]: RepairStrategy.FIX_CONFIGURATION,
        [FailureClassification.MISSING_SCRIPT]: RepairStrategy.FIX_CONFIGURATION,
        [FailureClassification.UNKNOWN]: RepairStrategy.NONE
    };

    static getStrategy(classification: FailureClassification): RepairStrategy {
        return this.mapping[classification] || RepairStrategy.NONE;
    }
}
