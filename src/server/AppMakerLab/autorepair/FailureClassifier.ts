import { FailureClassification } from './AutoRepairTypes';

export class FailureClassifier {
    static classify(error: string): FailureClassification {
        const lower = error.toLowerCase();
        
        if (lower.includes('cannot find module') || lower.includes('module not found')) return FailureClassification.DEPENDENCY_ERROR;
        if (lower.includes('ts2304') || lower.includes('cannot find name')) return FailureClassification.TYPESCRIPT_ERROR;
        if (lower.includes('npm err') && lower.includes('missing script')) return FailureClassification.MISSING_SCRIPT;
        if (lower.includes('lint')) return FailureClassification.LINT_ERROR;
        if (lower.includes('build')) return FailureClassification.BUILD_ERROR;
        if (lower.includes('security') || lower.includes('exposed')) return FailureClassification.SECURITY_VIOLATION;
        if (lower.includes('circular') || lower.includes('architecture')) return FailureClassification.ARCHITECTURE_VIOLATION;
        if (lower.includes('env')) return FailureClassification.MISSING_ENVIRONMENT_VARIABLE;
        if (lower.includes('startup') || lower.includes('preview')) return FailureClassification.PREVIEW_STARTUP_FAILURE;

        return FailureClassification.UNKNOWN;
    }
}
