import { IVCSProvider } from './IVCSProvider';
import { Commit, Branch, Tag } from './VCSTypes';
import { VCSStateManager } from './VCSStateManager';
import { ICheckpointManager } from '../checkpoint/ICheckpointManager';
import { IEventBus } from '../eventbus/IEventBus';
import { EventType } from '../eventbus/EventTypes';

export class VCSProvider implements IVCSProvider {
    constructor(
        private stateManager: VCSStateManager,
        private checkpointManager: ICheckpointManager,
        private eventBus: IEventBus
    ) {}

    private createEvent(type: EventType, id: string, payload: any) {
        return {
            eventId: Math.random().toString(36),
            correlationId: id,
            workspaceId: 'default',
            sender: 'VCSProvider',
            timestamp: new Date(),
            type,
            payload
        };
    }

    async commit(workspaceId: string, message: string, author?: { name: string; email: string }, correlationId?: string): Promise<Commit> {
        const txId = correlationId || Math.random().toString(36);
        const state = await this.stateManager.getState();
        const chks = await this.checkpointManager.listCheckpoints();
        const checkpointId = `chk-${txId}`;

        await this.stateManager.saveTransaction({
            id: txId, phase: 'PREPARING', checkpointId, timestamp: Date.now()
        });

        this.eventBus.publish(this.createEvent(EventType.VCS_COMMIT_STARTED, txId, { message }));
        try {
            // PREPARE: Save Checkpoint
            await this.checkpointManager.saveCheckpoint({ id: checkpointId, taskId: txId, status: 'PREPARED', retryCount: 0, patchState: {}, workspaceHash: 'hash', timestamp: Date.now() });
            await this.stateManager.updateTransactionPhase(txId, 'CHECKPOINT_PREPARED');

            // COMMIT: Perform VCS Commit
            const commitHash = `hash-${txId}`;
            state.head = commitHash;
            await this.stateManager.saveState(state);
            await this.stateManager.updateTransactionPhase(txId, 'VCS_COMMITTED');

            // FINAL: Finalize
            await this.stateManager.updateTransactionPhase(txId, 'FINALIZED');

            const commit: Commit = { id: commitHash, message, timestamp: Date.now(), parentIds: [state.head] };
            this.eventBus.publish(this.createEvent(EventType.VCS_COMMIT_COMPLETED, txId, { commitId: commitHash }));
            return commit;
        } catch (error) {
            await this.rollback(txId);
            this.eventBus.publish(this.createEvent(EventType.VCS_COMMIT_FAILED, txId, { error }));
            throw error;
        }
    }

    async rollback(txId: string): Promise<void> {
        const tx = await this.stateManager.getTransaction(txId);
        if (tx && tx.phase !== 'ROLLED_BACK') {
            if (tx.phase === 'CHECKPOINT_PREPARED') {
                await this.checkpointManager.deleteCheckpoint(tx.checkpointId);
            }
            await this.stateManager.updateTransactionPhase(txId, 'ROLLED_BACK');
            this.eventBus.publish(this.createEvent(EventType.VCS_ROLLBACK_COMPLETED, txId, { txId }));
        }
    }

    async recover(): Promise<void> {
        const transactions = await this.stateManager.listTransactions();
        for (const tx of transactions) {
            if (tx.phase === 'PREPARING' || tx.phase === 'CHECKPOINT_PREPARED') {
                await this.rollback(tx.id);
            } else if (tx.phase === 'VCS_COMMITTED') {
                await this.stateManager.updateTransactionPhase(tx.id, 'FINALIZED');
            }
        }
    }

    async createBranch(workspaceId: string = 'default', name: string, correlationId?: string): Promise<Branch> {
        const state = await this.stateManager.getState();
        const branch = { name, commitId: state.head };
        state.branches.push(branch);
        await this.stateManager.saveState(state);
        return branch;
    }

    async deleteBranch(name: string): Promise<void> {
        const state = await this.stateManager.getState();
        state.branches = state.branches.filter(b => b.name !== name);
        await this.stateManager.saveState(state);
    }

    async createTag(name: string, commitId: string): Promise<Tag> {
        const state = await this.stateManager.getState();
        const tag = { name, commitId };
        state.tags.push(tag);
        await this.stateManager.saveState(state);
        return tag;
    }

    async updateLKG(commitId: string): Promise<void> {
        const state = await this.stateManager.getState();
        state.LKGCommitHash = commitId;
        await this.stateManager.saveState(state);
        this.eventBus.publish(this.createEvent(EventType.VCS_LKG_UPDATED, commitId, { commitId }));
    }
}
