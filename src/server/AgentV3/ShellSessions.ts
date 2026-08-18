// AgentV3 — REAL persistent shells for Code Studio (admin request 2026-08-04: "kya ham, replit jaisa
// real shell nahi bana sakte?").
//
// WHAT WAS WRONG. Code Studio's terminal ran each command through POST /api/agentv3/exec, which calls
// `runner.runCommand()` once and returns when it finishes. That is a *command runner*, not a shell:
//   - no state between commands — `cd /app/src` was forgotten by the very next line, and so were
//     shell variables, `export`, `source`, an activated venv, and the command history the shell owns;
//   - a hard 30s timeout, so `npm install` or a dev server simply got cut off mid-work;
//   - no live output — the user stared at nothing until the command ended, then got the whole log;
//   - no way to interrupt: no Ctrl+C, because there was no process left to signal;
//   - nothing interactive — anything that asks a question (`npm init`, `git rebase -i`, `vim`, a
//     password prompt) hung until the timeout killed it, because there was no TTY to answer on.
// Opening three of those side by side made three independent command runners, not three shells.
//
// WHAT THIS IS. One long-lived PTY (pseudo-terminal) process per terminal tab, living inside the
// user's own sandbox, exactly as a real terminal emulator works. The sandbox VM is already running
// and already paid for, so a shell adds a process, not a machine. Because it is a genuine TTY:
// `cd` persists, Ctrl+C interrupts, colours and progress bars render, and interactive programs work
// because there is something on the other end to talk to.
//
// THE DESIGN DECISION THAT MATTERS: the server holds the output, not the browser. A shell keeps
// producing output whether or not anyone is watching, and browsers disconnect constantly — a phone
// locks, a tab sleeps, a network drops. So every session owns a scrollback ring buffer with a
// monotonic byte cursor. A reader asks "everything after N" and gets it, which makes reconnection
// ordinary rather than a special case: nothing is lost while you were away, and nothing is replayed
// twice. If the buffer overran while a reader was gone, we say so honestly instead of silently
// handing back a scrollback with a hole in the middle.
//
// SAFETY: a persistent process is exactly the thing that can be left running forever, so the limits
// are part of the design, not an afterthought — a per-workspace cap on concurrent shells, an idle
// timeout that reaps abandoned ones, a bounded scrollback, and a bounded single write.
//
// HONEST BOUNDARY (rule 6): sessions live in this server instance's memory, so a shell is reachable
// while the workspace is warm here — the same constraint /api/agentv3/exec already has, and the same
// honest "dormant" answer. The PTY itself lives in the sandbox and keeps running regardless; what a
// cold instance loses is the handle to it, and the reaper cleans those up.

/** The sandbox-side capabilities a shell needs. Implemented by E2BActuator; absent on LocalActuator. */
export interface PtyHost {
  openPty(
    workspaceId: string,
    opts: { cols: number; rows: number; onData: (chunk: string) => void; onExit: (code?: number) => void },
  ): Promise<{ pid: number }>;
  writePty(workspaceId: string, pid: number, data: string): Promise<void>;
  resizePty(workspaceId: string, pid: number, cols: number, rows: number): Promise<void>;
  killPty(workspaceId: string, pid: number): Promise<boolean>;
  /**
   * "Real work is happening in this sandbox right now" — see noteSandboxActivity below for why a
   * terminal has to say this out loud. Optional so a host without an idle sweep needs no change.
   */
  noteActivity?(workspaceId: string): void;
}

/** Runtime type guard — a runner that also speaks PTY. Keeps the actuator interface optional. */
export function isPtyHost(runner: unknown): runner is PtyHost {
  const r = runner as Partial<PtyHost> | null;
  return !!r
    && typeof r.openPty === 'function'
    && typeof r.writePty === 'function'
    && typeof r.resizePty === 'function'
    && typeof r.killPty === 'function';
}

