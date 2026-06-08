export class LockManager {
    private locks: Set<string> = new Set();

    async acquire(workspaceId: string): Promise<void> {
        if (this.locks.has(workspaceId)) throw new Error('Lock already held');
        this.locks.add(workspaceId);
    }

    async release(workspaceId: string): Promise<void> {
        this.locks.delete(workspaceId);
    }
}
