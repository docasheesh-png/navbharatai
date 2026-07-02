import React, { useEffect, useRef, useState } from 'react';
import { Send, Loader2, Sparkles, Paperclip, X, FileText } from 'lucide-react';

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

const MAX_FILES = 4;
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB per file (matches the other chat surfaces)
const ACCEPTED_TYPES = 'image/*,.pdf,.txt,.md,.csv,.json,.html,.docx,.xlsx,.xls,.pptx,.zip,.js,.ts,.tsx,.jsx,.py,.css';

/** Read a file to { name, type, base64 } (base64 WITHOUT the data: prefix). Large images are
 *  downscaled client-side so uploads stay fast and vision models get a reasonable size. */
async function fileToAttachment(file: File): Promise<{ name: string; type: string; base64: string }> {
  const readRaw = () => new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  if (file.type.startsWith('image/') && file.size > 900 * 1024) {
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1568 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      return { name: file.name.replace(/\.[a-z0-9]+$/i, '') + '.jpg', type: 'image/jpeg', base64: dataUrl.split(',')[1] || '' };
    } catch { /* fall through to raw read */ }
  }
  return { name: file.name, type: file.type || 'application/octet-stream', base64: await readRaw() };
}

export function ProfessionalChat({ config, userId }: { config: ProfessionalChatConfig; userId?: string }) {
  const storeKey = `prof_${config.id}_messages`;
  const [messages, setMessages] = useState<Msg[]>(() => {
    try { const s = localStorage.getItem(storeKey); if (s) { const p = JSON.parse(s); if (Array.isArray(p) && p.length) return p; } } catch { /* ignore */ }
    return [{ role: 'assistant', content: config.welcome }];
  });
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try { localStorage.setItem(storeKey, JSON.stringify(messages.slice(-50))); } catch { /* ignore */ }
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, storeKey]);

  const addFiles = (list: FileList | File[] | null) => {
    if (!list) return;
    const incoming = Array.from(list).filter((f) => f.size <= MAX_FILE_BYTES);
    setFiles((prev) => [...prev, ...incoming].slice(0, MAX_FILES));
  };

  const send = async (text?: string) => {
    const content = (text ?? input).trim();
    if ((!content && files.length === 0) || loading) return;
    const sendFiles = files;
    setInput('');
    setFiles([]);
    const shownContent = sendFiles.length > 0
      ? `${content || '(files attached)'}\n📎 ${sendFiles.map((f) => f.name).join(', ')}`
      : content;
    const next: Msg[] = [...messages, { role: 'user', content: shownContent }];
    setMessages(next);
    setLoading(true);
    try {
      const attachments = await Promise.all(sendFiles.map(fileToAttachment));
      const history = next.filter((m) => m.content !== config.welcome).slice(-10);
      const res = await fetch(config.endpoint || `/api/professional/${config.id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: content,
          history,
          userId,
          ...(attachments.length > 0 ? { attachments } : {}),
        }),
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

      {files.length > 0 && (
        <div className="px-3 pt-2 flex flex-wrap gap-2 shrink-0">
          {files.map((f, i) => (
            <span key={i} className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-300">
              <FileText className="w-3 h-3" />
              <span className="max-w-[140px] truncate">{f.name}</span>
              <button onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} className="hover:text-white"><X className="w-3 h-3" /></button>
            </span>
          ))}
        </div>
      )}

      <div className="p-3 border-t border-white/5 flex items-end gap-2 shrink-0">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPTED_TYPES}
          className="hidden"
          onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={loading || files.length >= MAX_FILES}
          title="Attach files (images, PDFs, documents)"
          className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 disabled:opacity-40 border border-white/10 text-[#c9d1d9] flex items-center justify-center shrink-0"
        >
          <Paperclip className="w-4 h-4" />
        </button>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          onPaste={(e) => {
            const items: DataTransferItem[] = e.clipboardData ? Array.from(e.clipboardData.items) : [];
            const pasted = items.map((it) => (it.kind === 'file' ? it.getAsFile() : null)).filter(Boolean) as File[];
            if (pasted.length > 0) { e.preventDefault(); addFiles(pasted); }
          }}
          placeholder={`Ask ${config.name}…`}
          rows={1}
          className="flex-1 resize-none bg-[#161b22] border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-[#586069] focus:outline-none focus:border-indigo-500/40 max-h-32"
        />
        <button onClick={() => send()} disabled={(!input.trim() && files.length === 0) || loading} className="w-9 h-9 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white flex items-center justify-center shrink-0">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
