import { useEffect, useRef, useState } from 'react';
import { Send, Bot } from 'lucide-react';
import { TirangaLoader } from '../ui/TirangaLoader';
import ReactMarkdown from 'react-markdown';
import { CHAT_MARKDOWN_PLUGINS } from '../../lib/chatMarkdown';
import { useAgentV3Build } from '../../hooks/useAgentV3Build';
import { getAgentV3SessionId, getAgentV3WorkspaceId } from '../../lib/agentv3Workspace';

interface MiniMsg {
  role: 'user' | 'agent';
  text: string;
  ts: number;
}

/**
 * Code Studio's AI chat — literally NavBharatAI Pro (AgentV3), not a separate chat AI. Root-caused
 * 2026-07-01 (admin request, "ek hi body ke alag organs"): this used to be wired to the Free-tier chat
 * endpoint, which cannot read or write files at all (server-side it's explicitly told never to
 * generate code) — so it could only talk ABOUT a file the user had open, never act on one.
 *
 * This runs its OWN `useAgentV3Build()` instance (React hooks are per-component-instance, and this
 * codebase has no cross-component live-state store for v5.0), but targets the EXACT SAME session as
 * the main v5.0 panel via `getAgentV3SessionId`/`getAgentV3WorkspaceId` — the same localStorage-backed
 * id the panel itself persists — and reuses the resume()/subscribeLive() cross-device-mirror machinery
 * (built for "two viewers, one live build") to attach to a build already running for that session. A
 * message sent here reaches the SAME server-side conversation/memory the v5.0 panel uses, so any file
 * it writes appears everywhere else (Files, Code Studio's own editor, Git) exactly like a v5.0-panel
 * edit does — this widget is a second window onto the same brain, not a separate agent.
 */
export function AgentV3MiniChat({ userId, email, prefill }: { userId?: string; email?: string; prefill?: { text: string; nonce: number } }) {
  const { state, running, start, checkRunning, resume, loadConversation, reset, serverBuildRunning } = useAgentV3Build();
  const [userMsgs, setUserMsgs] = useState<MiniMsg[]>([]);
  const [input, setInput] = useState('');
  /**
   * Text handed in from another surface — today the preview's Tag Mode ("edit THIS element") and the
   * error overlay's Fix Bug button. It APPENDS to whatever is already typed rather than replacing it,
   * because clobbering a half-written message to insert an element reference would lose the user's
   * words at the exact moment they were describing the change they wanted.
   */
  useEffect(() => {
    const text = prefill?.text;
    if (!text) return;
    setInput((cur) => (cur ? (cur.endsWith(' ') ? cur : cur + ' ') + text : text));
    // Keyed on the NONCE, not the text: tapping the same element twice must register both times, and
    // the nonce keeps that out of the message itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.nonce]);
  const loadedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Resolve the session id ONCE per userId (not on every render) — getAgentV3SessionId does real
  // localStorage I/O, so re-reading it on every render is wasted work for no benefit (once persisted,
  // every subsequent read returns the same value anyway).
  const idsRef = useRef<{ uid: string; sessionId: string } | null>(null);
  if (userId && idsRef.current?.uid !== userId) {
    idsRef.current = { uid: userId, sessionId: getAgentV3SessionId(userId) };
  }
  const sessionId = idsRef.current && idsRef.current.uid === userId ? idsRef.current.sessionId : '';
  const workspaceId = userId && sessionId ? getAgentV3WorkspaceId(userId) : undefined;

  // Load this session's saved thread once, and check whether a build is already running for it (a
  // build started from the main v5.0 panel moments ago, e.g.) so this mini-chat attaches to it too.
  //
  // loadConversation() has no "find by workspaceId" option — it can only fetch a specific conversation
  // by its OWN id (a random UUID unrelated to sessionId) or "the account's most recent". So we fetch
  // "most recent" and only KEEP it if its workspaceId actually matches this session — otherwise
  // reset() immediately to discard the mismatched state loadConversation() already applied. This never
  // risks showing a DIFFERENT session's conversation; the honest fallback is simply an empty thread.
  useEffect(() => {
    if (!userId || loadedRef.current) return;
    loadedRef.current = true;
    void (async () => {
      const restored = await loadConversation({ userId, email });
      if (restored && restored.workspaceId === workspaceId) {
        setUserMsgs(restored.messages.map((m) => ({ role: 'user', text: m.text, ts: m.ts })));
      } else if (restored) {
        reset(); // discard the mismatched conversation loadConversation() already applied to state
      }
      await checkRunning({ userId, email, workspaceId });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Auto-attach to a build detected running for THIS session (workspace-scoped — see agentv3.ts
  // isBuildRunningForWorkspace — so this never accidentally shows a DIFFERENT session's build).
  useEffect(() => {
    if (serverBuildRunning && !running) void resume({ userId, email, workspaceId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverBuildRunning, running]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [state.narration.length, userMsgs.length, running]);

  const send = () => {
    const text = input.trim();
    if (!text || running || !userId || !sessionId) return;
    setUserMsgs((cur) => [...cur, { role: 'user', text, ts: Date.now() }]);
    setInput('');
    void start(text, { userId, email, sessionId });
  };

  const convo: MiniMsg[] = [
    ...userMsgs,
    ...state.narration.map((n) => ({ role: 'agent' as const, text: n.text, ts: n.ts })),
  ].sort((a, b) => a.ts - b.ts);

  if (!userId) {
    return (
      <div className="h-full flex items-center justify-center p-6 text-center">
        <p className="text-xs text-faint">Sign in to chat with NavBharatAI Pro right here in Code Studio.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-surface">
      <div className="px-3 py-2.5 border-b border-line flex items-center gap-2 shrink-0">
        <Bot className="w-3.5 h-3.5 text-accent-text" />
        <span className="text-[10px] font-black uppercase tracking-widest text-accent-text">NavBharatAI Pro</span>
        <span className="text-[9px] text-faint">— same project, same session</span>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
        {convo.length === 0 && !running && (
          <div className="text-xs text-faint leading-relaxed px-1">
            Ask NavBharatAI Pro to explain, edit, or extend this project — it can read and write your files here,
            exactly like the main NavBharatAI Pro chat.
          </div>
        )}
        {convo.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
            <div
              className={`inline-block max-w-[92%] px-3 py-2 rounded-2xl text-[13px] leading-relaxed text-left ${
                m.role === 'user' ? 'bg-indigo-600 text-on-accent' : 'bg-raised text-body'
              }`}
            >
              {m.role === 'agent' ? (
                <div className="prose prose-invert prose-sm max-w-none [&_p]:my-1">
                  <ReactMarkdown remarkPlugins={CHAT_MARKDOWN_PLUGINS}>{m.text}</ReactMarkdown>
                </div>
              ) : (
                m.text
              )}
            </div>
          </div>
        ))}
        {running && (
          <div className="flex items-center gap-2 text-xs text-faint px-1">
            <TirangaLoader className="w-3.5 h-3.5" /> Working…
          </div>
        )}
      </div>
      <div className="p-3 border-t border-line flex items-center gap-2 shrink-0">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          disabled={running}
          placeholder="Message NavBharatAI Pro…"
          className="flex-1 bg-card border border-line rounded-lg px-3 py-2 text-sm text-ink placeholder-faint disabled:opacity-50 focus:outline-none focus:border-indigo-500/50"
        />
        <button
          onClick={send}
          disabled={running || !input.trim()}
          className="p-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-on-accent transition-colors"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
