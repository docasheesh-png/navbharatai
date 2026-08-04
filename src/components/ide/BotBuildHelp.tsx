import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Bot, X, ChevronDown, Send, ImagePlus, User } from 'lucide-react';

// Bot-Builder Help widget (admin 2026-07-23): a floating helper that IS NavBharatAI Free (same /api/chat/
// navbharatai brain — vision-capable, so a non-technical user can send SCREENSHOTS and get 1-by-1 steps),
// primed to help design + connect a Telegram/WhatsApp bot. Opens as a popup; minimize collapses it to a
// 🤖 bubble in the bottom-right corner; the bubble reopens it. No new backend — reuses the Free chat.

export type HelpMode = 'closed' | 'open' | 'min';

interface HelpMsg { sender: 'user' | 'ai'; text: string; image?: string }

// A hidden framing turn that gives the Free AI the EXACT Bot-Builder manual, so it guides accurately and
// never invents controls (admin 2026-07-23: the old vague context made it hallucinate a non-existent
// "Add Button" in the Message node and wrongly deflect the user to Pro v5.0 / claim it "can't be fixed").
const PRIMER = {
  sender: 'user' as const,
  text: [
    'CONTEXT — do NOT repeat this back. You are the built-in helper INSIDE the NavBharatAI "Bot Builder"',
    '(a visual chatbot flow editor). Guide me, a NON-TECHNICAL user, ONE small step at a time — exactly',
    'where to tap and what to paste. If I send a screenshot, read it and tell me the very next step.',
    'Keep replies short and simple. NEVER tell me to switch to "Pro v5.0" — the Bot Builder is the right',
    'tool and you help ME finish here. NEVER say the tool can\'t be fixed or that only your team can help.',
    '',
    'THESE ARE THE ONLY REAL CONTROLS — never invent any others:',
    '• ADD A NODE: tap a type in the BOTTOM palette bar — Start, Message, Button Menu, Condition, API Call, End.',
    '• SELECT A NODE: tap it. A small toolbar pops up ABOVE the node: Edit(pencil), Connect(link), Move, Duplicate, Delete.',
    '• EDIT A NODE: tap it → tap Edit (or double-tap) → a panel opens (bottom sheet on phone, side panel on desktop).',
    '• ADD BUTTONS TO A MESSAGE: tap a Message node → Edit → under the "Buttons" label tap "Add button" (add one per button).',
    '  (A "Button Menu" node also has buttons via "Add Option". Buttons = these two nodes only.)',
    '• CONNECT NODES (build the flow): tap a node → tap Connect(link) → then tap the TARGET node. Each button follows',
    '  the connections in the order they were made. Tap a connection LINE to delete it.',
    '• TEST: tap "Simulate" in the top toolbar.',
    '• PUBLISH: tap "Go Live" in the top toolbar → choose Telegram (paste the token from @BotFather) OR WhatsApp',
    '  (paste the Meta Cloud API permanent access token + Phone Number ID; it returns a Callback URL + Verify token to paste in Meta).',
    '',
    'If I say a control is missing, trust me, ask for a screenshot, and re-check against THIS list — do not guess.',
  ].join('\n'),
};

interface Props { mode: HelpMode; onModeChange: (m: HelpMode) => void }

