import React, { useState, useRef, useEffect } from 'react';
import {
  Send, Loader2, AlertTriangle, BookOpen, FileText, User,
  Activity, Thermometer, Heart, Wind, Eye, ChevronDown,
  ChevronRight, Stethoscope, ClipboardList, X, Plus, RefreshCw
} from 'lucide-react';
import { cn } from '../../lib/utils';
import ReactMarkdown from 'react-markdown';

interface SDAMessage {
  id: string;
  text: string;
  sender: 'doctor' | 'sda';
  timestamp: Date;
  isRedFlag?: boolean;
}

interface PatientSnapshot {
  age?: string;
  sex?: string;
  weight?: string;
  chiefComplaint?: string;
  vitals?: { label: string; value: string; alert?: boolean }[];
  redFlags?: string[];
}

interface SDAChatProps {
  userId?: string;
}

const WELCOME: SDAMessage = {
  id: 'welcome',
  text: `**Namaste, Doctor.**

I am your **Senior Doctor Assistant (SDA)** — a clinical decision support system designed to assist you in structured case evaluation.

I work like an experienced senior consultant sitting beside you, guiding you through a complete, systematic clinical assessment — one step at a time.

**How this works:**
- I will ask you questions one at a time
- Each of your answers shapes my next question
- I adapt my questioning based on the evolving clinical picture
- Final diagnosis and treatment decisions remain entirely yours

---

To begin, please tell me — **what is the patient's age and sex?**

*(Example: 45-year-old male / 28-year-old female)*`,
  sender: 'sda',
  timestamp: new Date(),
};

