import { useCallback, useEffect, useRef, useState } from 'react';
import {
  HardHat, Loader2, Send, Square, Terminal, FolderOpen, Globe,
  CheckCircle2, AlertCircle, ChevronRight, Play, FileDiff, RotateCcw,
  ExternalLink, RefreshCw, History, Rocket, Copy, Check, Database,
  ImagePlus, X, ChevronDown, ChevronUp,
} from 'lucide-react';

interface ChatMessage {
  id: string;
  role: 'user' | 'agent' | 'system';
  text: string;
}

interface TerminalEntry {
  id: string;
  command: string;
  output: string;
  exitCode: number;
}

interface BrowseEntry {
  url: string;
  content: string;
}

interface ScreenshotEntry {
  url: string;
  base64: string;
  timestamp: number;
  cursorX?: number;
  cursorY?: number;
}

interface FilePair {
  current: string;
  previous?: string;
}

interface CheckpointEntry {
  id: string;
  createdAt: number;
  triggeredBy: string;
}

interface EngineerAIChatProps {
  userId?: string;
}

const WELCOME: ChatMessage = {
  id: 'welcome',
  role: 'agent',
  text: "Hi, I'm Engineer AI — your autonomous coding agent. Describe what you want to build or fix, and I'll plan, code, run commands, and verify the build until it's done.",
};

function uid() { return `${Date.now()}_${Math.random().toString(36).slice(2)}`; }

type WorkspaceTab = 'terminal' | 'files' | 'browser' | 'checkpoints';

type DbProvider = 'supabase' | 'firebase' | 'mongodb' | 'neon' | 'appwrite' | 'other';

interface DbConfig {
  provider: DbProvider;
  platformName?: string;
  credentials: Record<string, string>;
}

// Simple LCS-based diff (capped at 300 lines each side to stay fast)
function computeDiff(oldText: string, newText: string): Array<{ line: string; type: 'add' | 'remove' | 'same' }> {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const m = Math.min(oldLines.length, 300);
  const n = Math.min(newLines.length, 300);
  const oSlice = oldLines.slice(0, m);
  const nSlice = newLines.slice(0, n);

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = oSlice[i] === nSlice[j]
        ? 1 + dp[i + 1][j + 1]
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const result: Array<{ line: string; type: 'add' | 'remove' | 'same' }> = [];
  let i = 0, j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && oSlice[i] === nSlice[j]) {
      result.push({ line: oSlice[i], type: 'same' }); i++; j++;
    } else if (j < n && (i >= m || dp[i + 1][j] >= dp[i][j + 1])) {
      result.push({ line: nSlice[j], type: 'add' }); j++;
    } else {
      result.push({ line: oSlice[i], type: 'remove' }); i++;
    }
  }
  return result;
}

