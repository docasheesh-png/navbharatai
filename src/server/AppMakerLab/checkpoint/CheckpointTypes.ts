export interface Checkpoint {
    id: string;
    taskId: string;
    status: string;
    retryCount: number;
    patchState: any;
    workspaceHash: string;
    timestamp: number;
}
