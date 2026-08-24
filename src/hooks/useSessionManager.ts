// useSessionManager — the session-restore / session-management slice, lifted out of the App.tsx God
// component (P3.1, behavior-preserving). Owns handleRestoreUci (restore a chat by its UCI/id — local
// cache then Firestore, with the v5.0-session resume branch), handleRestoreByUci (restore from the
// typed UCI input), deleteSession (delete a saved session locally + in Firestore), and startNewChat.
// Code moved BYTE-IDENTICAL — pure relocation, zero logic change. Everything from the rest of the app
// is injected via deps, and App.tsx destructures the SAME identifiers back, so every call site (the
// history/pro-chat panels, the Continue modal) is unchanged.

import { collection, query, where, getDocs, doc, deleteDoc } from 'firebase/firestore';
import type { User as FirebaseUser } from 'firebase/auth';
import type { Message, ChatSession, ViewType } from '../types';
import { authedHeaders } from '../lib/authHeaders';
import { db } from '../lib/firebase';
import { safeLS } from '../lib/localStorageSafe';
import { generateUCI, getRandomElement, generateSmartHeuristicSummary, dedupAndSortMessages, asMessageArray } from '../lib/chatUtils';
import { pickGreetingForAgent } from '../lib/agentGreetings';
import { resolveSessionSurface } from '../lib/sessionRouting';

