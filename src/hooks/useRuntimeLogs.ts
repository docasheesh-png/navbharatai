// B1 — poll the user's own running app's log while the Logs pane is open.
//
// POLLING, not a stream, and only while the pane is VISIBLE. The log is a file inside a billed sandbox
// (~₹7/hr), so a connection held open for as long as the tab exists would spend real money to watch a
// file. `active` is the whole cost control: closed pane ⇒ zero requests.

import { useCallback, useEffect, useRef, useState } from 'react';
import { authHeaders } from '../lib/authedFetch';
import { appendLogChunk } from '../lib/runtimeLogBuffer';

export type RuntimeLogStatus = 'idle' | 'live' | 'dormant' | 'not_started';

export interface RuntimeLogsState {
  text: string;
  status: RuntimeLogStatus;
  /** The server's honest one-liner when the window was not continuous (restart / skipped bytes). */
  notice: string;
  /** True once the app has written anything at all — separates "silent" from "never ran". */
  hasLog: boolean;
}

/** How often the pane asks for new bytes. Fast enough to feel live, slow enough not to hammer the VM. */
export const RUNTIME_LOG_POLL_MS = 2_500;

export function useRuntimeLogs(
  workspaceId: string | null | undefined,
  userId: string | null | undefined,
  email: string | null | undefined,
  active: boolean,
): RuntimeLogsState & { clear: () => void } {
  const [state, setState] = useState<RuntimeLogsState>({ text: '', status: 'idle', notice: '', hasLog: false });
  // Refs, not state: the offset must not re-trigger the effect, or every poll would restart the timer.
  const offsetRef = useRef(0);
  const inFlight = useRef(false);

  const clear = useCallback(() => {
    offsetRef.current = 0;
    setState({ text: '', status: 'idle', notice: '', hasLog: false });
  }, []);

  useEffect(() => {
    if (!active || !workspaceId) return;
    let cancelled = false;

    const poll = async (): Promise<void> => {
      // Never stack requests: a slow sandbox would otherwise queue polls faster than they complete.
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const qs = new URLSearchParams({ workspaceId, offset: String(offsetRef.current) });
        if (userId) qs.set('userId', userId);
        if (email) qs.set('email', email);
        const res = await fetch(`/api/agentv3/runtime-logs?${qs.toString()}`, { headers: await authHeaders() });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;

        if (data?.available === false) {
          setState((p) => ({ ...p, status: data.reason === 'dormant' ? 'dormant' : 'not_started' }));
          return;
        }
        offsetRef.current = typeof data?.nextOffset === 'number' ? data.nextOffset : offsetRef.current;
        setState((p) => ({
          // A restart means the log we are appending is from a NEW run — keeping the old text above it
          // unlabelled would read as one continuous run. The notice explains the break.
          text: appendLogChunk(p.text, typeof data?.text === 'string' ? data.text : ''),
          status: 'live',
          notice: typeof data?.notice === 'string' ? data.notice : '',
          hasLog: !!data?.hasLog || p.hasLog,
        }));
      } catch {
        // Network hiccup: keep what we have and try again on the next tick. Never wipe the pane —
        // losing the error the user was reading is worse than a stale pane.
      } finally {
        inFlight.current = false;
      }
    };

    void poll(); // first paint immediately, don't make the user wait a full interval
    const timer = setInterval(() => { void poll(); }, RUNTIME_LOG_POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [active, workspaceId, userId, email]);

  return { ...state, clear };
}
