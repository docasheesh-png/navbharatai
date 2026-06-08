
export type RootCauseCategory =
    | 'DEPENDENCY'
    | 'IMPORT'
    | 'CONFIG'
    | 'TYPE'
    | 'RUNTIME'
    | 'BUILD'
    | 'DEPLOYMENT'
    | 'ARCHITECTURE';

export interface RootCause {
    category: RootCauseCategory;
    confidence: number;
    evidence: string[];
}
