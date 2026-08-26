import React, { useEffect, useRef, useState } from 'react';
import { Send, Sparkles, X, FileText, Clock, LogIn, Wallet } from 'lucide-react';
import { TirangaLoader } from '../ui/TirangaLoader';
import { AttachMenu } from '../AttachMenu';
import { ProfessionalVoiceButton } from '../sonic/ProfessionalVoiceButton';
import { auth } from '../../lib/firebase';
import { fetchPassStatus, type PassStatus } from './professionalPass';
import { autoGrow, resetGrow } from '../../lib/autoGrowTextarea';
import { dismissKeyboardOnMobile } from '../../lib/dismissKeyboard';
import { AppUpdateChatNotice } from '../AppUpdateChatNotice';
import { ChatToolbar } from '../chat/ChatToolbar';
import { MessageEditActions } from '../chat/MessageEditActions';
import { filterMessages, enterShouldSend, readSendOnEnter, searchActive } from '../../lib/chatToolbar';
import { deleteMessage, editMessage, editedLabel } from '../../lib/chatMessageActions';
import { activeKey } from '../../lib/professionalChatStore';
import { LinkedText } from '../../lib/linkify';

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

interface Msg { role: 'user' | 'assistant'; content: string; edited?: boolean; }

/**
 * The professionals' transcript has no message ids — it is a plain `{role, content}[]` persisted to
 * localStorage, and adding a real id field would invalidate every conversation already saved on every
 * user's device. So the POSITION is the id, and these two adapters translate in and out of the shared
 * delete/edit rules. The index is only ever the true one because the edit/delete controls are hidden
 * while a search is filtering the list (see `searchActive`).
 */
