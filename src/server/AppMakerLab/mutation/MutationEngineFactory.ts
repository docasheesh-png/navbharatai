import { JournalManager } from './JournalManager';
import { TransactionalExecutor } from './TransactionalExecutor';
import { AuditManager } from './AuditManager';
import { LockManager } from './LockManager';
import { ConflictDetector } from './ConflictDetector';
import { TransactionCoordinator } from './TransactionCoordinator';
import { WorkspaceMutationEngine } from './WorkspaceMutationEngine';
import { InProcessEventBus } from '../eventbus/InProcessEventBus';
import { EventHistoryStore } from '../eventbus/EventHistoryStore';
import { ICheckpointManager } from '../checkpoint/ICheckpointManager';

export class MutationEngineFactory {
    static create(checkpointManager: ICheckpointManager, namespace: string): {
        mutationEngine: WorkspaceMutationEngine;
        eventBus: InProcessEventBus;
        eventHistoryStore: EventHistoryStore;
    } {
        const eventBus = new InProcessEventBus();
        const eventHistoryStore = new EventHistoryStore(namespace);
        const journal = new JournalManager();
        const executor = new TransactionalExecutor();
        const auditor = new AuditManager();
        const lockManager = new LockManager();
        const conflictDetector = new ConflictDetector();
        const coordinator = new TransactionCoordinator(journal, executor, auditor, eventBus);
        
        const mutationEngine = new WorkspaceMutationEngine(
            coordinator,
            lockManager,
            conflictDetector,
            journal,
            executor,
            checkpointManager
        );

        return { mutationEngine, eventBus, eventHistoryStore };
    }
}
