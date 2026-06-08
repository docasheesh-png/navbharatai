export enum FailureClassification {
    BUILD_ERROR = 'BUILD_ERROR',
    TYPESCRIPT_ERROR = 'TYPESCRIPT_ERROR',
    LINT_ERROR = 'LINT_ERROR',
    RUNTIME_ERROR = 'RUNTIME_ERROR',
    IMPORT_ERROR = 'IMPORT_ERROR',
    DEPENDENCY_ERROR = 'DEPENDENCY_ERROR',
    SECURITY_VIOLATION = 'SECURITY_VIOLATION',
    ARCHITECTURE_VIOLATION = 'ARCHITECTURE_VIOLATION',
    TEST_FAILURE = 'TEST_FAILURE',
    CONFIGURATION_ERROR = 'CONFIGURATION_ERROR',
    BUILD_CONFIGURATION_ERROR = 'BUILD_CONFIGURATION_ERROR',
    MISSING_ENVIRONMENT_VARIABLE = 'MISSING_ENVIRONMENT_VARIABLE',
    MISSING_SCRIPT = 'MISSING_SCRIPT',
    PREVIEW_STARTUP_FAILURE = 'PREVIEW_STARTUP_FAILURE',
    UNKNOWN = 'UNKNOWN'
}

export enum RepairStrategy {
    INSTALL_DEPENDENCY = 'INSTALL_DEPENDENCY',
    UPDATE_IMPORT = 'UPDATE_IMPORT',
    REMOVE_IMPORT = 'REMOVE_IMPORT',
    UPDATE_TYPE = 'UPDATE_TYPE',
    REFACTOR_DEPENDENCY = 'REFACTOR_DEPENDENCY',
    FIX_CONFIGURATION = 'FIX_CONFIGURATION',
    ADD_ENVIRONMENT_VARIABLE = 'ADD_ENVIRONMENT_VARIABLE',
    RETRY_STARTUP = 'RETRY_STARTUP',
    NONE = 'NONE'
}

export enum RepairActionType {
    EDIT_FILE = 'EDIT_FILE',
    CREATE_FILE = 'CREATE_FILE',
    DELETE_FILE = 'DELETE_FILE',
    UPDATE_IMPORT = 'UPDATE_IMPORT',
    INSTALL_DEPENDENCY = 'INSTALL_DEPENDENCY',
    REMOVE_DEPENDENCY = 'REMOVE_DEPENDENCY',
    UPDATE_CONFIGURATION = 'UPDATE_CONFIGURATION'
}

export interface RootCause {
    file: string;
    symbol?: string;
    dependencyPath: string[]; // Reconstructed chain
    reason: string;
    confidence: number;
}

export interface RepairAction {
    type: RepairActionType;
    targetFile: string;
    reason: string;
    expectedOutcome: string;
    riskScore: number; // 0-10
    content?: string; // Content for mutation: REQUIRED for EDIT/CREATE/UPDATE
}

export interface RepairPlan {
    classification: FailureClassification;
    rootCauses: RootCause[];
    repairActions: RepairAction[];
    score: number; // 0-100
}

export interface RepairAuditRecord {
    attempt: number;
    classification: FailureClassification;
    rootCause: RootCause;
    repairPlan: RepairPlan;
    executionResult: boolean;
    validationResult: boolean;
    qualityScoreBefore: number;
    qualityScoreAfter: number;
    durationMs: number;
    timestamp: number;
}

export interface RepairResult {
    success: boolean;
    attempts: number;
    repairsApplied: RepairAction[];
    finalQualityScore: number;
    rollbackTriggered: boolean;
    validationPassed: boolean;
    auditTrail: RepairAuditRecord[];
}
