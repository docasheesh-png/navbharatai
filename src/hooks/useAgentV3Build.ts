import { useCallback, useEffect, useRef, useState } from 'react';
import { agentV3Reducer } from '../components/agentv3/agentV3Reducer';
import { createRevealPacer } from '../components/agentv3/revealPacer';
import { carryOverActivity } from '../components/agentv3/activityTimeline';
import { initialAgentV3State } from '../components/agentv3/agentV3Types';
import type { AgentV3ClientState, AgentV3WireEvent, GitCheckpoint } from '../components/agentv3/agentV3Types';
import { conversationToEvents, conversationToUserMessages, isUnfinishedBuild, type PersistedConversation } from '../components/agentv3/agentV3History';
import { shouldSurfaceStreamError, reconnectOutcome, type ReconnectOutcome } from './agentV3StreamError';
import { nextLivePollDelayMs, resumeSinceSeq, LIVE_POLL_FAST_MS } from './livePollPolicy';
import { auth } from '../App';

// FILE-REVEAL PACING (admin 2026-07-23 — "one by one user ko dikhe … har 2 file ke bich ~5–10 sec"):
// reveal generated files ONE BY ONE with a ~6s gap so the user watches files land while the backend keeps
// building, instead of a burst-then-stall. HONEST (rule 2): only real events, in real order — the terminal
// result/done/error event still FLUSHES everything instantly (a finished build is never held back), so the
// drip only fills the time the build is genuinely still working. maxQueue is raised so a fast-lane burst
// (~40 files landing at once) drips at the full interval rather than tripping the 4×-speedup guard. Tune
// the cadence here; set minIntervalMs to 0 to disable pacing (instant, pre-2026-07-21 behavior).
const FILE_REVEAL_PACER_OPTS = { minIntervalMs: 6000, maxQueue: 60 } as const;

/**
 * Build JSON headers carrying the signed-in user's Firebase ID token when available.
 * The server derives identity from the VERIFIED token; a missing/unverifiable token degrades to an
 * anonymous build server-side (it never grants the body userId, and never hard-blocks the chat).
 * Pass `forceRefresh` on the critical /chat path to mint a fresh token so a stale/expired cached one
 * self-heals instead of arriving unverifiable.
 */
async function authJsonHeaders(forceRefresh = false): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const tok = await auth.currentUser?.getIdToken(forceRefresh);
    if (tok) headers.Authorization = `Bearer ${tok}`;
  } catch { /* no token — server degrades to an anonymous build (never hard-blocks) */ }
  return headers;
}

/**
 * useAgentV3Build — drives a v5.0 build and keeps the live client state that all
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
  start: (prompt: string, opts?: { userId?: string; email?: string; onlyOpus?: boolean; powerLevel?: 'weak' | 'off' | 'mini' | 'medium' | 'max'; planFirst?: boolean; thinking?: boolean; sessionId?: string; attachments?: Array<{ name: string; type: string; base64: string }>; framework?: string; frameworkExplicit?: boolean; frameworkResolved?: boolean; importUrl?: string; deployProvider?: string; chatRole?: 'planner' | 'advisor'; appSignature?: boolean }) => Promise<void>;
  /** Approve or reject a pending plan/permission gate (P4). */
  respond: (requestId: string, approved: boolean) => Promise<void>;
  /** Restore the workspace to a checkpoint commit (History → restore). */
  /** Restore a checkpoint. `message` is the SERVER's sentence — it is the only side that knows why a
   *  restore did not happen, and those reasons are not interchangeable. */
  restore: (sha: string) => Promise<{ ok: boolean; message: string }>;
  /** Phase G1 — load the durable git checkpoint history for a workspace (newest first, cross-session). */
  getCheckpoints: (opts: { workspaceId: string; userId?: string; email?: string }) => Promise<GitCheckpoint[]>;
  /** Phase G2 — real working-tree git status for a workspace (available:false when the sandbox is cold). */
  getGitStatus: (opts: { workspaceId: string; userId?: string; email?: string }) => Promise<GitStatus>;
  /** "Restore all files" — genuinely bring the whole project back into the workspace (writes the
   *  durably-saved files back) and reflect the real file list. Returns count + whether it restored. */
  restoreAllFiles: () => Promise<{ ok: boolean; count: number; restored: boolean }>;
  stop: () => void;
  /** UNSEND — take back the last message: stop any in-flight build AND purge it from the server
   *  transcript + workspace memory so it never resurfaces. Resolves true when the server confirmed the
   *  purge (the caller then removes the message from the visible thread). Never throws. */
  unsend: () => Promise<boolean>;
  reset: () => void;
  /** True when a build is running server-side but this UI is NOT attached to it
   *  (e.g. the original connection was lost) — the panel offers "Resume". */
  serverBuildRunning: boolean;
  /** Re-attach to a build that is already running for this account (replays its events so the UI
   *  catches up, then streams live). Pass `workspaceId` (the caller's current session) so the server
   *  refuses to attach a build that belongs to a DIFFERENT session under the same account. */
  resume: (opts?: { userId?: string; email?: string; workspaceId?: string; notice?: string; goneNotice?: string; resultAlreadySeen?: boolean }) => Promise<import('./agentV3StreamError').ReconnectOutcome | 'aborted'>;
  /** Ship to main (own-repo storage): merge `navbharatai/work` → the repo default via a PR, server-side
   *  merging ONLY on green CI. Returns an honest result to render in-thread. */
  shipToMain: (opts: { repo: string; userId?: string; email?: string; githubToken?: string }) => Promise<ShipResult>;
  /** Revert the last merge on the repo default branch (own-repo storage). Returns an honest result. */
  revertLastMerge: (opts: { repo: string; userId?: string; email?: string; githubToken?: string }) => Promise<RevertResult>;
  /** Queue executor (FIX #4.3): claim the next queued command (or null); mark the running one complete. */
  queueNext: (workspaceId?: string) => Promise<{ id: string; prompt: string } | null>;
  queueComplete: (workspaceId: string | undefined, ok: boolean, note?: string) => Promise<void>;
  /** Queue UI (FIX #6): enqueue a command, list this app's queue, cancel a pending item. */
  queueEnqueue: (workspaceId: string | undefined, prompt: string, source: 'user' | 'planner' | 'advisor') => Promise<boolean>;
  queueList: (workspaceId?: string) => Promise<QueueItemView[]>;
  queueCancel: (workspaceId: string | undefined, id: string) => Promise<QueueItemView[]>;
  /** Ask the server whether a build is running for this account (sets serverBuildRunning). Pass
   *  `workspaceId` to scope the check to the CALLER's session — omitting it falls back to the
   *  account-wide check, which is what caused a different session's still-running build to
   *  auto-attach into whatever v5.0 session was currently open. */
  checkRunning: (opts?: { userId?: string; email?: string; workspaceId?: string }) => Promise<void>;
  /**
   * D7 — on (re)load, fetch the user's most recent persisted build and re-display its chat history
   * (option (a): chat + git-restore). Rebuilds the agent narration into state and RETURNS the user's
   * own restored messages so the panel can re-display them too. Returns null if nothing was loaded.
   * No-op while a build is running. Best-effort: any failure resolves null and leaves state untouched.
   */
  loadConversation: (opts?: { userId?: string; email?: string; id?: string }) => Promise<{ messages: UserChatMsg[]; workspaceId?: string; framework?: string; unfinished?: boolean } | null>;
  conversationLoadDiag: () => string | null;
  /**
   * List the user's saved v5.0 conversations (metadata only) for the history menu.
   * Always returns an honest result: `error` is set (and `items` is []) whenever the list
   * could NOT be determined (not signed in, network/server failure) — the caller must NOT
   * treat that the same as a genuinely empty history.
   */
  listConversations: (opts?: { userId?: string; email?: string }) => Promise<{ items: ConversationMeta[]; error?: string }>;
  /** Delete a saved conversation (history-menu delete action). Returns true on success. */
  deleteConversation: (id: string, opts?: { userId?: string; email?: string }) => Promise<boolean>;
  /** Pin/unpin a saved build. Returns the new pinned state on success, or null on failure. */
  pinConversation: (id: string, opts: { userId?: string; email?: string; pinned: boolean }) => Promise<boolean | null>;
  /** Watch a build running on another device/instance (cross-device live mirror). Returns a stop fn.
   *  Pass `workspaceId` so the server (same-instance case) won't mirror a build for a different session. */
  subscribeLive: (opts?: { userId?: string; email?: string; workspaceId?: string }) => (() => void);
  /** Paid-public (billing PR 5): set when the last build was refused pre-start for want of credits
   *  (HTTP 402). Null otherwise. The panel renders a dedicated "Add credits" screen from it. */
  billingBlock: BillingBlock | null;
  /** Dismiss the add-credits screen (e.g. after the user tops up, or to retry). */
  clearBillingBlock: () => void;
}