const msgId = (index: number) => String(index);
const withIds = (list: readonly Msg[]) => list.map((m, i) => ({
  id: msgId(i),
  sender: (m.role === 'user' ? 'user' : 'ai') as 'user' | 'ai',
  text: m.content,
  edited: m.edited,
}));
const fromIds = (list: ReadonlyArray<{ sender: 'user' | 'ai'; text?: string; edited?: boolean }>): Msg[] =>
  list.map((m) => ({
    role: m.sender === 'user' ? 'user' : 'assistant',
    content: m.text ?? '',
    ...(m.edited ? { edited: true } : {}),
  }));

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
  // ONE definition of where a professional's conversation lives (professionalChatStore) — this string
  // used to be spelled out here AND in ProfessionalHistoryView, and App's ✕ close now has to agree with
  // both. Three hand-written copies of a key is how a close button ends up clearing the wrong thing.
  const storeKey = activeKey(config.id);
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
  // Shared composer toolbar state (admin 2026-08-10) — the Enter preference comes from the ONE key
  // every AI reads, so the setting follows the user between screens instead of resetting per chat.
  const [sendOnEnter, setSendOnEnter] = useState<boolean>(() => readSendOnEnter((k) => localStorage.getItem(k)));
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [showChatSearch, setShowChatSearch] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  // Composer auto-grow (admin 2026-07-20): starts at 1 line, grows while typing (max-h-32 = 128px),
  // snaps back to 1 line when send() clears the input.
  const composerRef = useRef<HTMLTextAreaElement>(null);
  // STOP support (admin 2026-08-13): every professional AI waits for one full reply; without an abortable
  // request a wrong query could not be cancelled. abortRef cancels the fetch; stoppedRef keeps the catch
  // silent on a deliberate stop.
  const abortRef = useRef<AbortController | null>(null);
  const stoppedRef = useRef(false);
  useEffect(() => { if (!input && composerRef.current) resetGrow(composerRef.current); }, [input]);

  // ADMIN 2026-08-10 — "pass system hata do". The Professional Pass is gone, so there is no purchase
  // to start from this screen any more. What remains is the free-allowance COUNTER, which is real and
  // worth showing: it tells a signed-in user how many messages they have left today. The status call
  // stays for exactly that.
  const refreshPass = React.useCallback(() => { fetchPassStatus().then((p) => setPass(p)).catch(() => {}); }, []);
  useEffect(() => {
    refreshPass();
    const unsub = auth.onAuthStateChanged(() => refreshPass());
    return () => unsub();
  }, [refreshPass]);

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

  /**
   * `resendOf` carries the transcript an EDIT already produced. Without it, re-asking an edited
   * question would append a second copy of it — the edit rewinds the transcript and keeps the edited
   * message in place, so send() must build on that instead of on stale state and must not re-add it.
   * It also preserves the `edited` marker, which a plain re-send would quietly drop.
   */
  const send = async (text?: string, resendOf?: Msg[]) => {
    const content = (text ?? input).trim();
    if ((!content && files.length === 0) || loading) return;
    const sendFiles = files;
    setInput('');
    setFiles([]);
    const shownContent = sendFiles.length > 0
      ? `${content || '(files attached)'}\n📎 ${sendFiles.map((f) => f.name).join(', ')}`
      : content;
    const next: Msg[] = resendOf ?? [...messages, { role: 'user', content: shownContent }];
    setMessages(next);
    setLoading(true);
    stoppedRef.current = false;
    const controller = new AbortController();
    abortRef.current = controller;
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
        signal: controller.signal,
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
      // A deliberate Stop is not an error — stay silent (no reply bubble).
      if (!stoppedRef.current && e?.name !== 'AbortError') {
        setMessages((m) => [...m, { role: 'assistant', content: `⚠️ ${e?.message || 'Something went wrong — please try again.'}` }]);
      }
    } finally {
      setLoading(false);
    }
  };

  // STOP the in-flight reply (admin 2026-08-13) — one tap cancels a wrong query instead of waiting it out.
  const stop = () => {
    stoppedRef.current = true;
    try { abortRef.current?.abort(); } catch { /* already settled */ }
    setLoading(false);
  };

  const showQuick = config.quickPrompts && messages.filter((m) => m.role === 'user').length === 0;

  return (
    <div className="relative flex flex-col h-full min-h-0 bg-[#0d1117] text-white">
      {/* HEADER — deliberately compact (admin 2026-08-25). On a phone this bar, the toolbar and the
          composer all compete with the keyboard for a small screen, and the header is the only one of
          the three the user never interacts with. Every row it gives back is a row of conversation. */}
      <div className="px-4 py-2 border-b border-white/5 flex items-center gap-2 shrink-0">
        <div className="w-7 h-7 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center shrink-0"><Sparkles className="w-3.5 h-3.5" /></div>
        <span className="font-bold text-sm truncate min-w-0">{config.name}</span>
        {/* Free-allowance chip — only when the daily gate is on for a signed-in user. It is a COUNTER
            now, not an upsell: it used to be a button that opened a Pass paywall, and there is nothing
            left to sell. Unlimited accounts show nothing at all rather than a crown they cannot act on. */}
        {pass?.enabled && pass?.signedIn && !pass.unlimited && (
          <span className="ml-auto text-[11px] font-semibold px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-[#c9d1d9]">
            <span className={pass.remainingFree <= 3 ? 'text-amber-300' : ''}>{pass.remainingFree}/{pass.freeDailyLimit} free today</span>
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-4 space-y-4">
        {(() => {
          const lastUser = [...messages].reverse().find((m) => m.role === 'user');
          return lastUser ? <AppUpdateChatNotice userText={lastUser.content} /> : null;
        })()}
        {filterMessages(messages as any, chatSearchQuery).map((m: any, i: number) => (
          <div key={i} className={`group/msg ${m.role === 'user' ? 'flex flex-col items-end' : 'flex flex-col items-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed ${m.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-[#161b22] border border-white/10 text-[#c9d1d9]'}`}>
              {/* Real, tappable source links (admin 2026-08-25). The bubble stays plain text —
                  LinkedText emits only strings and anchors, so wrapping is unchanged. */}
              <LinkedText text={String(m.content ?? '')} />
              {m.edited && <span className="ml-2 text-[10px] opacity-60 align-middle">{editedLabel()}</span>}
            </div>
            {/* DELETE + EDIT on a sent message (admin 2026-08-10). Only the user's own, and only while
                no answer is in flight — rewinding under a running turn is not a state we could honestly
                represent on screen. Hidden until hover on a pointer device; always present on touch,
                where there is no hover to reveal them with. */}
            {m.role === 'user' && !searchActive(chatSearchQuery) && (
              <MessageEditActions
                className="mt-0.5 opacity-60 md:opacity-0 md:group-hover/msg:opacity-100 transition-opacity"
                text={String(m.content ?? '')}
                disabled={loading}
                onDelete={() => setMessages(fromIds(deleteMessage(withIds(messages), msgId(i))))}
                onEdit={(next) => {
                  const r = editMessage(withIds(messages), msgId(i), next);
                  const rewound = fromIds(r.messages);
                  setMessages(rewound);
                  // The edited message is ALREADY the last entry of `rewound`; handing it to send()
                  // keeps it (and its "edited" marker) instead of appending a duplicate.
                  if (r.resend) void send(r.resend, rewound);
                }}
              />
            )}
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

      {/* THE SHARED COMPOSER TOOLBAR (admin 2026-08-10: "wahi sabhi jagah laga do"). The professionals
          had none of it — no way to change how Enter behaves, no way to find something said earlier,
          no way to start over without clearing site data. Clear also drops the SAVED transcript, not
          just the on-screen one: this chat restores itself from localStorage on mount, so wiping only
          the array would resurrect the whole conversation on the next visit. */}
      <div className="px-3 pt-1.5 shrink-0">
        <ChatToolbar
          messageCount={messages.length}
          sendOnEnter={sendOnEnter}
          onSendOnEnterChange={setSendOnEnter}
          searchQuery={chatSearchQuery}
          onSearchQueryChange={setChatSearchQuery}
          searchOpen={showChatSearch}
          onSearchOpenChange={setShowChatSearch}
          searchMatches={filterMessages(messages as any, chatSearchQuery).length}
          onClear={() => {
            setMessages([{ role: 'assistant', content: config.welcome }]);
            try { localStorage.removeItem(storeKey); } catch { /* private mode — the screen is still cleared */ }
          }}
          charCount={input.length}
        />
      </div>

      <div className="px-3 py-2 border-t border-white/5 flex items-end gap-2 shrink-0">
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
          onKeyDown={(e) => {
            // Was unconditional: Enter ALWAYS sent, the toggle did not exist here, and it fired mid-IME
            // composition — so a Hindi or CJK typist sent a half-finished word. One shared rule now.
            if (enterShouldSend({
              key: e.key,
              shiftKey: e.shiftKey,
              sendOnEnter,
              hasContent: !!input.trim() || files.length > 0,
              isBusy: loading,
              isComposing: (e.nativeEvent as any)?.isComposing,
            })) {
              e.preventDefault();
              void send();
              dismissKeyboardOnMobile(composerRef.current);
            }
          }}
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
        {/* Send → one-tap STOP while a reply loads (admin 2026-08-13), so a wrong query can be cancelled. */}
        {loading ? (
          <button onClick={stop} title="Stop" className="w-9 h-9 rounded-xl bg-red-600 hover:bg-red-500 text-white flex items-center justify-center shrink-0">
            <span className="w-3.5 h-3.5 flex items-center justify-center font-black text-[12px]">■</span>
          </button>
        ) : (
          <button onClick={() => { send(); dismissKeyboardOnMobile(composerRef.current); }} disabled={!input.trim() && files.length === 0} className="w-9 h-9 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white flex items-center justify-center shrink-0">
            <Send className="w-4 h-4" />
          </button>
        )}
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
              </>
            ) : paywall === 'login' ? (
              <>
                <div className="mx-auto mb-3 w-12 h-12 rounded-full bg-indigo-500/15 text-indigo-300 flex items-center justify-center"><LogIn className="w-6 h-6" /></div>
                <h3 className="font-bold text-white mb-1">Sign in to continue</h3>
                <p className="text-sm text-[#8b949e]">Professionals need a free account. Sign in to get {pass?.freeDailyLimit ?? 50} free messages every day.</p>
              </>
            ) : (
              <>
                {/* Was a "Get the Professional Pass — ₹99/month" checkout. The Pass is gone (admin
                    2026-08-10), so this card no longer sells anything: it states the allowance, says
                    when it returns, and offers the one action that genuinely helps today. */}
                <div className="mx-auto mb-3 w-12 h-12 rounded-full bg-amber-500/15 text-amber-300 flex items-center justify-center"><Clock className="w-6 h-6" /></div>
                <h3 className="font-bold text-white mb-1">That's today's free messages</h3>
                <p className="text-sm text-[#8b949e] mb-4">
                  You've used all {pass?.freeDailyLimit ?? 50} of them. They come back tomorrow — or add credit and carry on now, paying only for what you use.
                </p>
                <button
                  onClick={() => window.dispatchEvent(new CustomEvent('navbharat:navigate', { detail: { view: 'billing' } }))}
                  className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold flex items-center justify-center gap-2"
                >
                  <Wallet className="w-4 h-4" /> Add credit
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
