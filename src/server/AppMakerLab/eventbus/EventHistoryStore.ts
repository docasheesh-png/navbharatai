import { IEvent } from './IEvent';
import { IEventHistoryStore } from './IEventHistoryStore';
import { replayWorkspaceState, WorkspaceProjection } from './WorkspaceProjection';

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

    // P4.2 — Event replay. Fold the filtered (chronological, push-only) event slice through
    // the pure reducer to rebuild the workspace projection from the event log.
    replayWorkspace(workspaceId: string): WorkspaceProjection {
        return replayWorkspaceState(this.getByWorkspaceId(workspaceId), workspaceId);
    }

    replayByCorrelationId(correlationId: string): WorkspaceProjection {
        return replayWorkspaceState(this.getByCorrelationId(correlationId), correlationId);
    }
}
