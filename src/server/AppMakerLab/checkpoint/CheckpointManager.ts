import { ICheckpointManager } from './ICheckpointManager';
import { Checkpoint } from './CheckpointTypes';
import { CheckpointStorage } from './CheckpointStorage';
import { IEventBus } from '../eventbus/IEventBus';
import { EventType } from '../eventbus/EventTypes';

export class CheckpointManager implements ICheckpointManager {
    constructor(
        private storage: CheckpointStorage,
        private eventBus: IEventBus
    ) {}

    private createEvent(type: EventType, id: string, payload: any) {
        return {
            eventId: Math.random().toString(36),
            correlationId: id,
            workspaceId: 'default',
            sender: 'CheckpointManager',
            timestamp: new Date(),
            type,
            payload
        };
    }

    async save(planId: string, state: any): Promise<void> {
        await this.storage.save(planId, state as any);
        this.eventBus.publish(this.createEvent(EventType.CHECKPOINT_CREATED, planId, { planId }));
    }

    async load(planId: string): Promise<any> {
        const checkpoint = await this.storage.load(planId);
        this.eventBus.publish(this.createEvent(EventType.CHECKPOINT_RESTORED, planId, { planId }));
        return checkpoint;
    }

    async saveCheckpoint(checkpoint: Checkpoint): Promise<void> {
        await this.storage.save(checkpoint.id, checkpoint);
        this.eventBus.publish(this.createEvent(EventType.CHECKPOINT_CREATED, checkpoint.id, { id: checkpoint.id }));
    }

    async loadCheckpoint(id: string): Promise<Checkpoint> {
        const checkpoint = await this.storage.load(id);
        this.eventBus.publish(this.createEvent(EventType.CHECKPOINT_RESTORED, id, { id }));
        return checkpoint;
    }

    async deleteCheckpoint(id: string): Promise<void> {
        await this.storage.delete(id);
        this.eventBus.publish(this.createEvent(EventType.CHECKPOINT_DELETED, id, { id }));
    }

    async listCheckpoints(): Promise<Checkpoint[]> {
        return await this.storage.list();
    }
}