export interface SessionManagerDeps {
  // values read
  sessions: any[];
  user: FirebaseUser | null;
  currentSessionId: string;
  resumeUciInputState: any;
  mode: any;
  // ref (shared with App's toggleTab new-chat-bump effect — must NOT be hook-owned)
  v3ResumeInFlightRef: { current: boolean };
  // setters (typed loosely — App passes the real ones; assignable via contravariance)
  setV3Resume: (v: any) => void;
  setCurrentSessionId: (v: any) => void;
  setFiles: (v: any) => void;
  setSessions: (v: any) => void;
  setSdaResetKey: (v: any) => void;
  setCurrentProSessionId: (v: any) => void;
  setProMessages: (v: any) => void;
  setMessages: (v: any) => void;
  setGeneratedCode: (v: any) => void;
  setHasGeneratedCode: (v: any) => void;
  setActiveAgent: (v: any) => void;
  setErrorContext: (v: any) => void;
  setIsAppBuilt: (v: any) => void;
  setRestoreUciError: (v: any) => void;
  setIsRestoringUci: (v: any) => void;
  setResumeUciInputState: (v: any) => void;
  setShowContinueModal: (v: any) => void;
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
    sessions, user, currentSessionId, resumeUciInputState, mode,
    v3ResumeInFlightRef,
    setV3Resume, setCurrentSessionId, setFiles, setSessions, setSdaResetKey, setCurrentProSessionId,
    setProMessages, setMessages, setGeneratedCode, setHasGeneratedCode, setActiveAgent, setErrorContext,
    setIsAppBuilt, setRestoreUciError, setIsRestoringUci, setResumeUciInputState, setShowContinueModal,
    toggleTab, addToast, addLog, initialFreeChatMessages,
  } = deps;

  const handleRestoreUci = async (uciToFind: string): Promise<boolean> => {
    let targetSession = sessions.find(s => s.uci === uciToFind || s.id === uciToFind);
    
    // Search in Firestore if authenticated & not found in local cache
    if (!targetSession && user) {
      try {
        const q = query(
          collection(db, 'chat_sessions'), 
          where('uci', '==', uciToFind),
          where('userId', '==', user.uid)
        );
        const querySnap = await getDocs(q);
        if (!querySnap.empty) {
          const docData = querySnap.docs[0].data();
          targetSession = {
            id: docData.id,
            title: docData.title,
            messages: docData.messages || [],
            files: docData.files || {},
            lastUpdated: docData.lastUpdated,
            mode: docData.mode,
            agent: docData.current_agent || docData.original_agent,
            isPinned: docData.isPinned || false,
            uci: docData.uci,
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
        // F4: surface Firestore restore failures to the user
        addToast('Failed to load session from cloud. Please try again.', 'error');
      }
    }

    if (!targetSession) {
      // F4: inform user when session is not found
      addToast('Session not found. It may have been deleted or is from a different account.', 'error');
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
      addToast('Resumed v5.0 session.', 'success');
      return true;
    }

    // Set matching workspace file config
    if (targetSession.files && Object.keys(targetSession.files).length > 0) {
      setFiles(targetSession.files);
    }
    
    const targetAgent = targetSession.agent || 'navbharatai';
    const isVishwakarma = targetAgent.startsWith('vishwakarma');
    
    // Build combined list of old messages to collapse (dedup by id + sort by time)
    const uniqueHistory = dedupAndSortMessages([...asMessageArray(targetSession.restoredMessages), ...asMessageArray(targetSession.messages)]);

    let memSummary = targetSession.memorySummary || '';
    if (!memSummary && uniqueHistory.length > 0) {
      memSummary = generateSmartHeuristicSummary(uniqueHistory);
    }
    
    const greetingText = pickGreetingForAgent(targetAgent, getRandomElement);
    
    const continuationGreeting: Message = {
      id: `continuation-greeting-${Date.now()}`,
      text: `${greetingText}\n\n*Previous workspace context has been successfully loaded. We are continuing our dynamic session with total context memory.*`,
      sender: 'ai',
      timestamp: new Date().toISOString(),
      modelUsed: isVishwakarma ? targetAgent.replace('_', ' ').toUpperCase() : 'navBharatAI Cognitive Layer'
    };
    
    const updatedSession: ChatSession = {
      ...targetSession,
      currentAgent: isVishwakarma ? targetAgent : 'navbharatai',
      agent: targetAgent,
      messages: [continuationGreeting],
      restoredMessages: uniqueHistory,
      memorySummary: memSummary,
      lastUpdated: new Date().toISOString()
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
    const isVishwakarmaAgent = targetAgent.startsWith('vishwakarma');
    const { isProSession, isAscSession, isSdaSession, targetTab } = resolveSessionSurface(targetAgent, savedTab);

    // Show the last 40 messages from previous conversation so user can scroll up and see context,
    // then append the continuation greeting at the bottom.
    const visibleHistory = uniqueHistory.slice(-40);

    // Route restored content into the state belonging to the session's actual
    // surface — Free/Pro/SDA each own a separate message state, so dumping
    // everything into the Free-chat state regardless of origin was the bug.
    if (isSdaSession) {
      // SDA persists itself via a userId-keyed Firestore doc (see SDAChat.tsx);
      // remounting makes it re-fetch its own latest content.
      setSdaResetKey(k => k + 1);
    } else if (isProSession) {
      setCurrentProSessionId(targetSession.id);
      setProMessages([...visibleHistory, continuationGreeting]);
    } else {
      setCurrentSessionId(targetSession.id);
      setMessages([...visibleHistory, continuationGreeting]);
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

    // Restore activeAgent to match the session
    if (isVishwakarmaAgent || isAscSession) setActiveAgent(targetAgent);
    else if (isProSession) setActiveAgent('navbharatai-pro');
    else setActiveAgent('navbharatai');

    addLog(`UCI resumed: ${uciToFind}`, 'info');
    return true;
  };

  const handleRestoreByUci = async () => {
    if (!user) {
      setRestoreUciError('CUI / Universal Chat ID restoration requires a logged-in session. Please login first.');
      return;
    }
    if (!resumeUciInputState.trim()) return;
    setIsRestoringUci(true);
    setRestoreUciError('');
    try {
      const success = await handleRestoreUci(resumeUciInputState.trim());
      if (success) {
        setResumeUciInputState('');
        setShowContinueModal(false);
      } else {
        setRestoreUciError('Universal Chat ID not found or unauthorized access.');
      }
    } catch (err: any) {
      setRestoreUciError(err.message || 'Error restoring chat.');
    } finally {
      setIsRestoringUci(false);
    }
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
    const newUci = user ? generateUCI() : '';
    
    setCurrentSessionId(newId);
    // The SAME opening App uses for a fresh chat — so a user who has not picked a language still gets
    // the picker, and the welcome text cannot drift from the one App shows on first load.
    //
    // ⚠️ Computed ONCE and used for both the on-screen transcript and the saved session below. This
    // function previously carried THREE hardcoded copies of that welcome line (two here, one in the
    // saved record), which is how the saved session could describe a conversation that never happened.
    const opening = initialFreeChatMessages();
    setMessages(opening);

    setErrorContext(null);
    setHasGeneratedCode(false);
    setIsAppBuilt(false);
    setFiles({
      'index.html': `<!DOCTYPE html><html><body><h1>New Sandbox</h1></body></html>`,
      'script.js': 'console.log("Ready");',
      'style.css': 'body { background: #0d1117; color: white; }'
    });
    
    // Initial save of the new clean session
    const initSession: ChatSession = {
      id: newId,
      title: 'New Conversation',
      messages: opening,
      files: {
        'index.html': `<!DOCTYPE html><html><body><h1>New Sandbox</h1></body></html>`,
        'script.js': 'console.log("Ready");',
        'style.css': 'body { background: #0d1117; color: white; }'
      },
      lastUpdated: new Date().toISOString(),
      isPinned: false,
      mode: mode,
      agent: 'navbharatai',
      uci: newUci,
      originalAgent: 'navbharatai',
      currentAgent: 'navbharatai',
      memorySummary: '',
      restoredMessages: []
    };

    if (user) {
      setSessions(prev => {
        const next = [initSession, ...prev];
        safeLS('navbharat_sessions', JSON.stringify(next));
        return next;
      });
    }

    toggleTab('nbi_chat');
  };
  return { handleRestoreUci, handleRestoreByUci, deleteSession, startNewChat };
}
