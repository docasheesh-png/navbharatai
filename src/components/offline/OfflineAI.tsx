import React, { useEffect, useMemo, useState } from 'react';
import { Wifi, Smartphone, Search, ArrowRight, Sparkles, BookOpen, Link2, Calculator, Clock, MessageCircle, Brain, Trash2, CornerDownLeft, Check } from 'lucide-react';
import {
  answerOffline, howToSteps, navFor, relatedFeaturesOf, SUGGESTED_QUERIES,
  type NavTarget, type QuickAnswerKind,
} from '../../lib/offlineAssistant';
import {
  parseTeaching, addMemory, removeMemory, loadMemories, saveMemories, type UserMemory,
} from '../../lib/offlineMemory';

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
const AnswerIcon: React.FC<{ kind?: QuickAnswerKind | 'memory' }> = ({ kind }) => {
  if (kind === 'math') return <Calculator className="w-4 h-4 text-emerald-400" />;
  if (kind === 'datetime') return <Clock className="w-4 h-4 text-emerald-400" />;
  if (kind === 'memory') return <Brain className="w-4 h-4 text-emerald-400" />;
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

  // On-device taught memory — loaded from localStorage, persisted on every change (never uploaded).
  const [memories, setMemories] = useState<UserMemory[]>([]);
  const [justTaught, setJustTaught] = useState<UserMemory | null>(null);
  const [showMemories, setShowMemories] = useState(false);

  useEffect(() => { setMemories(loadMemories()); }, []);

  const persist = (list: UserMemory[]) => { setMemories(list); saveMemories(list); };

  // The answer is memory-aware: recall of what the user taught this device happens inside answerOffline.
  const answer = useMemo(() => answerOffline(query, new Date(), memories), [query, memories]);

  // If the current text is a teaching command ("remember …", "when I ask …"), we offer to save it on
  // Enter instead of searching — so live typing never stores a half-finished thought.
  const pendingTeach = useMemo(() => parseTeaching(query), [query]);

  // Setting the query re-runs retrieval; used by starter and related chips so the user never retypes.
  const runQuery = (q: string) => { setJustTaught(null); setQuery(q); };

  const commitTeach = () => {
    const parsed = parseTeaching(query);
    if (!parsed) return;
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const next = addMemory(memories, parsed, id, Date.now());
    persist(next);
    setJustTaught(next[next.length - 1]);
    setQuery('');
  };

  const forget = (id: string) => persist(removeMemory(memories, id));
  const forgetAll = () => { persist([]); setShowMemories(false); };

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
            <span className="text-white font-semibold"> today’s date &amp; time</span> — and I’ll
            <span className="text-white font-semibold"> remember whatever you teach me</span> (say <span className="text-white font-semibold">“remember …”</span>), saved on this device only.
            <span className="text-[#484f58]"> Building apps, full chat and general questions need internet — go online for those.</span>
          </p>
        </div>

        {/* Search / teach box — Enter saves a teaching command ("remember …"); otherwise it just searches. */}
        <form onSubmit={(e) => { e.preventDefault(); commitTeach(); }} className="relative">
          <Search className="w-4 h-4 text-[#484f58] absolute left-4 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); if (justTaught) setJustTaught(null); }}
            placeholder="Ask, calculate, or teach me: remember my gate code is 4821…"
            className="w-full bg-[#161b22] border border-white/10 rounded-2xl pl-11 pr-4 py-3 text-sm text-white placeholder-[#484f58] focus:outline-none focus:border-indigo-500/50"
            autoFocus
          />
        </form>

        {/* Just taught — honest confirmation that it was saved on-device. */}
        {justTaught && (
          <div className="flex items-start gap-3 p-4 rounded-2xl bg-emerald-500/[0.08] border border-emerald-500/25">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center shrink-0">
              <Check className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="min-w-0">
              <p className="text-sm text-white font-bold">Got it — I’ll remember this.</p>
              <p className="text-[11px] text-[#8b949e] mt-0.5 break-words">
                {justTaught.kind === 'qa'
                  ? <>When you ask <span className="text-white font-semibold">“{justTaught.trigger}”</span>, I’ll say <span className="text-white font-semibold">“{justTaught.text}”</span>.</>
                  : <span className="text-white font-semibold">“{justTaught.text}”</span>}
                {' '}Saved on this device only.
              </p>
            </div>
          </div>
        )}

        {/* Pending teach hint — the box looks like a teaching command; nudge Enter (suppresses search). */}
        {!justTaught && pendingTeach && (
          <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-indigo-500/[0.07] border border-indigo-500/25">
            <Brain className="w-4 h-4 text-indigo-400 shrink-0" />
            <p className="text-[12px] text-[#c9d1d9] min-w-0 break-words">
              Press <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/10 text-white font-bold text-[10px]"><CornerDownLeft className="w-3 h-3" />Enter</span>
              {' '}and I’ll remember{' '}
              {pendingTeach.kind === 'qa'
                ? <>to answer <span className="text-white font-semibold">“{pendingTeach.text}”</span> when you ask <span className="text-white font-semibold">“{pendingTeach.trigger}”</span>.</>
                : <><span className="text-white font-semibold">“{pendingTeach.text}”</span>.</>}
            </p>
          </div>
        )}

        {/* Lead line (hidden while a teach hint / confirmation is showing, to avoid mixed signals) */}
        {!justTaught && !pendingTeach && <p className="text-[11px] text-[#8b949e] px-1">{answer.lead}</p>}

        {/* Everything below is the query result — hidden while the box holds a pending teaching command. */}
        {!pendingTeach && (<>
        {/* Deterministic on-device answer (real math / device clock / recalled memory / honest statement —
            never a faked fact). Shown for kind 'answer'. */}
        {answer.kind === 'answer' && answer.answerText && (
          <div className="flex items-start gap-3 p-4 rounded-2xl bg-emerald-500/[0.06] border border-emerald-500/20">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center shrink-0">
              <AnswerIcon kind={answer.answerKind} />
            </div>
            <div className="min-w-0 pt-0.5">
              {answer.answerKind === 'memory' && (
                <p className="text-[9px] font-black uppercase tracking-widest text-emerald-400/70 mb-0.5">You taught me this</p>
              )}
              <p className="text-sm text-white font-semibold leading-relaxed break-words">{answer.answerText}</p>
            </div>
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
        </>)}

        {/* What the user has taught this device — real, on-device, deletable. Honest: stored locally only. */}
        {memories.length > 0 && (
          <div className="rounded-2xl bg-[#161b22] border border-white/5 overflow-hidden">
            <button
              onClick={() => setShowMemories((v) => !v)}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors"
            >
              <span className="flex items-center gap-2 text-[12px] font-bold text-white">
                <Brain className="w-4 h-4 text-emerald-400" />
                Things you’ve taught me
                <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 text-[10px] font-black">{memories.length}</span>
              </span>
              <span className="text-[10px] text-[#8b949e]">{showMemories ? 'Hide' : 'Show'}</span>
            </button>
            {showMemories && (
              <div className="px-4 pb-4 space-y-2">
                <p className="text-[10px] text-[#484f58] leading-relaxed">
                  Saved on this device only — never uploaded. I recall these exactly, with no internet.
                </p>
                {memories.slice().reverse().map((m) => (
                  <div key={m.id} className="flex items-start justify-between gap-3 p-3 rounded-xl bg-[#0d1117] border border-white/5">
                    <div className="min-w-0">
                      {m.kind === 'qa'
                        ? <p className="text-[12px] text-white break-words"><span className="text-[#8b949e]">Q:</span> {m.trigger} <span className="text-[#8b949e]">→</span> {m.text}</p>
                        : <p className="text-[12px] text-white break-words">{m.text}</p>}
                    </div>
                    <button
                      onClick={() => forget(m.id)}
                      title="Forget this"
                      className="shrink-0 p-1.5 rounded-lg text-[#8b949e] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={forgetAll}
                  className="text-[10px] font-bold text-red-400/80 hover:text-red-400 transition-colors pt-1"
                >
                  Forget everything
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default OfflineAI;
