
export interface RepairPattern {
    patternId: string;
    fingerprint: string;
    rootCause: string;
    repairStrategy: string;
    successRate: number;
    occurrences: number;
    createdAt: string;
    updatedAt: string;
}
