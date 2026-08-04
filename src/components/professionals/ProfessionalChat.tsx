import React, { useEffect, useRef, useState } from 'react';
import { Send, Loader2, Sparkles, X, FileText, Crown, LogIn, Wallet } from 'lucide-react';
import { TirangaLoader } from '../ui/TirangaLoader';
import { AttachMenu } from '../AttachMenu';
import { ProfessionalVoiceButton } from '../sonic/ProfessionalVoiceButton';
import { auth } from '../../lib/firebase';
import { fetchPassStatus, buyProfessionalPass, type PassStatus } from './professionalPass';
import { autoGrow, resetGrow } from '../../lib/autoGrowTextarea';
import { AppUpdateChatNotice } from '../AppUpdateChatNotice';

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
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB per file
const ACCEPTED_TYPES = 'image/*,.pdf,.txt,.md,.csv,.json,.html,.docx,.xlsx,.xls,.pptx,.zip,.js,.ts,.tsx,.jsx,.py,.css';

/** Read a file to { name, type, base64 }. Large images are downscaled client-side. */
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
  const [pass, setPass] = useState<PassStatus | null>(null);
  // 'wallet' is NOT the same refusal as 'paywall'. The paywall means the free messages for today are
  // used up; 'wallet' means the shared balance is empty (the one-wallet law — assistants spend the
  // same wallet as a build). Telling an empty-balance user they "used their free messages" would be
  // simply untrue, and would offer them the wrong action.
  const [paywall, setPaywall] = useState<null | 'paywall' | 'login' | 'wallet'>(null);
  const [buying, setBuying] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  // Composer auto-grow (admin 2026-07-20): starts at 1 line, grows while typing (max-h-32 = 128px),
  // snaps back to 1 line when send() clears the input.
  const composerRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (!input && composerRef.current) resetGrow(composerRef.current); }, [input]);

  const refreshPass = React.useCallback(() => { fetchPassStatus().then((p) => setPass(p)).catch(() => {}); }, []);
  // Load pass/quota state on mount and whenever the signed-in user changes (also picks up a pass that
  // was just granted after returning from the Cashfree checkout).
  useEffect(() => {
    refreshPass();
    const unsub = auth.onAuthStateChanged(() => refreshPass());
    return () => unsub();
  }, [refreshPass]);

  const startBuyPass = async () => {
    if (buying || !pass) return;
    setBuying(true);
    try {
      const outcome = await buyProfessionalPass(pass.priceInr, pass.passDays);
      if (outcome === 'granted') { setPaywall(null); refreshPass(); } // simulator (dev) → pass active now
      // 'redirecting' → the gateway page took over; on return the app refetches status.
    } catch (e: any) {
      alert(e?.message || 'Could not start the Pass purchase. Please try again.');
    } finally {
      setBuying(false);
    }
  };

  useEffect(() => {
    try { localStorage.setItem(storeKey, JSON.stringify(messages.slice(-120))); } catch { /* ignore */ }
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, storeKey]);

  // ROOT-CAUSE FIX (sibling of the same bug in AgentV3Panel.tsx, admin 2026-07-26): a file over the
  // limit used to vanish here with no feedback at all — the same silent-drop bug class. Now the user
  // is told exactly which file was rejected and why, instead of wondering where their attachment went.
  const addFiles = (list: FileList | File[] | null) => {
    if (!list) return;
    const incoming = Array.from(list);
    const tooBig = incoming.filter((f) => f.size > MAX_FILE_BYTES);
    const allowed = incoming.filter((f) => f.size <= MAX_FILE_BYTES);
    if (tooBig.length > 0) {
      const names = tooBig.map((f) => `${f.name} (${(f.size / 1024 / 1024).toFixed(1)} MB)`).join(', ');
      setMessages((m) => [...m, { role: 'assistant', content: `⚠️ File too large (max ${(MAX_FILE_BYTES / 1024 / 1024).toFixed(0)} MB): ${names}` }]);
    }
    if (allowed.length > 0) setFiles((prev) => [...prev, ...allowed].slice(0, MAX_FILES));
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
      const fileAttachments = await Promise.all(sendFiles.map(fileToAttachment));
      const history = next.filter((m) => m.content !== config.welcome).slice(-20);
      // Bearer token so the server can key persistent memory (e.g. Teacher AI's student
      // profile) to the VERIFIED identity — the body userId alone is never trusted for that.
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      try {
        const token = await auth.currentUser?.getIdToken();
        if (token) headers.Authorization = `Bearer ${token}`;
      } catch { /* signed-out or token fetch failed — request proceeds anonymously */ }
      const res = await fetch(config.endpoint || `/api/professional/${config.id}/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message: content,
          history,
          userId,
          ...(fileAttachments.length > 0 ? { fileAttachments } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      // Professional Pass gate: show the paywall / login prompt instead of a raw error bubble.
      if (data?.code === 'wallet_empty') { setPaywall('wallet'); return; }
      if (res.status === 402 || data?.code === 'professional_paywall') { setPaywall('paywall'); refreshPass(); return; }
      if (res.status === 401 || data?.code === 'login_required') { setPaywall('login'); return; }
      if (!res.ok) throw new Error(data?.error || 'Request failed.');
      setMessages((m) => [...m, { role: 'assistant', content: data.reply || '(no reply)' }]);
      refreshPass(); // update the "X/limit free today" counter
    } catch (e: any) {
      setMessages((m) => [...m, { role: 'assistant', content: `⚠️ ${e?.message || 'Something went wrong — please try again.'}` }]);
    } finally {
      setLoading(false);
    }
  };

  const showQuick = config.quickPrompts && messages.filter((m) => m.role === 'user').length === 0;

  return (
    <div className="relative flex flex-col h-full min-h-0 bg-[#0d1117] text-white">
      <div className="px-4 py-3 border-b border-white/5 flex items-center gap-2 shrink-0">
        <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center"><Sparkles className="w-4 h-4" /></div>
        <span className="font-bold text-sm">{config.name}</span>
        {/* Pass / free-quota chip — only when the paid gate is on for a signed-in user. */}
        {pass?.enabled && pass?.signedIn && (
          pass.unlimited ? (
            <span className="ml-auto flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
              <Crown className="w-3 h-3" /> {pass.hasPass ? 'Pass active' : 'Unlimited'}
            </span>
          ) : (
            <button
              onClick={() => setPaywall('paywall')}
              title="Get the Professional Pass for unlimited access"
              className="ml-auto flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-[#c9d1d9]"
            >
              <span className={pass.remainingFree <= 3 ? 'text-amber-300' : ''}>{pass.remainingFree}/{pass.freeDailyLimit} free today</span>
              <Crown className="w-3 h-3 text-amber-400" />
            </button>
          )
        )}
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-4 space-y-4">
        {(() => {
          const lastUser = [...messages].reverse().find((m) => m.role === 'user');
          return lastUser ? <AppUpdateChatNotice userText={lastUser.content} /> : null;
        })()}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed ${m.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-[#161b22] border border-white/10 text-[#c9d1d9]'}`}>
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start"><div className="bg-[#161b22] border border-white/10 rounded-2xl px-4 py-2.5"><TirangaLoader className="w-4 h-4 text-indigo-400" /></div></div>
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
        <AttachMenu
          onFiles={(fl) => addFiles(fl)}
          fileAccept={ACCEPTED_TYPES}
          disabled={loading || files.length >= MAX_FILES}
          badge={files.length}
          title="Attach (photo, gallery, or file)"
          buttonClassName="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 disabled:opacity-40 border border-white/10 text-[#c9d1d9] flex items-center justify-center"
        />
        <textarea
          ref={composerRef}
          value={input}
          onChange={(e) => { setInput(e.target.value); autoGrow(e.target, 128); }}
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
        <ProfessionalVoiceButton
          professionalId={config.id}
          getHistory={() => messages
            .filter((m) => m.content !== config.welcome)
            .slice(-12)
            .map((m) => ({ role: m.role === 'user' ? 'user' as const : 'assistant' as const, content: m.content }))}
        />
        <button onClick={() => send()} disabled={(!input.trim() && files.length === 0) || loading} className="w-9 h-9 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white flex items-center justify-center shrink-0">
          {loading ? <TirangaLoader className="w-4 h-4" /> : <Send className="w-4 h-4" />}
        </button>
      </div>

      {/* Paywall / login card — shown when the gate blocks a turn (or the user taps the quota chip). */}
      {paywall && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 p-5" onClick={() => setPaywall(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-[#161b22] border border-white/10 p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setPaywall(null)} className="absolute right-3 top-3 text-[#586069] hover:text-white"><X className="w-4 h-4" /></button>
            {paywall === 'wallet' ? (
              <>
                <div className="mx-auto mb-3 w-12 h-12 rounded-full bg-amber-500/15 text-amber-300 flex items-center justify-center"><Wallet className="w-6 h-6" /></div>
                <h3 className="font-bold text-white mb-1">Your balance is empty</h3>
                <p className="text-sm text-[#8b949e] mb-4">
                  The assistants use the same balance as your builds — you only pay for what you actually use.
                  Add credit to carry on.
                </p>
                <button
                  onClick={() => window.dispatchEvent(new CustomEvent('navbharat:navigate', { detail: { view: 'billing' } }))}
                  className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold flex items-center justify-center gap-2"
                >
                  <Wallet className="w-4 h-4" /> Add credit
                </button>
                <button
                  onClick={startBuyPass}
                  disabled={buying}
                  className="mt-2 w-full py-2 rounded-xl bg-white/5 hover:bg-white/10 disabled:opacity-60 text-[#8b949e] text-xs font-semibold"
                >
                  {buying ? 'Opening checkout…' : `Or get the Professional Pass — ₹${pass?.priceInr ?? 99}/month, unlimited`}
                </button>
              </>
            ) : paywall === 'login' ? (
              <>
                <div className="mx-auto mb-3 w-12 h-12 rounded-full bg-indigo-500/15 text-indigo-300 flex items-center justify-center"><LogIn className="w-6 h-6" /></div>
                <h3 className="font-bold text-white mb-1">Sign in to continue</h3>
                <p className="text-sm text-[#8b949e]">Professionals need a free account. Sign in to get {pass?.freeDailyLimit ?? 50} free messages every day.</p>
              </>
            ) : (
              <>
                <div className="mx-auto mb-3 w-12 h-12 rounded-full bg-amber-500/15 text-amber-300 flex items-center justify-center"><Crown className="w-6 h-6" /></div>
                <h3 className="font-bold text-white mb-1">Get the Professional Pass</h3>
                <p className="text-sm text-[#8b949e] mb-4">
                  You've used your {pass?.freeDailyLimit ?? 50} free messages for today. Unlock <span className="text-white font-semibold">unlimited</span> access to every professional.
                </p>
                <button
                  onClick={startBuyPass}
                  disabled={buying}
                  className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 disabled:opacity-60 text-black font-bold flex items-center justify-center gap-2"
                >
                  {buying ? <TirangaLoader className="w-4 h-4" /> : <Crown className="w-4 h-4" />}
                  {buying ? 'Opening checkout…' : `Get Pass — ₹${pass?.priceInr ?? 99}/month`}
                </button>
                <p className="text-[11px] text-[#586069] mt-2">Cancel anytime · secure payment</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
