import { useCallback, useEffect, useRef, useState } from 'react';
import { agentV3Reducer } from '../components/agentv3/agentV3Reducer';
import { initialAgentV3State } from '../components/agentv3/agentV3Types';
import type { AgentV3ClientState, AgentV3WireEvent, GitCheckpoint } from '../components/agentv3/agentV3Types';
import { conversationToEvents, conversationToUserMessages, type PersistedConversation } from '../components/agentv3/agentV3History';
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
/** A restored user-authored chat row (transcript-position timestamp for correct interleaving). */
export type UserChatMsg = { role: 'user'; text: string; ts: number };

export interface UseAgentV3Build {
  state: AgentV3ClientState;
  running: boolean;
  error: string | null;
  start: (prompt: string, opts?: { userId?: string; email?: string; onlyOpus?: boolean; powerLevel?: 'off' | 'mini' | 'medium' | 'max'; planFirst?: boolean; thinking?: boolean; sessionId?: string; attachments?: Array<{ name: string; type: string; base64: string }>; framework?: string; importUrl?: string; deployProvider?: string }) => Promise<void>;
  /** Approve or reject a pending plan/permission gate (P4). */
  respond: (requestId: string, approved: boolean) => Promise<void>;
  /** Restore the workspace to a checkpoint commit (History → restore). */
  restore: (sha: string) => Promise<boolean>;
  /** Phase G1 — load the durable git checkpoint history for a workspace (newest first, cross-session). */
  getCheckpoints: (opts: { workspaceId: string; userId?: string; email?: string }) => Promise<GitCheckpoint[]>;
  /** Phase G2 — real working-tree git status for a workspace (available:false when the sandbox is cold). */
  getGitStatus: (opts: { workspaceId: string; userId?: string; email?: string }) => Promise<GitStatus>;
  /** "Restore all files" — genuinely bring the whole project back into the workspace (writes the
   *  durably-saved files back) and reflect the real file list. Returns count + whether it restored. */
  restoreAllFiles: () => Promise<{ ok: boolean; count: number; restored: boolean }>;
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
   * D7 — on (re)load, fetch the user's most recent persisted build and re-display its chat history
   * (option (a): chat + git-restore). Rebuilds the agent narration into state and RETURNS the user's
   * own restored messages so the panel can re-display them too. Returns null if nothing was loaded.
   * No-op while a build is running. Best-effort: any failure resolves null and leaves state untouched.
   */
  loadConversation: (opts?: { userId?: string; email?: string; id?: string }) => Promise<{ messages: UserChatMsg[]; workspaceId?: string } | null>;
  /**
   * List the user's saved v3.0 conversations (metadata only) for the history menu.
   * Always returns an honest result: `error` is set (and `items` is []) whenever the list
   * could NOT be determined (not signed in, network/server failure) — the caller must NOT
   * treat that the same as a genuinely empty history.
   */
  listConversations: (opts?: { userId?: string; email?: string }) => Promise<{ items: ConversationMeta[]; error?: string }>;
  /** Delete a saved conversation (history-menu delete action). Returns true on success. */
  deleteConversation: (id: string, opts?: { userId?: string; email?: string }) => Promise<boolean>;
  /** Watch a build running on another device/instance (cross-device live mirror). Returns a stop fn. */
  subscribeLive: (opts?: { userId?: string; email?: string }) => (() => void);
}

/** Real working-tree git status (Phase G2). available:false when the sandbox isn't warm this session. */
export interface GitStatus {
  available: boolean;
  clean: boolean;
  changed: number;
  head: string;
  /** false for a DORMANT (sandbox-cold) last-known state restored from durable checkpoints; true/absent = live. */
  live?: boolean;
  /** Last durable commit message — shown alongside the dormant "Last saved …" line. */
  lastCommit?: string;
}

/** Lightweight conversation metadata for the history list (matches GET /api/agentv3/conversations). */
export interface ConversationMeta {
  id: string;
  title?: string;
  status?: string;
  workspaceId?: string;
  billedUsd?: number;
  createdAt?: number;
  updatedAt?: number;
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
  // WATCHDOG — timestamp of the last stream event, so a silent/dead stream can be detected.
  const lastEventTsRef = useRef<number>(Date.now());
  // Guards resume() against OVERLAPPING reconnects. (It must NOT guard on `running`: the watchdog
  // reconnects WHILE running is true, and the old `if (running) return` made that reconnect a no-op,
  // leaving the spinner stuck forever after a genuinely dead stream.)
  const resumeInFlightRef = useRef(false);

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
        lastEventTsRef.current = Date.now(); // WATCHDOG — mark stream activity
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