/** A pre-start build refusal for want of credits (paid-public HTTP 402). All money figures are ₹. */
export interface BillingBlock {
  /** Honest user-facing message from the server (e.g. "Your credits are used up. Add credits…"). */
  notice: string;
  /** The user's wallet balance at refusal time, if the server reported it. */
  balanceInr?: number;
  /** The estimated cost of the refused build, if the server reported it. */
  estimateInr?: number;
  /** Billing Phase 2 — the same figures in the wallet's primary unit (tokens), server-converted. */
  balanceTokens?: number;
  estimateTokens?: number;
}

/** One command in the per-app queue, as the queue UI renders it (matches the server's QueueItem). */
export interface QueueItemView {
  id: string;
  prompt: string;
  source: 'user' | 'planner' | 'advisor';
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
  createdTs: number;
  note?: string;
}

/** Result of "Ship to main" (own-repo storage, slice 2) — an honest, renderable outcome. */
export interface ShipResult {
  /** The request itself succeeded (reached GitHub) — NOT necessarily that a merge happened. */
  ok: boolean;
  /** True only when the PR was actually merged into the base branch. */
  merged: boolean;
  prNumber?: number;
  prUrl?: string;
  /** The CI verdict read for the PR head: 'success' | 'failure' | 'pending' | 'none'. */
  ci?: string;
  /** The base branch the work branch was merged into (the repo default). */
  base?: string;
  /** A short, honest, user-facing summary of what happened. */
  note: string;
}

/** Result of "Revert last merge" (own-repo storage, slice 2b) — an honest, renderable outcome. */
export interface RevertResult {
  /** The request reached GitHub. */
  ok: boolean;
  /** True only when the last change was actually reverted. */
  reverted: boolean;
  /** The new revert commit's sha (present when reverted). */
  sha?: string;
  /** A short, honest, user-facing summary. */
  note: string;
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
  /**
   * True when opening this session PROVED its transcript is gone everywhere (no server record,
   * legacy copy 0 messages — a pre-rebuild session destroyed by the old session-switch eraser).
   * The list renders it honestly as lost instead of an ordinary chat that "won't open".
   */
  deadTranscript?: boolean;
  /** True when this session's workspace has an ACTIVE published deployment (server-verified against
   *  the agentv3_deployments registry — never inferred client-side). Drives the green "Live" dot. */
  live?: boolean;
  /** The published app's URL (present exactly when `live` is true). */
  liveUrl?: string;
  /** User pinned this build — it sorts to the top of the history list (absent/false = normal). */
  pinned?: boolean;
}

/**
 * Decide what the silence WATCHDOG should do when our stream has gone quiet (no events for STALL_MS)
 * and we've probed the server for whether the build is still running. PURE + unit-tested.
 *
 * The bug this closes: after a SUCCESSFUL build (its terminal `result` already arrived and rendered
 * "Done · N steps"), a long SILENT post-build phase — e.g. the advisory reviewer's multi-call
 * sub-agent — kept the stream quiet past STALL_MS. The watchdog then probed, saw the build had since
 * FINISHED server-side (buildRunning=false), and wrongly showed "The build stopped responding" on an
 * app that actually built and preview-verified fine (build report 2026-07-06, 10m/98-step landing
 * page). "Not running" after we already saw the terminal result means FINISHED, not stalled — so:
 *   • alive server-side          → reconnect (reattach the stream, keep going)
 *   • gone, but we saw `result`  → finish cleanly (stop the spinner, NO scary error)
 *   • gone, and no `result`      → the honest "stopped responding" error
 */
/**
 * VAJRA V4-1a — should an INTERRUPTED build auto-continue instead of dead-ending on the error?
 * (NIRMAN Phase A; admin: "chat dead nahi honi chahiye".) A network cut / instance rotation killed
 * the server-side build mid-flight (gone + no terminal result). The files are durable (≤6s flush),
 * and the manual recovery is always the same one message ("please continue") — so send it
 * AUTOMATICALLY, exactly once per interruption: alreadyContinued guards a loop (a second death of
 * the SAME turn falls back to the honest error), and hasLastPrompt guards a fresh mount with
 * nothing to continue. PURE + unit-tested.
 */
export function shouldAutoContinue(opts: { sawResult: boolean; alreadyContinued: boolean; hasLastPrompt: boolean }): boolean {
  return !opts.sawResult && !opts.alreadyContinued && opts.hasLastPrompt;
}

export function stallWatchdogAction(opts: { alive: boolean; sawResult: boolean }): 'reconnect' | 'finish' | 'error' {
  if (opts.alive) return 'reconnect';
  if (opts.sawResult) return 'finish';
  return 'error';
}

