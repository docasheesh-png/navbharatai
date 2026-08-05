import React, { useEffect, useRef, useState } from 'react';
import type { Terminal } from 'xterm';
import type { FitAddon } from 'xterm-addon-fit';
import { auth } from '../../App';

/**
 * REAL shell for Code Studio — a genuine TTY in the user's own sandbox (admin 2026-08-04: "kya ham,
 * replit jaisa real shell nahi bana sakte?").
 *
 * The previous terminal posted one command to /api/agentv3/exec and printed the result. That is a
 * command runner: no `cd` between commands, no live output, no Ctrl+C, and a 30s cap that cut
 * `npm install` off mid-work. This talks to a persistent PTY instead (see server ShellSessions.ts),
 * so state persists, output streams as it is produced, Ctrl+C interrupts, and interactive prompts
 * can actually be answered.
 *
 * WHY xterm.js AND NOT A LIST OF LINES: a real shell speaks ANSI — colours, cursor movement,
 * in-place progress bars, `clear`, `top`, `vim`. Rendering that into React state would show the
 * escape codes as garbage. xterm.js is the same terminal emulator VS Code itself uses.
 *
 * WHY xterm IS LOADED DYNAMICALLY: it is ~70 KB gzipped, and most people open Code Studio to read
 * code, not to type shell commands. A static import put it in everybody's download and pushed the
 * app past its bundle budget; importing it on first terminal open means only the people who use a
 * terminal ever pay for one.
 *
 * WHY fetch-streaming AND NOT EventSource: EventSource cannot send an Authorization header, so using
 * it would have meant putting the Firebase token in the query string — where it lands in access logs
 * and browser history. A streamed fetch keeps the token in the header, where it belongs; we parse the
 * SSE frames ourselves, which is a few lines.
 *
 * WHY THE SHELL SURVIVES UNMOUNT: switching to the Preview tab must not kill a running build. The
 * shellId is remembered per terminal tab, so remounting REATTACHES to the same live shell and replays
 * the scrollback from the server. The shell is killed only when the user explicitly closes that
 * terminal — or by the server's idle reaper, long after everyone has stopped watching.
 */

/** sessionKey → live shellId, so a remount reattaches instead of orphaning a running shell. */
const attachedShells = new Map<string, string>();

async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const token = await auth.currentUser?.getIdToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch { /* unauthenticated calls are rejected server-side, honestly */ }
  return headers;
}

/**
 * Explicitly kill the shell behind a terminal tab. Called when the user closes that terminal — the
 * only moment a shell should die on purpose.
 */
export async function closeShellSession(
  sessionKey: string,
  workspaceId?: string,
  userId?: string,
  email?: string,
): Promise<void> {
  const shellId = attachedShells.get(sessionKey);
  attachedShells.delete(sessionKey);
  if (!shellId || !workspaceId) return;
  try {
    await fetch('/api/agentv3/shell/close', {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ workspaceId, userId, email: email || '', shellId }),
    });
  } catch { /* the server's idle reaper is the backstop */ }
}

export interface ShellTerminalProps {
  /** Stable per-tab id. Keeps a remounted tab attached to its own running shell. */
  sessionKey: string;
  workspaceId?: string;
  userId?: string;
  email?: string;
  /** True when this tab is the visible one — drives focus and a refit after being hidden. */
  active?: boolean;
}

type Status =
  | { kind: 'connecting' }
  | { kind: 'live' }
  | { kind: 'exited'; code: number | null }
  | { kind: 'unavailable'; message: string };

