import React, { useEffect, useRef, useState } from 'react';
import type { Terminal } from 'xterm';
import type { FitAddon } from 'xterm-addon-fit';
import { authJsonHeaders as authHeaders } from '../../lib/authHeaders';

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

/**
 * One honest percentage for the wake (admin 2026-08-06: "loading files hata do! % banao. aur 100%
 * ke bad chalna chahiye, farzi na lage"). The scale is anchored to the real phases — and 100 exists
 * ONLY for 'ready', so the bar can never read complete while anything is still pending. Seeding maps
 * to 10–94 by the actual seeded/total counter; an unknown total sits mid-scale rather than lying.
 */
export function wakePercent(w?: { phase?: string; seeded?: number; total?: number } | null): number {
  if (!w || w.phase === 'starting') return 5;
  if (w.phase === 'seeding') {
    const total = w.total ?? 0;
    return total > 0 ? Math.min(94, 10 + Math.round(((w.seeded ?? 0) / total) * 84)) : 50;
  }
  if (w.phase === 'finishing') return 96;
  if (w.phase === 'ready') return 100;
  return 5;
}

/** sessionKey → live shellId, so a remount reattaches instead of orphaning a running shell. */
const attachedShells = new Map<string, string>();


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
  /**
   * The REAL daily allowance left, reported by the server on open and on every meter tick. Lifted to
   * the parent because the header that states it belongs to the panel, not to one terminal — and
   * because the allowance is per USER, shared by every terminal open (see server terminalMeter.ts).
   */
  onRemainingSeconds?: (seconds: number) => void;
}

type Status =
  | { kind: 'connecting' }
  | { kind: 'live' }
  | { kind: 'exited'; code: number | null }
  | { kind: 'unavailable'; message: string };