export function useAgentV3Build(): UseAgentV3Build {
  const [state, setState] = useState<AgentV3ClientState>(initialAgentV3State);
  const [running, setRunning] = useState(false);
  const [serverBuildRunning, setServerBuildRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Paid-public (billing PR 5): set when a build is refused pre-start with HTTP 402 INSUFFICIENT_CREDITS.
  // Drives a dedicated "Add credits" screen instead of a bare error banner. Null unless credits ran out.
  const [billingBlock, setBillingBlock] = useState<BillingBlock | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const userIdRef = useRef<string | undefined>(undefined);
  const emailRef = useRef<string | undefined>(undefined);
  const workspaceIdRef = useRef<string | undefined>(undefined);
  // WATCHDOG — timestamp of the last stream event, so a silent/dead stream can be detected.
  const lastEventTsRef = useRef<number>(Date.now());
  // WATCHDOG — did the CURRENT build already emit its terminal `result`? If so, a later "build not
  // running" probe means it FINISHED (post-result reviewer/cleanup went quiet), NOT that it stalled —
  // so the watchdog must not show "stopped responding" on a build that actually succeeded. Reset at
  // every build start (start/resume), set the instant `result` arrives on any stream path.
  const sawResultRef = useRef<boolean>(false);
  // V4-1a — the last user turn's shape (for auto-continue) + the once-per-interruption guard.
  const lastStartRef = useRef<{ prompt: string; opts: { userId?: string; email?: string; sessionId?: string; framework?: string } } | null>(null);
  const autoContinuedRef = useRef<boolean>(false);
  // True only for the auto-continue's own start() call — so it does NOT re-arm the one-shot guard
  // (a second death of the same interrupted turn must fall back to the honest error, never loop).
  const autoStartRef = useRef<boolean>(false);
  // Guards resume() against OVERLAPPING reconnects. (It must NOT guard on `running`: the watchdog
  // reconnects WHILE running is true, and the old `if (running) return` made that reconnect a no-op,
  // leaving the spinner stuck forever after a genuinely dead stream.)
  const resumeInFlightRef = useRef(false);
  // GENERATION GUARD — fixes "New chat reverts to the old chat ~10s later". resume()'s replayed
  // buffer and the cross-device live-mirror poll (subscribeLive) both apply setState ASYNCHRONOUSLY,
  // seconds after they start, with no idea which session/workspace the user is looking at NOW. Both
  // /api/agentv3/attach and /api/agentv3/live are keyed only by userId (not by session/workspace), so
  // an old, already-finished build's buffered events can still be replayed/mirrored well after the
  // user has moved on. Every "fresh start" of state (reset(), resume()) bumps this counter and captures
  // it; every async apply path re-checks it before calling setState and stops cold if it no longer
  // matches — so a stale resume/mirror can never silently repopulate a session the user has since left.
  const generationRef = useRef(0);
  // B6 — last live-poll seq seen per workspace, so a tab-focus re-arm of subscribeLive resumes from it
  // instead of re-downloading the whole event history from seq 0.
  const liveSeqRef = useRef<Record<string, number>>({});
  // Why the LAST loadConversation() returned null — so "opening an old chat shows 0 messages" stops
  // being an opaque dead end. Every failure branch records a precise reason (HTTP 404 vs 403 vs empty
  // vs network) that the panel surfaces in the error toast + console, turning a 5th guess into a fact.
  const lastLoadDiagRef = useRef<string | null>(null);
  /** Has the session moved on since `gen` was captured? Named so every async apply site reads the
   *  same intent instead of re-deriving the ref comparison. */
  const isStale = (gen: number): boolean => gen !== generationRef.current;

  // Keep the latest workspace id available to restore() without a stale closure.
  workspaceIdRef.current = state.workspaceId;

  const reset = useCallback(() => {
    // Invalidate any in-flight resume()/subscribeLive() from a PREVIOUS session first, and cancel the
    // in-flight attach stream (detach-only — does NOT call /api/agentv3/stop, so a build that's still
    // genuinely running server-side keeps running in the background and shows up in history when done;
    // this only stops THIS UI from displaying its stream).
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    resumeInFlightRef.current = false;
    setRunning(false);
    setState(initialAgentV3State());
    setError(null);
    setBillingBlock(null);
  }, []);

  const stop = useCallback(() => {
    generationRef.current += 1; // invalidate any in-flight resume()/subscribeLive() from this point on
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
    setServerBuildRunning(false);
    // Clear any "a build is already running" error — Stop is exactly its resolution, so the banner must
    // not linger and re-tempt the user into the "Fix with AI" retry loop it produced.
    setError(null);
    // Truly stop the SERVER build (not just this local stream), so it cannot keep
    // running and block the next build. Send `workspaceId` so that under per-workspace locking (FIX #3)
    // Stop targets THIS app's build, and the Bearer token so the server's identity matches the one the
    // build was registered under (the dead-Stop fix pairs this with server-side candidate keys).
    void (async () => {
      try {
        await fetch('/api/agentv3/stop', {
          method: 'POST',
          headers: await authJsonHeaders(),
          body: JSON.stringify({ userId: userIdRef.current, email: emailRef.current, workspaceId: workspaceIdRef.current }),
        });
      } catch { /* best-effort */ }
    })();
  }, []);

  // UNSEND — take back the last message. Stops any in-flight build (same abort + generation-bump as
  // stop(), so this UI detaches cleanly) then asks the server to purge the message from the durable
  // transcript AND workspace memory. The panel removes it from the visible thread on a truthy result.
  const unsend = useCallback(async (): Promise<boolean> => {
    generationRef.current += 1; // invalidate any in-flight resume()/subscribeLive()
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
    setServerBuildRunning(false);
    setError(null);
    const workspaceId = workspaceIdRef.current;
    if (!workspaceId) return false; // no server session yet (a message that never reached the server)
    try {
      const res = await fetch('/api/agentv3/unsend', {
        method: 'POST',
        headers: await authJsonHeaders(),
        body: JSON.stringify({ userId: userIdRef.current, email: emailRef.current, workspaceId }),
      });
      if (!res.ok) return false;
      const j = await res.json().catch(() => null);
      if (j?.ok !== true) return false;
      // Purge succeeded — clear the removed turn's LIVE chat output (narration / working feed / agent
      // cards / pending gates) while PRESERVING the accumulated project surfaces (files, diffs, terminal,
      // checkpoints, preview, workspaceId, repo). Earlier turns already live in the panel's agentHistory;
      // only the just-removed turn's response sits in `narration`, so this leaves the thread exactly at
      // the message before the unsent one. Files aren't rolled back (unsend forgets the message, it does
      // not time-travel the filesystem — the surfaces reflect reality, honestly).
      setState((s) => ({
        ...s,
        narration: [],
        activity: [],
        agents: {},
        proposedSteps: undefined,
        pendingPermission: undefined,
        done: false,
        ok: undefined,
        summary: undefined,
        error: undefined,
      }));
      return true;
    } catch {
      return false; // network error — the panel keeps the message (never a fake "unsent")
    }
  }, []);

  // Read the NDJSON event stream line by line and fold each event into the reducer. Used by resume()'s
  // replay/attach stream. `gen` is the generation captured when the stream was started (see
  // generationRef above) — every event is dropped once it no longer matches the LIVE generation (the
  // user has since reset/started a new session), instead of silently repopulating a session the user
  // has left. Surfaces a non-event body so silent failures show.
  // `sink` (optional, per-call — never a shared ref, so no cross-generation bleed) records whether
  // this stream saw the build's terminal `result`, so resume()'s catch can tell a genuine failure
  // from a post-result tail drop (see shouldSurfaceStreamError).
  const pumpStream = useCallback(async (res: Response, gen: number, sink?: { sawResult: boolean }): Promise<void> => {
    if (!res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let gotEvent = false;
    let rawSample = '';
    // FILE-REVEAL PACING (admin 2026-07-21): burst-completed "✓ file (n/m)" lines drip into the feed
    // one-by-one (order-preserving, real events only; a terminal event flushes instantly). The build
    // itself is untouched — this paces only what the user SEES. See revealPacer.ts for the honesty rules.
    const pacer = createRevealPacer<AgentV3WireEvent>((e) => setState((prev) => agentV3Reducer(prev, e)), FILE_REVEAL_PACER_OPTS);
    for (;;) {
      if (isStale(gen)) { pacer.discard(); try { await reader.cancel(); } catch { /* best-effort */ } return; }
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
        if (isStale(gen)) { pacer.discard(); try { await reader.cancel(); } catch { /* best-effort */ } return; }
        gotEvent = true;
        lastEventTsRef.current = Date.now(); // WATCHDOG — mark stream activity
        pacer.push(event);
        // TERMINAL EVENT → clear `running` immediately on a re-attached/resumed stream too, so a build
        // whose post-result cleanup keeps the stream open never leaves the UI stuck "building" after the
        // result is in. Key ONLY on `result` (build-terminal, once per build) — NOT `done`, which
        // sub-agents also emit on this shared stream. See the same guard in start()'s stream loop.
        if ((event as { type?: string }).type === 'result' && !isStale(gen)) {
          if (sink) sink.sawResult = true; // build is terminal — a later stream drop is not a failure
          sawResultRef.current = true; // WATCHDOG — a later "not running" probe = finished, not stalled
          setRunning(false);
          setServerBuildRunning(false);
        }
      }
    }
    pacer.flush(); // stream closed — reveal anything still queued immediately (nothing is ever dropped)
    if (!gotEvent) {
      const sample = (rawSample || buffer).trim();
      setError(
        sample
          ? `The server did not return v5.0 events. It replied with:\n${sample.slice(0, 300)}`
          : 'No response from the v5.0 engine.',
      );
    }
  }, []);

  // Cross-device live mirror: poll the shared LiveChannel for a build running on ANOTHER device/
  // instance and feed its events into THIS panel's reducer, so a 2nd device watching the same chat sees
  // the live activity. Self-limiting for cost: caller starts it only while the panel is visible + not
  // running locally; it also auto-stops after ~30 s of no activity when the server reports not-running.
  //
  // GENERATION GUARD: /api/agentv3/live is keyed only by userId, and its Firestore-backed ring buffer
  // persists well after a build finishes — so a poll that (re)starts with sinceSeq=0 can still fetch a
  // PAST build's tail events. Freezing `myGen` at call time and re-checking it before every setState
  // means that once the user resets/starts a new session, this poll's next tick sees the mismatch and
  // stops applying (and stops polling) instead of repopulating stale messages/build-status into a
  // session the user has since left ("New chat reverts to the old chat").
  //
  // `opts.workspaceId` (the CALLER's current session) additionally lets the SERVER refuse to mirror a
  // build that's genuinely still running but belongs to a DIFFERENT session under the same account
  // (same-instance case only — see the /live route). Optional for back-compat.
  // Returns a stop function. Best-effort — never throws.
  const subscribeLive = useCallback((opts?: { userId?: string; email?: string; workspaceId?: string }): (() => void) => {
    const uid = opts?.userId ?? userIdRef.current;
    const em = opts?.email ?? emailRef.current;
    if (!uid) return () => {};
    const myGen = generationRef.current;
    let stopped = false;
    // B6 — RESUME from the last seq seen for THIS workspace, so a tab-focus re-arm fetches only what's
    // new instead of re-downloading the whole event history from seq 0.
    const seqKey = opts?.workspaceId ?? '_';
    let sinceSeq = resumeSinceSeq(liveSeqRef.current[seqKey]);
    let idlePolls = 0;
    // BACKGROUND-COST fix (2026-07-05 audit #2): the poll used a FIXED 3s cadence forever, and only an
    // EXPLICIT `running === false` ever wound it down — an omitted/undefined `running` kept a hidden,
    // idle panel polling every 3s indefinitely (battery + network drain, worse now that the v5.0
    // surface stays mounted as a window). Quiet ticks now back off 3s → 30s (×1.6), any activity snaps
    // back to 3s, and ANY non-`true` running counts toward wind-down.
    let delayMs = LIVE_POLL_FAST_MS;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (stopped || isStale(myGen)) { stopped = true; return; }
      // B6 — PAUSE while the tab is hidden: don't hit the network at all, just reschedule at the max
      // cadence. The initial-visibility guard only stopped a poll from STARTING while hidden; a poll
      // already running when the tab was backgrounded kept fetching every few seconds. When the tab is
      // shown again the next tick fetches from `sinceSeq`, so nothing is missed.
      const hidden = typeof document !== 'undefined' && document.hidden === true;
      if (hidden) {
        timer = setTimeout(() => { void tick(); }, nextLivePollDelayMs({ hidden: true, hadActivity: false, current: delayMs }));
        return;
      }
      let hadActivity = false;
      try {
        const params = new URLSearchParams({ userId: uid });
        if (em) params.set('email', em);
        if (opts?.workspaceId) params.set('workspaceId', opts.workspaceId);
        params.set('sinceSeq', String(sinceSeq));
        // Bounded: a dead-zone mobile connection must fail this poll fast and retry, not hang it.
        // SECURITY T0-9: send the Bearer token — the server keys the live mirror off the VERIFIED uid now
        // (a claimed ?userId could otherwise mirror another account's build). Cached token (no forced
        // refresh) since this polls frequently; a token blip just yields an empty poll that self-heals.
        const res = await fetch(`/api/agentv3/live?${params.toString()}`, { headers: await authJsonHeaders(), signal: AbortSignal.timeout(10_000) });
        if (res.ok) {
          const j = await res.json().catch(() => ({} as Record<string, unknown>));
          if (typeof j.seq === 'number') { sinceSeq = j.seq; liveSeqRef.current[seqKey] = sinceSeq; }
          const events = Array.isArray(j.events) ? (j.events as AgentV3WireEvent[]) : [];
          if (events.length > 0) {
            if (isStale(myGen)) { stopped = true; return; } // session moved on while this fetch was in flight
            idlePolls = 0;
            hadActivity = true;
            setState((cur) => events.reduce((s, e) => agentV3Reducer(s, e), cur));
          } else if (j.running !== true) {
            idlePolls += 1; // no activity + not provably running → wind down so an idle open panel stops polling
          }
        }
      } catch { /* best-effort — a failed poll just retries (with backoff) */ }
      if (stopped || isStale(myGen)) { stopped = true; return; }
      if (idlePolls >= 10) { stopped = true; return; } // quiet streak → stop until re-armed by the panel
      delayMs = nextLivePollDelayMs({ hidden: false, hadActivity, current: delayMs });
      timer = setTimeout(() => { void tick(); }, delayMs);
    };
    void tick();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, []);

  // `workspaceId` scopes the check to the CALLER's current session — without it, `buildRunningHere`
  // is undefined and we fall back to the account-wide `buildRunning`, but auto-resume should always
  // pass the session it's actually asking about (see AgentV3Panel's auto-resume effect). Root-caused
  // 2026-07-01: a build genuinely still running in a DIFFERENT v5.0 session under the same account
  // was silently auto-attached into whatever session the user had just opened, because this check
  // only ever asked "is ANY build running for this account" — never "for THIS one".
  const checkRunning = useCallback(async (opts?: { userId?: string; email?: string; workspaceId?: string }) => {
    if (opts) { userIdRef.current = opts.userId; emailRef.current = opts.email; }
    try {
      const params = new URLSearchParams();
      if (userIdRef.current) params.set('userId', userIdRef.current);
      if (emailRef.current) params.set('email', emailRef.current);
      if (opts?.workspaceId) params.set('workspaceId', opts.workspaceId);
      const r = await fetch(`/api/agentv3/status?${params.toString()}`);
      const j = await r.json().catch(() => ({}));
      setServerBuildRunning(opts?.workspaceId ? j?.buildRunningHere === true : j?.buildRunning === true);
    } catch {
      /* best-effort probe — stay as-is on failure */
    }
  }, []);

  // Allowed even while a build is actively streaming HERE (opening a different saved conversation is
  // navigation, same as "+ New chat" — see reset()/start()'s generation-guard comments). Detaches from
  // whatever's currently attached; the underlying server build, if any, keeps running in the background.
  const loadConversation = useCallback(async (opts?: { userId?: string; email?: string; id?: string }): Promise<{ messages: UserChatMsg[]; workspaceId?: string; framework?: string; unfinished?: boolean } | null> => {
    if (opts) { userIdRef.current = opts.userId; emailRef.current = opts.email; }
    lastLoadDiagRef.current = null;
    try {
      const params = new URLSearchParams();
      if (userIdRef.current) params.set('userId', userIdRef.current);
      if (emailRef.current) params.set('email', emailRef.current);
      // SECURITY (#819): conversation reads are now gated on the VERIFIED Firebase token, not the
      // query userId — so these GETs MUST carry the Bearer token or the server returns 403/400 and the
      // old chat never opens (the exact "clicking an old chat does nothing" bug). forceRefresh so a
      // stale/expired cached token self-heals (the token flakiness behind the earlier access issues).
      const authHeaders = await authJsonHeaders(true);
      // Load a SPECIFIC conversation when an id is given (history menu); otherwise the most recent.
      let convoId = opts?.id;
      if (!convoId) {
        const listRes = await fetch(`/api/agentv3/conversations?${params.toString()}`, { headers: authHeaders });
        if (!listRes.ok) { lastLoadDiagRef.current = `history list failed (HTTP ${listRes.status})`; return null; }
        const listJson = await listRes.json().catch(() => ({}));
        const recent = Array.isArray(listJson?.conversations) ? listJson.conversations[0] : undefined;
        convoId = recent?.id ? String(recent.id) : undefined;
      }
      if (!convoId) { lastLoadDiagRef.current = 'no conversation id to load (history was empty)'; return null; }
      const oneRes = await fetch(`/api/agentv3/conversations/${encodeURIComponent(convoId)}?${params.toString()}`, { headers: authHeaders });
      if (!oneRes.ok) {
        // THE key signal: 404 = no server transcript stored for this session's candidate ids;
        // 403 = the record exists but the verified/claimed identity does not own it; 400 = missing id.
        const body = await oneRes.json().catch(() => ({} as { error?: string }));
        lastLoadDiagRef.current = `server refused the transcript (HTTP ${oneRes.status}${body?.error ? `: ${body.error}` : ''}) for id ${convoId}`;
        return null;
      }
      const oneJson = await oneRes.json().catch(() => ({}));
      const conv = oneJson?.conversation as PersistedConversation | undefined;
      if (!conv || !Array.isArray(conv.messages)) { lastLoadDiagRef.current = 'server returned no conversation record (or a malformed one)'; return null; }
      if (conv.messages.length === 0) lastLoadDiagRef.current = `transcript loaded but has 0 turns (id ${convoId})`;
      let next = initialAgentV3State();
      for (const e of conversationToEvents(conv)) next = agentV3Reducer(next, e);
      // Cold-resume fix: the live plan/todos were lost when the server instance recycled (~15-min
      // idle), so the conversation events alone leave the plan panel at 0/N. Repopulate it from the
      // durably-saved plan the server restored (workspaceState.todos) so progress is preserved.
      const restoredTodos = Array.isArray(oneJson?.workspaceState?.todos) ? oneJson.workspaceState.todos : [];
      if (restoredTodos.length > 0) {
        next = agentV3Reducer(next, { type: 'todo_updated', todos: restoredTodos, ts: Date.now() } as AgentV3WireEvent);
      }
      // Invalidate any resume()/start()/subscribeLive() left running from a PREVIOUS session — otherwise
      // its stale, still-in-flight setState can land moments later and overwrite the conversation just
      // loaded. Also detach the actual stream connection (if any); the underlying server build, if any,
      // keeps running in the background and stays resumable from History.
      generationRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      setRunning(false);
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
      // path only rebuilds the AGENT side — without this the user's bubbles vanish on reload), the
      // restored workspaceId so the panel can adopt the SAME session id → a follow-up continues
      // this exact project/memory, AND the durable framework so a reopened non-Vite session's next
      // build doesn't silently reset to vite-react (the framework-reset defect from the reopen audit).
      // AP-3 (cross-restart resume): a build whose durable status is still 'running' on reopen — with no
      // live build anywhere (the panel checks serverBuildRunning) — was cut off before it could settle
      // (a server restart/crash mid-build). The AgentRunner patches a terminal status at EVERY normal exit
      // (complete/error/stopped), so 'running' + not-live is a TRUTHFUL "unfinished" signal, never a
      // cleanly-finished build. The panel uses it to honestly offer a one-click Continue.
      const unfinished = isUnfinishedBuild(conv);
      return { messages: conversationToUserMessages(conv), workspaceId: conv.workspaceId, framework: conv.framework, unfinished };
    } catch (e) {
      lastLoadDiagRef.current = `network/exception while loading (${e instanceof Error ? e.message : String(e)})`;
      return null; // best-effort — never disrupt the panel on a load failure
    }
  }, []);

  /** The reason the LAST loadConversation() failed (or null on success) — surfaced by the panel so an
   *  "old chat won't open" is diagnosable in one click instead of an opaque "0 messages". */
  const conversationLoadDiag = useCallback((): string | null => lastLoadDiagRef.current, []);

  const listConversations = useCallback(async (opts?: { userId?: string; email?: string }): Promise<{ items: ConversationMeta[]; error?: string }> => {
    const uid = opts?.userId ?? userIdRef.current;
    const em = opts?.email ?? emailRef.current;
    if (!uid) return { items: [], error: 'Not signed in.' };
    try {
      const params = new URLSearchParams();
      params.set('userId', uid);
      if (em) params.set('email', em);
      // #819: the list route is gated on the verified Firebase token — send it (force-refreshed so a
      // stale cached token self-heals) or the history menu shows empty.
      const res = await fetch(`/api/agentv3/conversations?${params.toString()}`, { headers: await authJsonHeaders(true) });
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
      // #819: delete is gated on the verified Firebase token — send it or the delete is forbidden.
      const res = await fetch(`/api/agentv3/conversations/${encodeURIComponent(id)}?${params.toString()}`, { method: 'DELETE', headers: await authJsonHeaders() });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  // Pin / unpin a saved build so it floats to the top of the history list. Returns the new pinned
  // state on success (so the caller's optimistic update can reconcile), or null on failure.
  const pinConversation = useCallback(async (id: string, opts: { userId?: string; email?: string; pinned: boolean }): Promise<boolean | null> => {
    const uid = opts.userId ?? userIdRef.current;
    const em = opts.email ?? emailRef.current;
    if (!uid || !id) return null;
    try {
      const params = new URLSearchParams();
      params.set('userId', uid);
      if (em) params.set('email', em);
      const res = await fetch(`/api/agentv3/conversations/${encodeURIComponent(id)}/pin?${params.toString()}`, {
        method: 'POST',
        headers: await authJsonHeaders(),
        body: JSON.stringify({ pinned: opts.pinned }),
      });
      if (!res.ok) return null;
      const json = await res.json().catch(() => ({}));
      return typeof json?.pinned === 'boolean' ? json.pinned : opts.pinned;
    } catch {
      return null;
    }
  }, []);

  // `workspaceId`, when given, must be the CALLER's current session — the server refuses to attach
  // if the running build belongs to a different session under the same account (see /attach route).
  // Omit it only for a truly account-wide manual "Resume" (no session context to check against).
  const resume = useCallback(async (opts?: { userId?: string; email?: string; workspaceId?: string; notice?: string; goneNotice?: string; resultAlreadySeen?: boolean }): Promise<ReconnectOutcome | 'aborted'> => {
    if (resumeInFlightRef.current) return 'aborted'; // don't stack concurrent reconnects
    resumeInFlightRef.current = true;
    if (opts) { userIdRef.current = opts.userId; emailRef.current = opts.email; }
    const gen = ++generationRef.current;  // this resume is now the authoritative generation
    // The replayed buffer rebuilds the CURRENT build's live state — but it only replays THIS
    // build's events, so state that outlives a single turn must survive the reconnect (admin
    // 2026-07-21, same vanish class as the send-reset): prior turns' archived action rows
    // (activityLog), the diff decorations, and the running plan all stay.
    setState((prev) => ({
      ...initialAgentV3State(),
      activityLog: prev.activityLog,
      diffs: prev.diffs,
      todos: prev.todos,
    }));
    // NOTE (root-cause fix 2026-07-05, IMG_5709): the optimistic "re-attached live" `notice` is NOT
    // emitted here anymore. It is a PROMISE that a live build exists — printing it before /attach
    // confirms one is exactly what produced the contradiction "re-attached live" + "No running build
    // to resume." So it is emitted below ONLY on a confirmed-live attach (reconnectOutcome === 'live').
    setError(null);
    setServerBuildRunning(false);
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;
    // `sink` tracks whether the (re)attached stream saw the terminal `result`. Seeded true when a
    // caller reconnects a build that ALREADY produced its result (start()'s post-result reconnect):
    // the re-attach buffer may or may not replay that result, so a tail drop on the reattached stream
    // must never resurface a "network error" for a finished build. Declared before `try` so the
    // `catch` can read it.
    const sink = { sawResult: opts?.resultAlreadySeen === true };
    try {
      const res = await fetch('/api/agentv3/attach', {
        method: 'POST',
        // Bearer token so the server's identity matches the key the build was registered under
        // (pairs with the server-side candidate-key lookup — the dead-Resume fix).
        headers: await authJsonHeaders(),
        body: JSON.stringify({ userId: userIdRef.current, email: emailRef.current, workspaceId: opts?.workspaceId }),
        signal: controller.signal,
      });
      if (isStale(gen)) return 'aborted'; // a reset() happened while /attach was in flight
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        // One coherent decision (pure + tested) for what this reconnect result MEANS, so the user
        // never sees a "re-attached live" promise paired with a "no running build" error.
        const outcome = reconnectOutcome({ ok: false, status: res.status, resultAlreadySeen: sink.sawResult });
        if (outcome === 'gone-notice') {
          // The build ended mid-run (the drop tore it down). Honest, calm, in-thread — NOT a red error.
          // The user's files are durable; they simply resend to continue. No contradiction.
          const text = opts?.goneNotice
            ?? 'That build isn’t running anymore — it either finished or the connection dropped during it. Your files are safe. Send your message again to continue.';
          setState((prev) => agentV3Reducer(prev, { type: 'narration', agent: 'architect', text, ts: Date.now() }));
          setError(null);
        } else if (outcome === 'gone-silent') {
          // The build had already produced its result; a 404 on the tail-reconnect is expected and
          // benign — say nothing, just clean up (no message, no error).
          setError(null);
        } else {
          // A genuine, unexpected failure (non-404) — surface it honestly.
          setError(typeof j?.error === 'string' ? j.error : `Resume failed (HTTP ${res.status}).`);
        }
        setServerBuildRunning(false);
        setRunning(false);
        return outcome; // 'gone-notice' | 'gone-silent' | 'error' — the panel restores on 'gone-notice'
      }
      // Live build CONFIRMED (the attach opened a real stream). ONLY NOW show the optimistic
      // "re-attached live" notice, so the promise can never precede its own confirmation.
      if (opts?.notice) {
        setState((prev) => agentV3Reducer(prev, { type: 'narration', agent: 'architect', text: opts.notice as string, ts: Date.now() }));
      }
      await pumpStream(res, gen, sink);
      return 'live';
    } catch (err) {
      const isAbort = err instanceof DOMException && err.name === 'AbortError';
      if (shouldSurfaceStreamError({ isAbort, isStale: isStale(gen), sawResult: sink.sawResult, reconnected: false })) {
        setError(err instanceof Error ? err.message : String(err));
      }
      return isAbort || isStale(gen) ? 'aborted' : 'error';
    } finally {
      resumeInFlightRef.current = false;
      // Only clear shared flags if THIS resume is still the current generation — otherwise a NEWER
      // resume()/reset() that started while this stale one was unwinding would have its own
      // running/abortRef state clobbered by this call's cleanup.
      if (!isStale(gen)) {
        setRunning(false);
        abortRef.current = null;
      }
    }
  }, [pumpStream]);

  // SHIP TO MAIN (own-repo working-branch storage, slice 2): merge the user's `navbharatai/work`
  // branch into their repo's default branch via a PR — server-side merges ONLY when CI is green.
  // Returns an honest result the caller renders in-thread. The user's GitHub token authorizes it.
  const shipToMain = useCallback(async (opts: { repo: string; userId?: string; email?: string; githubToken?: string }): Promise<ShipResult> => {
    try {
      const res = await fetch('/api/agentv3/ship', {
        method: 'POST',
        headers: await authJsonHeaders(),
        body: JSON.stringify({ repo: opts.repo, userId: opts.userId, email: opts.email, githubToken: opts.githubToken }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, merged: false, note: typeof j?.error === 'string' ? j.error : `Ship failed (HTTP ${res.status}).` };
      return { ok: true, merged: j?.merged === true, prNumber: typeof j?.prNumber === 'number' ? j.prNumber : undefined, prUrl: typeof j?.prUrl === 'string' ? j.prUrl : undefined, ci: typeof j?.ci === 'string' ? j.ci : undefined, base: typeof j?.base === 'string' ? j.base : undefined, note: typeof j?.note === 'string' ? j.note : (j?.merged ? 'Merged.' : 'Could not merge.') };
    } catch (err) {
      return { ok: false, merged: false, note: err instanceof Error ? err.message : String(err) };
    }
  }, []);

  // REVERT LAST MERGE (own-repo storage, slice 2b): undo the most recent change to the user's default
  // branch (server snapshots it back to the previous state as a new, non-destructive commit). Returns
  // an honest result. Only single-parent (squash-ship) commits are auto-revertible server-side.
  const revertLastMerge = useCallback(async (opts: { repo: string; userId?: string; email?: string; githubToken?: string }): Promise<RevertResult> => {
    try {
      const res = await fetch('/api/agentv3/revert', {
        method: 'POST',
        headers: await authJsonHeaders(),
        body: JSON.stringify({ repo: opts.repo, userId: opts.userId, email: opts.email, githubToken: opts.githubToken }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, reverted: false, note: typeof j?.error === 'string' ? j.error : `Revert failed (HTTP ${res.status}).` };
      return { ok: true, reverted: j?.reverted === true, sha: typeof j?.sha === 'string' ? j.sha : undefined, note: typeof j?.note === 'string' ? j.note : (j?.reverted ? 'Reverted.' : 'Nothing to revert.') };
    } catch (err) {
      return { ok: false, reverted: false, note: err instanceof Error ? err.message : String(err) };
    }
  }, []);

  // QUEUE EXECUTOR (FIX #4.3, client-driven): claim the next queued command (server atomically moves it
  // to 'running'). Returns the claimed { id, prompt } or null when nothing is runnable. Best-effort.
  const queueNext = useCallback(async (workspaceId?: string): Promise<{ id: string; prompt: string } | null> => {
    if (!workspaceId) return null;
    try {
      const res = await fetch('/api/agentv3/queue/next', {
        method: 'POST', headers: await authJsonHeaders(),
        body: JSON.stringify({ workspaceId, userId: userIdRef.current, email: emailRef.current }),
      });
      if (!res.ok) return null;
      const j = await res.json().catch(() => ({}));
      const c = j?.claimed;
      return c && typeof c.id === 'string' && typeof c.prompt === 'string' ? { id: c.id, prompt: c.prompt } : null;
    } catch { return null; }
  }, []);

  /** Mark the running queued command done/failed once its build settled (a failure pauses the queue). */
  const queueComplete = useCallback(async (workspaceId: string | undefined, ok: boolean, note?: string): Promise<void> => {
    if (!workspaceId) return;
    try {
      await fetch('/api/agentv3/queue/complete', {
        method: 'POST', headers: await authJsonHeaders(),
        body: JSON.stringify({ workspaceId, ok, note, userId: userIdRef.current, email: emailRef.current }),
      });
    } catch { /* best-effort — a stale 'running' item self-heals to 'failed' on next load */ }
  }, []);

  // QUEUE UI (FIX #6): enqueue / list / cancel for this app's durable command queue. All best-effort.
  const parseQueueItems = (j: unknown): QueueItemView[] => {
    const items = (j as { items?: unknown })?.items;
    return Array.isArray(items)
      ? items.filter((i): i is QueueItemView => !!i && typeof (i as QueueItemView).id === 'string' && typeof (i as QueueItemView).prompt === 'string')
      : [];
  };

  const queueEnqueue = useCallback(async (workspaceId: string | undefined, prompt: string, source: 'user' | 'planner' | 'advisor'): Promise<boolean> => {
    if (!workspaceId || !prompt.trim()) return false;
    try {
      const res = await fetch('/api/agentv3/queue/enqueue', {
        method: 'POST', headers: await authJsonHeaders(),
        body: JSON.stringify({ workspaceId, prompt, source, userId: userIdRef.current, email: emailRef.current }),
      });
      const j = await res.json().catch(() => ({}));
      return res.ok && j?.added === true;
    } catch { return false; }
  }, []);

  const queueList = useCallback(async (workspaceId?: string): Promise<QueueItemView[]> => {
    if (!workspaceId) return [];
    try {
      const params = new URLSearchParams({ workspaceId });
      if (userIdRef.current) params.set('userId', userIdRef.current);
      const res = await fetch(`/api/agentv3/queue?${params.toString()}`, { headers: await authJsonHeaders() });
      if (!res.ok) return [];
      return parseQueueItems(await res.json().catch(() => ({})));
    } catch { return []; }
  }, []);

  const queueCancel = useCallback(async (workspaceId: string | undefined, id: string): Promise<QueueItemView[]> => {
    if (!workspaceId || !id) return [];
    try {
      const res = await fetch('/api/agentv3/queue/cancel', {
        method: 'POST', headers: await authJsonHeaders(),
        body: JSON.stringify({ workspaceId, id, userId: userIdRef.current, email: emailRef.current }),
      });
      if (!res.ok) return [];
      return parseQueueItems(await res.json().catch(() => ({})));
    } catch { return []; }
  }, []);

  const respond = useCallback(async (requestId: string, approved: boolean) => {
    // Clear the gate immediately so the UI is responsive; the build resumes. BOTH interactive gates
    // are cleared here: a secrets popup answers through this same route, and leaving it mounted after
    // the answer would show the user a form for keys they have already saved.
    setState((prev) => ({ ...prev, pendingPermission: undefined, pendingSecrets: undefined }));
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

  /**
   * Restore a checkpoint. Returns the SERVER's own sentence, because the server is the only side that
   * knows WHY a restore did not happen — "this workspace was rebuilt, its earlier history is gone" and
   * "not in this session" used to be the same boolean, and only one of them is something the user can
   * act on. `message` is always present; `ok` says whether anything changed.
   */
  const restore = useCallback(async (sha: string): Promise<{ ok: boolean; message: string }> => {
    const workspaceId = workspaceIdRef.current;
    if (!workspaceId) return { ok: false, message: 'Open the app first, then restore a checkpoint.' };
    try {
      const res = await fetch('/api/agentv3/restore', {
        method: 'POST',
        headers: await authJsonHeaders(),
        body: JSON.stringify({ workspaceId, sha, userId: userIdRef.current, email: emailRef.current }),
      });
      const j = await res.json().catch(() => ({}));
      const ok = res.ok && j?.ok === true;
      return {
        ok,
        message: typeof j?.message === 'string' && j.message
          ? j.message
          : (ok ? 'Restored your workspace to that checkpoint.' : 'Could not restore that checkpoint. Your current files were not changed.'),
      };
    } catch {
      return { ok: false, message: 'Could not reach the server. Your current files were not changed.' };
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
    async (prompt: string, opts?: { userId?: string; email?: string; onlyOpus?: boolean; powerLevel?: 'weak' | 'off' | 'mini' | 'medium' | 'max'; planFirst?: boolean; thinking?: boolean; sessionId?: string; attachments?: Array<{ name: string; type: string; base64: string }>; framework?: string; frameworkExplicit?: boolean; frameworkResolved?: boolean; importUrl?: string; deployProvider?: string; chatRole?: 'planner' | 'advisor'; appSignature?: boolean }) => {
      if (running) return;
      // V4-1a — remember this turn's shape so an interrupted build can auto-continue itself
      // (attachments/importUrl deliberately dropped: the continue-turn resumes from durable files).
      lastStartRef.current = { prompt, opts: { userId: opts?.userId, email: opts?.email, sessionId: opts?.sessionId, framework: opts?.framework } };
      if (!autoStartRef.current) autoContinuedRef.current = false; // only a REAL user turn re-arms the one-shot
      autoStartRef.current = false;
      userIdRef.current = opts?.userId;
      emailRef.current = opts?.email;
      // This build's generation — reset() can now fire WHILE this loop is streaming (the user
      // navigating to "+ New chat" / a different history item no longer waits for `running` to go
      // false; see the comment on the reader loop below). Bumping here means a stale event from an
      // ABANDONED build can never land on the session the user switched to.
      const gen = ++generationRef.current;
      // Reset only the TRANSIENT build state for the new turn (narration, plan,
      // agents, done/health). PRESERVE the durable project view — files, workspace, live
      // preview and repo — so a follow-up/retry message does NOT blank the user's files to
      // 0 the instant Send is pressed. The build's file_changed events upsert by path, so
      // keeping the existing list shows no duplicates and the project stays visible.
      // ALSO preserved (admin 2026-07-21):
      //  • the settled turn's ACTIVITY → archived into activityLog (deactivated), so the finished
      //    build's action rows + diff decorations stay in the chat instead of vanishing on the
      //    next send/auto-continue ("app banne ke bad diff gayab" root cause);
      //  • TODOS → the plan stays on screen across the send gap; the server's merged
      //    todo_updated (todoMerge.ts) then folds the new turn into the SAME plan.
      setState((prev) => ({
        ...initialAgentV3State(),
        files: prev.files,
        diffs: prev.diffs,
        activityLog: carryOverActivity(prev.activityLog, prev.activity),
        todos: prev.todos,
        workspaceId: prev.workspaceId,
        previewUrl: prev.previewUrl,
        repoUrl: prev.repoUrl,
      }));
      setError(null);
      setBillingBlock(null); // a fresh send clears any prior add-credits screen.
      setRunning(true);
      // WATCHDOG — begin the silence window at build start (not stale mount time), so the
      // stall detector measures THIS build and never fires before the first event arrives.
      lastEventTsRef.current = Date.now();
      sawResultRef.current = false; // fresh build — its terminal result hasn't arrived yet

      const controller = new AbortController();
      abortRef.current = controller;
      // Tracks whether THIS build emitted its terminal `result`. Once it has, the build is done —
      // any later stream throw (a mobile blip, or Cloud Run's request timeout during the up-to-~6-min
      // post-result import-preview boot the server runs before it closes the stream) is a tail drop,
      // NOT a build failure, so it must never surface as a "network error" banner. Declared out here
      // so the `catch` below can read it (see shouldSurfaceStreamError).
      let sawResult = false;

      try {
        const res = await fetch('/api/agentv3/chat', {
          method: 'POST',
          // SECURITY (C1): send the Firebase ID token so the server derives identity from the VERIFIED
          // token, not the body.userId (which it no longer trusts). forceRefresh=true mints a fresh
          // token so a stale/expired cached one self-heals instead of arriving unverifiable.
          headers: await authJsonHeaders(true),
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
            // Role chats (FIX #5): 'planner' | 'advisor' routes the turn into the read-only role lane
            // (no tools, no build lock) — absent for normal builder turns.
            chatRole: opts?.chatRole || undefined,
            attachments: opts?.attachments && opts.attachments.length > 0 ? opts.attachments : undefined,
            framework: opts?.framework || undefined,
            // Bidirectional-selection (admin 2026-07-20): true when the framework was a DELIBERATE pick
            // (picker or a reopened session) → the server honours it over chat-text detection.
            frameworkExplicit: opts?.frameworkExplicit === true ? true : undefined,
            importUrl: opts?.importUrl || undefined,
            // R5 §5.1 — the hosting provider the user chose for a deploy turn (no lock-in).
            deployProvider: opts?.deployProvider || undefined,
            // "made by NavBharatAI" app-signature toggle (Settings → General, admin 2026-07-16).
            // Default ON — only sent as `false` when the user turned the badge off.
            appSignature: opts?.appSignature,
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
          let resumable = false;
          let body: Record<string, unknown> = {};
          try {
            const j = await res.json();
            if (j && typeof j === 'object') body = j as Record<string, unknown>;
            if (typeof body.error === 'string') msg = body.error;
            resumable = body.resumable === true;
          } catch {
            /* non-JSON error body */
          }
          // PAID-PUBLIC (billing PR 5): credits ran out → the server refused the build pre-start with a
          // clean 402 (no build was started). Render a dedicated "Add credits" screen from the structured
          // body instead of a bare error banner, so the user sees their balance, the estimate, and a way
          // to top up. Only reachable when AGENTV3_PAID_PUBLIC is on and the user is a paying (non-free) one.
          // POWER_MODE_PAID_ONLY (Slice F): power mode requested by a not-yet-paying account — same
          // actionable add-credits card, with the server's specific power-mode message as the notice.
          if (res.status === 402 && (body.code === 'INSUFFICIENT_CREDITS' || body.code === 'POWER_MODE_PAID_ONLY')) {
            setBillingBlock({
              notice: msg,
              balanceInr: typeof body.balanceInr === 'number' ? body.balanceInr : undefined,
              estimateInr: typeof body.estimateInr === 'number' ? body.estimateInr : undefined,
              balanceTokens: typeof body.balanceTokens === 'number' ? body.balanceTokens : undefined,
              estimateTokens: typeof body.estimateTokens === 'number' ? body.estimateTokens : undefined,
            });
            setRunning(false);
            return;
          }
          // AUTO-REATTACH on "a build is already running" (test #5): the user closed the tab
          // mid-build, reopened, and typed a message — their OWN build from before the reload is
          // still running server-side. Dead-ending with "stop it first" hid a build they couldn't
          // even see. When THIS session has a known workspace, re-attach its live stream instead
          // (workspace-scoped — the attach route refuses a different session's build, so this can
          // never hijack another chat). The typed message was NOT queued into the running build —
          // the notice says so honestly, in-thread.
          if (res.status === 409 && resumable && workspaceIdRef.current) {
            setRunning(false);
            await resume({
              userId: opts?.userId,
              email: opts?.email,
              workspaceId: workspaceIdRef.current,
              notice: 'Your build from before the reload was still running — I re-attached to it live below. The message you just typed was NOT sent to it; once the build finishes, send it again.',
            });
            return;
          }
          if (res.status === 409 && resumable) {
            // A build is running for this account but in a DIFFERENT (or unknown) session — attaching
            // it here would pour another chat's build into this one. But a bare error DEAD-ENDS the user
            // (root-cause fix): flip serverBuildRunning so the panel renders the real STOP button, which
            // force-clears the account lock server-side. The message tells them exactly that. (The server
            // ALSO auto-reclaims an abandoned lock after its stall window, so this is the fast manual path.)
            setServerBuildRunning(true);
            setError('A build is still running on your account. Press ⏹ Stop to end it, then send your message again.');
            setRunning(false);
            return;
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

        // Read NDJSON: one JSON event per line (mirrors the Engineer stream). GENERATION GUARD: the
        // user can now navigate to "+ New chat" / a different history item WHILE this build is still
        // streaming (reset() no longer waits for `running` to go false) — abort() ends the fetch, but
        // any event already in-flight when that happens must still be dropped, exactly like
        // pumpStream/subscribeLive, or it silently repopulates the session the user just switched to.
        // FILE-REVEAL PACING (admin 2026-07-21): same honest drip as the attach stream — see revealPacer.ts.
        const pacer = createRevealPacer<AgentV3WireEvent>((e) => setState((prev) => agentV3Reducer(prev, e)), FILE_REVEAL_PACER_OPTS);
        for (;;) {
          if (isStale(gen)) { pacer.discard(); try { await reader.cancel(); } catch { /* best-effort */ } return; }
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
            if (isStale(gen)) { pacer.discard(); try { await reader.cancel(); } catch { /* best-effort */ } return; }
            gotEvent = true;
            lastEventTsRef.current = Date.now(); // WATCHDOG — mark stream activity (incl. 15s pings)
            pacer.push(event);
            // TERMINAL EVENT → stop "running" the INSTANT the build's `result` arrives, instead of
            // waiting for the stream to physically CLOSE. The server holds the stream open (15s pings)
            // through the post-result cleanup/finally (checkpoint flush, durable saves), so waiting for
            // close left the spinner stuck "building" after the app was already done — the exact
            // "Done · N steps but still stuck" symptom. We key ONLY on `result` (emitted exactly once
            // per build by the route), NOT `done` — sub-agents share this stream and each emits its own
            // `done`, so `done` is not build-terminal. Further events still render; `running` clears as
            // soon as the result is known. A resumable (deadline-paused) result clears running too — the
            // bounded auto-continue re-arms it via state.resumable.
            if ((event as { type?: string }).type === 'result' && !isStale(gen)) {
              sawResult = true; // build is terminal — a later stream drop is not a failure
              sawResultRef.current = true; // WATCHDOG — a later "not running" probe = finished, not stalled
              setRunning(false);
              setServerBuildRunning(false);
            }
          }
        }

        pacer.flush(); // stream closed — reveal anything still queued immediately (nothing is ever dropped)

        // If the stream produced no usable events, surface what came back so a
        // silent failure (e.g. an HTML error page, or an empty body) is visible. Skipped if the user
        // has since navigated away — an abandoned build's empty-stream case is not THEIR problem.
        if (!gotEvent && !isStale(gen)) {
          const sample = (rawSample || buffer).trim();
          setError(
            sample
              ? `The server did not return v5.0 events. It replied with:\n${sample.slice(0, 300)}`
              : `No response from the v5.0 engine (HTTP ${res.status}). The backend may be unreachable, or v5.0 is not enabled on the server.`,
          );
        }
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError') && !isStale(gen)) {
          // A mid-stream network drop — iOS Safari surfaces this as "Load failed", and a
          // flaky mobile link or a brief server blip looks the same — must NOT dead-end the
          // build. The server keeps the build alive and BUFFERED (runningBuilds + /attach),
          // so probe it and, if it is still running, transparently re-attach: the buffered
          // events replay and the stream continues exactly where it dropped. Only surface the
          // raw error when the build is genuinely gone. This is the same recovery the stall
          // WATCHDOG performs, triggered immediately on the drop instead of waiting for a
          // silence window that never comes (the drop flips `running` to false first).
          // Skipped entirely once stale — the user already navigated away, so a dropped connection
          // for the ABANDONED build must not reconnect into (or show an error on) the new session.
          // RETRY the reconnect probe with backoff (root-cause fix for "a 1-second blip fails the
          // build"): the single immediate probe ran WHILE the network was still down, so it too threw
          // and the build was declared FAILED. A brief blip (iOS "Load failed", a 1–2s mobile drop) is
          // over by the 2nd/3rd attempt — so we retry a few times before giving up, and only surface
          // the real error once a probe DEFINITIVELY reports the build is gone or all attempts fail.
          let reconnected = false;
          for (let attempt = 0; attempt < 4 && !reconnected && !isStale(gen); attempt++) {
            if (attempt > 0) await new Promise((r) => setTimeout(r, 1200 * attempt)); // 0, 1.2s, 2.4s, 3.6s
            try {
              const params = new URLSearchParams();
              if (userIdRef.current) params.set('userId', userIdRef.current);
              if (emailRef.current) params.set('email', emailRef.current);
              // SESSION-SCOPED + BOUNDED (2026-07-05 audit #3/#4): scope the probe to THIS session's
              // workspace so recovery can never re-attach a different session's build, and time-box it
              // so a still-dead connection fails fast into the next backoff attempt instead of hanging.
              if (workspaceIdRef.current) params.set('workspaceId', workspaceIdRef.current);
              const probe = await fetch(`/api/agentv3/status?${params.toString()}`, { signal: AbortSignal.timeout(15_000) });
              const j = await probe.json().catch(() => ({}));
              if (isStale(gen)) break;
              const aliveHere = workspaceIdRef.current ? j?.buildRunningHere === true : j?.buildRunning === true;
              if (aliveHere) {
                reconnected = true;
                // Pass whether this build already produced its terminal result. After the result the
                // build IS done and the server is only running the best-effort import-preview boot —
                // reconnecting catches its tail (e.g. the live preview URL), but a further drop on the
                // reattached stream must not resurface an error for a finished build.
                await resume({ userId: userIdRef.current, email: emailRef.current, workspaceId: workspaceIdRef.current, resultAlreadySeen: sawResult });
              } else if (j && (workspaceIdRef.current ? j.buildRunningHere === false : j.buildRunning === false)) {
                break; // server reached + build genuinely ended — stop retrying, show the real result/error
              }
              // else: probe reached but shape was unexpected → try again after backoff
            } catch { /* still offline — back off and retry */ }
          }
          // A stream error AFTER the terminal `result` (`sawResult`) is a post-result tail drop, not a
          // build failure — the server holds the stream open for up to ~6 min of import-preview boot
          // after the result, and Cloud Run's request timeout / a mobile blip can sever it. Never show
          // a "network error" for a build that already succeeded.
          if (shouldSurfaceStreamError({ isAbort: false, isStale: isStale(gen), sawResult, reconnected })) {
            setError(err instanceof Error ? err.message : String(err));
          }
        }
      } finally {
        // Only clear shared flags if THIS build is still the current generation — otherwise a
        // NEWER session's reset()/start()/resume() that began while this one was unwinding would
        // have its own running/abortRef state clobbered by this call's cleanup.
        if (!isStale(gen)) {
          setRunning(false);
          setServerBuildRunning(false);
          abortRef.current = null;
        }
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
    // RESPONSIVENESS fix (2026-07-05 audit #1): 100s stall + a 30s tick meant a dead stream sat as a
    // frozen spinner for up to ~2min 20s before the auto-reconnect even started. The server pings every
    // 15s, so >35s of TOTAL silence already proves the stream is dead — detect in ~35-45s instead.
    const STALL_MS = 35_000;
    const id = setInterval(() => {
      if (Date.now() - lastEventTsRef.current < STALL_MS) return;
      lastEventTsRef.current = Date.now(); // avoid re-firing every tick while we reconcile
      void (async () => {
        try {
          const params = new URLSearchParams();
          if (userIdRef.current) params.set('userId', userIdRef.current);
          if (emailRef.current) params.set('email', emailRef.current);
          // SESSION-SCOPED (audit #4): without workspaceId this account-wide probe could re-attach a
          // DIFFERENT session's build into this panel. Bounded so a dead connection can't hang the net.
          if (workspaceIdRef.current) params.set('workspaceId', workspaceIdRef.current);
          const r = await fetch(`/api/agentv3/status?${params.toString()}`, { signal: AbortSignal.timeout(15_000) });
          const j = await r.json().catch(() => ({}));
          const alive = workspaceIdRef.current ? j?.buildRunningHere === true : j?.buildRunning === true;
          const action = stallWatchdogAction({ alive, sawResult: sawResultRef.current });
          if (action === 'reconnect') {
            // The build is alive but OUR stream went quiet — reconnect and keep going.
            abortRef.current?.abort();
            await resume({ userId: userIdRef.current, email: emailRef.current, workspaceId: workspaceIdRef.current });
          } else {
            // Build no longer running server-side — stop the spinner instead of hanging.
            abortRef.current?.abort();
            setRunning(false);
            setServerBuildRunning(false);
            // Only 'error' shows the scary notice. When we ALREADY saw the terminal `result`, this is a
            // clean FINISH (a silent post-build reviewer/cleanup phase just ended) — never overwrite a
            // succeeded-and-rendered build with "stopped responding".
            if (action === 'error') {
              // V4-1a (NIRMAN Phase A, admin: "chat dead nahi honi chahiye"): the build was
              // interrupted mid-flight (network cut / instance rotation). Files are durable — so
              // instead of dead-ending on the notice, AUTO-CONTINUE with the proven recovery message,
              // exactly once per interruption. A second death of the same turn (or nothing to
              // continue) falls back to the honest notice.
              if (shouldAutoContinue({ sawResult: sawResultRef.current, alreadyContinued: autoContinuedRef.current, hasLastPrompt: !!lastStartRef.current })) {
                autoContinuedRef.current = true;
                const last = lastStartRef.current!;
                setError(null);
                setTimeout(() => { autoStartRef.current = true; void start('please continue', last.opts); }, 400);
              } else {
                setError('The build stopped responding — your files are saved. Send a message and I\'ll continue from where it left off.');
              }
            }
          }
        } catch { /* probe failed — leave running and try again next tick */ }
      })();
    }, 10_000);
    return () => clearInterval(id);
  }, [running, resume, start]);

  const clearBillingBlock = useCallback(() => setBillingBlock(null), []);

  return { state, running, error, start, respond, restore, getCheckpoints, getGitStatus, restoreAllFiles, stop, unsend, reset, serverBuildRunning, resume, shipToMain, revertLastMerge, queueNext, queueComplete, queueEnqueue, queueList, queueCancel, checkRunning, loadConversation, conversationLoadDiag, listConversations, deleteConversation, pinConversation, subscribeLive, billingBlock, clearBillingBlock };
}