/** Scrollback kept per shell. Past this the oldest output is dropped (and the reader is told). */
export const MAX_SCROLLBACK = 256_000;
/** Concurrent shells per workspace. A terminal tab is cheap; an unbounded number of them is not. */
export const MAX_SHELLS_PER_WORKSPACE = 6;
/** A shell with no input and no reader for this long is killed. */
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
/** Largest single write accepted from the client (a paste, not a file upload). */
export const MAX_INPUT_CHARS = 8192;
/** How long the sandbox keeps the PTY process alive. Refreshed on activity. */
export const PTY_LIFETIME_MS = 60 * 60 * 1000;
/**
 * How often a shell tells its sandbox it is alive. See noteSandboxActivity.
 *
 * Comfortably under the tightest idle limit the sweep uses (5 minutes), and far above the rate at
 * which PTY output arrives — `npm install` produces thousands of chunks a second, and one cheap call
 * per chunk would be its own bug.
 */
export const ACTIVITY_NOTE_MS = 30_000;

export interface ShellSnapshot {
  shellId: string;
  workspaceId: string;
  pid: number;
  alive: boolean;
  exitCode?: number;
  /** Total characters this shell has ever produced — the cursor a reader resumes from. */
  cursor: number;
  createdAt: number;
  lastActivity: number;
}

interface ShellSession {
  shellId: string;
  workspaceId: string;
  userId?: string;
  pid: number;
  host: PtyHost;
  /** Scrollback tail. `cursor - buf.length` is the absolute offset of buf[0]. */
  buf: string;
  cursor: number;
  alive: boolean;
  exitCode?: number;
  createdAt: number;
  lastActivity: number;
  /** When this shell last told the sandbox it was working. Throttles noteSandboxActivity. */
  lastHostNote: number;
  subscribers: Set<(chunk: string, cursor: number) => void>;
}

const shells = new Map<string, ShellSession>();
let seq = 0;
let reaper: ReturnType<typeof setInterval> | null = null;

/**
 * The reaper only exists while shells do — started on the first open, stopped when the last one goes.
 * `unref()` matters: a persistent timer that keeps the Node process alive would hang CI and stop the
 * server from shutting down cleanly, which is a worse bug than the leak it guards against.
 */
function ensureReaper(): void {
  if (reaper) return;
  reaper = setInterval(() => {
    void sweepShells().then(() => { if (shells.size === 0) stopReaper(); });
  }, 60_000);
  if (typeof reaper.unref === 'function') reaper.unref();
}

function stopReaper(): void {
  if (!reaper) return;
  clearInterval(reaper);
  reaper = null;
}

function touch(s: ShellSession): void {
  s.lastActivity = Date.now();
}

/**
 * Tell the SANDBOX that this terminal is doing real work.
 *
 * ── THE BUG THIS EXISTS FOR (found 2026-08-17) ──────────────────────────────────────────────────
 * There are TWO independent idle clocks, and until now the terminal only wound one of them.
 *
 * The sandbox's clock (`E2BActuator._lastActivity`) is refreshed inside `getSandbox()`, so it moves
 * when a build touches the VM — and, for a terminal, when the user TYPES, because `writePty` calls
 * `getSandbox`. It does NOT move for output: PTY output arrives on a callback the SDK already holds,
 * which reaches no actuator method at all. So a terminal that is producing output while the user
 * simply READS it was, to that clock, perfectly idle.
 *
 * The idle limit is 5 minutes. `npm install`, a test run, a first `npm run build` — all of them
 * routinely stream for longer than that without a keystroke. The sweep would pause the VM mid-work
 * and the shell died under the user's cursor, on a command that was succeeding.
 *
 * ── WHY A SUBSCRIBER IS REQUIRED ────────────────────────────────────────────────────────────────
 * "Output = alive" alone would be a cost leak wearing a bugfix's clothes: a forgotten `npm run dev`
 * with nobody watching would hold a billed VM for as long as it chattered. The honest invariant is
 * the one the shell reaper already uses — work nobody is watching is abandonment — so a note is sent
 * only while a reader is genuinely attached. An abandoned noisy shell still goes idle exactly as it
 * does today, and `sweepShells` still kills it on the same terms.
 *
 * Best-effort and swallowed: a cost optimisation must never be able to break a running shell.
 */
function noteSandboxActivity(s: ShellSession, now = Date.now()): void {
  if (s.subscribers.size === 0) return;
  if (now - s.lastHostNote < ACTIVITY_NOTE_MS) return;
  s.lastHostNote = now;
  try { s.host.noteActivity?.(s.workspaceId); } catch { /* never break the stream */ }
}

