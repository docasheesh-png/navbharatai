import {
  renewWorkspaceBuild, releaseWorkspaceBuild, LEASE_HEARTBEAT_MS, LEASE_STALE_MS,
  type BuildLeaseStore,
} from './workspaceBuildLease';

export class WorkspaceImportLeaseError extends Error {
  readonly code = 'BUILD_AUTHORITY_UNAVAILABLE';
  constructor() {
    super('Import ownership could no longer be confirmed. Please retry shortly.');
    this.name = 'WorkspaceImportLeaseError';
  }
}

/**
 * Keep an admitted import's exact token live until its actual work has left. Observed uncertainty,
 * Stop, takeover or local expiry permanently denies NEW operations. A heartbeat cannot cancel a
 * provider call already in flight or make a canonical source write transactional with this lease.
 */
export function holdWorkspaceImportLease(opts: {
  store: BuildLeaseStore; workspaceId: string; token: string; confirmedAtMs: number;
}) {
  let expiresAt = opts.confirmedAtMs + LEASE_STALE_MS;
  let denied = false;
  let closed = false;
  let renewal: Promise<void> | undefined;
  const assertCurrent = (): void => {
    if (Date.now() >= expiresAt) denied = true;
    if (closed || denied) throw new WorkspaceImportLeaseError();
  };
  const heartbeat = async (): Promise<void> => {
    if (closed) return;
    // Local expiry is final for new work, even if a delayed acknowledgement later reports renewal.
    if (Date.now() >= expiresAt) denied = true;
    const persistedAt = Date.now();
    const result = await renewWorkspaceBuild(opts.store, { ...opts, nowMs: persistedAt });
    if (closed) return;
    if (Date.now() >= expiresAt) denied = true;
    if (result === 'held' || result === 'stop-requested') expiresAt = Math.max(expiresAt, persistedAt + LEASE_STALE_MS);
    if (result !== 'held') denied = true;
    // Continue keeping our live token while an already-started call drains, including after Stop.
    // An observed held result never clears the sticky refusal caused by an earlier uncertainty.
  };
  const timer = setInterval(() => {
    if (renewal) return;
    renewal = heartbeat().catch(() => { denied = true; }).finally(() => { renewal = undefined; });
  }, LEASE_HEARTBEAT_MS);
  timer.unref?.();
  return {
    assertCurrent,
    guard<T extends object>(actuator: T): T {
      return new Proxy(actuator, {
        get(target, key) {
          const value = Reflect.get(target, key);
          if (typeof value !== 'function') return value;
          return (...args: unknown[]) => { assertCurrent(); return value.apply(target, args); };
        },
      });
    },
    async release(): Promise<void> {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      await renewal;
      await releaseWorkspaceBuild(opts.store, opts);
    },
  };
}
