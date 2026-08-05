import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Wifi, Smartphone, Send, Sparkles, BookOpen, Link2, Calculator, Clock, MessageCircle,
  Brain, Trash2, Bot, ArrowRight, Wrench, AlertTriangle, Globe, Eraser, Cpu, Download, Loader2,
} from 'lucide-react';
import {
  howToSteps, navFor, relatedFeaturesOf, SUGGESTED_QUERIES,
  type NavTarget, type QuickAnswerKind, type DeviceHelp,
} from '../../lib/offlineAssistant';
import { APP_KNOWLEDGE_BASE, type AppFeature } from '../../server/AppContext/AppKnowledgeBase';
import { DEVICE_KNOWLEDGE_BASE } from '../../lib/deviceKnowledgeBase';
import { buildChatReply, teachAck, CHAT_WELCOME } from '../../lib/offlineChat';
import {
  parseTeaching, addMemory, removeMemory, loadMemories, saveMemories, type UserMemory,
} from '../../lib/offlineMemory';
import { loadChat, saveChat, clearChat, type PersistedChatMsg } from '../../lib/offlineChatStore';
import { probeDevice, recommendTier, TIER_INFO, type TierRecommendation } from '../../lib/offlineDeviceTier';
import { loadOfflineLlm, resetOfflineLlm, STAGE1_MODEL, type OfflineLlm, type LlmProgress } from '../../lib/offlineLlmEngine';
import { loadBetaState, saveBetaState, shouldUseLlm, buildLlmMessages, type BetaState } from '../../lib/offlineBeta';
import { autoGrow, resetGrow } from '../../lib/autoGrowTextarea';
import { AppUpdateChatNotice } from '../AppUpdateChatNotice';

// Lookup maps to rehydrate a reloaded bot turn's cards from their stored ids (kept out of the component
// body so they're built once).
const FEATURE_BY_ID = new Map(APP_KNOWLEDGE_BASE.map((f) => [f.id, f]));
const DEVICE_BY_ID = new Map(DEVICE_KNOWLEDGE_BASE.map((d) => [d.id, d]));

/**
 * Offline AI — a 100% on-device CHAT assistant (admin 2026-07-16 … 2026-07-18). It talks turn-by-turn
 * like a bot, but every reply is DETERMINISTIC and grounded in real on-device skills (app guide, math,
 * date/time, greetings, user-taught memory, phone-settings help). It does NOT run a language model and
 * does NOT "think" — so it never invents a fact: anything needing real reasoning / open knowledge is
 * honestly sent online. Works with NO internet. This file is presentation only; all reply logic is pure
 * and lives in ../../lib/offlineChat + offlineAssistant + offlineMemory.
 */
export interface OfflineAIProps {
  /** Navigate to an in-app target (wired in App.tsx to toggleTab / setActiveView + setSettingsScreen). */
  onNavigate: (target: NavTarget) => void;
}

interface ChatMsg {
  id: string;
  role: 'user' | 'bot';
  text: string;
  answerKind?: QuickAnswerKind | 'memory';
  features?: AppFeature[];
  deviceMatches?: DeviceHelp[];
  online?: boolean;
  /** True when this reply came from the experimental on-device model (shows the "can be wrong" label). */
  beta?: boolean;
}

let msgSeq = 0;
const uid = () => `m${++msgSeq}_${Math.random().toString(36).slice(2, 7)}`;

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

/** Small icon for a deterministic answer, by category. */
const AnswerIcon: React.FC<{ kind?: QuickAnswerKind | 'memory' }> = ({ kind }) => {
  if (kind === 'math') return <Calculator className="w-3.5 h-3.5 text-emerald-300" />;
  if (kind === 'datetime') return <Clock className="w-3.5 h-3.5 text-emerald-300" />;
  if (kind === 'memory') return <Brain className="w-3.5 h-3.5 text-emerald-300" />;
  return <MessageCircle className="w-3.5 h-3.5 text-emerald-300" />;
};

const Chip: React.FC<{ label: string; onClick: () => void; icon?: React.ReactNode }> = ({ label, onClick, icon }) => (
  <button
    onClick={onClick}
    className="group flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.03] border border-white/10 hover:border-indigo-400/50 hover:bg-indigo-500/10 text-[11px] font-semibold text-[#c9d1d9] hover:text-white transition-all duration-200 active:scale-95"
  >
    {icon}
    <span className="truncate max-w-[190px]">{label}</span>
  </button>
);

