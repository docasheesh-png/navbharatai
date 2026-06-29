import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, X, ChevronRight, RefreshCw, Zap, Lightbulb } from 'lucide-react';

interface Suggestion {
  id: string;
  label: string;
  prompt: string;
  category: 'improve' | 'add' | 'fix' | 'style';
}

interface AISuggestionsProps {
  generatedCode?: string;
  onSendSuggestion: (prompt: string) => void;
}

const CATEGORY_COLOR: Record<Suggestion['category'], string> = {
  improve: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20',
  add: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  fix: 'text-red-400 bg-red-500/10 border-red-500/20',
  style: 'text-pink-400 bg-pink-500/10 border-pink-500/20',
};

const STATIC_SUGGESTIONS: Suggestion[] = [
  { id: 's1', label: 'Add dark mode toggle', prompt: 'Add a dark/light mode toggle button to this app', category: 'add' },
  { id: 's2', label: 'Make it mobile-friendly', prompt: 'Make this app fully responsive and mobile-friendly', category: 'style' },
  { id: 's3', label: 'Add loading animations', prompt: 'Add smooth loading animations and skeleton screens', category: 'improve' },
  { id: 's4', label: 'Improve color scheme', prompt: 'Improve the color scheme to look more professional and modern', category: 'style' },
  { id: 's5', label: 'Add form validation', prompt: 'Add proper form validation with error messages', category: 'fix' },
  { id: 's6', label: 'Add search functionality', prompt: 'Add a search bar with live filtering', category: 'add' },
  { id: 's7', label: 'Improve performance', prompt: 'Optimize this app for better performance — lazy loading, reduced DOM', category: 'improve' },
  { id: 's8', label: 'Add keyboard shortcuts', prompt: 'Add keyboard shortcuts for common actions', category: 'add' },
];

function deriveSuggestions(code: string): Suggestion[] {
  if (!code || code.length < 100) return STATIC_SUGGESTIONS.slice(0, 4);

  const suggestions: Suggestion[] = [];

  if (!/<nav|navbar|navigation/i.test(code)) {
    suggestions.push({ id: 'd1', label: 'Add navigation bar', prompt: 'Add a responsive navigation bar with links', category: 'add' });
  }
  if (!/<footer/i.test(code)) {
    suggestions.push({ id: 'd2', label: 'Add footer section', prompt: 'Add a professional footer with contact info and links', category: 'add' });
  }
  if (!(/dark|night|theme/i.test(code))) {
    suggestions.push({ id: 'd3', label: 'Add dark mode', prompt: 'Add dark mode support with a toggle button', category: 'add' });
  }
  if (!/@media/i.test(code)) {
    suggestions.push({ id: 'd4', label: 'Make responsive', prompt: 'Add responsive CSS media queries for mobile and tablet', category: 'style' });
  }
  if (/<button/i.test(code) && !/:hover/i.test(code)) {
    suggestions.push({ id: 'd5', label: 'Add hover effects', prompt: 'Add smooth hover effects and transitions to all buttons', category: 'style' });
  }
  if (!/<input|<form/i.test(code)) {
    suggestions.push({ id: 'd6', label: 'Add contact form', prompt: 'Add a contact/feedback form with validation', category: 'add' });
  }
  if (!/<animation|@keyframes|transition/i.test(code)) {
    suggestions.push({ id: 'd7', label: 'Add animations', prompt: 'Add smooth CSS animations and entrance effects', category: 'improve' });
  }
  if (/error|bug|broken|undefined/i.test(code)) {
    suggestions.push({ id: 'd8', label: 'Fix potential issues', prompt: 'Review this code for bugs and fix any issues you find', category: 'fix' });
  }

  // Fill up to 5 with static ones not already covered
  const all = [...suggestions, ...STATIC_SUGGESTIONS].slice(0, 5);
  return all;
}

