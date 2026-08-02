import React, { useRef, useEffect, useState } from 'react';
import { Bot, User, Send, Sparkles, Loader2, Heart, Zap, ShieldCheck, Languages, ShieldAlert, Link as LinkIcon, CheckCircle2, Github, Save, ChevronUp, ChevronDown, Lock, Eye, EyeOff, ExternalLink, AlertCircle, Check, Copy, Clock, Zap as ZapIcon, ThumbsUp, ThumbsDown, MessageSquare, Maximize2, Minimize2, Mic, MicOff, X, Search } from 'lucide-react';
import { TirangaLoader } from '../ui/TirangaLoader';
import { cn } from '../../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { AttachMenu } from '../AttachMenu';
import { saveSecret } from '../../lib/secretsApi';
import { speechRecognitionSupported } from '../../lib/voiceInput';
import { AgentProgress, BuildStep } from './AgentProgress';
import { AppUpdateChatNotice } from '../AppUpdateChatNotice';
import { useKeyboardHeight } from '../../hooks/useKeyboardHeight';

import { ThemeMode } from '../../lib/theme';
import { useBuild } from './BuildContext';

// B10/B12: Standalone code block with language header and copy button
const ChatCodeBlock: React.FC<{ lang: string; code: string }> = ({ lang, code }) => {
  const [copied, setCopied] = useState(false);
  const lines = code.split('\n');
  const displayLines = lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines;
  return (
    <div className="rounded-xl overflow-hidden border border-white/10 my-2 text-[11px]">
      <div className="flex items-center justify-between px-3 py-1 bg-[#0d1117] border-b border-white/10">
        <span className="text-[9px] font-mono font-black text-[#484f58] uppercase tracking-widest">{lang || 'code'}</span>
        <button
          onClick={() => { navigator.clipboard.writeText(code).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
          className="text-[8px] font-black uppercase tracking-widest text-[#484f58] hover:text-white transition-colors flex items-center gap-1"
        >
          {copied ? <><Check className="w-2.5 h-2.5 text-emerald-400" /> Copied</> : <><Copy className="w-2.5 h-2.5" /> Copy</>}
        </button>
      </div>
      <div className="bg-[#0d1117] overflow-x-auto">
        <code className="font-mono text-[#c9d1d9] leading-relaxed block">
          {displayLines.map((line, i) => (
            <div key={i} className="flex hover:bg-white/[0.03]">
              <span className="select-none text-right pr-3 pl-2 text-[#484f58] text-[9px] min-w-[2rem] shrink-0 leading-[1.6]">{i + 1}</span>
              <span className="pl-1 pr-3 whitespace-pre leading-[1.6]">{line}</span>
            </div>
          ))}
        </code>
      </div>
    </div>
  );
};

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'ai';
  timestamp: Date | string;
  modelUsed?: string;
  meta?: Record<string, unknown>;
  attachments?: Array<{ name: string; type: string; dataUrl?: string }>;
}

interface SecretQuickFillProps {
  providerId: string | null;
  userId?: string;
  isLoggedIn: boolean;
  onShowLogin?: () => void;
}

export const SecretQuickFill: React.FC<SecretQuickFillProps> = ({ providerId, userId, isLoggedIn, onShowLogin }) => {
  const [provider, setProvider] = useState(providerId || 'gemini');
  const [secretName, setSecretName] = useState('');
  const [secretValue, setSecretValue] = useState('');
  const [showValue, setShowValue] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const providerMap: Record<string, { label: string; key: string; link: string; site: string }> = {
    gemini: { label: 'Gemini (navBharatAI Engine)', key: 'GEMINI_API_KEY', link: 'https://aistudio.google.com/app/apikey', site: 'navBharatAI Console' },
    claude: { label: 'Claude (Anthropic)', key: 'CLAUDE_API_KEY', link: 'https://console.anthropic.com/settings/keys', site: 'Anthropic Console' },
    openai: { label: 'OpenAI (GPT-4)', key: 'OPENAI_API_KEY', link: 'https://platform.openai.com/api-keys', site: 'OpenAI Platform' },
    groq: { label: 'Groq Cloud', key: 'GROQ_API_KEY', link: 'https://console.groq.com/keys', site: 'Groq Console' },
    deepseek: { label: 'DeepSeek', key: 'DEEPSEEK_API_KEY', link: 'https://platform.deepseek.com/api_keys', site: 'DeepSeek Platform' },
    openrouter: { label: 'OpenRouter', key: 'OPENROUTER_API_KEY', link: 'https://openrouter.ai/keys', site: 'OpenRouter' },
    stripe: { label: 'Stripe Payment', key: 'STRIPE_SECRET_KEY', link: 'https://dashboard.stripe.com/apikeys', site: 'Stripe Dashboard' },
    firebase: { label: 'Firebase Key', key: 'FIREBASE_API_KEY', link: 'https://console.firebase.google.com/', site: 'Firebase Console' },
    custom: { label: 'Custom Secret', key: 'CUSTOM_KEY', link: '', site: '' }
  };

  useEffect(() => {
    const activeProv = providerId || 'gemini';
    setProvider(activeProv);
    if (providerMap[activeProv]) {
      setSecretName(providerMap[activeProv].key);
    } else {
      setSecretName(activeProv.toUpperCase() + '_API_KEY');
    }
  }, [providerId]);

  const handleProviderChange = (prov: string) => {
    setProvider(prov);
    if (providerMap[prov]) {
      setSecretName(providerMap[prov].key);
    }
  };

  const handleSave = async () => {
    if (!isLoggedIn) {
      onShowLogin?.();
      return;
    }
    if (!userId) {
      setStatus('error');
      setErrorMessage('User session missing. Please login again.');
      return;
    }
    if (!secretName.trim() || !secretValue.trim()) {
      setStatus('error');
      setErrorMessage('Please fill both name and key value.');
      return;
    }

    setStatus('saving');
    try {
      await saveSecret(userId, secretName, secretValue);
      setStatus('success');
      setSecretValue('');
    } catch (err: any) {
      console.error('Failed to save API Key:', err);
      setStatus('error');
      setErrorMessage(err?.message || 'Failed to save secret key. Please try again.');
    }
  };

  const currentProvData = providerMap[provider] || providerMap['custom'];

  return (
    <div className="mt-3 p-4 bg-[#1c2a38]/80 border border-indigo-500/20 rounded-2xl space-y-3.5 shadow-xl backdrop-blur-md">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-indigo-500/20 rounded-lg text-indigo-400">
            <Lock className="w-3.5 h-3.5 animate-pulse" />
          </div>
          <span className="text-[10px] font-black uppercase tracking-widest text-[#8b949e]">Vishwakarma Key Assistant</span>
        </div>
        {currentProvData.link && (
          <a
            href={currentProvData.link}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[9px] font-black uppercase tracking-wider text-indigo-400 hover:text-indigo-300 flex items-center gap-1 bg-indigo-500/10 px-2 py-1 rounded-lg border border-indigo-500/20"
          >
            Generate Key <ExternalLink className="w-2.5 h-2.5" />
          </a>
        )}
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-[8px] font-black uppercase tracking-widest text-[#484f58] block mb-1">Select Provider</label>
          <select
            value={provider}
            onChange={(e) => handleProviderChange(e.target.value)}
            className="w-full bg-[#0d1117] border border-white/5 rounded-xl p-2.5 text-[10px] font-black uppercase tracking-wider text-white focus:border-indigo-500 outline-none"
          >
            {Object.entries(providerMap).map(([id, p]) => (
              <option key={id} value={id} className="bg-[#0d1117] text-white">
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-[8px] font-black uppercase tracking-widest text-[#484f58] block mb-1">Secret/Key Name</label>
          <input
            type="text"
            value={secretName}
            onChange={(e) => setSecretName(e.target.value)}
            placeholder="e.g. GEMINI_API_KEY"
            className="w-full bg-[#0d1117] border border-white/5 rounded-xl p-2.5 text-[10px] font-mono text-white placeholder:text-[#484f58] focus:border-indigo-500 outline-none"
          />
        </div>

        <div>
          <label className="text-[8px] font-black uppercase tracking-widest text-[#484f58] block mb-1">Key Value</label>
          <div className="relative">
            <input
              type={showValue ? 'text' : 'password'}
              value={secretValue}
              onChange={(e) => setSecretValue(e.target.value)}
              placeholder={`Enter your ${providerMap[provider]?.label || 'Secret'} here`}
              className="w-full bg-[#0d1117] border border-white/5 rounded-xl p-2.5 pr-10 text-[10px] font-mono text-white placeholder:text-[#484f58] focus:border-indigo-500 outline-none"
            />
            <button
              onClick={() => setShowValue(!showValue)}
              className="absolute right-3 top-2.5 text-[#484f58] hover:text-white"
            >
              {showValue ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {status === 'success' && (
          <div className="flex items-center gap-2 text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 p-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest animate-in zoom-in-95">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>Success: Key saved safely to user_secrets!</span>
          </div>
        )}

        {status === 'error' && (
          <div className="flex items-center gap-2 text-red-400 bg-red-500/10 border border-red-500/20 p-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest animate-in zoom-in-95">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={status === 'saving'}
          className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[9px] font-black uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-2 shadow-lg disabled:opacity-50"
        >
          {status === 'saving' ? (
            <>
              <TirangaLoader className="w-3.5 h-3.5" />
              Saving to secure panel...
            </>
          ) : (
            <>
              <Save className="w-3.5 h-3.5" />
              Save Secret Key
            </>
          )}
        </button>

        {!isLoggedIn && (
          <div className="text-center">
            <p className="text-[8px] text-amber-500 font-bold mb-1">
              ⚠️ Setup requires active account.
            </p>
            <button
              onClick={onShowLogin}
              className="px-3 py-1 bg-amber-500 text-black text-[8px] font-black uppercase tracking-widest rounded hover:bg-amber-400 transition-all"
            >
              Log In Now
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

import { AgentMode, ModeSelector } from './ModeSelector';

interface BuildProgressState {
  active: boolean;
  stage: string;
  steps: { label: string; sub: string; status: 'pending' | 'running' | 'done' | 'error'; code?: string; expanded?: boolean }[];
  percent: number;
  generatedFiles: Record<string, { content: string; expanded: boolean }>;
  startedAt?: number;
  part?: number;
  /** G3 — Execution tier reported by the agentic engine. */
  tier?: 'vfs' | 'cloudrun' | 'e2b';
}

interface AIChatProps {
  messages: Message[];
  input: string;
  onInputChange: (val: string) => void;
  onSend: (files: File[]) => void;
  isLoading: boolean;
  activeIntent?: string;
  mode?: AgentMode;
  onModeChange?: (mode: AgentMode) => void;
  pendingGHEdit?: any;
  onConfirmPush?: () => void;
  isPushing?: boolean;
  isPinned?: boolean;
  onTogglePin?: () => void;
  isLoggedIn?: boolean;
  onShowLogin?: () => void;
  activeAgent?: string;
  isAppBuilt?: boolean;
  onPreviewClick?: () => void;
  theme?: ThemeMode;
  userId?: string;
  // UCI System extensions
  activeUci?: string;
  onRestoreUci?: (uci: string) => Promise<boolean>;
  restoredMessages?: Message[];
  memorySummary?: string;
  wallet?: any;
  onGoToMain?: () => void;
  onUnlockVishwakarma?: () => void;
  onAttachmentsChange?: (files: File[]) => void;
  buildProgress?: BuildProgressState | null;
  onBuildStepToggle?: (index: number) => void;
  onLanguagePick?: (lang: string) => void;
  onDownloadZip?: (files: Record<string, string>, appName: string) => void;
  onSendSuggestion?: (text: string) => void;
  onStop?: () => void;
  // Guider (Hybrid) confirmation card: a proposed design awaiting Approve / Edit / Answer.
  guiderPlan?: { language?: string; designProposal?: string; clarifyingQuestions?: string[] } | null;
  guiderReplanning?: boolean;
  onGuiderApprove?: () => void;
  onGuiderSend?: (refinement: string) => void;
}

export const AIChat: React.FC<AIChatProps> = ({
  messages,
  input,
  onInputChange,
  onSend,
  isLoading,
  activeIntent = 'social',
  mode = 'planning',
  onModeChange,
  pendingGHEdit,
  onConfirmPush,
  isPushing,
  isPinned = false,
  onTogglePin,
  isLoggedIn = false,
  onShowLogin,
  activeAgent = 'navbharatai',
  isAppBuilt = false,
  onPreviewClick,
  theme = 'dark',
  userId,
  activeUci = '',
  onRestoreUci,
  restoredMessages = [],
  memorySummary = '',
  wallet = null,
  onGoToMain,
  onUnlockVishwakarma,
  onAttachmentsChange,
  buildProgress = null,
  onBuildStepToggle,
  onLanguagePick,
  onDownloadZip,
  onSendSuggestion,
  onStop,
  guiderPlan,
  guiderReplanning,
  onGuiderApprove,
  onGuiderSend,
}) => {
  const { buildSteps } = useBuild();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const kbHeight = useKeyboardHeight();
  const [attachments, setAttachments] = useState<File[]>([]);
  const [lightbox, setLightbox] = useState<{ src: string; name: string } | null>(null);

  // Fix 1: reset textarea height when input is cleared after send
  useEffect(() => {
    if (!input && textareaRef.current) {
      textareaRef.current.style.height = '40px';
    }
  }, [input]);

  // B29: Multiline paste indicator
  const [pasteLineCount, setPasteLineCount] = useState<number>(0);
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    // B27: Image paste from clipboard
    const items = Array.from(e.clipboardData.items) as DataTransferItem[];
    const imageItem = items.find((item: DataTransferItem) => item.type.startsWith('image/'));
    if (imageItem) {
      const file = imageItem.getAsFile();
      if (file) {
        setAttachments(prev => [...prev, file]);
        return;
      }
    }
    const text = e.clipboardData.getData('text');
    const lines = (text.match(/\n/g) || []).length + 1;
    if (lines > 20) {
      setPasteLineCount(lines);
      setTimeout(() => setPasteLineCount(0), 4000);
    }
  };

  useEffect(() => {
    onAttachmentsChange?.(attachments);
  }, [attachments, onAttachmentsChange]);

  // B17: Search within chat history
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [showChatSearch, setShowChatSearch] = useState(false);

  const [uploadError, setUploadError] = useState<string>('');
  const addPickedFiles = (fileList: FileList | null) => {
    if (!fileList) return;
    const MAX_BYTES = 10 * 1024 * 1024; // F10: 10 MB limit
    const allFiles: File[] = Array.from(fileList) as File[];
    const tooBig = allFiles.filter((f: File) => f.size > MAX_BYTES);
    if (tooBig.length > 0) {
      const names = tooBig.map((f: File) => `${f.name} (${(f.size / 1024 / 1024).toFixed(1)} MB)`).join(', ');
      setUploadError(`File too large (max 10 MB): ${names}`);
      setTimeout(() => setUploadError(''), 5000);
      const allowed = allFiles.filter((f: File) => f.size <= MAX_BYTES);
      if (allowed.length > 0) setAttachments(prev => [...prev, ...allowed]);
    } else {
      setAttachments(prev => [...prev, ...allFiles]);
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  // ── Voice Input ──────────────────────────────────────────────────────────
  // The mic button only renders where the Web Speech API actually exists (desktop Chrome/Edge). On
  // iOS/iPadOS WKWebView (the Capacitor app) it's absent — never a dead/"unresponsive" button (Apple
  // App Review 2.1(a), iPad, 2026-08-02). See src/lib/voiceInput.ts.
  const recognitionRef = useRef<any>(null);
  const [isListening, setIsListening] = useState(false);
  const [voiceSupported] = useState(speechRecognitionSupported);

  const startVoice = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return; // unsupported platforms never render the button; this is a defensive no-op
    const rec = new SR();
    rec.lang = 'en-IN';
    rec.interimResults = true;
    rec.continuous = true;
    rec.onresult = (e: any) => {
      const transcript = Array.from(e.results as any[]).map((r: any) => r[0].transcript).join('');
      onInputChange(transcript);
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 240)}px`;
      }
    };
    rec.onerror = () => setIsListening(false);
    rec.onend = () => setIsListening(false);
    rec.start();
    recognitionRef.current = rec;
    setIsListening(true);
  };

  const stopVoice = () => {
    recognitionRef.current?.stop();
    setIsListening(false);
  };
  
  useEffect(() => {
    console.log('[AIChat] Received buildSteps:', buildSteps.length, buildSteps);
  }, [buildSteps]);
  const scrollRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    console.log(`[AIChat] isLoading changed to: ${isLoading}`);
  }, [isLoading]);

  const [showModeDropdown, setShowModeDropdown] = useState(false);
  const [expandedMessages, setExpandedMessages] = useState<Record<string, boolean>>({});
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  // B9: Edit user message — fill input with message text for re-editing
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [disliked, setDisliked] = useState<Record<string, boolean>>({});
  const [showReport, setShowReport] = useState<Record<string, boolean>>({});
  const [reportText, setReportText] = useState<Record<string, string>>({});
  const [progressCollapsed, setProgressCollapsed] = useState(false);
  // D20: keep build widget visible after completion until user dismisses it
  const [buildProgressDismissed, setBuildProgressDismissed] = useState(false);
  useEffect(() => {
    if (buildProgress?.active) setBuildProgressDismissed(false);
  }, [buildProgress?.active]);
  // D23: build counter — increments on each new build start
  const [currentBuildCount, setCurrentBuildCount] = useState(() => {
    try { return parseInt(localStorage.getItem('nba_build_count') || '0', 10); } catch { return 0; }
  });
  useEffect(() => {
    if (buildProgress?.active) {
      const next = parseInt(localStorage.getItem('nba_build_count') || '0', 10) + 1;
      try { localStorage.setItem('nba_build_count', String(next)); } catch {}
      setCurrentBuildCount(next);
    }
  // Only fire when build starts (active flips to true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildProgress?.active]);
  // Live clock for the build elapsed-time display — ticks only while a build runs.
  const [nowTs, setNowTs] = useState(() => Date.now());
  useEffect(() => {
    if (!buildProgress?.active) return;
    const id = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [buildProgress?.active]);
  const buildElapsedSec = buildProgress?.startedAt ? Math.max(0, Math.floor((nowTs - buildProgress.startedAt) / 1000)) : 0;
  const buildElapsedLabel = buildElapsedSec >= 60 ? `${Math.floor(buildElapsedSec / 60)}m ${buildElapsedSec % 60}s` : `${buildElapsedSec}s`;
  // Guider confirmation card: the user's refinement / answer text.
  const [guiderInput, setGuiderInput] = useState('');

  const [codeStudioUci] = useState<string>(() => {
    let uci = localStorage.getItem('code_studio_chat_uci');
    if (!uci) {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let res = 'CS-';
      for (let i = 0; i < 8; i++) {
        res += chars[Math.floor(Math.random() * chars.length)];
      }
      uci = res;
      localStorage.setItem('code_studio_chat_uci', uci);
    }
    return uci;
  });

  // UCI Local UI states
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  const [resumeUciInput, setResumeUciInput] = useState('');
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState('');
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(false);
  const [showContinueModal, setShowContinueModal] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  // B30: send on Enter preference
  const [sendOnEnter, setSendOnEnter] = useState<boolean>(() => localStorage.getItem('chat_sendOnEnter') !== 'false');

  // Dynamic continuation suggestions
  const [continuePromptPhrase, setContinuePromptPhrase] = useState('Want to continue previous work? Enter your Universal Chat ID (UCI).');

  useEffect(() => {
    const prompts = [
      "Want to continue previous work? Enter your Universal Chat ID (UCI).",
      "Have an existing workspace? Paste your UCI below to restore memory.",
      "Resume an older session using your Chat ID.",
      "Want to transition agents? Enter your Chat ID."
    ];
    setContinuePromptPhrase(prompts[Math.floor(Math.random() * prompts.length)]);
  }, [messages.length]);

  const copyUci = () => {
    if (!activeUci) return;
    navigator.clipboard.writeText(activeUci);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareChat = () => {
    if (!activeUci) return;
    const shareUrl = `${window.location.origin}${window.location.pathname}?uci=${encodeURIComponent(activeUci)}`;
    navigator.clipboard.writeText(shareUrl);
    setShared(true);
    setTimeout(() => setShared(false), 2000);
  };

  // F3: Offline detection
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const up = () => setIsOnline(true);
    const down = () => setIsOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);

  // B14: Ctrl+K / Cmd+K focuses the input
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        textareaRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const handleRestoreByUci = async () => {
    if (!resumeUciInput.trim() || !onRestoreUci) return;
    setIsRestoring(true);
    setRestoreError('');
    try {
      const success = await onRestoreUci(resumeUciInput.trim());
      if (success) {
        setResumeUciInput('');
        setShowContinueModal(false);
      } else {
        setRestoreError('Universal Chat ID not found or unauthorized access.');
      }
    } catch (err: any) {
      setRestoreError(err.message || 'Error restoring chat.');
    } finally {
      setIsRestoring(false);
    }
  };

  const formatMsgTime = (ts: Date | string | undefined): string => {
    if (!ts) return '';
    const d = ts instanceof Date ? ts : new Date(ts);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const parseMessageAndTriggers = (msg: Message) => {
    const text = String(msg.text || '');
    const match = text.match(/\[ACTION_SECRET_HELPER:([^\]]+)\]/i);
    if (match) {
      const providerId = match[1].toLowerCase().trim();
      const cleanedText = text.replace(/\[ACTION_SECRET_HELPER:[^\]]+\]/gi, '').trim();
      return { providerId, cleanedText, deservesManual: false };
    }

    const deservesManual = msg.sender === 'ai' && /api key|secret key|stripe_secret_key|gemini_api_key|claude_api_key|openai_api_key|groq_api_key|deepseek_api_key/i.test(text);
    return { providerId: null, cleanedText: text, deservesManual };
  };

    const getDisplayIntent = (intent: string) => {
      // Removed Vishwakarma agent specialized intent labels.

      switch(intent) {
         case 'greeting': return { label: 'Social Assistant', icon: Heart, color: 'text-rose-400 bg-rose-500/10' };
         case 'build': return { label: 'Architect Mode', icon: Zap, color: 'text-indigo-400 bg-indigo-500/10' };
         case 'technical': return { label: 'Technical Guru', icon: ShieldCheck, color: 'text-emerald-400 bg-emerald-500/10' };
         case 'emotional': return { label: 'Empathetic Companion', icon: Languages, color: 'text-amber-400 bg-amber-500/10' };
         case 'security': return { label: 'Security Auditor', icon: ShieldAlert, color: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20' };
         case 'github': return { label: 'GitHub Cloud Architect', icon: Github, color: 'text-white bg-black/50' };
         default: return { label: 'Navbharat AI', icon: Sparkles, color: 'text-indigo-400 bg-white/5' };
      }
    };

  const intentUI = getDisplayIntent(activeIntent);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

    const renderMessageContent = (msg: Message) => {
    if (!msg || (typeof msg.text !== 'string' && !(msg as any).content)) {
        return null;
    }
    
    // Fallback to content if text is missing
    const msgText = typeof msg.text === 'string' ? msg.text : (msg as any).content || "";
    
    const isAI = msg.sender === 'ai';
    const text = msgText;
    const hasSources = text.includes('Sources:') || text.includes('References:');
    let displayContent = text;
    
    // Pro Mode: Hide raw code, show action status
// (Removed message hiding)

    const isQuestion = isAI && (text.includes('?') || text.includes('what kind of') || text.includes('would you like'));

    // ── Special markers ─────────────────────────────────────────────────────
    const hasSwitchToBuild = isAI && text.includes('__SWITCH_TO_BUILD__');
    const hasUrgentBuild   = isAI && text.includes('__URGENT_BUILD__');
    const hasViewPreview   = isAI && text.includes('__VIEW_PREVIEW__');
    const hasDeployActions = isAI && text.includes('__DEPLOY_ACTIONS__');
    const hasAutoPlan      = isAI && text.includes('__AUTO_PLAN__');
    const cleanText = text
      .replace('__SWITCH_TO_BUILD__', '')
      .replace('__URGENT_BUILD__', '')
      .replace('__VIEW_PREVIEW__', '')
      .replace('__DEPLOY_ACTIONS__', '')
      .replace('__AUTO_PLAN__', '')
      .replace('__AUTO_BUILD__', '')
      .trim();
    const deployFiles = (msg as any).meta?.deployFiles as Record<string, string> | undefined;
    const deployAppName = (msg as any).meta?.appName as string | undefined;
    const suggestions = (msg as any).meta?.suggestions as string[] | undefined;

    return (
      <div className="space-y-3">
        {isAI && hasSources && (
          <div className="flex items-center gap-1.5 mb-1 opacity-80">
            <CheckCircle2 className="w-3 h-3 text-indigo-400" />
            <span className="text-[8px] font-black uppercase tracking-widest text-[#8b949e]">Based on verified sources</span>
          </div>
        )}
        <div className={cn("markdown-body prose prose-invert prose-xs max-w-none prose-p:leading-relaxed prose-a:text-indigo-400 prose-a:no-underline hover:prose-a:underline", !isAI && "prose-p:text-white")}>
          <ReactMarkdown
            components={{
              a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5" />,
              // B10/B12: Code blocks with language header and copy button
              code: ({ node, className, children, ...props }: any) => {
                const isInline = !className;
                if (isInline) {
                  return <code className="bg-white/10 px-1 py-0.5 rounded text-[11px] font-mono text-indigo-300" {...props}>{children}</code>;
                }
                const lang = (className || '').replace('language-', '');
                const code = String(children).replace(/\n$/, '');
                return <ChatCodeBlock lang={lang} code={code} />;
              },
              pre: ({ node, children, ...props }: any) => <>{children}</>,
              // B19: Styled markdown tables
              table: ({ node, children, ...props }: any) => (
                <div className="overflow-x-auto my-2 rounded-xl border border-white/10">
                  <table className="w-full text-[11px] border-collapse" {...props}>{children}</table>
                </div>
              ),
              thead: ({ node, children, ...props }: any) => <thead className="bg-[#0d1117]" {...props}>{children}</thead>,
              th: ({ node, children, ...props }: any) => <th className="px-3 py-2 text-left font-black text-[#8b949e] uppercase tracking-widest text-[9px] border-b border-white/10" {...props}>{children}</th>,
              td: ({ node, children, ...props }: any) => <td className="px-3 py-2 border-b border-white/5 text-[#c9d1d9]" {...props}>{children}</td>,
              // B20: Task list checkboxes (GFM - [ ] / [x])
              input: ({ node, ...props }: any) => (
                <input {...props} disabled className="mr-1.5 align-middle accent-indigo-500 cursor-default" />
              ),
              // B22: Inline image rendering
              img: ({ node, src, alt, ...props }: any) => (
                <img
                  src={src}
                  alt={alt || ''}
                  className="max-w-full rounded-xl my-2 border border-white/10"
                  loading="lazy"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  {...props}
                />
              ),
            }}
          >
            {cleanText || ""}
          </ReactMarkdown>
        </div>

        {/* ── Language picker buttons ── */}
        {isAI && (msg as any).meta?.type === 'language-picker' && onLanguagePick && (
          <div className="mt-3 flex flex-wrap gap-2">
            {[
              { label: '🇮🇳 Hindi', value: 'hindi' },
              { label: '🔀 Hinglish', value: 'hinglish' },
              { label: '🇬🇧 English', value: 'english' },
              { label: '🌐 Auto-detect', value: 'auto' },
            ].map(opt => (
              <button
                key={opt.value}
                onClick={() => onLanguagePick(opt.value)}
                className="px-4 py-2 rounded-xl text-[12px] font-bold border border-indigo-500/40 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/25 hover:border-indigo-400 transition-all active:scale-95"
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}

        {/* ── Urgent Build CTA — user explicitly asked to build ── */}
        {hasUrgentBuild && onModeChange && (
          <div className="mt-3 pt-3 border-t border-white/10">
            <div className="rounded-2xl overflow-hidden border border-orange-500/40 shadow-lg shadow-orange-900/20">
              <div className="bg-gradient-to-r from-orange-950/80 to-amber-950/80 px-4 py-3 flex items-start gap-3">
                <span className="text-2xl shrink-0 mt-0.5">🔨</span>
                <div>
                  <p className="text-[12px] font-black text-orange-300 uppercase tracking-wider">Switch to Build Mode?</p>
                  <p className="text-[11px] text-orange-200/80 mt-0.5 leading-snug">
                    Planning Mode only creates a blueprint — switch to Build Mode to generate the actual working app in one click!
                  </p>
                </div>
              </div>
              <button
                onClick={() => onModeChange('build')}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 font-black text-[13px] uppercase tracking-widest transition-all active:scale-[0.98] hover:brightness-110"
                style={{
                  background: 'linear-gradient(135deg, #ea580c, #d97706)',
                  color: 'white',
                  animation: 'pulse 2s ease-in-out infinite',
                }}
              >
                <span style={{ fontSize: 16 }}>⚡</span>
                Switch to Build Mode — Build Now
                <span style={{ fontSize: 16 }}>→</span>
              </button>
            </div>
          </div>
        )}

        {/* ── Auto Plan: show "Build Now" button after AI presents the plan ── */}
        {hasAutoPlan && onSendSuggestion && (
          <div className="mt-3 pt-3 border-t border-indigo-500/20">
            <div className="rounded-2xl overflow-hidden border border-indigo-500/30 shadow-lg shadow-indigo-900/20">
              <div className="bg-gradient-to-r from-indigo-950/80 to-violet-950/80 px-4 py-2.5 flex items-center gap-2">
                <span className="text-lg shrink-0">✨</span>
                <p className="text-[11px] font-black text-indigo-300 uppercase tracking-wider">Plan ready — build kar du?</p>
              </div>
              <button
                onClick={() => onSendSuggestion('__CONFIRM_AUTO_BUILD__')}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 font-black text-[13px] uppercase tracking-widest transition-all active:scale-[0.98] hover:brightness-110"
                style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)', color: 'white' }}
              >
                <span>🚀</span>
                Yes, Build
              </button>
            </div>
          </div>
        )}

        {/* ── Regular Switch to Build button — end of every planning response ── */}
        {hasSwitchToBuild && !hasUrgentBuild && onModeChange && (
          <div className="mt-3 pt-3 border-t border-white/10">
            <button
              onClick={() => onModeChange('build')}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-bold text-[12px] uppercase tracking-wider transition-all active:scale-95 hover:brightness-110 border border-amber-500/30"
              style={{
                background: 'linear-gradient(135deg, rgba(245,158,11,0.15), rgba(217,119,6,0.15))',
                color: '#fbbf24',
              }}
            >
              <span>🔨</span>
              Switch to Build Mode
              <span style={{ fontSize: 14 }}>→</span>
            </button>
          </div>
        )}

            
        {/* View Preview — the __VIEW_PREVIEW__ marker finally renders its button
            (previously the flag was parsed but never used, so a successful build
            offered no way to open the preview). */}
        {hasViewPreview && onPreviewClick && (
          <div className="mt-3 pt-3 border-t border-white/10">
            <button
              onClick={onPreviewClick}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-bold text-[12px] uppercase tracking-wider transition-all active:scale-95 hover:brightness-110 border border-indigo-500/30"
              style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)', color: 'white' }}
            >
              <span>👁️</span>
              View Live Preview
              <span style={{ fontSize: 14 }}>→</span>
            </button>
          </div>
        )}

        {/* Deploy Actions — shown after successful build */}
        {hasDeployActions && deployFiles && onDownloadZip && (
          <div className="mt-3 pt-3 border-t border-white/10">
            <p className="text-[9px] font-black uppercase tracking-widest text-[#484f58] mb-2">🚀 Deploy your app</p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => onDownloadZip(deployFiles, deployAppName || 'NavBharatAI-App')}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/35 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold rounded-xl transition-all active:scale-95"
              >
                📦 Download ZIP
              </button>
              <button
                onClick={() => window.open('https://app.netlify.com/drop', '_blank')}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600/15 hover:bg-teal-600/25 border border-teal-500/25 text-teal-400 text-[10px] font-bold rounded-xl transition-all active:scale-95"
              >
                ⬆ Netlify Drop
              </button>
              <button
                onClick={() => window.open('https://pages.github.com', '_blank')}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-[#8b949e] text-[10px] font-bold rounded-xl transition-all active:scale-95"
              >
                🐙 GitHub Pages
              </button>
              {/* D26: re-run code review from build results */}
              {onSendSuggestion && (
                <button
                  onClick={() => onSendSuggestion('/code-review')}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600/10 hover:bg-red-600/20 border border-red-500/20 text-red-400 text-[10px] font-bold rounded-xl transition-all active:scale-95"
                  title="Run AI code review on the generated app"
                >
                  🔍 Code Review
                </button>
              )}
            </div>
          </div>
        )}

        {/* Smart Follow-Up Suggestions */}
        {suggestions && suggestions.length > 0 && onSendSuggestion && (
          <div className="mt-3 pt-3 border-t border-white/10">
            <p className="text-[9px] font-black uppercase tracking-widest text-[#484f58] mb-2">💡 What to build next</p>
            <div className="flex overflow-x-auto no-scrollbar gap-2 pb-1">
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => onSendSuggestion(s)}
                  className="flex shrink-0 items-center gap-1 px-2.5 py-1.5 bg-indigo-600/15 hover:bg-indigo-600/30 border border-indigo-500/25 text-indigo-300 text-[10px] font-medium rounded-full transition-all active:scale-95"
                >
                  <span className="text-indigo-400">+</span> {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Interaction Controls */}
        <div className="flex gap-2 mt-3 pt-2 border-t border-white/5 items-center">
            <button onClick={() => { navigator.clipboard.writeText(cleanText); setCopied(true); setTimeout(() => setCopied(false), 2000); }} className="p-1 hover:bg-white/10 rounded text-gray-500 hover:text-white" title="Copy">
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            </button>
            {isAI && (
                <>
                    <button onClick={() => setLiked({...liked, [msg.id]: !liked[msg.id]})} className={cn("p-1 hover:bg-white/10 rounded", liked[msg.id] ? "text-emerald-400" : "text-gray-500 hover:text-white")} title="Helpful">
                        <ThumbsUp className="w-3 h-3" />
                    </button>
                    <button onClick={() => { setDisliked({...disliked, [msg.id]: !disliked[msg.id]}); setShowReport({...showReport, [msg.id]: !showReport[msg.id]})}} className={cn("p-1 hover:bg-white/10 rounded", disliked[msg.id] ? "text-rose-400" : "text-gray-500 hover:text-white")} title="Not helpful">
                        <ThumbsDown className="w-3 h-3" />
                    </button>
                </>
            )}
            {showReport[msg.id] && (
                <div className="mt-1 flex flex-col gap-1 w-full p-2 bg-black/50 border border-white/5 rounded-xl animate-in fade-in duration-200">
                    <input value={reportText[msg.id] || ''} onChange={(e) => setReportText({...reportText, [msg.id]: e.target.value})} className="bg-transparent border border-white/10 p-1.5 rounded text-[10px] text-white outline-none w-full" placeholder="What was wrong?" />
                    <button onClick={() => { setShowReport({...showReport, [msg.id]: false}); alert('Thank you for your feedback!'); }} className="text-[9px] text-rose-400 font-bold uppercase tracking-widest pt-1 border-t border-white/5 mt-1 hover:text-rose-300">Submit Report</button>
                </div>
            )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full min-h-0 max-h-full bg-[var(--theme-bg)] transition-colors duration-500 overflow-hidden relative">
      {/* F3: Offline banner */}
      {!isOnline && (
        <div className="shrink-0 bg-amber-600 px-3 py-1.5 flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-widest text-white">
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          No internet connection — messages may not send
        </div>
      )}
      {/* B9: Editing message indicator */}
      {editingMsgId && (
        <div className="shrink-0 bg-indigo-600/20 border-b border-indigo-500/30 px-3 py-1 flex items-center justify-between gap-2 text-[9px] font-black uppercase tracking-widest text-indigo-300">
          <span className="flex items-center gap-1.5"><MessageSquare className="w-3 h-3" /> Editing message — modify and send</span>
          <button onClick={() => { setEditingMsgId(null); onInputChange(''); }} className="text-indigo-400 hover:text-white transition-colors"><X className="w-3 h-3" /></button>
        </div>
      )}
      {/* In-chat image lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[200] bg-black/90 flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={() => setLightbox(null)}
        >
          <div className="relative max-w-[95vw] max-h-[92vh] flex flex-col items-center gap-2" onClick={e => e.stopPropagation()}>
            <img
              src={lightbox.src}
              alt={lightbox.name}
              className="max-w-full max-h-[85vh] rounded-2xl shadow-2xl object-contain"
            />
            <p className="text-[10px] text-white/60 font-mono truncate max-w-full">{lightbox.name}</p>
            <button
              onClick={() => setLightbox(null)}
              className="absolute -top-3 -right-3 w-8 h-8 bg-white/10 hover:bg-white/25 rounded-full flex items-center justify-center text-white transition-colors border border-white/20"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
      {isExpanded && (
        <div className="fixed inset-0 z-[100] bg-[var(--theme-bg)] flex flex-col p-4 md:p-6 animate-in fade-in zoom-in-95 duration-200">
          <div className="flex justify-between items-center mb-4">
            <span className="text-[12px] font-black uppercase tracking-widest text-white">Full Screen Composer</span>
            <button
              onClick={() => setIsExpanded(false)}
              className="px-4 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-white text-[10px] font-black uppercase tracking-widest"
            >
              <div className="flex items-center gap-1.5">
                <Minimize2 className="w-3.5 h-3.5" />
                Collapse
              </div>
            </button>
          </div>
          <textarea
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            className="flex-1 w-full bg-[#0d1117] border border-white/10 rounded-2xl p-4 text-[14px] text-white outline-none focus:border-indigo-500 resize-none font-mono"
            placeholder="Ask navBharatAI..."
          />
          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={() => { onSend([]); setIsExpanded(false); }}
              disabled={!input.trim() || isLoading}
              className="px-8 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[11px] font-black uppercase tracking-widest disabled:opacity-35 transition-all shadow-lg active:scale-95"
            >
              Send
            </button>
          </div>
        </div>
      )}
      
      {/* Premium AIChat Header */}
      {/* Header removed */}

      {/* Play Button Header Popup */}
      <AnimatePresence>
        {isAppBuilt && (
          <motion.div
            drag
            dragMomentum={false}
            dragConstraints={{ left: -300, right: 300, top: -400, bottom: 100 }}
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute top-16 right-4 z-50 cursor-grab active:cursor-grabbing hidden sm:block"
          >
            <button
              onClick={onPreviewClick}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-full shadow-2xl shadow-emerald-500/20 transition-all border border-emerald-400/30 group active:scale-95"
            >
              <Zap className="w-3 h-3 fill-current animate-pulse" />
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-black uppercase tracking-widest">Live Preview</span>
              </div>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* B17: Chat search bar */}
      {showChatSearch && (
        <div className="px-3 py-2 border-b border-white/5 bg-black/20 flex items-center gap-2">
          <Search className="w-3 h-3 text-[#484f58] shrink-0" />
          <input
            autoFocus
            value={chatSearchQuery}
            onChange={e => setChatSearchQuery(e.target.value)}
            placeholder="Search messages..."
            className="flex-1 bg-transparent text-[11px] text-white outline-none placeholder:text-[#484f58]"
          />
          <button onClick={() => { setShowChatSearch(false); setChatSearchQuery(''); }} className="text-[#484f58] hover:text-white">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      <div className={cn("flex-1 overflow-y-auto p-4 space-y-6 no-scrollbar overflow-x-hidden")} ref={scrollRef}>
        {/* App-update notice — first message once the user has chatted, in their language (native app,
            update available). See AppUpdateChatNotice; renders nothing otherwise. */}
        {(() => {
          const lastUser = [...messages].reverse().find((m: any) => m?.sender === 'user');
          return lastUser ? <AppUpdateChatNotice userText={String(lastUser.text ?? '')} /> : null;
        })()}
        {/* AgentProgress removed here to only be rendered dynamically in messages if needed */}
        {restoredMessages && restoredMessages.length > 0 && (
          <div className="mb-6 bg-indigo-950/10 border border-indigo-500/10 rounded-2xl overflow-hidden shadow-2xl transition-all">
            <button 
              onClick={() => setIsHistoryExpanded(!isHistoryExpanded)}
              className="w-full flex items-center justify-between p-4 bg-indigo-500/5 hover:bg-indigo-500/10 transition-all border-b border-indigo-500/5 text-left group"
            >
              <div className="flex items-center gap-3">
                <Clock className="w-4 h-4 text-indigo-400" />
                <div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-[#8b949e]">Previous Conversation ({activeUci})</span>
                  <p className="text-[8px] text-indigo-400/80 font-mono mt-0.5 font-bold uppercase tracking-wide">
                    Click to {isHistoryExpanded ? 'collapse' : 'expand'} • {restoredMessages.length} messages preserved
                  </p>
                </div>
              </div>
              {isHistoryExpanded ? <ChevronUp className="w-4 h-4 text-indigo-400" /> : <ChevronDown className="w-4 h-4 text-indigo-400" />}
            </button>
            
            <AnimatePresence>
              {isHistoryExpanded && (
                <motion.div 
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="p-4 space-y-6 max-h-[350px] overflow-y-auto border-t border-white/5 divide-y divide-white/5">
                    {restoredMessages.map((msg, i) => (
                      <div key={msg.id || i} className={cn("pt-4 flex flex-col space-y-1.5", msg.sender === 'user' ? "items-end" : "items-start")}>
                        <div className={cn(
                          "max-w-[90%] p-3 rounded-xl text-[10.5px] font-medium leading-relaxed shadow-sm break-words bg-[#0d1117] text-[#8b949e] border border-white/5"
                        )}>
                          {renderMessageContent(msg)}
                        </div>
                        <div className="flex items-center gap-1.5 px-1 opacity-70">
                          <span className="text-[7px] font-black text-[#8b949e] uppercase tracking-widest">
                            {msg.sender === 'user' ? 'YOU' : 'PREVIOUS AI'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
        
        {restoredMessages && restoredMessages.length > 0 && (
          <div className="relative flex items-center justify-center my-8 select-none">
            <div className="absolute inset-0 flex items-center" aria-hidden="true">
              <div className="w-full border-t border-dashed border-indigo-500/25"></div>
            </div>
            <div className="relative flex justify-center text-[8px] font-black uppercase tracking-[0.2em] px-4 bg-[var(--theme-bg)] text-indigo-450 border border-indigo-500/20 py-1.5 rounded-full shadow-lg backdrop-blur-md">
              Continuation Workspace
            </div>
          </div>
        )}

        {/* Compact UCI continuation card */}
        {messages.length <= 1 && (
            <div className="flex justify-center my-4">
                <button 
                  onClick={() => setShowContinueModal(!showContinueModal)}
                  className="px-4 py-2 bg-indigo-950/40 hover:bg-indigo-950/60 border border-indigo-500/20 text-indigo-300 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all shadow-lg active:scale-95 flex items-center gap-2"
                >
                  <Clock className="w-3 h-3" />
                  {showContinueModal ? 'Hide Restore Options' : 'Resume Previous Session'}
                </button>
            </div>
        )}
        
        {showContinueModal && messages.length <= 1 && (
          <div className="p-4 bg-indigo-950/20 border border-indigo-500/10 rounded-2xl space-y-3 shadow-xl backdrop-blur-md max-w-xl mx-auto select-none animate-in fade-in zoom-in-95">
            <p className="text-[9px] text-[#8b949e] font-medium">{continuePromptPhrase}</p>
            <div className="flex gap-2">
              <input 
                type="text"
                placeholder="Enter Universal Chat ID ..."
                value={resumeUciInput}
                onChange={(e) => setResumeUciInput(e.target.value)}
                className="flex-1 bg-[#0d1117]/80 border border-white/5 rounded-xl p-2.5 text-[10px] font-mono text-white placeholder:text-[#484f58] focus:border-indigo-500 outline-none transition-all shadow-inner"
              />
              <button 
                onClick={handleRestoreByUci}
                disabled={isRestoring || !resumeUciInput.trim()}
                className="px-3 bg-indigo-600 hover:bg-indigo-505 text-white rounded-xl text-[8px] font-black uppercase tracking-widest transition-all disabled:opacity-35"
              >
                Restore
              </button>
            </div>
            {restoreError && (
              <p className="text-[8px] text-red-400 font-bold animate-pulse">⚠️ {restoreError}</p>
            )}
          </div>
        )}

        {messages.length === 0 && (
          <>
              <div className="flex flex-col items-center justify-center p-6 space-y-2 opacity-50">
              <div className="w-10 h-10 bg-indigo-600/10 rounded-2xl flex items-center justify-center mb-2">
                <Sparkles className="w-5 h-5 text-indigo-400" />
              </div>
              <p className={cn("text-[10px] font-black uppercase tracking-widest text-[#8b949e]")}>Ready to architect and build.</p>
            </div>

            {/* B6/G9 — Quick-Start Gallery: example prompts, adapts per agent */}
            {(() => {
              const isPro = activeAgent === 'navbharatai-pro';
              const isIde = activeAgent === 'navbharatai' || !activeAgent?.includes('pro');
              const proStarters = [
                { icon: '📊', title: 'Analytics Dashboard', prompt: 'Build a modern analytics dashboard with sales charts, user metrics, revenue trends, and KPI cards. Use dark theme with gradient accents.' },
                { icon: '🛒', title: 'E-commerce Page', prompt: 'Create a product landing page with hero section, features grid, pricing table, customer reviews, and a buy-now button.' },
                { icon: '✅', title: 'Todo App', prompt: 'Build a todo app with categories, due dates, priority levels, drag-to-reorder, and localStorage persistence. Dark, minimal design.' },
                { icon: '🎨', title: 'Portfolio Site', prompt: 'Create a developer portfolio with animated hero section, projects grid with tech tags, skills section, and contact form.' },
                { icon: '🧠', title: 'Quiz App', prompt: 'Build an interactive quiz with 5 trivia questions, countdown timer, progress bar, score tracking, and a celebratory results screen.' },
                { icon: '☁️', title: 'Weather App', prompt: 'Create a weather dashboard with current conditions, hourly forecast, 5-day outlook, and animated weather icons. Use a glassmorphism card layout.' },
                { icon: '💬', title: 'Chat Interface', prompt: 'Build a real-time-style chat UI with message bubbles, timestamp, emoji reactions, typing indicator, and a message input with file attach.' },
                { icon: '📝', title: 'Note-taking App', prompt: 'Create a Notion-inspired note-taking app with rich text editor, tags, search, sidebar navigation, and localStorage sync.' },
              ];
              const ideStarters = [
                { icon: '🔍', title: 'Explain this file', prompt: 'Explain what this file does and how it works.' },
                { icon: '🐛', title: 'Find bugs', prompt: 'Review this code for bugs, edge cases, and potential issues. List each problem with a fix.' },
                { icon: '⚡', title: 'Improve performance', prompt: 'Identify and fix performance bottlenecks in this code.' },
                { icon: '🛡️', title: 'Security review', prompt: 'Do a security audit of this code. Identify vulnerabilities and suggest fixes.' },
                { icon: '🧪', title: 'Write tests', prompt: 'Write comprehensive unit tests for the functions in this file.' },
                { icon: '📚', title: 'Generate README', prompt: 'Generate a comprehensive README.md for this project based on the code.' },
              ];
              const starters = isPro ? proStarters : (isIde ? ideStarters : proStarters);
              return (
                <div className="px-3 pb-3 space-y-2">
                  <p className="text-[9px] font-black uppercase tracking-[0.2em] text-[#484f58] text-center">Try one of these</p>
                  <div className={`grid gap-2 ${isPro ? 'grid-cols-2' : 'grid-cols-2'}`}>
                    {starters.map(({ icon, title, prompt }) => (
                      <button
                        key={title}
                        onClick={() => onInputChange(prompt)}
                        className="text-left p-2.5 bg-[#161b22] hover:bg-[#1c2430] border border-white/5 hover:border-indigo-500/30 rounded-2xl transition-all group active:scale-95"
                      >
                        <span className="text-base leading-none">{icon}</span>
                        <p className="text-[10px] font-black text-white mt-1.5 group-hover:text-indigo-300 transition-colors">{title}</p>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}

            <div className="flex items-center justify-center py-4 border-t border-white/5 mt-4">
               <button
                 onClick={() => document.querySelector<HTMLButtonElement>('[title="Security Scan"]')?.click()}
                 className="p-2 px-4 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-xl flex items-center gap-2 transition-all shadow-lg"
                 title="Open Security Scan Hub"
               >
                 <ShieldAlert className="w-4 h-4" />
                 <span className="text-[10px] font-black uppercase tracking-widest">Start Security Scan</span>
               </button>
            </div>
          </>
        )}

        <AnimatePresence>
          {messages
            .filter(msg => !chatSearchQuery || (msg.text || '').toLowerCase().includes(chatSearchQuery.toLowerCase()))
            .map((msg, index) => {
            if (!msg) return null;
            const cleanedText = msg.text || (msg as any).content || "No Text";
            const lineCount = ((cleanedText || '').match(/\n/g) || []).length + 1;
            const isLongMessage = cleanedText.length > 220 || lineCount > 4;

            const isLastAI = msg.sender === 'ai' && index === messages.length - 1 && !isLoading;
            // F2: classify error type for visual distinction
            const isNetworkError = msg.sender === 'ai' && /network.*fail|internet.*check|connection.*fail|ERR_NETWORK|cannot reach|unreachable|offline/i.test(cleanedText);
            const isAIError = msg.sender === 'ai' && !isNetworkError && /temporarily busy|rate limit|quota|AI.*service|all.*providers|overload|timeout|unavailable/i.test(cleanedText);
            return (
              <motion.div
                layout
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                key={msg.id}
                className={cn(
                  "flex flex-col space-y-2 group/msg",
                  msg.sender === 'user' ? "items-end" : "items-start"
                )}
              >
                <div className={cn(
                  "max-w-[90%] p-3.5 rounded-2xl text-[11px] font-medium leading-relaxed shadow-sm break-words select-text",
                  msg.sender === 'user'
                    ? "bg-indigo-600 text-white rounded-tr-none"
                    : isNetworkError
                      ? "bg-[#1a0e0e] text-[#c9d1d9] border border-red-500/30 rounded-tl-none shadow-[0_4px_12px_rgba(0,0,0,0.2)]"
                      : isAIError
                        ? "bg-[#1a1600] text-[#c9d1d9] border border-amber-500/30 rounded-tl-none shadow-[0_4px_12px_rgba(0,0,0,0.2)]"
                        : "bg-[#161b22] text-[#c9d1d9] border border-white/5 rounded-tl-none shadow-[0_4px_12px_rgba(0,0,0,0.2)]"
                )}>
                  {/* Attachment image previews — compact grid */}
                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {msg.attachments.map((att, ai) => (
                        att.type.startsWith('image/') && att.dataUrl ? (
                          <button
                            key={ai}
                            onClick={() => setLightbox({ src: att.dataUrl!, name: att.name })}
                            className="relative group shrink-0 focus:outline-none"
                            title={att.name}
                          >
                            <img
                              src={att.dataUrl}
                              alt={att.name}
                              className="w-16 h-16 rounded-lg object-cover border border-white/20 group-hover:brightness-110 transition-all cursor-zoom-in"
                            />
                            <div className="absolute inset-0 rounded-lg bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                              <Maximize2 className="w-4 h-4 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow" />
                            </div>
                          </button>
                        ) : (
                          <div key={ai} className="flex items-center gap-1.5 px-2 py-1 bg-white/10 rounded-lg text-[10px] font-bold">
                            <span>📎</span>
                            <span className="truncate max-w-[120px]">{att.name}</span>
                          </div>
                        )
                      ))}
                    </div>
                  )}
                  {isLongMessage ? (
                    <div className="relative">
                      <div className={cn("transition-all duration-300", !expandedMessages[msg.id] ? "max-h-[120px] overflow-hidden" : "max-h-[5000px]")}>
                        {renderMessageContent(msg)}
                      </div>
                      <button
                        onClick={() => setExpandedMessages(prev => ({ ...prev, [msg.id]: !prev[msg.id] }))}
                        className={cn(
                          "mt-2 text-[10px] font-bold uppercase tracking-widest transition-colors flex items-center gap-1 cursor-pointer",
                          msg.sender === 'user'
                            ? "text-indigo-200 hover:text-white"
                            : "text-blue-500 hover:text-blue-400 font-extrabold"
                        )}
                      >
                        {expandedMessages[msg.id] ? "See Less ▲" : "See More ▼"}
                      </button>
                    </div>
                  ) : (
                    renderMessageContent(msg)
                  )}

                </div>
                


                <div className="flex items-center gap-2 px-1">
                  {msg.sender === 'ai' && <Bot className="w-2.5 h-2.5 text-indigo-400" />}
                  <span className="text-[7px] font-black text-[#484f58] uppercase tracking-widest">
                    {msg.sender === 'user' ? 'YOU' : activeAgent.toUpperCase().replace('_', ' ')}
                  </span>
                  {/* F2: error type badge for visual distinction */}
                  {isNetworkError && <span className="text-[7px] font-black uppercase tracking-widest text-red-400 bg-red-500/10 border border-red-500/20 rounded px-1 py-px">Network Error</span>}
                  {isAIError && <span className="text-[7px] font-black uppercase tracking-widest text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-1 py-px">AI Service</span>}
                  {/* B7: Model badge on AI messages */}
                  {msg.sender === 'ai' && msg.modelUsed && (
                    <span className="text-[7px] font-mono text-indigo-400/70 bg-indigo-900/20 border border-indigo-800/30 rounded px-1 py-px">
                      {msg.modelUsed}
                    </span>
                  )}
                  {msg.timestamp && (
                    <span className="text-[7px] text-[#30363d] font-mono">{formatMsgTime(msg.timestamp)}</span>
                  )}
                  {msg.sender === 'user' && <User className="w-2.5 h-2.5 text-indigo-400" />}
                  {/* B9: Edit user message button */}
                  {msg.sender === 'user' && (
                    <button
                      onClick={() => {
                        onInputChange(msg.text || '');
                        setEditingMsgId(msg.id);
                        setTimeout(() => textareaRef.current?.focus(), 50);
                      }}
                      title="Edit and resend this message"
                      className="opacity-0 group-hover/msg:opacity-100 transition-opacity p-0.5 hover:bg-white/10 rounded text-[#484f58] hover:text-indigo-400"
                    >
                      <MessageSquare className="w-2.5 h-2.5" />
                    </button>
                  )}
                  {/* Copy message button — appears on hover */}
                  <button
                    onClick={() => {
                      const t = msg.text || '';
                      navigator.clipboard.writeText(t).catch(() => {});
                      setCopiedMsgId(msg.id);
                      setTimeout(() => setCopiedMsgId(null), 1500);
                    }}
                    title="Copy message"
                    className="opacity-0 group-hover/msg:opacity-100 transition-opacity p-0.5 hover:bg-white/10 rounded text-[#484f58] hover:text-white"
                  >
                    {copiedMsgId === msg.id ? <Check className="w-2.5 h-2.5 text-emerald-400" /> : <Copy className="w-2.5 h-2.5" />}
                  </button>
                </div>
                {/* B3 — Regenerate: only on the last AI message */}
                {isLastAI && onSendSuggestion && (
                  <button
                    onClick={() => { if (messages.length > 0) onSendSuggestion(messages.filter(m => m.sender === 'user').at(-1)?.text || '__REGENERATE__'); }}
                    title="Regenerate response"
                    className="flex items-center gap-1 px-2 py-0.5 text-[8px] font-black uppercase tracking-widest rounded-lg bg-white/5 hover:bg-white/10 text-[#484f58] hover:text-white border border-white/5 transition-all"
                  >
                    ↺ Retry
                  </button>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>

        {/* B8: Typing indicator — three-dot bounce animation */}
        {isLoading && (
          <div
            role="status"
            aria-busy="true"
            aria-label="AI is generating a response"
            className="flex items-start gap-2 animate-in fade-in slide-in-from-left-2 duration-300"
          >
            <div className="w-6 h-6 rounded-full bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center shrink-0">
              <Bot className="w-3 h-3 text-indigo-400" />
            </div>
            <div className="bg-[#161b22] border border-white/5 rounded-2xl rounded-tl-none px-3 py-2.5 shadow-sm flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}

        {buildSteps && buildSteps.length > 0 && buildSteps.some(step => step.status === 'running') && activeAgent === 'navbharatai-pro' && (
          <div className="mt-4 p-4 bg-[#161b22] border border-white/5 rounded-2xl animate-in fade-in slide-in-from-bottom-4 duration-300">
             <span className="text-[9px] font-black uppercase tracking-widest text-[#8b949e] mb-3 block">Live Execution Progress</span>
             <AgentProgress steps={buildSteps} />
          </div>
        )}

        {pendingGHEdit && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-4 bg-indigo-600/10 border border-indigo-500/20 rounded-2xl space-y-3"
          >
            <div className="flex items-center gap-2">
              <Github className="w-4 h-4 text-indigo-400" />
              <span className="text-[10px] font-black uppercase text-indigo-400">GitHub Push Ready</span>
            </div>
            <p className="text-[10px] text-[#c9d1d9] font-medium leading-relaxed">
              I have prepared changes for <span className="text-white font-bold">{pendingGHEdit.path}</span>. Are you ready to push?
            </p>
            <button
              onClick={onConfirmPush}
              disabled={isPushing}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isPushing ? <TirangaLoader className="w-3 h-3" /> : <Send className="w-3 h-3" />}
              {isPushing ? 'Pushing...' : 'Confirm & Push to GitHub'}
            </button>
          </motion.div>
        )}

        {/* ── Guider Confirmation Card (Hybrid: propose → confirm before building) ── */}
        {guiderPlan && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-[#0d1117] border border-indigo-500/30 rounded-2xl overflow-hidden shadow-xl"
          >
            <div className="flex items-center gap-2 px-4 py-2.5 bg-indigo-500/10 border-b border-indigo-500/20">
              <span className="text-base">🧭</span>
              <span className="text-[10px] font-black uppercase tracking-widest text-indigo-300">Guider — Your Approval Needed</span>
            </div>
            <div className="px-4 py-3">
              <p className="text-[12px] leading-relaxed text-[#c9d1d9] whitespace-pre-wrap">{guiderPlan.designProposal}</p>
              {Array.isArray(guiderPlan.clarifyingQuestions) && guiderPlan.clarifyingQuestions.length > 0 && (
                <div className="mt-3 rounded-lg bg-white/5 border border-white/10 p-2.5">
                  <div className="text-[9px] font-black uppercase tracking-widest text-indigo-300/80 mb-1">Clarifying Questions</div>
                  <ul className="list-disc list-inside space-y-0.5">
                    {guiderPlan.clarifyingQuestions.map((q, i) => (
                      <li key={i} className="text-[11px] text-[#8b949e]">{q}</li>
                    ))}
                  </ul>
                </div>
              )}
              <textarea
                value={guiderInput}
                onChange={(e) => setGuiderInput(e.target.value)}
                placeholder="Suggest changes or answer the questions above… (optional)"
                rows={2}
                disabled={!!guiderReplanning}
                className="mt-3 w-full resize-none rounded-lg bg-[#161b22] border border-white/10 px-3 py-2 text-[12px] text-white placeholder-white/30 focus:outline-none focus:border-indigo-500/50 disabled:opacity-50"
              />
              <div className="mt-2.5 flex items-center gap-2">
                <button
                  onClick={() => { setGuiderInput(''); onGuiderApprove?.(); }}
                  disabled={!!guiderReplanning}
                  className="flex-1 px-3 py-2 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-500 text-white text-[11px] font-black uppercase tracking-wider hover:opacity-90 transition disabled:opacity-50"
                >
                  ✅ Approve — Build It
                </button>
                <button
                  onClick={() => { const t = guiderInput.trim(); if (t) { setGuiderInput(''); onGuiderSend?.(t); } }}
                  disabled={!!guiderReplanning || !guiderInput.trim()}
                  className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-[#c9d1d9] text-[11px] font-black uppercase tracking-wider hover:bg-white/10 transition disabled:opacity-40"
                  title="Edit the plan or answer the questions"
                >
                  {guiderReplanning ? '⏳ Thinking…' : '✏️ Send'}
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {/* ── Inline Build Progress Widget ── */}
        {buildProgress && (buildProgress.active || (buildProgress.steps.length > 0 && !buildProgressDismissed)) && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className={`border rounded-2xl overflow-hidden shadow-xl ${buildProgress.active ? 'bg-[#161b22] border-amber-500/20' : 'bg-[#161b22] border-white/10'}`}
          >
            {/* Header */}
            <div className="flex items-center gap-2 px-4 py-2.5 bg-[#0d1117] border-b border-white/5">
              <div className={`w-2 h-2 rounded-full ${buildProgress.active ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`} />
              <span className={`text-[9px] font-black uppercase tracking-widest ${buildProgress.active ? 'text-amber-400' : 'text-emerald-400'}`}>
                {buildProgress.active ? 'NavBharatAI v2.0 — Building' : 'Build Completed'}
              </span>
              {/* D7: estimated build time hint */}
              {buildProgress.active && !buildProgress.startedAt && (
                <span className="text-[8px] text-white/20 font-mono">~30–90s</span>
              )}
              {/* D23: build count badge */}
              {currentBuildCount > 0 && (
                <span className="text-[8px] font-black text-white/25 font-mono">#{currentBuildCount}</span>
              )}
              {/* D20: dismiss completed build widget */}
              {!buildProgress.active && (
                <button
                  onClick={() => setBuildProgressDismissed(true)}
                  title="Dismiss build log"
                  className="ml-auto p-1 text-white/20 hover:text-white/60 rounded"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
              {buildProgress.part && buildProgress.part > 1 && (
                <span className="px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-[8px] font-black uppercase tracking-wider text-amber-300">Part {buildProgress.part}</span>
              )}
              {buildProgress.tier && (
                <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider ${
                  buildProgress.tier === 'e2b' ? 'bg-green-500/15 border border-green-500/30 text-green-400' :
                  buildProgress.tier === 'cloudrun' ? 'bg-blue-500/15 border border-blue-500/30 text-blue-400' :
                  'bg-white/5 border border-white/10 text-[#484f58]'
                }`}>
                  {buildProgress.tier === 'e2b' ? 'E2B cloud' : buildProgress.tier === 'cloudrun' ? 'Server' : 'In-memory'}
                </span>
              )}
              <div className="ml-auto flex items-center gap-2">
                {buildProgress.startedAt && (
                  <span className="flex items-center gap-1 text-[8px] font-mono text-white/40" title="Time spent building so far">
                    <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
                    {buildElapsedLabel}
                  </span>
                )}
                <div
                  role="progressbar"
                  aria-valuenow={buildProgress.percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`Build progress: ${buildProgress.percent}%`}
                  className="h-1.5 w-20 bg-white/5 rounded-full overflow-hidden"
                >
                  <div
                    className="h-full rounded-full transition-[width] duration-700 ease-in-out"
                    style={{ width: `${Math.max(buildProgress.percent, buildProgress.active ? 3 : 0)}%`, background: 'linear-gradient(90deg,#f59e0b,#fbbf24)' }}
                  />
                </div>
                <span className="text-[8px] text-white/30 font-mono">{buildProgress.percent}%</span>
                <button
                  onClick={() => setProgressCollapsed(p => !p)}
                  className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 border border-white/10 text-[8px] font-black uppercase tracking-widest text-[#8b949e] hover:text-white transition-all"
                  title={progressCollapsed ? 'Show details' : 'Hide details'}
                >
                  {progressCollapsed ? '▼ Show' : '▲ Hide'}
                </button>
              </div>
            </div>
            {!progressCollapsed && (
              <>
                {/* Stage */}
                {buildProgress.stage && (
                  <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5">
                    <TirangaLoader className="w-3 h-3 flex-shrink-0" />
                    <span className="text-[11px] text-amber-300 font-medium">{buildProgress.stage}</span>
                  </div>
                )}
                {/* Steps */}
                <div className="px-4 py-2 space-y-1 max-h-56 overflow-y-auto">
                  {buildProgress.steps.map((step, i) => (
                    <div key={i} className="rounded-lg overflow-hidden border border-white/4">
                      <div
                        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-white/3 transition-colors"
                        onClick={() => step.code && onBuildStepToggle?.(i)}
                      >
                        <span className="text-[10px] w-3 text-center flex-shrink-0">
                          {step.status === 'done' ? '✓' : step.status === 'error' ? '✕' : step.status === 'running' ? '⟳' : '○'}
                        </span>
                        <span className={`text-[10px] flex-1 font-medium ${
                          step.status === 'done' ? 'text-white/70' : step.status === 'running' ? 'text-white' : step.status === 'error' ? 'text-red-400' : 'text-white/30'
                        }`}>{step.label}</span>
                        {step.sub && <span className="text-[8px] text-white/25">{step.sub}</span>}
                        {step.code && (
                          <span className="text-[8px] text-indigo-400">{step.expanded ? '▲' : '▼'}</span>
                        )}
                      </div>
                      {step.code && step.expanded && (
                        <div className="bg-[#0a0e14] border-t border-indigo-500/20 px-3 py-2 max-h-40 overflow-y-auto">
                          <pre className="text-[9px] text-cyan-300 font-mono leading-relaxed whitespace-pre-wrap break-all">
                            {step.code.slice(0, 3000)}{step.code.length > 3000 ? '\n...' : ''}
                          </pre>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {/* Footer */}
                <div className="px-4 py-2 border-t border-white/5 flex items-center justify-between gap-2">
                  <span className="text-[8px] text-white/25 font-mono">
                    {Object.keys(buildProgress.generatedFiles).length > 0
                      ? `${Object.keys(buildProgress.generatedFiles).length} file(s) generated`
                      : 'Working...'}
                  </span>
                  {/* D30: size warning for very large apps */}
                  {Object.keys(buildProgress.generatedFiles).length > 100 && (
                    <span className="text-[8px] font-black text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full" title="Large app: over 100 files generated. ZIP download may be slow.">
                      ⚠ Large app
                    </span>
                  )}
                  {/* F20: copy full build log */}
                  <button
                    onClick={() => {
                      const log = buildProgress.steps.map(s => `[${s.status}] ${s.label}${s.sub ? ` — ${s.sub}` : ''}${s.code ? '\n' + s.code : ''}`).join('\n');
                      navigator.clipboard.writeText(log).catch(() => {});
                    }}
                    title="Copy build log"
                    className="text-[8px] font-black uppercase tracking-widest text-[#30363d] hover:text-[#484f58] transition-colors ml-auto"
                  >
                    Copy Log
                  </button>
                </div>
              </>
            )}
          </motion.div>
        )}
      </div>

      {/* Mobile-only: "Preview ready" sticky banner above the input.
          The desktop floating button is hidden on sm- screens — this replaces it. */}
      {isAppBuilt && onPreviewClick && (
        <div className="sm:hidden flex items-center justify-between gap-3 px-4 py-2.5 bg-emerald-950/40 border-t border-emerald-500/20 select-none">
          <div className="flex items-center gap-2 min-w-0">
            <Zap className="w-3.5 h-3.5 text-emerald-400 shrink-0 animate-pulse" />
            <span className="text-emerald-400 text-[9px] font-black uppercase tracking-widest truncate">App ready!</span>
          </div>
          <button
            onClick={onPreviewClick}
            className="shrink-0 flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-[9px] font-black uppercase tracking-widest transition-all active:scale-95 shadow-lg"
          >
            View Preview →
          </button>
        </div>
      )}

      <div
        className="px-3 pt-2 border-t border-white/5 bg-[var(--theme-card)] backdrop-blur-xl select-none shadow-[0_-12px_40px_rgba(0,0,0,0.5)]"
        style={{ paddingBottom: kbHeight > 0 ? `${kbHeight + 8}px` : 'max(8px, env(safe-area-inset-bottom, 8px))' }}
      >
        <div className="max-w-4xl mx-auto space-y-1.5">
            {uploadError && (
              <div className="px-1">
                <p className="text-[9px] text-red-400 font-medium py-0.5">{uploadError}</p>
              </div>
            )}
            {attachments.length > 0 && (
              <div className="px-1 flex flex-wrap gap-1.5">
                {attachments.map((file, index) => (
                  <div key={index} className="flex items-center gap-1 bg-[#161b22] border border-white/10 px-2 py-0.5 rounded-md text-[9px] text-[#8b949e] max-w-[160px]">
                    <span className="truncate">{file.name}</span>
                    <button onClick={() => removeAttachment(index)} className="hover:text-white ml-1 shrink-0 leading-none">×</button>
                  </div>
                ))}
              </div>
            )}
            {/* Composer actions — moved ABOVE the input (admin 2026-07-15): a compact chip row so the
                on-screen keyboard never hides them and they read as real, tappable buttons on the native
                app. The parent's space-y handles the gap to the input below. */}
            <div className="flex items-center justify-between px-0.5">
              <div className="flex items-center gap-2 min-w-0">
                {isPinned && (
                  <div className="flex items-center gap-1 text-[8px] font-black text-amber-500 uppercase tracking-widest bg-amber-500/10 px-1.5 py-0.5 rounded-full border border-amber-500/20">
                    <Zap className="w-2 h-2 fill-current" />
                    Pinned
                  </div>
                )}
                {input.length > 60 && (
                  <span className={`text-[9px] font-mono ${input.length > 1000 ? 'text-amber-400' : 'text-[#484f58]'}`}>
                    {input.length}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {/* Enter sends toggle */}
                <button
                  onClick={() => { const v = !sendOnEnter; setSendOnEnter(v); localStorage.setItem('chat_sendOnEnter', String(v)); }}
                  title={sendOnEnter ? 'Enter sends message (click to toggle)' : 'Shift+Enter sends (click to toggle)'}
                  className="text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded-lg bg-white/5 text-[#8b949e] hover:text-white hover:bg-white/10 transition-all active:scale-95"
                >
                  {sendOnEnter ? '↵ Send' : '⇧↵ Send'}
                </button>
                {messages.length > 0 && (
                  <>
                    {/* Toggle chat search */}
                    <button
                      onClick={() => { setShowChatSearch(v => !v); if (showChatSearch) setChatSearchQuery(''); }}
                      title="Search messages (Ctrl+F)"
                      className={`text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded-lg transition-all active:scale-95 ${showChatSearch ? 'bg-indigo-600/20 text-indigo-400' : 'bg-white/5 text-[#8b949e] hover:text-white hover:bg-white/10'}`}
                    >
                      Search
                    </button>
                    {/* Export chat as markdown */}
                    <button
                      onClick={() => {
                        const md = messages.map(m => {
                          const role = m.sender === 'user' ? '**You**' : '**AI**';
                          return `${role}\n\n${m.text || ''}\n`;
                        }).join('\n---\n\n');
                        const blob = new Blob([md], { type: 'text/markdown' });
                        const a = document.createElement('a');
                        a.href = URL.createObjectURL(blob);
                        a.download = `chat-${new Date().toISOString().slice(0, 10)}.md`;
                        a.click();
                        URL.revokeObjectURL(a.href);
                      }}
                      title="Export chat as Markdown"
                      className="text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded-lg bg-white/5 text-[#8b949e] hover:text-white hover:bg-white/10 transition-all active:scale-95"
                    >
                      Export
                    </button>
                    <button
                      onClick={() => { if (window.confirm('Clear conversation?')) { onSendSuggestion?.('__CLEAR_CHAT__'); } }}
                      title="Clear conversation"
                      className="text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded-lg bg-white/5 text-[#8b949e] hover:text-white hover:bg-white/10 transition-all active:scale-95"
                    >
                      Clear
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-2xl focus-within:border-indigo-500 transition-all">
                  <div className="relative flex items-center">
                  {/* File inputs now live inside <AttachMenu/> (photo / gallery / file) near the send row. */}
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => {
                      onInputChange(e.target.value);
                      e.target.style.height = 'auto';
                      e.target.style.height = `${Math.min(e.target.scrollHeight, 240)}px`;
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && sendOnEnter && !isLoading && (input.trim() || attachments.length > 0)) {
                        e.preventDefault();
                        onSend(attachments);
                        setAttachments([]);
                        setEditingMsgId(null);
                      }
                    }}
                    onPaste={handlePaste}
                    placeholder="Ask NavBharatAI..."
                    rows={1}
                    className={cn(
                      // Admin 2026-07-12: composer was py-3.5 + min-h-48px (~2 lines) and felt oversized on
                      // phones — trim to a single comfortable line; it still auto-grows up to 240px as you type.
                      "w-full bg-transparent text-[var(--theme-text)] pr-24 py-2.5 text-xs outline-none transition-all resize-none min-h-[40px] leading-relaxed text-[16px]",
                      onModeChange && activeAgent === 'navbharatai-pro' ? "pl-32" : "pl-5"
                    )}
                    style={{ maxHeight: '240px', overflowY: 'auto' }}
                  />
                  {pasteLineCount > 20 && (
                    <div className="absolute left-2 top-2 bg-amber-500/20 border border-amber-500/40 rounded-lg px-2 py-0.5 text-[9px] font-black text-amber-400 pointer-events-none z-10">
                      {pasteLineCount} lines pasted
                    </div>
                  )}
                  {( (input || '').length > 300 || (((input || '').match(/\n/g) || []).length > 4)) && (
                    <button
                      type="button"
                      onClick={() => setIsExpanded(true)}
                      className="absolute right-20 bottom-2 p-2 text-gray-500 hover:text-white transition-colors"
                    >
                      <Maximize2 size={16} />
                    </button>
                  )}
                  {onModeChange && activeAgent === 'navbharatai-pro' && (
                    <div className="absolute left-2 top-3 z-50 pointer-events-auto">
                      <ModeSelector mode={mode || 'chat'} setMode={onModeChange} />
                    </div>
                  )}
                  <div className="absolute right-2 bottom-2 flex gap-1 items-center">
                    <AttachMenu
                      onFiles={addPickedFiles}
                      fileAccept="image/*,.pdf,.jpg,.jpeg,.png,.gif,.webp,.txt,.md,.csv,.json,.html,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.zip,.js,.ts,.tsx,.jsx,.py,.css,.xml,.yaml,.yml,.go,.java,.php,.sql,.rs,.kt,.swift,.rb,.sh,.env,.toml,.ini"
                      badge={attachments.length}
                      title="Attach (photo, gallery, or file)"
                      buttonClassName="p-2.5 text-gray-500 hover:text-indigo-400 transition-colors"
                    />
                    {voiceSupported && (
                      <button
                        type="button"
                        onClick={isListening ? stopVoice : startVoice}
                        title={isListening ? 'Stop voice input' : 'Voice input'}
                        aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
                        className={`p-2.5 transition-colors ${isListening ? 'text-red-400 animate-pulse' : 'text-gray-500 hover:text-blue-400'}`}
                      >
                        {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                      </button>
                    )}
                    {isLoading && onStop ? (
                      <button
                        onClick={() => {
                          if (window.confirm('Stop the current AI generation?')) onStop?.();
                        }}
                        title="Stop generation"
                        className="p-3 bg-red-600 text-white rounded-xl hover:bg-red-500 transition-all flex items-center justify-center shadow-lg active:scale-95"
                      >
                        <span className="w-3.5 h-3.5 flex items-center justify-center font-black text-[11px]">■</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          navigator.vibrate?.(30);
                          onSend(attachments);
                          setAttachments([]);
                          setEditingMsgId(null);
                        }}
                        disabled={(!input.trim() && attachments.length === 0) || isLoading}
                        className="p-3 bg-indigo-600 text-white rounded-xl disabled:opacity-20 hover:bg-indigo-700 transition-all flex items-center justify-center shadow-lg active:scale-95"
                      >
                        <Send className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  </div>{/* end inner flex row */}
            </div>{/* end rounded input container */}
        </div>
      </div>
    </div>
  );
};

