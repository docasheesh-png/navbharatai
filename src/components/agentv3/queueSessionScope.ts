/** Async queue responses belong to the session that issued them, including a reopen of that session. */
export interface QueueSessionSnapshot {
  readonly generation: number;
  readonly workspaceId: string | undefined;
  readonly sessionId: string;
  readonly userId: string | undefined;
}

export class QueueSessionScope {
  private current: QueueSessionSnapshot = { generation: 0, workspaceId: undefined, sessionId: '', userId: undefined };

  update(workspaceId: string | undefined, sessionId: string, userId: string | undefined): void {
    if (this.current.workspaceId === workspaceId && this.current.sessionId === sessionId && this.current.userId === userId) return;
    this.current = { generation: this.current.generation + 1, workspaceId, sessionId, userId };
  }

  invalidate(): void { this.current = { ...this.current, generation: this.current.generation + 1 }; }
  capture(): QueueSessionSnapshot { return this.current; }
  isCurrent(snapshot: QueueSessionSnapshot): boolean { return this.current === snapshot; }
}

export async function reconcileCurrentQueue<T>(input: {
  scope: QueueSessionScope;
  load: (workspaceId: string) => Promise<T>;
  apply: (value: T) => void;
  onError: (error: unknown) => void;
}): Promise<boolean> {
  const snapshot = input.scope.capture();
  if (!snapshot.workspaceId) return false;
  try {
    const value = await input.load(snapshot.workspaceId);
    if (!input.scope.isCurrent(snapshot)) return false;
    input.apply(value);
    return true;
  } catch (error) {
    if (input.scope.isCurrent(snapshot)) input.onError(error);
    return false;
  }
}

/** The claim and editor flush may both finish after navigation. Neither may submit into another chat. */
export async function claimCurrentQueueItem<T>(input: {
  scope: QueueSessionScope;
  claim: (workspaceId: string) => Promise<T | null>;
  beforeBuild?: () => Promise<void>;
  run: (item: T, snapshot: QueueSessionSnapshot) => void;
}): Promise<'empty' | 'stale' | 'started'> {
  const snapshot = input.scope.capture();
  if (!snapshot.workspaceId) return 'empty';
  const item = await input.claim(snapshot.workspaceId);
  if (!input.scope.isCurrent(snapshot)) return 'stale';
  if (!item) return 'empty';
  try { await input.beforeBuild?.(); } catch { /* editor flush remains best-effort */ }
  if (!input.scope.isCurrent(snapshot)) return 'stale';
  input.run(item, snapshot);
  return 'started';
}
