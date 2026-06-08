
export interface RepairConfidenceResult {
    score: number;
    canAutoMerge: boolean;
    requiresEscalation: boolean;
    signals: {
        buildPass: boolean;
        lintPass: boolean;
        typePass: boolean;
        previewPass: boolean;
        architecturePass: boolean;
    };
}
