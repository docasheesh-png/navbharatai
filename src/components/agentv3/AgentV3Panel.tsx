import { useCallback, useEffect, useRef, useState } from 'react';
import { FilesPanel, type FilesPanelProps } from '../panels/FilesPanel';
import {
  Bot, Send, Square, Loader2, Terminal, FileDiff, FolderOpen,
  History, CheckCircle2, AlertCircle, Rocket, Globe, ExternalLink, RotateCcw, Play,
  SlidersHorizontal, Check, X, Paperclip, FileText, Download, Github, Circle,
  ChevronLeft, ChevronRight, ChevronDown,
  FileCode, Copy, Maximize2, Minimize2,
} from 'lucide-react';
import { useAgentV3Build } from '../../hooks/useAgentV3Build';
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
import { doc, setDoc } from 'firebase/firestore';

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

export function AgentV3Panel({ userId, email, resume, onFilesSync, onOpenInIDE, onPreviewState, filesPanel }: { userId?: string; email?: string; resume?: { sessionId: string; messages: ChatMsg[]; nonce: number } | null; onFilesSync?: (files: Record<string, string>) => void; onOpenInIDE?: (path: string) => void; onPreviewState?: (s: { previewUrl?: string; workspaceId?: string }) => void; filesPanel?: FilesPanelProps }) {
  const { state, running, error, start, respond, restore, restoreAllFiles, stop, reset, serverBuildRunning, resume: resumeBuild, checkRunning, loadConversation } = useAgentV3Build();
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
  const persistSessionId = (id: string) => {
    try { localStorage.setItem(sessionStorageKey, id); } catch { /* storage may be unavailable */ }
  };
  const sessionIdRef = useRef<string>('');
  if (!sessionIdRef.current) {
    let restored = '';
    try { restored = localStorage.getItem(sessionStorageKey) || ''; } catch { /* ignore */ }
    sessionIdRef.current = restored || newSessionId();
    if (!restored) persistSessionId(sessionIdRef.current);
  }

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
  ].sort((a, b) => a.ts - b.ts);

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
    if (!running) checkRunning({ userId, email });
  }, [userId, email, running, checkRunning]);

  // AUTO-RESUME on reload: when the server reports a build is still running but this
  // (freshly reloaded) UI isn't attached, re-attach automatically — the user should
  // never have to click "Resume" after a refresh. The button stays as a manual fallback.
  // Guarded so it fires once per detected running build.
  const autoResumedRef = useRef(false);
  // Layer 3 — how many times a paused (time-limit) build has been auto-continued this turn.
  const AUTO_CONTINUE_MAX = 2;
  const autoContinueRef = useRef(0);
  useEffect(() => {
    if (serverBuildRunning && !running && !autoResumedRef.current) {
      autoResumedRef.current = true;
      void resumeBuild({ userId, email });
    }
    if (!serverBuildRunning) autoResumedRef.current = false; // re-arm for the next time
  }, [serverBuildRunning, running, userId, email, resumeBuild]);

  // TAB SWITCH resilience: a backgrounded tab (esp. mobile Safari) suspends timers and
  // can silently drop the event stream. When the tab becomes visible again, immediately
  // reconcile with the server — re-attach a still-running build (via the auto-resume
  // effect above) so the build never looks "stopped" after a tab switch.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (!running) checkRunning({ userId, email });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [running, userId, email, checkRunning]);

  // D7 — on first open with a signed-in account, re-display the most recent persisted build's
  // chat history so a refresh/reconnect doesn't lose it (option (a): chat + git-restore). Runs
  // ONCE, and only when nothing is running and the panel is still empty, so it never clobbers a
  // live build or a thread already opened from History. Best-effort.
  const loadedConvoRef = useRef(false);
  useEffect(() => {
    if (loadedConvoRef.current || running || !userId || state.narration.length > 0 || userMsgs.length > 0) return;
    loadedConvoRef.current = true;
    void (async () => {
      const restored = await loadConversation({ userId, email });
      if (!restored) return;
      // RESUME THE SAME SESSION: adopt the sessionId of the restored (most-recent) conversation so a
      // follow-up message continues THAT exact workspace/memory — not a fresh one. This is what makes
      // "open v3.0 → reopen where I left off" reliable, independent of localStorage/auth timing.
      // sessionId is the tail of the workspaceId: `agentv3-{uid}-{sessionId}`. Only "New" starts fresh.
      if (restored.workspaceId) {
        const prefix = `agentv3-${normalizeUid(userId)}-`;
        if (restored.workspaceId.startsWith(prefix)) {
          const sid = restored.workspaceId.slice(prefix.length);
          if (sid) { sessionIdRef.current = sid; persistSessionId(sid); }
        }
      }
      // Restore the user's OWN messages too — the narration path only rebuilds the agent side, so
      // without this the user's bubbles vanish on reload (only AI replies would remain).
      if (restored.messages.length > 0) {
        setUserMsgs((cur) => (cur.length > 0 ? cur : restored.messages.map((m) => ({ role: 'user' as const, text: m.text, ts: m.ts }))));
      }
    })();
  }, [userId, email, running, state.narration.length, userMsgs.length, loadConversation]);

  // Resume a saved v3.0 conversation opened from History ("open chat"). Adopt its
  // sessionId so the backend continues with the SAME workspace/memory (best-effort,
  // if still warm) and restore its saved thread into the chat. Fires on each new
  // resume request (nonce change) — including when the panel mounts already-resumed.
  useEffect(() => {
    if (!resume) return;
    sessionIdRef.current = resume.sessionId;
    persistSessionId(resume.sessionId); // keep the reopened project sticky across reloads too
    reset();
    setUserMsgs(resume.messages.filter((m) => m.role === 'user'));
    setAgentHistory(resume.messages.filter((m) => m.role !== 'user'));
    setCheckpointHistory([]);
    setFiles([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resume?.nonce]);

  // Persist the v3.0 conversation into NavBharatAI's MAIN History (the sidebar
  // "History" option), using the SAME chat_sessions shape as Free/Pro/SDA chats.
  // Additive + best-effort: it only writes a new doc tagged 'agentv3' (so it shows
  // under All/Apps and never collides with other sources) when a turn completes
  // and the user is signed in; it never touches the shared history code paths.
  useEffect(() => {
    // Persist into the main History as soon as the build has a workspace + a first user message —
    // NOT only on completion. A timed-out / interrupted v3.0 build used to be saved ONLY on
    // state.done, so reopening it from History showed "Session not found". Now the same doc (keyed
    // by the stable sessionId) is written on build start AND updated on finish / stop / timeout, so
    // every v3.0 session is always in History and restorable. Best-effort; merge so partial writes
    // never clobber a later, fuller one.
    if (!userId || !sessionIdRef.current) return;
    const thread = convo;
    const firstUser = thread.find((m) => m.role === 'user')?.text;
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
        memory_summary: '',
        edit_log: [],
        restoredMessages: [],
        messages: thread.map((m) => ({
          id: String(m.ts),
          text: m.text,
          sender: m.role === 'user' ? 'user' : 'ai',
          timestamp: new Date(m.ts).toISOString(),
        })),
        files: {},
        lastUpdated: new Date().toISOString(),
        isPinned: false,
        mode: 'build',
      }),
      { merge: true },
    ).catch(() => { /* history save is best-effort — never blocks the UI */ });
    // Fires on build start (workspaceId), completion (done), and stop/timeout (running). `convo` is
    // read at that moment — recent enough for the title + thread.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.workspaceId, state.done, running, userId]);

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

  const send = async () => {
    const text = prompt.trim();
    if ((!text && files.length === 0) || running) return;
    // A fresh user message resets the Layer-3 auto-continue budget for the new turn.
    autoContinueRef.current = 0;
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
    const attachments = files.length > 0 ? await Promise.all(files.map(fileToAttachment)) : undefined;
    // A file with no text gets a sensible default prompt (the server requires one).
    const msgText = text || (files.length > 0 ? `Please read and analyze the attached file(s): ${files.map((f) => f.name).join(', ')}` : '');
    const displayText = text || `📎 ${files.map((f) => f.name).join(', ')}`;
    setUserMsgs((c) => [...c, { role: 'user', text: displayText, ts: Date.now() }]);
    setPrompt('');
    setFiles([]);
    const pendingImportUrl = importUrl.trim();
    setImportUrl(''); // consume import URL on first send
    start(msgText, { userId, email, onlyOpus, powerLevel, planFirst, thinking, sessionId: sessionIdRef.current, attachments, framework, importUrl: pendingImportUrl || undefined });
  };

  // ── Layer 3: bounded auto-continue ──────────────────────────────────────────────
  // When a build PAUSES at the wall-clock limit (resumable), automatically resume the SAME
  // project without the user typing "continue" — up to AUTO_CONTINUE_MAX times so a genuinely
  // stuck build can never loop forever or rack up unbounded cost. After the budget, we hand back
  // to the user honestly. Reuses the proven resume path (start('continue', …)); no build-loop surgery.
  useEffect(() => {
    if (!state.done || !state.resumable || running) return;
    if (autoContinueRef.current >= AUTO_CONTINUE_MAX) {
      setAgentHistory((h) => [
        ...h,
        { role: 'agent' as const, agent: 'architect', text: 'This build is taking longer than the time limit allows even after auto-continuing. Type **"continue"** and I will keep finishing it.', ts: Date.now() },
      ]);
      return;
    }
    autoContinueRef.current += 1;
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

  // Start a brand-new project: fresh sandbox/memory (new session id) and clear chat.
  const startNewSession = () => {
    if (running) return;
    sessionIdRef.current = newSessionId();
    persistSessionId(sessionIdRef.current); // the new project is now the sticky one across reloads
    setWorkspaceFiles(null);
    setSelectedFile(null);
    setUserMsgs([]);
    setAgentHistory([]);
    setCheckpointHistory([]);
    setFiles([]);
    reset();
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
  const getLatestDiagnostics = useCallback(async (): Promise<unknown> => {
    try {
      const params = new URLSearchParams();
      if (userId) params.set('userId', userId);
      if (email) params.set('email', email);
      if (state.workspaceId) params.set('workspaceId', state.workspaceId);
      const res = await fetch(`/api/agentv3/diagnostics?${params.toString()}`, { headers: await authJsonHeaders() });
      if (res.ok) {
        const data = await res.json() as { diagnostics?: unknown };
        if (data.diagnostics) return data.diagnostics;
      }
    } catch { /* fall through to the local copy */ }
    return state.diagnostics ?? null;
  }, [userId, email, state.workspaceId, state.diagnostics]);

  const downloadDiagnostics = async () => {
    if (downloadingDiag) return;
    setDownloadingDiag(true);
    try {
      const diagnostics = await getLatestDiagnostics();
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

  // One-tap COPY of the build report to the clipboard — so it can be pasted straight into a support
  // chat without the download → find-file → upload dance. Uses the same client copy / durable
  // server fallback as the download.
  const [copyingDiag, setCopyingDiag] = useState(false);
  const copyDiagnostics = async () => {
    if (copyingDiag) return;
    setCopyingDiag(true);
    try {
      const diagnostics = await getLatestDiagnostics();
      if (!diagnostics) { alert('No build report yet — build an app first.'); return; }
      await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
      alert('Build report copied — paste it into the chat to share it.');
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
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string>('');
  // Heavy generated dirs are never shown/synced — the user cares about source.
  const FILE_EXCLUDE = /^(node_modules\/|\.git\/|dist\/|build\/|\.next\/|__pycache__\/)/;

  const loadWorkspaceFiles = async (): Promise<Record<string, string> | null> => {
    const wsId = state.workspaceId;
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
  useEffect(() => {
    onPreviewState?.({ previewUrl: state.previewUrl, workspaceId: state.workspaceId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.previewUrl, state.workspaceId]);

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
                onClick={() => resumeBuild({ userId, email })}
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
          ) : (
            <button
              onClick={startNewSession}
              disabled={running}
              title="Start a new project (fresh sandbox + memory)"
              className="ml-auto flex items-center gap-1 text-xs text-zinc-400 hover:text-white disabled:opacity-40 border border-zinc-700 rounded px-2 py-1"
            >
              <RotateCcw className="w-3.5 h-3.5" /> New
            </button>
          )}
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
            title="Download the diagnostics report from your last build — every issue v3.0 hit (provider fallbacks, tool errors, readiness blockers, sandbox problems). Send it to support to get the build engine improved."
            className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {downloadingDiag ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
            {downloadingDiag ? 'Preparing…' : 'Build report'}
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
            {convo.map((m, i) => <Bubble key={i} msg={m} />)}
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
            {state.done && state.buildHealth && <BuildHealthCard health={state.buildHealth} />}
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
              onFixError={(errText) => {
                // P-UX.3 — prepopulate the chat with the preview error and bring the chat into view
                // (collapse the workspace) so the user can review and send the fix request.
                setPrompt(
                  `The in-browser preview failed to build with this error:\n\n${errText}\n\n` +
                    'Please find the cause in the project files and fix it so the app builds and runs.',
                );
                setShowWorkspace(false);
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
                  {allCheckpoints.length === 0 ? <Empty>No checkpoints yet.</Empty> : (
                    <ul className="space-y-1">
                      {allCheckpoints.map((c) => (
                        <li key={c.id} className="flex items-center gap-2">
                          <History className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                          <span className="text-zinc-500 shrink-0">{c.sha.slice(0, 7) || '—'}</span>
                          <span className="flex-1 truncate">{c.message}</span>
                          {c.sha && (
                            <button onClick={() => restore(c.sha)} className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 shrink-0" title="Restore to this checkpoint">
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
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-[#8b949e] uppercase tracking-widest">Repository URL</label>
              <input
                type="url"
                value={importUrl}
                onChange={e => setImportUrl(e.target.value)}
                placeholder="https://github.com/username/my-app"
                className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-[#484f58] focus:outline-none focus:border-indigo-500/50"
              />
              <p className="text-[10px] text-[#484f58]">
                Public repos work without a token. For private repos, make sure you've signed in with GitHub in Settings → Connections.
              </p>
            </div>
            {importUrl.trim() && (
              <div className="flex items-center gap-2 px-3 py-2 bg-green-500/10 border border-green-500/20 rounded-lg">
                <Github className="w-3.5 h-3.5 text-green-400 shrink-0" />
                <span className="text-[11px] text-green-300 truncate">{importUrl.trim()}</span>
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => { setImportUrl(''); setShowImportModal(false); }}
                className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 text-zinc-300 text-sm font-medium rounded-xl transition-all"
              >
                Clear
              </button>
              <button
                onClick={() => setShowImportModal(false)}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl transition-all"
              >
                {importUrl.trim() ? 'Set Import' : 'Close'}
              </button>
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
