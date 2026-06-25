import React, { useEffect, useRef, useState } from 'react';
import { Send, Loader2, Sparkles } from 'lucide-react';

/**
 * Generic, config-driven chat UI for the "Professional AI" framework. One
 * component serves every config-driven professional (Teacher, and future
 * Lawyer/CA/Astrologer/…) — each just supplies a ProfessionalChatConfig.
 */
export interface ProfessionalChatConfig {
  id: string;            // matches the backend professional id / ViewType
  name: string;
  welcome: string;
  quickPrompts?: string[];
  /** Optional custom backend endpoint. Defaults to the generic professional
   *  route. Used by specialised surfaces (e.g. Repo Analyst) that have their
   *  own backend but reuse this chat UI. */
  endpoint?: string;
}

interface Msg { role: 'user' | 'assistant'; content: string; }

export function ProfessionalChat({ config, userId }: { config: ProfessionalChatConfig; userId?: string }) {
  const storeKey = `prof_${config.id}_messages`;
  const [messages, setMessages] = useState<Msg[]>(() => {
    try { const s = localStorage.getItem(storeKey); if (s) { const p = JSON.parse(s); if (Array.isArray(p) && p.length) return p; } } catch { /* ignore */ }
    return [{ role: 'assistant', content: config.welcome }];
  });
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { localStorage.setItem(storeKey, JSON.stringify(messages.slice(-50))); } catch { /* ignore */ }
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, storeKey]);

  const send = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || loading) return;
    setInput('');
    const next: Msg[] = [...messages, { role: 'user', content }];
    setMessages(next);
    setLoading(true);
    try {
      const history = next.filter((m) => m.content !== config.welcome).slice(-10);
      const res = await fetch(config.endpoint || `/api/professional/${config.id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: content, history, userId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Request failed.');
      setMessages((m) => [...m, { role: 'assistant', content: data.reply || '(no reply)' }]);
    } catch (e: any) {
      setMessages((m) => [...m, { role: 'assistant', content: `⚠️ ${e?.message || 'Something went wrong — please try again.'}` }]);
    } finally {
      setLoading(false);
    }
  };

  const showQuick = config.quickPrompts && messages.filter((m) => m.role === 'user').length === 0;

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#0d1117] text-white">
      <div className="px-4 py-3 border-b border-white/5 flex items-center gap-2 shrink-0">
        <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center"><Sparkles className="w-4 h-4" /></div>
        <span className="font-bold text-sm">{config.name}</span>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-4 space-y-4">
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed ${m.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-[#161b22] border border-white/10 text-[#c9d1d9]'}`}>
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start"><div className="bg-[#161b22] border border-white/10 rounded-2xl px-4 py-2.5"><Loader2 className="w-4 h-4 animate-spin text-indigo-400" /></div></div>
        )}
        {showQuick && (
          <div className="flex flex-wrap gap-2 pt-2">
            {config.quickPrompts!.map((q, i) => (
              <button key={i} onClick={() => send(q)} className="text-[12px] px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-[#c9d1d9]">{q}</button>
            ))}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="p-3 border-t border-white/5 flex items-end gap-2 shrink-0">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={`Ask ${config.name}…`}
          rows={1}
          className="flex-1 resize-none bg-[#161b22] border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-[#586069] focus:outline-none focus:border-indigo-500/40 max-h-32"
        />
        <button onClick={() => send()} disabled={!input.trim() || loading} className="w-9 h-9 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white flex items-center justify-center shrink-0">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