/** An app-guide feature card rendered inside a bot reply (with a working "Open" jump + related hops). */
const FeatureCard: React.FC<{ feature: AppFeature; onOpen: (t: NavTarget) => void; onRelated: (q: string) => void }> = ({ feature, onOpen, onRelated }) => {
  const target = navFor(feature);
  const steps = howToSteps(feature.howToUse).slice(0, 3);
  const related = relatedFeaturesOf(feature);
  return (
    <div className="bg-gradient-to-br from-white/[0.04] to-transparent border border-white/[0.07] rounded-xl p-3 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-[13px] font-black text-white leading-snug">{feature.name}</h4>
          <p className="text-[10px] text-indigo-300/90 font-mono mt-0.5 break-words">{feature.path}</p>
        </div>
        {target && (
          <button
            onClick={() => onOpen(target)}
            className="shrink-0 flex items-center gap-1 px-3 py-1.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white rounded-lg text-[10px] font-black uppercase tracking-widest transition-all active:scale-95"
          >
            Open <ArrowRight className="w-3 h-3" />
          </button>
        )}
      </div>
      <p className="text-[11px] text-[#8b949e] leading-relaxed">{feature.description.split('\n')[0]}</p>
      {steps.length > 0 && (
        <ol className="text-[11px] text-[#c9d1d9] space-y-1">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-2">
              <span className="flex items-center justify-center w-4 h-4 rounded-full bg-indigo-500/15 text-indigo-300 font-black text-[9px] shrink-0 mt-px">{i + 1}</span>
              <span className="leading-relaxed">{s}</span>
            </li>
          ))}
        </ol>
      )}
      {related.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-white/5">
          <span className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-[#484f58] shrink-0"><Link2 className="w-3 h-3" /> Related</span>
          {related.map((r) => (
            <button key={r.id} onClick={() => onRelated(r.name)} className="px-2 py-0.5 rounded-full bg-black/20 border border-white/10 hover:border-indigo-400/50 hover:text-white text-[10px] font-semibold text-[#8b949e] transition-all active:scale-95">
              {r.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/** A phone/device-settings help card — real generic how-to. Honest: guides, doesn't touch settings. */
const DeviceHelpCard: React.FC<{ help: DeviceHelp }> = ({ help }) => (
  <div className="bg-gradient-to-br from-sky-500/[0.06] to-transparent border border-sky-500/20 rounded-xl p-3 space-y-1.5">
    <div className="flex items-start gap-2">
      <div className="w-7 h-7 rounded-lg bg-sky-500/12 border border-sky-400/25 flex items-center justify-center shrink-0"><Wrench className="w-3.5 h-3.5 text-sky-300" /></div>
      <div className="min-w-0">
        <h4 className="text-[13px] font-black text-white leading-snug">{help.title}</h4>
        <span className="inline-block mt-0.5 px-2 py-0.5 rounded-full bg-sky-500/12 border border-sky-400/20 text-sky-200 text-[9px] font-black uppercase tracking-widest">{help.category}</span>
      </div>
    </div>
    <p className="text-[11px] text-[#8b949e] leading-relaxed">{help.problem}</p>
    <ol className="text-[11.5px] text-[#c9d1d9] space-y-1.5">
      {help.steps.map((s, i) => (
        <li key={i} className="flex gap-2">
          <span className="flex items-center justify-center w-4 h-4 rounded-full bg-sky-500/15 text-sky-300 font-black text-[9px] shrink-0 mt-px">{i + 1}</span>
          <span className="leading-relaxed">{s}</span>
        </li>
      ))}
    </ol>
    {help.note && (
      <p className="flex items-start gap-1.5 text-[10px] text-amber-300/80 leading-relaxed pt-1 border-t border-white/5">
        <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" /> {help.note}
      </p>
    )}
  </div>
);

/** Strip a live chat message to its lean persistable form (cards stored by id, not inline). */
function toPersisted(m: ChatMsg): PersistedChatMsg {
  return {
    id: m.id,
    role: m.role,
    text: m.text,
    answerKind: m.answerKind,
    online: m.online,
    featureIds: m.features?.map((f) => f.id),
    deviceIds: m.deviceMatches?.map((d) => d.id),
  };
}

/** Rebuild a live chat message from a persisted one, looking up its cards from the bundled KBs by id. */
function rehydrate(p: PersistedChatMsg): ChatMsg {
  return {
    id: p.id,
    role: p.role,
    text: p.text,
    answerKind: p.answerKind as ChatMsg['answerKind'],
    online: p.online,
    features: p.featureIds?.map((id) => FEATURE_BY_ID.get(id)).filter(Boolean) as AppFeature[] | undefined,
    deviceMatches: p.deviceIds?.map((id) => DEVICE_BY_ID.get(id)).filter(Boolean) as DeviceHelp[] | undefined,
  };
}

export const OfflineAI: React.FC<OfflineAIProps> = ({ onNavigate }) => {
  const online = useOnline();
  const [input, setInput] = useState('');
  // Load the saved on-device transcript once, synchronously, so history is there on open (and the save
  // effect below never wipes it on mount).
  const [messages, setMessages] = useState<ChatMsg[]>(() => {
    try { return loadChat().map(rehydrate); } catch { return []; }
  });
  const [typing, setTyping] = useState(false);
  const [memories, setMemories] = useState<UserMemory[]>([]);
  const [showMemories, setShowMemories] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Composer auto-grow (admin 2026-07-20): starts at 1 line, grows while typing (max-h-28 = 112px),
  // snaps back to 1 line when send() clears the input.
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => { if (!input && composerRef.current) resetGrow(composerRef.current); }, [input]);
  const [isTouch, setIsTouch] = useState(false);

  // ── Offline Thinking (beta) — on-device LLM, DEFAULT OFF ──────────────────────────────────────────
  const [beta, setBeta] = useState<BetaState>(() => { try { return loadBetaState(); } catch { return { enabled: false }; } });
  const [betaOpen, setBetaOpen] = useState(false);
  const [deviceRec, setDeviceRec] = useState<TierRecommendation | null>(null);
  const [dlProgress, setDlProgress] = useState<LlmProgress | null>(null);
  const [dlError, setDlError] = useState<string | null>(null);
  const llmRef = useRef<OfflineLlm | null>(null);

  useEffect(() => { setMemories(loadMemories()); }, []);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    setIsTouch(window.matchMedia('(pointer: coarse)').matches);
  }, []);
  // Auto-scroll to the newest message / typing indicator.
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, typing]);
  // Persist the transcript on this device (local only) whenever it changes, so the chat survives restarts.
  useEffect(() => { saveChat(messages.map(toPersisted)); }, [messages]);

  const persist = (list: UserMemory[]) => { setMemories(list); saveMemories(list); };
  const clearChatHistory = () => { setMessages([]); clearChat(); };
  const pushBot = (bot: ChatMsg) => setMessages((prev) => [...prev, bot]);

  /** Ensure the on-device model is loaded (downloads/caches on first use, streaming progress). Throws on
   *  failure — the caller falls back to the honest deterministic reply. */
  const ensureLlm = async (): Promise<OfflineLlm> => {
    if (llmRef.current) return llmRef.current;
    const llm = await loadOfflineLlm({ modelId: beta.modelId ?? STAGE1_MODEL, onProgress: setDlProgress });
    setDlProgress(null);
    llmRef.current = llm;
    return llm;
  };

  const send = (raw?: string) => {
    const text = (raw ?? input).trim();
    if (!text || typing) return;
    setInput('');
    const userTurns = [...messages, { id: uid(), role: 'user', text } as ChatMsg];
    setMessages((prev) => [...prev, { id: uid(), role: 'user', text }]);

    // Teaching command → store on-device and confirm.
    const parsed = parseTeaching(text);
    if (parsed) {
      persist(addMemory(memories, parsed, uid(), Date.now()));
      setTyping(true);
      window.setTimeout(() => { pushBot({ id: uid(), role: 'bot', text: teachAck(parsed), answerKind: 'memory' }); setTyping(false); }, 280);
      return;
    }

    const r = buildChatReply(text, new Date(), memories);
    // On-device LLM fills the gap ONLY when the beta is on and the deterministic engine had no confident
    // answer. Facts/navigation/math/date always stay on the reliable deterministic path above.
    if (shouldUseLlm(r, beta.enabled)) {
      setTyping(true);
      (async () => {
        try {
          const llm = await ensureLlm();
          const facts = memories.map((m) => (m.kind === 'qa' ? `${m.trigger} → ${m.text}` : m.text));
          const recent = userTurns.map((m) => ({ role: m.role, text: m.text }));
          const out = (await llm.generate(buildLlmMessages(text, recent, facts))).trim();
          pushBot({ id: uid(), role: 'bot', text: out || "I couldn't come up with a good answer for that.", beta: true, online: true });
        } catch {
          // Honest fallback — never fake a result; degrade to the deterministic "go online" reply.
          setDlProgress(null);
          pushBot({ id: uid(), role: 'bot', text: r.text, online: true });
        } finally {
          setTyping(false);
        }
      })();
      return;
    }

    // Deterministic reply — a brief "typing" beat so it reads like a chat.
    const bot: ChatMsg = { id: uid(), role: 'bot', text: r.text, answerKind: r.answerKind, features: r.features, deviceMatches: r.deviceMatches, online: r.online };
    setTyping(true);
    window.setTimeout(() => { pushBot(bot); setTyping(false); }, 280);
  };

  // ── Beta controls ──────────────────────────────────────────────────────────────────────────────
  const openBeta = () => {
    setBetaOpen((v) => !v);
    if (!deviceRec) probeDevice().then((s) => setDeviceRec(recommendTier(s))).catch(() => setDeviceRec(recommendTier({ webgpu: false })));
  };
  const downloadAndEnable = async () => {
    setDlError(null);
    setDlProgress({ progress: 0, text: 'Starting…' });
    try {
      const llm = await loadOfflineLlm({ modelId: STAGE1_MODEL, onProgress: setDlProgress });
      llmRef.current = llm;
      const st: BetaState = { enabled: true, modelId: STAGE1_MODEL };
      setBeta(st); saveBetaState(st);
    } catch {
      setDlError("Couldn't set up the on-device AI. It needs a WebGPU-capable device (updated Chrome on Android) and a stable connection for the one-time download. The deterministic chat still works.");
    } finally {
      setDlProgress(null);
    }
  };
  const disableBeta = () => {
    try { llmRef.current?.unload(); } catch { /* best-effort */ }
    llmRef.current = null;
    resetOfflineLlm();
    const st: BetaState = { enabled: false };
    setBeta(st); saveBetaState(st);
  };

  const forget = (id: string) => persist(removeMemory(memories, id));
  const forgetAll = () => { persist([]); setShowMemories(false); };

  const suggestions = useMemo(() => [{ label: 'What can you do?', query: 'what can you do' }, ...SUGGESTED_QUERIES], []);

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#0d1117] text-white">
      {/* Header */}
      <div className="shrink-0 relative">
        <div className="pointer-events-none absolute inset-x-0 -top-16 h-40 bg-[radial-gradient(60%_100%_at_50%_0%,rgba(99,102,241,0.16),transparent_70%)]" />
        <div className="relative flex items-center justify-between gap-3 px-4 py-3 border-b border-white/5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shrink-0 shadow-lg shadow-indigo-900/40 ring-1 ring-white/10">
              <BookOpen className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-black tracking-tight leading-none bg-gradient-to-r from-white to-indigo-200 bg-clip-text text-transparent">Offline AI</h1>
              <p className="text-[10px] text-[#8b949e] truncate mt-0.5">On-device chat · works without internet</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={openBeta}
              title="Offline Thinking (beta) — on-device AI"
              className={`flex items-center gap-1 px-2 py-1.5 rounded-full border text-[9px] font-black uppercase tracking-widest ${betaOpen || beta.enabled ? 'bg-fuchsia-500/15 border-fuchsia-400/40 text-fuchsia-200' : 'bg-white/[0.03] border-white/10 text-[#8b949e] hover:text-white'}`}
            >
              <Cpu className="w-3.5 h-3.5" />{beta.enabled ? 'On' : 'Beta'}
            </button>
            {messages.length > 0 && (
              <button
                onClick={clearChatHistory}
                title="Clear this chat (removes it from this device)"
                className="flex items-center justify-center w-8 h-8 rounded-full border border-white/10 bg-white/[0.03] text-[#8b949e] hover:text-red-300 hover:border-red-400/40 transition-colors"
              >
                <Eraser className="w-3.5 h-3.5" />
              </button>
            )}
            {memories.length > 0 && (
              <button
                onClick={() => setShowMemories((v) => !v)}
                title="Things you've taught me"
                className={`flex items-center gap-1 px-2 py-1.5 rounded-full border text-[10px] font-black ${showMemories ? 'bg-violet-500/15 border-violet-400/40 text-violet-200' : 'bg-white/[0.03] border-white/10 text-[#8b949e] hover:text-white'}`}
              >
                <Brain className="w-3.5 h-3.5" />{memories.length}
              </button>
            )}
            <span
              className={`flex items-center gap-1.5 px-2 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest border ${online ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-amber-500/10 border-amber-500/30 text-amber-300'}`}
              title={online ? "You're online — full NavBharatAI is available too" : "You're offline — this on-device chat still works"}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${online ? 'bg-emerald-400' : 'bg-amber-400'} animate-pulse`} />
              {online ? <Wifi className="w-3 h-3" /> : <Smartphone className="w-3 h-3" />}
            </span>
          </div>
        </div>
      </div>

      {/* Offline Thinking (beta) panel — honest, opt-in, on-device LLM */}
      {betaOpen && (
        <div className="shrink-0 border-b border-white/5 bg-[#0d1117] px-4 py-3.5 space-y-3 max-h-[70vh] overflow-y-auto custom-scrollbar animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-start gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-fuchsia-500 to-indigo-600 flex items-center justify-center shrink-0 ring-1 ring-white/10"><Cpu className="w-4 h-4 text-white" /></div>
            <div className="min-w-0">
              <h3 className="text-sm font-black text-white">Offline Thinking <span className="text-fuchsia-300">(Beta)</span></h3>
              <p className="text-[11px] text-[#8b949e] leading-relaxed mt-0.5">
                An experimental AI that runs <span className="text-[#c9d1d9] font-semibold">entirely on your phone</span> — no internet, nothing uploaded. It can chat about open-ended things the deterministic assistant sends online. Because it's a small on-device model, <span className="text-amber-300/90 font-semibold">it can be wrong</span> — facts still use the reliable engine.
              </p>
            </div>
          </div>

          {/* Device readiness (real detection) */}
          {!deviceRec ? (
            <p className="text-[11px] text-[#8b949e] flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking your device…</p>
          ) : !deviceRec.supported ? (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/[0.06] border border-amber-500/20">
              <AlertTriangle className="w-4 h-4 text-amber-300 mt-0.5 shrink-0" />
              <p className="text-[11px] text-[#c9d1d9] leading-relaxed">Not available on this device. {deviceRec.reason}</p>
            </div>
          ) : (
            <>
              <div className="flex items-start gap-2 p-3 rounded-xl bg-emerald-500/[0.05] border border-emerald-500/15">
                <Cpu className="w-4 h-4 text-emerald-300 mt-0.5 shrink-0" />
                <p className="text-[11px] text-[#c9d1d9] leading-relaxed">{deviceRec.reason} It downloads once over the internet (Wi-Fi recommended), then works fully offline.</p>
              </div>

              {dlProgress ? (
                <div className="space-y-1.5">
                  <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-fuchsia-500 to-indigo-500 transition-all" style={{ width: `${Math.round((dlProgress.progress || 0) * 100)}%` }} />
                  </div>
                  <p className="text-[10px] text-[#8b949e] truncate">{Math.round((dlProgress.progress || 0) * 100)}% · {dlProgress.text || 'Downloading model…'}</p>
                </div>
              ) : beta.enabled ? (
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-300"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> On-device AI is ON</span>
                  <button onClick={disableBeta} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/10 hover:border-red-400/40 hover:text-red-300 text-[11px] font-bold text-[#c9d1d9] transition-colors">
                    Turn off
                  </button>
                </div>
              ) : (
                <button onClick={downloadAndEnable} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-fuchsia-600 to-indigo-600 hover:from-fuchsia-500 hover:to-indigo-500 text-white text-[12px] font-black transition-all active:scale-95">
                  <Download className="w-4 h-4" /> Download &amp; enable (~{TIER_INFO[deviceRec.tier].approxDownloadMB} MB)
                </button>
              )}

              {dlError && <p className="flex items-start gap-1.5 text-[10.5px] text-red-300/90 leading-relaxed"><AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" /> {dlError}</p>}
              {beta.enabled && <p className="text-[10px] text-[#484f58] leading-relaxed">Turning off stops using it; the downloaded model stays cached on your device until you clear the app's browser data.</p>}
            </>
          )}
        </div>
      )}

      {/* Taught-memory panel (toggled from the header) */}
      {showMemories && memories.length > 0 && (
        <div className="shrink-0 border-b border-white/5 bg-[#0d1117] px-4 py-3 space-y-2 max-h-56 overflow-y-auto custom-scrollbar animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[11px] font-bold text-white"><Brain className="w-3.5 h-3.5 text-violet-300" /> Things you've taught me</span>
            <button onClick={forgetAll} className="text-[10px] font-bold text-red-400/80 hover:text-red-400">Forget all</button>
          </div>
          <p className="text-[10px] text-[#484f58] flex items-center gap-1.5"><Smartphone className="w-3 h-3" /> Saved on this device only — never uploaded.</p>
          {memories.slice().reverse().map((m) => (
            <div key={m.id} className="flex items-start justify-between gap-3 p-2.5 rounded-lg bg-black/20 border border-white/5">
              <p className="text-[12px] text-[#c9d1d9] break-words min-w-0">
                {m.kind === 'qa' ? <><span className="text-violet-300/80 font-bold">Q</span> {m.trigger} <span className="text-[#484f58]">→</span> {m.text}</> : m.text}
              </p>
              <button onClick={() => forget(m.id)} title="Forget this" className="shrink-0 p-1 rounded-md text-[#8b949e] hover:text-red-400 hover:bg-red-500/10 active:scale-90"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>
      )}

      {/* Transcript */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-3 py-4 space-y-3">
        {messages.length === 0 && !typing ? (
          // Welcome state
          <div className="max-w-2xl mx-auto space-y-4 animate-in fade-in duration-300">
            <div className="flex items-start gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shrink-0 ring-1 ring-white/10"><Bot className="w-4 h-4 text-white" /></div>
              <div className="rounded-2xl rounded-tl-sm bg-[#161b22] border border-white/5 px-4 py-3 text-[13px] text-[#c9d1d9] leading-relaxed">{CHAT_WELCOME}</div>
            </div>
            <div className="pl-10 space-y-1.5">
              <p className="text-[9px] font-black uppercase tracking-widest text-[#484f58]">Try</p>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <Chip key={s.query} label={s.label} onClick={() => send(s.query)} icon={<Sparkles className="w-3 h-3 text-indigo-300 shrink-0" />} />
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto space-y-3">
            {(() => {
              const lastUser = [...messages].reverse().find((m) => m.role === 'user');
              return lastUser ? <AppUpdateChatNotice userText={lastUser.text} /> : null;
            })()}
            {messages.map((m) => (
              <div key={m.id} className={`flex items-start gap-2.5 ${m.role === 'user' ? 'flex-row-reverse' : ''} animate-in fade-in slide-in-from-bottom-1 duration-200`}>
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ring-1 ring-white/10 ${m.role === 'user' ? 'bg-zinc-700' : 'bg-gradient-to-br from-indigo-500 to-violet-600'}`}>
                  {m.role === 'user' ? <span className="text-[11px] font-black text-white">You</span> : <Bot className="w-4 h-4 text-white" />}
                </div>
                <div className={`min-w-0 max-w-[85%] space-y-2 ${m.role === 'user' ? 'items-end' : ''}`}>
                  {m.beta && (
                    <p className="text-[9px] font-black uppercase tracking-widest text-fuchsia-300/80 flex items-center gap-1"><Cpu className="w-3 h-3" /> Experimental on-device AI · can be wrong</p>
                  )}
                  <div className={`inline-block rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed break-words ${m.role === 'user' ? 'rounded-tr-sm bg-indigo-600 text-white' : `rounded-tl-sm ${m.beta ? 'bg-fuchsia-500/[0.08] border border-fuchsia-500/20' : 'bg-[#161b22] border border-white/5'} text-[#c9d1d9]`}`}>
                    {m.role === 'bot' && m.answerKind && (
                      <span className="inline-flex items-center gap-1 mr-1.5 align-middle"><AnswerIcon kind={m.answerKind} /></span>
                    )}
                    <span className={m.answerKind === 'math' ? 'font-mono font-semibold text-white' : ''}>{m.text}</span>
                  </div>
                  {/* Feature cards */}
                  {m.features && m.features.length > 0 && (
                    <div className="space-y-2">
                      {m.features.map((f) => <FeatureCard key={f.id} feature={f} onOpen={onNavigate} onRelated={(q) => send(q)} />)}
                    </div>
                  )}
                  {/* Phone-help cards + honest banner */}
                  {m.deviceMatches && m.deviceMatches.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-start gap-2 p-2.5 rounded-lg bg-sky-500/[0.05] border border-sky-500/15">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-300/80 mt-0.5 shrink-0" />
                        <p className="text-[10.5px] text-[#8b949e] leading-relaxed">General Android steps — I can guide you, but I <span className="text-[#c9d1d9] font-semibold">can't change your phone's settings myself</span>, and names may differ by phone brand.</p>
                      </div>
                      {m.deviceMatches.map((h) => <DeviceHelpCard key={h.id} help={h} />)}
                    </div>
                  )}
                  {/* Honest "go online" action */}
                  {m.online && (
                    <button
                      onClick={() => onNavigate({ view: 'nbi_chat' })}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 hover:border-indigo-400/50 hover:bg-indigo-500/10 text-[11px] font-bold text-[#c9d1d9] hover:text-white transition-all active:scale-95"
                    >
                      <Globe className="w-3.5 h-3.5 text-indigo-300" /> Ask online (needs internet)
                    </button>
                  )}
                </div>
              </div>
            ))}
            {/* Typing indicator */}
            {typing && (
              <div className="flex items-start gap-2.5 animate-in fade-in duration-150">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shrink-0 ring-1 ring-white/10"><Bot className="w-4 h-4 text-white" /></div>
                <div className="rounded-2xl rounded-tl-sm bg-[#161b22] border border-white/5 px-4 py-3 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#8b949e] animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-[#8b949e] animate-bounce" style={{ animationDelay: '120ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-[#8b949e] animate-bounce" style={{ animationDelay: '240ms' }} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-white/5 bg-[#0d1117] px-3 py-2.5 pb-[env(safe-area-inset-bottom)]">
        <form onSubmit={(e) => { e.preventDefault(); send(); }} className="max-w-2xl mx-auto">
          <div className="relative group">
            <div className="pointer-events-none absolute -inset-px rounded-2xl bg-gradient-to-r from-indigo-500/0 to-violet-500/0 group-focus-within:from-indigo-500/40 group-focus-within:to-violet-500/40 transition-all duration-300 blur-[2px]" />
            <div className="relative flex items-end gap-2">
              <textarea
                ref={composerRef}
                value={input}
                onChange={(e) => { setInput(e.target.value); autoGrow(e.target, 112); }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !isTouch) { e.preventDefault(); send(); } }}
                rows={1}
                placeholder="Message… (ask, calculate, phone help, or teach me “remember …”)"
                className="flex-1 bg-[#161b22] border border-white/10 rounded-2xl px-4 py-2.5 text-sm text-white placeholder-[#484f58] focus:outline-none focus:border-transparent resize-none max-h-28"
              />
              <button
                type="submit"
                disabled={!input.trim() || typing}
                title="Send"
                className="shrink-0 h-10 w-10 flex items-center justify-center bg-gradient-to-br from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-40 rounded-xl text-white transition-all active:scale-95"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
          <p className="text-[9px] text-[#484f58] text-center mt-1.5">On-device · no internet needed · never makes up facts — real reasoning goes online</p>
        </form>
      </div>
    </div>
  );
};

export default OfflineAI;
