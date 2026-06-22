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
  start: (prompt: string, opts?: { userId?: string; onlyOpus?: boolean; planFirst?: boolean }) => Promise<void>;
  /** Approve or reject a pending plan/permission gate (P4). */
  respond: (requestId: string, approved: boolean) => Promise<void>;
  stop: () => void;
  reset: () => void;
}

export function useAgentV3Build(): UseAgentV3Build {
  const [state, setState] = useState<AgentV3ClientState>(initialAgentV3State);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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

  const start = useCallback(
    async (prompt: string, opts?: { userId?: string; onlyOpus?: boolean; planFirst?: boolean }) => {
      if (running) return;
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
            onlyOpus: opts?.onlyOpus === true,
            planFirst: opts?.planFirst !== false,
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
              continue;
            }
            setState((prev) => agentV3Reducer(prev, event));
          }
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

  return { state, running, error, start, respond, stop, reset };
}
