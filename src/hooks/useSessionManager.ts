// useSessionManager — opening, deleting and starting chats (extracted from App.tsx in P3.1).
//
// Owns `openSession` (open a saved conversation by its id — the device's copy first, then the cloud —
// including the NavBharatAI Pro resume branch), `deleteSession` (delete a chat locally and in the
// cloud) and `startNewChat`. Everything from the rest of the app is injected via deps.
//
// 🔴 THE CHAT-ID SYSTEM IS GONE (admin 2026-09-28: "yeh chat id wala system band karo"). A chat used to
// be restored by typing a "Universal Chat ID" into a box — an identifier no screen ever showed, so the
// box could only ever fail. Chats are opened from History by tapping them, the way ChatGPT, Claude and
// Grok work, and opening one shows the conversation exactly as it was (see lib/chatHistory.ts).

import { doc, getDoc, deleteDoc } from 'firebase/firestore';
import type { User as FirebaseUser } from 'firebase/auth';
import type { Message, ChatSession, ViewType } from '../types';
import { authedHeaders } from '../lib/authHeaders';
import { db } from '../lib/firebase';
import { safeLS } from '../lib/localStorageSafe';
import { generateSmartHeuristicSummary, asMessageArray } from '../lib/chatUtils';
import { openedTranscript } from '../lib/chatHistory';
import { resolveSessionSurface, sessionOwnerOf } from '../lib/sessionRouting';
import { caseIdFromDocId } from '../lib/sdaCaseStore';

export interface SessionManagerDeps {
  // values read
  sessions: any[];
  user: FirebaseUser | null;
  currentSessionId: string;
  // ref (shared with App's toggleTab new-chat-bump effect — must NOT be hook-owned)
  v3ResumeInFlightRef: { current: boolean };
  // setters (typed loosely — App passes the real ones; assignable via contravariance)
  setV3Resume: (v: any) => void;
  setCurrentSessionId: (v: any) => void;
  setFiles: (v: any) => void;
  setSessions: (v: any) => void;
  setSdaResetKey: (v: any) => void;
  /** Tells SDAChat WHICH case to open — see sdaCaseStore.caseIdFromDocId. */
  setSdaOpenCaseId: (v: string | undefined) => void;
  setCurrentProSessionId: (v: any) => void;
  setProMessages: (v: any) => void;
  setMessages: (v: any) => void;
  setGeneratedCode: (v: any) => void;
  setHasGeneratedCode: (v: any) => void;
  setActiveAgent: (v: any) => void;
  setErrorContext: (v: any) => void;
  setIsAppBuilt: (v: any) => void;
  // functions
  toggleTab: (view: any, pushToHistory?: boolean) => void;
  addToast: (message: string, type?: any) => void;
  addLog: (message: string, level?: any) => void;
  /**
   * The opening messages for a brand-new free chat — supplied by App, which owns the language choice.
   *
   * 🔒 PASSED IN RATHER THAN REBUILT HERE. `startNewChat` used to hardcode its OWN copy of the welcome
   * line, so it (a) would drift from App's the moment either changed, and (b) skipped the language
   * PICKER that a user who has not chosen a language yet must see — pressing New chat silently put
   * them back into English. One source, both paths.
   */
  initialFreeChatMessages: () => Message[];
}

