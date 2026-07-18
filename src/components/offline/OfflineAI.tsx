import React, { useEffect, useMemo, useState } from 'react';
import {
  Wifi, Smartphone, Search, ArrowRight, Sparkles, BookOpen, Link2, Calculator, Clock, MessageCircle,
  Brain, Trash2, CornerDownLeft, Check, Compass,
} from 'lucide-react';
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
 * zero hallucination. It answers "where is X / how do I Y", shows the exact path + steps and a real
 * "Open →" button; does real on-device quick answers (math / date & time / greetings); and lets the user
 * TEACH it personal facts + Q→A that persist on this device only and recall exactly — never uploaded,
 * never a fabricated fact. App-BUILDING / full Pro chat / general knowledge need the online engine; the
 * UI says so honestly and never fakes those here. This file is presentation only — all logic is pure and
 * lives in ../../lib/offlineAssistant + ../../lib/offlineMemory.
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
  if (kind === 'math') return <Calculator className="w-4 h-4 text-emerald-300" />;
  if (kind === 'datetime') return <Clock className="w-4 h-4 text-emerald-300" />;
  if (kind === 'memory') return <Brain className="w-4 h-4 text-emerald-300" />;
  return <MessageCircle className="w-4 h-4 text-emerald-300" />;
};

/** A small pill button used for starter suggestions and related-feature hops. */
const Chip: React.FC<{ label: string; onClick: () => void; icon?: React.ReactNode }> = ({ label, onClick, icon }) => (
  <button
    onClick={onClick}
    className="group flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.03] border border-white/10 hover:border-indigo-400/50 hover:bg-indigo-500/10 text-[11px] font-semibold text-[#c9d1d9] hover:text-white transition-all duration-200 active:scale-95"
  >
    {icon}
    <span className="truncate max-w-[190px]">{label}</span>
  </button>
);

