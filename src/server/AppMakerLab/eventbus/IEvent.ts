import { EventType } from './EventTypes';

export interface IEvent {
    eventId: string;
    correlationId: string;
    workspaceId: string;
    sender: string;
    timestamp: Date;
    type: EventType;
    payload: Record<string, unknown>;
}