export const BotBuildHelp: React.FC<Props> = ({ mode, onModeChange }) => {
  const [messages, setMessages] = useState<HelpMsg[]>([
    { sender: 'ai', text: "Hi! I'm your NavBharatAI helper 🤖 I'll walk you through building your bot and putting it live on Telegram/WhatsApp — one simple step at a time. Stuck somewhere? Just send me a screenshot and I'll tell you exactly what to tap next. What would you like to do first?" },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingImg, setPendingImg] = useState<{ name: string; type: string; base64: string; preview: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, mode, busy]);

  const pickImage = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
      setPendingImg({ name: file.name, type: file.type, base64, preview: dataUrl });
    };
    reader.readAsDataURL(file);
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if ((!text && !pendingImg) || busy) return;
    const img = pendingImg;
    const userMsg: HelpMsg = { sender: 'user', text: text || '📷 (screenshot)', image: img?.preview };
    const priorForApi = messages.filter(m => m.text).map(m => ({ sender: m.sender, text: m.text.slice(0, 2000) }));
    setMessages(m => [...m, userMsg]);
    setInput('');
    setPendingImg(null);
    setBusy(true);
    try {
      const body = {
        message: text || 'Here is a screenshot — please look at it and tell me the exact next step.',
        history: [PRIMER, ...priorForApi],
        stream: false,
        ...(img ? { fileAttachments: [{ name: img.name, type: img.type, base64: img.base64 }] } : {}),
      };
      const res = await fetch('/api/chat/navbharatai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { reply?: string };
      setMessages(m => [...m, { sender: 'ai', text: data.reply || "Sorry, I couldn't respond just now — please try again in a moment." }]);
    } catch {
      setMessages(m => [...m, { sender: 'ai', text: 'Network issue — please check your connection and try again.' }]);
    }
    setBusy(false);
  }, [input, pendingImg, busy, messages]);

  if (mode === 'closed') return null;

  if (mode === 'min') {
    return (
      <button
        onClick={() => onModeChange('open')}
        aria-label="Open NavBharatAI help"
        className="fixed bottom-4 right-4 z-[200] w-14 h-14 rounded-full bg-indigo-600 hover:bg-indigo-500 shadow-2xl flex items-center justify-center text-white transition-all active:scale-90"
        style={{ boxShadow: '0 8px 30px rgba(79,70,229,0.5)' }}
      >
        <Bot size={26} />
        <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-emerald-400 rounded-full border-2 border-[#0d1117]" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-[200] flex flex-col rounded-2xl border border-white/15 shadow-2xl overflow-hidden"
      style={{ width: 'min(92vw, 384px)', height: 'min(72vh, 560px)', background: '#161b22' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/10 flex-shrink-0" style={{ background: '#1c2230' }}>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center"><Bot size={16} className="text-white" /></div>
          <div className="leading-tight">
            <div className="text-xs font-semibold text-gray-100">NavBharatAI Help</div>
            <div className="text-[10px] text-emerald-400 flex items-center gap-1"><span className="w-1.5 h-1.5 bg-emerald-400 rounded-full" /> here to help you go live</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => onModeChange('min')} title="Minimize" aria-label="Minimize" className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10"><ChevronDown size={16} /></button>
          <button onClick={() => onModeChange('closed')} title="Close" aria-label="Close" className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10"><X size={15} /></button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 flex flex-col gap-2.5 min-h-0" style={{ background: '#0d1117' }}>
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-2 ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
            {m.sender === 'ai' && <div className="w-6 h-6 rounded-full bg-indigo-600/30 flex items-center justify-center flex-shrink-0 mt-0.5"><Bot size={12} className="text-indigo-300" /></div>}
            <div className={`max-w-[78%] rounded-2xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap break-words ${m.sender === 'user' ? 'bg-indigo-600 text-white rounded-br-sm' : 'text-gray-200 rounded-bl-sm'}`} style={{ background: m.sender === 'user' ? undefined : '#1c2230' }}>
              {m.image && <img src={m.image} alt="screenshot" className="rounded-lg mb-1.5 max-h-40 w-auto" />}
              {m.text}
            </div>
            {m.sender === 'user' && <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 mt-0.5"><User size={12} className="text-gray-300" /></div>}
          </div>
        ))}
        {busy && (
          <div className="flex gap-2 justify-start">
            <div className="w-6 h-6 rounded-full bg-indigo-600/30 flex items-center justify-center flex-shrink-0"><Bot size={12} className="text-indigo-300" /></div>
            <div className="rounded-2xl px-3 py-2.5 text-xs text-gray-400 rounded-bl-sm flex gap-1" style={{ background: '#1c2230' }}>
              <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="flex-shrink-0 border-t border-white/10 p-2.5" style={{ background: '#161b22' }}>
        {pendingImg && (
          <div className="flex items-center gap-2 mb-2 px-2 py-1.5 rounded-lg bg-white/5 text-xs text-gray-300">
            <img src={pendingImg.preview} alt="attached" className="w-8 h-8 rounded object-cover" />
            <span className="flex-1 truncate">{pendingImg.name}</span>
            <button onClick={() => setPendingImg(null)} className="text-gray-500 hover:text-white"><X size={13} /></button>
          </div>
        )}
        <div className="flex items-end gap-1.5">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pickImage} />
          <button onClick={() => fileRef.current?.click()} title="Attach a screenshot" aria-label="Attach screenshot" className="w-9 h-9 rounded-lg flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 flex-shrink-0"><ImagePlus size={17} /></button>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            rows={1}
            placeholder="Ask anything, or send a screenshot…"
            className="flex-1 rounded-xl px-3 py-2 text-xs text-gray-200 border border-white/10 resize-none focus:outline-none focus:border-indigo-500/50 max-h-24"
            style={{ background: '#0d1117' }}
          />
          <button onClick={send} disabled={busy || (!input.trim() && !pendingImg)} aria-label="Send" className="w-9 h-9 rounded-lg flex items-center justify-center bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white flex-shrink-0"><Send size={15} /></button>
        </div>
      </div>
    </div>
  );
};
