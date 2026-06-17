import { useEffect, useRef, useState } from 'react';
import {
  HardHat, Loader2, Send, Square, Terminal, FolderOpen, Globe,
  CheckCircle2, AlertCircle, ChevronRight, Play, FileDiff,
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

interface FilePair {
  current: string;
  previous?: string;
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
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('terminal');
  const [terminalEntries, setTerminalEntries] = useState<TerminalEntry[]>([]);
  const [fileMap, setFileMap] = useState<Record<string, FilePair>>({});
  const [editOrder, setEditOrder] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [browseHistory, setBrowseHistory] = useState<BrowseEntry[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);

  const workspaceIdRef = useRef<string>((() => {
    if (!userId) return `ws_anon_${Date.now()}`;
    const key = `engineer_ws_${userId}`;
    const stored = localStorage.getItem(key);
    if (stored) return stored;
    const fresh = `ws_${userId}_${Date.now()}`;
    localStorage.setItem(key, fresh);
    return fresh;
  })());

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
      case 'action_start':
        setStatusMsg('');
        if (event.thought) appendChat('agent', `💭 ${event.thought}`);
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
        if (!event.success) appendChat('system', 'Build failed — fixing errors…');
        break;
      case 'browse_result':
        setBrowseHistory(prev => [...prev, { url: event.url, content: event.content }]);
        setActiveTab('browser');
        appendChat('system', `Browsed: ${event.url}`);
        break;
      case 'server_ready':
        setPreviewUrl(event.url);
        setActiveTab('browser');
        appendChat('agent', `🚀 Dev server running on port ${event.port} — live preview ready`);
        break;
      case 'complete':
        setStatusMsg('');
        appendChat('agent', `✅ Done in ${event.steps} step${event.steps === 1 ? '' : 's'}: ${event.summary}`);
        break;
      case 'max_steps_reached':
        setStatusMsg('');
        appendChat('system', `Reached ${event.steps}-step limit without finishing. Try a more specific instruction.`);
        break;
      case 'aborted':
        setStatusMsg('');
        appendChat('system', 'Stopped.');
        break;
      case 'error':
        setStatusMsg('');
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
    setStatusMsg('');
    setFileMap({});
    setEditOrder([]);
    setSelectedFile(null);
    setPreviewUrl(null);

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

  const latestBrowse = browseHistory[browseHistory.length - 1];
  const selectedPair = selectedFile ? fileMap[selectedFile] : null;
  const hasDiff = !!(selectedPair?.previous && selectedPair.previous !== selectedPair.current);
  const diffLines = hasDiff && showDiff
    ? computeDiff(selectedPair!.previous!, selectedPair!.current)
    : null;

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
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>{statusMsg || 'Working…'}</span>
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
            <span className="flex items-center gap-1.5">
              <FolderOpen className="w-3 h-3" />Files
              {editOrder.length > 0 && <span className="bg-indigo-500/30 text-indigo-300 text-[10px] px-1.5 rounded-full">{editOrder.length}</span>}
            </span>
          </button>
          <button className={tabClass('browser')} onClick={() => setActiveTab('browser')}>
            <span className="flex items-center gap-1.5">
              <Globe className="w-3 h-3" />Browser
              {(previewUrl || browseHistory.length > 0) && (
                <span className="bg-green-500/30 text-green-300 text-[10px] px-1.5 rounded-full">
                  {previewUrl ? '▶' : browseHistory.length}
                </span>
              )}
            </span>
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
            {/* Live preview iframe (from server_ready) */}
            {previewUrl && (
              <div className="flex flex-col flex-1 min-h-0">
                <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5 shrink-0">
                  <Play className="w-3 h-3 text-green-400 shrink-0" />
                  <span className="text-xs text-green-300 font-medium flex-1 truncate">Live Preview</span>
                  <a
                    href={previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-[#8b949e] hover:text-white transition-colors"
                  >
                    Open ↗
                  </a>
                </div>
                <iframe
                  src={previewUrl}
                  className="flex-1 w-full border-0 bg-white"
                  title="Live preview"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                />
              </div>
            )}

            {/* Browse results (curl/playwright) */}
            {!previewUrl && (
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
        )}
      </div>
    </div>
  );
}
