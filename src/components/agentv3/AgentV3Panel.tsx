import { useState } from 'react';
import {
  Bot, Send, Square, Loader2, Terminal, FileDiff, FolderOpen,
  History, CheckCircle2, AlertCircle, Rocket, Globe, ExternalLink,
} from 'lucide-react';
import { useAgentV3Build } from '../../hooks/useAgentV3Build';
import type { AgentCard } from './agentV3Types';

/**
 * AgentV3Panel — the NavBharatAI Pro v3.0 (Vargen 3.0) builder surface.
 *
 * One prompt drives the multi-agent engine; every surface below renders from the
 * SAME live stream (§3.2): the "AI Team" tracker, narration, todos, file
 * explorer, Code Studio diff, terminal, and git/history. All activity is REAL
 * engine output (D9) — nothing here is a scripted animation.
 *
 * Self-contained and flag-gated by the server (404 when AgentV3 is disabled), so
 * mounting it never affects the live app.
 */
type SurfaceTab = 'preview' | 'files' | 'diff' | 'terminal' | 'history';

export function AgentV3Panel({ userId }: { userId?: string }) {
  const { state, running, error, start, stop } = useAgentV3Build();
  const [prompt, setPrompt] = useState('');
  const [onlyOpus, setOnlyOpus] = useState(false);
  const [tab, setTab] = useState<SurfaceTab>('preview');

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
          <input type="checkbox" checked={onlyOpus} onChange={(e) => setOnlyOpus(e.target.checked)} disabled={running} />
          Only Opus (5×)
        </label>
      </div>

      {/* Prompt bar */}
      <div className="flex gap-2 p-3 border-b border-zinc-800">
        <textarea
          className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm resize-none focus:outline-none focus:border-indigo-500"
          rows={2}
          placeholder="Describe the app you want to build…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={running}
        />
        {running ? (
          <button onClick={stop} className="flex items-center gap-1 px-3 bg-red-600 hover:bg-red-500 rounded text-sm">
            <Square className="w-4 h-4" /> Stop
          </button>
        ) : (
          <button
            onClick={() => prompt.trim() && start(prompt.trim(), { userId, onlyOpus })}
            disabled={!prompt.trim()}
            className="flex items-center gap-1 px-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded text-sm"
          >
            <Send className="w-4 h-4" /> Build
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-950/60 text-red-300 text-sm border-b border-red-900">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {/* Left: AI Team + narration + plan/todos */}
        <div className="w-1/2 flex flex-col border-r border-zinc-800 min-h-0">
          <Section title="AI Team" icon={<Bot className="w-4 h-4" />}>
            {agents.length === 0 ? (
              <Empty>{running ? 'Spinning up the team…' : 'Your AI team will appear here.'}</Empty>
            ) : (
              <div className="space-y-1.5">
                {agents.map((a) => <AgentCardRow key={a.agent} card={a} />)}
              </div>
            )}
          </Section>

          {state.plan && (
            <Section title="Plan">
              <p className="text-xs text-zinc-300 whitespace-pre-wrap">{state.plan}</p>
            </Section>
          )}

          {state.todos.length > 0 && (
            <Section title="Todos">
              <ul className="space-y-1">
                {state.todos.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 text-xs">
                    <span className={todoDot(t.status)} />
                    <span className={t.status === 'done' ? 'line-through text-zinc-500' : ''}>{t.title}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="Activity" grow>
            {state.narration.length === 0 ? (
              <Empty>No activity yet.</Empty>
            ) : (
              <div className="space-y-1.5">
                {state.narration.map((n, i) => (
                  <div key={i} className="text-xs">
                    <span className="text-indigo-400">{n.agent}</span>
                    <span className="text-zinc-300"> · {n.text}</span>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>

        {/* Right: merged surfaces (Files / Diff / Terminal / History) */}
        <div className="w-1/2 flex flex-col min-h-0">
          <div className="flex border-b border-zinc-800 text-xs">
            <TabBtn active={tab === 'preview'} onClick={() => setTab('preview')} icon={<Globe className="w-3.5 h-3.5" />}>
              Preview
            </TabBtn>
            <TabBtn active={tab === 'files'} onClick={() => setTab('files')} icon={<FolderOpen className="w-3.5 h-3.5" />}>
              Files ({state.files.length})
            </TabBtn>
            <TabBtn active={tab === 'diff'} onClick={() => setTab('diff')} icon={<FileDiff className="w-3.5 h-3.5" />}>
              Diff ({diffPaths.length})
            </TabBtn>
            <TabBtn active={tab === 'terminal'} onClick={() => setTab('terminal')} icon={<Terminal className="w-3.5 h-3.5" />}>
              Terminal
            </TabBtn>
            <TabBtn active={tab === 'history'} onClick={() => setTab('history')} icon={<History className="w-3.5 h-3.5" />}>
              History ({state.checkpoints.length})
            </TabBtn>
          </div>

          {tab === 'preview' ? (
            <PreviewSurface url={state.previewUrl} />
          ) : (
          <div className="flex-1 overflow-auto p-3 font-mono text-xs">
            {tab === 'files' && (
              state.files.length === 0 ? <Empty>No files yet.</Empty> : (
                <ul className="space-y-0.5">
                  {state.files.map((f) => (
                    <li key={f.path} className="flex items-center gap-2">
                      <span className={fileDot(f.kind)} /> {f.path}
                    </li>
                  ))}
                </ul>
              )
            )}
            {tab === 'diff' && (
              diffPaths.length === 0 ? <Empty>No diffs yet.</Empty> : (
                <div className="space-y-3">
                  {diffPaths.map((p) => (
                    <div key={p}>
                      <div className="text-zinc-400 mb-1">{p}</div>
                      <pre className="whitespace-pre-wrap">{colorizeDiff(state.diffs[p])}</pre>
                    </div>
                  ))}
                </div>
              )
            )}
            {tab === 'terminal' && (
              state.terminal.length === 0 ? <Empty>No terminal output yet.</Empty> : (
                <pre className="whitespace-pre-wrap text-zinc-300">{state.terminal.join('\n')}</pre>
              )
            )}
            {tab === 'history' && (
              state.checkpoints.length === 0 ? <Empty>No checkpoints yet.</Empty> : (
                <ul className="space-y-1">
                  {state.checkpoints.map((c) => (
                    <li key={c.id} className="flex items-center gap-2">
                      <History className="w-3.5 h-3.5 text-zinc-500" />
                      <span className="text-zinc-500">{c.sha.slice(0, 7) || '—'}</span> {c.message}
                    </li>
                  ))}
                </ul>
              )
            )}
          </div>
          )}
        </div>
      </div>

      {/* Footer: result */}
      {state.done && (
        <div className={`flex items-center gap-2 px-4 py-2 text-sm border-t ${state.ok ? 'bg-emerald-950/50 text-emerald-300 border-emerald-900' : 'bg-amber-950/50 text-amber-300 border-amber-900'}`}>
          {state.ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          <span>{state.summary || state.error || (state.ok ? 'Done.' : 'Stopped.')}</span>
          {typeof state.billedUsd === 'number' && (
            <span className="ml-auto flex items-center gap-1 text-zinc-400">
              <Rocket className="w-3.5 h-3.5" /> ${state.billedUsd.toFixed(4)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function PreviewSurface({ url }: { url?: string }) {
  if (!url) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <Empty>No live preview yet — it appears here the moment the agent starts the app.</Empty>
      </div>
    );
  }
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800 text-xs text-zinc-400">
        <span className="truncate flex-1">{url}</span>
        <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-zinc-200" title="Open in new tab">
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
      <iframe title="Live preview" src={url} className="flex-1 w-full bg-white" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
    </div>
  );
}

function Section({ title, icon, children, grow }: { title: string; icon?: React.ReactNode; children: React.ReactNode; grow?: boolean }) {
  return (
    <div className={`p-3 border-b border-zinc-800 ${grow ? 'flex-1 overflow-auto min-h-0' : ''}`}>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-zinc-500 mb-2">
        {icon} {title}
      </div>
      {children}
    </div>
  );
}

function AgentCardRow({ card }: { card: AgentCard }) {
  return (
    <div className="flex items-center gap-2 text-xs bg-zinc-900 rounded px-2 py-1.5">
      {card.active ? <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5 text-zinc-600" />}
      <span className="font-medium capitalize text-zinc-200">{card.agent}</span>
      <span className="text-zinc-400 truncate">{card.lastAction}</span>
    </div>
  );
}

function TabBtn({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-1 px-3 py-2 ${active ? 'text-indigo-300 border-b-2 border-indigo-500' : 'text-zinc-400 hover:text-zinc-200'}`}>
      {icon} {children}
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-xs text-zinc-600 italic">{children}</div>;
}

function todoDot(status: string): string {
  const base = 'inline-block w-2 h-2 rounded-full ';
  if (status === 'done') return base + 'bg-emerald-500';
  if (status === 'in_progress') return base + 'bg-indigo-500 animate-pulse';
  if (status === 'blocked') return base + 'bg-red-500';
  return base + 'bg-zinc-600';
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
