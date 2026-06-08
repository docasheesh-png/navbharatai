
import { RootCause } from './types/RootCause';

export class RootCauseAnalyzer {
    analyze(error: Error, logs: string[]): RootCause {
        const errorMsg = error.message.toLowerCase();
        
        if (errorMsg.includes('cannot find module')) {
            return { category: 'IMPORT', confidence: 0.95, evidence: [errorMsg] };
        }
        if (errorMsg.includes('tsconfig')) {
            return { category: 'CONFIG', confidence: 0.9, evidence: [errorMsg] };
        }
        if (errorMsg.includes('type')) {
            return { category: 'TYPE', confidence: 0.85, evidence: [errorMsg] };
        }
        if (errorMsg.includes('build')) {
            return { category: 'BUILD', confidence: 0.8, evidence: [errorMsg] };
        }
        if (errorMsg.includes('deployment')) {
            return { category: 'DEPLOYMENT', confidence: 0.9, evidence: [errorMsg] };
        }
        if (errorMsg.includes('architecture')) {
            return { category: 'ARCHITECTURE', confidence: 0.9, evidence: [errorMsg] };
        }

        return { category: 'RUNTIME', confidence: 0.5, evidence: [errorMsg] };
    }
}
