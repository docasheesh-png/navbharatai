import { IEvent } from './IEvent';
import { WorkspaceProjection } from './WorkspaceProjection';

export interface IEventHistoryStore {
    add(event: IEvent): void;
    getHistory(): IEvent[];
    getByWorkspaceId(workspaceId: string): IEvent[];
    getByCorrelationId(correlationId: string): IEvent[];

    /**
     * P4.2 — fold this workspace's events through the pure reducer into a lifecycle /
     * mutation-ledger / VCS-ref projection. Note: mutation events are bound by correlationId
     * (batch id), so use `replayByCorrelationId` to recover the per-batch mutation ledger.
     */
    replayWorkspace(workspaceId: string): WorkspaceProjection;

    /** P4.2 — replay the events of one correlation (e.g. a mutation batch) into a projection. */
    replayByCorrelationId(correlationId: string): WorkspaceProjection;
}
