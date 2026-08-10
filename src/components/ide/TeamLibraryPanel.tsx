// P-COLLAB.4 — Team-scoped shared library UI (prompts / templates / components).
//
// A compact panel a team can use to save and reuse curated prompts, templates, and components. Reads/writes
// the team-scoped library API (member-gated on the server). Self-contained: it resolves its own Firebase
// token, so it can be dropped into the Team collaboration surface with just a teamId.
import React, { useCallback, useEffect, useState } from 'react';
import { Box, Plus, Trash2, Copy, Check } from 'lucide-react';
import { authHeader } from '../../lib/authHeaders';

type LibraryKind = 'prompt' | 'template' | 'component';
interface LibraryItem { id: string; kind: LibraryKind; title: string; content: string; createdAt: number; }

const KINDS: LibraryKind[] = ['prompt', 'template', 'component'];


export const TeamLibraryPanel: React.FC<{ teamId: string }> = ({ teamId }) => {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [kind, setKind] = useState<LibraryKind>('prompt');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!teamId) return;
    try {
      const r = await fetch(`/api/team/${encodeURIComponent(teamId)}/library`, { headers: await authHeader() });
      if (r.ok) { const d = await r.json(); setItems(Array.isArray(d.items) ? d.items : []); }
    } catch { /* non-fatal */ }
  }, [teamId]);

  useEffect(() => { load(); }, [load]);

  const add = async () => {
    setError('');
    if (!title.trim() || !content.trim()) { setError('Title and content are required.'); return; }
    setBusy(true);
    try {
      const r = await fetch(`/api/team/${encodeURIComponent(teamId)}/library`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ kind, title: title.trim(), content }),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); setError(d?.error || 'Could not save.'); return; }
      setTitle(''); setContent(''); await load();
    } catch { setError('Could not save.'); }
    finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    try {
      const r = await fetch(`/api/team/${encodeURIComponent(teamId)}/library/${encodeURIComponent(id)}`, { method: 'DELETE', headers: await authHeader() });
      if (r.ok) await load();
    } catch { /* non-fatal */ }
  };

  const copy = async (item: LibraryItem) => {
    try { await navigator.clipboard.writeText(item.content); setCopiedId(item.id); setTimeout(() => setCopiedId(null), 1500); } catch { /* ignore */ }
  };

  return (
    <div className="bg-[#161b22] border border-white/5 rounded-2xl p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Box className="w-4 h-4 text-indigo-400" />
        <h3 className="text-xs font-black text-white uppercase tracking-widest">Team Library</h3>
        <span className="text-[10px] text-[#484f58] ml-auto">Shared prompts · templates · components</span>
      </div>

      {/* Add form */}
      <div className="bg-[#0d1117] rounded-xl p-3 border border-white/5 space-y-2">
        <div className="flex gap-2">
          {KINDS.map((k) => (
            <button key={k} onClick={() => setKind(k)}
              className={`text-[11px] font-bold px-2.5 py-1 rounded-full border capitalize ${kind === k ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300' : 'bg-black/30 border-white/10 text-[#8b949e]'}`}>{k}</button>
          ))}
        </div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (e.g. 'Landing page prompt')"
          className="w-full bg-[#161b22] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-[#484f58] focus:outline-none focus:border-indigo-500" />
        <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Content to reuse…" rows={3}
          className="w-full bg-[#161b22] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-[#484f58] focus:outline-none focus:border-indigo-500 resize-y" />
        {error && <p className="text-[11px] text-red-400">{error}</p>}
        <button onClick={add} disabled={busy} className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold disabled:opacity-50">
          <Plus className="w-3.5 h-3.5" /> {busy ? 'Saving…' : 'Save to library'}
        </button>
      </div>

      {/* Items */}
      {items.length === 0 ? (
        <p className="text-[11px] text-[#484f58]">No saved items yet. Save a prompt, template, or component your team can reuse.</p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.id} className="bg-[#0d1117] rounded-xl p-3 border border-white/5">
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-[#8b949e] capitalize">{item.kind}</span>
                <span className="text-xs font-bold text-white truncate">{item.title}</span>
                <button onClick={() => copy(item)} className="ml-auto p-1 text-[#8b949e] hover:text-indigo-300 shrink-0" aria-label="Copy">
                  {copiedId === item.id ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
                <button onClick={() => remove(item.id)} className="p-1 text-[#8b949e] hover:text-red-400 shrink-0" aria-label="Delete">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <pre className="text-[10px] text-[#8b949e] mt-1.5 whitespace-pre-wrap break-words max-h-24 overflow-auto font-mono">{item.content.slice(0, 400)}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
