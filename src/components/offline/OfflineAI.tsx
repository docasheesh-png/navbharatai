import React, { useEffect, useMemo, useState } from 'react';
import { Wifi, Smartphone, Search, ArrowRight, Sparkles, BookOpen, Link2, Calculator, Clock, MessageCircle } from 'lucide-react';
import {
  answerOffline, howToSteps, navFor, relatedFeaturesOf, SUGGESTED_QUERIES,
  type NavTarget, type QuickAnswerKind,
} from '../../lib/offlineAssistant';

/**
 * Offline AI — a 100% on-device app guide (admin 2026-07-16, enhanced 2026-07-18). Grounded entirely in
 * the bundled AppKnowledgeBase, so it works with NO internet and knows EVERY NavBharatAI feature with
 * zero hallucination. It answers "where is X / how do I Y", shows the exact path + steps, and — for
 * reachable surfaces — a real "Open →" button that navigates there. Retrieval is typo-tolerant (a small
 * misspelling still finds the right feature), each result shows its related features as one-tap chips,
 * and starter chips give the user a next step even from a blank or empty-result screen. New features
 * become answerable automatically (their KB entry is added per CLAUDE.md). App-BUILDING / full Pro chat
 * need the online engine; the UI says so honestly and never fakes those here.
 */
export interface OfflineAIProps {
  /** Navigate to an in-app target (wired in App.tsx to toggleTab / setActiveView + setSettingsScreen). */
  onNavigate: (target: NavTarget) => void;
}

