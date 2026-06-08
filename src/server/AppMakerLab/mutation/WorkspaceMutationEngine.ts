import { WorkspacePatchBatch } from './MutationTypes';
import { IWorkspaceMutationEngine } from './IWorkspaceMutationEngine';
import { TransactionCoordinator } from './TransactionCoordinator';
import { LockManager } from './LockManager';
import { ConflictDetector } from './ConflictDetector';
import { JournalManager } from './JournalManager';
import { TransactionalExecutor } from './TransactionalExecutor';
import { ICheckpointManager } from '../checkpoint/ICheckpointManager';

export class WorkspaceMutationEngine implements IWorkspaceMutationEngine {
    constructor(
        private coordinator: TransactionCoordinator,
        private lockManager: LockManager,
        private conflictDetector: ConflictDetector,
        private journal: JournalManager,
        private executor: TransactionalExecutor,
        private checkpointManager: ICheckpointManager
    ) {}

    async mutate(batch: WorkspacePatchBatch): Promise<void> {
        await this.lockManager.acquire(batch.id);
        try {
            if (this.conflictDetector.detectConflicts(batch)) {
                throw new Error('Conflict detected');
            }
            await this.coordinator.coordinate(batch);
            await this.executor.promote();
        } finally {
            await this.lockManager.release(batch.id);
        }
    }

    async rollback(transactionId: string): Promise<void> {
        const entries = await this.journal.readAll();
        const entry = entries.find(e => e.transactionId === transactionId);
        if (entry) {
            await this.executor.undo(entry.batch);
        }
    }

    async recover(): Promise<void> {
        await this.executor.recover();
        const entries = await this.journal.readAll();
        // Simple recovery: Replay rollback for unfinished transactions
        for (const entry of entries) {
            if (entry.state !== 'COMMITTED' && entry.state !== 'FINISHED' && entry.state !== 'ROLLED_BACK') {
                await this.executor.undo(entry.batch);
            }
        }
    }
}