export const SDAChat: React.FC<SDAChatProps> = ({ userId }) => {
  const [messages, setMessages] = useState<SDAMessage[]>([WELCOME]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [teachingMode, setTeachingMode] = useState(false);
  const [showPatientPanel, setShowPatientPanel] = useState(true);
  const [patient, setPatient] = useState<PatientSnapshot>({});
  const [activeRedFlags, setActiveRedFlags] = useState<string[]>([]);
  const [showSummaryLoading, setShowSummaryLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || loading) return;
    setInput('');

    const userMsg: SDAMessage = {
      id: Date.now().toString(),
      text,
      sender: 'doctor',
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      const history = messages.map(m => ({
        role: m.sender === 'doctor' ? 'user' : 'assistant',
        content: m.text,
      }));

      const res = await fetch('/api/sda-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history,
          teachingMode,
          userId,
        }),
      });

      if (!res.ok) throw new Error('Service error');
      const data = await res.json();

      const sdaMsg: SDAMessage = {
        id: (Date.now() + 1).toString(),
        text: data.reply || 'Unable to process.',
        sender: 'sda',
        timestamp: new Date(),
        isRedFlag: data.redFlagDetected,
      };
      setMessages(prev => [...prev, sdaMsg]);

      if (data.redFlags?.length) {
        setActiveRedFlags(prev => [...new Set([...prev, ...data.redFlags])]);
      }
      if (data.patientUpdate) {
        setPatient(prev => ({ ...prev, ...data.patientUpdate }));
      }
    } catch (e) {
      setMessages(prev => [...prev, {
        id: (Date.now() + 2).toString(),
        text: '⚠️ Service temporarily unavailable. Please try again.',
        sender: 'sda',
        timestamp: new Date(),
      }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const requestSummary = () => {
    handleSend('Please generate a complete structured case summary based on all information collected so far.');
  };

  const requestMissingCheck = () => {
    handleSend('What am I missing? Review the case and identify any missing history, examination findings, investigations, or alternative diagnoses I should consider.');
  };

  const startNewCase = () => {
    setMessages([WELCOME]);
    setPatient({});
    setActiveRedFlags([]);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex h-full bg-[#0a0f1a] overflow-hidden">

      {/* ── Patient Info Panel ── */}
      {showPatientPanel && (
        <div className="w-64 shrink-0 bg-[#0d1520] border-r border-emerald-900/30 flex flex-col overflow-hidden hidden md:flex">
          <div className="px-4 py-3 border-b border-emerald-900/30 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <User className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Patient Info</span>
            </div>
            <button onClick={() => setShowPatientPanel(false)} className="text-[#484f58] hover:text-white p-1">
              <X className="w-3 h-3" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
            {/* Demographics */}
            <div className="bg-[#111827] rounded-xl p-3 border border-white/5">
              <p className="text-[9px] text-[#484f58] font-black uppercase tracking-widest mb-2">Demographics</p>
              <div className="space-y-1.5">
                {[
                  { label: 'Age', value: patient.age },
                  { label: 'Sex', value: patient.sex },
                  { label: 'Weight', value: patient.weight },
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between items-center">
                    <span className="text-[10px] text-[#484f58]">{label}</span>
                    <span className={cn("text-[10px] font-medium", value ? 'text-white' : 'text-[#2d3748]')}>
                      {value || '—'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Chief Complaint */}
            <div className="bg-[#111827] rounded-xl p-3 border border-white/5">
              <p className="text-[9px] text-[#484f58] font-black uppercase tracking-widest mb-1.5">Chief Complaint</p>
              <p className={cn("text-[11px]", patient.chiefComplaint ? 'text-emerald-300 font-medium' : 'text-[#2d3748]')}>
                {patient.chiefComplaint || 'Not recorded yet'}
              </p>
            </div>

            {/* Vitals */}
            {patient.vitals && patient.vitals.length > 0 && (
              <div className="bg-[#111827] rounded-xl p-3 border border-white/5">
                <p className="text-[9px] text-[#484f58] font-black uppercase tracking-widest mb-2">Vitals</p>
                <div className="space-y-1.5">
                  {patient.vitals.map(v => (
                    <div key={v.label} className="flex justify-between items-center">
                      <span className="text-[10px] text-[#484f58]">{v.label}</span>
                      <span className={cn("text-[10px] font-mono font-bold", v.alert ? 'text-red-400' : 'text-white')}>
                        {v.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Red Flags */}
            {activeRedFlags.length > 0 && (
              <div className="bg-red-950/40 rounded-xl p-3 border border-red-500/30">
                <p className="text-[9px] text-red-400 font-black uppercase tracking-widest mb-2 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Red Flags
                </p>
                <div className="space-y-1">
                  {activeRedFlags.map((flag, i) => (
                    <p key={i} className="text-[10px] text-red-300">• {flag}</p>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Quick Actions */}
          <div className="p-3 border-t border-emerald-900/30 space-y-2">
            <button
              onClick={requestSummary}
              disabled={loading || messages.length < 3}
              className="w-full flex items-center gap-2 px-3 py-2 bg-emerald-900/30 hover:bg-emerald-900/50 border border-emerald-700/30 rounded-lg text-[10px] font-black text-emerald-300 uppercase tracking-widest transition-all disabled:opacity-40"
            >
              <FileText className="w-3.5 h-3.5" />
              Case Summary
            </button>
            <button
              onClick={requestMissingCheck}
              disabled={loading || messages.length < 3}
              className="w-full flex items-center gap-2 px-3 py-2 bg-indigo-900/20 hover:bg-indigo-900/40 border border-indigo-700/20 rounded-lg text-[10px] font-black text-indigo-300 uppercase tracking-widest transition-all disabled:opacity-40"
            >
              <ClipboardList className="w-3.5 h-3.5" />
              What Am I Missing?
            </button>
          </div>
        </div>
      )}

      {/* ── Main Chat Area ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Header */}
        <div className="shrink-0 bg-[#0d1520] border-b border-emerald-900/30 px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {!showPatientPanel && (
              <button onClick={() => setShowPatientPanel(true)} className="p-1.5 hover:bg-white/10 rounded-lg text-[#484f58] hover:text-emerald-400 transition-colors">
                <User className="w-4 h-4" />
              </button>
            )}
            <div className="w-7 h-7 rounded-lg bg-emerald-900/40 border border-emerald-700/40 flex items-center justify-center">
              <Stethoscope className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div>
              <p className="text-[12px] font-black text-white tracking-wide">Senior Doctor Assistant</p>
              <p className="text-[9px] text-emerald-600 font-medium">Clinical Decision Support · Doctor Use Only</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Teaching Mode Toggle */}
            <button
              onClick={() => setTeachingMode(p => !p)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all border",
                teachingMode
                  ? "bg-amber-900/30 border-amber-600/40 text-amber-300"
                  : "bg-white/5 border-white/10 text-[#484f58] hover:text-white"
              )}
            >
              <BookOpen className="w-3 h-3" />
              <span className="hidden sm:inline">Teaching {teachingMode ? 'ON' : 'OFF'}</span>
            </button>

            {/* New Case */}
            <button
              onClick={startNewCase}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest bg-white/5 border border-white/10 text-[#484f58] hover:text-white hover:bg-white/10 transition-all"
            >
              <RefreshCw className="w-3 h-3" />
              <span className="hidden sm:inline">New Case</span>
            </button>
          </div>
        </div>

        {/* Red Flag Alert Banner */}
        {activeRedFlags.length > 0 && (
          <div className="shrink-0 bg-red-950/60 border-b border-red-500/40 px-4 py-2 flex items-center gap-3">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 animate-pulse" />
            <div className="flex-1 min-w-0">
              <span className="text-[10px] font-black text-red-300 uppercase tracking-widest">Red Flag Alert: </span>
              <span className="text-[10px] text-red-200">{activeRedFlags.join(' · ')}</span>
            </div>
            <button onClick={() => setActiveRedFlags([])} className="text-red-600 hover:text-red-400 p-1">
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-4 space-y-4">
          {messages.map(msg => (
            <div
              key={msg.id}
              className={cn("flex", msg.sender === 'doctor' ? "justify-end" : "justify-start")}
            >
              {msg.sender === 'sda' && (
                <div className="w-7 h-7 rounded-full bg-emerald-900/40 border border-emerald-700/40 flex items-center justify-center shrink-0 mr-2.5 mt-0.5">
                  <Stethoscope className="w-3.5 h-3.5 text-emerald-400" />
                </div>
              )}
              <div className={cn(
                "max-w-[80%] rounded-2xl px-4 py-3 text-[12px] leading-relaxed",
                msg.sender === 'sda'
                  ? msg.isRedFlag
                    ? "bg-red-950/60 border border-red-500/40 text-red-100"
                    : "bg-[#111827] border border-white/5 text-[#c9d1d9]"
                  : "bg-emerald-800/30 border border-emerald-700/30 text-emerald-100"
              )}>
                {msg.isRedFlag && (
                  <div className="flex items-center gap-1.5 mb-2 pb-2 border-b border-red-500/30">
                    <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                    <span className="text-[9px] font-black uppercase tracking-widest text-red-400">Red Flag Detected</span>
                  </div>
                )}
                <div className="prose prose-invert prose-xs max-w-none prose-p:leading-relaxed prose-p:my-1 prose-headings:text-emerald-300 prose-strong:text-white prose-li:my-0.5">
                  <ReactMarkdown>{msg.text}</ReactMarkdown>
                </div>
                <p className="text-[8px] text-[#484f58] mt-2 text-right">
                  {msg.timestamp instanceof Date
                    ? msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : ''}
                </p>
              </div>
              {msg.sender === 'doctor' && (
                <div className="w-7 h-7 rounded-full bg-indigo-900/40 border border-indigo-700/40 flex items-center justify-center shrink-0 ml-2.5 mt-0.5">
                  <User className="w-3.5 h-3.5 text-indigo-400" />
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="w-7 h-7 rounded-full bg-emerald-900/40 border border-emerald-700/40 flex items-center justify-center shrink-0 mr-2.5">
                <Stethoscope className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <div className="bg-[#111827] border border-white/5 rounded-2xl px-4 py-3 flex items-center gap-2">
                <div className="flex gap-1">
                  {[0, 1, 2].map(i => (
                    <div key={i} className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                  ))}
                </div>
                <span className="text-[10px] text-[#484f58]">Analyzing...</span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Disclaimer */}
        <div className="shrink-0 px-4 py-1.5 bg-[#0d1520] border-t border-white/5">
          <p className="text-[8px] text-[#2d3748] text-center">
            SDA is a clinical decision support tool. All diagnoses and treatment decisions remain the sole responsibility of the treating physician.
          </p>
        </div>

        {/* Input Area */}
        <div className="shrink-0 bg-[#0d1520] border-t border-emerald-900/30 px-4 py-3">
          <div className="flex items-end gap-3">
            <div className="flex-1 bg-[#111827] border border-emerald-900/40 focus-within:border-emerald-600/60 rounded-xl px-4 py-2.5 transition-all">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type your answer or clinical finding..."
                rows={1}
                className="w-full bg-transparent resize-none outline-none text-[12px] text-white placeholder-[#484f58] leading-relaxed max-h-32 overflow-y-auto custom-scrollbar"
                style={{ minHeight: '1.5rem' }}
                disabled={loading}
              />
            </div>
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || loading}
              className="w-10 h-10 flex items-center justify-center bg-emerald-700 hover:bg-emerald-600 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl transition-all shrink-0 shadow-lg shadow-emerald-900/40"
            >
              {loading ? <Loader2 className="w-4 h-4 text-white animate-spin" /> : <Send className="w-4 h-4 text-white" />}
            </button>
          </div>
          <p className="text-[9px] text-[#2d3748] mt-1.5 text-center">Enter to send · Shift+Enter for new line</p>
        </div>
      </div>
    </div>
  );
};
