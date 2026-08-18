// B2 — poll "what is actually running, and on which port" while the App Logs tab is open.
//
// Same cost discipline as useRuntimeLogs: the probe runs a command in a BILLED sandbox, so it only polls
// while the pane is visible, and at a slower cadence than the log tail — process/port state changes on
// the scale of a server restart, not line by line.

import { useEffect, useRef, useState } from 'react';
import { authHeaders } from '../lib/authedFetch';

export interface ServiceRow {
  id: string;
  name: string;
  kind: string;
  port: number | null;
  status: 'listening' | 'not_listening' | 'no_port';
  note: string;
}

export interface ExtraPort {
  port: number;
  label: string;
}

export interface AppServicesState {
  available: boolean;
  services: ServiceRow[];
  extras: ExtraPort[];
  processes: { pid: number; command: string }[];
  summary: string;
  /** True until the first answer arrives, so the strip can stay quiet instead of flashing "nothing runs". */
  loading: boolean;
}

/** Slower than the log tail on purpose: this state changes at the scale of a restart. */
export const APP_SERVICES_POLL_MS = 6_000;

const EMPTY: AppServicesState = { available: false, services: [], extras: [], processes: [], summary: '', loading: true };

export function useAppServices(
  workspaceId: string | null | undefined,
  userId: string | null | undefined,
  email: string | null | undefined,
  active: boolean,
): AppServicesState {
  const [state, setState] = useState<AppServicesState>(EMPTY);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!active || !workspaceId) return;
    let cancelled = false;

    const poll = async (): Promise<void> => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const qs = new URLSearchParams({ workspaceId });
        if (userId) qs.set('userId', userId);
        if (email) qs.set('email', email);
        const res = await fetch(`/api/agentv3/services?${qs.toString()}`, { headers: await authHeaders() });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        setState({
          available: !!data?.available,
          services: Array.isArray(data?.services) ? data.services : [],
          extras: Array.isArray(data?.extras) ? data.extras : [],
          processes: Array.isArray(data?.processes) ? data.processes : [],
          summary: typeof data?.summary === 'string' ? data.summary : '',
          loading: false,
        });
      } catch {
        // Keep the last known state. A network hiccup must not redraw the strip as "nothing is running" —
        // that is a claim about the user's app, and we would not have measured it.
        if (!cancelled) setState((p) => ({ ...p, loading: false }));
      } finally {
        inFlight.current = false;
      }
    };

    void poll();
    const timer = setInterval(() => { void poll(); }, APP_SERVICES_POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [active, workspaceId, userId, email]);

  return state;
}