/** A capability pill in the intro strip. */
const CapPill: React.FC<{ icon: React.ReactNode; label: string }> = ({ icon, label }) => (
  <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/10 text-[10px] font-bold text-[#c9d1d9]">
    {icon}{label}
  </span>
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
      {/* Ambient top glow */}
      <div className="relative">
        <div className="pointer-events-none absolute inset-x-0 -top-24 h-56 bg-[radial-gradient(60%_100%_at_50%_0%,rgba(99,102,241,0.18),transparent_70%)]" />

        <div className="relative max-w-3xl mx-auto px-4 py-5 space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shrink-0 shadow-lg shadow-indigo-900/40 ring-1 ring-white/10">
                <BookOpen className="w-5 h-5 text-white" />
              </div>
              <div className="min-w-0">
                <h1 className="text-lg font-black tracking-tight leading-none bg-gradient-to-r from-white to-indigo-200 bg-clip-text text-transparent">Offline AI</h1>
                <p className="text-[11px] text-[#8b949e] truncate mt-1">On-device guide, calculator &amp; memory — works without internet</p>
              </div>
            </div>
            <span
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest border shrink-0 transition-colors ${
                online ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
              }`}
              title={online ? "You're online — full NavBharatAI is available too" : "You're offline — this on-device guide still works"}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${online ? 'bg-emerald-400' : 'bg-amber-400'} animate-pulse`} />
              {online ? <Wifi className="w-3 h-3" /> : <Smartphone className="w-3 h-3" />}
              {online ? 'On-device' : 'Offline'}
            </span>
          </div>

          {/* Intro card with capability pills — honest about scope */}
          <div className="rounded-2xl bg-gradient-to-br from-white/[0.05] to-transparent border border-white/10 p-3.5 space-y-2.5">
            <p className="text-[11.5px] text-[#c9d1d9] leading-relaxed">
              Ask <span className="text-white font-semibold">“where is X”</span> or <span className="text-white font-semibold">“how do I Y”</span> and I’ll take you there,
              do a quick <span className="text-white font-semibold">calculation</span> or tell you the <span className="text-white font-semibold">date &amp; time</span>, and
              <span className="text-white font-semibold"> remember anything you teach me</span> — kept on this device only.
            </p>
            <div className="flex flex-wrap gap-1.5">
              <CapPill icon={<Compass className="w-3 h-3 text-indigo-300" />} label="Find features" />
              <CapPill icon={<Calculator className="w-3 h-3 text-emerald-300" />} label="Calculate" />
              <CapPill icon={<Clock className="w-3 h-3 text-emerald-300" />} label="Date & time" />
              <CapPill icon={<Brain className="w-3 h-3 text-violet-300" />} label="Remember (teach me)" />
            </div>
            <p className="text-[10px] text-[#484f58] leading-relaxed">
              Building apps, full chat &amp; general questions need internet — go online for those.
            </p>
          </div>

          {/* Search / teach box — Enter saves a teaching command ("remember …"); otherwise it just searches. */}
          <form onSubmit={(e) => { e.preventDefault(); commitTeach(); }} className="relative group">
            <div className={`pointer-events-none absolute -inset-px rounded-2xl bg-gradient-to-r ${pendingTeach ? 'from-violet-500/40 to-indigo-500/40' : 'from-indigo-500/0 to-violet-500/0 group-focus-within:from-indigo-500/40 group-focus-within:to-violet-500/40'} transition-all duration-300 blur-[2px]`} />
            <div className="relative flex items-center">
              {pendingTeach ? <Brain className="w-4 h-4 text-violet-300 absolute left-4" /> : <Search className="w-4 h-4 text-[#484f58] absolute left-4 group-focus-within:text-indigo-300 transition-colors" />}
              <input
                value={query}
                onChange={(e) => { setQuery(e.target.value); if (justTaught) setJustTaught(null); }}
                placeholder="Ask, calculate, or teach me: remember my gate code is 4821…"
                className="w-full bg-[#161b22] border border-white/10 rounded-2xl pl-11 pr-16 py-3.5 text-sm text-white placeholder-[#484f58] focus:outline-none focus:border-transparent transition-all"
                autoFocus
              />
              {pendingTeach && (
                <span className="absolute right-3 inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-violet-500/20 border border-violet-400/30 text-violet-200 text-[9px] font-black uppercase tracking-wider">
                  <CornerDownLeft className="w-3 h-3" /> Save
                </span>
              )}
            </div>
          </form>

          {/* Just taught — honest confirmation that it was saved on-device. */}
          {justTaught && (
            <div className="flex items-start gap-3 p-4 rounded-2xl bg-gradient-to-br from-emerald-500/[0.12] to-emerald-500/[0.03] border border-emerald-500/30 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center shrink-0">
                <Check className="w-4 h-4 text-emerald-300" />
              </div>
              <div className="min-w-0">
                <p className="text-sm text-white font-bold">Got it — I’ll remember this. ✅</p>
                <p className="text-[11.5px] text-[#8b949e] mt-1 break-words leading-relaxed">
                  {justTaught.kind === 'qa'
                    ? <>When you ask <span className="text-emerald-200 font-semibold">“{justTaught.trigger}”</span>, I’ll say <span className="text-emerald-200 font-semibold">“{justTaught.text}”</span>.</>
                    : <span className="text-emerald-200 font-semibold">“{justTaught.text}”</span>}
                  {' '}<span className="text-[#484f58]">Saved on this device only.</span>
                </p>
              </div>
            </div>
          )}

          {/* Pending teach hint — the box looks like a teaching command; nudge Enter (suppresses search). */}
          {!justTaught && pendingTeach && (
            <div className="flex items-center gap-3 p-4 rounded-2xl bg-gradient-to-br from-violet-500/[0.10] to-indigo-500/[0.04] border border-violet-500/30 animate-in fade-in slide-in-from-bottom-2 duration-200">
              <div className="w-9 h-9 rounded-xl bg-violet-500/15 border border-violet-400/30 flex items-center justify-center shrink-0">
                <Brain className="w-4 h-4 text-violet-300" />
              </div>
              <p className="text-[12px] text-[#c9d1d9] min-w-0 break-words leading-relaxed">
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
            <div className="flex items-start gap-3 p-4 rounded-2xl bg-gradient-to-br from-emerald-500/[0.10] to-emerald-500/[0.02] border border-emerald-500/25 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/12 border border-emerald-400/25 flex items-center justify-center shrink-0">
                <AnswerIcon kind={answer.answerKind} />
              </div>
              <div className="min-w-0 pt-0.5">
                {answer.answerKind === 'memory' && (
                  <p className="text-[9px] font-black uppercase tracking-widest text-emerald-300/70 mb-1 flex items-center gap-1"><Brain className="w-3 h-3" /> You taught me this</p>
                )}
                <p className={`text-white font-semibold leading-relaxed break-words ${answer.answerKind === 'math' ? 'text-base font-mono' : 'text-sm'}`}>{answer.answerText}</p>
              </div>
            </div>
          )}

          {/* Starter / recovery suggestions — shown on the overview (blank box) and on an empty result, so
              the user always has a real next tap. Each chip runs a query that resolves to a real KB entry. */}
          {answer.kind !== 'matches' && (
            <div className="space-y-1.5">
              <p className="text-[9px] font-black uppercase tracking-widest text-[#484f58] px-1">Try</p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTED_QUERIES.map((s) => (
                  <Chip key={s.query} label={s.label} onClick={() => runQuery(s.query)} icon={<Sparkles className="w-3 h-3 text-indigo-300 shrink-0 group-hover:text-indigo-200" />} />
                ))}
              </div>
            </div>
          )}

          {/* Result cards */}
          <div className="space-y-2.5">
            {answer.matches.map((f, idx) => {
              const target = navFor(f);
              const steps = howToSteps(f.howToUse).slice(0, 4);
              const related = relatedFeaturesOf(f);
              return (
                <div
                  key={f.id}
                  style={{ animationDelay: `${Math.min(idx, 6) * 40}ms`, animationFillMode: 'both' }}
                  className="group bg-gradient-to-br from-white/[0.04] to-transparent border border-white/[0.07] hover:border-indigo-400/30 rounded-2xl p-4 space-y-2 transition-all duration-200 animate-in fade-in slide-in-from-bottom-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-sm font-black text-white">{f.name}</h3>
                      <p className="text-[10px] text-indigo-300/90 font-mono mt-0.5 break-words">{f.path}</p>
                    </div>
                    {target && (
                      <button
                        onClick={() => onNavigate(target)}
                        className="shrink-0 flex items-center gap-1.5 px-3.5 py-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 shadow-md shadow-indigo-900/30"
                      >
                        Open <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] text-[#8b949e] leading-relaxed">{f.description.split('\n')[0]}</p>
                  {steps.length > 0 && (
                    <ol className="text-[11px] text-[#c9d1d9] space-y-1 pt-1">
                      {steps.map((s, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="flex items-center justify-center w-4 h-4 rounded-full bg-indigo-500/15 text-indigo-300 font-black text-[9px] shrink-0 mt-px">{i + 1}</span>
                          <span className="leading-relaxed">{s}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                  {related.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-white/5 mt-1">
                      <span className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-[#484f58] shrink-0">
                        <Link2 className="w-3 h-3" /> Related
                      </span>
                      {related.map((r) => (
                        <button
                          key={r.id}
                          onClick={() => runQuery(r.name)}
                          className="px-2.5 py-1 rounded-full bg-black/20 border border-white/10 hover:border-indigo-400/50 hover:text-white text-[10px] font-semibold text-[#8b949e] transition-all active:scale-95"
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
            <div className="rounded-2xl bg-gradient-to-br from-violet-500/[0.05] to-transparent border border-white/[0.07] overflow-hidden">
              <button
                onClick={() => setShowMemories((v) => !v)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3.5 hover:bg-white/[0.02] transition-colors"
              >
                <span className="flex items-center gap-2.5 text-[12px] font-bold text-white">
                  <span className="w-7 h-7 rounded-lg bg-violet-500/15 border border-violet-400/25 flex items-center justify-center shrink-0">
                    <Brain className="w-3.5 h-3.5 text-violet-300" />
                  </span>
                  Things you’ve taught me
                  <span className="px-1.5 py-0.5 rounded-full bg-violet-500/20 text-violet-200 text-[10px] font-black">{memories.length}</span>
                </span>
                <span className="text-[10px] text-[#8b949e] font-semibold">{showMemories ? 'Hide' : 'Show'}</span>
              </button>
              {showMemories && (
                <div className="px-4 pb-4 space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
                  <p className="text-[10px] text-[#484f58] leading-relaxed flex items-center gap-1.5">
                    <Smartphone className="w-3 h-3" /> Saved on this device only — never uploaded. I recall these exactly, with no internet.
                  </p>
                  {memories.slice().reverse().map((m) => (
                    <div key={m.id} className="flex items-start justify-between gap-3 p-3 rounded-xl bg-black/20 border border-white/5 hover:border-white/10 transition-colors">
                      <div className="min-w-0">
                        {m.kind === 'qa'
                          ? <p className="text-[12px] text-white break-words leading-relaxed"><span className="text-violet-300/80 font-bold">Q</span> {m.trigger} <span className="text-[#484f58]">→</span> <span className="text-[#c9d1d9]">{m.text}</span></p>
                          : <p className="text-[12px] text-[#c9d1d9] break-words leading-relaxed">{m.text}</p>}
                      </div>
                      <button
                        onClick={() => forget(m.id)}
                        title="Forget this"
                        className="shrink-0 p-1.5 rounded-lg text-[#8b949e] hover:text-red-400 hover:bg-red-500/10 transition-colors active:scale-90"
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
    </div>
  );
};

export default OfflineAI;
