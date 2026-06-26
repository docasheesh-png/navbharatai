import { useCallback, useRef, useState } from 'react';
import { agentV3Reducer } from '../components/agentv3/agentV3Reducer';
import { initialAgentV3State } from '../components/agentv3/agentV3Types';
import type { AgentV3ClientState, AgentV3WireEvent } from '../components/agentv3/agentV3Types';
import { conversationToEvents, type PersistedConversation } from '../components/agentv3/agentV3History';
import { auth } from '../App';

/**
 * Build JSON headers carrying the signed-in user's Firebase ID token when available.
 * The server prefers the verified token over any body-supplied userId for workspace
 * ownership checks; a missing token soft-falls-back to the body userId (synthetic admin).
 */
async function authJsonHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const tok = await auth.currentUser?.getIdToken();
    if (tok) headers.Authorization = `Bearer ${tok}`;
  } catch { /* no token — server soft-falls-back to body userId */ }
  return headers;
}

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
  start: (prompt: string, opts?: { userId?: string; email?: string; onlyOpus?: boolean; planFirst?: boolean; thinking?: boolean; sessionId?: string; attachments?: Array<{ name: string; type: string; base64: string }> }) => Promise<void>;
  /** Approve or reject a pending plan/permission gate (P4). */
  respond: (requestId: string, approved: boolean) => Promise<void>;
  /** Restore the workspace to a checkpoint commit (History → restore). */
  restore: (sha: string) => Promise<boolean>;
  stop: () => void;
  reset: () => void;
  /** True when a build is running server-side but this UI is NOT attached to it
   *  (e.g. the original connection was lost) — the panel offers "Resume". */
  serverBuildRunning: boolean;
  /** Re-attach to a build that is already running for this account (replays its
   *  events so the UI catches up, then streams live). */
  resume: (opts?: { userId?: string; email?: string }) => Promise<void>;
  /** Ask the server whether a build is running for this account (sets serverBuildRunning). */
  checkRunning: (opts?: { userId?: string; email?: string }) => Promise<void>;
  /**
   * D7 — on (re)load, fetch the user's most recent persisted build and re-display its chat
   * history (option (a): chat + git-restore). Returns true if a build was loaded. No-op while a
   * build is running. Best-effort: any failure resolves false and leaves the state untouched.
   */
  loadConversation: (opts?: { userId?: string; email?: string }) => Promise<boolean>;
}

export function useAgentV3Build(): UseAgentV3Build {
  const [state, setState] = useState<AgentV3ClientState>(initialAgentV3State);
  const [running, setRunning] = useState(false);
  const [serverBuildRunning, setServerBuildRunning] = useState(false);
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
    setServerBuildRunning(false);
    // Truly stop the SERVER build (not just this local stream), so it cannot keep
    // running and block the next build.
    fetch('/api/agentv3/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: userIdRef.current, email: emailRef.current }),
    }).catch(() => { /* best-effort */ });
  }, []);

  // Read the NDJSON event stream line by line and fold each event into the reducer.
  // Shared by start() and resume(). Surfaces a non-event body so silent failures show.
  const pumpStream = useCallback(async (res: Response): Promise<void> => {
    if (!res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let gotEvent = false;
    let rawSample = '';
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
    if (!gotEvent) {
      const sample = (rawSample || buffer).trim();
      setError(
        sample
          ? `The server did not return v3.0 events. It replied with:\n${sample.slice(0, 300)}`
          : 'No response from the v3.0 engine.',
      );
    }
  }, []);

  const checkRunning = useCallback(async (opts?: { userId?: string; email?: string }) => {
    if (opts) { userIdRef.current = opts.userId; emailRef.current = opts.email; }
    try {
      const params = new URLSearchParams();
      if (userIdRef.current) params.set('userId', userIdRef.current);
      if (emailRef.current) params.set('email', emailRef.current);
      const r = await fetch(`/api/agentv3/status?${params.toString()}`);
      const j = await r.json().catch(() => ({}));
      setServerBuildRunning(j?.buildRunning === true);
    } catch {
      /* best-effort probe — stay as-is on failure */
    }
  }, []);

  const loadConversation = useCallback(async (opts?: { userId?: string; email?: string }): Promise<boolean> => {
    if (running) return false;
    if (opts) { userIdRef.current = opts.userId; emailRef.current = opts.email; }
    try {
      const params = new URLSearchParams();
      if (userIdRef.current) params.set('userId', userIdRef.current);
      if (emailRef.current) params.set('email', emailRef.current);
      const listRes = await fetch(`/api/agentv3/conversations?${params.toString()}`);
      if (!listRes.ok) return false;
      const listJson = await listRes.json().catch(() => ({}));
      const recent = Array.isArray(listJson?.conversations) ? listJson.conversations[0] : undefined;
      if (!recent?.id) return false;
      const oneRes = await fetch(`/api/agentv3/conversations/${encodeURIComponent(String(recent.id))}?${params.toString()}`);
      if (!oneRes.ok) return false;
      const oneJson = await oneRes.json().catch(() => ({}));
      const conv = oneJson?.conversation as PersistedConversation | undefined;
      if (!conv || !Array.isArray(conv.messages)) return false;
      let next = initialAgentV3State();
      for (const e of conversationToEvents(conv)) next = agentV3Reducer(next, e);
      setState(next);
      return true;
    } catch {
      return false; // best-effort — never disrupt the panel on a load failure
    }
  }, [running]);

  const resume = useCallback(async (opts?: { userId?: string; email?: string }) => {
    if (running) return;
    if (opts) { userIdRef.current = opts.userId; emailRef.current = opts.email; }
    setState(initialAgentV3State());   // the replayed buffer rebuilds the live state
    setError(null);
    setServerBuildRunning(false);
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch('/api/agentv3/attach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userIdRef.current, email: emailRef.current }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        setError(typeof j?.error === 'string' ? j.error : `Resume failed (HTTP ${res.status}).`);
        setRunning(false);
        return;
      }
      await pumpStream(res);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }, [running, pumpStream]);

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
        headers: await authJsonHeaders(),
        body: JSON.stringify({ workspaceId, sha, userId: userIdRef.current, email: emailRef.current }),
      });
      const j = await res.json().catch(() => ({}));
      return res.ok && j?.ok === true;
    } catch {
      return false;
    }
  }, []);

  const start = useCallback(
    async (prompt: string, opts?: { userId?: string; email?: string; onlyOpus?: boolean; planFirst?: boolean; thinking?: boolean; sessionId?: string; attachments?: Array<{ name: string; type: string; base64: string }> }) => {
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
            attachments: opts?.attachments && opts.attachments.length > 0 ? opts.attachments : undefined,
            // When the user signed in with GitHub, forward their OAuth token so the build can store
            // the project in the USER'S OWN GitHub repo (commit / PR / CI / merge). Best-effort: a
            // missing token simply falls back to the platform's invisible storage. Read at send time
            // so a GitHub sign-in mid-session is picked up immediately.
            githubToken: (() => { try { return localStorage.getItem('gh_token') || undefined; } catch { return undefined; } })(),
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
        setServerBuildRunning(false);
        abortRef.current = null;
      }
    },
    [running],
  );

  return { state, running, error, start, respond, restore, stop, reset, serverBuildRunning, resume, checkRunning, loadConversation };
}
