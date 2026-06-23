import { useEffect, useRef, useState } from 'react';
import {
  Bot, Send, Square, Loader2, Terminal, FileDiff, FolderOpen,
  History, CheckCircle2, AlertCircle, Rocket, Globe, ExternalLink, RotateCcw,
  SlidersHorizontal, Check, X,
} from 'lucide-react';
import { useAgentV3Build } from '../../hooks/useAgentV3Build';
import type { AgentCard, GitCheckpoint } from './agentV3Types';
import { db, sanitizeFirestoreData } from '../../App';
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

export function AgentV3Panel({ userId, email }: { userId?: string; email?: string }) {
  const { state, running, error, start, respond, restore, stop, reset } = useAgentV3Build();
  const [prompt, setPrompt] = useState('');
  const [onlyOpus, setOnlyOpus] = useState(false);
  const [planFirst, setPlanFirst] = useState(false); // chat-first: no forced plan gate by default
  const [thinking, setThinking] = useState(false); // adaptive thinking, off by default
  const [tab, setTab] = useState<SurfaceTab>('preview');
  // Workspace is collapsed by default so the chat takes the full width; opening a
  // header tab pill surfaces it. On mobile an open workspace takes over the area.
  const [showWorkspace, setShowWorkspace] = useState(false);
  // Local-only UI flag for the input-row settings popover (Planning/Thinking/Power).
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  // A stable session id keeps the SAME sandbox + memory across messages, so the
  // build is iterative (each message continues the same project). "New session"
  // starts a fresh project.
  const newSessionId = () =>
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const sessionIdRef = useRef<string>(newSessionId());

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

  // Persist the v3.0 conversation into NavBharatAI's MAIN History (the sidebar
  // "History" option), using the SAME chat_sessions shape as Free/Pro/SDA chats.
  // Additive + best-effort: it only writes a new doc tagged 'agentv3' (so it shows
  // under All/Apps and never collides with other sources) when a turn completes
  // and the user is signed in; it never touches the shared history code paths.
  useEffect(() => {
    if (!state.done || !userId) return;
    const thread = convo;
    if (thread.length === 0) return;
    const firstUser = thread.find((m) => m.role === 'user')?.text ?? 'v3.0 build';
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
    ).catch(() => { /* history save is best-effort — never blocks the UI */ });
    // Intentionally keyed on turn completion; `convo` is read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.done, userId]);

  const send = () => {
    const text = prompt.trim();
    if (!text || running) return;
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
    setUserMsgs((c) => [...c, { role: 'user', text, ts: Date.now() }]);
    setPrompt('');
    start(text, { userId, email, onlyOpus, planFirst, thinking, sessionId: sessionIdRef.current });
  };

  // Start a brand-new project: fresh sandbox/memory (new session id) and clear chat.
  const startNewSession = () => {
    if (running) return;
    sessionIdRef.current = newSessionId();
    setUserMsgs([]);
    setAgentHistory([]);
    setCheckpointHistory([]);
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

  const agents = Object.values(state.agents).sort((a, b) => b.updatedTs - a.updatedTs);
  const diffPaths = Object.keys(state.diffs);

  return (
    <div className="flex flex-col h-full max-h-full w-full min-h-0 bg-zinc-950 text-zinc-100">
      {/* Header: title + New, and the workspace tab pills (open/collapse the workspace) */}
      <div className="shrink-0 border-b border-zinc-800">
        <div className="flex items-center gap-2 px-4 pt-3 pb-2">
          <Bot className="w-5 h-5 text-indigo-400" />
          <span className="font-semibold">NavBharatAI Pro v3.0</span>
          <span className="text-[10px] uppercase tracking-wide bg-indigo-500/20 text-indigo-300 px-1.5 py-0.5 rounded">beta</span>
          <button
            onClick={startNewSession}
            disabled={running}
            title="Start a new project (fresh sandbox + memory)"
            className="ml-auto flex items-center gap-1 text-xs text-zinc-400 hover:text-white disabled:opacity-40 border border-zinc-700 rounded px-2 py-1"
          >
            <RotateCcw className="w-3.5 h-3.5" /> New
          </button>
        </div>
        <div className="flex gap-1 px-3 pb-2 overflow-x-auto whitespace-nowrap" style={{ WebkitOverflowScrolling: 'touch' }}>
          <TabPill active={showWorkspace && tab === 'preview'} onClick={() => openTab('preview')} icon={<Globe className="w-3.5 h-3.5" />}>Preview</TabPill>
          <TabPill active={showWorkspace && tab === 'files'} onClick={() => openTab('files')} icon={<FolderOpen className="w-3.5 h-3.5" />}>Files ({state.files.length})</TabPill>
          <TabPill active={showWorkspace && tab === 'diff'} onClick={() => openTab('diff')} icon={<FileDiff className="w-3.5 h-3.5" />}>Diff ({diffPaths.length})</TabPill>
          <TabPill active={showWorkspace && tab === 'terminal'} onClick={() => openTab('terminal')} icon={<Terminal className="w-3.5 h-3.5" />}>Terminal</TabPill>
          <TabPill active={showWorkspace && tab === 'history'} onClick={() => openTab('history')} icon={<History className="w-3.5 h-3.5" />}>History ({allCheckpoints.length})</TabPill>
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
            {running && (
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" /> working…
              </div>
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
                  <ul className="mb-2 space-y-0.5">
                    {state.todos.map((t) => <li key={t.id} className="text-xs text-amber-100/90">• {t.title}</li>)}
                  </ul>
                )}
                <div className="flex gap-2">
                  <button onClick={() => respond(state.pendingPermission!.callId, true)} className="px-3 py-1 text-xs rounded bg-emerald-600 hover:bg-emerald-500 text-white">Approve &amp; build</button>
                  <button onClick={() => respond(state.pendingPermission!.callId, false)} className="px-3 py-1 text-xs rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-100">Reject</button>
                </div>
              </div>
            )}
            {state.done && typeof state.billedUsd === 'number' && (
              <div className="flex items-center gap-1 text-[11px] text-zinc-500">
                <Rocket className="w-3 h-3" /> ${state.billedUsd.toFixed(4)}
              </div>
            )}
          </div>

          {/* Bottom: live AI-team chips + input (Claude-Code style — at the bottom) */}
          <div className="shrink-0 sticky bottom-0 bg-zinc-950 border-t border-zinc-800 pb-[env(safe-area-inset-bottom)]">
            {agents.length > 0 && (
              <div className="px-3 pt-2 flex gap-1.5 overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
                {agents.map((a) => <AgentChip key={a.agent} card={a} />)}
              </div>
            )}
            <div className="flex items-end gap-2 p-3">
              {/* Build-options popover (Planning / Thinking / Power) — anchored above the input */}
              <div className="relative shrink-0">
                {settingsOpen && (
                  <>
                    {/* outside-click catcher */}
                    <div className="fixed inset-0 z-10" onClick={() => setSettingsOpen(false)} />
                    <div className="absolute bottom-full left-0 mb-2 z-20 w-48 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-1.5 space-y-0.5">
                      <ToggleRow label="Planning" checked={planFirst} disabled={running} onClick={() => setPlanFirst((v) => !v)} />
                      <ToggleRow label="Thinking" checked={thinking} disabled={running} onClick={() => setThinking((v) => !v)} />
                      <ToggleRow label="Power" hint="5×" checked={onlyOpus} disabled={running} onClick={() => setOnlyOpus((v) => !v)} />
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
              <textarea
                className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm resize-none focus:outline-none focus:border-indigo-500"
                rows={2}
                placeholder="Message v3.0… (e.g. “hello” or “build a notes app”)"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              />
              {running ? (
                <button onClick={stop} className="flex items-center gap-1 px-3 bg-red-600 hover:bg-red-500 rounded text-sm" title="Stop">
                  <Square className="w-4 h-4" />
                </button>
              ) : (
                <button onClick={send} disabled={!prompt.trim()} className="flex items-center gap-1 px-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded text-sm" title="Send">
                  <Send className="w-4 h-4" />
                </button>
              )}
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
            <PreviewSurface url={state.previewUrl} />
          ) : (
            <div className="flex-1 overflow-auto p-3 font-mono text-xs">
              {tab === 'files' && (state.files.length === 0 ? <Empty>No files yet.</Empty> : (
                <ul className="space-y-0.5">
                  {state.files.map((f) => <li key={f.path} className="flex items-center gap-2"><span className={fileDot(f.kind)} /> {f.path}</li>)}
                </ul>
              ))}
              {tab === 'diff' && (diffPaths.length === 0 ? <Empty>No diffs yet.</Empty> : (
                <div className="space-y-3">
                  {diffPaths.map((p) => <div key={p}><div className="text-zinc-400 mb-1">{p}</div><pre className="whitespace-pre-wrap">{colorizeDiff(state.diffs[p])}</pre></div>)}
                </div>
              ))}
              {tab === 'terminal' && (state.terminal.length === 0 ? <Empty>No terminal output yet.</Empty> : (
                <pre className="whitespace-pre-wrap text-zinc-300">{state.terminal.join('\n')}</pre>
              ))}
              {tab === 'history' && (allCheckpoints.length === 0 ? <Empty>No checkpoints yet.</Empty> : (
                <ul className="space-y-1">
                  {allCheckpoints.map((c) => (
                    <li key={c.id} className="flex items-center gap-2 group">
                      <History className="w-3.5 h-3.5 text-zinc-500" />
                      <span className="text-zinc-500">{c.sha.slice(0, 7) || '—'}</span>
                      <span className="flex-1 truncate">{c.message}</span>
                      {c.sha && (
                        <button onClick={() => restore(c.sha)} className="opacity-0 group-hover:opacity-100 flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300" title="Restore to this checkpoint">
                          <RotateCcw className="w-3 h-3" /> Restore
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              ))}
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
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
          {msg.text}{cursor}
        </div>
      </div>
    </div>
  );
}

function PreviewSurface({ url }: { url?: string }) {
  if (!url) {
    return <div className="h-full flex items-center justify-center p-6"><Empty>No live preview yet — it appears the moment the agent starts the app.</Empty></div>;
  }
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800 text-xs text-zinc-400">
        <span className="truncate flex-1">{url}</span>
        <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-zinc-200" title="Open in new tab"><ExternalLink className="w-3.5 h-3.5" /></a>
      </div>
      <iframe title="Live preview" src={url} className="flex-1 w-full bg-white" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
    </div>
  );
}

function AgentChip({ card }: { card: AgentCard }) {
  return (
    <div className="flex items-center gap-1 text-[11px] bg-zinc-900 rounded-full px-2 py-1" title={card.lastAction}>
      {card.active ? <Loader2 className="w-3 h-3 text-indigo-400 animate-spin" /> : <CheckCircle2 className="w-3 h-3 text-zinc-600" />}
      <span className="font-medium capitalize text-zinc-200">{card.agent}</span>
    </div>
  );
}

function TabPill({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
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
