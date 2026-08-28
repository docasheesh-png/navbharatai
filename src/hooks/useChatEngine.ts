// useChatEngine — the free (NBI) chat engine, lifted out of the App.tsx God component (P3.1, behavior-
// preserving). Owns the send pipeline: handleSendForTab (the core turn handler — intent routing, GitHub
// PAT/repo capture, attachment encoding, streaming reply, build-mode code extraction) and handleSend
// (the 'nbi_chat' wrapper), plus their private helpers callGeminiFrontend, runFrontendPipeline,
// readFileRaw, downscaleImage, filesToBase64. Code moved BYTE-IDENTICAL — pure relocation, zero logic
// change. Everything the engine reads from the rest of the app is injected via deps, and App.tsx
// destructures the SAME handleSendForTab/handleSend identifiers back, so every call site is unchanged.

import axios from 'axios';
import { useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import type { Message, ErrorContext, ViewType, FileSystem } from '../types';
import { classifyError } from '../lib/appUtils';
import { asMessageArray } from '../lib/chatUtils';
import { previewAttachment } from '../lib/attachmentPreview';
import { trackEvent } from '../lib/analytics';
import { auth } from '../lib/firebase';
import { rememberGithubOwner } from '../lib/githubTokenStore';
import { parseVialTeaching } from '../lib/neonatalDosing';
import { loadVials, saveVial } from '../lib/vialMemory';
export interface ChatEngineDeps {
  // values read
  input: string;
  messages: Message[];
  isLoading: boolean;
  sessions: any[];
  currentSessionId: string;
  activeAgent: string;
  mode: string;
  activeView: ViewType;
  activeIntent: string;
  errorContext: ErrorContext | null;
  preferredLanguage: any;
  user: FirebaseUser | null;
  keys: any;
  invalidKeys: any;
  selectedModel: string;
  apnapanProfile: any;
  hasGeneratedCode: boolean;
  generatedCode: string;
  pendingGHEdit: any;
  githubToken: string | null;
  files: FileSystem;
  FREE_DAILY_MESSAGES: number;
  isFreeLimitReached: boolean;
  // setters
  setMessages: (v: Message[] | ((p: Message[]) => Message[])) => void;
  setInput: Dispatch<SetStateAction<string>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setActiveIntent: (v: any) => void;
  setErrorContext: (v: any) => void;
  setIsSearching: Dispatch<SetStateAction<boolean>>;
  setPreferredLanguage: (v: any) => void;
  setMode: (v: any) => void;
  setShowAuth: Dispatch<SetStateAction<boolean>>;
  setUser: (v: any) => void;
  setShowVishwakarmaUnlockModal: Dispatch<SetStateAction<boolean>>;
  setGithubToken: (v: any) => void;
  setGithubRepoContext: (v: any) => void;
  setFiles: Dispatch<SetStateAction<FileSystem>>;
  setHasGeneratedCode: Dispatch<SetStateAction<boolean>>;
  setIsDeployed: Dispatch<SetStateAction<boolean>>;
  setIsAppBuilt: Dispatch<SetStateAction<boolean>>;
  // functions
  addLog: (message: string, level?: any) => void;
  addToast: (message: string, type?: any) => void;
  incrementDailyUsage: (type: any) => void;
  handleGHConfirmPush: (...args: any[]) => any;
  learnFromMessage: (...args: any[]) => any;
  updatePreview: (files: any) => void;
}

export function useChatEngine(deps: ChatEngineDeps) {
  const {
    input, messages, isLoading, sessions, currentSessionId, activeAgent, mode, activeView, activeIntent,
    errorContext, preferredLanguage, user, keys, invalidKeys, selectedModel, apnapanProfile,
    hasGeneratedCode, generatedCode, pendingGHEdit, githubToken, files, FREE_DAILY_MESSAGES, isFreeLimitReached,
    setMessages, setInput, setIsLoading, setActiveIntent, setErrorContext, setIsSearching, setPreferredLanguage,
    setMode, setShowAuth, setUser, setShowVishwakarmaUnlockModal, setGithubToken, setGithubRepoContext,
    setFiles, setHasGeneratedCode, setIsDeployed, setIsAppBuilt,
    addLog, addToast, incrementDailyUsage, handleGHConfirmPush, learnFromMessage, updatePreview,
  } = deps;

  // STOP support (admin 2026-08-13: "koi galat search rukti nahi"). Every AI here streams a reply over one
  // fetch; without a user-controllable AbortController the only way to end it was the 90s timeout. These
  // refs give the UI a real Stop: `abortRef` aborts the in-flight fetch, and `stoppedRef` marks it a
  // DELIBERATE stop so the catch keeps the partial reply instead of showing a scary "connection failed".
  const abortRef = useRef<AbortController | null>(null);
  const stoppedRef = useRef(false);

  const callGeminiFrontend = async (
    prompt: string, 
    enableSearch: boolean = false, 
    history: Message[] = [], 
    intent: string = 'general', 
    target?: string,
    agent: string = 'navbharatai',
    mode: string = 'chat'
  ): Promise<string> => {
    let endpoint = '/api/chat/navbharatai';

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await axios.post(endpoint, {
        message: prompt,
        preferredModel: selectedModel === 'auto' ? 'gemini' : selectedModel,
        history: history,
        mode: mode,
        intent: intent,
        target: target,
        files: files,
        agent: agent
      }, {
        signal: controller.signal,
        headers: {
          'x-gemini-key': keys.gemini,
          'x-groq-key': keys.groq,
          'x-openai-key': keys.openai,
          'x-claude-key': keys.claude,
          'x-deepseek-key': keys.deepseek,
          'x-openrouter-key': keys.openrouter,
          ...(user ? {
            'x-user-id': user.uid,
            'x-user-email': user.email || '',
            'x-user-name': user.displayName || 'NavBharat Client'
          } : {})
        }
      });
      
      clearTimeout(timeoutId);
      return response.data.reply;
    } catch (error: any) {
      clearTimeout(timeoutId);
      console.error("AI REQUEST FAILURE", error);

      if (axios.isCancel(error)) {
        throw new Error("AI response timeout. Server or AI may be overloaded.");
      }
      
      let errMsg = "AI request failed.";

      if (error.code === 'ERR_NETWORK' || error.message === 'Network Error') errMsg = "Network connection failed. Please check your internet or the backend availability.";
      else if (error.response?.status === 401) errMsg = "API key invalid or expired. Go to Settings → Secrets & API Keys to update your key.";
      else if (error.response?.status === 500) errMsg = "Backend runtime failure detected.";
      else if (error.response?.status === 403) errMsg = "AI permission/authentication failure detected.";
      else if (error.message.includes('failed to fetch')) errMsg = "Frontend could not reach backend service.";
      else if (error.message.includes('timeout')) errMsg = "Vertex AI inference timeout.";
      else errMsg = error.response?.data?.error || error.message || "Application runtime error detected.";

      if (error.response?.status === 402 || error.response?.data?.requirePass) {
        setShowVishwakarmaUnlockModal(true);
      }
      throw new Error(errMsg);
    }
  };

  const runFrontendPipeline = async (
    message: string, 
    enableSearch: boolean = false, 
    history: Message[] = [], 
    intent: string = 'general', 
    target?: string,
    agent: string = 'navbharatai',
    mode: string = 'chat'
  ): Promise<{ reply: string, model: string }> => {
    if (intent === 'security') {
        addLog('Security Auditor: Analyzing project architecture...', 'info');
    } else if (intent === 'github') {
        addLog('GitHub Core: Synchronizing repository data...', 'info');
    } else {
        addLog(enableSearch ? 'Accessing live knowledge banks...' : 'Generating your solution...', 'info');
    }
    
    const isFollowUp = history.length > 0;
    let promptWithContext = message;

    // 7.5 — Error-aware AI: detect console errors / stack traces in user message
    const ERROR_PATTERNS = [
      /uncaught (typeerror|referenceerror|syntaxerror|rangeerror)/i,
      /cannot read propert/i,
      /is not a function/i,
      /is not defined/i,
      /\bat line \d+/i,
      /error:/i,
      /failed to|could not load/i,
    ];
    const isErrorMessage = ERROR_PATTERNS.some(p => p.test(message));

    // 7.3 — Intent Detection: classify user request type
    const detectIntent = (msg: string): 'fix' | 'add' | 'edit' | 'create' | 'general' => {
      const m = msg.toLowerCase();
      if (isErrorMessage || /fix|bug|broken|nahi chal|error|crash|issue/.test(m)) return 'fix';
      if (/add|jod|include|insert|naya feature|new feature/.test(m)) return 'add';
      if (/change|update|modify|badlo|hatao|remove|replace/.test(m)) return 'edit';
      if (/build|create|banao|make|generate|design|write/.test(m)) return 'create';
      return 'general';
    };
    const detectedIntent = intent === 'general' ? detectIntent(message) : intent as any;

    // 7.6 — Component-level editing: detect component names (PascalCase words)
    const componentMatches = message.match(/\b([A-Z][a-zA-Z0-9]+(?:Component|Panel|Card|Modal|Button|Nav|Header|Footer|Sidebar|Form)?)\b/g);
    const mentionedComponents = componentMatches ? [...new Set(componentMatches)].slice(0, 3) : [];

    // Build intent-aware prefix
    const intentPrefix: Record<string, string> = {
      fix: '[FIX MODE] User is reporting a bug or error. Focus ONLY on the specific issue. Show the exact lines to change. Do not rewrite unrelated code.',
      add: '[ADD MODE] User wants to ADD a new feature to existing code. Integrate it cleanly without touching unrelated parts.',
      edit: '[EDIT MODE] User wants to MODIFY existing code. Make targeted changes only. Preserve all other functionality.',
      create: '[CREATE MODE] Build the requested app/component from scratch with clean, complete, production-ready code.',
      general: isFollowUp ? '[FOLLOW-UP] Respond directly without greeting.' : '',
    };

    if (intent === 'security') {
      promptWithContext = `[AUDITOR_ACTIVATION] Target: ${target || 'Current System'}\n\n${message}`;
    } else if (intent === 'github') {
      promptWithContext = `[GITHub_ACTIVATION] 🔗 navBharatAI GitHub Integration Activated\n\n${message}`;
    } else {
      const prefix = intentPrefix[detectedIntent] || '';
      const componentHint = mentionedComponents.length > 0
        ? `\n[COMPONENT FOCUS] User mentions: ${mentionedComponents.join(', ')} — target these specifically.`
        : '';
      const errorHint = isErrorMessage
        ? '\n[ERROR DETECTED] User has pasted a runtime error. Diagnose the root cause and provide the exact fix.'
        : '';
      if (prefix || componentHint || errorHint) {
        promptWithContext = `${prefix}${componentHint}${errorHint}\n\n${message}`;
      } else if (isFollowUp) {
        promptWithContext = `[Follow-up. No greeting needed. Respond in same language as user.]\n\n${message}`;
      }
    }

    // 7.1 — Project Memory: inject active session memory summary
    const activeSession = sessions.find(s => s.id === currentSessionId);
    if (activeSession?.memorySummary) {
      promptWithContext = `[SESSION MEMORY]\n${activeSession.memorySummary}\n\n---\n\n${promptWithContext}`;
    }

    // Switch to a single high-speed call for near-instant response
    const response = await callGeminiFrontend(promptWithContext, enableSearch || (intent === 'security'), history, intent, target, agent, mode);
    
    return { 
      reply: response, 
      model: intent === 'security' ? 'navBharat Security Auditor' : (enableSearch ? 'Navbharat (Live Search)' : 'Navbharat (Fast)') 
    };
  };

  const handleSendForTab = async (tabId: ViewType, overrideMessage?: string, files: File[] = []) => {
      // ... (existing logic, maybe add files to messages)
    const isNbi = tabId === 'nbi_chat';
    const currentInput = input;
    const currentMessages = messages;
    const activeSession = sessions.find(s => s.id === currentSessionId);
    const restoredMessages = asMessageArray(activeSession?.restoredMessages);
    const memorySummary = activeSession?.memorySummary || '';
    const historyForAPI = [...restoredMessages, ...asMessageArray(currentMessages)];
    const setMessagesForTab = setMessages;
    const setInputForTab = setInput;
    const setIsLoadingForTab = setIsLoading;
    const setIntentForTab = setActiveIntent;
    const currentAgent = activeAgent;
    const currentMode = mode;

    const msgInput = typeof overrideMessage === 'string' ? overrideMessage : '';
    if (!msgInput && !input.trim() && !errorContext?.lastInput && files.length === 0 || isLoading) return;

    const messageToSend = msgInput || currentInput.trim() || errorContext?.lastInput || '';

    // Language picker intercept — handle before sending to AI
    if (!preferredLanguage) {
      const langMap: Record<string, typeof preferredLanguage> = {
        'hindi': 'hindi', '🇮🇳 hindi': 'hindi', 'हिंदी': 'hindi',
        'hinglish': 'hinglish', '🔀 hinglish': 'hinglish',
        'english': 'english', '🇬🇧 english': 'english',
        'auto': 'auto', 'auto-detect': 'auto', '🌐 auto-detect': 'auto', '🌐 auto': 'auto',
      };
      const picked = langMap[messageToSend.toLowerCase().trim()];
      if (picked) {
        setPreferredLanguage(picked);
        setInputForTab('');
        const langLabels: Record<string, string> = {
          hindi: '🇮🇳 Hindi — main Hindi mein baat karunga!',
          hinglish: '🔀 Hinglish — Hindi + English mix mein baat karenge!',
          english: '🇬🇧 English — I\'ll respond in English!',
          auto: '🌐 Auto-detect — I\'ll match whatever language you write in!',
        };
        setMessagesForTab(prev => [
          ...prev.filter(m => m.id !== 'lang-picker'),
          { id: 'user-lang', text: messageToSend, sender: 'user', timestamp: new Date() },
          { id: 'lang-confirmed', text: `✅ Got it! ${langLabels[picked]}\n\nNavBharatAI is ready. How can I help you?`, sender: 'ai', timestamp: new Date(), modelUsed: 'navBharatAI' },
        ]);
        return;
      }
    }

    // 11.1 — Free tier daily limit enforcement (guests only)
    if (isFreeLimitReached) {
      addToast(`Free limit reached (${FREE_DAILY_MESSAGES} messages/day). Please sign in for unlimited access!`, 'warning');
      setShowAuth(true);
      return;
    }
    incrementDailyUsage('message');
    trackEvent('message_sent', { tab: tabId, agent: activeAgent, isGuest: !user });

    // Handle GitHub Push Confirmation
    if (pendingGHEdit && /push|confirm|yes|ha|kardo/i.test(messageToSend)) {
      handleGHConfirmPush();
      setInputForTab('');
      return;
    }

    // Capture GitHub PAT if mentioned (e.g. "token asheeshgithubkeys")
    const patMatch = messageToSend.match(/(?:token|key)\s+([a-zA-Z0-9_]{30,})/i) || messageToSend.trim().match(/^([a-zA-Z0-9_]{30,})$/);
    if (patMatch) {
      const newToken = patMatch[1];
      setGithubToken(newToken);
      localStorage.setItem('gh_token', newToken);
      rememberGithubOwner(auth.currentUser?.uid);
      addLog('GitHub: PAT detected and saved.', 'success');
    }

    // Capture Repo if mentioned (e.g. "repo asheesh/my-app")
    const repoMatch = messageToSend.match(/(?:repo|repository)\s+([a-zA-Z0-9-]+\/[a-zA-Z0-9-_.]+)/i);
    if (repoMatch) {
      const [owner, name] = repoMatch[1].split('/');
      setGithubRepoContext({ token: githubToken || '', owner, repo: name, branch: 'main' });
      addLog(`GitHub: Target repository set to ${repoMatch[1]}`, 'info');
    }

    // Fast heuristic for Indian greetings
    const greetings = /^(ram ram|namaste|hello|hi|namaskar|sat sri akal|salam|radhe radhe|jai shri ram|kya haal hai|kaise ho)$/i;
    const isBasicGreeting = greetings.test(messageToSend.trim());

    // Attachment previews for the chat bubble — DOWNSCALED, and that word is the whole fix.
    //
    // This used to `readAsDataURL` the FULL file and keep the result in the message object, which is
    // never trimmed. Base64 inflates ~1.37x and a data URL is an ordinary JS string, so ten phone
    // photos retained ~55 MB for the session — a rising P90 against a flat P50, which is exactly the
    // leak signal Google's Feb-2027 memory metric looks for.
    //
    // Shrinking it loses nothing, and that is verified rather than assumed: the attachment is sent to
    // the backend SEPARATELY a few lines below (`fileAttachments: await filesToBase64(files)`), so
    // this value only ever reached a 64x64 bubble and a lightbox. The model sees exactly what it saw
    // before. See lib/attachmentPreview.ts for why one shared helper replaced two hand-rolled copies.
    const attachmentPreviews: import('../types').MessageAttachment[] =
      await Promise.all(files.map(previewAttachment));

    const userMessage: Message = {
      id: Date.now().toString(),
      text: messageToSend || '',
      sender: 'user',
      timestamp: new Date(),
      ...(attachmentPreviews.length > 0 ? { attachments: attachmentPreviews } : {}),
    };

    setMessagesForTab((prev) => [...prev, userMessage]);
    addLog(isBasicGreeting ? 'Responding to greeting...' : 'Detecting intent...', 'info');
    setInputForTab('');
    setIsLoadingForTab(true);
    stoppedRef.current = false; // a fresh turn — clear any previous Stop
    setErrorContext(null);

    const isRealTime = /today|current|latest|now|news|weather|time|date|day|aaj|samachar|update/i.test(messageToSend);
    if (isRealTime) setIsSearching(true);

    try {
      let data: any;
      let usedBackend = false;

      // Smart Intent Detection & Routing
      const buildTriggers = /bana do|build|create|generate|coding|program|code kardo|app chahiye|banao|project/i;
      const securityTriggers = /security scan|vulnerability|vulnerable|hack|pentest|audit|scan url|check security|security check|payload|exploit/i;
      const socialTriggers = /^(ram ram|namaste|hello|hi|namaskar|sat sri akal|salam|radhe radhe|jai shri ram|kya haal hai|kaise ho|hello Bhai|o bhai|sun bhai|kya chal raha|sab badhiya)$/i;
      const emotionTriggers = /bad|sad|happy|great|wow|yaar|tension|mood|masti|mazza/i;
      
      const githubTriggers = /github|repository|repo|commit|push|pull request|git connect|fetch repo|git|version control/i;
      
      let detectedIntent = 'social';
      if (messageToSend.includes('Activate GitHub Integration Mode')) {
          detectedIntent = 'github';
          addLog('🔗 navBharatAI Git Integration Activated', 'success');
      } else if (securityTriggers.test(messageToSend) || activeView === 'security' || (activeView === 'studio' && activeIntent === 'security')) {
          detectedIntent = 'security';
          if (currentMode === 'chat') {
            addLog('Activating navBharatAI Security Auditor...', 'info');
          }
      } else if (githubTriggers.test(messageToSend)) {
          detectedIntent = 'github';
          addLog('Initializing navBharatAI GitHub Core...', 'info');
      } else if (buildTriggers.test(messageToSend)) {
          if (currentAgent === 'navbharatai') {
              const aiMessage: Message = {
                id: (Date.now() + 1).toString(),
                text: "⚠️ Building applications is only available for NavBharatAI-Pro. Upgrade to unlock the Architect & Build engine! 🙏",
                sender: 'ai',
                timestamp: new Date(),
              };
              setMessagesForTab((prev) => [...prev, aiMessage]);
              setIsLoadingForTab(false);
              addLog('Build Blocked: Pro Only', 'error');
              return;
          }
          if (!user) {
              const aiMessage: Message = {
                id: (Date.now() + 1).toString(),
                text: "⚠️ Building apps is only available for logged-in users. Please login to continue building amazing things! 🙏",
                sender: 'ai',
                timestamp: new Date(),
              };
              setMessagesForTab((prev) => [...prev, aiMessage]);
              setIsLoadingForTab(false);
              addLog('Build Blocked: Login Required', 'error');
              return;
          }
          detectedIntent = 'build';
          if (currentMode === 'chat' && !isNbi) {
            setMode('build');
            addLog('Switching to Architect & Build mode...', 'success');
          }
      } else if (socialTriggers.test(messageToSend)) {
          detectedIntent = 'greeting';
          addLog('Greeting detected...', 'info');
      } else if (emotionTriggers.test(messageToSend)) {
          detectedIntent = 'emotional';
      } else if (/error|debug|fix|wrong|help|issue|bug/i.test(messageToSend)) {
          detectedIntent = 'technical';
      }
      
      setIntentForTab(detectedIntent);

      // Apnapan Engine — learn from this message (free chat only)
      if (isNbi) learnFromMessage(messageToSend);

      let streamingMsgId: string | null = null;

      const performStreamingBackendCall = async (): Promise<{ reply: string; model?: string }> => {
        addLog('Falling back to background AI processing...', 'info');
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (keys.gemini && !invalidKeys.has(keys.gemini)) headers['x-gemini-key'] = keys.gemini;
        if (keys.groq) headers['x-groq-key'] = keys.groq;
        if (keys.deepseek) headers['x-deepseek-key'] = keys.deepseek;
        if (keys.openai) headers['x-openai-key'] = keys.openai;
        if (keys.openrouter) headers['x-openrouter-key'] = keys.openrouter;
        if (keys.claude) headers['x-claude-key'] = keys.claude;
        if (user) {
          headers['x-user-id'] = user.uid;
          headers['x-user-email'] = user.email || '';
          headers['x-user-name'] = user.displayName || 'NavBharat Client';
        }

        let endpoint = '/api/chat';
        if (currentAgent === 'navbharatai') {
          endpoint = '/api/chat/navbharat';
        } else if (currentAgent === 'vishwakarma_basic') {
          endpoint = '/api/chat/vishwakarma-basic';
        } else if (currentAgent === 'vishwakarma_pro') {
          endpoint = '/api/chat/vishwakarma-pro';
        } else if (currentAgent === 'vishwakarma_vip') {
          endpoint = '/api/chat/vip';
        }

        // TELLING IT A VIAL is stored HERE, on the device, before the message goes anywhere — the vial
        // is a fact about this cot side and belongs on this phone, not on a server. The server sends
        // back the confirmation, so the user still sees the number echoed and can check it.
        try {
          const taught = parseVialTeaching(messageToSend);
          if (taught) saveVial(taught.drug.id, taught.concentration);
        } catch { /* a storage failure must never cost the user their message */ }

        // A fresh controller per attempt, exposed via abortRef so the Stop button can cancel this fetch.
        const userAbort = new AbortController();
        abortRef.current = userAbort;
        const response = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            message: messageToSend,
            preferredModel: isNbi ? 'gemini' : selectedModel,
            history: historyForAPI.slice(-40).map(m => ({ sender: m.sender, text: String(m.text || '').slice(0, 2000) })),
            memorySummary: memorySummary || undefined,
            agent: currentAgent,
            mode: currentMode,
            intent: detectedIntent,
            // Convert File objects → base64 so they serialize over JSON
            fileAttachments: files.length > 0 ? await filesToBase64(files) : undefined,
            // 3 — canvas memory: send current app so AI can edit it
            currentApp: hasGeneratedCode && generatedCode && generatedCode.length > 200
              ? generatedCode.slice(0, 15000)
              : undefined,
            // Apnapan Engine — user profile for personalized responses (free tier only)
            userProfile: isNbi ? apnapanProfile : undefined,
            // THE VIALS THIS DEVICE KNOWS (admin 2026-08-28). The server cannot read localStorage, so a
            // newborn dose asked in ONLINE chat could only ever come back in mg — the user had to retype
            // the vial every single time, which is the friction this whole feature exists to remove.
            // Sending them makes online behave exactly like the offline assistant. Concentrations only:
            // no patient data, nothing identifying, and an empty object when nothing has been taught.
            vials: loadVials(),
            stream: true,
          }),
          // The user can Stop this (abortRef) OR it self-cancels after 90s — whichever fires first.
          signal: AbortSignal.any([userAbort.signal, AbortSignal.timeout(90000)]),
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          if (response.status === 401) {
            setUser(null);
            setShowAuth(true);
            throw new Error('Session expired. Please login again.');
          }
          if (response.status === 429) {
            throw new Error('Too many requests. Please wait a moment before sending again.');
          }
          if (response.status === 402 || (errData as any).requirePass) {
            setShowVishwakarmaUnlockModal(true);
          }
          throw new Error((errData as any).error || `HTTP Error ${response.status}`);
        }

        const contentType = response.headers.get('Content-Type') || '';
        const isSSE = contentType.includes('text/event-stream');
        const isPlain = contentType.includes('text/plain');
        if ((isSSE || isPlain) && response.body) {
          // Streaming path — SSE (text/event-stream) or legacy plain text
          streamingMsgId = (Date.now() + 1).toString();
          setMessagesForTab(prev => [...prev, {
            id: streamingMsgId!,
            text: '▋',
            sender: 'ai' as const,
            timestamp: new Date(),
          }]);

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let accumulated = '';
          let lastUpdate = 0;
          let sseBuffer = '';

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              const raw = decoder.decode(value, { stream: true });

              if (isSSE) {
                // Parse SSE: lines like "data: {...}\n\n" and ": ping\n\n" (heartbeat, ignored)
                sseBuffer += raw;
                const events = sseBuffer.split('\n\n');
                sseBuffer = events.pop() ?? '';
                for (const event of events) {
                  for (const line of event.split('\n')) {
                    if (!line.startsWith('data: ')) continue;
                    const payload = line.slice(6).trim();
                    if (payload === '[DONE]') break;
                    try {
                      const parsed = JSON.parse(payload);
                      if (parsed.c) accumulated += parsed.c;
                    } catch { /* malformed chunk, skip */ }
                  }
                }
              } else {
                accumulated += raw;
              }

              const now = Date.now();
              if (now - lastUpdate > 40) {
                const snap = accumulated;
                setMessagesForTab(prev => prev.map(m => m.id === streamingMsgId ? { ...m, text: snap + '▋' } : m));
                lastUpdate = now;
              }
            }
          } finally {
            reader.releaseLock();
          }
          // Final update — remove cursor
          setMessagesForTab(prev => prev.map(m => m.id === streamingMsgId ? { ...m, text: accumulated } : m));
          return { reply: accumulated, model: 'streaming' };
        }

        // Fallback: JSON response
        return await response.json();
      };

      // Retry helper: up to 3 attempts with backoff, only before streaming starts
      const callWithRetry = async (): Promise<{ reply: string; model?: string }> => {
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            return await performStreamingBackendCall();
          } catch (err: any) {
            const isHardError = err.message?.includes('Session expired')
              || err.message?.includes('Too many requests')
              || streamingMsgId !== null; // streaming already started — don't retry mid-stream
            if (isHardError || attempt >= 3) throw err;
            const delay = attempt * 1500; // 1.5s, then 3s
            console.warn(`[RETRY] Backend attempt ${attempt} failed (${err.message}), retrying in ${delay}ms`);
            await new Promise(r => setTimeout(r, delay));
          }
        }
        throw new Error('Unreachable');
      };

      // File attachments (images/PDFs/docs) MUST go to the backend — the frontend
      // pipeline is text-only and would make the AI hallucinate about the file.
      const hasAttachments = files.length > 0;

      // Call Gemini locally if we are on NBI or preferred model is gemini, etc.
      // (but never for attachments — those need the backend vision route)
      const isGeminiSovereign = !hasAttachments && (isNbi || selectedModel === 'gemini' || (selectedModel === 'auto' && !keys.openai && !keys.claude));
      if (isGeminiSovereign) {
        try {
          // Extract potential URL from message if security intent
          let potentialTarget = '';
          if (detectedIntent === 'security') {
            const urlMatch = messageToSend.match(/https?:\/\/[^\s]+/);
            potentialTarget = urlMatch ? urlMatch[0] : '';
          }

          data = await runFrontendPipeline(messageToSend, isRealTime || detectedIntent === 'security', historyForAPI, detectedIntent, potentialTarget, currentAgent, currentMode);
        } catch (frontendErr: any) {
          console.warn('Frontend Gemini failed, trying backend fallback...', frontendErr.message);
          data = await callWithRetry();
          usedBackend = true;
        }
      } else {
        data = await callWithRetry();
        usedBackend = true;
      }
      
      // Only add aiMessage if streaming didn't already add it
      if (!streamingMsgId) {
        const aiMessage: Message = {
          id: (Date.now() + 1).toString(),
          text: data.reply || 'No response received.',
          sender: 'ai',
          timestamp: new Date(),
          modelUsed: data.model
        };
        setMessagesForTab((prev) => {
          const next = [...prev, aiMessage];
          return next;
        });
      } else {
        // Update modelUsed on the streaming message
        const sid = streamingMsgId;
        if (data.model && data.model !== 'streaming' && sid) {
          setMessagesForTab(prev => prev.map(m => m.id === sid ? { ...m, modelUsed: data.model } : m));
        }
      }
      addLog(`AI Response received via ${data.model || 'streaming'}`, 'success');

      // Sync CSS/HTML/JS if build mode
      if (currentMode === 'build' && data.reply) {
         // Auto code extraction from code blocks
         const codeBlocks = data.reply.match(/```[a-z]*[\s\S]*?```/gi);
         if (codeBlocks) {
           addLog('Extracting and compiling AI changes...', 'info');
           setFiles(prev => {
             const newFiles = { ...prev };
             let updated = false;
             
             codeBlocks.forEach((block: string) => {
               const lines = block.split('\n');
               const firstLine = lines[0].toLowerCase();
               const lang = firstLine.replace('```', '').trim();
               const code = lines.slice(1, -1).join('\n');
               
               if (lang === 'html' || code.includes('<!DOCTYPE') || (code.includes('<html') && code.includes('</html>'))) {
                 newFiles['index.html'] = code;
                 updated = true;
               } else if (lang === 'css' || code.includes('{') && code.includes(':') && (code.includes('body') || code.includes('.'))) {
                 if (lang === 'css' || (!lang && (code.includes('background') || code.includes('margin')))) {
                   newFiles['style.css'] = code;
                   updated = true;
                 }
               } else if (lang === 'javascript' || lang === 'js' || (!lang && (code.includes('console.log') || code.includes('document.query')))) {
                 newFiles['script.js'] = code;
                 updated = true;
               }
             });

             if (updated) {
               updatePreview(newFiles);
               addLog('Workspace synced with AI generated code.', 'success');
               setHasGeneratedCode(true);
               setIsDeployed(true);
               if (currentAgent.startsWith('vishwakarma')) {
                 setIsAppBuilt(true);
               }
             }
             return newFiles;
           });
         }
      }

    } catch (error: any) {
      // The user pressed Stop — this is NOT an error. Keep whatever streamed so far (marked stopped) and
      // stay silent: showing "connection failed" for a deliberate cancel is exactly the confusing behaviour
      // the Stop button exists to fix.
      if (stoppedRef.current || error?.name === 'AbortError') {
        // Clean the cursor off the partially-streamed reply (the last AI bubble) and mark it stopped.
        setMessagesForTab((prev) => {
          if (!prev.length || prev[prev.length - 1].sender !== 'ai') return prev;
          const last = prev[prev.length - 1];
          const cleaned = `${String(last.text || '').replace(/▋$/, '').trimEnd()} ⏹ (stopped)`.trim();
          return prev.map((m, i) => (i === prev.length - 1 ? { ...m, text: cleaned } : m));
        });
        return; // finally still clears the loading state
      }
      console.error('Chat error:', error);
      const errType = classifyError(error);
      setErrorContext({
        type: errType,
        message: error.message || 'Connection failed',
        lastInput: messageToSend
      });

      if (errType !== 'AUTH' && errType !== 'QUOTA') {
        addLog(`AI Error: ${error.message || 'Connection failed'}`, 'error');
      }
      
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: "We're having trouble reaching the AI right now. This can happen during high traffic or local network issues.",
        sender: 'ai',
        timestamp: new Date(),
      };
      setMessagesForTab((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoadingForTab(false);
      setIsSearching(false);
    }
  };

  const handleSend = async (overrideMessage?: string) => {
    const tabId = 'nbi_chat';
    await handleSendForTab(tabId, overrideMessage);
  };

  // STOP — cancel the reply that is streaming right now (admin 2026-08-13). Marks it a deliberate stop so
  // the partial reply is kept (not replaced by an error), aborts the fetch, and clears the busy state.
  const stop = () => {
    stoppedRef.current = true;
    try { abortRef.current?.abort(); } catch { /* already settled — nothing to abort */ }
    setIsLoading(false);
    setIsSearching(false);
  };

  // UNSEND — take back the last message: stop any in-flight reply, drop the last exchange (the AI reply and
  // the user message that triggered it), and drop that message's text back into the box to edit or discard.
  const unsend = () => {
    stop();
    const msgs = [...messages];
    while (msgs.length && msgs[msgs.length - 1].sender === 'ai') msgs.pop(); // remove the AI reply/replies
    let restored = '';
    if (msgs.length && msgs[msgs.length - 1].sender === 'user') {
      restored = String(msgs[msgs.length - 1].text || '');
      msgs.pop();
    }
    setMessages(msgs);
    if (restored) setInput(restored);
  };

  // Read a file as raw base64 (no transformation)
  const readFileRaw = (file: File): Promise<{ name: string; type: string; base64: string }> =>
    new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, type: file.type, base64: (reader.result as string).split(',')[1] || '' });
      reader.onerror = () => resolve({ name: file.name, type: file.type, base64: '' });
      reader.readAsDataURL(file);
    });

  // Downscale large images to a vision-optimal size (≤1568px longest edge) and re-encode as JPEG.
  // Keeps payloads tiny (most photos → <500KB) and matches how Claude/Gemini downsample internally.
  const downscaleImage = (file: File, maxDim = 1568, quality = 0.85): Promise<{ name: string; type: string; base64: string }> =>
    new Promise(resolve => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          // Already small enough → send as-is (avoids needless re-encode of clean screenshots)
          if (scale === 1 && file.size <= 900 * 1024) { URL.revokeObjectURL(url); readFileRaw(file).then(resolve); return; }
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) { URL.revokeObjectURL(url); readFileRaw(file).then(resolve); return; }
          ctx.drawImage(img, 0, 0, w, h);
          URL.revokeObjectURL(url);
          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          resolve({ name: file.name.replace(/\.(png|webp|gif|bmp|heic|heif)$/i, '.jpg'), type: 'image/jpeg', base64: dataUrl.split(',')[1] || '' });
        } catch {
          URL.revokeObjectURL(url);
          readFileRaw(file).then(resolve);
        }
      };
      img.onerror = () => { URL.revokeObjectURL(url); readFileRaw(file).then(resolve); };
      img.src = url;
    });

  const filesToBase64 = (files: File[]): Promise<{ name: string; type: string; base64: string }[]> =>
    Promise.all(files.map(file =>
      // Raster images get downscaled; SVG/PDF/text pass through untouched
      (file.type.startsWith('image/') && file.type !== 'image/svg+xml')
        ? downscaleImage(file)
        : readFileRaw(file)
    ));
  return { handleSendForTab, handleSend, stop, unsend };
}