/**
 * Append PTY output to a session's scrollback and fan it out to live readers.
 *
 * The buffer is trimmed from the FRONT once it exceeds MAX_SCROLLBACK, which is what a terminal
 * emulator does too — recent output is what a user is reading; ancient output is what they scrolled
 * past. `cursor` keeps counting regardless, so a reader can always tell whether it fell behind.
 */
function appendOutput(s: ShellSession, text: string): void {
  if (!text) return;
  s.buf += text;
  s.cursor += text.length;
  if (s.buf.length > MAX_SCROLLBACK) s.buf = s.buf.slice(s.buf.length - MAX_SCROLLBACK);
  // Output IS sandbox work — say so, or the idle sweep pauses the VM mid-`npm install`.
  noteSandboxActivity(s);
  for (const notify of s.subscribers) {
    try { notify(text, s.cursor); } catch { /* one broken reader must never stall the shell */ }
  }
}

/** Sessions belonging to a workspace (used for the per-workspace cap and for bulk close). */
export function shellsForWorkspace(workspaceId: string): ShellSnapshot[] {
  const out: ShellSnapshot[] = [];
  for (const s of shells.values()) {
    if (s.workspaceId === workspaceId) out.push(snapshot(s));
  }
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

function snapshot(s: ShellSession): ShellSnapshot {
  return {
    shellId: s.shellId,
    workspaceId: s.workspaceId,
    pid: s.pid,
    alive: s.alive,
    ...(s.exitCode !== undefined ? { exitCode: s.exitCode } : {}),
    cursor: s.cursor,
    createdAt: s.createdAt,
    lastActivity: s.lastActivity,
  };
}

export type OpenShellResult =
  | { ok: true; shell: ShellSnapshot }
  | { ok: false; reason: 'no_sandbox' | 'too_many' | 'failed'; detail?: string };

/**
 * Start a real shell in the workspace's sandbox.
 *
 * `cwd` is the workspace root so the shell opens where the user's project is — landing in `$HOME`
 * and making them `cd` first is the kind of small wrongness that makes a tool feel fake.
 */
export async function openShell(
  workspaceId: string,
  host: PtyHost | undefined,
  opts: { userId?: string; cols?: number; rows?: number } = {},
): Promise<OpenShellResult> {
  if (!host) return { ok: false, reason: 'no_sandbox' };
  const live = shellsForWorkspace(workspaceId).filter((s) => s.alive);
  if (live.length >= MAX_SHELLS_PER_WORKSPACE) return { ok: false, reason: 'too_many' };

  seq += 1;
  const shellId = `sh_${Date.now().toString(36)}_${seq}`;
  const now = Date.now();
  const session: ShellSession = {
    shellId,
    workspaceId,
    userId: opts.userId,
    pid: -1,
    host,
    buf: '',
    cursor: 0,
    alive: true,
    createdAt: now,
    lastActivity: now,
    // 0, not `now`: a reader attaching to a brand-new shell must be able to send the first note
    // immediately rather than waiting out a throttle window it never earned.
    lastHostNote: 0,
    subscribers: new Set(),
  };
  // Registered BEFORE the PTY starts: output can arrive on the very first callback, and dropping the
  // opening banner of a shell is exactly the kind of "mostly works" bug this rewrite exists to remove.
  shells.set(shellId, session);
  ensureReaper();

  try {
    const { pid } = await host.openPty(workspaceId, {
      cols: clampDim(opts.cols, 80),
      rows: clampDim(opts.rows, 24),
      onData: (chunk) => appendOutput(session, chunk),
      onExit: (code) => {
        session.alive = false;
        session.exitCode = code;
        appendOutput(session, `\r\n[90m[process exited${code === undefined ? '' : ` with code ${code}`}][0m\r\n`);
      },
    });
    session.pid = pid;
    return { ok: true, shell: snapshot(session) };
  } catch (e) {
    shells.delete(shellId);
    return { ok: false, reason: 'failed', detail: e instanceof Error ? e.message : String(e) };
  }
}

function clampDim(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(500, Math.round(value)));
}

/** Look up a shell, enforcing ownership. Returns undefined when unknown or not the caller's. */
function owned(shellId: string, userId?: string): ShellSession | undefined {
  const s = shells.get(shellId);
  if (!s) return undefined;
  if (userId && s.userId && s.userId !== userId) return undefined;
  return s;
}

