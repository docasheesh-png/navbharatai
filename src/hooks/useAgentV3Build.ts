import { useCallback, useRef, useState } from 'react';
import { agentV3Reducer } from '../components/agentv3/agentV3Reducer';
import { initialAgentV3State } from '../components/agentv3/agentV3Types';
import type { AgentV3ClientState, AgentV3WireEvent } from '../components/agentv3/agentV3Types';

/**
 * useAgentV3Build — drives a v3.0 build and keeps the live client state that all
 * merged surfaces render from (§3.2). It POSTs the prompt to /api/agentv3/chat,
 * reads the NDJSON stream line by line, and folds each event through the pure
 * agentV3Reducer. Everything the UI shows is REAL engine activity (D9).
 */
export interface UseAgentV3Build {
  state: AgentV3ClientState;
  running: boolean;
  error: string | null;
  start: (prompt: string, opts?: { userId?: string; email?: string; onlyOpus?: boolean; planFirst?: boolean; thinking?: boolean; sessionId?: string }) => Promise<void>;
  /** Approve or reject a pending plan/permission gate (P4). */
  respond: (requestId: string, approved: boolean) => Promise<void>;
  /** Restore the workspace to a checkpoint commit (History → restore). */
  restore: (sha: string) => Promise<boolean>;
  stop: () => void;
  reset: () => void;
}

export function useAgentV3Build(): UseAgentV3Build {
  const [state, setState] = useState<AgentV3ClientState>(initialAgentV3State);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const userIdRef = useRef<string | undefined>(undefined);
  const emailRef = useRef<string | undefined>(undefined);
  const workspaceIdRef = useRef<string | undefined>(undefined);

  // Keep the latest workspace id available to restore() without a stale closure.
  workspaceIdRef.current = state.workspaceId;

  const reset = useCallback(() => {
    setState(initialAgentV3State());
    setError(null);
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
  }, []);

  const respond = useCallback(async (requestId: string, approved: boolean) => {
    // Clear the gate immediately so the UI is responsive; the build resumes.
    setState((prev) => ({ ...prev, pendingPermission: undefined }));
    try {
      await fetch('/api/agentv3/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, approved }),
      });
    } catch {
      /* best-effort; the build will time out and auto-deny if this never lands */
    }
  }, []);

  const restore = useCallback(async (sha: string): Promise<boolean> => {
    const workspaceId = workspaceIdRef.current;
    if (!workspaceId) return false;
    try {
      const res = await fetch('/api/agentv3/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, sha, userId: userIdRef.current, email: emailRef.current }),
      });
      const j = await res.json().catch(() => ({}));
      return res.ok && j?.ok === true;
    } catch {
      return false;
    }
  }, []);

  const start = useCallback(
    async (prompt: string, opts?: { userId?: string; email?: string; onlyOpus?: boolean; planFirst?: boolean; thinking?: boolean; sessionId?: string }) => {
      if (running) return;
      userIdRef.current = opts?.userId;
      emailRef.current = opts?.email;
      setState(initialAgentV3State());
      setError(null);
      setRunning(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch('/api/agentv3/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt,
            userId: opts?.userId,
            email: opts?.email,
            onlyOpus: opts?.onlyOpus === true,
            planFirst: opts?.planFirst !== false,
            thinking: opts?.thinking === true,
            sessionId: opts?.sessionId,
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          let msg = `AgentV3 request failed (${res.status}).`;
          try {
            const j = await res.json();
            if (j && typeof j.error === 'string') msg = j.error;
          } catch {
            /* non-JSON error body */
          }
          setError(msg);
          setRunning(false);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let gotEvent = false;
        let rawSample = '';

        // Read NDJSON: one JSON event per line (mirrors the Engineer stream).
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            let event: AgentV3WireEvent;
            try {
              event = JSON.parse(trimmed) as AgentV3WireEvent;
            } catch {
              if (rawSample.length < 400) rawSample += trimmed + '\n';
              continue;
            }
            gotEvent = true;
            setState((prev) => agentV3Reducer(prev, event));
          }
        }

        // If the stream produced no usable events, surface what came back so a
        // silent failure (e.g. an HTML error page, or an empty body) is visible.
        if (!gotEvent) {
          const sample = (rawSample || buffer).trim();
          setError(
            sample
              ? `The server did not return v3.0 events. It replied with:\n${sample.slice(0, 300)}`
              : `No response from the v3.0 engine (HTTP ${res.status}). The backend may be unreachable, or v3.0 is not enabled on the server.`,
          );
        }
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        setRunning(false);
        abortRef.current = null;
      }
    },
    [running],
  );

  return { state, running, error, start, respond, restore, stop, reset };
}
