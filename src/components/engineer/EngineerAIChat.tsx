import { useRef, useState } from 'react';
import { HardHat, Loader2, Send } from 'lucide-react';

interface EngineerMessage {
  id: string;
  role: 'user' | 'agent' | 'system';
  text: string;
}

interface EngineerAIChatProps {
  userId?: string;
}

const WELCOME: EngineerMessage = {
  id: 'welcome',
  role: 'agent',
  text: "Hi, I'm Engineer AI. Tell me what to build or fix, and I'll plan, edit files, and run the build until it's done.",
};

export function EngineerAIChat({ userId }: EngineerAIChatProps) {
  const [messages, setMessages] = useState<EngineerMessage[]>([WELCOME]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const workspaceIdRef = useRef<string>(`ws_${userId || 'anon'}_${Date.now()}`);

  const append = (role: EngineerMessage['role'], text: string) => {
    setMessages(prev => [...prev, { id: `${Date.now()}_${Math.random()}`, role, text }]);
  };

  const handleEvent = (event: any) => {
    switch (event.type) {
      case 'iteration_start':
        append('system', `Iteration ${event.iteration}…`);
        break;
      case 'plan':
        append('agent', event.summary || `Planned ${event.editCount} file edit(s).`);
        break;
      case 'files_changed':
        append('system', `Edited: ${event.paths.join(', ')}`);
        break;
      case 'build_result':
        append('system', event.success ? 'Build succeeded.' : `Build failed:\n${(event.logs || '').slice(-800)}`);
        break;
      case 'complete':
        append('agent', `${event.summary} (${event.iterations} iteration${event.iterations === 1 ? '' : 's'})`);
        break;
      case 'max_iterations_reached':
        append('system', `Stopped after ${event.iterations} iterations without finishing — try a more specific instruction.`);
        break;
      case 'error':
        append('system', `Error: ${event.message}`);
        break;
    }
  };

  const handleSend = async () => {
    const instruction = input.trim();
    if (!instruction || loading) return;
    setInput('');
    append('user', instruction);
    setLoading(true);

    try {
      const res = await fetch('/api/engineer-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: workspaceIdRef.current, instruction }),
      });
      if (!res.ok || !res.body) throw new Error(`API error: ${res.status}`);

      const reader = res.body.getReader();
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
          try {
            handleEvent(JSON.parse(json));
          } catch {
            // ignore malformed SSE frame
          }
        }
      }
    } catch (err: any) {
      append('system', `Error: ${err?.message || 'Engineer AI failed.'}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 bg-[#0d1117]">
      <div className="px-6 py-4 border-b border-white/5 flex items-center gap-2.5 shrink-0">
        <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center">
          <HardHat className="w-4 h-4" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-white">Engineer AI</h2>
          <p className="text-[11px] text-[#8b949e]">Autonomous coding agent — Phase 1</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-4 space-y-3">
        {messages.map(m => (
          <div
            key={m.id}
            className={`max-w-[80%] rounded-xl px-3.5 py-2.5 text-[13px] whitespace-pre-wrap leading-relaxed ${
              m.role === 'user'
                ? 'ml-auto bg-indigo-600 text-white'
                : m.role === 'system'
                  ? 'bg-white/5 text-[#8b949e] text-[11px] font-mono'
                  : 'bg-[#161b22] border border-white/10 text-white'
            }`}
          >
            {m.text}
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-[#8b949e] text-xs">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Working…
          </div>
        )}
      </div>

      <div className="p-4 border-t border-white/5 flex items-center gap-2 shrink-0">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Tell Engineer AI what to build or fix…"
          disabled={loading}
          className="flex-1 bg-[#161b22] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-[#586069] focus:outline-none focus:border-indigo-500/40"
        />
        <button
          onClick={handleSend}
          disabled={loading || !input.trim()}
          className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center disabled:opacity-40 shrink-0"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
