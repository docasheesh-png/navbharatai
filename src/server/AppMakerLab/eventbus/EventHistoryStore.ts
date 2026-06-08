import { IEvent } from './IEvent';
import { IEventHistoryStore } from './IEventHistoryStore';

export class EventHistoryStore implements IEventHistoryStore {
    private history: IEvent[] = [];
    private readonly limit: number;
    private readonly namespace: string;

    constructor(namespace: string, limit: number = 500) {
        this.namespace = namespace;
        this.limit = limit;
    }

    add(event: IEvent): void {
        this.history.push(event);
        if (this.history.length > this.limit) {
            this.history.shift();
        }
    }

    getHistory(): IEvent[] {
        return [...this.history];
    }

    getByWorkspaceId(workspaceId: string): IEvent[] {
        return this.history.filter(e => e.workspaceId === workspaceId);
    }

    getByCorrelationId(correlationId: string): IEvent[] {
        return this.history.filter(e => e.correlationId === correlationId);
    }
}
