import { withSessionAbort } from './sessionAbort';

/** Detect remote logout without mistaking offline/network/service failure for a revoked session. */
export const SESSION_CHECK_INTERVAL_MS = 60_000;
export interface MonitoredUser { getIdToken(): Promise<string>; refreshToken: string }
export interface SessionMonitorDeps {
  currentUser(): MonitoredUser | null;
  invalidate(user: MonitoredUser, refreshToken: string): Promise<void>;
  fetch: typeof fetch;
  visible(): boolean;
}

export function createSessionMonitor(deps: SessionMonitorDeps): { check(): Promise<void>; stop(): void } {
  let stopped = false;
  let checking = false;
  let controller: AbortController | null = null;
  return {
    async check() {
      const user = deps.currentUser();
      if (stopped || checking || !user || !deps.visible()) return;
      const refreshToken = user.refreshToken;
      checking = true;
      controller = new AbortController();
      const signal = controller.signal;
      const timeout = setTimeout(() => controller?.abort(), 10_000);
      const stillCurrent = () => !stopped && deps.currentUser() === user && user.refreshToken === refreshToken && deps.visible();
      try {
        const token = await withSessionAbort(user.getIdToken(), signal);
        if (!stillCurrent() || signal.aborted) return;
        const response = await withSessionAbort(deps.fetch('/api/v1/auth/session', {
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal,
        }), signal);
        if (response.status === 401 && stillCurrent()) await deps.invalidate(user, refreshToken);
      } catch (error) {
        // These are SDK-auth failures, not transport outages. Other failures retry only on the
        // next foreground/online/poll event, never by repeatedly calling a broken service.
        const code = (error as { code?: string } | null)?.code;
        if (['auth/user-token-expired', 'auth/user-disabled', 'auth/invalid-user-token'].includes(code ?? '')
          && stillCurrent()) await deps.invalidate(user, refreshToken);
      } finally {
        clearTimeout(timeout);
        controller = null;
        checking = false;
      }
    },
    stop() { stopped = true; controller?.abort(); },
  };
}