export const ShellTerminal: React.FC<ShellTerminalProps> = ({
  sessionKey, workspaceId, userId, email, active,
}) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const shellIdRef = useRef<string | null>(null);
  const cursorRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  /**
   * Generation counter, not a boolean "disposed" flag. React StrictMode mounts, unmounts and remounts
   * an effect, so a shared boolean is set back to false by the second run while the FIRST run's async
   * work is still suspended on an await — and it then happily builds a second terminal into the same
   * container. Comparing against the generation this effect was born with makes a stale run inert.
   */
  const genRef = useRef(0);
  const [status, setStatus] = useState<Status>({ kind: 'connecting' });

  useEffect(() => {
    const gen = genRef.current + 1;
    genRef.current = gen;
    const alive = () => genRef.current === gen;

    const host = hostRef.current;
    if (!host) return;

    let term: Terminal | null = null;
    let disposers: (() => void)[] = [];

    void (async () => {
      const [{ Terminal: XTerm }, { FitAddon: XFit }] = await Promise.all([
        import('xterm'),
        import('xterm-addon-fit'),
      ]);
      await import('xterm/css/xterm.css');
      if (!alive()) return;

      term = new XTerm({
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: 13,
        cursorBlink: true,
        scrollback: 5000,
        theme: {
          background: '#0d1117',
          foreground: '#c9d1d9',
          cursor: '#58a6ff',
          selectionBackground: '#264f78',
        },
      });
      const fit = new XFit();
      term.loadAddon(fit);
      term.open(host);
      try { fit.fit(); } catch { /* zero-size container on first paint */ }
      termRef.current = term;
      fitRef.current = fit;

      // Keystrokes go straight to the TTY. Ctrl+C arrives here as the real \x03 byte and is forwarded
      // untouched — that is what makes interrupting work, rather than a "stop" button faking it.
      const onData = term.onData((data) => { void sendInput(data); });
      const onResize = term.onResize(({ cols, rows }) => { void sendResize(cols, rows); });
      // Refit when the panel is dragged, the phone rotates, or this tab becomes visible again.
      const observer = new ResizeObserver(() => { try { fit.fit(); } catch { /* mid-layout */ } });
      observer.observe(host);
      disposers = [() => onData.dispose(), () => onResize.dispose(), () => observer.disconnect()];

      await start(term, fit, alive);
    })();

    return () => {
      genRef.current += 1;               // invalidate this effect's generation
      abortRef.current?.abort();
      for (const d of disposers) { try { d(); } catch { /* best effort */ } }
      try { term?.dispose(); } catch { /* best effort */ }
      // Deliberately NOT closing the shell: an unmount is a tab switch or a navigation, not an
      // instruction to kill a running build. closeShellSession() is the explicit path.
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey, workspaceId, userId]);

  useEffect(() => {
    if (!active) return;
    // A hidden container has no size, so xterm sized itself to nothing. Refit and focus on return.
    const t = setTimeout(() => {
      try { fitRef.current?.fit(); } catch { /* mid-layout */ }
      termRef.current?.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [active]);

  async function start(term: Terminal, fit: FitAddon, alive: () => boolean): Promise<void> {
    if (!workspaceId || !userId) {
      setStatus({ kind: 'unavailable', message: 'Sign in and start a build in NavBharatAI Pro v5.0 to open a terminal.' });
      term.write('\x1b[90mSign in and start a build in NavBharatAI Pro v5.0 to open a terminal.\x1b[0m\r\n');
      return;
    }

    // Reattach to this tab's existing shell if it is still alive, so a tab switch or a page
    // navigation does not orphan a running command.
    const existing = attachedShells.get(sessionKey);
    if (existing) {
      shellIdRef.current = existing;
      cursorRef.current = 0;             // ask for the whole scrollback back
      setStatus({ kind: 'live' });
      void stream(term, alive);
      return;
    }

    let cols = 80;
    let rows = 24;
    try { const d = fit.proposeDimensions(); if (d) { cols = d.cols; rows = d.rows; } } catch { /* defaults */ }

    try {
      const res = await fetch('/api/agentv3/shell/open', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ workspaceId, userId, email: email || '', cols, rows }),
      });
      const j = await res.json().catch(() => null);
      if (!alive()) return;

      if (!res.ok || !j) {
        // Say WHICH failure this is. A bare "couldn't open" sends the user (and whoever debugs it)
        // hunting, when the status code already names the cause.
        const message = j?.error || (
          res.status === 401 || res.status === 403 ? 'Your session expired — reload the page and sign in again to use the terminal.'
          : res.status === 429 ? 'Too many terminals opened just now. Wait a few seconds and try again.'
          : res.status === 404 ? 'The terminal service is not enabled on this server.'
          : res.status >= 500 ? `The terminal service failed (${res.status}). Try again in a moment.`
          : `Could not open a terminal (${res.status}).`
        );
        setStatus({ kind: 'unavailable', message });
        term.write(`\x1b[31m${message}\x1b[0m\r\n`);
        if (j?.detail) term.write(`\x1b[90m${String(j.detail).slice(0, 300)}\x1b[0m\r\n`);
        return;
      }
      if (j.available === false) {
        // Honest dormant state, matching the git panel's calm copy — the project's files are safe;
        // the sandbox just needs waking. Never a fake prompt.
        const message = j.reason === 'dormant'
          ? `Workspace is dormant after a restart — your ${j.savedFileCount} saved file${j.savedFileCount === 1 ? '' : 's'} ${j.savedFileCount === 1 ? 'is' : 'are'} safe. Send a message in NavBharatAI Pro v5.0 chat to bring the sandbox back online, then the terminal works again.`
          : 'Sandbox not active yet — start a build in NavBharatAI Pro v5.0 chat to bring the terminal online.';
        setStatus({ kind: 'unavailable', message });
        term.write(`\x1b[90m${message}\x1b[0m\r\n`);
        // The exact precondition, dim and on its own line. It is meaningless to most users and
        // everything to whoever debugs a report — and it is only ever shown to the person who owns
        // this workspace, because the route that produced it is ownership-checked.
        if (j.cause) term.write(`\x1b[90m[${j.cause}]\x1b[0m\r\n`);
        return;
      }

      shellIdRef.current = j.shellId;
      cursorRef.current = typeof j.cursor === 'number' ? j.cursor : 0;
      attachedShells.set(sessionKey, j.shellId);
      setStatus({ kind: 'live' });
      void stream(term, alive);
    } catch (e) {
      if (!alive()) return;
      // The request never completed at all — offline, a dropped connection, or the server closing it.
      // Carry the browser's own reason: "Could not reach the terminal service." on its own told
      // nobody anything, including me when a live report arrived and I could not reproduce it
      // (admin screenshot 2026-08-05). An error that does not name its cause is a second bug.
      const detail = e instanceof Error && e.message ? ` (${e.message})` : '';
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      const message = offline
        ? 'You appear to be offline — the terminal needs a connection.'
        : `Could not reach the terminal service${detail}. Check your connection, then reopen the terminal.`;
      setStatus({ kind: 'unavailable', message });
      term.write(`\x1b[31m${message}\x1b[0m\r\n`);
    }
  }

  /**
   * Read the SSE stream and paint it. On an unexpected disconnect we reconnect FROM THE CURSOR, so a
   * locked phone or a dropped network resumes exactly where it left off — no gap, no repeats.
   */
  async function stream(term: Terminal, alive: () => boolean): Promise<void> {
    let backoff = 500;
    while (alive() && shellIdRef.current) {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const params = new URLSearchParams({
          workspaceId: workspaceId || '',
          userId: userId || '',
          email: email || '',
          shellId: shellIdRef.current,
          cursor: String(cursorRef.current),
        });
        const res = await fetch(`/api/agentv3/shell/stream?${params.toString()}`, {
          headers: await authHeaders(),
          signal: controller.signal,
        });
        if (res.status === 404) {
          // The shell is genuinely gone (server restart, reaper). Say so rather than reconnecting
          // forever against something that no longer exists.
          attachedShells.delete(sessionKey);
          shellIdRef.current = null;
          if (alive()) {
            setStatus({ kind: 'exited', code: null });
            term.write('\r\n\x1b[90m[terminal closed — open a new one to continue]\x1b[0m\r\n');
          }
          return;
        }
        if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);

        backoff = 500;                    // a successful connect resets the retry ramp
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let split = buffer.indexOf('\n\n');   // SSE frames are separated by a blank line
          while (split !== -1) {
            handleFrame(term, buffer.slice(0, split));
            buffer = buffer.slice(split + 2);
            split = buffer.indexOf('\n\n');
          }
        }
      } catch {
        if (!alive()) return;
      }
      if (!alive() || !shellIdRef.current) return;
      // Reconnect with a gentle ramp so a server blip does not become a request storm.
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 8000);
    }
  }

  function handleFrame(term: Terminal, frame: string): void {
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of frame.split('\n')) {
      if (line.startsWith(':')) continue;                   // heartbeat
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (dataLines.length === 0) return;
    let payload: { data?: string; cursor?: number; truncated?: boolean; exitCode?: number | null };
    try { payload = JSON.parse(dataLines.join('\n')); } catch { return; }

    if (event === 'exit') {
      attachedShells.delete(sessionKey);
      shellIdRef.current = null;
      setStatus({ kind: 'exited', code: payload.exitCode ?? null });
      return;
    }
    // Never present a scrollback with a silent hole in it.
    if (payload.truncated) term.write('\r\n\x1b[90m[…earlier output trimmed…]\x1b[0m\r\n');
    if (payload.data) term.write(payload.data);
    if (typeof payload.cursor === 'number') cursorRef.current = payload.cursor;
  }

  async function sendInput(data: string): Promise<void> {
    const shellId = shellIdRef.current;
    if (!shellId || !workspaceId) return;
    try {
      await fetch('/api/agentv3/shell/input', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ workspaceId, userId, email: email || '', shellId, data }),
      });
    } catch { /* the stream's own reconnect surfaces a real outage */ }
  }

  async function sendResize(cols: number, rows: number): Promise<void> {
    const shellId = shellIdRef.current;
    if (!shellId || !workspaceId) return;
    try {
      await fetch('/api/agentv3/shell/resize', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ workspaceId, userId, email: email || '', shellId, cols, rows }),
      });
    } catch { /* cosmetic until the next resize */ }
  }

  const restart = () => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;
    attachedShells.delete(sessionKey);
    shellIdRef.current = null;
    cursorRef.current = 0;
    term.reset();
    setStatus({ kind: 'connecting' });
    const gen = genRef.current;
    void start(term, fit, () => genRef.current === gen);
  };

  return (
    <div className="relative h-full w-full bg-[#0d1117]">
      <div ref={hostRef} className="absolute inset-0 p-2" />
      {status.kind === 'exited' && (
        <button
          onClick={restart}
          className="absolute bottom-3 right-3 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-black uppercase tracking-widest shadow-lg"
        >
          Restart terminal
        </button>
      )}
    </div>
  );
};
