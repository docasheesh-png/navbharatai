export enum EvaluationStatus {
    PASS = 'PASS',
    FAIL = 'FAIL',
    SKIPPED = 'SKIPPED'
}

export interface QualityReport {
    buildStatus: EvaluationStatus;
    lintStatus: EvaluationStatus;
    runtimeStatus: EvaluationStatus;
    securityStatus: EvaluationStatus;
    architectureStatus: EvaluationStatus;
    errors: string[];
    warnings: string[];
    recommendations: string[];
    overallScore: number;
    cycles?: string[];
    unresolvedImports?: string[];
    violations?: string[];
}
