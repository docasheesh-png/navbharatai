import { WorkspacePatchBatch } from './MutationTypes';

export interface IWorkspaceMutationEngine {
    mutate(batch: WorkspacePatchBatch): Promise<void>;
    rollback(transactionId: string): Promise<void>;
    recover(): Promise<void>;
}
