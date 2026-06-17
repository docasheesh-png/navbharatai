import { useEffect, useRef, useState } from 'react';
import {
  HardHat, Loader2, Send, Square, Terminal, FolderOpen, Globe,
  CheckCircle2, AlertCircle, ChevronRight,
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

interface EngineerAIChatProps {
  userId?: string;
}

const WELCOME: ChatMessage = {
  id: 'welcome',
  role: 'agent',
  text: "Hi, I'm Engineer AI — your autonomous coding agent. Describe what you want to build or fix, and I'll plan, code, run commands, and verify the build until it's done.",
};

function uid() { return `${Date.now()}_${Math.random().toString(36).slice(2)}`; }

type WorkspaceTab = 'terminal' | 'files' | 'browser';

export function EngineerAIChat({ userId }: EngineerAIChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('terminal');
  const [terminalEntries, setTerminalEntries] = useState<TerminalEntry[]>([]);
  const [editedFiles, setEditedFiles] = useState<string[]>([]);
  const [browseHistory, setBrowseHistory] = useState<BrowseEntry[]>([]);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);

  // Step 7 — persistent workspace ID per user, restored across page loads
  const workspaceIdRef = useRef<string>((() => {
    if (!userId) return `ws_anon_${Date.now()}`;
    const key = `engineer_ws_${userId}`;
    const stored = localStorage.getItem(key);
    if (stored) return stored;
    const fresh = `ws_${userId}_${Date.now()}`;
    localStorage.setItem(key, fresh);
    return fresh;
  })());

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => { terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [terminalEntries]);

  const appendChat = (role: ChatMessage['role'], text: string) =>
    setMessages(prev => [...prev, { id: uid(), role, text }]);

  const addTerminalEntry = (command: string, output: string, exitCode: number) => {
    setTerminalEntries(prev => [...prev, { id: uid(), command, output, exitCode }]);
    setActiveTab('terminal');
  };

  const handleEvent = (event: any) => {
    switch (event.type) {
      case 'action_start':
        if (event.thought) appendChat('agent', `💭 ${event.thought}`);
        break;
      case 'command_result':
        addTerminalEntry(event.command, event.output || '', event.exitCode ?? 0);
        break;
      case 'files_changed':
        setEditedFiles(prev => {
          const merged = [...prev];
          for (const p of event.paths) { if (!merged.includes(p)) merged.push(p); }
          return merged;
        });
        appendChat(
          'system',
          `${event.kind === 'patch' ? 'Patched' : 'Edited'}: ${event.paths.join(', ')}`
        );
        break;
      case 'build_result':
        addTerminalEntry(
          'npm run build',
          event.logs || '',
          event.success ? 0 : 1
        );
        if (!event.success) appendChat('system', 'Build failed — fixing errors…');
        break;
      case 'browse_result':
        setBrowseHistory(prev => [...prev, { url: event.url, content: event.content }]);
        setActiveTab('browser');
        appendChat('system', `Browsed: ${event.url}`);
        break;
      case 'complete':
        appendChat('agent', `✅ Done in ${event.steps} step${event.steps === 1 ? '' : 's'}: ${event.summary}`);
        break;
      case 'max_steps_reached':
        appendChat('system', `Reached ${event.steps}-step limit without finishing. Try a more specific instruction.`);
        break;
      case 'aborted':
        appendChat('system', 'Stopped.');
        break;
      case 'error':
        appendChat('system', `Error: ${event.message}`);
        break;
    }
  };

  const handleStop = () => {
    readerRef.current?.cancel().catch(() => {});
  };

  const handleSend = async () => {
    const instruction = input.trim();
    if (!instruction || loading) return;
    setInput('');
    appendChat('user', instruction);
    setLoading(true);
    setEditedFiles([]);

    try {
      const res = await fetch('/api/engineer-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: workspaceIdRef.current, instruction }),
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
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data:')) continue;
          const json = line.slice(5).trim();
          if (!json) continue;
          try { handleEvent(JSON.parse(json)); } catch { /* ignore malformed frame */ }
        }
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') appendChat('system', `Error: ${err?.message || 'Engineer AI failed.'}`);
    } finally {
      readerRef.current = null;
      setLoading(false);
    }
  };

  const tabClass = (t: WorkspaceTab) =>
    `px-4 py-2 text-xs font-medium transition-colors ${
      activeTab === t
        ? 'text-white border-b-2 border-indigo-500'
        : 'text-[#8b949e] hover:text-white border-b-2 border-transparent'
    }`;

  const latestBrowse = browseHistory[browseHistory.length - 1];

  return (
    <div className="flex h-full min-h-0 bg-[#0d1117]">
      {/* ── Left panel: Chat ── */}
      <div className="w-2/5 flex flex-col border-r border-white/5 min-w-0">
        {/* Header */}
        <div className="px-4 py-3 border-b border-white/5 flex items-center gap-2.5 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center">
            <HardHat className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold text-white leading-tight">Engineer AI</h2>
            <p className="text-[10px] text-[#8b949e]">Workspace: {workspaceIdRef.current.slice(-10)}</p>
          </div>
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
              <Loader2 className="w-3 h-3 animate-spin" /> Working…
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <div className="p-3 border-t border-white/5 flex items-end gap-2 shrink-0">
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

      {/* ── Right panel: Workspace ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Tabs */}
        <div className="flex items-center border-b border-white/5 bg-[#0d1117] shrink-0">
          <button className={tabClass('terminal')} onClick={() => setActiveTab('terminal')}>
            <span className="flex items-center gap-1.5"><Terminal className="w-3 h-3" />Terminal</span>
          </button>
          <button className={tabClass('files')} onClick={() => setActiveTab('files')}>
            <span className="flex items-center gap-1.5"><FolderOpen className="w-3 h-3" />Files {editedFiles.length > 0 && <span className="bg-indigo-500/30 text-indigo-300 text-[10px] px-1.5 rounded-full">{editedFiles.length}</span>}</span>
          </button>
          <button className={tabClass('browser')} onClick={() => setActiveTab('browser')}>
            <span className="flex items-center gap-1.5"><Globe className="w-3 h-3" />Browser {browseHistory.length > 0 && <span className="bg-green-500/30 text-green-300 text-[10px] px-1.5 rounded-full">{browseHistory.length}</span>}</span>
          </button>
        </div>

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
          <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
            {editedFiles.length === 0 ? (
              <p className="text-[#586069] text-xs mt-4">No files edited yet.</p>
            ) : (
              <div className="space-y-1">
                <p className="text-[#8b949e] text-xs mb-3">{editedFiles.length} file(s) modified this session</p>
                {editedFiles.map(f => (
                  <div key={f} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/3 hover:bg-white/5 transition-colors">
                    <ChevronRight className="w-3 h-3 text-indigo-400 shrink-0" />
                    <span className="text-[13px] text-white font-mono">{f}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Browser tab */}
        {activeTab === 'browser' && (
          <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
            {!latestBrowse ? (
              <p className="text-[#586069] text-xs mt-4">No URLs browsed yet.</p>
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
    </div>
  );
}
