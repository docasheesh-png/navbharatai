import { useCallback, useEffect, useRef, useState } from 'react';
import { FilesPanel, type FilesPanelProps } from '../panels/FilesPanel';
import {
  Bot, Send, Square, Loader2, Terminal, FileDiff, FolderOpen,
  History, CheckCircle2, AlertCircle, Rocket, Globe, ExternalLink, RotateCcw, Play,
  SlidersHorizontal, Check, X, Paperclip, FileText, Download, Github, Circle, GitBranch,
  ChevronLeft, ChevronRight, ChevronDown,
  FileCode, Copy, Maximize2, Minimize2, ThumbsUp, ThumbsDown, Menu, Plus, Clock,
} from 'lucide-react';
import type { ConversationMeta } from '../../hooks/useAgentV3Build';
import { useAgentV3Build } from '../../hooks/useAgentV3Build';
import { sessionStatusMeta, groupSessionsByDate, legacyPrependMessages } from './agentV3History';
import { decideAutoContinue } from './planAutoContinue';
import { buildChatBlocks } from './activityTimeline';
import { ActionGroupRow } from './ActivityTimeline';
import { trackEvent } from '../../lib/analytics';
import { normalizeUid } from '../../lib/agentv3Workspace';
import { FrameworkPicker, FRAMEWORKS } from './FrameworkPicker';
import { PreviewSurface } from './PreviewSurface';
import type { ActivityEntry, AgentCard, BuildHealth, GitCheckpoint, TodoItem, TodoStatus } from './agentV3Types';
import { db, sanitizeFirestoreData, auth } from '../../App';

/** Best-effort Firebase ID-token header so the server can verify workspace ownership (IDOR guard).
 *  Returns {} for the synthetic admin / anonymous users (no Firebase user) — the server falls back
 *  to its claimed-id + random-sessionId check for those. */
async function authJsonHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const tok = await auth.currentUser?.getIdToken();
    if (tok) headers.Authorization = `Bearer ${tok}`;
  } catch { /* no token — server soft-falls-back */ }
  return headers;
}
import { doc, setDoc, deleteDoc, collection, query, where, getDocs } from 'firebase/firestore';

/**
 * AgentV3Panel — NavBharatAI Pro v3.0 (Vargen 3.0), a Claude-Code-style chat
 * app builder. You chat with it (it replies to anything, even "hello"); when you
 * describe an app it builds it for real, and the workspace surfaces (preview,
 * files, diff, terminal, git) update live alongside. All activity is REAL engine
 * output — nothing is a scripted animation.
 */
type SurfaceTab = 'preview' | 'files' | 'diff' | 'terminal' | 'history';
interface ChatMsg {
  role: 'user' | 'agent';
  agent?: string;
  text: string;
  ts: number;
  kind?: 'text' | 'thinking';
  streaming?: boolean;
}

const V3_EXT_COLOR: Record<string, string> = {
  html: 'text-orange-400', css: 'text-blue-400', js: 'text-yellow-400',
  ts: 'text-cyan-400', tsx: 'text-cyan-400', jsx: 'text-yellow-400',
  json: 'text-green-400', md: 'text-purple-400', py: 'text-emerald-400',
  svg: 'text-pink-400', png: 'text-pink-400', jpg: 'text-pink-400',
};

// Last `resume` nonce actually applied — at MODULE scope on purpose, so it SURVIVES the panel
// unmounting/remounting. A component useRef resets to 0 on every remount, which is exactly what let a
// stale (never-cleared) `resume` prop re-apply an old chat on each reopen. See the resume effect below.
let lastAppliedResumeNonce = 0;

