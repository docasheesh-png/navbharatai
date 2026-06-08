export enum MutationState {
    STARTED = 'STARTED',
    STAGED = 'STAGED',
    COMMITTED = 'COMMITTED',
    FINISHED = 'FINISHED',
    ROLLED_BACK = 'ROLLED_BACK'
}

export interface WorkspacePatch {
    path: string;
    content: string;
    originalContent?: string;
}

export interface WorkspacePatchBatch {
    id: string;
    patches: WorkspacePatch[];
}

export interface JournalEntry {
    transactionId: string;
    state: MutationState;
    batch: WorkspacePatchBatch;
    timestamp: number;
}
