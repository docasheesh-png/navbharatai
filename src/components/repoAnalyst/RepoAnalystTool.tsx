import React, { useEffect, useRef, useState } from 'react';
import { GitBranch, Loader2, Search, Send } from 'lucide-react';

/**
 * Dedicated "GitHub Repo Analyst & Improver" tool UI.
 *
 * A focused surface (not a generic chat): paste a PUBLIC GitHub repo URL,
 * "Analyse" fetches & analyses the real repo via /api/repo-analyst/chat, and
 * the structured report renders in a panel. A follow-up box lets the user ask
 * more about the same repo (history is sent so the backend reuses it).
 */

interface Turn { role: 'user' | 'assistant'; content: string; }

const ENDPOINT = '/api/repo-analyst/chat';

/** Light, safe renderer: **bold**, `code`, and heading-ish lines — no HTML injection. */
function renderReport(text: string): React.ReactNode {
  const lines = text.split('\n');
  return lines.map((line, i) => {
    const heading = /^#{1,6}\s+/.test(line) || /^\s*[A-Z][A-Za-z /&]{2,40}:\s*$/.test(line) || /^\*\*[^*]+\*\*:?\s*$/.test(line.trim());
    const clean = line.replace(/^#{1,6}\s+/, '');
    return (
      <div key={i} className={heading ? 'font-bold text-white mt-3 mb-1' : 'leading-relaxed'}>
        {renderInline(clean)}
      </div>
    );
  });
}

function renderInline(s: string): React.ReactNode {
  // Split on **bold** and `code`, render the rest as plain text.
  const parts = s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i} className="text-white">{p.slice(2, -2)}</strong>;
    if (/^`[^`]+`$/.test(p)) return <code key={i} className="px-1 py-0.5 rounded bg-white/10 text-indigo-300 text-[12px]">{p.slice(1, -1)}</code>;
    return <span key={i}>{p}</span>;
  });
}

export function RepoAnalystTool({ userId }: { userId?: string }) {
  const [repoUrl, setRepoUrl] = useState('');
  const [analysedRepo, setAnalysedRepo] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]); // report + follow-ups (assistant/user)
  const [loading, setLoading] = useState(false);
  const [followUp, setFollowUp] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [turns, loading]);

  const post = async (message: string, history: Turn[]): Promise<string> => {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history, userId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || 'Request failed.');
    return data.reply || '(no reply)';
  };

  const analyse = async () => {
    const url = repoUrl.trim();
    if (!url || loading) return;
    setLoading(true);
    setTurns([]);
    setAnalysedRepo(url);
    const userMsg = `Analyse this repository and give a structured report (overview, tech stack, strengths, gaps/weaknesses, security & quality flags, license & reuse note, and a prioritised improvement plan with code snippets): ${url}`;
    try {
      const reply = await post(userMsg, []);
      setTurns([{ role: 'user', content: userMsg }, { role: 'assistant', content: reply }]);
    } catch (e: any) {
      setTurns([{ role: 'assistant', content: `⚠️ ${e?.message || 'Something went wrong — please try again.'}` }]);
    } finally {
      setLoading(false);
    }
  };

  const ask = async (text?: string) => {
    const content = (text ?? followUp).trim();
    if (!content || loading) return;
    setFollowUp('');
    const next: Turn[] = [...turns, { role: 'user', content }];
    setTurns(next);
    setLoading(true);
    try {
      const reply = await post(content, next.slice(-10));
      setTurns((t) => [...t, { role: 'assistant', content: reply }]);
    } catch (e: any) {
      setTurns((t) => [...t, { role: 'assistant', content: `⚠️ ${e?.message || 'Something went wrong — please try again.'}` }]);
    } finally {
      setLoading(false);
    }
  };

  const hasReport = turns.some((t) => t.role === 'assistant');

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#0d1117] text-[#c9d1d9]">
      {/* Header */}
      <div className="px-5 py-4 border-b border-white/5 shrink-0">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center"><GitBranch className="w-4 h-4" /></div>
          <h1 className="font-black text-white tracking-tight">GitHub Repo Analyst &amp; Improver</h1>
        </div>
        <p className="text-[12px] text-[#8b949e]">Paste a public GitHub repo — it fetches the real repo (read-only) and analyses it: strengths, gaps, security/quality, license &amp; a prioritised improvement plan. It can’t modify repos you don’t own; “copy good things” means learning patterns license-respectfully.</p>
      </div>

      {/* URL input */}
      <div className="px-5 py-3 border-b border-white/5 shrink-0 flex items-center gap-2">
        <div className="flex-1 flex items-center gap-2 bg-[#161b22] border border-white/10 rounded-xl px-3 py-2 focus-within:border-indigo-500/40">
          <Search className="w-4 h-4 text-[#586069] shrink-0" />
          <input
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); analyse(); } }}
            placeholder="https://github.com/owner/repo  (or  owner/repo)"
            className="flex-1 bg-transparent text-sm text-white placeholder:text-[#586069] focus:outline-none"
          />
        </div>
        <button onClick={analyse} disabled={!repoUrl.trim() || loading} className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-semibold flex items-center gap-2 shrink-0">
          {loading && !hasReport ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitBranch className="w-4 h-4" />}
          Analyse
        </button>
      </div>

      {/* Report area */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-4">
        {!analysedRepo && !loading && (
          <div className="h-full flex flex-col items-center justify-center text-center text-[#586069] gap-3">
            <GitBranch className="w-10 h-10 opacity-40" />
            <p className="text-sm max-w-md">Paste a public GitHub repository above and press <span className="text-[#8b949e] font-semibold">Analyse</span>. Try a popular open-source project, or your own repo.</p>
          </div>
        )}

        {analysedRepo && (
          <div className="mb-3 text-[12px] text-[#8b949e]">Analysing: <span className="text-indigo-300 font-mono">{analysedRepo}</span></div>
        )}

        <div className="space-y-4 max-w-3xl">
          {turns.filter((t) => t.role === 'assistant' || (hasReport && t.role === 'user' && turns.indexOf(t) > 1)).map((t, i) => (
            t.role === 'assistant' ? (
              <div key={i} className="bg-[#161b22] border border-white/10 rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap">
                {renderReport(t.content)}
              </div>
            ) : (
              <div key={i} className="flex justify-end"><div className="max-w-[85%] rounded-2xl px-4 py-2 text-sm bg-indigo-600 text-white">{t.content}</div></div>
            )
          ))}
          {loading && (
            <div className="bg-[#161b22] border border-white/10 rounded-2xl px-4 py-3 flex items-center gap-2 text-sm text-[#8b949e]">
              <Loader2 className="w-4 h-4 animate-spin text-indigo-400" /> Fetching &amp; analysing the repository…
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      {/* Follow-up box (only after a report exists) */}
      {hasReport && (
        <div className="p-3 border-t border-white/5 flex items-end gap-2 shrink-0">
          <textarea
            value={followUp}
            onChange={(e) => setFollowUp(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } }}
            placeholder="Ask a follow-up about this repo (e.g. “how would I add tests?”)…"
            rows={1}
            className="flex-1 resize-none bg-[#161b22] border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-[#586069] focus:outline-none focus:border-indigo-500/40 max-h-32"
          />
          <button onClick={() => ask()} disabled={!followUp.trim() || loading} className="w-9 h-9 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white flex items-center justify-center shrink-0">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      )}
    </div>
  );
}