export const AISuggestions: React.FC<AISuggestionsProps> = ({ generatedCode, onSendSuggestion }) => {
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>(STATIC_SUGGESTIONS.slice(0, 4));
  const [loading, setLoading] = useState(false);
  const [aiPowered, setAiPowered] = useState(false);
  const prevCodeRef = useRef<string | undefined>(undefined);

  // P-DESIGN.5 — pull REAL AI suggestions from the design pass; fall back to the static/heuristic
  // list on any failure so the panel always shows something useful. Never throws.
  const fetchAISuggestions = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/design/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: generatedCode || '' }),
      });
      const data = res.ok ? await res.json() : null;
      const list: any[] = Array.isArray(data?.suggestions) ? data.suggestions : [];
      const mapped: Suggestion[] = list
        .filter((s) => s && typeof s.label === 'string' && typeof s.prompt === 'string')
        .map((s, i) => ({
          id: `ai${i}`,
          label: s.label,
          prompt: s.prompt,
          category: (['improve', 'add', 'fix', 'style'].includes(s.category) ? s.category : 'improve') as Suggestion['category'],
        }));
      if (mapped.length > 0) {
        setSuggestions(mapped);
        setAiPowered(true);
        return;
      }
    } catch { /* fall through to heuristic suggestions */ }
    finally { setLoading(false); }
    // Fallback: heuristic/static suggestions.
    setAiPowered(false);
    setSuggestions(generatedCode ? deriveSuggestions(generatedCode) : STATIC_SUGGESTIONS.slice(0, 4));
  };

  useEffect(() => {
    if (generatedCode && generatedCode !== prevCodeRef.current) {
      prevCodeRef.current = generatedCode;
      // Show heuristic suggestions instantly, then upgrade to AI ones in the background.
      setSuggestions(deriveSuggestions(generatedCode));
      void fetchAISuggestions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generatedCode]);

  // When the panel is first opened with no AI suggestions yet, fetch them.
  useEffect(() => {
    if (open && !aiPowered && !loading) void fetchAISuggestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const refresh = () => {
    void fetchAISuggestions();
  };

  return (
    <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2">
      {/* Panel */}
      {open && (
        <div className="w-72 bg-[#161b22] border border-white/10 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
            <div className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              <span className="text-xs font-black text-white uppercase tracking-widest">AI Copilot</span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={refresh} disabled={loading} className="p-1 hover:bg-white/10 rounded-lg text-[#484f58] hover:text-white transition-colors disabled:opacity-50" title="Refresh AI suggestions">
                <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
              </button>
              <button onClick={() => setOpen(false)} className="p-1 hover:bg-white/10 rounded-lg text-[#484f58] hover:text-white transition-colors">
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>

          <div className="p-2 space-y-1">
            <p className="text-[9px] text-[#484f58] font-bold uppercase tracking-widest px-2 pb-1">
              {loading ? 'Thinking…' : aiPowered ? 'AI suggestions' : generatedCode ? 'App-specific suggestions' : 'Quick prompts'}
            </p>
            {suggestions.map(s => (
              <button
                key={s.id}
                onClick={() => { onSendSuggestion(s.prompt); setOpen(false); }}
                className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-white/5 rounded-xl transition-all group text-left"
              >
                <span className={`text-[9px] font-black px-1.5 py-0.5 rounded border uppercase tracking-wider flex-shrink-0 ${CATEGORY_COLOR[s.category]}`}>
                  {s.category}
                </span>
                <span className="text-[11px] text-[#c9d1d9] group-hover:text-white transition-colors flex-1 leading-tight">{s.label}</span>
                <ChevronRight className="w-3 h-3 text-[#484f58] group-hover:text-indigo-400 flex-shrink-0 transition-colors" />
              </button>
            ))}
          </div>

          <div className="px-4 py-2.5 border-t border-white/5">
            <p className="text-[8px] text-[#484f58] text-center uppercase tracking-widest">
              Powered by NavBharat AI • Click to send
            </p>
          </div>
        </div>
      )}

      {/* Floating button */}
      <button
        onClick={() => setOpen(p => !p)}
        className={`flex items-center gap-2 px-3.5 py-2.5 rounded-2xl font-black text-xs uppercase tracking-widest transition-all shadow-lg ${
          open
            ? 'bg-indigo-700 text-white shadow-indigo-900/50'
            : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-900/40 hover:scale-105'
        }`}
      >
        {open ? <Zap className="w-4 h-4" /> : <Lightbulb className="w-4 h-4" />}
        <span className="hidden sm:inline">{open ? 'Close' : 'AI Copilot'}</span>
      </button>
    </div>
  );
};