export function AgentV3Panel({ userId, email, resume, freshOpenNonce, onFilesSync, onBeforeBuild, onOpenInIDE, onPreviewState, pendingFix, filesPanel }: { userId?: string; email?: string; resume?: { sessionId: string; messages: ChatMsg[]; nonce: number } | null; freshOpenNonce?: number; onFilesSync?: (files: Record<string, string>) => void; onBeforeBuild?: () => Promise<void>; onOpenInIDE?: (path: string) => void; onPreviewState?: (s: { previewUrl?: string; workspaceId?: string; framework?: string; running?: boolean }) => void; pendingFix?: { text: string; nonce: number } | null; filesPanel?: FilesPanelProps }) {
  const { state, running, error, start, respond, restore, getCheckpoints, getGitStatus, restoreAllFiles, stop, reset, serverBuildRunning, resume: resumeBuild, checkRunning, loadConversation, conversationLoadDiag, listConversations, deleteConversation, subscribeLive } = useAgentV3Build();
  const [prompt, setPrompt] = useState('');
  // Power level (admin tiers 2026-06-27): Off = normal (Sonnet, billed ×3.5);
  // 5× = Opus minimum power; 10× = Opus medium; 20× = Opus max / ultracode.
  const [powerLevel, setPowerLevel] = useState<'off' | 'mini' | 'medium' | 'max'>('off');
  // Derived for the existing boolean call sites (start/telemetry) — any Opus power level.
  const onlyOpus = powerLevel !== 'off';
  const [planFirst, setPlanFirst] = useState(false); // chat-first: no forced plan gate by default
  const [thinking, setThinking] = useState(false); // adaptive thinking, off by default
  const [tab, setTab] = useState<SurfaceTab>('preview');
  // Workspace is collapsed by default so the chat takes the full width; opening a
  // header tab pill surfaces it. On mobile an open workspace takes over the area.
  const [showWorkspace, setShowWorkspace] = useState(false);
  // Local-only UI flag for the input-row settings popover (Planning/Thinking/Power).
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Files the user attached for the next message (images, PDFs, Word/Excel/PPT,
  // ZIP, text/code). Read and analyzed by v3.0 — converted to base64 on send.
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Composer: auto-growing textarea + expand/minimize + device-aware Enter behaviour.
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const [composerExpanded, setComposerExpanded] = useState(false);
  // Touch-primary devices (phones) → Enter inserts a newline; only the Send button sends. A laptop
  // (fine pointer / physical keyboard) → Enter sends. Reactive to device/orientation changes.
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(pointer: coarse)');
    const update = () => setIsTouchDevice(mq.matches);
    update();
    mq.addEventListener?.('change', update);
    return () => mq.removeEventListener?.('change', update);
  }, []);
  // Auto-grow the composer to fit its content, capped at ~5 lines (then it scrolls internally). When
  // expanded, a CSS class drives the height instead, so we clear the inline height.
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    if (composerExpanded) { el.style.height = ''; return; }
    el.style.height = 'auto';
    const maxHeight = 24 * 5 + 16; // ~5 lines (line-height 24) + vertical padding (py-2)
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, [prompt, composerExpanded]);
  // Framework selector + import
  const [framework, setFramework] = useState('vite-react');
  const [importUrl, setImportUrl] = useState('');
  const [showFrameworkPicker, setShowFrameworkPicker] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  // ── GitHub repo picker (1-click import, admin plan 2026-07-04) ────────────────────────────
  // ghRepos: null = not loaded yet; [] = loaded but the account has no repos.
  const [ghRepos, setGhRepos] = useState<Array<{ fullName: string; url: string; isPrivate: boolean; updatedAt: number; description: string }> | null>(null);
  const [ghReposLoading, setGhReposLoading] = useState(false);
  // 'auth' = not connected / token expired (show Connect); anything else = a real fetch error.
  const [ghReposError, setGhReposError] = useState<string>('');
  const [repoSearch, setRepoSearch] = useState('');
  const [importSending, setImportSending] = useState(false);

  const loadGhRepos = useCallback(async () => {
    const token = (() => { try { return localStorage.getItem('gh_token'); } catch { return null; } })();
    if (!token) { setGhRepos(null); setGhReposError('auth'); return; }
    setGhReposLoading(true);
    setGhReposError('');
    try {
      const res = await fetch('/api/github/repos', { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 401 || res.status === 403) { setGhRepos(null); setGhReposError('auth'); return; }
      if (!res.ok) throw new Error(`GitHub returned ${res.status} — try again in a moment.`);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('Unexpected response while listing your repositories.');
      setGhRepos(
        data
          .map((r: { full_name?: unknown; html_url?: unknown; private?: unknown; updated_at?: unknown; description?: unknown }) => ({
            fullName: typeof r.full_name === 'string' ? r.full_name : '',
            url: typeof r.html_url === 'string' ? r.html_url : '',
            isPrivate: r.private === true,
            updatedAt: typeof r.updated_at === 'string' ? (Date.parse(r.updated_at) || 0) : 0,
            description: typeof r.description === 'string' ? r.description : '',
          }))
          .filter((r) => r.fullName && r.url),
      );
    } catch (e) {
      setGhRepos(null);
      setGhReposError(e instanceof Error ? e.message : 'Could not load your repositories.');
    } finally {
      setGhReposLoading(false);
    }
  }, []);
  // Load the list the moment the modal opens (state 3: already connected → zero extra clicks).
  useEffect(() => {
    if (showImportModal) { setRepoSearch(''); void loadGhRepos(); }
  }, [showImportModal, loadGhRepos]);

  // Full-page OAuth redirect — the SAME proven flow the app-level GitHub connect uses (the
  // callback returns to this exact URL with #gh_token, which App.tsx stores in localStorage).
  // A redirect can't be killed by mobile popup blockers, unlike window.open.
  const connectGitHub = useCallback(async () => {
    try {
      const state = window.location.href.split('#')[0];
      const redirectUri = 'https://navbharatai.com/api/github/callback';
      const reqUrl = new URL(`${window.location.origin}/api/auth/github/url`);
      reqUrl.searchParams.set('redirect_uri', redirectUri);
      reqUrl.searchParams.set('state', state);
      const response = await fetch(reqUrl.toString());
      const data = await response.json().catch(() => ({}));
      if (!response.ok || typeof data?.url !== 'string' || !data.url) throw new Error('Could not start GitHub sign-in — try again.');
      const githubUrl = new URL(data.url);
      if (data.clientId) githubUrl.searchParams.set('client_id', String(data.clientId));
      githubUrl.searchParams.set('redirect_uri', redirectUri);
      if (data.scope) githubUrl.searchParams.set('scope', String(data.scope));
      if (data.state) githubUrl.searchParams.set('state', String(data.state));
      window.location.href = githubUrl.toString();
    } catch (e) {
      setGhReposError(e instanceof Error ? e.message : 'Could not start GitHub sign-in.');
    }
  }, []);

  // 1-CLICK IMPORT: picking a repo sends the import message itself — the user just watches the
  // clone → Files/IDE → preview → AI survey happen (the #886/#890 Landing Pipeline server-side).
  // Deliberately a PLAIN function (not useCallback): it must close over the CURRENT render's
  // send() — a memoized version would freeze the first render's userId/email/session bindings.
  const importRepo = (repoUrl: string) => {
    if (running || importSending) return;
    setImportSending(true);
    setShowImportModal(false);
    void send({
      text: 'Import this app from my GitHub repository and give me a short survey of what it is and how it is structured. Do not change any files yet.',
      importUrl: repoUrl,
    }).finally(() => setImportSending(false));
  };
  const [userMsgs, setUserMsgs] = useState<ChatMsg[]>([]);
  // Finalized agent replies from PREVIOUS turns. The live build state
  // (state.narration) is reset by start() on every new message, so without
  // persisting prior replies here they would vanish from the thread when the
  // next message begins. Snapshotted in send() right before start() runs.
  const [agentHistory, setAgentHistory] = useState<ChatMsg[]>([]);
  // Git checkpoints from PREVIOUS turns. Like state.narration, state.checkpoints
  // is reset by start() on every message, so the History tab would forget prior
  // checkpoints across an iterative session. Snapshotted in send() before start().
  const [checkpointHistory, setCheckpointHistory] = useState<GitCheckpoint[]>([]);
  // Phase G1 — honest restore feedback: a restore can fail if the SHA isn't in the CURRENT sandbox
  // (e.g. it recycled since that checkpoint, or we're in a fresh session). We tell the user the truth
  // instead of a silent no-op or a fake "restored".
  const [restoreNote, setRestoreNote] = useState<string>('');
  // Phase G2 — live working-tree git status (wired into the sync body). null until first load.
  const [gitStatus, setGitStatus] = useState<import('../../hooks/useAgentV3Build').GitStatus | null>(null);
  const handleRestoreCheckpoint = async (sha: string) => {
    setRestoreNote('Restoring…');
    const ok = await restore(sha);
    setRestoreNote(ok
      ? '✅ Restored your workspace to that checkpoint.'
      : "⚠️ That checkpoint isn't active in this session yet (the sandbox may have recycled). Continue a build to make its history live again.");
  };
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // A stable session id keeps the SAME sandbox + memory + workspace across messages,
  // so the build is iterative (each message continues the same project). "New session"
  // starts a fresh project.
  //
  // CRITICAL — the session id is PERSISTED in localStorage (per account), so a page
  // RELOAD or a tab switch reuses the SAME id → the same workspaceId
  // (agentv3-{uid}-{sessionId}) → the same memory and files. Without this, a reload
  // minted a fresh id, pointing the next message at an EMPTY new workspace — the
  // user's app/memory looked "lost". Reload now genuinely continues the project.
  const newSessionId = () =>
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const sessionStorageKey = `agentv3_session_${userId || 'anon'}`;
  // Persist the session id so a RELOAD continues the same project. localStorage can throw in some
  // Incognito/Private modes — fall back to sessionStorage so continuity holds within the tab session
  // instead of minting a fresh (empty) workspace on every reload.
  const persistSessionId = (id: string) => {
    try { localStorage.setItem(sessionStorageKey, id); return; } catch { /* try sessionStorage next */ }
    try { sessionStorage.setItem(sessionStorageKey, id); } catch { /* both storages unavailable */ }
  };
  const sessionIdRef = useRef<string>('');
  if (!sessionIdRef.current) {
    // ADMIN RULE (2026-07-01): opening NavBharatAI Pro v3.0 ALWAYS starts a brand-new chat. We do NOT
    // restore the last session id from storage anymore — a reload or reopen must NEVER reload the old
    // (or a stuck) chat into the box. Every past chat is still saved and reachable from the ☰ History
    // menu to reopen on demand; it just never auto-loads.
    sessionIdRef.current = newSessionId();
    persistSessionId(sessionIdRef.current);
  }
  // The workspaceId THIS session expects — passed to checkRunning/resume/subscribeLive so the server
  // only auto-attaches/mirrors a build that actually belongs to THIS session, never one still running
  // under a DIFFERENT v3.0 chat on the same account (root-caused 2026-07-01: "+ New chat" — and, more
  // generally, opening any v3.0 session — could show an unrelated session's in-progress build).
  const expectedWorkspaceId = (): string | undefined =>
    state.workspaceId || (userId && sessionIdRef.current ? `agentv3-${normalizeUid(userId)}-${sessionIdRef.current}` : undefined);

  // The chat thread merges the user's own messages with the engine's live
  // narration (which streams in word-by-word and finalizes in place), ordered by
  // timestamp. Reading narration straight from state means streaming updates show
  // live instead of being frozen into a one-time snapshot.
  const convo: ChatMsg[] = [
    ...agentHistory,
    ...userMsgs,
    ...state.narration.map((n) => ({
      role: 'agent' as const,
      agent: n.agent,
      text: n.text,
      ts: n.ts,
      kind: n.kind,
      streaming: n.streaming,
    })),
  ]
    // "⏱️ Still building… N min in" is a TRANSIENT live-progress line (server ETA heartbeat), not chat
    // history. Show it only while a build is running; once done, drop it so a finished session's thread
    // isn't left cluttered with stale "Still building…" bubbles that make a completed build look
    // permanently stuck. Filtering by the text marker (not just the live id) also cleans OLD sessions
    // that persisted these lines before the fix, and keeps them out of the History save (which reads
    // `convo` after `running` has cleared on the terminal result).
    .filter((m) => running || !/^⏱️\s*Still building…/.test(m.text || ''))
    .sort((a, b) => a.ts - b.ts);

  // Claude-style chat timeline (admin redesign): prose bubbles interleaved with COLLAPSED action
  // rows — everything the engine did between two prose lines ("Created 33 files", "Ran `npm
  // install`", real +N/-M from the actual patches) in one glanceable, expandable row, instead of
  // the old flat spam of per-file ticks and ⏱ heartbeats. Pure grouping in activityTimeline.ts.
  const chatBlocks = buildChatBlocks(convo, state.activity, state.diffs);

  // All checkpoints across the session (prior turns + the live build), deduped by
  // sha so the History tab keeps showing earlier checkpoints across messages.
  const allCheckpoints: GitCheckpoint[] = (() => {
    const seen = new Set<string>();
    const out: GitCheckpoint[] = [];
    for (const c of [...checkpointHistory, ...state.checkpoints]) {
      const key = c.sha || c.id;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c);
    }
    return out;
  })();

  // Auto-scroll the chat to the newest message.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [convo.length, state.narration, running]);

  // Detect a build that is running server-side but is NOT attached here (its original
  // connection was lost) — so we can re-attach. Re-checks when the account loads and
  // whenever this UI goes idle.
  useEffect(() => {
    if (!running) checkRunning({ userId, email, workspaceId: expectedWorkspaceId() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, email, running, checkRunning]);

  // AUTO-RESUME on reload: when the server reports a build is still running but this
  // (freshly reloaded) UI isn't attached, re-attach automatically — the user should
  // never have to click "Resume" after a refresh. The button stays as a manual fallback.
  // Guarded so it fires once per detected running build.
  //
  // The re-arm condition below MUST also check `!running` — resumeBuild() itself clears
  // serverBuildRunning as its very first action (before the network call even resolves), so a
  // re-arm keyed on `!serverBuildRunning` alone flips autoResumedRef back to false the instant
  // resume() starts, defeating the "fires once" guard: any subsequent checkRunning() poll that
  // (re)detects the SAME still-running build (e.g. after a tab-visibility recheck) would fire a
  // brand-new resumeBuild() call moments later, silently re-attaching that old build's stream —
  // this was a real path for a just-abandoned build to reappear after "+ New chat".
  const autoResumedRef = useRef(false);
  // Layer 3 — how many times a paused (time-limit) build has been auto-continued this turn.
  // SPM-3: in project mode the decision lives in decideAutoContinue (progress-monotone on
  // planRemaining); these refs are its inputs. autoContinueRef counts deadline pauses (reset on
  // every real module progress), planContinuesRef counts plan-driven module rounds, and
  // lastPlanRemainingRef holds the previous plan result's remaining count for the strict-decrease
  // loop guard.
  const autoContinueRef = useRef(0);
  const planContinuesRef = useRef(0);
  const lastPlanRemainingRef = useRef<number | null>(null);
  useEffect(() => {
    if (serverBuildRunning && !running && !autoResumedRef.current) {
      autoResumedRef.current = true;
      void resumeBuild({ userId, email, workspaceId: expectedWorkspaceId() });
    }
    if (!serverBuildRunning && !running) autoResumedRef.current = false; // re-arm only once genuinely idle again
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverBuildRunning, running, userId, email, resumeBuild]);

  // TAB SWITCH resilience: a backgrounded tab (esp. mobile Safari) suspends timers and
  // can silently drop the event stream. When the tab becomes visible again, immediately
  // reconcile with the server — re-attach a still-running build (via the auto-resume
  // effect above) so the build never looks "stopped" after a tab switch.
  const [liveNonce, setLiveNonce] = useState(0);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (!running) checkRunning({ userId, email, workspaceId: expectedWorkspaceId() });
      setLiveNonce((n) => n + 1); // re-arm the cross-device live poll when the tab is shown again
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, userId, email, checkRunning]);

  // CROSS-DEVICE LIVE MIRROR (Slice B): while this panel is OPEN + VISIBLE and NOT running a build
  // locally, watch the shared LiveChannel so a build started on ANOTHER device shows its activity
  // here live. Cost-gated: only polls while visible, and the poller self-stops after ~30s of no
  // activity; re-armed by liveNonce on visibility. Stops the moment a local build starts (running).
  useEffect(() => {
    if (running || !userId) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    const stop = subscribeLive({ userId, email, workspaceId: expectedWorkspaceId() });
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, userId, email, subscribeLive, liveNonce]);

  // D7 — on first open with a signed-in account, re-display the most recent persisted build's
  // chat history so a refresh/reconnect doesn't lose it (option (a): chat + git-restore). Runs
  // ONCE, and only when nothing is running and the panel is still empty, so it never clobbers a
  // live build or a thread already opened from History. Best-effort.
  // Keyed to the sessionId that has ALREADY been auto-restored. (Was a never-reset boolean, which let
  // an in-flight most-recent-conversation restore re-adopt the OLD chat AFTER "+ New chat" cleared the
  // thread — the verified S1 race.) Keying it to the session means: each session auto-restores at most
  // once, AND a deliberate session switch mid-load discards the stale result so New chat stays blank.
  const autoRestoredSessionRef = useRef<string>('');
  // Fresh-open discriminator (Bugs 1/3/4/5): App bumps freshOpenNonce ONLY when the user deliberately
  // opens v3.0 from the menu/sidebar → start a brand-new chat. A hard reload restores the v3.0 view
  // WITHOUT bumping the nonce (stays 0) → this effect takes the RESTORE branch instead, bringing the
  // same project's messages/files/preview back. Each distinct nonce is handled at most once.
  const freshOpenHandledRef = useRef<number>(0);
  useEffect(() => {
    if (running || !userId || state.narration.length > 0 || userMsgs.length > 0) return;
    // ADMIN RULE (2026-07-01): opening v3.0 ALWAYS starts a brand-new chat — the previous chat is
    // NEVER auto-loaded into the box, on a plain open OR a reload. The old "restore most-recent
    // conversation" path is removed entirely, so a stuck/old chat can never reappear here. A deliberate
    // re-open (freshOpenNonce, bumped by toggleTab) still forces a clean session over any leftover
    // state. Past chats stay in the ☰ History menu (openConversation) / the History page to reopen on
    // demand — they simply never load themselves.
    if (freshOpenNonce && freshOpenHandledRef.current !== freshOpenNonce) {
      freshOpenHandledRef.current = freshOpenNonce;
      startNewSession();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, running, state.narration.length, userMsgs.length, freshOpenNonce]);

  // S4 — re-armed per workspace; the rehydrate EFFECT itself lives below loadWorkspaceFiles (declared
  // later) to avoid a temporal-dead-zone on workspaceFiles. New chat / open / resume reset it to ''.
  const rehydratedWsRef = useRef<string>('');

  // Resume a saved v3.0 conversation opened from History ("open chat"). Adopt its sessionId and
  // restore its saved thread into the chat.
  //
  // ROOT-CAUSE FIX (2026-07-02): a plain `useEffect` ALWAYS runs once on mount, and App never clears
  // `v3Resume` back to null — so after the user opened ANY chat from History once, EVERY later remount
  // (tab away/back, or ProV3Surface's loading→enabled transition) re-applied that stale value: it
  // repainted the old bubbles AND reset sessionIdRef to the OLD session id, defeating the "always mint
  // a fresh id" rule and re-attaching the old build. A component-level ref can't guard this because it
  // resets to 0 on every remount. So we track the last-applied nonce at MODULE scope (survives
  // remounts): a genuine History reopen mints a NEW nonce and still applies; a remount carrying the
  // SAME already-applied nonce is ignored, so the panel keeps its fresh session instead of reloading
  // the old chat.
  useEffect(() => {
    if (!resume || resume.nonce === lastAppliedResumeNonce) return;
    lastAppliedResumeNonce = resume.nonce;
    const sid = resume.sessionId;
    sessionIdRef.current = sid;
    persistSessionId(sid); // keep the reopened project sticky across reloads too
    autoRestoredSessionRef.current = sid; // explicit resume → mark handled (auto-restore must not override)
    rehydratedWsRef.current = '';         // re-arm file rehydrate for the resumed workspace
    reset();
    // Seed instantly from the passed thread (legacy chat_sessions copy — may be empty for sessions
    // saved after the metadata-only cutover), then replace with the SERVER transcript below: the
    // server ConversationStore is the single source of truth for what was actually said.
    setUserMsgs(resume.messages.filter((m) => m.role === 'user'));
    setAgentHistory(resume.messages.filter((m) => m.role !== 'user'));
    setCheckpointHistory([]);
    setFiles([]);
    const fetchStarted = Date.now();
    void (async () => {
      const restored = await loadConversation({ userId, email, id: `v3_${sid}` });
      // Apply only if the user hasn't already switched away meanwhile.
      if (!restored || restored.messages.length === 0 || sessionIdRef.current !== sid) return;
      // Adopt the durable framework so a reopened non-Vite session's follow-up build stays correct.
      if (restored.framework) setFramework(restored.framework);
      // REATTACH-ON-REOPEN: same as the ☰-menu open path — a build still running for this
      // session (closed mid-build) re-attaches its live stream instead of 409-ing on send.
      if (restored.workspaceId) void checkRunning({ userId, email, workspaceId: restored.workspaceId });
      // Cross-cutover continuity: if the seeded legacy thread is provably disjoint from the server
      // transcript (a pre-cutover chat continued later), keep it IN FRONT of the server messages;
      // if it overlaps (old build sessions — both stores hold copies), drop it: server wins.
      const prepend = legacyPrependMessages(
        resume.messages.map((m) => ({ text: m.text, isUser: m.role === 'user' })),
        restored.messages.map((m) => m.text),
      );
      setUserMsgs((prev) => {
        // If the user already SENT a new message while the transcript was loading (its ts is a
        // fresh epoch stamp), keep the live thread — the new turn is persisted server-side and
        // will be restored on the next open; never hide what the user just typed.
        if (prev.some((m) => m.ts >= fetchStarted)) return prev;
        return [...prepend.filter((m) => m.role === 'user'), ...restored.messages].map((m) => ({ role: 'user' as const, text: m.text, ts: m.ts }));
      });
      setAgentHistory(prepend.filter((m) => m.role !== 'user').map((m) => ({ role: 'agent' as const, text: m.text, ts: m.ts })));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resume?.nonce]);

  // Phase G1 — git as the third organ: load the DURABLE checkpoint timeline for this workspace and seed
  // it into checkpointHistory, so the History tab shows the full commit history even across sessions,
  // devices and sandbox recycles (not just this session's RAM). Runs on sign-in, on resume, and when a
  // build settles (to pick up just-persisted commits). Merged + deduped by sha; best-effort.
  useEffect(() => {
    if (!userId || !sessionIdRef.current) return;
    let cancelled = false;
    const workspaceId = state.workspaceId || `agentv3-${normalizeUid(userId)}-${sessionIdRef.current}`;
    (async () => {
      const durable = await getCheckpoints({ workspaceId, userId, email });
      if (!cancelled && durable.length > 0) {
        setCheckpointHistory((prev) => {
          const seen = new Set<string>();
          const merged: GitCheckpoint[] = [];
          // Oldest-first to match how checkpointHistory is built across turns (durable comes newest-first).
          for (const c of [...durable].reverse().concat(prev)) {
            const key = c.sha || c.id;
            if (!key || seen.has(key)) continue;
            seen.add(key);
            merged.push(c);
          }
          return merged;
        });
      }
      // Phase G2 — also pull the live working-tree git status so the History tab reflects the real
      // git organ state (clean / N uncommitted) tied to this same workspace.
      const status = await getGitStatus({ workspaceId, userId, email });
      if (!cancelled) setGitStatus(status);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, resume?.nonce, state.workspaceId, state.done, tab]);

  // HISTORY REBUILD (single source of truth, admin order 2026-07-02): the server ConversationStore
  // is the ONLY transcript writer — the client persists NO messages, ever. This effect now writes a
  // METADATA-ONLY row into chat_sessions (title/tags/lastUpdated, keyed by the stable sessionId) so
  // (a) the main sidebar History still lists v3.0 sessions and (b) sessions whose server record is
  // anon-degraded still get a list row here. It deliberately writes NO `messages` field: with
  // `{ merge: true }` an existing legacy transcript in the doc is left untouched (read-only legacy
  // data), and no client write can ever again shrink/erase a thread — the root cause of the
  // "old chat opens empty" corruption is structurally gone, not just guarded against.
  useEffect(() => {
    if (!userId || !sessionIdRef.current) return;
    // SWITCH GUARD: never write while openConversation is mid-switch — sessionIdRef still names the
    // PREVIOUS session while `convo` is already reduced, so a write here would retitle the previous
    // session's row from the wrong thread. The post-switch state change re-runs this effect safely.
    if (sessionSwitchRef.current) return;
    const firstUser = convo.find((m) => m.role === 'user')?.text;
    if (!firstUser) return; // nothing meaningful to save yet
    const title = firstUser.slice(0, 40) + (firstUser.length > 40 ? '…' : '');
    const docId = `v3_${sessionIdRef.current}`;
    setDoc(
      doc(db, 'chat_sessions', docId),
      sanitizeFirestoreData({
        id: docId,
        uci: docId,
        userId,
        tab: 'engine_builder',
        original_agent: 'agentv3',
        current_agent: 'agentv3',
        title,
        lastUpdated: new Date().toISOString(),
        mode: 'build',
      }),
      { merge: true },
    ).catch(() => { /* history save is best-effort — never blocks the UI */ });
    // Fires on the FIRST user message (userMsgs.length — so a CHAT-only session gets a row too),
    // on build start (workspaceId), completion (done), and stop/timeout (running). Writes stay
    // bounded (userMsgs.length changes only when the user sends) and idempotent (same doc, merge).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.workspaceId, state.done, running, userId, userMsgs.length]);

  // Read a File as base64 (no data: prefix); downscale large images to keep the
  // payload small and vision-optimal, exactly like the other chat surfaces.
  const fileToAttachment = (file: File): Promise<{ name: string; type: string; base64: string }> =>
    new Promise((resolve) => {
      const isImage = file.type.startsWith('image/') && file.type !== 'image/svg+xml';
      const raw = () => {
        const reader = new FileReader();
        reader.onload = () => resolve({ name: file.name, type: file.type || 'application/octet-stream', base64: (reader.result as string).split(',')[1] || '' });
        reader.onerror = () => resolve({ name: file.name, type: file.type, base64: '' });
        reader.readAsDataURL(file);
      };
      if (!isImage) return raw();
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, 1568 / Math.max(img.width, img.height));
          if (scale === 1 && file.size <= 900 * 1024) { URL.revokeObjectURL(url); return raw(); }
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          const ctx = canvas.getContext('2d');
          if (!ctx) { URL.revokeObjectURL(url); return raw(); }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(url);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          resolve({ name: file.name.replace(/\.(png|webp|gif|bmp|heic|heif)$/i, '.jpg'), type: 'image/jpeg', base64: dataUrl.split(',')[1] || '' });
        } catch { URL.revokeObjectURL(url); raw(); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); raw(); };
      img.src = url;
    });

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const MAX = 15 * 1024 * 1024; // 15MB/file
    const picked = Array.from(list).filter((f) => f.size <= MAX);
    if (picked.length > 0) setFiles((prev) => [...prev, ...picked].slice(0, 8));
  };

  // `override` — programmatic sends (the GitHub repo picker's 1-click import): supplies its own
  // text + importUrl and NEVER consumes the user's typed draft or staged attachments.
  const send = async (override?: { text: string; importUrl: string }) => {
    const text = (override?.text ?? prompt).trim();
    const sendFiles = override ? [] : files;
    if ((!text && sendFiles.length === 0) || running) return;
    // A fresh user message resets the Layer-3 auto-continue budgets for the new turn — the pause
    // budget, the plan-continue count, AND the plan-progress watermark (SPM-3), so a typed
    // "continue" after a stall starts a fresh progress-monotone chain.
    autoContinueRef.current = 0;
    planContinuesRef.current = 0;
    lastPlanRemainingRef.current = null;
    // Preserve the previous turn's agent replies BEFORE start() resets the live
    // build state — otherwise the prior reply (which lives only in state.narration)
    // disappears from the thread the moment the next message begins.
    if (state.narration.length > 0) {
      setAgentHistory((h) => [
        ...h,
        ...state.narration.map((n) => ({
          role: 'agent' as const,
          agent: n.agent,
          text: n.text,
          ts: n.ts,
          kind: n.kind,
        })),
      ]);
    }
    // Also preserve this turn's git checkpoints before start() resets them.
    if (state.checkpoints.length > 0) {
      setCheckpointHistory((h) => [...h, ...state.checkpoints]);
    }
    const attachments = sendFiles.length > 0 ? await Promise.all(sendFiles.map(fileToAttachment)) : undefined;
    // A file with no text gets a sensible default prompt (the server requires one).
    const msgText = text || (sendFiles.length > 0 ? `Please read and analyze the attached file(s): ${sendFiles.map((f) => f.name).join(', ')}` : '');
    const displayText = text || `📎 ${sendFiles.map((f) => f.name).join(', ')}`;
    setUserMsgs((c) => [...c, { role: 'user', text: displayText, ts: Date.now() }]);
    if (!override) {
      setPrompt('');
      setFiles([]);
    }
    const pendingImportUrl = (override?.importUrl ?? importUrl).trim();
    if (!override) setImportUrl(''); // consume the set-by-hand import URL on first send
    // Phase S3 conflict guard: flush any pending IDE edits to v3.0's durable store BEFORE the build
    // starts, so the build reads the user's latest hand edits — never a stale file set. Best-effort:
    // a flush failure must never block the build (the syncer swallows its own errors).
    try { await onBeforeBuild?.(); } catch { /* flush is best-effort */ }
    start(msgText, { userId, email, onlyOpus, powerLevel, planFirst, thinking, sessionId: sessionIdRef.current, attachments, framework, importUrl: pendingImportUrl || undefined });
  };

  // ── Layer 3: bounded auto-continue ──────────────────────────────────────────────
  // When a build ends `resumable`, automatically resume the SAME project without the user typing
  // "continue". Two shapes share one pure decision (decideAutoContinue): a wall-clock PAUSE keeps
  // the classic small pause budget (a genuinely stuck build can never loop or rack up unbounded
  // cost), while a project-mode MODULE turn (SPM-3, `planRemaining` on the result) continues for
  // as long as the plan STRICTLY advances — so a 40-module software project runs unattended, but
  // a stalled plan hands back honestly. Reuses the proven resume path (start('continue', …)).
  useEffect(() => {
    if (!state.done || !state.resumable || running) return;
    // SPM-3: one pure decision for both loops — the classic bounded deadline-pause continue AND
    // the project-mode module chain (continues only while planRemaining strictly decreases, with
    // a fresh pause budget per completed module and an absolute backstop).
    const decision = decideAutoContinue({
      planRemaining: state.planRemaining,
      lastPlanRemaining: lastPlanRemainingRef.current,
      pauseContinues: autoContinueRef.current,
      planContinues: planContinuesRef.current,
    });
    if (typeof state.planRemaining === 'number') lastPlanRemainingRef.current = state.planRemaining;
    if (!decision.proceed) {
      if (decision.stopMessage) {
        setAgentHistory((h) => [
          ...h,
          { role: 'agent' as const, agent: 'architect', text: decision.stopMessage as string, ts: Date.now() },
        ]);
      }
      return;
    }
    if (decision.isPlanContinue) planContinuesRef.current += 1;
    if (decision.resetPauseBudget) autoContinueRef.current = 0;
    else autoContinueRef.current += 1;
    // Preserve the paused turn's replies into history before start() resets the live state.
    if (state.narration.length > 0) {
      setAgentHistory((h) => [
        ...h,
        ...state.narration.map((n) => ({ role: 'agent' as const, agent: n.agent, text: n.text, ts: n.ts, kind: n.kind })),
      ]);
    }
    if (state.checkpoints.length > 0) setCheckpointHistory((h) => [...h, ...state.checkpoints]);
    start('continue', { userId, email, onlyOpus, powerLevel, planFirst, thinking, sessionId: sessionIdRef.current, framework });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.done, state.resumable, running]);

  // Start a brand-new project: fresh sandbox/memory (new session id) and clear chat. Allowed even
  // while a build is actively streaming HERE — reset() detaches from that stream (the underlying
  // server build, if any, keeps running in the background and stays resumable from History) instead
  // of blocking navigation until the build finishes. Root-caused 2026-07-01: "+ New chat"/history
  // items used to silently no-op (`if (running) return`) for as long as the current session's build
  // was in progress — with auto-resume now correctly reattaching to a genuinely long build, this made
  // the panel look permanently "stuck" on whatever chat had an active build.
  const startNewSession = () => {
    sessionIdRef.current = newSessionId();
    persistSessionId(sessionIdRef.current); // the new project is now the sticky one across reloads
    autoRestoredSessionRef.current = sessionIdRef.current; // mark handled → auto-restore won't load the old chat over this blank one
    rehydratedWsRef.current = '';            // re-arm file rehydrate for the new (empty) workspace
    setWorkspaceFiles(null);
    setWorkspaceFilesFor(null); // clear the stale-switch tag so the new workspace's files load
    setSelectedFile(null);
    setUserMsgs([]);
    setAgentHistory([]);
    setCheckpointHistory([]);
    setFiles([]);
    reset();
  };

  // History menu: list this account's saved v3.0 chats and open any of them. Because conversations
  // are stored per-USER in Firestore (not per device), the same list — and continuing the SAME
  // project/memory — works from any device the user signs in on (Claude-style continuity).
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<ConversationMeta[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [deletingHistoryId, setDeletingHistoryId] = useState<string | null>(null);
  // LOUD open-failure: opening a history chat must NEVER silently do nothing (the admin read the
  // resulting no-op as "click hi nahi ho raha"). Any failed open sets this and a dismissible toast
  // shows the real reason.
  const [openChatError, setOpenChatError] = useState<string | null>(null);
  // TAP TRACER (diagnostic, admin-only via ?tapdebug=1 or localStorage nbai_tapdebug=1): the history
  // menu taps are reported dead on iPhone even after the rows became real <button>s, so hypotheses are
  // exhausted — this captures ground truth from the device itself. While the menu is open it listens
  // in CAPTURE phase on window (so it sees the event no matter which element wins the tap) for
  // touchstart/pointerdown/click and shows, inside the menu, WHICH element is topmost at the tap
  // point (document.elementFromPoint). One screenshot then names the tap-eater — or proves the click
  // fires and the fault is downstream. Zero cost unless the flag is on AND the menu is open.
  const [tapDebug] = useState<boolean>(() => {
    try {
      return new URLSearchParams(window.location.search).has('tapdebug') || localStorage.getItem('nbai_tapdebug') === '1';
    } catch { return false; }
  });
  const [lastTap, setLastTap] = useState('');
  useEffect(() => {
    if (!tapDebug || !historyOpen) return;
    const describe = (el: Element | null): string => {
      if (!el) return 'nothing';
      const cls = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 3).join('.');
      return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls ? `.${cls}` : ''}`.slice(0, 90);
    };
    const at = (x: number, y: number, kind: string) =>
      setLastTap(`${kind}@${Math.round(x)},${Math.round(y)} → ${describe(document.elementFromPoint(x, y))}`);
    const onTouch = (e: TouchEvent) => { const t = e.touches[0]; if (t) at(t.clientX, t.clientY, 'touch'); };
    const onPointer = (e: PointerEvent) => at(e.clientX, e.clientY, 'down');
    const onClick = (e: MouseEvent) => setLastTap((prev) => `${prev} | click→${describe(e.target as Element)}`.slice(-180));
    window.addEventListener('touchstart', onTouch, true);
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('touchstart', onTouch, true);
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('click', onClick, true);
    };
  }, [tapDebug, historyOpen]);
  // READ-ONLY legacy transcripts (keyed by sessionId), stashed at list time. Since the
  // single-source-of-truth cutover the client writes NO messages — new chat_sessions rows are
  // metadata-only and the server ConversationStore holds every transcript. This stash exists purely
  // so PRE-cutover sessions (whose thread lives only in the frozen doc copy) still open with their
  // messages. It is never written back. See loadHistory + openConversation.
  const chatSessionMsgsRef = useRef<Map<string, Array<{ text: string; sender?: string; role?: string; timestamp?: string; ts?: number }>>>(new Map());
  // True while openConversation is switching sessions — blocks the chat_sessions save effect from
  // firing mid-switch (stale sessionIdRef + already-reduced convo), which used to OVERWRITE the
  // previous chat's saved doc with a shrunken thread. That gradual erasure is why old chats opened
  // empty ("history open nahi ho rahi").
  const sessionSwitchRef = useRef(false);
  // Reusable loader so both the initial open AND the "Try again" retry button can
  // re-fetch without duplicating the fetch/loading-state logic.
  //
  // Two sources are merged so EVERY v3.0 session shows: (1) the server conversation store
  // (/api/agentv3/conversations) — the single source of truth for transcripts, but its LIST is
  // keyed to the verified uid, so sessions persisted while identity degraded to anon don't list
  // there; and (2) the Firestore `chat_sessions` metadata rows (`v3_<sessionId>`), which this
  // panel writes for every session and which cover exactly that gap (opening resolves the server
  // record via candidate ids). Dedup by sessionId, preferring the server record when both exist.
  const loadHistory = async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const { items, error: loadErr } = await listConversations({ userId, email });

      // Pull this account's v3.0 sessions from chat_sessions (client SDK) — the reliable superset.
      let chatItems: ConversationMeta[] = [];
      chatSessionMsgsRef.current.clear();
      const prefix = `agentv3-${normalizeUid(userId)}-`;
      if (userId) {
        try {
          const snap = await getDocs(query(collection(db, 'chat_sessions'), where('userId', '==', userId)));
          chatItems = snap.docs
            .filter((d) => {
              const data = d.data() as any;
              return d.id.startsWith('v3_') || data?.tab === 'engine_builder'
                || data?.current_agent === 'agentv3' || data?.original_agent === 'agentv3';
            })
            .map((d) => {
              const data = d.data() as any;
              const sessionId = d.id.replace(/^v3_/, '');
              chatSessionMsgsRef.current.set(sessionId, Array.isArray(data.messages) ? data.messages : []);
              return {
                id: d.id,
                title: data.title || 'Untitled build',
                status: (data.status as string) || 'complete',
                workspaceId: `${prefix}${sessionId}`,
                updatedAt: data.lastUpdated ? (Date.parse(data.lastUpdated) || 0) : 0,
                // Marked when a previous open PROVED this pre-rebuild session's transcript is gone
                // everywhere — rendered honestly as lost instead of a chat that "won't open".
                deadTranscript: data.deadTranscript === true,
              } as ConversationMeta;
            });
        } catch { /* best-effort — the conversation-store list still shows below */ }
      }

      const sidOf = (c: ConversationMeta) =>
        (c.workspaceId && c.workspaceId.startsWith(prefix)) ? c.workspaceId.slice(prefix.length) : c.id;
      const bySession = new Map<string, ConversationMeta>();
      for (const c of chatItems) bySession.set(sidOf(c), c);   // baseline: every saved v3.0 session
      for (const c of items) bySession.set(sidOf(c), c);        // richer conversation-store record wins
      const merged = [...bySession.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

      setHistoryItems(merged);
      // Only surface the conversation-store error when it produced NOTHING to show — if chat_sessions
      // gave us the history, a transient store error must not blank the list with a scary message.
      setHistoryError(merged.length > 0 ? null : (loadErr ?? null));
    } finally {
      setHistoryLoading(false);
    }
  };
  const toggleHistory = async () => {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (next) await loadHistory();
  };
  // Open a specific saved conversation: load its thread + plan, and adopt its sessionId so a
  // follow-up continues THAT exact workspace/memory (same as the auto-restore of the most recent).
  // Allowed even while a build is actively streaming HERE — loadConversation() detaches from it (the
  // underlying server build, if any, keeps running in the background and stays resumable from History)
  // instead of silently no-op'ing until the current build finishes.
  const openConversation = async (id: string) => {
    setOpenChatError(null);
    if (tapDebug) setLastTap((prev) => `${prev} | openConversation(${id.slice(0, 24)}…) FIRED`.slice(-180));
    // SWITCH GUARD: while a session switch is in flight, the chat_sessions save effect must NOT
    // run — after the clears below commit, sessionIdRef still points at the PREVIOUS session while
    // `convo` is already reduced, so the effect used to overwrite the previous chat's saved doc
    // with a shrunken thread (AI replies erased). That day-long, gradual corruption is why old
    // chats opened EMPTY. The finally below re-arms saving once the new session is fully adopted.
    sessionSwitchRef.current = true;
    setHistoryOpen(false);
    try {
      // DETACH the current build first (same as startNewSession): reset() aborts this UI's stream,
      // clears `running` (so the opened chat's composer is enabled, not stuck disabled) and bumps the
      // generation guard so the abandoned build can't re-attach over the one being opened. The server
      // build, if any, keeps running in the background and stays resumable from History — nothing is
      // killed. Without this, opening a chat during a (possibly stuck) build left `running` true and
      // the old stream still writing into the newly-opened session.
      reset();
      setWorkspaceFiles(null);
      setWorkspaceFilesFor(null); // clear the stale-switch tag so the new workspace's files load
      setSelectedFile(null);
      setAgentHistory([]);
      setCheckpointHistory([]);
      setFiles([]);
      const restored = await loadConversation({ userId, email, id });
      if (restored) {
        if (restored.workspaceId) {
          // The server may resolve a v3_ entry to its ANON-degraded workspace (agentv3-anon-<sid>) —
          // adopt the session id from EITHER prefix so a follow-up continues that exact project.
          for (const prefix of [`agentv3-${normalizeUid(userId)}-`, 'agentv3-anon-']) {
            if (restored.workspaceId.startsWith(prefix)) {
              const sid = restored.workspaceId.slice(prefix.length);
              if (sid) { sessionIdRef.current = sid; persistSessionId(sid); }
              break;
            }
          }
        }
        autoRestoredSessionRef.current = sessionIdRef.current; // explicit open → mark handled so auto-restore can't swap in the most-recent chat
        rehydratedWsRef.current = '';                          // re-arm file rehydrate for the opened workspace
        // Adopt the session's durable framework so a follow-up build/edit/deploy on a reopened
        // non-Vite session doesn't silently reset to vite-react (the framework-reset defect).
        if (restored.framework) setFramework(restored.framework);
        // REATTACH-ON-REOPEN (test #5): if THIS session's build is still running server-side (the
        // user closed the tab/browser mid-build — the build keeps going by design), detect it now
        // so the auto-resume effect re-attaches its live stream immediately — instead of the user
        // discovering it via a "build already running" error when they try to type.
        if (restored.workspaceId) void checkRunning({ userId, email, workspaceId: restored.workspaceId });
        // Cross-cutover continuity: a pre-cutover session continued after the server became the
        // only transcript writer has its old turns ONLY in the frozen legacy chat_sessions copy.
        // When that legacy copy is provably disjoint from the server transcript, show it in front;
        // when it overlaps (old build sessions — copies in both stores), the server transcript wins.
        const legacy = chatSessionMsgsRef.current.get(sessionIdRef.current) ?? [];
        const legacyIsUser = (m: { sender?: string; role?: string }) => m.sender === 'user' || m.role === 'user';
        const legacyTs = (m: { timestamp?: string; ts?: number }) => m.ts ?? (m.timestamp ? (Date.parse(m.timestamp) || Date.now()) : Date.now());
        if (restored.messages.length > 0) {
          const prepend = legacyPrependMessages(
            legacy.map((m) => ({ text: m.text, isUser: legacyIsUser(m) })),
            restored.messages.map((m) => m.text),
          );
          setUserMsgs([
            ...prepend.filter((m) => m.role === 'user'),
            ...restored.messages,
          ].map((m) => ({ role: 'user' as const, text: m.text, ts: m.ts })));
          setAgentHistory(prepend.filter((m) => m.role !== 'user').map((m) => ({ role: 'agent' as const, text: m.text, ts: m.ts })));
        } else if (legacy.length > 0) {
          // The server record exists but returned no visible thread — the frozen legacy copy still
          // has it (pre-cutover session). Restore from it, read-only.
          setUserMsgs(legacy.filter(legacyIsUser).map((m) => ({ role: 'user' as const, text: m.text, ts: legacyTs(m) })));
          setAgentHistory(legacy.filter((m) => !legacyIsUser(m)).map((m) => ({ role: 'agent' as const, text: m.text, ts: legacyTs(m) })));
        } else {
          setUserMsgs([]);
          // The record exists but its thread is empty — opening it must not LOOK like a dead click.
          const why = conversationLoadDiag();
          if (why) console.error('[v3-open] empty transcript:', why);
          setOpenChatError(
            'This chat opened, but its saved transcript is empty (an earlier session-switch bug could erase saved messages — now fixed). Your project files and memory are safe: send a message to continue this project.'
            + (why ? `\n\nDiagnostic (send this to support): ${why}` : ''),
          );
        }
        return;
      }
      // FALLBACK: no server record — a PRE-cutover chat session (the plain-chat lane only started
      // persisting server-side at the single-source-of-truth cutover). Adopt its sessionId and
      // restore the frozen legacy thread stashed at list time (read-only); files rehydrate
      // automatically from the derived workspaceId (S4 effect).
      const sessionId = id.replace(/^v3_/, '');
      const saved = chatSessionMsgsRef.current.get(sessionId);
      if (!saved || saved.length === 0) {
        // NEVER a silent no-op (an empty [] stash is exactly as dead as a missing one): the tap DID
        // work and the open FAILED/restored nothing — say so, with the REAL server reason so this is
        // diagnosable in one click (404 = no transcript stored; 403 = ownership/token; empty = 0 turns).
        const why = conversationLoadDiag();
        if (why) console.error('[v3-open] could not restore:', why, 'id=', id);
        setOpenChatError(
          (saved
            ? 'This is an OLD chat from before the history fix — its messages were destroyed by the earlier bug and cannot be recovered. It is now marked "Transcript lost" in the list. Your project files and memory are safe; every chat from today onward is saved permanently. Send a message to continue this project.'
            : 'This chat could not be opened: its saved transcript was not returned by the server (it may belong to a different sign-in state) and no local copy was stashed. Pull down to refresh, sign in again, or send a new message to continue the project.')
          + (why ? `\n\nDiagnostic (send this to support): ${why}` : ''),
        );
        if (saved) {
          // PROVABLY dead: no server record under any candidate id AND the legacy copy is empty —
          // a pre-rebuild session the old eraser destroyed. Mark the row durably (metadata field —
          // the single-writer rule only forbids transcript writes) so the list stops presenting it
          // as an ordinary chat that mysteriously "won't open" on every future visit.
          void setDoc(doc(db, 'chat_sessions', `v3_${sessionId}`), { deadTranscript: true }, { merge: true })
            .catch(() => { /* best-effort */ });
          setHistoryItems((prev) => prev.map((item) => (
            item.id === `v3_${sessionId}` || item.id === id ? { ...item, deadTranscript: true } : item
          )));
          // Still adopt the session so "send a message to continue" genuinely continues THIS project.
          sessionIdRef.current = sessionId;
          persistSessionId(sessionId);
          autoRestoredSessionRef.current = sessionId;
          rehydratedWsRef.current = '';
        }
        return;
      }
      sessionIdRef.current = sessionId;
      persistSessionId(sessionId);
      autoRestoredSessionRef.current = sessionId;
      rehydratedWsRef.current = '';
      const toTs = (m: { timestamp?: string; ts?: number }) => m.ts ?? (m.timestamp ? (Date.parse(m.timestamp) || Date.now()) : Date.now());
      const isUser = (m: { sender?: string; role?: string }) => m.sender === 'user' || m.role === 'user';
      setUserMsgs(saved.filter(isUser).map((m) => ({ role: 'user' as const, text: m.text, ts: toTs(m) })));
      setAgentHistory(saved.filter((m) => !isUser(m)).map((m) => ({ role: 'agent' as const, text: m.text, ts: toTs(m) })));
    } finally {
      sessionSwitchRef.current = false;
    }
  };
  const newChatFromHistory = () => { setHistoryOpen(false); startNewSession(); };
  // Delete a saved session from the history list. Confirms first (destructive + irreversible —
  // the Firestore record and its transcript are gone). If the deleted session is the one currently
  // open, starts a fresh session so the panel never keeps showing a chat that no longer exists.
  const handleDeleteConversation = async (e: React.MouseEvent, c: ConversationMeta) => {
    e.stopPropagation();
    if (deletingHistoryId) return;
    if (!window.confirm(`Delete "${c.title || 'Untitled chat'}"? This cannot be undone.`)) return;
    setDeletingHistoryId(c.id);
    try {
      const ok = await deleteConversation(c.id, { userId, email });
      if (ok) {
        // Also remove the chat_sessions row (list metadata + any frozen legacy transcript copy)
        // so the deleted session can't ghost back into either history list. Best-effort — the
        // server record (the source of truth) is already gone.
        const anonPrefix = 'agentv3-anon-';
        const ownPrefix = `agentv3-${normalizeUid(userId)}-`;
        const sid = c.workspaceId?.startsWith(ownPrefix) ? c.workspaceId.slice(ownPrefix.length)
          : c.workspaceId?.startsWith(anonPrefix) ? c.workspaceId.slice(anonPrefix.length)
          : c.id.replace(/^v3_/, '');
        void deleteDoc(doc(db, 'chat_sessions', `v3_${sid}`)).catch(() => { /* best-effort */ });
        chatSessionMsgsRef.current.delete(sid);
        setHistoryItems((prev) => prev.filter((item) => item.id !== c.id && item.id !== `v3_${sid}`));
        if (c.workspaceId && c.workspaceId === state.workspaceId) startNewSession();
      }
    } finally {
      setDeletingHistoryId(null);
    }
  };
  const relTime = (ts?: number): string => {
    if (!ts || typeof ts !== 'number') return '';
    const m = Math.floor((Date.now() - ts) / 60000);
    if (m < 1) return 'now';
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
  };

  // Header tab pill: tapping a surface opens the workspace on it; tapping the
  // already-active pill collapses the workspace back to full-width chat.
  const openTab = (t: SurfaceTab) => {
    if (showWorkspace && tab === t) {
      setShowWorkspace(false);
      return;
    }
    setTab(t);
    setShowWorkspace(true);
  };
  const anyToggleOn = planFirst || thinking || onlyOpus;

  // Portability / no-lock-in (Phase 4): export the WHOLE project as a real .zip the user owns and
  // can open in any editor or host anywhere. Pulls the live file contents from the sandbox (the
  // file explorer only carries paths) and zips them in-browser — no server round-trip beyond the
  // existing read endpoint. Honest about failures; never silent.
  const [exporting, setExporting] = useState(false);
  const downloadProjectZip = async () => {
    if (exporting) return;
    const wsId = state.workspaceId;
    if (!wsId) { alert('Open or build a project first — there is nothing to export yet.'); return; }
    setExporting(true);
    try {
      const res = await fetch('/api/agentv3/workspace-files', {
        method: 'POST',
        headers: await authJsonHeaders(),
        body: JSON.stringify({ workspaceId: wsId, userId, email }),
      });
      if (!res.ok) throw new Error(`server returned ${res.status}`);
      const data = await res.json() as { files?: Record<string, string> };
      const files = data.files ?? {};
      const paths = Object.keys(files);
      if (paths.length === 0) { alert('No files found to export yet — build something first.'); return; }
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      // Skip heavy generated dirs so the archive is the SOURCE the user actually owns.
      const EXCLUDED = /^(node_modules\/|\.git\/|dist\/|build\/|\.next\/|__pycache__\/)/;
      for (const p of paths) {
        if (EXCLUDED.test(p)) continue;
        zip.file(p, files[p] ?? '');
      }
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `navbharatai-project-${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      alert(`Export failed: ${e instanceof Error ? e.message : String(e)}. Please try again.`);
    } finally {
      setExporting(false);
    }
  };

  // Download the LAST build's diagnostics report (every issue v3.0 hit — provider fallbacks,
  // tool errors, "replied without building" nudges, readiness blockers, sandbox problems) as
  // JSON, so the admin can hand it to Claude and the rough edges get fixed in code.
  const [downloadingDiag, setDownloadingDiag] = useState(false);
  // Resolve the freshest diagnostics report. Prefer the SERVER copy: it is durable (survives a Cloud
  // Run instance rotation / reload, #657) AND fresher than the client's build-end copy — crucially it
  // carries PREVIEW errors captured AFTER the build finished (#666), which the client copy never sees.
  // Fall back to the client's local copy only if the server has nothing (e.g. a stream that dropped
  // mid-build before the durable save).
  // P-REPORT.4 — history: which past build's report to read instead of "latest" (null = latest).
  // Lets a small/quick recent build never permanently hide a previous, richer report.
  const [selectedHistoryBuildId, setSelectedHistoryBuildId] = useState<string | null>(null);
  const [historyReportOpen, setHistoryReportOpen] = useState(false);
  const [historyReportItems, setHistoryReportItems] = useState<Array<{ id: string; startedAt: number; endedAt?: number; ok?: boolean; rootCause?: string }>>([]);
  const [historyReportLoading, setHistoryReportLoading] = useState(false);
  const toggleHistoryReport = async () => {
    const next = !historyReportOpen;
    setHistoryReportOpen(next);
    if (next && state.workspaceId) {
      setHistoryReportLoading(true);
      try {
        const params = new URLSearchParams({ workspaceId: state.workspaceId, history: '1' });
        if (userId) params.set('userId', userId);
        if (email) params.set('email', email);
        const res = await fetch(`/api/agentv3/diagnostics?${params.toString()}`, { headers: await authJsonHeaders() });
        const data = await res.json().catch(() => ({}));
        setHistoryReportItems(Array.isArray(data?.history) ? data.history : []);
      } catch { setHistoryReportItems([]); }
      finally { setHistoryReportLoading(false); }
    }
  };

  const getLatestDiagnostics = useCallback(async (buildId?: string | null): Promise<unknown> => {
    try {
      const params = new URLSearchParams();
      if (userId) params.set('userId', userId);
      if (email) params.set('email', email);
      if (state.workspaceId) params.set('workspaceId', state.workspaceId);
      if (buildId) params.set('buildId', buildId);
      const res = await fetch(`/api/agentv3/diagnostics?${params.toString()}`, { headers: await authJsonHeaders() });
      if (res.ok) {
        const data = await res.json() as { diagnostics?: unknown };
        if (data.diagnostics) return data.diagnostics;
      }
    } catch { /* fall through to the local copy */ }
    return buildId ? null : (state.diagnostics ?? null); // the local copy is only ever "latest"
  }, [userId, email, state.workspaceId, state.diagnostics]);

  const downloadDiagnostics = async () => {
    if (downloadingDiag) return;
    setDownloadingDiag(true);
    try {
      const diagnostics = await getLatestDiagnostics(selectedHistoryBuildId);
      if (!diagnostics) { alert('No build report yet — build an app first, then download the report.'); return; }
      const blob = new Blob([JSON.stringify(diagnostics, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `navbharatai-v3-build-diagnostics-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      alert(`Could not download the report: ${e instanceof Error ? e.message : String(e)}.`);
    } finally {
      setDownloadingDiag(false);
    }
  };

  // Download the FULL human/Claude-readable text render (root cause first, problems-only, plus the
  // complete AI Diagnosis Bundle — sandbox commands, LLM I/O, preview errors, reviewer's full findings)
  // instead of raw JSON. Server-rendered (renderDiagnosticsText) so the client never re-implements the
  // same formatting.
  const [downloadingDiagText, setDownloadingDiagText] = useState(false);
  const downloadDiagnosticsText = async () => {
    if (downloadingDiagText || !state.workspaceId) return;
    setDownloadingDiagText(true);
    try {
      const params = new URLSearchParams({ workspaceId: state.workspaceId, format: 'text' });
      if (userId) params.set('userId', userId);
      if (email) params.set('email', email);
      // Default download = the WHOLE session (every build 0 → last, stitched together) so the report is
      // the complete "kaccha chittha", not just the last message's build. A specific build picked from
      // the history list still downloads only that one.
      if (selectedHistoryBuildId) params.set('buildId', selectedHistoryBuildId);
      else params.set('scope', 'session');
      const res = await fetch(`/api/agentv3/diagnostics?${params.toString()}`, { headers: await authJsonHeaders() });
      if (!res.ok) { alert('No build report yet — build an app first, then download the report.'); return; }
      const text = await res.text();
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `navbharatai-v3-build-diagnostics-${Date.now()}.txt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      alert(`Could not download the report: ${e instanceof Error ? e.message : String(e)}.`);
    } finally {
      setDownloadingDiagText(false);
    }
  };

  // One-tap COPY of the build report to the clipboard — so it can be pasted straight into a support
  // chat without the download → find-file → upload dance. Uses the same client copy / durable
  // server fallback as the download. Leads with a short, READABLE summary (root cause + the real
  // problems only, no tool-call/heartbeat noise) before the full JSON, so pasting it into chat is
  // useful at a glance — not just a wall of raw data.
  const [copyingDiag, setCopyingDiag] = useState(false);
  const copyDiagnostics = async () => {
    if (copyingDiag || !state.workspaceId) { if (!state.workspaceId) alert('No build report yet — build an app first.'); return; }
    setCopyingDiag(true);
    try {
      // Copy the SAME full readable report the Text download produces — the whole session (0 → last)
      // by default, or one specific build when picked from history. Complete + human/Claude-readable,
      // so it can be pasted straight into a chat to hand off the entire "kaccha chittha".
      const params = new URLSearchParams({ workspaceId: state.workspaceId, format: 'text' });
      if (userId) params.set('userId', userId);
      if (email) params.set('email', email);
      if (selectedHistoryBuildId) params.set('buildId', selectedHistoryBuildId);
      else params.set('scope', 'session');
      const res = await fetch(`/api/agentv3/diagnostics?${params.toString()}`, { headers: await authJsonHeaders() });
      if (!res.ok) { alert('No build report yet — build an app first.'); return; }
      const text = await res.text();
      await navigator.clipboard.writeText(text);
      alert('Full build report copied — paste it into the chat to share it.');
    } catch (e) {
      alert(`Could not copy the report: ${e instanceof Error ? e.message : String(e)}.`);
    } finally {
      setCopyingDiag(false);
    }
  };

  // R5 §5.1 — the app's permanent LIVE deployment URL (Firebase Hosting). Restored durably from the
  // server so it survives a reconnect/new session, not just the current build stream.
  const [liveUrl, setLiveUrl] = useState<string | null>(null);

  // Fetch the persisted live URL whenever the workspace changes or a build/deploy finishes.
  useEffect(() => {
    const wsId = state.workspaceId;
    if (!wsId) return;
    let cancelled = false;
    void (async () => {
      try {
        const params = new URLSearchParams({ workspaceId: wsId });
        if (userId) params.set('userId', userId);
        if (email) params.set('email', email);
        const res = await fetch(`/api/agentv3/deployment?${params.toString()}`, { headers: await authJsonHeaders() });
        const data = await res.json().catch(() => ({}));
        if (!cancelled && typeof data?.url === 'string' && data.url) setLiveUrl(data.url);
      } catch { /* best-effort — no live URL shown */ }
    })();
    return () => { cancelled = true; };
  }, [state.workspaceId, state.done, userId, email]);

  // R5 §5.1 (no lock-in) — the hosting providers available + which the user picked. Fetched once;
  // only CONFIGURED providers are offered so a deploy can never target an unconfigured host.
  const [providers, setProviders] = useState<Array<{ id: string; name: string; configured: boolean; requirement: string }>>([]);
  const [deployProvider, setDeployProvider] = useState<string>('firebase');
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const params = new URLSearchParams();
        if (userId) params.set('userId', userId);
        if (email) params.set('email', email);
        try { if (localStorage.getItem('gh_token')) params.set('hasGithub', 'true'); } catch { /* ignore */ }
        const res = await fetch(`/api/agentv3/deploy-providers?${params.toString()}`);
        const data = await res.json().catch(() => ({}));
        if (!cancelled && Array.isArray(data?.providers)) {
          setProviders(data.providers);
          if (typeof data.default === 'string') setDeployProvider(data.default);
        }
      } catch { /* best-effort — default to Firebase */ }
    })();
    return () => { cancelled = true; };
  }, [userId, email]);
  const configuredProviders = providers.filter((p) => p.configured);

  // One-click deploy: drive the REAL build+deploy pipeline (the agent runs `npm run build` then the
  // deploy tool, publishing to the CHOSEN provider's permanent public URL). Routed through the normal
  // stream so the user watches real progress; the live URL is then refreshed from the server.
  const deployLive = () => {
    if (running || !state.workspaceId) return;
    if (state.narration.length > 0) {
      setAgentHistory((h) => [...h, ...state.narration.map((n) => ({ role: 'agent' as const, agent: n.agent, text: n.text, ts: n.ts, kind: n.kind }))]);
    }
    if (state.checkpoints.length > 0) setCheckpointHistory((h) => [...h, ...state.checkpoints]);
    const providerName = configuredProviders.find((p) => p.id === deployProvider)?.name || 'a live URL';
    setUserMsgs((c) => [...c, { role: 'user', text: `🚀 Deploy to ${providerName}`, ts: Date.now() }]);
    start(
      'Deploy this app to a permanent public live URL. Run "npm run build" first, then call the deploy tool, and finish by giving me the live link.',
      { userId, email, onlyOpus, powerLevel, planFirst: false, thinking, sessionId: sessionIdRef.current, framework, deployProvider },
    );
  };

  // "Restore all files" — genuinely bring the whole project back into the workspace (the server
  // writes the durably-saved files back in), then show the real file list. Honest status, no fake.
  const [restoring, setRestoring] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState<string>('');
  const handleRestoreAll = async () => {
    if (restoring || !state.workspaceId) return;
    setRestoring(true);
    setRestoreMsg('');
    try {
      const r = await restoreAllFiles();
      if (!r.ok) { setRestoreMsg('Could not restore — please try again in a moment.'); return; }
      if (r.count === 0) { setRestoreMsg('No saved files found to restore for this project yet.'); return; }
      setRestoreMsg(r.restored ? `Restored ${r.count} file(s) into your workspace.` : `${r.count} file(s) are in your workspace.`);
      setTab('files');
      setShowWorkspace(true);
    } finally {
      setRestoring(false);
    }
  };

  // ── File-content viewer + sidebar sync ────────────────────────────────────
  // The Files surface only carries paths (state.files); the actual contents live
  // in the sandbox. We pull them on demand from the existing read endpoint, cache
  // them, and reuse the same map both to (a) show a file's content when clicked
  // and (b) sync the built project into the main app's Files view (onFilesSync).
  const [workspaceFiles, setWorkspaceFiles] = useState<Record<string, string> | null>(null);
  // Which workspaceId the cached `workspaceFiles` belong to. Guards a race: on a fast session switch,
  // an in-flight load for the OLD workspace could set `workspaceFiles`, then the rehydrate effect would
  // see it non-null and skip loading the NEW workspace — leaving stale files visible. Comparing this to
  // the current workspace makes the guard workspace-specific.
  const [workspaceFilesFor, setWorkspaceFilesFor] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string>('');
  // Heavy generated dirs are never shown/synced — the user cares about source.
  const FILE_EXCLUDE = /^(node_modules\/|\.git\/|dist\/|build\/|\.next\/|__pycache__\/)/;

  const loadWorkspaceFiles = async (wsIdArg?: string): Promise<Record<string, string> | null> => {
    // On a COLD reopen there is no live build yet, so state.workspaceId is empty — derive the durable
    // workspaceId from the session so files still rehydrate from storage (the server falls back to the
    // saved file store when the sandbox is cold). An explicit arg wins (the rehydrate effect passes it).
    const wsId = wsIdArg || state.workspaceId || (userId && sessionIdRef.current ? `agentv3-${normalizeUid(userId)}-${sessionIdRef.current}` : '');
    if (!wsId) return null;
    try {
      const res = await fetch('/api/agentv3/workspace-files', {
        method: 'POST',
        headers: await authJsonHeaders(),
        body: JSON.stringify({ workspaceId: wsId, userId, email }),
      });
      if (!res.ok) throw new Error(`server returned ${res.status}`);
      const data = await res.json() as { files?: Record<string, string> };
      const files = data.files ?? {};
      setWorkspaceFiles(files);
      setWorkspaceFilesFor(wsId); // tag which workspace these files belong to (stale-switch guard)
      return files;
    } catch (e) {
      setFileError(e instanceof Error ? e.message : 'Failed to load file contents');
      return null;
    }
  };

  // Open a file in the viewer — fetch contents once, then read from cache.
  const openFile = async (path: string) => {
    setSelectedFile(path);
    setFileError('');
    if (workspaceFiles && path in workspaceFiles) return;
    setFileLoading(true);
    await loadWorkspaceFiles();
    setFileLoading(false);
  };

  // Sidebar sync (Task 2): when a build finishes, pull the real file contents and
  // push the source files up so they also appear in the app's main Files view.
  useEffect(() => {
    if (!state.done || !state.workspaceId || state.files.length === 0) return;
    let cancelled = false;
    loadWorkspaceFiles().then((files) => {
      if (cancelled || !files || !onFilesSync) return;
      const source = Object.fromEntries(
        Object.entries(files).filter(([p]) => !FILE_EXCLUDE.test(p)),
      );
      if (Object.keys(source).length > 0) onFilesSync(source);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.done, state.workspaceId]);

  // Lift the v3.0 preview state (live URL + workspace) up to the app shell so the MAIN slide-out
  // "Preview" menu can render the SAME working v3.0 preview — not the retired v2.0 generatedCode.
  // `framework`/`running` are ALSO lifted (2026-07-01) so the sidebar's PreviewSurface can reach full
  // feature parity with this in-panel one (auto-resume + framework-aware Diagnose need them).
  useEffect(() => {
    onPreviewState?.({ previewUrl: state.previewUrl, workspaceId: state.workspaceId, framework, running });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.previewUrl, state.workspaceId, framework, running]);

  // "Fix with AI" clicked from the SIDEBAR preview (outside this panel's own UI) — prefill the chat
  // input with the error and bring the chat into view, mirroring this panel's OWN onFixError handler
  // for its in-panel Preview tab (below). Fires on each new pendingFix (nonce change).
  useEffect(() => {
    if (!pendingFix?.text) return;
    setPrompt(pendingFix.text);
    setShowWorkspace(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFix?.nonce]);

  // Load the file contents when the Files tab is opened (and not already loaded), so each file
  // row can show its line count — without the user having to click into a file first.
  useEffect(() => {
    if (showWorkspace && tab === 'files' && workspaceFiles === null && state.files.length > 0 && state.workspaceId) {
      void loadWorkspaceFiles();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showWorkspace, tab, workspaceFiles, state.files.length, state.workspaceId]);

  // Refresh the cached contents when a build finishes so line counts reflect the latest files.
  useEffect(() => {
    if (state.done && tab === 'files' && showWorkspace && state.workspaceId && state.files.length > 0) {
      void loadWorkspaceFiles();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.done]);

  // S4 — REHYDRATE FILES + PREVIEW from durable storage on (re)open. The other file-load effects all
  // require state.files.length > 0, which is ALWAYS 0 after a reopen (the restored thread carries no
  // file events) — so files/preview looked "gone". This pulls the durable file contents for the shown
  // workspace the moment it is opened (and NOT mid-build), so the Files viewer is populated and the
  // in-browser preview (which renders from the same durable files server-side) comes back. Runs once
  // per workspace (rehydratedWsRef), re-armed on session switch; never during a live build.
  useEffect(() => {
    if (running || !userId || !sessionIdRef.current) return;
    const wsId = state.workspaceId || `agentv3-${normalizeUid(userId)}-${sessionIdRef.current}`;
    // Skip only if we've already rehydrated THIS workspace, or the cache already holds THIS workspace's
    // files. A stale in-flight load for a PREVIOUS workspace (workspaceFilesFor !== wsId) must NOT block
    // loading the current one.
    if (rehydratedWsRef.current === wsId || (workspaceFiles !== null && workspaceFilesFor === wsId)) return;
    rehydratedWsRef.current = wsId;
    void loadWorkspaceFiles(wsId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, state.workspaceId, running, workspaceFiles, workspaceFilesFor]);

  // Plan (todo list) collapse toggle (Task 3) — keeps the chat area readable.
  const [planCollapsed, setPlanCollapsed] = useState(false);

  const agents = Object.values(state.agents).sort((a, b) => b.updatedTs - a.updatedTs);
  const diffPaths = Object.keys(state.diffs);
  const planDone = state.todos.filter((t) => t.status === 'done').length;
  const currentTodo = state.todos.find((t) => t.status === 'in_progress')
    ?? state.todos.find((t) => t.status !== 'done');

  return (
    <div className="flex flex-col h-full max-h-full w-full min-h-0 bg-zinc-950 text-zinc-100">
      {/* Header: title + New, and the workspace tab pills (open/collapse the workspace) */}
      <div className="shrink-0 border-b border-zinc-800">
        <div className="flex items-center gap-2 px-4 pt-3 pb-2">
          {/* History menu (3-line): this account's saved chats + New chat. Per-user (Firestore), so the
              same list and the same project/memory continue from any device the user signs in on. */}
          <div className="relative">
            <button
              onClick={toggleHistory}
              title="Chat history"
              aria-label="Chat history"
              className="flex items-center justify-center w-7 h-7 -ml-1 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800"
            >
              <Menu className="w-5 h-5" />
            </button>
            {historyOpen && (
              <>
                {/* cursor-pointer is load-bearing on iOS: without a direct listener (React delegates
                    to the root) Safari only synthesizes click on "clickable" elements, so a bare div
                    never closed the menu on tap-outside on iPhone. */}
                <div className="fixed inset-0 z-40 cursor-pointer touch-manipulation" onClick={() => setHistoryOpen(false)} aria-hidden="true" />
                <div className="absolute left-0 top-9 z-50 w-80 max-h-[70vh] overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl py-1.5">
                  <div className="px-3 pb-1.5 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Session history</div>
                  {tapDebug && (
                    <div className="mx-2 mb-1 rounded bg-amber-500/10 border border-amber-500/40 px-2 py-1 text-[10px] font-mono text-amber-300 break-all select-text">
                      {lastTap || 'tap tracer ON — ab kisi chat par tap kijiye'}
                    </div>
                  )}
                  <button
                    onClick={newChatFromHistory}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-40"
                  >
                    <Plus className="w-4 h-4 text-indigo-400" /> New chat
                  </button>
                  <div className="my-1 border-t border-zinc-800" />
                  {historyLoading ? (
                    <div className="px-3 py-3 text-xs text-zinc-500 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading sessions…</div>
                  ) : historyError ? (
                    <div className="px-3 py-4 text-xs text-center">
                      <div className="flex items-center justify-center gap-1.5 text-amber-400">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        <span>Couldn't load your history</span>
                      </div>
                      <div className="mt-1 text-zinc-500">{historyError}</div>
                      <button
                        onClick={loadHistory}
                        className="mt-2 inline-flex items-center gap-1 px-2 py-1 rounded-md text-indigo-400 hover:text-indigo-300 hover:bg-zinc-800 font-medium"
                      >
                        <RotateCcw className="w-3 h-3" /> Try again
                      </button>
                    </div>
                  ) : historyItems.length === 0 ? (
                    <div className="px-3 py-4 text-xs text-zinc-500 text-center">No saved sessions yet.<br />Every build you start is saved here automatically.</div>
                  ) : (
                    groupSessionsByDate(historyItems, Date.now()).map((group) => (
                      <div key={group.label}>
                        <div className="px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">{group.label}</div>
                        {group.items.map((c) => {
                          const meta = sessionStatusMeta(c.status);
                          const isActive = !!c.workspaceId && c.workspaceId === state.workspaceId;
                          const isDeleting = deletingHistoryId === c.id;
                          // MOBILE TAP FIX: this row used to be a <div role="button"> with a NESTED
                          // delete <button> inside it. On iOS Safari, tapping a non-interactive div
                          // inside a scrollable (overflow-y-auto) menu is often treated as scroll
                          // intent and never dispatches a click — so on phones "clicking an old chat
                          // did nothing" while desktop mouse clicks worked. The open action is now a
                          // REAL full-width <button> (guaranteed tap → click on iOS, keyboard support
                          // for free), and delete is a SIBLING absolutely-positioned button (valid
                          // HTML — no nested interactive). Delete was also opacity-0 until :hover,
                          // which doesn't exist on touch — an invisible tap-eater on the row's right
                          // edge; it now stays visible on touch layouts and hover-reveals on desktop.
                          return (
                            <div key={c.id} className={`relative group ${isDeleting ? 'opacity-40 pointer-events-none' : ''}`}>
                              <button
                                type="button"
                                onClick={() => { if (!isDeleting) openConversation(c.id); }}
                                disabled={isDeleting}
                                title={c.deadTranscript ? 'Transcript lost to an old bug — files/memory intact' : (c.title || 'Untitled build')}
                                className={`w-full flex items-center gap-2 pl-3 pr-9 py-2 text-left text-sm touch-manipulation ${isActive ? 'bg-indigo-500/10 text-white' : c.deadTranscript ? 'text-zinc-500 hover:bg-zinc-800 active:bg-zinc-800' : 'text-zinc-300 hover:bg-zinc-800 active:bg-zinc-800'}`}
                              >
                                <span className="relative shrink-0 flex items-center justify-center w-3.5 h-3.5">
                                  <span className={`w-2 h-2 rounded-full ${c.deadTranscript ? 'bg-zinc-700' : meta.dot} ${meta.pulse && !c.deadTranscript ? 'animate-pulse' : ''}`} title={meta.label} />
                                </span>
                                <span className="flex-1 min-w-0">
                                  <span className="block truncate">{c.title || 'Untitled build'}</span>
                                  <span className="flex items-center gap-1.5 text-[10px] text-zinc-600">
                                    {isActive && <span className="text-indigo-400 font-semibold">Current session ·</span>}
                                    {c.deadTranscript
                                      ? <span className="text-amber-600/80">Transcript lost (old bug) — files safe</span>
                                      : meta.label && <span>{meta.label}</span>}
                                    {c.updatedAt ? <span>· {relTime(c.updatedAt)}</span> : null}
                                  </span>
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={(e) => handleDeleteConversation(e, c)}
                                disabled={running || isDeleting}
                                title="Delete this session"
                                aria-label="Delete this session"
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded touch-manipulation text-zinc-500 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-40 opacity-60 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100"
                              >
                                {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
          <Bot className="w-5 h-5 text-indigo-400" />
          <span className="font-semibold">NavBharatAI Pro v3.0</span>
          <span className="text-[10px] uppercase tracking-wide bg-indigo-500/20 text-indigo-300 px-1.5 py-0.5 rounded">beta</span>
          <button
            onClick={() => setShowFrameworkPicker(true)}
            className="flex items-center gap-1 text-[10px] bg-white/5 hover:bg-white/10 border border-white/5 text-zinc-400 hover:text-white px-2 py-0.5 rounded-full transition-all"
            title="Change framework"
          >
            <span>{FRAMEWORKS.find(f => f.id === framework)?.iconChar ?? '⚛'}</span>
            <span>{FRAMEWORKS.find(f => f.id === framework)?.name ?? 'React + Vite'}</span>
          </button>
          <span className="text-[9px] text-zinc-600 font-mono" title="Deployed build time — if this doesn't change after a deploy, your browser is serving cached code.">{(() => { try { return 'b:' + (typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : '').slice(5, 16).replace('T', ' '); } catch { return ''; } })()}</span>
          {running ? (
            // Attached + streaming here → Stop.
            <button
              onClick={stop}
              title="Stop the running build"
              className="ml-auto flex items-center gap-1 text-xs text-white bg-red-600 hover:bg-red-500 rounded px-2 py-1"
            >
              <Square className="w-3.5 h-3.5" /> Stop
            </button>
          ) : serverBuildRunning ? (
            // A build is running server-side but this UI isn't attached → Resume + Stop.
            <div className="ml-auto flex items-center gap-1.5">
              <button
                onClick={() => resumeBuild({ userId, email, workspaceId: expectedWorkspaceId() })}
                title="Open the running build — resume where it left off"
                className="flex items-center gap-1 text-xs text-white bg-indigo-600 hover:bg-indigo-500 rounded px-2 py-1"
              >
                <Play className="w-3.5 h-3.5" /> Resume
              </button>
              <button
                onClick={stop}
                title="Stop the running build"
                className="flex items-center gap-1 text-xs text-red-200 border border-red-700 hover:bg-red-950 rounded px-2 py-1"
              >
                <Square className="w-3.5 h-3.5" /> Stop
              </button>
            </div>
          ) : null}
        </div>
        <div className="flex gap-1 px-3 pb-2 overflow-x-auto whitespace-nowrap" style={{ WebkitOverflowScrolling: 'touch' }}>
          <TabPill active={showWorkspace && tab === 'preview'} onClick={() => openTab('preview')} icon={<Globe className="w-3.5 h-3.5" />} dataTour="preview">Preview</TabPill>
          <TabPill active={showWorkspace && tab === 'files'} onClick={() => openTab('files')} icon={<FolderOpen className="w-3.5 h-3.5" />}>Files ({state.files.length})</TabPill>
          <TabPill active={showWorkspace && tab === 'diff'} onClick={() => openTab('diff')} icon={<FileDiff className="w-3.5 h-3.5" />}>Diff ({diffPaths.length})</TabPill>
          <TabPill active={showWorkspace && tab === 'terminal'} onClick={() => openTab('terminal')} icon={<Terminal className="w-3.5 h-3.5" />}>Terminal</TabPill>
          <TabPill active={showWorkspace && tab === 'history'} onClick={() => openTab('history')} icon={<History className="w-3.5 h-3.5" />}>History ({allCheckpoints.length})</TabPill>
          <button
            onClick={downloadProjectZip}
            disabled={exporting || !state.workspaceId}
            title="Download your whole project as a .zip you own — open it in any editor or host it anywhere (no lock-in)"
            className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            {exporting ? 'Exporting…' : 'Export .zip'}
          </button>
          <button
            onClick={downloadDiagnostics}
            disabled={downloadingDiag}
            title="Download the diagnostics report from your last build (JSON) — every issue v3.0 hit (provider fallbacks, tool errors, readiness blockers, sandbox problems). Send it to support to get the build engine improved."
            className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {downloadingDiag ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
            {downloadingDiag ? 'Preparing…' : 'Build report'}
          </button>
          <button
            onClick={downloadDiagnosticsText}
            disabled={downloadingDiagText || !state.workspaceId}
            title="Download the SAME report as a readable text document — root cause first, only real problems, plus the full sandbox/LLM/reviewer detail. Easier to read than the JSON."
            className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {downloadingDiagText ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileCode className="w-3.5 h-3.5" />}
            {downloadingDiagText ? 'Preparing…' : 'Text report'}
          </button>
          <button
            onClick={copyDiagnostics}
            disabled={copyingDiag}
            title="Copy the last build's diagnostics report to your clipboard — paste it straight into a support chat (no download/upload needed)."
            className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {copyingDiag ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Copy className="w-3.5 h-3.5" />}
            {copyingDiag ? 'Copying…' : 'Copy report'}
          </button>
          <div className="relative">
            <button
              onClick={toggleHistoryReport}
              disabled={!state.workspaceId}
              title="Browse past builds' reports — a small recent build never hides a previous, more useful report."
              className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${selectedHistoryBuildId ? 'border-indigo-500 text-indigo-300' : 'border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500'}`}
            >
              <Clock className="w-3.5 h-3.5" />
              {selectedHistoryBuildId ? 'Viewing past build' : 'Report history'}
            </button>
            {historyReportOpen && (
              <>
                <div className="fixed inset-0 z-40 cursor-pointer touch-manipulation" onClick={() => setHistoryReportOpen(false)} aria-hidden="true" />
                <div className="absolute left-0 top-8 z-50 w-80 max-h-[60vh] overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl py-1.5">
                  {selectedHistoryBuildId && (
                    <button
                      onClick={() => { setSelectedHistoryBuildId(null); setHistoryReportOpen(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-indigo-300 hover:bg-zinc-800"
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Back to latest report
                    </button>
                  )}
                  <div className="my-1 border-t border-zinc-800" />
                  {historyReportLoading ? (
                    <div className="px-3 py-3 text-xs text-zinc-500 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</div>
                  ) : historyReportItems.length === 0 ? (
                    <div className="px-3 py-3 text-xs text-zinc-500">No past build reports saved yet.</div>
                  ) : (
                    historyReportItems.map((h) => (
                      <button
                        key={h.id}
                        onClick={() => { setSelectedHistoryBuildId(h.id); setHistoryReportOpen(false); }}
                        title={h.rootCause || ''}
                        className={`w-full flex items-start gap-2 px-3 py-2 text-left text-xs hover:bg-zinc-800 ${selectedHistoryBuildId === h.id ? 'bg-indigo-500/10 text-white' : 'text-zinc-300'}`}
                      >
                        <span className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${h.ok === true ? 'bg-emerald-500' : h.ok === false ? 'bg-red-500' : 'bg-zinc-600'}`} />
                        <span className="flex-1 min-w-0">
                          <span className="block text-[10px] text-zinc-500">{new Date(h.startedAt).toLocaleString()}</span>
                          <span className="block truncate">{h.rootCause || '(no root cause recorded)'}</span>
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
          {state.repoUrl && (
            <a
              href={state.repoUrl}
              target="_blank"
              rel="noreferrer"
              title={`Open this project's GitHub repo${state.repoFullName ? ` (${state.repoFullName})` : ''} — your code, branches, pull requests, CI and merges`}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors"
            >
              <Github className="w-3.5 h-3.5" />
              GitHub
              <ExternalLink className="w-3 h-3 opacity-60" />
            </a>
          )}
          {/* R5 §5.1 — one-click deploy: publish the built app to a PERMANENT public URL.
              When more than one hosting provider is configured, a chooser lets the user pick
              WHERE to deploy (no lock-in); with only one, the button alone keeps it simple. */}
          {configuredProviders.length > 1 && (
            <select
              value={deployProvider}
              onChange={(e) => setDeployProvider(e.target.value)}
              disabled={running}
              title="Choose where to deploy (no lock-in)"
              className="text-xs px-1.5 py-1 rounded border border-emerald-700/60 bg-zinc-900 text-emerald-300 disabled:opacity-40"
            >
              {configuredProviders.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
          <button
            onClick={deployLive}
            data-tour="deploy"
            disabled={running || !state.workspaceId}
            title="Publish your app to a permanent public live URL (it stays online after the sandbox stops)"
            className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border border-emerald-700/60 text-emerald-300 hover:text-white hover:border-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Rocket className="w-3.5 h-3.5" />
            Deploy
          </button>
          {liveUrl && (
            <a
              href={liveUrl}
              target="_blank"
              rel="noreferrer"
              title={`Your live site: ${liveUrl}`}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border border-emerald-700/60 bg-emerald-950/40 text-emerald-300 hover:text-white hover:border-emerald-500 transition-colors"
            >
              <Globe className="w-3.5 h-3.5" />
              Live site
              <ExternalLink className="w-3 h-3 opacity-60" />
            </a>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row flex-1 min-h-0">
        {/* LEFT: the chat. Full width when the workspace is collapsed. When the
            workspace is open it shares the width on desktop, and is HIDDEN on
            mobile (the workspace takes over so it's usable on a phone). */}
        <div className={`${showWorkspace ? 'hidden sm:flex sm:w-1/2 sm:border-r border-zinc-800' : 'flex flex-1'} flex-col min-h-0`}>
          {/* Conversation */}
          <div ref={scrollRef} className="flex-1 overflow-auto p-3 space-y-3 min-h-0">
            {convo.length === 0 && (
              <div className="text-sm text-zinc-500 mt-6 text-center">
                <Bot className="w-8 h-8 mx-auto mb-2 text-indigo-400/60" />
                Say hi, or describe an app to build —<br />e.g. “build a todo app with categories”.
              </div>
            )}
            {chatBlocks.map((b) => b.kind === 'msg'
              ? <Bubble key={b.key} msg={b.msg} />
              : <ActionGroupRow key={b.key} block={b} />)}
            {(running || state.activity.length > 0) && (
              <WorkingIndicator activity={state.activity} todos={state.todos} running={running} />
            )}
            {(error || state.error) && (
              <div className="flex items-start gap-2 px-3 py-2 bg-red-950/60 text-red-300 text-xs rounded">
                <AlertCircle className="w-4 h-4 shrink-0" /> <span className="whitespace-pre-wrap break-words">{error || state.error}</span>
              </div>
            )}
            {state.done && state.ok === false && !state.error && state.summary && (
              <div className="flex items-start gap-2 px-3 py-2 bg-amber-950/50 text-amber-200 text-xs rounded">
                <AlertCircle className="w-4 h-4 shrink-0" /> <span className="whitespace-pre-wrap break-words">{state.summary}</span>
              </div>
            )}
            {state.pendingPermission && (
              <div className="px-3 py-2.5 bg-amber-950/50 border border-amber-900 rounded">
                <div className="flex items-center gap-2 text-xs text-amber-200 mb-2">
                  <AlertCircle className="w-4 h-4" /> {state.pendingPermission.action}
                </div>
                {state.todos.length > 0 && (
                  <div className="mb-2"><TodoList todos={state.todos} /></div>
                )}
                <div className="flex gap-2">
                  <button onClick={() => respond(state.pendingPermission!.callId, true)} className="px-3 py-1 text-xs rounded bg-emerald-600 hover:bg-emerald-500 text-white">Approve &amp; build</button>
                  <button onClick={() => respond(state.pendingPermission!.callId, false)} className="px-3 py-1 text-xs rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-100">Reject</button>
                </div>
              </div>
            )}
            {state.done && (typeof state.billedInr === 'number' || typeof state.billedUsd === 'number') && (
              <div className="flex items-center gap-1 text-[11px] text-zinc-500" title="Customer bill (INR)">
                <Rocket className="w-3 h-3" />{' '}
                {typeof state.billedInr === 'number'
                  ? `₹${state.billedInr.toFixed(2)}`
                  : `$${(state.billedUsd as number).toFixed(4)}`}
              </div>
            )}
            {/* P-UX.7 — token usage for this build (input + output), shown alongside the ₹ cost. */}
            {state.done && typeof state.tokens === 'number' && state.tokens > 0 && (
              <div className="flex items-center gap-1 text-[11px] text-zinc-500" title="Tokens used by this build (input + output)">
                <FileCode className="w-3 h-3" />
                {state.tokens >= 1000 ? `${(state.tokens / 1000).toFixed(1)}k` : state.tokens} tokens
              </div>
            )}
            {state.done && state.buildHealth && <BuildHealthCard health={state.buildHealth} />}
            {/* P-UX.6 — lightweight CSAT: thumbs feedback on a finished build (once per workspace). */}
            {state.done && state.ok && state.workspaceId && <BuildFeedback workspaceId={state.workspaceId} />}
          </div>

          {/* Bottom: live AI-team chips + input (Claude-Code style — at the bottom) */}
          <div className="shrink-0 sticky bottom-0 bg-zinc-950 border-t border-zinc-800 pb-[env(safe-area-inset-bottom)]">
            {/* Live plan progress (only when there's no pending plan-approval gate, which shows its
                own copy) — lets the user watch the AI work through its real todo list as it builds. */}
            {state.todos.length > 0 && !state.pendingPermission && (
              <div className="px-3 pt-2">
                <button
                  type="button"
                  onClick={() => setPlanCollapsed((v) => !v)}
                  className="w-full flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 hover:text-zinc-200"
                  title={planCollapsed ? 'Expand plan' : 'Minimize plan'}
                >
                  {planCollapsed ? <ChevronRight className="w-3 h-3 shrink-0" /> : <ChevronDown className="w-3 h-3 shrink-0" />}
                  <span>Plan</span>
                  <span className="text-zinc-500">{planDone}/{state.todos.length}</span>
                  {planCollapsed && currentTodo && (
                    <span className="text-zinc-600 truncate normal-case font-normal">· {currentTodo.title}</span>
                  )}
                </button>
                {!planCollapsed && (
                  <div className="mt-1 max-h-28 overflow-auto">
                    <TodoList todos={state.todos} hideHeader />
                  </div>
                )}
              </div>
            )}
            {agents.length > 0 && (
              <div className="px-3 pt-2 flex gap-1.5 overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
                {agents.map((a) => <AgentChip key={a.agent} card={a} running={running} />)}
              </div>
            )}
            {files.length > 0 && (
              <div className="px-3 pt-2 flex flex-wrap gap-1.5">
                {files.map((f, i) => (
                  <span key={i} className="flex items-center gap-1 max-w-[200px] text-[11px] bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-300">
                    <FileText className="w-3 h-3 shrink-0 text-indigo-400" />
                    <span className="truncate">{f.name}</span>
                    <button type="button" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} className="shrink-0 text-zinc-500 hover:text-white" title="Remove">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.pdf,.txt,.md,.csv,.json,.html,.docx,.xlsx,.xls,.pptx,.zip,.js,.ts,.tsx,.jsx,.py,.css"
              className="hidden"
              onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
            />
            <div className="flex items-end gap-2 px-2 py-1.5">
              {/* Build-options popover (Planning / Thinking / Power) — anchored above the input */}
              <div className="relative shrink-0">
                {settingsOpen && (
                  <>
                    {/* outside-click catcher */}
                    <div className="fixed inset-0 z-10" onClick={() => setSettingsOpen(false)} />
                    <div className="absolute bottom-full left-0 mb-2 z-20 w-56 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-1.5 space-y-0.5">
                      <ToggleRow label="Planning" checked={planFirst} disabled={running} onClick={() => setPlanFirst((v) => !v)} />
                      <ToggleRow label="Thinking" checked={thinking} disabled={running} onClick={() => setThinking((v) => !v)} />
                      {/* Power level: Off (Sonnet) / 5× (Opus min) / 10× (Opus medium) / 20× (Opus max, ultracode). */}
                      <div className="px-3 py-2">
                        <div className="text-sm text-zinc-200 mb-1.5">Power</div>
                        <div className="flex gap-1">
                          {([
                            { key: 'off', label: 'Off' },
                            { key: 'mini', label: '5×' },
                            { key: 'medium', label: '10×' },
                            { key: 'max', label: '20×' },
                          ] as const).map((opt) => (
                            <button
                              key={opt.key}
                              type="button"
                              disabled={running}
                              onClick={() => setPowerLevel(opt.key)}
                              className={`flex-1 px-2 py-1 rounded text-xs font-medium transition-colors disabled:opacity-50 ${
                                powerLevel === opt.key
                                  ? 'bg-indigo-600 text-white'
                                  : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                        <div className="text-[11px] text-zinc-500 mt-1">
                          {powerLevel === 'off'
                            ? 'Normal — fast & lowest cost'
                            : powerLevel === 'mini'
                            ? 'Opus minimum power'
                            : powerLevel === 'medium'
                            ? 'Opus medium power'
                            : 'Opus max — ultracode'}
                        </div>
                      </div>
                      <div className="border-t border-zinc-800 my-1" />
                      <button
                        className="w-full flex items-center justify-between px-3 py-2 rounded hover:bg-zinc-800 text-left"
                        onClick={() => { setShowFrameworkPicker(true); setSettingsOpen(false); }}
                      >
                        <span className="text-xs text-zinc-300">Framework</span>
                        <span className="text-[11px] text-indigo-400 font-medium">{FRAMEWORKS.find(f => f.id === framework)?.name ?? 'React + Vite'}</span>
                      </button>
                      <button
                        className="w-full flex items-center justify-between px-3 py-2 rounded hover:bg-zinc-800 text-left"
                        onClick={() => { setShowImportModal(true); setSettingsOpen(false); }}
                      >
                        <span className="text-xs text-zinc-300">Import Repo</span>
                        {importUrl ? <span className="text-[10px] text-green-400 truncate max-w-[100px]">✓ set</span> : <span className="text-[10px] text-zinc-500">GitHub / URL</span>}
                      </button>
                    </div>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setSettingsOpen((v) => !v)}
                  title="Build options"
                  className={`relative h-[42px] w-10 flex items-center justify-center rounded border ${settingsOpen ? 'border-indigo-500 text-indigo-300' : 'border-zinc-700 text-zinc-400 hover:text-white'}`}
                >
                  <SlidersHorizontal className="w-4 h-4" />
                  {anyToggleOn && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-indigo-400" />}
                </button>
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={running}
                title="Attach files (images, PDF, Word, Excel, PowerPoint, ZIP, text…)"
                className="relative h-[42px] w-10 shrink-0 flex items-center justify-center rounded border border-zinc-700 text-zinc-400 hover:text-white disabled:opacity-40"
              >
                <Paperclip className="w-4 h-4" />
                {files.length > 0 && <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 rounded-full bg-indigo-500 text-[9px] leading-[14px] text-white text-center">{files.length}</span>}
              </button>
              <div className="relative flex-1" data-tour="chat">
                <textarea
                  ref={composerRef}
                  className={`w-full bg-zinc-900 border border-zinc-700 rounded-xl pl-3 pr-20 py-2 text-sm resize-none focus:outline-none focus:border-indigo-500 overflow-y-auto ${composerExpanded ? 'h-[50vh]' : ''}`}
                  rows={1}
                  placeholder="Message v3.0… (e.g. “hello”, “build a notes app”, or attach a file)"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onPaste={(e) => {
                    const imgs = (Array.from(e.clipboardData.items) as DataTransferItem[])
                      .filter((it) => it.type.startsWith('image/'))
                      .map((it) => it.getAsFile())
                      .filter((f): f is File => !!f);
                    if (imgs.length > 0) { e.preventDefault(); setFiles((prev) => [...prev, ...imgs].slice(0, 8)); }
                  }}
                  onKeyDown={(e) => {
                    // Laptop (physical keyboard) → Enter sends. Phone (touch) → Enter inserts a newline
                    // (send only via the button). In the expanded editor Enter always inserts a newline
                    // so a long message can be edited freely. Shift+Enter is always a newline.
                    if (e.key === 'Enter' && !e.shiftKey && !isTouchDevice && !composerExpanded) {
                      e.preventDefault();
                      send();
                    }
                  }}
                />
                {/* Expand / minimize the composer so a long message can be read & edited. */}
                <button
                  type="button"
                  onClick={() => setComposerExpanded((v) => !v)}
                  title={composerExpanded ? 'Minimize' : 'Expand'}
                  className="absolute right-11 bottom-2 h-8 w-8 flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800"
                >
                  {composerExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                </button>
                {running ? (
                  <button onClick={stop} title="Stop" className="absolute right-2 bottom-2 h-8 w-8 flex items-center justify-center bg-red-600 hover:bg-red-500 rounded-lg text-white">
                    <Square className="w-4 h-4" />
                  </button>
                ) : (
                  <button onClick={() => { send(); setComposerExpanded(false); }} disabled={!prompt.trim() && files.length === 0} title="Send" className="absolute right-2 bottom-2 h-8 w-8 flex items-center justify-center bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded-lg text-white">
                    <Send className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT: merged workspace surfaces. Opened from the header tab pills;
            collapses back to full-width chat via the ✕ button (or re-tapping the
            active pill). On mobile it takes over the area; on desktop it shares. */}
        {showWorkspace && (
        <div className="flex-1 sm:flex-none sm:w-1/2 flex flex-col min-h-0">
          <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-1.5 border-b border-zinc-800 text-xs">
            <span className="font-medium text-zinc-300 capitalize">{tab}</span>
            <button onClick={() => setShowWorkspace(false)} title="Close workspace (back to chat)" className="flex items-center gap-1 text-zinc-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>

          {tab === 'preview' ? (
            <PreviewSurface
              url={state.previewUrl}
              workspaceId={state.workspaceId}
              userId={userId}
              email={email}
              framework={framework}
              // C1 — when the panel is idle (no build running), let the preview auto-boot a dead
              // sandbox ONCE on reopen so a returning user's live preview restores itself instead of
              // requiring a manual "Diagnose" click. Suppressed during an active build (the live URL
              // arrives from the build itself — no need to boot a second sandbox).
              autoResume={!running}
              onFixError={(errText) => {
                // P-UX.3 — prepopulate the chat with the preview error and bring the chat into view
                // (collapse the workspace) so the user can review and send the fix request.
                setPrompt(
                  `The in-browser preview failed to build with this error:\n\n${errText}\n\n` +
                    'Please find the cause in the project files and fix it so the app builds and runs.',
                );
                setShowWorkspace(false);
              }}
              onFileEdited={(path, content) => {
                // Visual Editor saved a real edit — keep this panel's OWN Files-tab cache honest, and
                // push it through the SAME onFilesSync bridge a build's own file writes use, so the
                // main app's shared files state (Code Studio, sidebar Files, Git) picks it up too.
                setWorkspaceFiles((prev) => (prev ? { ...prev, [path]: content } : prev));
                onFilesSync?.({ [path]: content });
              }}
            />
          ) : tab === 'files' ? (
            // Unified Files — the SAME rich FilesPanel the sidebar "Files" menu uses, so both
            // entry points are ONE feature with two gates. It shows the union of the live v3.0
            // sandbox files (workspaceFiles) and the main-app files (user uploads + already-synced
            // builds via onFilesSync) — i.e. exactly "the files v3.0 built OR the user uploaded".
            // Empty state keeps v3.0's own restore-all safety net (the sandbox-level restore the
            // sidebar's History tab does not provide).
            (() => {
              const unified: Record<string, string> = { ...(filesPanel?.files || {}), ...(workspaceFiles || {}) };
              const hasAny = Object.keys(unified).length > 0;
              if (filesPanel && hasAny) {
                return <FilesPanel {...filesPanel} files={unified} hasGeneratedCode={hasAny} />;
              }
              return (
                <div className="flex-1 overflow-auto p-3 font-mono text-xs">
                  <div className="flex flex-col items-start gap-2">
                    <Empty>No files shown.</Empty>
                    {state.workspaceId && (
                      <button
                        onClick={handleRestoreAll}
                        disabled={restoring}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-indigo-700/60 text-indigo-300 hover:text-white hover:border-indigo-500 disabled:opacity-40"
                      >
                        {restoring ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                        {restoring ? 'Restoring…' : 'Restore all files'}
                      </button>
                    )}
                    {restoreMsg && <span className="text-[11px] text-zinc-400">{restoreMsg}</span>}
                  </div>
                </div>
              );
            })()
          ) : (
            <div className="flex-1 overflow-auto p-3 font-mono text-xs">
              {tab === 'diff' && (diffPaths.length === 0 ? <Empty>No diffs yet.</Empty> : (
                <div className="space-y-3">
                  {diffPaths.map((p) => <div key={p}><div className="text-zinc-400 mb-1">{p}</div><pre className="whitespace-pre-wrap">{colorizeDiff(state.diffs[p])}</pre></div>)}
                </div>
              ))}
              {tab === 'terminal' && (state.terminal.length === 0 ? <Empty>No terminal output yet.</Empty> : (
                <pre className="whitespace-pre-wrap text-zinc-300">{state.terminal.join('\n')}</pre>
              ))}
              {tab === 'history' && (
                <div className="space-y-2">
                  {/* Restore the WHOLE project at once — a real restore (files written back into the
                      workspace), available even when there are no in-session checkpoints (e.g. after a reload). */}
                  {state.workspaceId && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={handleRestoreAll}
                        disabled={restoring}
                        title="Bring your whole project back into the workspace"
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-indigo-700/60 text-indigo-300 hover:text-white hover:border-indigo-500 disabled:opacity-40"
                      >
                        {restoring ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                        {restoring ? 'Restoring…' : 'Restore all files'}
                      </button>
                      {restoreMsg && <span className="text-[11px] text-zinc-400">{restoreMsg}</span>}
                    </div>
                  )}
                  {gitStatus && (
                    <div className="mb-2 flex items-center gap-2 text-[11px] px-2 py-1 rounded bg-zinc-800/60 border border-white/5">
                      <GitBranch className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                      {!gitStatus.available ? (
                        <span className="text-zinc-500">Workspace is dormant — send a message to bring it back online.</span>
                      ) : gitStatus.live === false ? (
                        <span className="text-zinc-400">Last saved: working tree clean{gitStatus.head ? ` · on ${gitStatus.head}` : ''}{gitStatus.lastCommit ? ` · ${gitStatus.lastCommit.slice(0, 48)}` : ''}</span>
                      ) : gitStatus.clean ? (
                        <span className="text-emerald-400">Working tree clean{gitStatus.head ? ` · on ${gitStatus.head}` : ''}</span>
                      ) : (
                        <span className="text-amber-400">{gitStatus.changed} uncommitted change{gitStatus.changed === 1 ? '' : 's'}{gitStatus.head ? ` · on ${gitStatus.head}` : ''}</span>
                      )}
                    </div>
                  )}
                  {restoreNote && (
                    <div className="mb-2 text-[11px] text-zinc-400 bg-zinc-800/60 border border-white/5 rounded px-2 py-1">{restoreNote}</div>
                  )}
                  {allCheckpoints.length === 0 ? <Empty>No checkpoints yet.</Empty> : (
                    <ul className="space-y-1">
                      {allCheckpoints.map((c) => (
                        <li key={c.id} className="flex items-center gap-2">
                          <History className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                          <span className="text-zinc-500 shrink-0">{c.sha.slice(0, 7) || '—'}</span>
                          <span className="flex-1 truncate">{c.message}</span>
                          {c.sha && (
                            <button onClick={() => handleRestoreCheckpoint(c.sha)} className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 shrink-0" title="Restore to this checkpoint">
                              <RotateCcw className="w-3 h-3" /> Restore
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        )}
      </div>

      {/* LOUD open-failure toast — a history chat that fails to open must say WHY, never no-op. */}
      {openChatError && (
        <div className="fixed inset-x-3 bottom-20 z-[70] sm:left-auto sm:right-4 sm:max-w-md rounded-xl border border-red-500/40 bg-red-950/95 text-red-100 text-xs leading-relaxed shadow-2xl p-3 pr-8">
          {openChatError}
          <button
            type="button"
            onClick={() => setOpenChatError(null)}
            aria-label="Dismiss"
            className="absolute top-2 right-2 p-1 rounded text-red-300 hover:text-white touch-manipulation"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Framework Picker Modal */}
      {showFrameworkPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowFrameworkPicker(false)} />
          <div className="relative z-10 w-full max-w-sm bg-[#0d1117] border border-white/10 rounded-2xl shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-black text-white uppercase tracking-widest">Choose Framework</h3>
                <p className="text-[10px] text-[#8b949e] mt-0.5">Pick the technology stack for your new project</p>
              </div>
              <button onClick={() => setShowFrameworkPicker(false)} className="text-zinc-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <FrameworkPicker value={framework} onChange={setFramework} />
            <button
              onClick={() => setShowFrameworkPicker(false)}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl transition-all"
            >
              Confirm
            </button>
          </div>
        </div>
      )}

      {/* Import Repo Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowImportModal(false)} />
          <div className="relative z-10 w-full max-w-sm bg-[#0d1117] border border-white/10 rounded-2xl shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-black text-white uppercase tracking-widest">Import Project</h3>
                <p className="text-[10px] text-[#8b949e] mt-0.5">Clone a GitHub repo into your v3.0 workspace</p>
              </div>
              <button onClick={() => setShowImportModal(false)} className="text-zinc-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            {/* PRIMARY: the 1-click repo picker (states: connect → loading → list/empty → error) */}
            {ghReposError === 'auth' ? (
              <div className="space-y-2 text-center py-2">
                <p className="text-[11px] text-[#8b949e]">Connect your GitHub once — then every import is a single click on a repo.</p>
                <button
                  type="button"
                  onClick={() => void connectGitHub()}
                  className="w-full flex items-center justify-center gap-2 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold rounded-xl transition-all touch-manipulation"
                >
                  <Github className="w-4 h-4" /> Connect GitHub
                </button>
                <p className="text-[10px] text-[#484f58]">You'll be taken to GitHub to sign in and approve access (private repos included), then brought right back here.</p>
              </div>
            ) : ghReposLoading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-[#8b949e] text-xs">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading your repositories…
              </div>
            ) : ghReposError ? (
              <div className="space-y-2 text-center py-2">
                <p className="text-[11px] text-amber-300">{ghReposError}</p>
                <button type="button" onClick={() => void loadGhRepos()} className="px-4 py-2 bg-white/5 hover:bg-white/10 text-zinc-200 text-xs font-semibold rounded-xl touch-manipulation">Retry</button>
              </div>
            ) : ghRepos && ghRepos.length === 0 ? (
              <p className="text-[11px] text-[#8b949e] text-center py-3">No repositories found on your GitHub account — paste a URL below instead.</p>
            ) : ghRepos ? (
              <div className="space-y-2">
                <input
                  type="text"
                  value={repoSearch}
                  onChange={(e) => setRepoSearch(e.target.value)}
                  placeholder={`Search ${ghRepos.length} repositories…`}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-[#484f58] focus:outline-none focus:border-indigo-500/50"
                />
                <div className="max-h-56 overflow-y-auto rounded-xl border border-white/10 divide-y divide-white/5">
                  {ghRepos
                    .filter((r) => !repoSearch.trim() || r.fullName.toLowerCase().includes(repoSearch.trim().toLowerCase()))
                    .slice(0, 60)
                    .map((r) => (
                      <button
                        key={r.fullName}
                        type="button"
                        onClick={() => importRepo(r.url)}
                        disabled={running || importSending}
                        title={running ? 'A build is running — wait for it to finish before importing' : `Import ${r.fullName} into this workspace`}
                        className="w-full text-left px-3 py-2.5 hover:bg-white/5 active:bg-white/10 disabled:opacity-40 touch-manipulation"
                      >
                        <span className="flex items-center gap-2">
                          <Github className="w-3.5 h-3.5 text-[#8b949e] shrink-0" />
                          <span className="text-xs text-white truncate font-medium">{r.fullName}</span>
                          {r.isPrivate && <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/20">private</span>}
                          {r.updatedAt > 0 && <span className="shrink-0 ml-auto text-[10px] text-[#484f58]">{relTime(r.updatedAt)}</span>}
                        </span>
                        {r.description && <span className="block mt-0.5 pl-5 text-[10px] text-[#8b949e] truncate">{r.description}</span>}
                      </button>
                    ))}
                </div>
                <p className="text-[10px] text-[#484f58]">Click a repo — it imports, opens in Files/IDE, boots the preview, and the AI surveys it. One click.</p>
              </div>
            ) : null}

            {/* SECONDARY: paste any repo URL (e.g. someone else's public repo) */}
            <div className="pt-1 border-t border-white/10 space-y-2">
              <label className="text-[10px] font-bold text-[#8b949e] uppercase tracking-widest">Or paste a repository URL</label>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={importUrl}
                  onChange={e => setImportUrl(e.target.value)}
                  placeholder="https://github.com/owner/repo"
                  className="flex-1 min-w-0 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-[#484f58] focus:outline-none focus:border-indigo-500/50"
                />
                <button
                  type="button"
                  onClick={() => { const u = importUrl.trim(); if (u) { setImportUrl(''); importRepo(u); } }}
                  disabled={running || importSending || !/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+/.test(importUrl.trim())}
                  className="shrink-0 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-bold rounded-xl touch-manipulation"
                >
                  Import
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * A live, waving Indian flag (tiranga) 🇮🇳 shown while an agent is working — replacing the old
 * loading spinner. The wave is driven by requestAnimationFrame writing an INLINE transform each
 * frame (not a CSS animation), so it cannot be killed by the global prefers-reduced-motion reset
 * that was freezing the spinner. When the work finishes, the caller swaps this for a green check.
 */
function WavingTiranga({ size = 16 }: { size?: number }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    let raf = 0;
    let start = 0;
    const tick = (t: number) => {
      // Respect the user's "Reduce Animations" choice (Settings → General): hold the flag static.
      if (document.documentElement.classList.contains('nb-reduce-motion')) {
        if (ref.current) ref.current.style.transform = 'none';
        raf = requestAnimationFrame(tick); // keep checking so it resumes if they toggle back
        return;
      }
      if (!start) start = t;
      const e = (t - start) / 1000;
      // Flutter: the trailing (right) edge swings while the pole (left) edge stays — a cloth-in-wind feel.
      const skew = Math.sin(e * 6) * 9;
      const rot = Math.sin(e * 6 + 0.9) * 3.2;
      const sy = 1 + Math.sin(e * 6) * 0.07;
      if (ref.current) ref.current.style.transform = `skewY(${skew}deg) rotate(${rot}deg) scaleY(${sy})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const h = Math.max(8, Math.round(size * 0.7));
  const chakra = Math.max(2.5, h / 3.2);
  return (
    <span
      ref={ref}
      role="img"
      aria-label="Indian flag waving"
      className="inline-flex flex-col rounded-[1.5px] overflow-hidden shrink-0 shadow-sm"
      style={{ width: size, height: h, transformOrigin: 'left center', willChange: 'transform' }}
    >
      <span style={{ flex: 1, background: '#FF9933' }} />
      <span style={{ flex: 1, background: '#ffffff', position: 'relative' }}>
        <span style={{ position: 'absolute', top: '50%', left: '50%', width: chakra, height: chakra, transform: 'translate(-50%,-50%)', borderRadius: '50%', border: '1px solid #000080' }} />
      </span>
      <span style={{ flex: 1, background: '#138808' }} />
    </span>
  );
}

/** Pick a small icon for an activity entry from its kind / action verb. */
function activityIcon(e: ActivityEntry): string {
  if (e.kind === 'file') return '📄';
  if (e.kind === 'agent') return '👥';
  if (e.kind === 'preview') return '🌐';
  if (e.kind === 'plan') return '🗒️';
  // tool — derive from the human verb so reading/writing/running each read distinctly.
  if (/^writing/.test(e.text)) return '✍️';
  if (/^editing/.test(e.text)) return '✏️';
  if (/^reading/.test(e.text)) return '📖';
  if (/^running/.test(e.text)) return '⌨️';
  if (/^searching|^listing/.test(e.text)) return '🔍';
  if (/^recalling/.test(e.text)) return '🧠';
  if (/^evaluating/.test(e.text)) return '🔬';
  return '⚙️';
}

function fmtClock(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

/**
 * Live, Claude-style "working…" indicator. Collapsed it shows the CURRENT action (the latest real
 * engine activity) + elapsed time + a chevron; expanded it reveals the full ordered activity log
 * (every tool call, file write, command, agent spawn, preview) plus todo progress — so the user can
 * see exactly what the build is doing instead of a frozen-looking "working… 12s". All entries are
 * REAL engine events (state.activity); no synthetic activity. Renders while running, and stays as a
 * collapsed "view activity" expander after the build finishes so the work is reviewable.
 */
function WorkingIndicator({ activity, todos, running }: { activity: ActivityEntry[]; todos: TodoItem[]; running: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const mountTsRef = useRef(Date.now());
  const logRef = useRef<HTMLDivElement | null>(null);

  // Tick the elapsed clock only while running (a finished build's time is frozen).
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  // Auto-scroll the expanded log to the newest entry (like a terminal/chat).
  useEffect(() => {
    if (expanded && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [expanded, activity.length]);

  const startTs = activity.length ? activity[0].ts : mountTsRef.current;
  const endTs = running ? nowTick : (activity.length ? activity[activity.length - 1].ts : startTs);
  const elapsed = fmtElapsed(endTs - startTs);

  // Current action: the newest still-in-flight tool, else the newest entry.
  const current = [...activity].reverse().find((a) => a.active) ?? activity[activity.length - 1];
  const headText = running
    ? (current ? current.text : 'working…')
    : `Done · ${activity.length} step${activity.length === 1 ? '' : 's'}`;

  const doneTodos = todos.filter((t) => t.status === 'done').length;

  return (
    <div className="text-xs text-zinc-500 w-full max-w-[90%]">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 w-full text-left hover:text-zinc-300 transition-colors"
        aria-expanded={expanded}
        title={expanded ? 'Hide activity' : 'Show what the build is doing'}
      >
        {running ? <WavingTiranga size={16} /> : <span className="text-emerald-400">✓</span>}
        <span className="truncate flex-1">{running && current ? activityIcon(current) + ' ' : ''}{headText}</span>
        {running && current?.active && <span className="inline-block w-1 h-3 bg-current animate-pulse shrink-0" />}
        <span className="shrink-0 tabular-nums text-zinc-600">{elapsed}</span>
        {activity.length > 0 && (expanded ? <ChevronDown className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />)}
      </button>

      {expanded && activity.length > 0 && (
        <div className="mt-1.5 ml-1 border-l border-zinc-800 pl-2.5">
          <div ref={logRef} className="max-h-52 overflow-auto space-y-1 pr-1">
            {activity.map((a) => (
              <div key={a.id} className="flex items-start gap-2 leading-relaxed">
                <span className="text-zinc-600 tabular-nums shrink-0">{fmtClock(a.ts)}</span>
                <span className="shrink-0">{activityIcon(a)}</span>
                <span className={`flex-1 break-words ${a.active ? 'text-zinc-300' : a.ok === false ? 'text-red-400' : 'text-zinc-500'}`}>
                  {a.text}
                  {a.active && <span className="inline-block w-1 h-3 ml-1 bg-current animate-pulse align-middle" />}
                  {!a.active && a.ok === false && ' ✗'}
                </span>
              </div>
            ))}
          </div>
          {todos.length > 0 && (
            <div className="mt-2 pt-2 border-t border-zinc-800 text-zinc-600">
              Tasks: {doneTodos}/{todos.length} done
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Smooth typewriter reveal. Provider chunks can arrive in bursts (a whole line at
 * once); this reveals the text at a steady character cadence so the typing always
 * looks smooth, then snaps to the full text the moment streaming ends. Reveal speed
 * auto-catches up when a lot of text is buffered, so it never lags far behind.
 */
function TypewriterText({ text, streaming }: { text: string; streaming?: boolean }) {
  const [shown, setShown] = useState(streaming ? 0 : text.length);
  useEffect(() => {
    if (!streaming) { setShown(text.length); return; }
    const id = setInterval(() => {
      setShown((s) => {
        if (s >= text.length) return s;
        const behind = text.length - s;
        // Steady ~2 chars/tick (~120 cps), but speed up if we're far behind so the
        // visible text never trails the real output by more than a moment.
        const step = behind > 240 ? Math.ceil(behind / 60) : 2;
        return Math.min(text.length, s + step);
      });
    }, 16);
    return () => clearInterval(id);
  }, [text, streaming]);
  return <>{streaming ? text.slice(0, Math.min(shown, text.length)) : text}</>;
}

function Bubble({ msg }: { msg: ChatMsg }) {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] bg-indigo-600 text-white rounded-2xl rounded-br-sm px-3 py-2 text-sm whitespace-pre-wrap break-words">{msg.text}</div>
      </div>
    );
  }
  const isThinking = msg.kind === 'thinking';
  const cursor = msg.streaming ? <span className="inline-block w-1.5 h-3.5 ml-0.5 align-middle bg-current animate-pulse" /> : null;
  return (
    <div className="flex justify-start">
      <div className="max-w-[90%]">
        {msg.agent && msg.agent !== 'architect' && (
          <div className="text-[10px] uppercase tracking-wide text-indigo-400 mb-0.5">{msg.agent}</div>
        )}
        <div
          className={
            isThinking
              ? 'text-zinc-500 italic text-xs px-3 py-2 whitespace-pre-wrap break-words'
              : 'bg-zinc-900 text-zinc-100 rounded-2xl rounded-bl-sm px-3 py-2 text-sm whitespace-pre-wrap break-words'
          }
        >
          <TypewriterText text={msg.text} streaming={msg.streaming} />{cursor}
        </div>
      </div>
    </div>
  );
}

/** Status icon for a single todo — lets the user watch the agent work through its plan live. */
function todoStatusIcon(status: TodoStatus) {
  switch (status) {
    case 'done': return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />;
    case 'in_progress': return <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin shrink-0" />;
    case 'blocked': return <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />;
    default: return <Circle className="w-3.5 h-3.5 text-zinc-600 shrink-0" />; // pending
  }
}

/**
 * R2 §4.6 — Build-health card. Shows the OBJECTIVE readiness verdict from the mandatory quality
 * gate (real `evaluate` scan): a 0–100 score, READY / NOT READY, and the exact blockers/warnings.
 * Honest by construction — the same gate that decides whether a build is reported as a success.
 */
/**
 * P-UX.6 — CSAT feedback on a finished build. Fires trackEvent('feedback', …) and remembers (per
 * workspace, in localStorage) so the user is asked at most once per build. Dependency-free.
 */
function BuildFeedback({ workspaceId }: { workspaceId: string }) {
  const key = `nbai:feedback:${workspaceId}`;
  const [rated, setRated] = useState<null | 'up' | 'down'>(() => {
    try { const v = localStorage.getItem(key); return v === 'up' || v === 'down' ? v : null; } catch { return null; }
  });
  const rate = (score: 'up' | 'down') => {
    if (rated) return;
    setRated(score);
    try { localStorage.setItem(key, score); } catch { /* ignore */ }
    try { trackEvent('feedback', { score: score === 'up' ? 1 : -1, surface: 'agentv3_build', workspaceId }); } catch { /* best-effort */ }
  };
  if (rated) {
    return <div className="mt-1 text-[11px] text-zinc-500">Thanks for the feedback{rated === 'down' ? ' — we’ll keep improving.' : '!'}</div>;
  }
  return (
    <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-500">
      <span>Was this build helpful?</span>
      <button onClick={() => rate('up')} aria-label="Helpful" className="p-1 rounded hover:bg-white/5 hover:text-emerald-400 transition-colors">
        <ThumbsUp className="w-3.5 h-3.5" />
      </button>
      <button onClick={() => rate('down')} aria-label="Not helpful" className="p-1 rounded hover:bg-white/5 hover:text-rose-400 transition-colors">
        <ThumbsDown className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function BuildHealthCard({ health }: { health: BuildHealth }) {
  const ready = health.ready;
  return (
    <div className={`mt-1 rounded-lg border px-2.5 py-1.5 text-[11px] ${ready ? 'border-emerald-800/60 bg-emerald-950/30' : 'border-amber-800/60 bg-amber-950/30'}`}>
      <div className="flex items-center gap-1.5 font-semibold">
        {ready
          ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          : <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
        <span className={ready ? 'text-emerald-300' : 'text-amber-300'}>Build health: {ready ? 'READY' : 'NOT READY'}</span>
        <span className="text-zinc-500">· {health.score}/100</span>
      </div>
      {health.blockers.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-amber-200/90">
          {health.blockers.slice(0, 6).map((b, i) => (
            <li key={`b${i}`} className="flex gap-1"><span className="text-amber-500">✗</span><span>{b}</span></li>
          ))}
        </ul>
      )}
      {health.warnings.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-zinc-400">
          {health.warnings.slice(0, 4).map((w, i) => (
            <li key={`w${i}`} className="flex gap-1"><span className="text-zinc-500">•</span><span>{w}</span></li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The agent's live plan/todo list with real status (done ✓ / in-progress ⏳ / pending ○ / blocked ⚠)
 * and a progress count — so the build is engaging and honest: the user sees exactly what the AI is
 * doing and how far along it is, driven by real `todo_updated` events (never a fake animation).
 */
function TodoList({ todos, hideHeader }: { todos: TodoItem[]; hideHeader?: boolean }) {
  if (!todos.length) return null;
  const done = todos.filter((t) => t.status === 'done').length;
  return (
    <div className="text-left">
      {!hideHeader && (
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 mb-1">
          <span>Plan</span>
          <span className="text-zinc-500">{done}/{todos.length}</span>
        </div>
      )}
      <ul className="space-y-1">
        {todos.map((t) => (
          <li key={t.id} className="flex items-center gap-1.5 text-xs">
            {todoStatusIcon(t.status)}
            <span className={t.status === 'done' ? 'line-through text-zinc-500' : 'text-zinc-200'}>{t.title}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}


function AgentChip({ card, running }: { card: AgentCard; running: boolean }) {
  // While the build is running, every team member shows a spinning ring (work in
  // progress). Once the build finishes, it turns into a green check. (Per-tool-call
  // active flags flicker between tools, so the chip tracks the whole-build state.)
  return (
    <div className="flex items-center gap-1 text-[11px] bg-zinc-900 rounded-full px-2 py-1" title={card.lastAction}>
      {running
        ? <WavingTiranga size={14} />
        : <CheckCircle2 className="w-3 h-3 text-emerald-500" />}
      <span className="font-medium capitalize text-zinc-200">{card.agent}</span>
    </div>
  );
}

function TabPill({ active, onClick, icon, children, dataTour }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode; dataTour?: string }) {
  return (
    <button
      onClick={onClick}
      data-tour={dataTour}
      className={`flex items-center gap-1 shrink-0 px-3 py-1 rounded-full text-xs border whitespace-nowrap ${
        active
          ? 'bg-indigo-600 border-indigo-500 text-white'
          : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:text-zinc-100 hover:border-zinc-600'
      }`}
    >
      {icon} {children}
    </button>
  );
}

function ToggleRow({ label, hint, checked, disabled, onClick }: { label: string; hint?: string; checked: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left disabled:opacity-40 ${
        checked ? 'text-indigo-200 bg-indigo-500/10' : 'text-zinc-300 hover:bg-zinc-800'
      }`}
    >
      <span className={`w-4 h-4 shrink-0 flex items-center justify-center rounded border ${checked ? 'bg-indigo-600 border-indigo-500 text-white' : 'border-zinc-600'}`}>
        {checked && <Check className="w-3 h-3" />}
      </span>
      <span className="flex-1">{label}</span>
      {hint && <span className="text-[10px] text-zinc-500">({hint})</span>}
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-xs text-zinc-600 italic">{children}</div>;
}

function fileDot(kind: string): string {
  const base = 'inline-block w-2 h-2 rounded-full ';
  if (kind === 'create') return base + 'bg-emerald-500';
  if (kind === 'delete') return base + 'bg-red-500';
  return base + 'bg-amber-500';
}

function colorizeDiff(patch: string): React.ReactNode {
  return patch.split('\n').map((line, i) => {
    const cls = line.startsWith('+') ? 'text-emerald-400' : line.startsWith('-') ? 'text-red-400' : 'text-zinc-400';
    return <div key={i} className={cls}>{line}</div>;
  });
}
