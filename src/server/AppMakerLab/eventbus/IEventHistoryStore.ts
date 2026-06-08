import { IEvent } from './IEvent';

export interface IEventHistoryStore {
    add(event: IEvent): void;
    getHistory(): IEvent[];
    getByWorkspaceId(workspaceId: string): IEvent[];
    getByCorrelationId(correlationId: string): IEvent[];
}
