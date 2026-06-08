export enum TaskStatus {
    PENDING = 'PENDING',
    RUNNING = 'RUNNING',
    COMPLETED = 'COMPLETED',
    FAILED = 'FAILED',
    RETRYING = 'RETRYING',
    CANCELLED = 'CANCELLED'
}

export interface TaskResult {
    taskId: string;
    status: TaskStatus;
    patches: any[];
    error?: Error;
}

export interface ExecutionConfig {
    maxRetries: number;
    baseBackoffMs: number;
}