  // Cross-device live mirror: poll the shared LiveChannel for a build running on ANOTHER device/
  // instance and feed its events into THIS panel's reducer, so a 2nd device watching the same chat sees
  // the live activity. Self-limiting for cost: caller starts it only while the panel is visible + not
  // running locally; it also auto-stops after ~30 s of no activity when the server reports not-running.
  // Returns a stop function. Best-effort — never throws.
  const subscribeLive = useCallback((opts?: { userId?: string; email?: string }): (() => void) => {
    const uid = opts?.userId ?? userIdRef.current;
    const em = opts?.email ?? emailRef.current;
    if (!uid) return () => {};
    let stopped = false;
    let sinceSeq = 0;
    let idlePolls = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (stopped) return;
      try {
        const params = new URLSearchParams({ userId: uid });
        if (em) params.set('email', em);
        params.set('sinceSeq', String(sinceSeq));
        const res = await fetch(`/api/agentv3/live?${params.toString()}`);
        if (res.ok) {
          const j = await res.json().catch(() => ({} as Record<string, unknown>));
          if (typeof j.seq === 'number') sinceSeq = j.seq;
          const events = Array.isArray(j.events) ? (j.events as AgentV3WireEvent[]) : [];
          if (events.length > 0) {
            idlePolls = 0;
            setState((cur) => events.reduce((s, e) => agentV3Reducer(s, e), cur));
          } else if (j.running === false) {
            idlePolls += 1; // no activity + nothing running → wind down so an idle open panel stops polling
          }
        }
      } catch { /* best-effort — a failed poll just retries */ }
      if (stopped) return;
      if (idlePolls >= 10) { stopped = true; return; } // ~30 s quiet → stop until re-armed by the panel
      timer = setTimeout(() => { void tick(); }, 3000);
    };
    void tick();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
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

  const loadConversation = useCallback(async (opts?: { userId?: string; email?: string; id?: string }): Promise<{ messages: UserChatMsg[]; workspaceId?: string } | null> => {
    if (running) return null;
    if (opts) { userIdRef.current = opts.userId; emailRef.current = opts.email; }
    try {
      const params = new URLSearchParams();
      if (userIdRef.current) params.set('userId', userIdRef.current);
      if (emailRef.current) params.set('email', emailRef.current);
      // Load a SPECIFIC conversation when an id is given (history menu); otherwise the most recent.
      let convoId = opts?.id;
      if (!convoId) {
        const listRes = await fetch(`/api/agentv3/conversations?${params.toString()}`);
        if (!listRes.ok) return null;
        const listJson = await listRes.json().catch(() => ({}));
        const recent = Array.isArray(listJson?.conversations) ? listJson.conversations[0] : undefined;
        convoId = recent?.id ? String(recent.id) : undefined;
      }
      if (!convoId) return null;
      const oneRes = await fetch(`/api/agentv3/conversations/${encodeURIComponent(convoId)}?${params.toString()}`);
      if (!oneRes.ok) return null;
      const oneJson = await oneRes.json().catch(() => ({}));
      const conv = oneJson?.conversation as PersistedConversation | undefined;
      if (!conv || !Array.isArray(conv.messages)) return null;
      let next = initialAgentV3State();
      for (const e of conversationToEvents(conv)) next = agentV3Reducer(next, e);
      // Cold-resume fix: the live plan/todos were lost when the server instance recycled (~15-min
      // idle), so the conversation events alone leave the plan panel at 0/N. Repopulate it from the
      // durably-saved plan the server restored (workspaceState.todos) so progress is preserved.
      const restoredTodos = Array.isArray(oneJson?.workspaceState?.todos) ? oneJson.workspaceState.todos : [];
      if (restoredTodos.length > 0) {
        next = agentV3Reducer(next, { type: 'todo_updated', todos: restoredTodos, ts: Date.now() } as AgentV3WireEvent);
      }
      setState(next);
      if (conv.workspaceId) {
        // Adopt the workspaceId at the HOOK level so restoreAllFiles / git-status / file loads work on
        // a COLD reopen (they read workspaceIdRef, which the build stream normally sets — but no build
        // ran on a pure reopen). Fixes the "Restore all files" button + file ops being dead cold.
        workspaceIdRef.current = conv.workspaceId;
        // Populate state.files from durable storage so the header "Files (N)" count and every
        // file-count-keyed effect work on reopen (the restored transcript carries NO file events, so
        // state.files was stuck at 0). Fire-and-forget + best-effort; guarded so a fast session switch
        // can't dispatch a stale workspace's files over the new one.
        const wsForFiles = conv.workspaceId;
        void (async () => {
          try {
            const fr = await fetch('/api/agentv3/workspace-files', {
              method: 'POST',
              headers: await authJsonHeaders(),
              body: JSON.stringify({ workspaceId: wsForFiles, userId: userIdRef.current, email: emailRef.current }),
            });
            if (!fr.ok) return;
            const fj = await fr.json().catch(() => ({} as { files?: Record<string, string> }));
            const paths = fj?.files && typeof fj.files === 'object' ? Object.keys(fj.files) : [];
            if (paths.length > 0 && workspaceIdRef.current === wsForFiles) {
              setState((prev) => agentV3Reducer(prev, { type: 'files_restored', files: paths.map((path) => ({ path, kind: 'create' as const })), ts: Date.now() }));
            }
          } catch { /* best-effort — the viewer cache still loads files independently */ }
        })();
      }
      // Return the user's OWN messages so the panel can restore them too (the reducer/narration
      // path only rebuilds the AGENT side — without this the user's bubbles vanish on reload), AND
      // the restored workspaceId so the panel can adopt the SAME session id → a follow-up continues
      // this exact project/memory instead of opening a fresh one.
      return { messages: conversationToUserMessages(conv), workspaceId: conv.workspaceId };
    } catch {
      return null; // best-effort — never disrupt the panel on a load failure
    }
  }, [running]);

  const listConversations = useCallback(async (opts?: { userId?: string; email?: string }): Promise<{ items: ConversationMeta[]; error?: string }> => {
    const uid = opts?.userId ?? userIdRef.current;
    const em = opts?.email ?? emailRef.current;
    if (!uid) return { items: [], error: 'Not signed in.' };
    try {
      const params = new URLSearchParams();
      params.set('userId', uid);
      if (em) params.set('email', em);
      const res = await fetch(`/api/agentv3/conversations?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { error?: string }));
        return { items: [], error: body?.error || `Server error (${res.status}).` };
      }
      const json = await res.json().catch(() => ({}));
      const items = Array.isArray(json?.conversations) ? (json.conversations as ConversationMeta[]) : [];
      return { items };
    } catch (err) {
      return { items: [], error: err instanceof Error ? err.message : 'Network error — could not reach the server.' };
    }
  }, []);

  const deleteConversation = useCallback(async (id: string, opts?: { userId?: string; email?: string }): Promise<boolean> => {
    const uid = opts?.userId ?? userIdRef.current;
    const em = opts?.email ?? emailRef.current;
    if (!uid || !id) return false;
    try {
      const params = new URLSearchParams();
      params.set('userId', uid);
      if (em) params.set('email', em);
      const res = await fetch(`/api/agentv3/conversations/${encodeURIComponent(id)}?${params.toString()}`, { method: 'DELETE' });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  const resume = useCallback(async (opts?: { userId?: string; email?: string }) => {
    if (resumeInFlightRef.current) return; // don't stack concurrent reconnects
    resumeInFlightRef.current = true;
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
      resumeInFlightRef.current = false;
      setRunning(false);
      abortRef.current = null;
    }
  }, [pumpStream]);

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

  // "Restore all files" — calls the REAL restore endpoint (writes the user's saved project back into
  // the workspace) and reflects the actual restored file list in the UI. Returns the count + whether
  // a durable restore happened, so the panel can show honest feedback (never a fake "done").
  const restoreAllFiles = useCallback(async (): Promise<{ ok: boolean; count: number; restored: boolean }> => {
    const workspaceId = workspaceIdRef.current;
    if (!workspaceId) return { ok: false, count: 0, restored: false };
    try {
      const res = await fetch('/api/agentv3/restore-files', {
        method: 'POST',
        headers: await authJsonHeaders(),
        body: JSON.stringify({ workspaceId, userId: userIdRef.current, email: emailRef.current }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, count: 0, restored: false };
      const paths: string[] = Array.isArray(j?.files) ? j.files.filter((p: unknown): p is string => typeof p === 'string') : [];
      // Reflect the genuinely-present files in the Files view.
      setState((prev) => agentV3Reducer(prev, { type: 'files_restored', files: paths.map((path) => ({ path, kind: 'create' as const })), ts: Date.now() }));
      return { ok: true, count: paths.length, restored: j?.restored === true };
    } catch {
      return { ok: false, count: 0, restored: false };
    }
  }, []);

  // Phase G1 — load the DURABLE git checkpoint history for a workspace (newest first), so the IDE's
  // History shows the full timeline across sessions/devices, not just this session's RAM. Best-effort:
  // returns [] on any error. Accepts the workspaceId explicitly because this can run before a build
  // (no state.workspaceId yet) — the panel passes agentv3-{uid}-{sessionId}.
  const getCheckpoints = useCallback(async (opts: { workspaceId: string; userId?: string; email?: string }): Promise<GitCheckpoint[]> => {
    if (!opts?.workspaceId) return [];
    try {
      const params = new URLSearchParams();
      params.set('workspaceId', opts.workspaceId);
      const uid = opts.userId ?? userIdRef.current;
      const em = opts.email ?? emailRef.current;
      if (uid) params.set('userId', uid);
      if (em) params.set('email', em);
      const res = await fetch(`/api/agentv3/checkpoints?${params.toString()}`, { headers: await authJsonHeaders() });
      if (!res.ok) return [];
      const j = await res.json().catch(() => ({}));
      return Array.isArray(j?.checkpoints) ? (j.checkpoints as GitCheckpoint[]) : [];
    } catch {
      return [];
    }
  }, []);

  // Phase G2 — fetch the live working-tree git status for a workspace. Best-effort: returns an
  // honest "not available" shape on any error or cold sandbox.
  const getGitStatus = useCallback(async (opts: { workspaceId: string; userId?: string; email?: string }): Promise<GitStatus> => {
    const offline: GitStatus = { available: false, clean: false, changed: 0, head: '', live: false };
    if (!opts?.workspaceId) return offline;
    try {
      const params = new URLSearchParams();
      params.set('workspaceId', opts.workspaceId);
      const uid = opts.userId ?? userIdRef.current;
      const em = opts.email ?? emailRef.current;
      if (uid) params.set('userId', uid);
      if (em) params.set('email', em);
      const res = await fetch(`/api/agentv3/git-status?${params.toString()}`, { headers: await authJsonHeaders() });
      if (!res.ok) return offline;
      const j = await res.json().catch(() => null);
      if (!j || typeof j !== 'object') return offline;
      return {
        available: j.available === true,
        clean: j.clean === true,
        changed: typeof j.changed === 'number' ? j.changed : 0,
        head: typeof j.head === 'string' ? j.head : '',
        live: j.live !== false, // warm sessions omit `live` → default true; dormant sends live:false
        lastCommit: typeof j.lastCommit === 'string' ? j.lastCommit : undefined,
      };
    } catch {
      return offline;
    }
  }, []);

  const start = useCallback(
    async (prompt: string, opts?: { userId?: string; email?: string; onlyOpus?: boolean; powerLevel?: 'off' | 'mini' | 'medium' | 'max'; planFirst?: boolean; thinking?: boolean; sessionId?: string; attachments?: Array<{ name: string; type: string; base64: string }>; framework?: string; importUrl?: string; deployProvider?: string }) => {
      if (running) return;
      userIdRef.current = opts?.userId;
      emailRef.current = opts?.email;
      // Reset only the TRANSIENT build state for the new turn (narration, todos, plan,
      // agents, done/health). PRESERVE the durable project view — files, workspace, live
      // preview and repo — so a follow-up/retry message does NOT blank the user's files to
      // 0 the instant Send is pressed. The build's file_changed events upsert by path, so
      // keeping the existing list shows no duplicates and the project stays visible.
      setState((prev) => ({
        ...initialAgentV3State(),
        files: prev.files,
        diffs: prev.diffs,
        workspaceId: prev.workspaceId,
        previewUrl: prev.previewUrl,
        repoUrl: prev.repoUrl,
      }));
      setError(null);
      setRunning(true);
      // WATCHDOG — begin the silence window at build start (not stale mount time), so the
      // stall detector measures THIS build and never fires before the first event arrives.
      lastEventTsRef.current = Date.now();

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
            // Power level (admin tiers 2026-06-27): 'off' | 'mini' (5×) | 'medium' (10×) |
            // 'max' (20×). The server falls back to onlyOpus when this is absent.
            powerLevel: opts?.powerLevel,
            planFirst: opts?.planFirst !== false,
            thinking: opts?.thinking === true,
            sessionId: opts?.sessionId,
            attachments: opts?.attachments && opts.attachments.length > 0 ? opts.attachments : undefined,
            framework: opts?.framework || undefined,
            importUrl: opts?.importUrl || undefined,
            // R5 §5.1 — the hosting provider the user chose for a deploy turn (no lock-in).
            deployProvider: opts?.deployProvider || undefined,
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
            lastEventTsRef.current = Date.now(); // WATCHDOG — mark stream activity (incl. 15s pings)
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
          // A mid-stream network drop — iOS Safari surfaces this as "Load failed", and a
          // flaky mobile link or a brief server blip looks the same — must NOT dead-end the
          // build. The server keeps the build alive and BUFFERED (runningBuilds + /attach),
          // so probe it and, if it is still running, transparently re-attach: the buffered
          // events replay and the stream continues exactly where it dropped. Only surface the
          // raw error when the build is genuinely gone. This is the same recovery the stall
          // WATCHDOG performs, triggered immediately on the drop instead of waiting for a
          // silence window that never comes (the drop flips `running` to false first).
          let reconnected = false;
          try {
            const params = new URLSearchParams();
            if (userIdRef.current) params.set('userId', userIdRef.current);
            if (emailRef.current) params.set('email', emailRef.current);
            const probe = await fetch(`/api/agentv3/status?${params.toString()}`);
            const j = await probe.json().catch(() => ({}));
            if (j?.buildRunning === true) {
              reconnected = true;
              await resume({ userId: userIdRef.current, email: emailRef.current });
            }
          } catch { /* probe/reconnect failed — fall through to showing the real error */ }
          if (!reconnected) setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        setRunning(false);
        setServerBuildRunning(false);
        abortRef.current = null;
      }
    },
    [running, resume],
  );

  // WATCHDOG — while a build is "running", if the event stream goes silent for too long the user
  // would otherwise be stuck on an endless spinner. Reconcile with the server: if the build is gone,
  // stop honestly; if it's still alive, auto re-attach (resume) to reconnect the stream. This is the
  // "auto-restart when stuck" safety net — no manual reload needed.
  useEffect(() => {
    if (!running) return;
    const STALL_MS = 100_000;   // ~1.7 min of total stream silence before we act
    const id = setInterval(() => {
      if (Date.now() - lastEventTsRef.current < STALL_MS) return;
      lastEventTsRef.current = Date.now(); // avoid re-firing every tick while we reconcile
      void (async () => {
        try {
          const params = new URLSearchParams();
          if (userIdRef.current) params.set('userId', userIdRef.current);
          if (emailRef.current) params.set('email', emailRef.current);
          const r = await fetch(`/api/agentv3/status?${params.toString()}`);
          const j = await r.json().catch(() => ({}));
          if (j?.buildRunning === true) {
            // The build is alive but OUR stream went quiet — reconnect and keep going.
            abortRef.current?.abort();
            await resume({ userId: userIdRef.current, email: emailRef.current });
          } else {
            // The build is no longer running server-side — stop the spinner instead of hanging.
            abortRef.current?.abort();
            setRunning(false);
            setServerBuildRunning(false);
            setError('The build stopped responding — your files are saved. Send a message and I\'ll continue from where it left off.');
          }
        } catch { /* probe failed — leave running and try again next tick */ }
      })();
    }, 30_000);
    return () => clearInterval(id);
  }, [running, resume]);

  return { state, running, error, start, respond, restore, getCheckpoints, getGitStatus, restoreAllFiles, stop, reset, serverBuildRunning, resume, checkRunning, loadConversation, listConversations, deleteConversation, subscribeLive };
}