function useOnline(): boolean {
  const [online, setOnline] = useState<boolean>(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}

/** The icon for a deterministic on-device answer, by category. */
const AnswerIcon: React.FC<{ kind?: QuickAnswerKind }> = ({ kind }) => {
  if (kind === 'math') return <Calculator className="w-4 h-4 text-emerald-400" />;
  if (kind === 'datetime') return <Clock className="w-4 h-4 text-emerald-400" />;
  return <MessageCircle className="w-4 h-4 text-emerald-400" />;
};

/** A small pill button used for starter suggestions and related-feature hops. */
const Chip: React.FC<{ label: string; onClick: () => void; icon?: React.ReactNode }> = ({ label, onClick, icon }) => (
  <button
    onClick={onClick}
    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#161b22] border border-white/10 hover:border-indigo-500/50 hover:bg-indigo-600/10 text-[11px] font-semibold text-[#c9d1d9] transition-all active:scale-95"
  >
    {icon}
    <span className="truncate max-w-[180px]">{label}</span>
  </button>
);

export const OfflineAI: React.FC<OfflineAIProps> = ({ onNavigate }) => {
  const [query, setQuery] = useState('');
  const online = useOnline();
  const answer = useMemo(() => answerOffline(query), [query]);

  // Setting the query re-runs retrieval; used by starter and related chips so the user never retypes.
  const runQuery = (q: string) => setQuery(q);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar bg-[#0d1117] text-white">
      <div className="max-w-3xl mx-auto px-4 py-5 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-indigo-600/15 border border-indigo-500/30 flex items-center justify-center shrink-0">
              <BookOpen className="w-4 h-4 text-indigo-400" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-black tracking-tight truncate">Offline AI</h1>
              <p className="text-[10px] text-[#8b949e] truncate">On-device app guide — works without internet</p>
            </div>
          </div>
          <span
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border shrink-0 ${
              online ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
            }`}
            title={online ? "You're online — full NavBharatAI is available too" : "You're offline — this on-device guide still works"}
          >
            {online ? <Wifi className="w-3 h-3" /> : <Smartphone className="w-3 h-3" />}
            {online ? 'Offline AI • on-device' : 'Offline • on-device'}
          </span>
        </div>

        {/* Honest scope note */}
        <div className="flex items-start gap-2 p-3 rounded-2xl bg-[#161b22] border border-white/5">
          <Sparkles className="w-3.5 h-3.5 text-indigo-400 mt-0.5 shrink-0" />
          <p className="text-[11px] text-[#8b949e] leading-relaxed">
            I know every feature of NavBharatAI — ask me <span className="text-white font-semibold">“where is X”</span> or
            <span className="text-white font-semibold"> “how do I Y”</span> and I’ll show you the exact place and take you there.
            I can also answer quick things offline — a <span className="text-white font-semibold">calculation</span> or
            <span className="text-white font-semibold"> today’s date &amp; time</span>.
            <span className="text-[#484f58]"> Building apps, full chat and general questions need internet — go online for those.</span>
          </p>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="w-4 h-4 text-[#484f58] absolute left-4 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask: where is the database? · 15% of 200 · today's date…"
            className="w-full bg-[#161b22] border border-white/10 rounded-2xl pl-11 pr-4 py-3 text-sm text-white placeholder-[#484f58] focus:outline-none focus:border-indigo-500/50"
            autoFocus
          />
        </div>

        {/* Lead line */}
        <p className="text-[11px] text-[#8b949e] px-1">{answer.lead}</p>

        {/* Deterministic on-device answer (real math / device clock / honest statement — never a faked
            fact). Shown for kind 'answer'. */}
        {answer.kind === 'answer' && answer.answerText && (
          <div className="flex items-start gap-3 p-4 rounded-2xl bg-emerald-500/[0.06] border border-emerald-500/20">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center shrink-0">
              <AnswerIcon kind={answer.answerKind} />
            </div>
            <p className="text-sm text-white font-semibold leading-relaxed pt-1 break-words min-w-0">{answer.answerText}</p>
          </div>
        )}

        {/* Starter / recovery suggestions — shown on the overview (blank box) and on an empty result, so
            the user always has a real next tap. Each chip runs a query that resolves to a real KB entry. */}
        {answer.kind !== 'matches' && (
          <div className="flex flex-wrap gap-2">
            {SUGGESTED_QUERIES.map((s) => (
              <Chip key={s.query} label={s.label} onClick={() => runQuery(s.query)} icon={<Sparkles className="w-3 h-3 text-indigo-400 shrink-0" />} />
            ))}
          </div>
        )}

        {/* Result cards */}
        <div className="space-y-2.5">
          {answer.matches.map((f) => {
            const target = navFor(f);
            const steps = howToSteps(f.howToUse).slice(0, 4);
            const related = relatedFeaturesOf(f);
            return (
              <div key={f.id} className="bg-[#161b22] border border-white/5 rounded-2xl p-4 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-black text-white">{f.name}</h3>
                    <p className="text-[10px] text-indigo-400 font-mono mt-0.5">{f.path}</p>
                  </div>
                  {target && (
                    <button
                      onClick={() => onNavigate(target)}
                      className="shrink-0 flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95"
                    >
                      Open <ArrowRight className="w-3 h-3" />
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-[#8b949e] leading-relaxed">{f.description.split('\n')[0]}</p>
                {steps.length > 0 && (
                  <ol className="text-[11px] text-[#c9d1d9] space-y-1 pt-1">
                    {steps.map((s, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="text-indigo-400 font-black shrink-0">{i + 1}.</span>
                        <span className="leading-relaxed">{s}</span>
                      </li>
                    ))}
                  </ol>
                )}
                {related.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-white/5 mt-1">
                    <span className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-[#484f58] shrink-0">
                      <Link2 className="w-3 h-3" /> Related
                    </span>
                    {related.map((r) => (
                      <button
                        key={r.id}
                        onClick={() => runQuery(r.name)}
                        className="px-2.5 py-1 rounded-full bg-[#0d1117] border border-white/10 hover:border-indigo-500/50 hover:text-white text-[10px] font-semibold text-[#8b949e] transition-all active:scale-95"
                      >
                        {r.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default OfflineAI;
