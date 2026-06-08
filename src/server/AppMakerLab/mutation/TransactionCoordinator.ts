import { MutationState, WorkspacePatchBatch } from './MutationTypes';
import { JournalManager } from './JournalManager';
import { TransactionalExecutor } from './TransactionalExecutor';
import { AuditManager } from './AuditManager';
import { IEventBus } from '../eventbus/IEventBus';
import { EventType } from '../eventbus/EventTypes';

export class TransactionCoordinator {
    constructor(
        private journal: JournalManager,
        private executor: TransactionalExecutor,
        private auditor: AuditManager,
        private eventBus: IEventBus
    ) {}

    private createEvent(type: EventType, id: string, payload: any) {
        return {
            eventId: Math.random().toString(36),
            correlationId: id,
            workspaceId: 'default',
            sender: 'TransactionCoordinator',
            timestamp: new Date(),
            type,
            payload
        };
    }

    async coordinate(batch: WorkspacePatchBatch): Promise<void> {
        const transactionId = batch.id;
        this.auditor.log(transactionId, 'WORKSPACE_MUTATION_STARTED');
        this.eventBus.publish(this.createEvent(EventType.WORKSPACE_MUTATION_STARTED, batch.id, { id: batch.id }));

        try {
            await this.journal.write({ transactionId, state: MutationState.STARTED, batch, timestamp: Date.now() });
            
            await this.journal.write({ transactionId, state: MutationState.STAGED, batch, timestamp: Date.now() });
            
            await this.executor.execute(batch);
            
            await this.journal.write({ transactionId, state: MutationState.COMMITTED, batch, timestamp: Date.now() });
            this.eventBus.publish(this.createEvent(EventType.WORKSPACE_MUTATION_COMMITTED, batch.id, { id: batch.id }));
            
            await this.journal.write({ transactionId, state: MutationState.FINISHED, batch, timestamp: Date.now() });
            this.auditor.log(transactionId, 'WORKSPACE_MUTATION_FINISHED');
        } catch (error) {
            this.auditor.log(transactionId, `WORKSPACE_MUTATION_FAILED: ${error instanceof Error ? error.message : 'Unknown'}`);
            this.eventBus.publish(this.createEvent(EventType.WORKSPACE_MUTATION_FAILED, batch.id, { id: batch.id, error }));
            
            try {
                await this.executor.undo(batch);
            } catch (undoError) {
                this.auditor.log(transactionId, `WORKSPACE_MUTATION_CORRUPTED: ${undoError}`);
                await this.journal.write({ transactionId, state: 'CORRUPTED' as any, batch, timestamp: Date.now() });
                this.eventBus.publish(this.createEvent(EventType.WORKSPACE_MUTATION_CORRUPTED, batch.id, { id: batch.id, error: undoError }));
                throw undoError; 
            }
            
            await this.journal.write({ transactionId, state: MutationState.ROLLED_BACK, batch, timestamp: Date.now() });
            this.eventBus.publish(this.createEvent(EventType.WORKSPACE_MUTATION_ROLLED_BACK, batch.id, { id: batch.id }));
            throw error;
        }
    }
}
