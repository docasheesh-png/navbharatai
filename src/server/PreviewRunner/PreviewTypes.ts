export enum PreviewStatus {
    CREATED = 'CREATED',
    STARTING = 'STARTING',
    RUNNING = 'RUNNING',
    FAILED = 'FAILED',
    STOPPED = 'STOPPED',
    EXPIRED = 'EXPIRED'
}

export interface PreviewSession {
    sessionId: string;
    workspaceId: string;
    status: PreviewStatus;
    assignedPort: number;
    previewUrl: string;
    processId?: number;
    startedAt?: Date;
}