export function useSessionManager(deps: SessionManagerDeps) {
  const {
    sessions, user, currentSessionId,
    v3ResumeInFlightRef,
    setV3Resume, setCurrentSessionId, setFiles, setSessions, setSdaResetKey, setCurrentProSessionId,
    setSdaOpenCaseId,
    setProMessages, setMessages, setGeneratedCode, setHasGeneratedCode, setActiveAgent, setErrorContext,
    setIsAppBuilt,
    toggleTab, addToast, addLog, initialFreeChatMessages,
  } = deps;

  /**
   * Open a saved conversation by its session id — what tapping a History row does.
   * The device's copy is read first (instant, and it may hold turns the cloud has not received yet);
   * the cloud is asked only when this device has never seen the chat (it was started elsewhere).
   */
  const openSession = async (sessionId: string): Promise<boolean> => {
    let targetSession = sessions.find(s => s.id === sessionId);

    if (!targetSession && user && sessionId) {
      try {
        const snap = await getDoc(doc(db, 'chat_sessions', sessionId));
        const docData = snap.exists() ? snap.data() : null;
        // The security rules already refuse another account's document; this states it again at the
        // one place a wrong owner would matter, so a rule change can never open someone else's chat.
        if (docData && docData.userId === user.uid) {
          targetSession = {
            id: docData.id || sessionId,
            title: docData.title,
            customTitle: docData.customTitle || undefined,
            messages: docData.messages || [],
            files: docData.files || {},
            lastUpdated: docData.lastUpdated,
            mode: docData.mode,
            agent: docData.current_agent || docData.original_agent,
            isPinned: docData.isPinned || false,
            originalAgent: docData.original_agent,
            currentAgent: docData.current_agent,
            memorySummary: docData.memory_summary || '',
            editLog: docData.edit_log || [],
            restoredMessages: asMessageArray(docData.restoredMessages),
            meta: { tab: docData.tab }
          } as any;
        }
      } catch (err) {
        console.error('Error fetching session from Firestore:', err);
        addToast('Could not open this chat right now. Please try again.', 'error');
        return false;
      }
    }

    if (!targetSession) {
      // F4: inform user when session is not found
      addToast('This chat could not be found. It may have been deleted.', 'error');
      return false;
    }

    // v5.0 (engine_builder) sessions resume INSIDE v5.0 — adopt the saved sessionId
    // (backend continues with the same workspace/memory, best-effort) and restore the
    // saved thread, then open the v5.0 tab. Other sessions fall through to the regular
    // chat restore below.
    const isV3Session = targetSession.agent === 'agentv3'
      || (targetSession as any).originalAgent === 'agentv3'
      || (targetSession as any).currentAgent === 'agentv3'
      || (targetSession as any).meta?.tab === 'engine_builder'
      || (typeof targetSession.id === 'string' && targetSession.id.startsWith('v3_'));
    if (isV3Session) {
      const sid = (targetSession.id || '').replace(/^v3_/, '') || targetSession.id;
      const msgs = ((targetSession.messages || []) as any[]).map((mm) => ({
        role: (mm.sender === 'user' || mm.role === 'user') ? 'user' as const : 'agent' as const,
        text: mm.text ?? mm.content ?? '',
        ts: mm.timestamp ? (Date.parse(mm.timestamp) || Date.now()) : (mm.ts ?? Date.now()),
      }));
      setV3Resume({ sessionId: sid, messages: msgs, nonce: Date.now() });
      setCurrentSessionId(targetSession.id);
      v3ResumeInFlightRef.current = true; // resume, NOT a fresh open — suppress the new-chat bump so
                                          // toggleTab doesn't start a blank session over the resumed one
      toggleTab('nbi_pro_chat'); // v5.0 now lives in nbi_pro_chat
      addToast('Resumed NavBharatAI Pro session.', 'success');
      return true;
    }

    // Set matching workspace file config
    if (targetSession.files && Object.keys(targetSession.files).length > 0) {
      setFiles(targetSession.files);
    }
    
    const targetAgent = targetSession.agent || 'navbharatai';

    // THE CONVERSATION AS IT WAS — one thread, in order, nothing collapsed, nothing announced. The old
    // system split everything before a restore into `restoredMessages` and added a canned "Previous
    // workspace context has been successfully loaded" line; both are folded away here.
    const transcript = openedTranscript<Message>(targetSession);

    // A long thread keeps a short summary for the AI's context (the request sends the last 40 turns);
    // a summary already saved is kept as it is.
    let memSummary = targetSession.memorySummary || '';
    if (!memSummary && transcript.length > 40) {
      memSummary = generateSmartHeuristicSummary(transcript);
    }

    // 🔴 A RESTORE MUST NOT REWRITE WHOSE SESSION THIS IS (admin 2026-09-22, the history leak).
    // Opening a conversation is not a change of ownership, so a non-free session keeps what it had.
    const restoredOwner = sessionOwnerOf(targetSession as unknown as Record<string, unknown>);
    // `lastUpdated` is deliberately NOT touched: opening a chat is reading it, and a chat you only
    // looked at must not jump to the top of History. The next message you send moves it.
    const updatedSession: ChatSession = {
      ...targetSession,
      currentAgent: restoredOwner === 'free' ? 'navbharatai' : (targetSession.currentAgent || targetAgent),
      agent: targetAgent,
      messages: transcript,
      restoredMessages: [],
      memorySummary: memSummary,
    };

    setSessions(prev => {
      const idx = prev.findIndex(s => s.id === updatedSession.id);
      let next = [...prev];
      if (idx > -1) {
        next[idx] = updatedSession;
      } else {
        next = [updatedSession, ...next];
      }
      safeLS('navbharat_sessions', JSON.stringify(next));
      return next;
    });

    // Detect target tab — use saved tab field first, then broad agent/mode detection
    const savedTab = (targetSession as any).meta?.tab as ViewType | undefined;
    const { isProSession, isSdaSession, targetTab } = resolveSessionSurface(targetAgent, savedTab);

    // Route restored content into the state belonging to the session's actual
    // surface — Free/Pro/SDA each own a separate message state, so dumping
    // everything into the Free-chat state regardless of origin was the bug.
    if (isSdaSession) {
      // Open the case the doctor actually tapped. SDA used to persist itself under ONE userId-keyed
      // document, so "remount and let it re-fetch its own latest content" was the only thing a restore
      // could mean — there was only ever one case to fetch. Now each case owns its document, so the
      // row's id names the case, and the remount opens THAT patient rather than the most recent one.
      // A legacy row carries no case id and reports null, which correctly means "continue whatever
      // case that row is bound to" (see sdaCaseStore.resolveCaseDoc).
      setSdaOpenCaseId(caseIdFromDocId(targetSession.id, user?.uid || '') || undefined);
      setSdaResetKey(k => k + 1);
    } else if (isProSession) {
      setCurrentProSessionId(targetSession.id);
      setProMessages(transcript);
    } else {
      setCurrentSessionId(targetSession.id);
      setMessages(transcript);
    }

    // Restore generated code from session files if available
    if (targetSession.files && Object.keys(targetSession.files).length > 0) {
      const htmlFile = Object.entries(targetSession.files as Record<string, string>)
        .find(([name]) => name.endsWith('.html'));
      if (htmlFile) {
        setGeneratedCode(htmlFile[1]);
        setHasGeneratedCode(true);
      }
    }

    // Navigate to the correct chat tab — never open preview
    toggleTab(targetTab);

    // Restore activeAgent to match the session. A LEGACY session stored against the removed
    // Vishwakarma agent resolves to a Pro session (see resolveSessionSurface), so it opens as
    // NavBharatAI Pro rather than re-arming an agent id nothing answers any more.
    if (isProSession) setActiveAgent('navbharatai-pro');
    else setActiveAgent('navbharatai');

    addLog(`Opened chat: ${targetSession.customTitle || targetSession.title || sessionId}`, 'info');
    return true;
  };

  const deleteSession = async (id: string) => {
    setSessions(prev => {
      const next = prev.filter(s => s.id !== id);
      safeLS('navbharat_sessions', JSON.stringify(next));
      return next;
    });
    if (user) {
      try {
        await deleteDoc(doc(db, 'chat_sessions', id));
      } catch (err) {
        console.error('Error deleting session from Firestore:', err);
      }
      // A v5.0 session's transcript lives in the SERVER conversation store (single source of
      // truth) — deleting only the chat_sessions metadata row would leave the real record behind,
      // still listed inside the v5.0 History menu. The server resolves the v3_ id to its stored
      // record(s) and removes them; owner-checked server-side. Best-effort.
      if (id.startsWith('v3_')) {
        try {
          await fetch(`/api/agentv3/conversations/${encodeURIComponent(id)}?userId=${encodeURIComponent(user.uid)}`, {
            method: 'DELETE',
            headers: await authedHeaders(),
          });
        } catch { /* best-effort — metadata row is already gone */ }
      }
    }
    if (currentSessionId === id) {
      startNewChat();
    }
  };

  const startNewChat = () => {
    const newId = Date.now().toString();
    
    setCurrentSessionId(newId);
    // The SAME opening App uses for a fresh chat — so a user who has not picked a language still gets
    // the picker, and the welcome text cannot drift from the one App shows on first load.
    //
    // ⚠️ This function once carried THREE hardcoded copies of that welcome line; there is now one.
    const opening = initialFreeChatMessages();
    setMessages(opening);

    setErrorContext(null);
    setHasGeneratedCode(false);
    setIsAppBuilt(false);
    // A new chat has NO files — `{}`, never placeholder ones (admin 2026-09-23). Three "New Sandbox"
    // files used to be seeded here AND saved with the blank session, so Code Studio showed files that
    // do not exist, and restoring this blank chat from History found that index.html and set
    // hasGeneratedCode(true) — a conversation with no app came back looking like one. Same fix as the
    // initial state in App.tsx; see the note there.
    setFiles({});
    
    // NOTHING IS SAVED YET. A new chat becomes a History entry when its first message is sent (the
    // autosave in App.tsx creates it then). Saving the blank chat here is what filled History with
    // "New Conversation" rows holding only the welcome line — a list of chats nobody ever had.

    toggleTab('nbi_chat');
  };
  return { openSession, deleteSession, startNewChat };
}