export function getShell(shellId: string, userId?: string): ShellSnapshot | undefined {
  const s = owned(shellId, userId);
  return s ? snapshot(s) : undefined;
}

/**
 * Read scrollback from an absolute cursor.
 *
 * `truncated` is the honest half: it means output between `from` and what we still hold was dropped,
 * so the caller can say "[…output trimmed…]" rather than presenting a gap as if it were continuous.
 */
export function readShell(
  shellId: string,
  from: number,
  userId?: string,
): { data: string; cursor: number; truncated: boolean; alive: boolean } | undefined {
  const s = owned(shellId, userId);
  if (!s) return undefined;
  const base = s.cursor - s.buf.length;
  const start = Math.max(0, Math.min(s.buf.length, from - base));
  return {
    data: s.buf.slice(start),
    cursor: s.cursor,
    truncated: from < base,
    alive: s.alive,
  };
}

/** Subscribe to live output. Returns an unsubscribe function. */
export function subscribeShell(
  shellId: string,
  onChunk: (chunk: string, cursor: number) => void,
  userId?: string,
): (() => void) | undefined {
  const s = owned(shellId, userId);
  if (!s) return undefined;
  s.subscribers.add(onChunk);
  touch(s);
  // A reader coming back (a phone unlocking, a tab waking) is activity too — and it is the moment a
  // silent-but-running command most needs the sandbox held, before the next output chunk arrives.
  noteSandboxActivity(s);
  return () => { s.subscribers.delete(onChunk); };
}

/**
 * Send keystrokes to the shell. This is also how Ctrl+C works — the client sends the real control
 * character (`\x03`) and the TTY's line discipline turns it into SIGINT, exactly as a local terminal
 * does. There is deliberately no separate "interrupt" endpoint: a shell that only accepts signals we
 * thought to enumerate is a fake shell.
 */
export async function writeShell(shellId: string, data: string, userId?: string): Promise<boolean> {
  const s = owned(shellId, userId);
  if (!s || !s.alive) return false;
  const payload = typeof data === 'string' ? data.slice(0, MAX_INPUT_CHARS) : '';
  if (!payload) return true;
  touch(s);
  try {
    await s.host.writePty(s.workspaceId, s.pid, payload);
    return true;
  } catch {
    return false;
  }
}

/**
 * Tell the PTY its new window size. Without this, programs that draw by column — `top`, `vim`, a
 * progress bar, even `ls` — wrap against the wrong width and the output looks corrupted.
 */
export async function resizeShell(
  shellId: string,
  cols: number,
  rows: number,
  userId?: string,
): Promise<boolean> {
  const s = owned(shellId, userId);
  if (!s || !s.alive) return false;
  touch(s);
  try {
    await s.host.resizePty(s.workspaceId, s.pid, clampDim(cols, 80), clampDim(rows, 24));
    return true;
  } catch {
    return false;
  }
}

/** Kill a shell and forget it. Idempotent — closing an already-closed shell is a success, not an error. */
export async function closeShell(shellId: string, userId?: string): Promise<boolean> {
  const s = owned(shellId, userId);
  if (!s) return false;
  s.alive = false;
  s.subscribers.clear();
  shells.delete(shellId);
  try { await s.host.killPty(s.workspaceId, s.pid); } catch { /* already gone is still closed */ }
  return true;
}

/**
 * Reap shells nobody is using: dead ones, and live ones idle past IDLE_TIMEOUT_MS with no reader
 * attached. A shell with a live subscriber is never idle — someone is watching a long build.
 */
export async function sweepShells(now = Date.now()): Promise<number> {
  const doomed: ShellSession[] = [];
  for (const s of shells.values()) {
    if (!s.alive) { doomed.push(s); continue; }
    if (s.subscribers.size === 0 && now - s.lastActivity > IDLE_TIMEOUT_MS) doomed.push(s);
  }
  for (const s of doomed) {
    shells.delete(s.shellId);
    s.subscribers.clear();
    if (s.alive) { try { await s.host.killPty(s.workspaceId, s.pid); } catch { /* best effort */ } }
  }
  return doomed.length;
}

export function shellCount(): number {
  return shells.size;
}

/** Test-only: drop every session without touching the sandbox. */
export function _clearShells(): void {
  shells.clear();
  seq = 0;
  stopReaper();
}