export function EngineerAIChat({ userId }: EngineerAIChatProps) {
  // Session-persistent messages: restore from localStorage on mount
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    if (!userId) return [WELCOME];
    try {
      const stored = localStorage.getItem(`engineer_msgs_${userId}`);
      if (stored) return JSON.parse(stored) as ChatMessage[];
    } catch {}
    return [WELCOME];
  });

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [currentStep, setCurrentStep] = useState(0);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('terminal');
  // Mobile-only: collapse the workspace panel (Terminal/Files/Browser/History) down
  // to just its tab bar so the chat gets the full screen. Toggle lives in the tab bar.
  const [workspaceCollapsed, setWorkspaceCollapsed] = useState(false);
  const [terminalEntries, setTerminalEntries] = useState<TerminalEntry[]>([]);
  const [fileMap, setFileMap] = useState<Record<string, FilePair>>({});
  const [editOrder, setEditOrder] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [browseHistory, setBrowseHistory] = useState<BrowseEntry[]>([]);
  const [screenshots, setScreenshots] = useState<ScreenshotEntry[]>([]);
  const [iframeSrc, setIframeSrc] = useState<string | null>(null);
  const [browserUrlInput, setBrowserUrlInput] = useState('');
  // Phase 6.5 — Visible AI Cursor
  const [isDriving, setIsDriving] = useState(false);
  // Live frame during a drive action (replaces the screenshot array for instant streaming)
  const [liveFrame, setLiveFrame] = useState<ScreenshotEntry | null>(null);
  // Phase 8 — Checkpoints + Rollback
  const [checkpoints, setCheckpoints] = useState<CheckpointEntry[]>([]);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  // Phase 9A — Live preview polling
  const [livePreviewShot, setLivePreviewShot] = useState<string | null>(null);
  const livePreviewUrlRef = useRef<string | null>(null);
  const livePreviewTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Transient click flash (x%, y%) shown on the screenshot when user clicks it
  const [clickFlash, setClickFlash] = useState<{ x: number; y: number } | null>(null);
  // Phase 9B — One-click Deploy
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);
  // Phase 10 — Backend ready indicator
  const [backendReady, setBackendReady] = useState<{ features: string[]; dbUrl: string } | null>(null);

  // Phase 14 — BYOD: read DB config from localStorage (configured in Settings → App Settings → Database).
  // Passed with every /api/engineer-chat request so the agent knows which SDK to scaffold.
  const [dbConfig] = useState<DbConfig | null>(() => {
    try {
      const key = userId ? `engineer_db_${userId}` : 'engineer_db_anon';
      const stored = localStorage.getItem(key);
      if (stored) return JSON.parse(stored) as DbConfig;
    } catch {}
    return null;
  });

  // Phase 12C/12D — image the user attached to the next message (design-to-code / asset).
  const [attachedImage, setAttachedImage] = useState<{ base64: string; mimeType: string; filename: string } | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const workspaceIdRef = useRef<string>((() => {
    if (!userId) return `ws_anon_${Date.now()}`;
    const key = `engineer_ws_${userId}`;
    const stored = localStorage.getItem(key);
    if (stored) return stored;
    const fresh = `ws_${userId}_${Date.now()}`;
    localStorage.setItem(key, fresh);
    return fresh;
  })());

  // Persistent E2B sandbox ID — lets the next session resume the same workspace
  // (files, node_modules, running dev server). Stored per-workspace in localStorage.
  const sandboxIdRef = useRef<string | null>((() => {
    try { return localStorage.getItem(`engineer_sandbox_${workspaceIdRef.current}`); } catch { return null; }
  })());
  const setSandboxId = (id: string | null) => {
    sandboxIdRef.current = id;
    try {
      const key = `engineer_sandbox_${workspaceIdRef.current}`;
      if (id) localStorage.setItem(key, id); else localStorage.removeItem(key);
    } catch { /* private mode — keep in-memory only */ }
  };

  // Persist messages (last 60) whenever they change
  useEffect(() => {
    if (!userId) return;
    try {
      const toSave = messages.slice(-60);
      localStorage.setItem(`engineer_msgs_${userId}`, JSON.stringify(toSave));
    } catch { /* quota exceeded or private mode — silently skip */ }
  }, [messages, userId]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => { terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [terminalEntries]);

  // Pause the sandbox when the user leaves Engineer AI (unmount or tab close) so
  // it stops billing compute while preserving full state for the next resume.
  useEffect(() => {
    const pause = () => {
      const id = sandboxIdRef.current;
      if (!id) return;
      // Don't freeze the sandbox while a build/stream is in-flight — pausing
      // mid-operation can corrupt an in-progress install/build. readerRef is set
      // only while a request is actively streaming.
      if (readerRef.current) return;
      try {
        fetch('/api/engineer-pause', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sandboxId: id }),
          keepalive: true, // survives page unload
        }).catch(() => {});
      } catch { /* ignore */ }
    };
    window.addEventListener('pagehide', pause);
    return () => {
      window.removeEventListener('pagehide', pause);
      pause(); // component unmount (navigated away within the SPA)
    };
  }, []);

  // Phase 9A — Live preview polling: every 3 s when a dev server is running,
  // fetch a screenshot from the agent's Playwright viewport and update the
  // browser tab so the user always sees the latest state even mid-build.
  const startLivePreview = useCallback((url: string) => {
    livePreviewUrlRef.current = url;
    if (livePreviewTimerRef.current) clearInterval(livePreviewTimerRef.current);
    livePreviewTimerRef.current = setInterval(async () => {
      if (!livePreviewUrlRef.current) return;
      try {
        const res = await fetch(`/api/engineer-preview/${workspaceIdRef.current}?url=${encodeURIComponent(livePreviewUrlRef.current)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.base64) setLivePreviewShot(data.base64);
        }
      } catch { /* non-fatal */ }
    }, 3000);
  }, []);

  const stopLivePreview = useCallback(() => {
    livePreviewUrlRef.current = null;
    setLivePreviewShot(null);
    if (livePreviewTimerRef.current) { clearInterval(livePreviewTimerRef.current); livePreviewTimerRef.current = null; }
  }, []);

  // Stop polling on unmount
  useEffect(() => () => stopLivePreview(), [stopLivePreview]);

  const appendChat = (role: ChatMessage['role'], text: string) =>
    setMessages(prev => [...prev, { id: uid(), role, text }]);

  const addTerminalEntry = (command: string, output: string, exitCode: number) => {
    setTerminalEntries(prev => [...prev, { id: uid(), command, output, exitCode }]);
    setActiveTab('terminal');
  };

  const handleEvent = (event: any) => {
    switch (event.type) {
      case 'status':
        setStatusMsg(event.message || '');
        break;
      case 'chat_reply':
        // Pure conversational reply — show as a normal agent message, no coding started.
        appendChat('agent', event.message || '');
        break;
      case 'action_start':
        setCurrentStep(event.step || 0);
        setStatusMsg(`Step ${event.step}: ${event.action}`);
        appendChat('agent', `[Step ${event.step}] 💭 ${event.thought}`);
        break;
      case 'command_result':
        addTerminalEntry(event.command, event.output || '', event.exitCode ?? 0);
        break;
      case 'files_changed': {
        const files: { path: string; content: string }[] = event.files || [];
        setFileMap(prev => {
          const next = { ...prev };
          for (const f of files) {
            next[f.path] = { current: f.content, previous: prev[f.path]?.current };
          }
          return next;
        });
        setEditOrder(prev => {
          const merged = [...prev];
          for (const f of files) { if (!merged.includes(f.path)) merged.push(f.path); }
          return merged;
        });
        if (files.length > 0) setSelectedFile(files[files.length - 1].path);
        setActiveTab('files');
        appendChat(
          'system',
          `${event.kind === 'patch' ? 'Patched' : 'Edited'}: ${files.map((f: { path: string }) => f.path).join(', ')}`
        );
        break;
      }
      case 'build_result':
        addTerminalEntry('npm run build', event.logs || '', event.success ? 0 : 1);
        if (event.success) {
          appendChat('system', '🔨 Build passed');
        } else {
          // Show first meaningful error line in chat; full log is in terminal
          const firstErr = (event.logs || '')
            .split('\n')
            .find((l: string) => /error|failed|cannot/i.test(l))
            ?.trim()
            .slice(0, 120);
          appendChat('system', `❌ Build failed${firstErr ? ` — ${firstErr}` : ''} (see Terminal tab)`);
        }
        break;
      case 'browse_result':
        setBrowseHistory(prev => [...prev, { url: event.url, content: event.content }]);
        setActiveTab('browser');
        appendChat('system', `Browsed: ${event.url}`);
        break;
      case 'screenshot_result':
        setScreenshots(prev => [...prev, { url: event.url, base64: event.base64, timestamp: Date.now() }]);
        setActiveTab('browser');
        appendChat('system', `📸 Screenshot: ${event.url}`);
        break;
      case 'browser_action_result':
        // drive_complete sub-type is emitted at end of a drive sequence — don't add a duplicate
        // chat message (the drive_frame events already showed the activity).
        if (event.action !== 'drive_complete') {
          appendChat('system', `🖱️ ${event.detail || event.action}`);
        }
        setScreenshots(prev => [...prev, {
          url: event.detail || event.action,
          base64: event.base64,
          timestamp: Date.now(),
          cursorX: event.cursorX,
          cursorY: event.cursorY,
        }]);
        setActiveTab('browser');
        // Clear live frame once the final browser_action_result lands
        if (event.action === 'drive_complete') setLiveFrame(null);
        break;
      case 'drive_frame':
        // Live cursor frame — update in place (don't accumulate), switch to browser tab
        setLiveFrame({
          url: event.url,
          base64: event.screenshot,
          timestamp: Date.now(),
          cursorX: event.cursorX,
          cursorY: event.cursorY,
        });
        setIsDriving(true);
        setActiveTab('browser');
        break;
      case 'console_error': {
        const errs: { kind: string; text: string }[] = event.errors || [];
        if (errs.length > 0) {
          const lines = errs.map(e => `⚠️ [${e.kind}] ${e.text}`).join('\n');
          appendChat('system', `Runtime errors in live app:\n${lines}`);
        }
        break;
      }
      case 'search_result': {
        const results: { title: string; url: string }[] = event.results || [];
        const lines = results.length
          ? results.map(r => `• ${r.title}\n  ${r.url}`).join('\n')
          : '(no results)';
        appendChat('system', `🔍 Searched "${event.query}":\n${lines}`);
        break;
      }
      case 'checkpoint_created':
        setCheckpoints(prev => [...prev, { id: event.checkpointId, createdAt: event.createdAt, triggeredBy: event.triggeredBy }]);
        break;
      case 'workspace_saved':
        // Remember the sandbox so the next session resumes this exact workspace.
        if (event.sandboxId) setSandboxId(event.sandboxId);
        break;
      case 'server_ready':
        setIframeSrc(event.url);
        setBrowserUrlInput(event.url);
        setActiveTab('browser');
        appendChat('agent', `🚀 Dev server running on port ${event.port} — live preview ready`);
        startLivePreview(event.url);
        break;
      case 'deployed':
        setPublishedUrl(event.url);
        appendChat('agent', `🌐 Live preview URL: ${event.url}`);
        break;
      case 'deploy_result':
        setPublishedUrl(event.url);
        appendChat('agent', `🚀 Deployed! Permanent URL: ${event.url}`);
        break;
      case 'backend_ready':
        setBackendReady({ features: event.features || [], dbUrl: event.dbUrl || '' });
        appendChat('agent', `🗄️ Backend ready! DB + auth provisioned. Scaffold files: ${(event.scaffoldFiles || []).join(', ')}`);
        break;
      case 'backend_provisioned':
        appendChat('agent', `🗄️ Database scaffolded for ${event.provider}. Files written: ${(event.filesWritten || []).join(', ')}`);
        break;
      case 'complete':
        setStatusMsg('');
        setCurrentStep(0);
        setIsDriving(false);
        setLiveFrame(null);
        // Conversational reply already showed the message — don't double-up with a "Done" line.
        if (event.summary !== 'Replied.') {
          appendChat('agent', `✅ Done in ${event.steps} step${event.steps === 1 ? '' : 's'}: ${event.summary}`);
        }
        break;
      case 'max_steps_reached':
        setStatusMsg('');
        setCurrentStep(0);
        setIsDriving(false);
        setLiveFrame(null);
        appendChat('system', `⚠️ Reached ${event.steps}-step limit. Task incomplete — try breaking it into smaller steps or tap ↺ to start a fresh workspace.`);
        break;
      case 'aborted':
        setStatusMsg('');
        setIsDriving(false);
        setLiveFrame(null);
        appendChat('system', 'Stopped.');
        break;
      case 'error':
        setStatusMsg('');
        setIsDriving(false);
        setLiveFrame(null);
        appendChat('system', `Error: ${event.message}`);
        break;
    }
  };

  const handleStop = () => {
    readerRef.current?.cancel().catch(() => {});
  };

  // BUG FIX (C3): allow starting a fresh workspace — clears the persisted workspace ID
  // so the next send creates a new empty directory and avoids inheriting a broken state.
  const handleNewWorkspace = () => {
    if (loading) return;
    // Pause + forget the old sandbox so we don't keep paying for an orphaned VM.
    const oldSandbox = sandboxIdRef.current;
    if (oldSandbox) {
      try {
        fetch('/api/engineer-pause', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sandboxId: oldSandbox }),
          keepalive: true,
        }).catch(() => {});
      } catch { /* ignore */ }
    }
    try { localStorage.removeItem(`engineer_sandbox_${workspaceIdRef.current}`); } catch {}
    sandboxIdRef.current = null;
    if (userId) {
      try { localStorage.removeItem(`engineer_ws_${userId}`); } catch {}
      try { localStorage.removeItem(`engineer_msgs_${userId}`); } catch {}
    }
    const fresh = userId ? `ws_${userId}_${Date.now()}` : `ws_anon_${Date.now()}`;
    if (userId) {
      try { localStorage.setItem(`engineer_ws_${userId}`, fresh); } catch {}
    }
    workspaceIdRef.current = fresh;
    setMessages([WELCOME]);
    setTerminalEntries([]);
    setFileMap({});
    setEditOrder([]);
    setSelectedFile(null);
    setIframeSrc(null);
    setBrowserUrlInput('');
    setBrowseHistory([]);
    setScreenshots([]);
    setCurrentStep(0);
    setStatusMsg('');
    setIsDriving(false);
    setLiveFrame(null);
    setCheckpoints([]);
    setRestoringId(null);
    stopLivePreview();
    setPublishedUrl(null);
    setPublishing(false);
    setBackendReady(null);
    setAttachedImage(null);
  };

  const handleRestore = async (checkpointId: string) => {
    if (loading || restoringId) return;
    setRestoringId(checkpointId);
    try {
      const res = await fetch('/api/engineer-restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: workspaceIdRef.current, checkpointId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `${res.status}`);
      }
      appendChat('system', `↩️ Restored to checkpoint ${checkpointId.slice(-13)}`);
    } catch (err: any) {
      appendChat('system', `❌ Restore failed: ${err?.message}`);
    } finally {
      setRestoringId(null);
    }
  };

  // Phase 9B — One-click Publish
  const handlePublish = async () => {
    if (publishing) return;
    setPublishing(true);
    try {
      const res = await fetch('/api/engineer-deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: workspaceIdRef.current }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `${res.status}`); }
      const { url } = await res.json();
      setPublishedUrl(url);
      appendChat('agent', `🌐 Published! Your app is live at: ${url}`);
    } catch (err: any) {
      appendChat('system', `❌ Publish failed: ${err?.message}`);
    } finally {
      setPublishing(false);
    }
  };

  // Phase 9A — User click on live preview screenshot: relay coordinates to agent
  const handlePreviewClick = async (e: React.MouseEvent<HTMLImageElement>) => {
    const rect = (e.currentTarget as HTMLImageElement).getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * 1280);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * 720);
    // Flash indicator at click position (percentage of image)
    const flashX = ((e.clientX - rect.left) / rect.width) * 100;
    const flashY = ((e.clientY - rect.top) / rect.height) * 100;
    setClickFlash({ x: flashX, y: flashY });
    setTimeout(() => setClickFlash(null), 800);
    // Relay to agent
    try {
      await fetch('/api/engineer-browser-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: workspaceIdRef.current, x, y }),
      });
    } catch { /* non-fatal */ }
  };

  // Phase 12C/12D — read a picked image file into base64 (data-URL prefix stripped).
  const handlePickImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      appendChat('system', 'Only image files can be attached.');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      appendChat('system', 'Image too large (max 8 MB).');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const base64 = dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl;
      setAttachedImage({ base64, mimeType: file.type, filename: file.name });
    };
    reader.readAsDataURL(file);
  };

  const handleSend = async () => {
    const instruction = input.trim();
    if (!instruction || loading) return;
    const sendImage = attachedImage;
    setInput('');
    setAttachedImage(null);
    appendChat('user', sendImage ? `${instruction}\n🖼️ attached: ${sendImage.filename}` : instruction);
    setLoading(true);
    setStatusMsg('');
    setCurrentStep(0);
    setFileMap({});
    setEditOrder([]);
    setSelectedFile(null);
    setIframeSrc(null);
    setBrowserUrlInput('');
    setScreenshots([]);
    setIsDriving(false);
    setLiveFrame(null);
    setCheckpoints([]);
    setRestoringId(null);
    stopLivePreview();
    setPublishedUrl(null);
    setPublishing(false);
    setBackendReady(null);

    try {
      const res = await fetch('/api/engineer-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: workspaceIdRef.current,
          instruction,
          resumeSandboxId: sandboxIdRef.current || undefined,
          attachedImage: sendImage || undefined,
          dbConfig: dbConfig || undefined,
        }),
      });
      if (!res.ok || !res.body) throw new Error(`API error: ${res.status}`);

      const reader = res.body.getReader();
      readerRef.current = reader;
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // NDJSON: one JSON object per line; keep the incomplete trailing chunk in buffer
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const event = JSON.parse(trimmed);
            if (event.type !== 'ping') handleEvent(event);
          } catch { /* ignore malformed frame */ }
        }
      }
    } catch (err: any) {
      // Show ALL errors including AbortError — helps diagnose silent failures on mobile.
      // AbortError from the Stop button is rare here since that cancels via the reader.
      appendChat('system', `Error: ${err?.message || 'Engineer AI failed.'}`);
    } finally {
      readerRef.current = null;
      setLoading(false);
      setStatusMsg('');
    }
  };

  const tabClass = (t: WorkspaceTab) =>
    `px-4 py-2 text-xs font-medium transition-colors ${
      activeTab === t
        ? 'text-white border-b-2 border-indigo-500'
        : 'text-[#8b949e] hover:text-white border-b-2 border-transparent'
    }`;

  // During a drive action, show the live frame (cursor moving in real-time).
  // Outside a drive action, show the latest screenshot from the array.
  const displayShot = !iframeSrc ? (liveFrame || (screenshots.length > 0 ? screenshots[screenshots.length - 1] : null)) : null;
  const latestBrowse = (!iframeSrc && !displayShot) ? browseHistory[browseHistory.length - 1] : null;
  const latestScreenshot = displayShot;
  const selectedPair = selectedFile ? fileMap[selectedFile] : null;
  const hasDiff = !!(selectedPair?.previous && selectedPair.previous !== selectedPair.current);
  const diffLines = hasDiff && showDiff
    ? computeDiff(selectedPair!.previous!, selectedPair!.current)
    : null;

  return (
    // Phase 12F — stack chat/workspace vertically on mobile, side-by-side on md+.
    // Desktop behavior is preserved exactly by the md: overrides.
    <div className="flex flex-col md:flex-row h-full min-h-0 bg-[#0d1117]">
      {/* ── Left panel: Chat ── */}
      <div className={`w-full ${workspaceCollapsed ? 'flex-1' : 'h-1/2'} md:w-2/5 md:h-full flex flex-col border-b md:border-b-0 md:border-r border-white/5 min-w-0 min-h-0`}>
        {/* Header */}
        <div className="px-4 py-3 border-b border-white/5 flex items-center gap-2.5 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center">
            <HardHat className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold text-white leading-tight">Engineer AI</h2>
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="text-[10px] text-[#8b949e]">Workspace: {workspaceIdRef.current.slice(-10)}</p>
              {backendReady && (
                <span
                  className="flex items-center gap-1 text-[9px] font-medium text-green-300 bg-green-500/10 border border-green-500/20 px-1.5 py-0.5 rounded-full"
                  title={`DB: ${backendReady.dbUrl || 'local'} · Features: ${backendReady.features.join(', ')}`}
                >
                  <Database className="w-2.5 h-2.5" />
                  DB ready
                </span>
              )}
            </div>
          </div>
          {/* BUG FIX (C3): New Workspace button — clears broken/stale workspace state */}
          <button
            onClick={handleNewWorkspace}
            disabled={loading}
            title="Start new workspace"
            className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 text-[#8b949e] hover:text-white flex items-center justify-center transition-colors disabled:opacity-30"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-3 space-y-2.5">
          {messages.map(m => (
            <div
              key={m.id}
              className={`max-w-[90%] rounded-xl px-3 py-2 text-[12.5px] whitespace-pre-wrap leading-relaxed ${
                m.role === 'user'
                  ? 'ml-auto bg-indigo-600 text-white'
                  : m.role === 'system'
                    ? 'bg-white/4 text-[#8b949e] text-[11px] font-mono'
                    : 'bg-[#161b22] border border-white/10 text-white'
              }`}
            >
              {m.text}
            </div>
          ))}
          {loading && (
            <div className="flex items-center gap-1.5 text-[#8b949e] text-xs">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>{statusMsg || 'Working…'}{currentStep > 0 ? ` (${currentStep}/24)` : ''}</span>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <div className="border-t border-white/5 shrink-0">
          {attachedImage && (
            <div className="px-3 pt-2 flex items-center gap-2">
              <span className="flex items-center gap-1.5 text-[11px] text-indigo-200 bg-indigo-500/10 border border-indigo-500/20 px-2 py-1 rounded-lg max-w-[200px]">
                <ImagePlus className="w-3 h-3 shrink-0" />
                <span className="truncate">{attachedImage.filename}</span>
                <button onClick={() => setAttachedImage(null)} title="Remove image" className="shrink-0 hover:text-white">
                  <X className="w-3 h-3" />
                </button>
              </span>
            </div>
          )}
          <div className="p-3 flex items-end gap-2">
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            onChange={handlePickImage}
            className="hidden"
          />
          <button
            onClick={() => imageInputRef.current?.click()}
            disabled={loading}
            title="Attach an image (design to copy, or a logo/photo asset)"
            className="w-9 h-9 rounded-xl bg-[#161b22] border border-white/10 text-[#8b949e] hover:text-white hover:border-indigo-500/40 flex items-center justify-center shrink-0 disabled:opacity-40 transition-colors"
          >
            <ImagePlus className="w-3.5 h-3.5" />
          </button>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
            }}
            placeholder="Describe what to build or fix…"
            disabled={loading}
            rows={2}
            className="flex-1 bg-[#161b22] border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-[#586069] focus:outline-none focus:border-indigo-500/40 resize-none"
          />
          {loading ? (
            <button
              onClick={handleStop}
              className="w-9 h-9 rounded-xl bg-red-600/80 hover:bg-red-600 text-white flex items-center justify-center shrink-0 transition-colors"
              title="Stop"
            >
              <Square className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center disabled:opacity-40 shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          )}
          </div>
        </div>
      </div>

      {/* ── Right panel: Workspace ── */}
      <div className={`${workspaceCollapsed ? 'shrink-0' : 'flex-1'} md:flex-1 flex flex-col min-w-0 min-h-0`}>
        {/* Tabs */}
        <div className="flex items-center border-b border-white/5 bg-[#0d1117] shrink-0">
          <button className={tabClass('terminal')} onClick={() => setActiveTab('terminal')}>
            <span className="flex items-center gap-1.5"><Terminal className="w-3 h-3" />Terminal</span>
          </button>
          <button className={tabClass('files')} onClick={() => setActiveTab('files')}>
            <span className="flex items-center gap-1.5">
              <FolderOpen className="w-3 h-3" />Files
              {editOrder.length > 0 && <span className="bg-indigo-500/30 text-indigo-300 text-[10px] px-1.5 rounded-full">{editOrder.length}</span>}
            </span>
          </button>
          <button className={tabClass('browser')} onClick={() => setActiveTab('browser')}>
            <span className="flex items-center gap-1.5">
              <Globe className="w-3 h-3" />Browser
              {(iframeSrc || screenshots.length > 0 || browseHistory.length > 0) && (
                <span className="bg-green-500/30 text-green-300 text-[10px] px-1.5 rounded-full">
                  {iframeSrc ? '▶' : screenshots.length > 0 ? `${screenshots.length}📸` : browseHistory.length}
                </span>
              )}
            </span>
          </button>
          <button className={tabClass('checkpoints')} onClick={() => setActiveTab('checkpoints')}>
            <span className="flex items-center gap-1.5">
              <History className="w-3 h-3" />History
              {checkpoints.length > 0 && (
                <span className="bg-amber-500/30 text-amber-300 text-[10px] px-1.5 rounded-full">{checkpoints.length}</span>
              )}
            </span>
          </button>
          {/* Mobile-only minimize/expand toggle for the workspace panel. */}
          <button
            onClick={() => setWorkspaceCollapsed(c => !c)}
            title={workspaceCollapsed ? 'Expand panel' : 'Minimize panel'}
            className="md:hidden ml-auto mr-1 w-8 h-8 rounded-lg text-[#8b949e] hover:text-white hover:bg-white/5 flex items-center justify-center shrink-0 transition-colors"
          >
            {workspaceCollapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>

        {/* Content area — hidden on mobile when the panel is minimized (desktop always shows). */}
        <div className={`${workspaceCollapsed ? 'hidden md:flex' : 'flex'} flex-col flex-1 min-h-0`}>
        {/* Terminal tab */}
        {activeTab === 'terminal' && (
          <div className="flex-1 overflow-y-auto custom-scrollbar bg-[#0a0e13] p-4 space-y-4 font-mono text-[12px]">
            {terminalEntries.length === 0 ? (
              <p className="text-[#586069] text-xs mt-4">No commands run yet.</p>
            ) : (
              terminalEntries.map(entry => (
                <div key={entry.id}>
                  <div className="flex items-center gap-2 mb-1">
                    {entry.exitCode === 0
                      ? <CheckCircle2 className="w-3 h-3 text-green-400 shrink-0" />
                      : <AlertCircle className="w-3 h-3 text-red-400 shrink-0" />}
                    <span className="text-green-400">$</span>
                    <span className="text-white">{entry.command}</span>
                    {entry.exitCode !== 0 && (
                      <span className="text-red-400 text-[10px] ml-auto">exit {entry.exitCode}</span>
                    )}
                  </div>
                  {entry.output && (
                    <pre className="text-[#8b949e] pl-5 whitespace-pre-wrap break-all leading-relaxed">
                      {entry.output.slice(-2000)}
                    </pre>
                  )}
                </div>
              ))
            )}
            <div ref={terminalEndRef} />
          </div>
        )}

        {/* Files tab */}
        {activeTab === 'files' && (
          <div className="flex-1 flex min-h-0">
            {editOrder.length === 0 ? (
              <p className="text-[#586069] text-xs mt-4 p-4">No files edited yet.</p>
            ) : (
              <>
                {/* File list */}
                <div className="w-1/3 min-w-[140px] overflow-y-auto custom-scrollbar border-r border-white/5 p-2 space-y-0.5">
                  {editOrder.map(f => (
                    <button
                      key={f}
                      onClick={() => { setSelectedFile(f); setShowDiff(false); }}
                      className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-left transition-colors ${
                        selectedFile === f ? 'bg-indigo-500/15 text-white' : 'text-[#8b949e] hover:bg-white/5'
                      }`}
                    >
                      <ChevronRight className="w-3 h-3 text-indigo-400 shrink-0" />
                      <span className="text-[12px] font-mono truncate">{f}</span>
                      {fileMap[f]?.previous && fileMap[f].previous !== fileMap[f].current && (
                        <FileDiff className="w-2.5 h-2.5 text-amber-400 shrink-0 ml-auto" />
                      )}
                    </button>
                  ))}
                </div>
                {/* File content / diff */}
                <div className="flex-1 flex flex-col min-w-0 min-h-0">
                  {selectedFile ? (
                    <>
                      {/* Toolbar */}
                      <div className="flex items-center gap-2 px-4 py-1.5 border-b border-white/5 shrink-0">
                        <span className="text-[11px] text-[#8b949e] font-mono flex-1 truncate">{selectedFile}</span>
                        {hasDiff && (
                          <button
                            onClick={() => setShowDiff(d => !d)}
                            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                              showDiff
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                : 'bg-white/5 text-[#8b949e] border border-white/10 hover:text-white'
                            }`}
                          >
                            <FileDiff className="w-2.5 h-2.5" />
                            {showDiff ? 'Code' : 'Diff'}
                          </button>
                        )}
                      </div>
                      <div className="flex-1 overflow-auto custom-scrollbar p-4 min-w-0">
                        {showDiff && diffLines ? (
                          <div className="font-mono text-[11px] leading-relaxed">
                            {diffLines.map((dl, idx) => (
                              <div
                                key={idx}
                                className={`px-2 py-0.5 ${
                                  dl.type === 'add'
                                    ? 'bg-green-900/30 text-green-300'
                                    : dl.type === 'remove'
                                      ? 'bg-red-900/30 text-red-300 line-through opacity-60'
                                      : 'text-[#c9d1d9]'
                                }`}
                              >
                                <span className="select-none mr-2 text-[#586069]">
                                  {dl.type === 'add' ? '+' : dl.type === 'remove' ? '-' : ' '}
                                </span>
                                {dl.line}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <pre className="text-[11.5px] text-[#c9d1d9] font-mono whitespace-pre-wrap break-all leading-relaxed">
                            {selectedPair?.current}
                          </pre>
                        )}
                      </div>
                    </>
                  ) : (
                    <p className="text-[#586069] text-xs p-4">Select a file to view its latest content.</p>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* Browser tab */}
        {activeTab === 'browser' && (
          <div className="flex-1 flex flex-col min-h-0">
            {/* URL address bar */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5 bg-[#0d1117] shrink-0">
              {iframeSrc
                ? <Play className="w-3 h-3 text-green-400 shrink-0" />
                : <Globe className="w-3 h-3 text-[#586069] shrink-0" />}
              <input
                type="text"
                value={browserUrlInput}
                onChange={e => setBrowserUrlInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    const url = browserUrlInput.trim();
                    if (!url) return;
                    const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
                    setIframeSrc(normalized);
                    setBrowserUrlInput(normalized);
                  }
                }}
                placeholder="Enter URL or wait for live preview…"
                className="flex-1 min-w-0 bg-[#161b22] border border-white/10 rounded-lg px-3 py-1 text-xs text-white placeholder:text-[#586069] focus:outline-none focus:border-indigo-500/50"
              />
              <button
                onClick={() => {
                  const url = browserUrlInput.trim();
                  if (!url) return;
                  const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
                  setIframeSrc(normalized);
                  setBrowserUrlInput(normalized);
                }}
                disabled={!browserUrlInput.trim()}
                className="px-2.5 py-1 bg-indigo-600/70 hover:bg-indigo-600 disabled:opacity-30 text-white text-xs rounded-lg transition-colors shrink-0"
              >
                Go
              </button>
              {iframeSrc && (
                <>
                  <button
                    onClick={() => {
                      const src = iframeSrc;
                      setIframeSrc(null);
                      setTimeout(() => setIframeSrc(src), 50);
                    }}
                    title="Reload"
                    className="w-6 h-6 flex items-center justify-center text-[#8b949e] hover:text-white transition-colors shrink-0"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                  <a
                    href={iframeSrc}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open in new tab"
                    className="w-6 h-6 flex items-center justify-center text-[#8b949e] hover:text-white transition-colors shrink-0"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                  {/* Phase 9B — Publish button */}
                  <button
                    onClick={handlePublish}
                    disabled={publishing}
                    title="Publish — get a public shareable URL"
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium bg-green-500/10 text-green-300 hover:bg-green-500/20 border border-green-500/20 transition-colors disabled:opacity-40 shrink-0"
                  >
                    {publishing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Rocket className="w-3 h-3" />}
                    Publish
                  </button>
                </>
              )}
            </div>

            {/* Phase 9B — Published URL banner */}
            {publishedUrl && (
              <div className="px-3 py-2 bg-green-500/10 border-b border-green-500/20 flex items-center gap-2 shrink-0">
                <Rocket className="w-3 h-3 text-green-400 shrink-0" />
                <span className="text-[11px] text-green-300 font-medium">Published:</span>
                <a href={publishedUrl} target="_blank" rel="noopener noreferrer"
                  className="text-[11px] text-green-400 hover:text-green-300 underline truncate flex-1 min-w-0">
                  {publishedUrl}
                </a>
                <button
                  onClick={async () => {
                    try { await navigator.clipboard.writeText(publishedUrl); setUrlCopied(true); setTimeout(() => setUrlCopied(false), 1500); } catch { /* ignore */ }
                  }}
                  className="shrink-0 text-green-400 hover:text-green-300 transition-colors"
                  title="Copy URL"
                >
                  {urlCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            )}

            {/* Iframe */}
            {iframeSrc && (
              <iframe
                key={iframeSrc}
                src={iframeSrc}
                className="flex-1 w-full border-0 bg-white"
                title="Browser"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
              />
            )}

            {/* Phase 9A — Live agent-view thumbnail (Playwright polling) */}
            {iframeSrc && livePreviewShot && (
              <div className="border-t border-white/5 bg-[#0a0e13] shrink-0">
                <div className="flex items-center gap-2 px-3 py-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block" />
                  <span className="text-[10px] text-[#586069]">Agent's view (click to guide AI)</span>
                </div>
                <div className="relative cursor-crosshair" onClick={handlePreviewClick}>
                  <img
                    src={`data:image/png;base64,${livePreviewShot}`}
                    alt="Live agent view"
                    className="w-full block"
                    style={{ maxHeight: '160px', objectFit: 'cover', objectPosition: 'top' }}
                  />
                  {clickFlash && (
                    <div className="absolute pointer-events-none"
                      style={{ left: `${clickFlash.x}%`, top: `${clickFlash.y}%`, transform: 'translate(-50%, -50%)', zIndex: 30 }}>
                      <div className="w-5 h-5 rounded-full border-2 border-yellow-400 animate-ping" />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Screenshot viewer (agent took a screenshot or is driving) */}
            {!iframeSrc && latestScreenshot && (
              <div className="flex-1 overflow-y-auto custom-scrollbar">
                {/* Main screenshot with cursor overlay + click-to-guide */}
                <div className="relative cursor-crosshair" onClick={handlePreviewClick} title="Click to guide AI to this element">
                  <img
                    src={`data:image/png;base64,${latestScreenshot.base64}`}
                    alt={`Screenshot: ${latestScreenshot.url}`}
                    className="w-full block"
                    style={{ imageRendering: 'auto' }}
                  />
                  {/* Click flash indicator */}
                  {clickFlash && (
                    <div className="absolute pointer-events-none"
                      style={{ left: `${clickFlash.x}%`, top: `${clickFlash.y}%`, transform: 'translate(-50%, -50%)', zIndex: 30 }}>
                      <div className="w-5 h-5 rounded-full border-2 border-yellow-400 animate-ping" />
                    </div>
                  )}
                  {/* Animated AI cursor — shown when the agent drove to this position */}
                  {latestScreenshot.cursorX != null && latestScreenshot.cursorY != null && (
                    <div
                      className="absolute pointer-events-none"
                      style={{
                        left: `${(latestScreenshot.cursorX / 1280) * 100}%`,
                        top: `${(latestScreenshot.cursorY / 720) * 100}%`,
                        transform: 'translate(-50%, -50%)',
                        zIndex: 20,
                      }}
                    >
                      {/* Ripple ring */}
                      <div className="absolute w-7 h-7 rounded-full border-2 border-indigo-400/70 animate-ping"
                        style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }} />
                      {/* Solid dot */}
                      <div className="w-3 h-3 rounded-full bg-indigo-500 border-2 border-white shadow-lg shadow-indigo-500/50" />
                    </div>
                  )}
                  <div className="absolute bottom-2 right-2 flex gap-1.5 items-center">
                    {isDriving && (
                      <span className="bg-indigo-600/90 text-white text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse inline-block" />
                        AI driving…
                      </span>
                    )}
                    <span className="bg-black/70 text-white text-[10px] px-2 py-0.5 rounded-full">
                      Agent view · {new Date(latestScreenshot.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
                {screenshots.length > 1 && !liveFrame && (
                  <div className="flex gap-1.5 overflow-x-auto p-2 bg-[#0a0e13] border-t border-white/5">
                    {[...screenshots].reverse().map((s, i) => (
                      <img
                        key={s.timestamp}
                        src={`data:image/png;base64,${s.base64}`}
                        alt={`Screenshot ${screenshots.length - i}`}
                        className="h-16 w-auto rounded border border-white/10 shrink-0 cursor-pointer hover:border-indigo-500/60 transition-colors"
                        title={`Step screenshot: ${s.url}`}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Text browse results (agent curl output) */}
            {!iframeSrc && !latestScreenshot && (
              <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
                {!latestBrowse ? (
                  <div className="flex flex-col items-center justify-center h-full gap-3 text-[#586069]">
                    <Globe className="w-8 h-8 opacity-30" />
                    <p className="text-xs">Type a URL above to navigate, or ask Engineer AI to build &amp; start a preview.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/3 border border-white/5">
                      <Globe className="w-3.5 h-3.5 text-green-400 shrink-0" />
                      <span className="text-xs text-[#8b949e] truncate">{latestBrowse.url}</span>
                      {browseHistory.length > 1 && (
                        <span className="ml-auto text-[10px] text-[#586069]">{browseHistory.length} total</span>
                      )}
                    </div>
                    <pre className="text-[11px] text-[#8b949e] font-mono whitespace-pre-wrap break-all leading-relaxed bg-[#0a0e13] rounded-lg p-3 border border-white/5 max-h-[60vh] overflow-y-auto custom-scrollbar">
                      {latestBrowse.content}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Checkpoints tab */}
        {activeTab === 'checkpoints' && (
          <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
            {checkpoints.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-[#586069]">
                <History className="w-8 h-8 opacity-30" />
                <p className="text-xs text-center">No checkpoints yet.<br />A snapshot is created automatically before every file edit.</p>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-[10px] text-[#586069] mb-3">
                  {checkpoints.length} checkpoint{checkpoints.length === 1 ? '' : 's'} — click Restore to revert the workspace to that state.
                </p>
                {[...checkpoints].reverse().map((ckpt, i) => (
                  <div key={ckpt.id} className="flex items-start gap-3 p-3 rounded-xl bg-[#161b22] border border-white/5 hover:border-white/10 transition-colors">
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-1.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] text-white truncate" title={ckpt.triggeredBy}>{ckpt.triggeredBy}</p>
                      <p className="text-[10px] text-[#586069] mt-0.5">
                        {new Date(ckpt.createdAt).toLocaleTimeString()} · #{checkpoints.length - i}
                      </p>
                    </div>
                    <button
                      onClick={() => handleRestore(ckpt.id)}
                      disabled={!!restoringId || loading}
                      title={`Restore workspace to this checkpoint`}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 border border-amber-500/20 transition-colors disabled:opacity-40 shrink-0"
                    >
                      {restoringId === ckpt.id
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : <RotateCcw className="w-3 h-3" />}
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        </div>
      </div>
    </div>
  );
}
