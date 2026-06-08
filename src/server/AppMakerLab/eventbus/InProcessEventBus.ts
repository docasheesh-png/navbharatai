import { randomUUID } from 'crypto';
import { IEvent } from './IEvent';
import { IEventBus, EventHandler } from './IEventBus';
import { IEventHistoryStore } from './IEventHistoryStore';
import { EventType } from './EventTypes';

export class InProcessEventBus implements IEventBus {
    private subscriptions: Map<EventType, Array<{ id: string, handler: EventHandler }>> = new Map();

    constructor(private historyStore: IEventHistoryStore) {}

    async publish(event: IEvent): Promise<void> {
        this.historyStore.add(event);

        const subs = this.subscriptions.get(event.type) || [];
        const promises = subs.map(sub => Promise.resolve(sub.handler(event)));
        await Promise.allSettled(promises);
    }

    subscribe(type: EventType, handler: EventHandler): string {
        const id = randomUUID();
        const subs = this.subscriptions.get(type) || [];
        subs.push({ id, handler });
        this.subscriptions.set(type, subs);
        return id;
    }

    unsubscribe(subscriptionId: string): void {
        for (const [type, subs] of this.subscriptions.entries()) {
            const filteredSubs = subs.filter(sub => sub.id !== subscriptionId);
            if (filteredSubs.length === 0) {
                this.subscriptions.delete(type);
            } else {
                this.subscriptions.set(type, filteredSubs);
            }
        }
    }
}