export const ShellTerminal: React.FC<ShellTerminalProps> = ({
  sessionKey, workspaceId, userId, email, active, onRemainingSeconds,
}) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const shellIdRef = useRef<string | null>(null);
  const cursorRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  /**
   * Keystrokes typed while the shell is still OPENING. They used to be silently discarded —
   * `sendInput` returned early on a null shellId — which is exactly what a live report showed
   * (admin screenshot 2026-08-05): the terminal said "Starting your workspace…", the user typed,
   * and nothing happened, ever. Waking a dormant sandbox takes real seconds, and typing into a
   * terminal that is still starting is what everyone does at an ssh prompt: a real terminal
   * BUFFERS those keys and runs them when the shell arrives. So do we. Bounded so a stuck open
   * can never hoard unbounded memory; the PTY's own input cap is 8192 (ShellSessions.ts).
   */
  const pendingInputRef = useRef('');
  const connectingRef = useRef(false);
  const queueHintShownRef = useRef(false);
  const PENDING_INPUT_CAP = 2048;
  /**
   * Generation counter, not a boolean "disposed" flag. React StrictMode mounts, unmounts and remounts
   * an effect, so a shared boolean is set back to false by the second run while the FIRST run's async
   * work is still suspended on an await — and it then happily builds a second terminal into the same
   * container. Comparing against the generation this effect was born with makes a stale run inert.
   */
  const genRef = useRef(0);
  const [status, setStatus] = useState<Status>({ kind: 'connecting' });
  /**
   * TOUCH DEVICES GET A REAL COMMAND BAR (admin 2026-08-05, second live report: "terminal me kuch
   * bhi type nahi ho raha hai!!!" — on an iPhone, keyboard open, nothing typed).
   *
   * Root cause, named honestly: xterm.js does NOT support mobile soft keyboards. Its input path is a
   * hidden textarea driven by keydown/composition events, which iOS's software keyboard does not
   * deliver reliably — the keyboard OPENS (the textarea takes focus, which is exactly what the
   * admin's screenshot showed) but onData never fires, so no fix inside our keystroke plumbing can
   * ever make direct typing work there. Patching around an unsupported path would be a surface
   * patch; the root-cause answer is an input channel WE own end-to-end: a visible command bar that
   * sends straight to the PTY — the same approach real mobile terminals (Termius, Blink) take.
   * Desktop keyboards work fine through xterm and are unchanged; the bar appears only for coarse
   * (touch) pointers.
   */
  const [showCommandBar] = useState<boolean>(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches,
  );
  const [barText, setBarText] = useState('');
  const barInputRef = useRef<HTMLInputElement | null>(null);
  /**
   * DIRECT TYPING INSIDE THE TERMINAL BOX on touch devices (admin 2026-08-05, third report: the
   * command bar types fine — "waha to type ho raha hai, work bhi kar raha hai" — "par mujhe terminal
   * box me hi type karna hai").
   *
   * The bar WORKING is the proof that unlocks this: iOS delivers input events reliably to a real
   * <input> — it is only xterm's hidden textarea (keydown-driven) that starves. So the terminal box
   * gets an invisible BRIDGE input of our own: tapping the box focuses it, and every character it
   * receives is forwarded to the PTY that instant, per keystroke, like ssh. The PTY's echo paints
   * into xterm, so typing visibly happens "in the terminal".
   *
   * The sentinel trick: an EMPTY input fires no event for Backspace on iOS (there is nothing to
   * delete), so the bridge always holds one zero-width space. Value shrinking below the sentinel IS
   * the backspace — sent as DEL (\x7f) — and the value then resets to the sentinel. Composition
   * (Hindi and other IME keyboards) is respected: nothing is forwarded mid-composition; the composed
   * text goes on compositionend.
   */
  const bridgeRef = useRef<HTMLInputElement | null>(null);
  const composingRef = useRef(false);
  const BRIDGE_SENTINEL = '\u200B';

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
        // ⚠️ LITERAL HEXES ONLY — this object is parsed by xterm.js, not by the browser's CSS engine,
        // and its colour parser does not understand `var(...)`. A sweep that replaced hardcoded
        // colours with theme vars reached in here and had to be backed out: an inline style goes to
        // the DOM, but a library's config goes to the library.
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
    // On a touch device, focus goes to the COMMAND BAR — focusing xterm there raises a keyboard
    // whose keys xterm cannot receive (the exact reported dead end).
    const t = setTimeout(() => {
      try { fitRef.current?.fit(); } catch { /* mid-layout */ }
      if (showCommandBar) barInputRef.current?.focus();
      else termRef.current?.focus();
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  async function start(term: Terminal, fit: FitAddon, alive: () => boolean, attempt = 0): Promise<void> {
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

    // Opening a dormant workspace now WAKES it server-side, and resuming a sandbox takes real seconds.
    // Say so, or the terminal looks frozen for the one moment it is doing the most work.
    term.write('\x1b[90mStarting your workspace…\x1b[0m\r\n');
    connectingRef.current = true;
    queueHintShownRef.current = false;
    // A cold E2B resume can genuinely take tens of seconds. One more line at 15s keeps a slow wake
    // distinguishable from a dead one — silence past the first message reads as a hang.
    const slowNote = setTimeout(() => {
      if (alive() && connectingRef.current) term.write('\x1b[90mStill waking the sandbox — a cold start can take up to a minute…\x1b[0m\r\n');
    }, 15000);

    let cols = 80;
    let rows = 24;
    try { const d = fit.proposeDimensions(); if (d) { cols = d.cols; rows = d.rows; } } catch { /* defaults */ }

    let enteredWakePoll = false;
    try {
      // Bounded, and now SHORT: the wake runs as a background job server-side (admin 2026-08-06,
      // "start hone me bahut time laga, fir bhi start nahi hua" — the old open held the request
      // through a whole cold sandbox create, so 90s expired on wakes that were actually
      // succeeding). This request only starts/checks the wake and answers; the waiting happens in
      // pollWake below, judged by PROGRESS, never by a clock.
      const res = await fetch('/api/agentv3/shell/open', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ workspaceId, userId, email: email || '', cols, rows }),
        signal: AbortSignal.timeout(25_000),
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
      if (j.available === false && j.reason === 'waking') {
        // The workspace is waking in the background — switch to the progress poll. Everything the
        // user types keeps queueing (connectingRef stays true), exactly like typing at an ssh
        // prompt before the banner.
        enteredWakePoll = true;
        void pollWake(term, fit, alive, attempt);
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
      if (typeof j.remainingSeconds === 'number') onRemainingSeconds?.(j.remainingSeconds);
      cursorRef.current = typeof j.cursor === 'number' ? j.cursor : 0;
      attachedShells.set(sessionKey, j.shellId);
      setStatus({ kind: 'live' });
      // The shell is here — release everything typed while it was waking, in order. The PTY echoes
      // it back through the stream, so the user sees their held keystrokes appear and run.
      const held = pendingInputRef.current;
      pendingInputRef.current = '';
      connectingRef.current = false;
      if (held) void sendInput(held);
      void stream(term, alive);
    } catch (e) {
      if (!alive()) return;
      // The request never completed at all — timed out, offline, a dropped connection, or the
      // server closing it. Carry the browser's own reason: "Could not reach the terminal service."
      // on its own told nobody anything, including me when a live report arrived and I could not
      // reproduce it (admin screenshot 2026-08-05). An error that does not name its cause is a
      // second bug.
      const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
      const detail = e instanceof Error && e.message ? ` (${e.message})` : '';
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      const message = offline
        ? 'You appear to be offline — the terminal needs a connection.'
        : timedOut
          ? 'The terminal service did not answer. Check your connection, then tap "Try again".'
          : `Could not reach the terminal service${detail}. Check your connection, then reopen the terminal.`;
      setStatus({ kind: 'unavailable', message });
      term.write(`\x1b[31m${message}\x1b[0m\r\n`);
    } finally {
      clearTimeout(slowNote);
      // Handing off to the wake poll keeps the connecting state — and the held keystrokes — alive;
      // every other outcome ends the connecting window and drains the queue.
      if (!enteredWakePoll) {
        connectingRef.current = false;
        pendingInputRef.current = '';
      }
    }
  }

  /**
   * Watch a background wake and paint its REAL progress, then reopen. The judgement is the preview
   * watchdog's: a wake that keeps advancing (phase changes, files seeded) may take as long as it
   * needs; only one that stops advancing for NO_PROGRESS_MS — or breaches an absolute ceiling — is
   * declared dead, with "Try again" always offered. The poll rides the generous shell rate bucket.
   */
  async function pollWake(term: Terminal, fit: FitAddon, alive: () => boolean, attempt: number): Promise<void> {
    const POLL_MS = 2500;
    const NO_PROGRESS_MS = 90_000;
    const HARD_CEILING_MS = 300_000;
    const startedAt = Date.now();
    let lastKey = '';
    let lastProgressAt = Date.now();
    const fail = (message: string, detail?: string) => {
      connectingRef.current = false;
      pendingInputRef.current = '';
      setStatus({ kind: 'unavailable', message });
      term.write(`\r\n\x1b[31m${message}\x1b[0m\r\n`);   // \r\n first: end the in-place % line
      if (detail) term.write(`\x1b[90m${detail.slice(0, 300)}\x1b[0m\r\n`);
    };
    if (attempt >= 4) { fail('The workspace keeps waking without becoming ready. Tap "Try again", or send a message in NavBharatAI Pro v5.0 chat to start it.'); return; }
    // ONE line, updated IN PLACE (\r + erase): a percentage anchored to the real phases plus a live
    // elapsed timer, instead of a scroll of prose (admin 2026-08-06: "loading files hata do — % banao,
    // timer laga do"). The timer advances every tick even when the percent holds, so alive-but-slow
    // never looks frozen; 100% is printed ONLY on ready, immediately followed by the real shell.
    const paint = (pct: number, secs: number) => {
      term.write(`\r\x1b[K\x1b[90mLoading workspace… ${pct}% \x1b[2m· ${secs}s\x1b[0m`);
    };
    paint(wakePercent(null), 0);
    while (alive()) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      if (!alive()) return;
      let j: { wake?: { phase?: string; seeded?: number; total?: number; error?: string } | null; hostReady?: boolean } | null = null;
      try {
        const params = new URLSearchParams({ workspaceId: workspaceId || '', userId: userId || '', email: email || '' });
        const res = await fetch(`/api/agentv3/shell/wake?${params.toString()}`, {
          headers: await authHeaders(),
          signal: AbortSignal.timeout(10_000),
        });
        j = await res.json().catch(() => null);
      } catch { /* one missed poll is not a verdict — the no-progress guard is */ }
      const w = j?.wake;
      const secs = Math.round((Date.now() - startedAt) / 1000);
      if (j?.hostReady || w?.phase === 'ready') {
        // The one place 100% can appear — and the shell follows in the same breath, so complete
        // always MEANS complete.
        term.write(`\r\x1b[K\x1b[90mLoading workspace… 100% \x1b[2m· ${secs}s\x1b[0m\r\n`);
        return start(term, fit, alive, attempt + 1);   // reopen; the fast path now has a live host
      }
      paint(wakePercent(w), secs);
      if (w?.phase === 'failed') {
        fail('Your workspace could not start. Tap "Try again" — a second start usually succeeds.', w.error);
        return;
      }
      const key = w ? `${w.phase}:${w.seeded ?? 0}/${w.total ?? 0}` : 'none';
      if (key !== lastKey) {
        lastKey = key;
        lastProgressAt = Date.now();
      }
      if (Date.now() - lastProgressAt > NO_PROGRESS_MS) {
        fail('The workspace stopped making progress while waking. Tap "Try again" in a moment.');
        return;
      }
      if (Date.now() - startedAt > HARD_CEILING_MS) {
        fail('The workspace is taking far longer than it should (5 min). Tap "Try again", or send a message in NavBharatAI Pro v5.0 chat.');
        return;
      }
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
    let payload: { data?: string; cursor?: number; truncated?: boolean; exitCode?: number | null; message?: string; remainingSeconds?: number };
    try { payload = JSON.parse(dataLines.join('\n')); } catch { return; }

    // A2 — the daily free terminal allowance ran out (or is about to). WRITE IT INTO THE TERMINAL:
    // a session that just stops responding is indistinguishable from a broken one, and the user would
    // reasonably conclude the feature is broken rather than that they used it up.
    // Live remaining time — the header states what is actually left, not a fixed "30 minutes".
    if (event === 'quota_status') {
      if (typeof payload.remainingSeconds === 'number') onRemainingSeconds?.(payload.remainingSeconds);
      return;
    }

    if (event === 'quota' || event === 'quota_warning') {
      if (event === 'quota') onRemainingSeconds?.(0);
      const text = payload.message || 'Your free terminal time for today is used up.';
      term.write(`\r\n\x1b[33m${text}\x1b[0m\r\n`);
      return;
    }

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

  /**
   * ORDERED, COALESCED input pipeline (admin 2026-08-05, "terminal bahut slow hai — rocksolid banao").
   *
   * The old sendInput fired one POST per keystroke, unawaited. Two defects, one of them CORRECTNESS:
   * two POSTs in flight can arrive out of order, so fast-typing "ls" could reach the PTY as "sl";
   * and a phone paid a full network round-trip per character, which read as lag and burned a rate-
   * limit slot per key. Now everything funnels into ONE buffer with ONE request in flight: keys
   * arriving while a batch is airborne coalesce into the next batch. Arrival order is guaranteed by
   * construction, a typing burst costs one or two requests instead of a dozen, and echo latency is
   * one round-trip for the whole burst. A failed batch retries once (a keystroke is not droppable),
   * then surfaces on the terminal instead of vanishing.
   */
  const outBufRef = useRef('');
  const pumpingRef = useRef(false);
  const OUT_BUF_CAP = 8192;                    // the PTY's own per-write input cap (ShellSessions.ts)

  async function postInputBatch(batch: string): Promise<boolean> {
    try {
      const res = await fetch('/api/agentv3/shell/input', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ workspaceId, userId, email: email || '', shellId: shellIdRef.current, data: batch }),
      });
      return res.ok;
    } catch { return false; }
  }

  async function pumpInput(): Promise<void> {
    if (pumpingRef.current) return;            // single flight — this IS the ordering guarantee
    pumpingRef.current = true;
    try {
      while (outBufRef.current && shellIdRef.current) {
        const batch = outBufRef.current;
        outBufRef.current = '';
        if (!(await postInputBatch(batch)) && !(await postInputBatch(batch))) {
          termRef.current?.write('\r\n\x1b[31m[input did not reach the terminal — check your connection]\x1b[0m\r\n');
          return;
        }
      }
    } finally { pumpingRef.current = false; }
  }

  function sendInput(data: string): void {
    const shellId = shellIdRef.current;
    if (!shellId || !workspaceId) {
      // No shell YET. If one is on its way, hold the keys instead of dropping them — they are
      // flushed to the PTY the moment it opens (echo appears then; a local echo here would
      // duplicate every character once the real one arrives). Tell the user ONCE, or their
      // first keystrokes into a waking workspace look like a broken keyboard.
      if (connectingRef.current && workspaceId) {
        pendingInputRef.current = (pendingInputRef.current + data).slice(0, PENDING_INPUT_CAP);
        if (!queueHintShownRef.current) {
          queueHintShownRef.current = true;
          termRef.current?.write('\x1b[90m(your typing is saved — it will run as soon as the workspace is ready)\x1b[0m\r\n');
        }
      }
      return;
    }
    outBufRef.current = (outBufRef.current + data).slice(0, OUT_BUF_CAP);
    void pumpInput();
  }

  /**
   * Resize is DEBOUNCED and deduplicated: a panel drag or phone rotation fires ResizeObserver dozens
   * of times a second, and each used to be its own POST from the same shared rate bucket. Only the
   * settled size matters to the PTY — send that one, and only when it actually changed.
   */
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSizeRef = useRef('');
  function sendResize(cols: number, rows: number): void {
    if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
    resizeTimerRef.current = setTimeout(() => {
      const shellId = shellIdRef.current;
      if (!shellId || !workspaceId) return;
      const key = cols + 'x' + rows;
      if (key === lastSizeRef.current) return;
      lastSizeRef.current = key;
      void (async () => {
        try {
          await fetch('/api/agentv3/shell/resize', {
            method: 'POST',
            headers: await authHeaders(),
            body: JSON.stringify({ workspaceId, userId, email: email || '', shellId, cols, rows }),
          });
        } catch { /* cosmetic until the next resize */ }
      })();
    }, 200);
  }

  const restart = () => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;
    attachedShells.delete(sessionKey);
    shellIdRef.current = null;
    cursorRef.current = 0;
    pendingInputRef.current = '';
    outBufRef.current = '';
    lastSizeRef.current = '';
    connectingRef.current = false;
    queueHintShownRef.current = false;
    term.reset();
    setStatus({ kind: 'connecting' });
    const gen = genRef.current;
    void start(term, fit, () => genRef.current === gen);
  };

  const sendBarCommand = () => {
    // '\r' is what pressing Enter in a real TTY sends. The PTY echoes the command back through the
    // stream, so the typed line appears in the terminal exactly as if xterm had sent it key by key.
    void sendInput(barText + '\r');
    setBarText('');
    barInputRef.current?.focus();
  };
  /** Keeps the command-bar input focused (and the phone keyboard open) across helper-key taps. */
  const keepFocus = (e: React.PointerEvent) => e.preventDefault();

  /**
   * Forward whatever changed in the bridge to the PTY, then reset to the sentinel. Runs on every
   * input event (per keystroke) and on compositionend — never mid-composition, so IME keyboards
   * (Hindi, emoji) send the composed text once instead of a stream of half-formed characters.
   */
  const bridgeSync = () => {
    const el = bridgeRef.current;
    if (!el || composingRef.current) return;
    const v = el.value;
    if (v === BRIDGE_SENTINEL) return;
    if (v.startsWith(BRIDGE_SENTINEL)) {
      const added = v.slice(BRIDGE_SENTINEL.length);
      if (added) void sendInput(added);
    } else {
      // The sentinel itself was deleted — that IS the backspace. DEL (\x7f) is what a TTY expects.
      void sendInput('\x7f');
      if (v) void sendInput(v); // anything typed in the same beat still goes through, in order
    }
    el.value = BRIDGE_SENTINEL;
    try { el.setSelectionRange(1, 1); } catch { /* non-text state */ }
  };

  /** Control keys arrive as keydown (proven working on iOS by the command bar's Enter). */
  const bridgeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const seq =
      e.key === 'Enter' ? '\r'
      : e.key === 'Tab' ? '\t'
      : e.key === 'ArrowUp' ? '\x1b[A'
      : e.key === 'ArrowDown' ? '\x1b[B'
      : e.key === 'ArrowRight' ? '\x1b[C'
      : e.key === 'ArrowLeft' ? '\x1b[D'
      : e.key === 'Escape' ? '\x1b'
      // A hardware Ctrl chord (iPad keyboard, touch laptop): letter → control byte, the real thing.
      : e.ctrlKey && e.key.length === 1 && /[a-z]/i.test(e.key)
        ? String.fromCharCode(e.key.toUpperCase().charCodeAt(0) - 64)
        : null;
    if (seq !== null) { e.preventDefault(); void sendInput(seq); }
    // Backspace is deliberately NOT handled here: it reaches the PTY through the sentinel value
    // change, and handling it twice would delete two characters per press.
  };

  /** Tapping the terminal box arms direct typing — focus OUR bridge, not xterm's starved textarea. */
  const focusBridge = () => {
    if (!showCommandBar) return;                       // desktop: xterm's own input works — leave it
    if (status.kind === 'exited' || status.kind === 'unavailable') return;
    const el = bridgeRef.current;
    if (!el) return;
    el.value = BRIDGE_SENTINEL;
    el.focus();
    try { el.setSelectionRange(1, 1); } catch { /* non-text state */ }
  };

  return (
    <div className="h-full w-full bg-[#0d1117] flex flex-col">
      <div className="relative flex-1 min-h-0" onClick={focusBridge}>
        <div ref={hostRef} className="absolute inset-0 p-2" />
        {showCommandBar && (
          // The invisible bridge that makes typing INSIDE the terminal box work on phones. It sits
          // in the box (so iOS's scroll-into-view stays put), takes focus on tap, and forwards every
          // keystroke to the PTY the instant it happens — the echo paints back into xterm above.
          // pointer-events-none: it must never swallow the tap itself; focus is only programmatic.
          <input
            ref={bridgeRef}
            defaultValue={BRIDGE_SENTINEL}
            onInput={bridgeSync}
            onKeyDown={bridgeKeyDown}
            onCompositionStart={() => { composingRef.current = true; }}
            onCompositionEnd={() => { composingRef.current = false; bridgeSync(); }}
            aria-label="Terminal direct input"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
            className="absolute bottom-2 left-2 w-10 h-1 opacity-0 pointer-events-none"
            tabIndex={-1}
          />
        )}
        {(status.kind === 'exited' || status.kind === 'unavailable') && (
          // Both terminal states get a way BACK. 'unavailable' used to be a dead end — after a
          // timed-out or failed open, the only recovery was closing the tab and opening a new one,
          // which nobody discovers from an error message.
          <button
            onClick={restart}
            className="absolute bottom-3 right-3 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-black uppercase tracking-widest shadow-lg"
          >
            {status.kind === 'exited' ? 'Restart terminal' : 'Try again'}
          </button>
        )}
      </div>
      {showCommandBar && (
        <div className="shrink-0 border-t border-zinc-800 bg-[#0d1117] px-1.5 py-1.5 flex items-center gap-1.5">
          <button onPointerDown={keepFocus} onClick={() => void sendInput('\x03')} aria-label="Send Ctrl+C (interrupt)"
            className="shrink-0 px-2 py-1.5 rounded border border-zinc-700 text-zinc-300 text-[11px] font-mono hover:text-white">^C</button>
          <button onPointerDown={keepFocus} onClick={() => void sendInput('\t')} aria-label="Send Tab (completion)"
            className="shrink-0 px-2 py-1.5 rounded border border-zinc-700 text-zinc-300 text-[11px] font-mono hover:text-white">Tab</button>
          <button onPointerDown={keepFocus} onClick={() => void sendInput('\x1b[A')} aria-label="History up"
            className="shrink-0 px-2 py-1.5 rounded border border-zinc-700 text-zinc-300 text-[11px] font-mono hover:text-white">↑</button>
          <button onPointerDown={keepFocus} onClick={() => void sendInput('\x1b[B')} aria-label="History down"
            className="shrink-0 px-2 py-1.5 rounded border border-zinc-700 text-zinc-300 text-[11px] font-mono hover:text-white">↓</button>
          <input
            ref={barInputRef}
            value={barText}
            onChange={(e) => setBarText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); sendBarCommand(); } }}
            disabled={status.kind === 'exited' || status.kind === 'unavailable'}
            placeholder={
              status.kind === 'exited' ? 'Terminal closed — tap "Restart terminal"'
              : status.kind === 'unavailable' ? 'Terminal not available — tap "Try again"'
              : status.kind === 'connecting' ? 'Type a command — it runs when the workspace is ready'
              : 'Type a command…'
            }
            aria-label="Terminal command input"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
            enterKeyHint="send"
            className="flex-1 min-w-0 bg-zinc-900 border border-zinc-700 rounded px-2.5 py-1.5 text-[13px] text-zinc-100 font-mono outline-none focus:border-indigo-500"
          />
          <button onPointerDown={keepFocus} onClick={sendBarCommand} aria-label="Run command"
            className="shrink-0 px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[12px] font-bold">Run</button>
        </div>
      )}
    </div>
  );
};
