import { useEffect, useRef, useState } from 'react';
import {
  Bot, Send, Square, Loader2, Terminal, FileDiff, FolderOpen,
  History, CheckCircle2, AlertCircle, Rocket, Globe, ExternalLink, RotateCcw,
  ChevronRight, ChevronLeft,
} from 'lucide-react';
import { useAgentV3Build } from '../../hooks/useAgentV3Build';
import type { AgentCard } from './agentV3Types';

/**
 * AgentV3Panel — NavBharatAI Pro v3.0 (Vargen 3.0), a Claude-Code-style chat
 * app builder. You chat with it (it replies to anything, even "hello"); when you
 * describe an app it builds it for real, and the workspace surfaces (preview,
 * files, diff, terminal, git) update live alongside. All activity is REAL engine
 * output — nothing is a scripted animation.
 */
type SurfaceTab = 'preview' | 'files' | 'diff' | 'terminal' | 'history';
interface ChatMsg { role: 'user' | 'agent'; agent?: string; text: string; ts: number }

export function AgentV3Panel({ userId, email }: { userId?: string; email?: string }) {
  const { state, running, error, start, respond, restore, stop } = useAgentV3Build();
  const [prompt, setPrompt] = useState('');
  const [onlyOpus, setOnlyOpus] = useState(false);
  const [planFirst, setPlanFirst] = useState(false); // chat-first: no forced plan gate by default
  const [tab, setTab] = useState<SurfaceTab>('preview');
  const [showWorkspace, setShowWorkspace] = useState(true); // collapsible right panel
  const [convo, setConvo] = useState<ChatMsg[]>([]);
  const lastNarr = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Stream the agent's narration into the chat thread as it arrives.
  useEffect(() => {
    if (state.narration.length > lastNarr.current) {
      const fresh = state.narration.slice(lastNarr.current);
      setConvo((c) => [...c, ...fresh.map((n) => ({ role: 'agent' as const, agent: n.agent, text: n.text, ts: n.ts }))]);
    }
    lastNarr.current = state.narration.length;
  }, [state.narration]);

  // Auto-scroll the chat to the newest message.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [convo, running]);

  const send = () => {
    const text = prompt.trim();
    if (!text || running) return;
    setConvo((c) => [...c, { role: 'user', text, ts: Date.now() }]);
    setPrompt('');
    start(text, { userId, email, onlyOpus, planFirst });
  };

  const agents = Object.values(state.agents).sort((a, b) => b.updatedTs - a.updatedTs);
  const diffPaths = Object.keys(state.diffs);

  return (
    <div className="flex flex-col h-full w-full bg-zinc-950 text-zinc-100">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800">
        <Bot className="w-5 h-5 text-indigo-400" />
        <span className="font-semibold">NavBharatAI Pro v3.0</span>
        <span className="text-[10px] uppercase tracking-wide bg-indigo-500/20 text-indigo-300 px-1.5 py-0.5 rounded">beta</span>
        <label className="ml-auto flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer">
          <input type="checkbox" checked={planFirst} onChange={(e) => setPlanFirst(e.target.checked)} disabled={running} />
          Plan first
        </label>
        <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer">
          <input type="checkbox" checked={onlyOpus} onChange={(e) => setOnlyOpus(e.target.checked)} disabled={running} />
          Only Opus (5×)
        </label>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* LEFT: the chat (full width when the workspace is collapsed) */}
        <div className={`${showWorkspace ? 'w-1/2 border-r border-zinc-800' : 'flex-1'} flex flex-col min-h-0`}>
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
          <div className="border-t border-zinc-800">
            {agents.length > 0 && (
              <div className="px-3 pt-2 flex gap-1.5 overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
                {agents.map((a) => <AgentChip key={a.agent} card={a} />)}
              </div>
            )}
            <div className="flex gap-2 p-3">
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

        {/* RIGHT: merged workspace surfaces (collapsible — ">" hides, "<" reopens) */}
        {showWorkspace ? (
        <div className="w-1/2 flex flex-col min-h-0">
          <div className="flex items-center border-b border-zinc-800 text-xs">
            <button onClick={() => setShowWorkspace(false)} title="Hide workspace" className="px-2 py-2 shrink-0 text-zinc-400 hover:text-white border-r border-zinc-800">
              <ChevronRight className="w-4 h-4" />
            </button>
            <div className="flex overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
            <TabBtn active={tab === 'preview'} onClick={() => setTab('preview')} icon={<Globe className="w-3.5 h-3.5" />}>Preview</TabBtn>
            <TabBtn active={tab === 'files'} onClick={() => setTab('files')} icon={<FolderOpen className="w-3.5 h-3.5" />}>Files ({state.files.length})</TabBtn>
            <TabBtn active={tab === 'diff'} onClick={() => setTab('diff')} icon={<FileDiff className="w-3.5 h-3.5" />}>Diff ({diffPaths.length})</TabBtn>
            <TabBtn active={tab === 'terminal'} onClick={() => setTab('terminal')} icon={<Terminal className="w-3.5 h-3.5" />}>Terminal</TabBtn>
            <TabBtn active={tab === 'history'} onClick={() => setTab('history')} icon={<History className="w-3.5 h-3.5" />}>History ({state.checkpoints.length})</TabBtn>
            </div>
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
              {tab === 'history' && (state.checkpoints.length === 0 ? <Empty>No checkpoints yet.</Empty> : (
                <ul className="space-y-1">
                  {state.checkpoints.map((c) => (
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
        ) : (
          <button onClick={() => setShowWorkspace(true)} title="Show workspace" className="w-8 shrink-0 border-l border-zinc-800 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-900">
            <ChevronLeft className="w-4 h-4" />
          </button>
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
  return (
    <div className="flex justify-start">
      <div className="max-w-[90%]">
        {msg.agent && msg.agent !== 'architect' && (
          <div className="text-[10px] uppercase tracking-wide text-indigo-400 mb-0.5">{msg.agent}</div>
        )}
        <div className="bg-zinc-900 text-zinc-100 rounded-2xl rounded-bl-sm px-3 py-2 text-sm whitespace-pre-wrap break-words">{msg.text}</div>
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

function TabBtn({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-1 px-3 py-2 whitespace-nowrap ${active ? 'text-indigo-300 border-b-2 border-indigo-500' : 'text-zinc-400 hover:text-zinc-200'}`}>
      {icon} {children}
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
