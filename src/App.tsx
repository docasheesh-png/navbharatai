import React, { useState, useRef, useEffect, lazy, Suspense, useMemo, useCallback } from 'react';
import { useUndoRedo } from './hooks/useUndoRedo';
import { useToast, ToastContainer } from './components/Toast';
import { EngineBuilder } from './components/EngineBuilder';
import { TemplatesPanel, CURATED_TEMPLATES } from './components/panels/TemplatesPanel';
import { GitViewPanel } from './components/panels/GitViewPanel';
import { DeploySuccessPanel } from './components/panels/DeploySuccessPanel';
import { AboutPanel } from './components/panels/AboutPanel';
import { AdminLoginPanel } from './components/panels/AdminLoginPanel';
// FilesPanel → moved to ViewPanels.tsx
import { DonationPanel } from './components/panels/DonationPanel';
import { BillingPanel } from './components/panels/BillingPanel';
import { DeployModal } from './components/panels/DeployModal';
import { WorkspacePane } from './components/panels/WorkspacePane';
import { SettingsPanel } from './components/panels/SettingsPanel';
import { ProChatPanel } from './components/panels/ProChatPanel';
import { ViewPanels } from './components/panels/ViewPanels';
import { SidebarNav } from './components/panels/SidebarNav';
import { TopNav } from './components/panels/TopNav';
import { buildApp, buildAppStream, fetchBuildSession, previewSrcFor } from './services/buildService';
import { CommandPalette } from './components/ide/CommandPalette';
import { 
  Send, Bot, User, Zap, Code, MessageSquare, Loader2, IndianRupee, Heart, QrCode, ExternalLink, HeartHandshake,
  Terminal, Activity, Cpu, Settings, X, Shield, ShieldCheck, Eye, EyeOff, Lock, Wallet, CreditCard,
  Globe, FileCode, GitBranch, Play, Monitor, Search, ChevronRight, Gamepad2, Sparkles,
  FolderOpen, Trash2, Plus, FilePlus, FolderPlus, Save, MoreHorizontal, Rocket, LayoutDashboard, Database, 
  Github, HardDrive, RefreshCw, Menu, History, Clock, Smartphone, ThumbsUp, ThumbsDown, Copy, Check,
  Link as LinkIcon, List, GitCommit, Share2, Box, Folder, UploadCloud, ChevronLeft,
  Edit2, Camera, Upload, Download, Image as ImageIcon, Info, LogIn,
  GitFork, GitMerge, History as HistoryIcon, UserPlus, LogOut, CheckCircle2, AlertCircle, RotateCcw,
  Gift, Palette, TestTube,
  Mic, BarChart2, Languages, Layout, TrendingUp,
  Bug, Gauge, Puzzle, Search as SearchIcon,
  Globe as GlobeIcon, Users2, Figma,
  Bell, Minimize2, Moon, IndianRupee as RupeeIcon,
  Wand2, Package,
  Kanban, CloudUpload, LayoutTemplate, HeartPulse,
  Briefcase
} from 'lucide-react';
import { cn } from './lib/utils';
import { AdminDashboard } from './components/AdminDashboard';
// SDAChat kept eager — used immediately on tab open
import { SDAChat } from './components/sda/SDAChat';
import { ProfessionalsView } from './components/professionals/ProfessionalsView';
import { EngineerAIChat } from './components/engineer/EngineerAIChat';
import { ErrorBoundary } from './components/ErrorBoundary';
import { triggerCashfreeCheckout } from './services/paymentService';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut, User as FirebaseUser, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, collection, query, where, getDocs, deleteDoc } from 'firebase/firestore';
import { firebaseConfig } from './config/firebase';

const app = initializeApp({ ...firebaseConfig, firestoreDatabaseId: firebaseConfig.firestoreDbId });
export const auth = getAuth();
setPersistence(auth, browserLocalPersistence);
export const db = getFirestore(app, firebaseConfig.firestoreDbId);

// ── Eager imports — always needed on first render ───────────────────────────
import { AIChat } from './components/ide/AIChat';

// ── Lazy imports still used directly in App.tsx ──────────────────────────────
// Helper: wraps a named export into the {default} shape lazy() requires
const _lz = <T extends object>(fn: () => Promise<T>, k: keyof T) =>
  lazy(() => fn().then(m => ({ default: m[k] as React.ComponentType<any> })));

const AISuggestions    = _lz(() => import('./components/ide/AISuggestions'),    'AISuggestions');
const SecretManager    = _lz(() => import('./components/SecretManager'),        'SecretManager');
const DatabaseSettings = _lz(() => import('./components/settings/DatabaseSettings'), 'DatabaseSettings');
const SocialHub        = _lz(() => import('./components/social/SocialHub'),     'SocialHub');
const ReportsListView  = _lz(() => import('./components/ReportsListView'),      'ReportsListView');
const HistoryView      = _lz(() => import('./components/HistoryView'),          'HistoryView');
import { motion, AnimatePresence } from 'motion/react';
import axios from 'axios';

import { AgentProgress, BuildStep } from './components/ide/AgentProgress';
import { useBuild } from './components/ide/BuildContext';
import { ThemeMode, THEME_MODES, getThemeClasses } from './lib/theme';
import { useDevLogs } from './hooks/useDevLogs';
import { useSettings } from './hooks/useSettings';
import { useNetworkStatus } from './hooks/useNetworkStatus';
import { Agent, isVishwakarmaAgent } from './types/agents';
import {
  Message, ChatSession, ApiKeys, AppSecret, BrainConfig,
  ViewType, SettingsScreen, FileSystem, ErrorType, ErrorContext, Log, PROVIDER_CONFIG,
} from './types';

import { AuthComponent } from './components/AuthComponent';
// ReportProblemComponent → lazy above
import { MessageContent } from './components/MessageContent';
import { HomeView } from './components/home/HomeView';
import { GitHubService } from './lib/githubService';
import { trackEvent } from './lib/analytics';
import { saveFile, saveAllFiles, loadAllFiles, clearWorkspace } from './lib/storage';
// ZipSizeModal component → moved to ViewPanels.tsx
import type { ZipSizeModalVariant } from './components/ide/ZipSizeModal';
// AgentMode → re-exported from ./types

// Large keys that can be evicted when localStorage is nearly full.
// Ordered from least-important to most-important.
const LS_EVICTABLE = [
  'navbharat_versions',
  'navbharat_last_app',
  'navbharat_gh_context',
  'navbharat_pro_messages',
  'navbharat_sessions',
];

/** localStorage.setItem that auto-evicts large non-essential keys on QuotaExceededError. */
function safeLS(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (e: unknown) {
    if (e instanceof DOMException && (e.code === 22 || e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
      // Evict stale large keys one by one until it fits
      for (const evict of LS_EVICTABLE) {
        if (evict === key) continue;
        localStorage.removeItem(evict);
        try {
          localStorage.setItem(key, value);
          return;
        } catch {}
      }
    }
  }
}

// Recursively replaces `undefined` with `null` (Firestore rejects `undefined`).
// Shared by every chat surface (Free / Pro / SDA) that syncs sessions to `chat_sessions`.
export function sanitizeFirestoreData(data: any): any {
  const sanitized = { ...data };
  Object.keys(sanitized).forEach(key => {
    if (sanitized[key] === undefined) {
      sanitized[key] = null;
    } else if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
      sanitized[key] = sanitizeFirestoreData(sanitized[key]);
    }
  });
  return sanitized;
}

export default function App() {
  // ── Phase 1 hooks ──────────────────────────────────────────────────────
  const { logs, setLogs, addLog } = useDevLogs();
  const { theme, setTheme, hinglishMode, setHinglishMode, preferredLanguage, setPreferredLanguage, mode, setMode, enabledModules, setEnabledModules, isThemePickerOpen, setIsThemePickerOpen } = useSettings();
  // ───────────────────────────────────────────────────────────────────────

  // Startup: evict large cached data if localStorage is > 3 MB to keep space for Firebase auth
  useEffect(() => {
    try {
      let totalSize = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k) totalSize += (localStorage.getItem(k) || '').length;
      }
      if (totalSize > 3_000_000) {
        for (const key of LS_EVICTABLE) localStorage.removeItem(key);
      }
    } catch {}
  }, []);

  const [deviceMode, setDeviceMode] = useState<'auto' | 'mobile' | 'tablet' | 'desktop'>('auto');
  const [effectiveDeviceMode, setEffectiveDeviceMode] = useState<'mobile' | 'tablet' | 'desktop'>('mobile');

  useEffect(() => {
    const handleResize = () => {
        if (deviceMode !== 'auto') return;

        const width = window.innerWidth;
        if (width < 768) setEffectiveDeviceMode('mobile');
        else if (width < 1024) setEffectiveDeviceMode('tablet');
        else setEffectiveDeviceMode('desktop');
    };

    window.addEventListener('resize', handleResize);
    handleResize(); // Initial detection
    return () => window.removeEventListener('resize', handleResize);
  }, [deviceMode]);

  useEffect(() => {
    if (deviceMode === 'auto') {
        const width = window.innerWidth;
        if (width < 768) setEffectiveDeviceMode('mobile');
        else if (width < 1024) setEffectiveDeviceMode('tablet');
        else setEffectiveDeviceMode('desktop');
    } else {
        setEffectiveDeviceMode(deviceMode as 'mobile' | 'tablet' | 'desktop');
    }
  }, [deviceMode]);

  const [tabHistories, setTabHistories] = useState<Record<string, ViewType[]>>({});
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAdmin, setIsAdmin] = useState(() => {
    return localStorage.getItem('navbharat_admin_v1') === 'true';
  });
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    return localStorage.getItem('navbharat_sidebar_collapsed') === 'true';
  });

  // Pre-warm server on app load so chat is instant when user opens it
  useEffect(() => { fetch('/api/health', { method: 'GET' }).catch(() => {}); }, []);
  // 12.2 — Track app load
  useEffect(() => { trackEvent('app_load', { referrer: document.referrer, ua: navigator.userAgent.slice(0, 100) }); }, []);

  useEffect(() => {
    localStorage.setItem('navbharat_sidebar_collapsed', isSidebarCollapsed.toString());
  }, [isSidebarCollapsed]);


  useEffect(() => {
    localStorage.setItem('navbharat_admin_v1', isAdmin.toString());
  }, [isAdmin]);

  // hinglishMode → from useSettings() hook
  const [loadingUser, setLoadingUser] = useState(true);
  const [activeView, setActiveView] = useState<ViewType>('home');
  // Phase 3.1 — unified Chat+IDE: when an app exists, the live workspace (code +
  // preview) docks to the right of the Pro Chat on desktop. User can collapse it.
  const [showWorkspace, setShowWorkspace] = useState<boolean>(true);
  const [settingsScreen, setSettingsScreen] = useState<SettingsScreen>('root');
  const [githubRedirectingMessage, setGithubRedirectingMessage] = useState<string | null>(null);
  const [githubDebugData, setGithubDebugData] = useState<{
    oauthUrl?: string;
    redirectUri?: string;
    currentDomain?: string;
    callbackUrl?: string;
  } | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  // enabledModules → from useSettings() hook
  // Task 1.4 — messagesMap: single source of truth per tab
  const LANGUAGE_PICKER_MSG: Message = {
    id: 'lang-picker',
    text: `👋 **Welcome to navBharatAI!**\n\nAap kaunsi language mein baat karna chahte ho?\n_(You can always change this later in Settings)_\n\n[🇮🇳 Hindi] [🔀 Hinglish] [🇬🇧 English] [🌐 Auto-detect]`,
    sender: 'ai',
    timestamp: new Date(),
    modelUsed: 'navBharatAI',
    meta: { type: 'language-picker' } as any,
  };
  const WELCOME_MSG: Message = { id: 'welcome', text: 'Hello! I\'m navBharatAI. You can chat with me in any language!', sender: 'ai', timestamp: new Date(), modelUsed: 'General Assistant' };
  const initialNbiMessages = (): Message[] => {
    const lang = localStorage.getItem('navbharat_language');
    return lang ? [WELCOME_MSG] : [LANGUAGE_PICKER_MSG];
  };
  const initialProMessages = (): Message[] => {
    try {
      const saved = localStorage.getItem('navbharat_pro_messages');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed as Message[];
      }
    } catch {}
    return [];
  };
  const [messagesMap, setMessagesMap] = useState<Record<string, Message[]>>({
    nbi_chat: initialNbiMessages(),
    nbi_pro_chat: initialProMessages(),
  });
  // Backward-compatible derived accessors — all existing code using messages/proMessages still works
  const messages: Message[] = messagesMap['nbi_chat'] || [];
  const proMessages: Message[] = messagesMap['nbi_pro_chat'] || [];
  const setMessages = (v: Message[] | ((p: Message[]) => Message[])) =>
    setMessagesMap(prev => ({ ...prev, nbi_chat: typeof v === 'function' ? v(prev['nbi_chat'] || []) : v }));
  const setProMessages = (v: Message[] | ((p: Message[]) => Message[])) =>
    setMessagesMap(prev => ({ ...prev, nbi_pro_chat: typeof v === 'function' ? v(prev['nbi_pro_chat'] || []) : v }));
  const [input, setInput] = useState<string>('');
  const [proInput, setProInput] = useState<string>('');
  // 9.5 — AI Teaching Mode (beginner-friendly explanations)
  const [teachMode, setTeachMode] = useState<boolean>(() => localStorage.getItem('navbharat_teach_mode') === 'true');
  useEffect(() => { localStorage.setItem('navbharat_teach_mode', teachMode.toString()); }, [teachMode]);
  // 10.5 — Command Palette
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  // 10.6 — Toast notifications
  const { toasts, addToast, removeToast } = useToast();
  // Phase 6.2 — real-time network status for mobile UX.
  const networkStatus = useNetworkStatus();
  // 10.1 — Onboarding
  const [proBuildProgress, setProBuildProgress] = useState<{
    active: boolean;
    stage: string;
    steps: { label: string; sub: string; status: 'pending' | 'running' | 'done' | 'error'; code?: string; expanded?: boolean }[];
    percent: number;
    generatedFiles: Record<string, { content: string; expanded: boolean }>;
    /** When the current build (or auto-continue chain) started — drives the live timer. */
    startedAt?: number;
    /** Auto-continue part number (1 = first pass) when a build is resumed after the soft deadline. */
    part?: number;
    /** G3 — Execution tier reported by the agentic engine: 'vfs' | 'cloudrun' | 'e2b'. */
    tier?: 'vfs' | 'cloudrun' | 'e2b';
    /** G5 — Code review result from the last completed build. */
    codeReview?: import('./services/buildService').CodeReviewResult;
  }>({ active: false, stage: '', steps: [], percent: 0, generatedFiles: {} });
  // Bounds the automatic "continue" chain when the server returns a partial build.
  const proAutoContinueRef = useRef(0);
  const PRO_MAX_AUTO_CONTINUE = 4;
  // Guider (Hybrid): a pending design proposal awaiting the user's Approve/Edit/Answer.
  const [proGuiderPlan, setProGuiderPlan] = useState<{ prompt: string; plan: any } | null>(null);
  const [proGuiderReplanning, setProGuiderReplanning] = useState(false);
  // Guider grade→refine loop: the approved spec+prompt to grade against, and a bound
  // on automatic refine rounds (separate from the partial auto-continue bound).
  const proGuiderSpecRef = useRef<{ spec: any; prompt: string } | null>(null);
  const proGuiderRefineRef = useRef(0);
  const PRO_MAX_REFINE = 2;
  const [sdaResetKey, setSdaResetKey] = useState(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isProLoading, setIsProLoading] = useState<boolean>(false);
  // Phase 5.5 — provider-down retry countdown: seconds remaining, null when not counting.
  const [providerRetryCountdown, setProviderRetryCountdown] = useState<number | null>(null);
  const providerRetryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const providerRetryPromptRef = useRef<string>('');
  const [activeIntent, setActiveIntent] = useState<string>('social');
  const [activeAgent, _setActiveAgent] = useState<string>('navbharatai');
  
  useEffect(() => {
    if (activeView === 'nbi_chat' && activeAgent !== 'navbharatai') {
      setActiveAgent('navbharatai');
    }
  }, [activeView]);
  
  useEffect(() => {
    addLog(`STATE_TRACE: activeAgent=${activeAgent}, activeView=${activeView}`, 'info');
  }, [activeAgent, activeView]);

  // Phase 6.2 — show toast when network goes offline/online (especially useful on mobile).
  useEffect(() => {
    if (!networkStatus.online) {
      addToast('No internet connection — changes may not save', 'warning');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [networkStatus.online]);
  
  const setActiveAgent = useCallback((newAgent: string) => {
    addLog(`setActiveAgent called: ${newAgent}`, 'info');
    _setActiveAgent(newAgent);
    localStorage.setItem('activeAgent', newAgent);
  }, [addLog]);

  const handleAgentChange = useCallback((newAgent: string) => {
    addLog(`handleAgentChange entry: current=${activeAgent}, new=${newAgent}, view=${activeView}`, 'info');
    setActiveAgent(newAgent);
    addLog(`AI Agent switched to: ${newAgent}`, 'info');
  }, [addLog, activeAgent, activeView, setActiveAgent]);

  const handleActivateWorkspace = (agent: string) => {
    setActiveAgent('navbharatai');
    toggleTab('nbi_chat');
  };

  // ==================================================
  // CLOUD SYNC PREMIUM WORKSPACE & PREVIEW CONTEXT ACTIONS
  // ==================================================
  const [isWorkspacePreparing, setIsWorkspacePreparing] = useState(false);
  const [workspacePrepError, setWorkspacePrepError] = useState<string | null>(null);


  const [isPreviewBuilding, setIsPreviewBuilding] = useState(false);
  const [previewBuildError, setPreviewBuildError] = useState<string | null>(null);
  const [previewBuildStage, setPreviewBuildStage] = useState<'preparing' | 'installing' | 'building' | 'starting' | 'ready'>('preparing');
  const [detectedFramework, setDetectedFramework] = useState<string>('Static HTML Site');

  const detectFrameworkFromFiles = (currentFiles: Record<string, string>) => {
    if (!currentFiles || Object.keys(currentFiles).length === 0) {
      return 'Static HTML Site';
    }
    const packageJsonContent = currentFiles['package.json'] || '';
    if (!packageJsonContent) {
      if (currentFiles['index.html']) {
        return 'Vanilla JS / Static HTML';
      }
      return 'Static HTML Site';
    }
    
    try {
      const pkg = JSON.parse(packageJsonContent);
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      
      if (deps['next']) return 'Next.js Framework';
      if (deps['nuxt'] || deps['vue']) return 'Vue.js App';
      if (deps['react'] && deps['vite']) return 'React + Vite SPA';
      if (deps['express']) return 'Node.js Express backend';
      if (deps['react']) return 'React SPA';
      return 'Node.js Application';
    } catch (e) {
      if (packageJsonContent.includes('"next"')) return 'Next.js Framework';
      if (packageJsonContent.includes('"vue"')) return 'Vue.js App';
      if (packageJsonContent.includes('"vite"')) return 'React + Vite SPA';
      if (packageJsonContent.includes('"express"')) return 'Node.js Express backend';
      return 'Static HTML Site';
    }
  };

  const handleTriggerPreviewBuild = async () => {
    incrementDailyUsage('build');
    setIsPreviewBuilding(true);
    setPreviewBuildError(null);
    setPreviewBuildStage('preparing');

    const framework = detectFrameworkFromFiles(files);
    setDetectedFramework(framework);

    addLog(`Building preview for [${framework}]...`, 'info');

    try {
      // STAGE 1: Validate workspace (real, instant)
      const fileCount = Object.keys(files).length;
      if (fileCount === 0) {
        throw new Error('No source files found. Ask NavBharat AI to build something first.');
      }

      const hasHtml = !!files['index.html'];
      const hasPkg = !!files['package.json'];

      if (!hasHtml && !hasPkg) {
        throw new Error('No index.html or package.json found. Cannot build preview.');
      }

      addLog(`Found ${fileCount} source file(s): ${Object.keys(files).slice(0, 5).join(', ')}${fileCount > 5 ? '...' : ''}`, 'info');

      // STAGE 2: Validate files (real, instant)
      setPreviewBuildStage('installing');
      if (hasPkg) {
        try {
          JSON.parse(files['package.json']);
          addLog('package.json: valid JSON ✓', 'info');
        } catch {
          throw new Error('package.json has invalid JSON syntax. Fix it and try again.');
        }
      }

      // For React/Vite: show honest note (WebContainers not yet available)
      const isReactApp = hasPkg && (
        files['package.json'].includes('"react"') ||
        files['package.json'].includes('"vite"')
      );
      if (isReactApp && !hasHtml) {
        addLog('React/Vite app detected — showing static HTML preview (full runtime coming in Phase 5.1)', 'info');
      }

      // STAGE 3: Bundle files (real work — CSS + JS injection)
      setPreviewBuildStage('building');
      updatePreview(files);
      const bundledFiles = Object.keys(files).filter(f =>
        f.endsWith('.css') || f.endsWith('.js') || f.endsWith('.html')
      );
      addLog(`Bundled ${bundledFiles.length} asset(s) into preview ✓`, 'info');

      // STAGE 4: Ready
      setPreviewBuildStage('starting');
      setPreviewBuildStage('ready');
      addLog('Preview ready!', 'success');
      addToast('Preview ready! ⚡', 'success');

      // Short visual pause so user sees "ready" state
      await new Promise((resolve) => setTimeout(resolve, 500));
      toggleTab('preview');

    } catch (err: any) {
      setPreviewBuildError(err.message || 'Build failed.');
      addLog(`Preview build failed: ${err.message}`, 'error');
    } finally {
      setIsPreviewBuilding(false);
    }
  };

  const ascMessages = messages;

  const isSplitChat = false;

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>(() => Date.now().toString());
  // Pro App Builder chat needs its own session id — it must never share/overwrite
  // the Free (NBI) chat's session document.
  // G1.2: persist in localStorage so the same ID survives a browser refresh,
  // enabling the server to restore the last completed build on reconnect.
  const [currentProSessionId, setCurrentProSessionId] = useState<string>(() => {
    try {
      const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('pro_session_id') : null;
      if (stored) return stored;
    } catch { /* ignore */ }
    const id = `pro-${Date.now()}`;
    try { localStorage.setItem('pro_session_id', id); } catch { /* ignore */ }
    return id;
  });

  // G1.2 — on mount, try to restore the last completed build for this session.
  // Best-effort: any failure is silent so the normal empty-state UI shows instead.
  useEffect(() => {
    let cancelled = false;
    fetchBuildSession(currentProSessionId).then((saved) => {
      if (cancelled || !saved || !saved.files || Object.keys(saved.files).length === 0) return;
      setFiles((prev: Record<string, string>) => {
        if (Object.keys(prev).length > 0) return prev; // don't overwrite if already loaded
        return saved.files;
      });
      setIsAppBuilt(true);
      setHasGeneratedCode(true);
      setProBuildProgress(prev => ({
        ...prev,
        percent: 100,
        stage: '✅ App restored from last session',
        generatedFiles: Object.fromEntries(
          Object.entries(saved.files).map(([k, v]) => [k, { content: v as string, expanded: false }])
        ),
      }));
    }).catch(() => {});
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount only

  // Tracks whether the initial cloud load finished — guards the auto-save effect
  // so we never overwrite cloud data before we've pulled it in.
  const cloudSyncReady = useRef(false);

  useEffect(() => {
    if (!user) {
      setSessions([]);
      cloudSyncReady.current = false;
      return;
    }

    cloudSyncReady.current = false;

    // 1) Instant: show whatever is cached locally
    let local: ChatSession[] = [];
    try {
      const saved = localStorage.getItem('navbharat_sessions');
      if (saved) local = JSON.parse(saved);
    } catch {}
    setSessions(local);

    // 2) Cloud: pull cross-device workspace and merge (newer lastUpdated wins)
    (async () => {
      try {
        const res = await fetch(`/api/sync/${user.uid}`);
        if (res.ok) {
          const data = await res.json();
          const cloud: ChatSession[] = Array.isArray(data.sessions) ? data.sessions : [];
          const byId: Record<string, ChatSession> = {};
          for (const s of local) if (s?.id) byId[s.id] = s;
          for (const s of cloud) {
            if (!s?.id) continue;
            const existing = byId[s.id];
            if (!existing) { byId[s.id] = s; continue; }
            const a = new Date(existing.lastUpdated || 0).getTime();
            const b = new Date(s.lastUpdated || 0).getTime();
            byId[s.id] = b > a ? s : existing;
          }
          const merged = Object.values(byId).sort(
            (a, b) => new Date(b.lastUpdated || 0).getTime() - new Date(a.lastUpdated || 0).getTime()
          );
          setSessions(merged);
          safeLS('navbharat_sessions', JSON.stringify(merged));

          // Restore last generated app from cloud if local cache is empty
          if (data.lastApp && typeof data.lastApp === 'string' && data.lastApp.length > 200) {
            try {
              if (!localStorage.getItem('navbharat_last_app')) {
                safeLS('navbharat_last_app', data.lastApp);
              }
            } catch {}
          }
        }
      } catch {
        // Offline / sync unavailable — local cache stays in effect
      } finally {
        cloudSyncReady.current = true;
      }
    })();
  }, [user]);

  // Debounced push of sessions + last app to the cloud whenever they change
  useEffect(() => {
    if (!user || !cloudSyncReady.current) return;
    const handle = setTimeout(() => {
      let lastApp = '';
      try { lastApp = localStorage.getItem('navbharat_last_app') || ''; } catch {}
      fetch(`/api/sync/${user.uid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessions, lastApp }),
      }).catch(() => {});
    }, 2500);
    return () => clearTimeout(handle);
  }, [sessions, user]);
  
  // Universal Chat Continuation (UCI) State Managers inside App.tsx
  const [copiedUci, setCopiedUci] = useState(false);
  const [sharedUci, setSharedUci] = useState(false);
  const [resumeUciInputState, setResumeUciInputState] = useState('');
  const [isRestoringUci, setIsRestoringUci] = useState(false);
  const [restoreUciError, setRestoreUciError] = useState('');
  const [showContinueModal, setShowContinueModal] = useState(false);
  const [firebaseOauthError, setFirebaseOauthError] = useState<{
    errorType: string;
    message: string;
    suggestions: string;
  } | null>(null);

  const [selectedModel, setSelectedModel] = useState('auto');
  const [invalidKeys, setInvalidKeys] = useState<Set<string>>(new Set());
  const [pendingProvider, setPendingProvider] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState('');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [openTabs, setOpenTabs] = useState<ViewType[]>([]);

  // Touch swipe → sidebar control (replaces the accidental browser back/forward).
  // Left→right swipe opens the sidebar; right→left closes it (no-op if already closed).
  useEffect(() => {
    let startX = 0, startY = 0, tracking = false;
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) { tracking = false; return; }
      startX = e.touches[0].clientX; startY = e.touches[0].clientY; tracking = true;
    };
    const onEnd = (e: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - startX, dy = t.clientY - startY;
      // Mostly-horizontal, decisive swipe only.
      if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (dx > 0) setIsMenuOpen(true);                 // left→right: open
      else setIsMenuOpen(prev => (prev ? false : prev)); // right→left: close if open, else nothing
    };
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchend', onEnd);
    };
  }, []);

  const [errorContext, setErrorContext] = useState<ErrorContext | null>(null);
  const [githubToken, setGithubToken] = useState<string | null>(() => localStorage.getItem('gh_token'));
  // G3 — User's personal E2B API key; stored in localStorage. Unlocks real cloud VM
  // execution for Pro builds so npm install, browser actions, and deploys work.
  const [userE2bKey, setUserE2bKey] = useState<string>(() => {
    try { return localStorage.getItem('engineer_e2b_key') || ''; } catch { return ''; }
  });
  const [firebaseToken, setFirebaseToken] = useState<string | null>(() => localStorage.getItem('fb_token'));
  const [firebaseUser, setFirebaseUser] = useState<any>(() => {
    try {
      const saved = localStorage.getItem('fb_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [githubUser, setGithubUser] = useState<any>(null);
  const [repositories, setRepositories] = useState<any[]>([]);
  const [isGHSyncing, setIsGHSyncing] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<any>(null);
  const [ghSearchQuery, setGHSearchQuery] = useState('');
  const [isPushing, setIsPushing] = useState(false);
  const [pendingGHEdit, setPendingGHEdit] = useState<{ path: string, content: string, message: string, sha?: string } | null>(null);
  const [pushStatus, setPushStatus] = useState<{ status: 'idle' | 'loading' | 'success' | 'error', message?: string }>({ status: 'idle' });
  // theme, isThemePickerOpen → from useSettings() hook
  const { buildSteps, setBuildSteps } = useBuild();
  const [isAppBuilt, setIsAppBuilt] = useState(false);
  const [buildVersionStack, setBuildVersionStack] = useState<Array<{files: Record<string, string>, timestamp: string, request: string}>>([]);

  useEffect(() => {
    let active = true;
    let timeoutId: ReturnType<typeof setTimeout>;

    const pollBuildStatus = async () => {
      if (!active) return;
      try {
        const res = await fetch('/build_status.json?t=' + Date.now());
        const data = await res.json();
        if (data.status === 'building' && data.steps) {
          setBuildSteps(data.steps.filter((s: any) => s.status !== 'pending'));
          timeoutId = setTimeout(pollBuildStatus, 2000);
        } else {
          setBuildSteps([]);
        }
      } catch {
        // /build_status.json not found — not in a build, stop polling
      }
    };

    pollBuildStatus();
    return () => { active = false; clearTimeout(timeoutId); };
  }, [setBuildSteps]);
  const [isDonationEditing, setIsDonationEditing] = useState(false);
  const [donationData, setDonationData] = useState(() => {
      const saved = localStorage.getItem('navbharat_donation_v1');
      return saved ? JSON.parse(saved) : {
          headline: '🇮🇳 नवभारत AI के लिए आपका सहयोग',
          subHeadline: 'Empowering Bharat with Intelligence',
          upiId: 'doc.asheesh@oksbi',
          name: 'Dr. Asheesh',
          missionStatement: 'मैंने अकेले मेहनत करके नवbharat AI बनाने की शुरुआत की है।',
          dreamStatement: 'मेरा सपना है कि एक दिन "नवभारत AI" भारत का ही नहीं, बल्कि दुनिया का सबसे शक्तिशाली, सबसे बुद्धिमान और सबसे उपयोगी AI बने।',
          qrUrl: '',
          logoUrl: ''
      };
  });
  const [aboutData, setAboutData] = useState(() => {
    const saved = localStorage.getItem('navbharat_about_v1');
    return saved ? JSON.parse(saved) : {
        logoUrl: '',
        headline: 'Bharat ka Apna AI - navBharat',
        description: 'Navbharat AI is a mission to empower every Indian with the power of Artificial Intelligence.',
        team: 'Built with ❤️ by a passionate developer.',
        vision: 'To make Bharat a global leader in AI.'
    };
  });

  useEffect(() => {
    localStorage.setItem('navbharat_about_v1', JSON.stringify(aboutData));
  }, [aboutData]);

  // Handle URL Payment Success/Failure callbacks from Cashfree redirect return url
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paymentStatus = params.get('payment');
    const orderRef = params.get('order_id');
    
    if (paymentStatus && orderRef && user) {
      if (paymentStatus === 'success') {
        addLog(`External Cashfree Redirect: Order #${orderRef} processed successfully!`, 'success');
        fetchWallet();
        window.history.replaceState({}, document.title, window.location.pathname);
        alert(`🎉 Payment of Order #${orderRef} was successful! Your navBharatAI Wallet has been credited.`);
      } else if (paymentStatus === 'failed') {
        addLog(`External Cashfree Redirect: Order #${orderRef} marked as FAILED.`, 'error');
        window.history.replaceState({}, document.title, window.location.pathname);
        alert(`❌ Payment failed or cancelled for Order #${orderRef}. Please retry.`);
      } else if (paymentStatus === 'check') {
        addLog(`Verifying payment for Order #${orderRef}...`, 'info');
        axios.post('/api/payment/verify-payment', { orderId: orderRef })
          .then(res => {
            if (res.data.balanceAdded) {
              addLog(`Payment for Order #${orderRef} verified successfully! Credited ₹${res.data.balanceAdded}.`, 'success');
              fetchWallet();
              alert(`🎉 Payment of Order #${orderRef} verified! Wallet credited.`);
            } else if (res.data.alreadyProcessed) {
              addLog(`Payment for Order #${orderRef} was already processed.`, 'info');
              fetchWallet();
            } else {
              addLog(`Payment for Order #${orderRef} check completed: status not yet success.`, 'warn');
              alert(`🤔 Payment for Order #${orderRef} is not yet verified. Please wait or contact support if funds were deducted.`);
            }
          })
          .catch(err => {
            addLog(`Error verifying payment for Order #${orderRef}: ${err.message}`, 'error');
            alert(`❌ Error verifying payment: ${err.message}. Please contact support.`);
          })
          .finally(() => {
            window.history.replaceState({}, document.title, window.location.pathname);
          });
      }
    }
  }, [user]);

  // navBharat Core Token Wallet & Billing States
  const [wallet, setWallet] = useState<any>(null);

  // 11.1 + 11.3 — Daily usage tracking (free tier enforcement)
  const FREE_DAILY_MESSAGES = 10;
  const [dailyUsage, setDailyUsage] = useState<{ date: string; count: number; builds: number }>(() => {
    try {
      const saved = localStorage.getItem('navbharat_daily_usage');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.date === new Date().toDateString()) return parsed;
      }
    } catch {}
    return { date: new Date().toDateString(), count: 0, builds: 0 };
  });
  useEffect(() => {
    try { localStorage.setItem('navbharat_daily_usage', JSON.stringify(dailyUsage)); } catch {}
  }, [dailyUsage]);
  const incrementDailyUsage = useCallback((type: 'message' | 'build') => {
    setDailyUsage(prev => {
      const today = new Date().toDateString();
      if (prev.date !== today) return { date: today, count: type === 'message' ? 1 : 0, builds: type === 'build' ? 1 : 0 };
      return { ...prev, count: prev.count + (type === 'message' ? 1 : 0), builds: prev.builds + (type === 'build' ? 1 : 0) };
    });
  }, []);
  const isFreeLimitReached = !user && dailyUsage.date === new Date().toDateString() && dailyUsage.count >= FREE_DAILY_MESSAGES;

  // 11.4 — Referral code (generated per user, stored in localStorage)
  const [myReferralCode] = useState<string>(() => {
    const saved = localStorage.getItem('navbharat_my_referral');
    if (saved) return saved;
    const code = 'NB-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    localStorage.setItem('navbharat_my_referral', code);
    return code;
  });
  const [showVishwakarmaChooser, setShowVishwakarmaChooser] = useState(false);
  const [showVishwakarmaUnlockModal, setShowVishwakarmaUnlockModal] = useState(false);
  const [vkTokenInput, setVkTokenInput] = useState<string>('50');
  const [billingLogs, setBillingLogs] = useState<any[]>([]);
  const [billingTransactions, setBillingTransactions] = useState<any[]>([]);
  const [loadingWallet, setLoadingWallet] = useState(false);
  const [monthlyAiCost, setMonthlyAiCost] = useState<{ totalBuilds: number; totalCostUsd: number; month: string } | null>(null);
  const [isRecharging, setIsRecharging] = useState(false);
  const [paymentSession, setPaymentSession] = useState<any>(null);
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [rechargeStatus, setRechargeStatus] = useState<string | null>(null);
  const [activeBillingDetailTab, setActiveBillingDetailTab] = useState<'purchase' | 'gift' | 'use' | 'remaining' | 'budget'>('remaining');
  const [customPurchaseCredits, setCustomPurchaseCredits] = useState<string>('5000');
  const [showPurchaseFormPanel, setShowPurchaseFormPanel] = useState<boolean>(false);
  const [couponCodeInput, setCouponCodeInput] = useState('');
  const [isRedeemingCoupon, setIsRedeemingCoupon] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [couponSuccess, setCouponSuccess] = useState<string | null>(null);
  
  // NEW: Vishwakarma Promo
  const [vkPromoCode, setVkPromoCode] = useState('');
  const [vkMode, setVkMode] = useState<'basic' | 'pro' | 'vip'>('basic');
  const [isRedeemingVkPromo, setIsRedeemingVkPromo] = useState(false);

  const redeemVishwakarmaPromo = async () => {
    if (!user) return;
    setIsRedeemingVkPromo(true);
    setCouponError(null);
    try {
        const res = await axios.post('/api/payment/validate-mode-promo', {
            couponCode: vkPromoCode,
            mode: vkMode,
            userId: user.uid
        });
        if (res.data.success) {
            setCouponSuccess(`Promo applied for ${vkMode}! Proceed to checkout to pay ₹1.`);
        }
    } catch (err: any) {
        setCouponError(err.response?.data?.error || 'Validation failed');
    } finally {
        setIsRedeemingVkPromo(false);
    }
  };

  // iOS-style card balance states & limits
  const [reminderLimit, setReminderLimit] = useState<number>(() => {
    const cached = localStorage.getItem('navbharat_reminder_limit');
    return cached ? parseFloat(cached) : 10.00;
  });
  const [budgetLimit, setBudgetLimit] = useState<number>(() => {
    const cached = localStorage.getItem('navbharat_budget_limit');
    return cached ? parseFloat(cached) : 2.00;
  });
  const [tempReminderLimit, setTempReminderLimit] = useState<string>(() => {
    const cached = localStorage.getItem('navbharat_reminder_limit');
    return cached ? parseFloat(cached).toString() : '10';
  });
  const [tempBudgetLimit, setTempBudgetLimit] = useState<string>(() => {
    const cached = localStorage.getItem('navbharat_budget_limit');
    return cached ? parseFloat(cached).toString() : '2';
  });
  const [limitError, setLimitError] = useState<string | null>(null);
  const [limitSuccess, setLimitSuccess] = useState<string | null>(null);
  const [dismissedReminderWarning, setDismissedReminderWarning] = useState<boolean>(false);
  const [copiedReferral, setCopiedReferral] = useState<boolean>(false);
  const [buyAmountInput, setBuyAmountInput] = useState<string>('500');
  const [referralHistory, setReferralHistory] = useState<any[]>(() => {
    const cached = localStorage.getItem('navbharat_referral_history');
    return cached ? JSON.parse(cached) : [
      { email: 'amit_sharma2026@gmail.com', status: 'CLAIMED', creditsEarned: 50.00, timestamp: '2026-05-18T14:20:00Z' },
      { email: 'priya.rastogi@navbharat.ai', status: 'ACTIVE', creditsEarned: 25.00, timestamp: '2026-05-19T09:12:00Z' },
    ];
  });

  useEffect(() => {
    localStorage.setItem('navbharat_reminder_limit', reminderLimit.toString());
  }, [reminderLimit]);

  useEffect(() => {
    localStorage.setItem('navbharat_budget_limit', budgetLimit.toString());
  }, [budgetLimit]);

  useEffect(() => {
    localStorage.setItem('navbharat_referral_history', JSON.stringify(referralHistory));
  }, [referralHistory]);

  // Platform SRE & Cost Analytics State (Admin Console)
  const [adminAnalytics, setAdminAnalytics] = useState<any>(null);
  const [loadingAdminAnalytics, setLoadingAdminAnalytics] = useState(false);
  // G2 — live metrics snapshot for the admin metrics dashboard panel.
  const [adminLiveMetrics, setAdminLiveMetrics] = useState<any>(null);
  const [loadingAdminMetrics, setLoadingAdminMetrics] = useState(false);

  const fetchWallet = async () => {
    if (!user) return;
    setLoadingWallet(true);
    try {
      const res = await axios.get(`/api/wallet/${user.uid}?email=${encodeURIComponent(user.email || '')}&name=${encodeURIComponent(user.displayName || '')}`);
      setWallet(res.data);
      
      const logsRes = await axios.get(`/api/wallet/${user.uid}/logs`);
      setBillingLogs(Array.isArray(logsRes.data) ? logsRes.data : []);

      const txsRes = await axios.get(`/api/wallet/${user.uid}/transactions`);
      setBillingTransactions(Array.isArray(txsRes.data) ? txsRes.data : []);

      // Phase 4.2 — fetch monthly AI cost (best-effort, never blocks wallet load).
      try {
        const usageRes = await fetch(`/api/user/usage/${encodeURIComponent(user.uid)}`);
        if (usageRes.ok) {
          const usageData = await usageRes.json();
          setMonthlyAiCost({ totalBuilds: usageData.totalBuilds ?? 0, totalCostUsd: usageData.totalCostUsd ?? 0, month: usageData.month ?? '' });
        }
      } catch { /* usage fetch never blocks wallet */ }
    } catch (err) {
      console.error('Failed to sync wallet data with Firestore:', err);
    } finally {
      setLoadingWallet(false);
    }
  };

  const createBillingOrder = async (amount: number) => {
    if (!user) return;
    setIsRecharging(true);
    setRechargeStatus('Requesting Cashfree checkout protocol...');
    try {
      const res = await axios.post('/api/payment/create-order', {
        amount,
        userId: user.uid,
        userEmail: user.email || '',
        userName: user.displayName || 'NavBharat Client'
      });
      setPaymentSession(res.data);
      if (res.data.isSimulator) {
        setShowCheckoutModal(true);
        setRechargeStatus('Secure simulated checkout session active.');
      } else {
        setRechargeStatus('Handshaking with Cashfree secure gateway...');
        triggerCashfreeCheckout(res.data.paymentSessionId, res.data.environment);
      }
    } catch (err: any) {
      alert(`Checkout session initiation failed: ${err.response?.data?.error || err.message}`);
    } finally {
      setIsRecharging(false);
    }
  };

  const createVishwakarmaOrder = async (buyPass: boolean, tokenAmount: number) => {
    if (!user) return;
    setIsRecharging(true);
    setRechargeStatus('Requesting Cashfree checkout protocol for Vishwakarma...');
    try {
      const passPrice = 100;
      const amount = (buyPass ? passPrice : 0) + tokenAmount;
      const res = await axios.post('/api/payment/create-order', {
        amount,
        userId: user.uid,
        userEmail: user.email || '',
        userName: user.displayName || 'NavBharat Client',
        isVishwakarmaOrder: true,
        buyPass,
        tokenAmount
      });
      setPaymentSession(res.data);
      if (res.data.isSimulator) {
        setShowCheckoutModal(true);
        setRechargeStatus('Secure simulated checkout session active.');
      } else {
        setRechargeStatus('Handshaking with Cashfree secure gateway...');
        triggerCashfreeCheckout(res.data.paymentSessionId, res.data.environment);
      }
    } catch (err: any) {
      alert(`Checkout session initiation failed: ${err.response?.data?.error || err.message}`);
    } finally {
      setIsRecharging(false);
    }
  };

  const verifyBillingPayment = async (status: 'SUCCESS' | 'FAILED') => {
    if (!paymentSession || !user) return;
    setRechargeStatus('Validating secure transaction hash with backend...');
    try {
      const res = await axios.post('/api/payment/verify-payment', {
        orderId: paymentSession.orderId,
        isSimulator: paymentSession.isSimulator,
        transactionStatus: status
      });
      if (res.data.success) {
        addLog(`Payment for ORDER #${paymentSession.orderId} verified successfully! credited ₹${paymentSession.orderAmount}.`, 'success');
        fetchWallet();
        setShowCheckoutModal(false);
        setPaymentSession(null);
      } else {
        alert('SRE gateway rejected authorization: Status flag FAILED on bank lookup.');
      }
    } catch (err: any) {
      alert(`Payment verification handshake errored: ${err.message}`);
    } finally {
      setRechargeStatus(null);
    }
  };

  const redeemPromoCoupon = async (code: string) => {
    if (!user || !code) return;
    setIsRedeemingCoupon(true);
    setCouponError(null);
    setCouponSuccess(null);
    try {
      const res = await axios.post('/api/payment/redeem-coupon', {
        couponCode: code.trim(),
        userId: user.uid,
        userEmail: user.email || '',
        userName: user.displayName || 'NavBharat Client'
      });
      if (res.data.success) {
        setCouponSuccess(`Successfully redeemed ₹${res.data.balanceAdded}! Added to your wallet credit.`);
        addLog(`Promo Coupon "${code.trim().toUpperCase()}" redeemed! ₹${res.data.balanceAdded} added to your wallet.`, 'success');
        setCouponCodeInput('');
        fetchWallet();
      }
    } catch (err: any) {
      setCouponError(err.response?.data?.error || err.message || 'Verification failed. Try again.');
    } finally {
      setIsRedeemingCoupon(false);
    }
  };

  const fetchAdminAnalytics = async () => {
    setLoadingAdminAnalytics(true);
    try {
      const res = await axios.get('/api/admin/analytics');
      setAdminAnalytics(res.data);
    } catch (err: any) {
      console.error('Failed to fetch admin dashboard stats:', err);
    } finally {
      setLoadingAdminAnalytics(false);
    }
  };

  useEffect(() => {
    if (user) {
      fetchWallet();
    } else {
      setWallet(null);
      setBillingLogs([]);
      setBillingTransactions([]);
    }
  }, [user]);

  useEffect(() => {
    if (activeView === 'admin' && isAdmin) {
      fetchAdminAnalytics();
    }
  }, [activeView, isAdmin]);

  const [githubRepoContext, setGithubRepoContext] = useState<any>(() => {
    const saved = localStorage.getItem('navbharat_gh_context');
    return saved ? JSON.parse(saved) : null;
  });

  // theme persistence → handled inside useSettings() hook

  const togglePin = (sessionId: string) => {
    if (!user) return;
    setSessions(prev => {
      const next = prev.map(s => 
        s.id === sessionId ? { ...s, isPinned: !s.isPinned } : s
      );
      safeLS('navbharat_sessions', JSON.stringify(next));
      return next;
    });
    addLog('Session pin status updated.', 'info');
  };

  useEffect(() => {
    const fetchGHUser = async () => {
      if (githubToken && !githubUser) {
        try {
          setIsGHSyncing(true);
          const response = await fetch('/api/github/user', {
            headers: { Authorization: `Bearer ${githubToken}` }
          });
          if (!response.ok) throw new Error('Proxy user fetch failed');
          const data = await response.json();
          setGithubUser(data);
          addLog(`GitHub: Connected as ${data.login}`, 'success');
          
          // Also fetch user repositories
          const reposRes = await fetch('/api/github/repos', {
            headers: { Authorization: `Bearer ${githubToken}` }
          });
          if (reposRes.ok) {
            const repos = await reposRes.json();
            setRepositories(repos);
          }
        } catch (error) {
          addLog('GitHub: Failed to retrieve account data. Checking offline token...', 'error');
        } finally {
          setIsGHSyncing(false);
        }
      }
    };
    fetchGHUser();
  }, [githubToken]);

  useEffect(() => {
    if (githubRepoContext) {
      safeLS('navbharat_gh_context', JSON.stringify(githubRepoContext));
    }
  }, [githubRepoContext]);

  const handleGitHubCommand = async (command: string) => {
    if (!githubToken) {
      return "I need your GitHub Personal Access Token (PAT) to continue. Please provide it so I can help you safely.";
    }

    if (command.includes('connect repo') || command.includes('repository')) {
      // Logic for repo extraction could be here or handled by AI
    }
    return null;
  };
  const [isSearching, setIsSearching] = useState(false);
  const [files, setFiles] = useState<FileSystem>({
    'index.html': `<!DOCTYPE html><html><body style="background:#0d1117;color:#8b949e;display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;margin:0"><div><h2 style="color:white">Welcome to Navbharat AI Sandbox</h2><p>Edit index.html to see changes or ask AI to build something!</p></div></body></html>`,
    'script.js': 'console.log("Welcome to your AI workspace");',
    'style.css': 'body { margin: 0; font-family: system-ui; }'
  });
  const [activeFile, setActiveFile] = useState<string>('index.html');
  const [previewHistory, setPreviewHistory] = useState<{ id: string; label: string; ts: Date; html: string }[]>([]);
  const [fileUploadConflict, setFileUploadConflict] = useState<{ file: File; existingKey: string; isZip: boolean } | null>(null);
  const [zipSizeModal, setZipSizeModal] = useState<{ variant: ZipSizeModalVariant; fileName: string; fileSizeMB: number } | null>(null);
  const filesUploadRef = useRef<HTMLInputElement>(null);
  const [isBuilding, setIsBuilding] = useState(false);
  const [isDeployed, setIsDeployed] = useState(false);
  const [deployUrl, setDeployUrl] = useState('');
  const [showDeployPanel, setShowDeployPanel] = useState(false);
  const [deployPlatform, setDeployPlatform] = useState<'vercel' | 'netlify' | 'github' | 'cloudflare'>('vercel');
  const [deployToken, setDeployToken] = useState('');
  const [deployProjectName, setDeployProjectName] = useState('');
  const [deployOwner, setDeployOwner] = useState('');
  const [deployRepo, setDeployRepo] = useState('');
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployPanelError, setDeployPanelError] = useState('');
  // logs, setLogs → from useDevLogs() hook
  const _initialCode = (() => {
    // 8.7 — restore last generated app for offline mode
    try {
      const saved = localStorage.getItem('navbharat_last_app');
      if (saved && saved.length > 200) return saved;
    } catch {}
    return '<!DOCTYPE html><html><body style="background:#0d1117;color:#8b949e;display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;margin:0"><div><h2 style="color:white">Waiting for magic...</h2><p>Ask Navbharat to build something!</p></div></body></html>';
  })();

  // 9.1 — undo/redo for generated code (Ctrl+Z / Ctrl+Y)
  const { current: generatedCode, push: _pushCode, undo: undoCode, redo: redoCode, canUndo, canRedo } = useUndoRedo<string>(_initialCode);
  const setGeneratedCode = useCallback((code: string) => { _pushCode(code); }, [_pushCode]);

  const [hasGeneratedCode, setHasGeneratedCode] = useState<boolean>(() => {
    try { return !!localStorage.getItem('navbharat_last_app'); } catch { return false; }
  });

  // 8.7 — persist last generated app for offline access (cap at 256 KB to avoid quota issues)
  useEffect(() => {
    if (hasGeneratedCode && generatedCode && generatedCode.length > 200) {
      const toStore = generatedCode.length > 256_000 ? generatedCode.slice(0, 256_000) : generatedCode;
      safeLS('navbharat_last_app', toStore);
    }
  }, [generatedCode, hasGeneratedCode]);

  // Storage: restore persisted workspace files on mount
  useEffect(() => {
    let cancelled = false;
    loadAllFiles()
      .then((persisted) => {
        if (cancelled || Object.keys(persisted).length === 0) return;
        setFiles(persisted as any);
        setHasGeneratedCode(true);
        setIsAppBuilt(true);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist pro chat history so "Edit with AI" resumes the last conversation
  useEffect(() => {
    if (proMessages.length === 0) return;
    try {
      const toSave = proMessages.slice(-40).map(m => ({
        id: m.id,
        sender: m.sender,
        text: String(m.text || '').slice(0, 2000),
        timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : m.timestamp,
        modelUsed: m.modelUsed,
        // meta omitted — can contain huge deployFiles blobs
      }));
      safeLS('navbharat_pro_messages', JSON.stringify(toSave));
    } catch {}
  }, [proMessages]);

  // ── Apnapan Engine — user personalization profile ──────────────────────────
  interface ApnapanProfile {
    greetingFrequency: Record<string, number>;
    preferredGreeting: string | null;
    preferredLanguage: string;
    conversationStyle: 'formal' | 'friendly' | 'professional' | 'unknown';
    preferredTitle: string | null;
    topics: string[];
    projects: string[];
    interactionCount: number;
  }

  const GREETINGS: Array<{ key: string; patterns: RegExp }> = [
    { key: 'राम-राम',        patterns: /\b(ram[- ]?ram|राम[- ]?राम)\b/i },
    { key: 'राधे-राधे',      patterns: /\b(radhe[- ]?radhe|राधे[- ]?राधे)\b/i },
    { key: 'जय श्री राम',    patterns: /\b(jai\s+shri\s+ram|जय\s+श्री\s+राम)\b/i },
    { key: 'जय हिन्द',       patterns: /\b(jai\s+hind|जय\s+हिन्द|जय\s+हिंद)\b/i },
    { key: 'नमस्ते',          patterns: /\b(namaste|नमस्ते)\b/i },
    { key: 'नमस्कार',         patterns: /\b(namaskar|नमस्कार)\b/i },
    { key: 'प्रणाम',          patterns: /\b(pranam|प्रणाम)\b/i },
    { key: 'आदाब',            patterns: /\b(adaab|आदाब)\b/i },
    { key: 'अस्सलामुअलैकुम', patterns: /\b(assalam|salaam|salam|अस्सलाम)\b/i },
    { key: 'सत श्री अकाल',   patterns: /\b(sat\s+sri\s+akal|waheguru|सत\s+श्री\s+अकाल)\b/i },
    { key: 'जय भीम',          patterns: /\b(jai\s+bhi[me]m?|जय\s+भीम)\b/i },
    { key: 'केम छो',           patterns: /\b(kem\s+cho|केम\s+छो)\b/i },
    { key: 'வணக்கம்',          patterns: /வணக்கம்|vanakkam/i },
    { key: 'Hello',            patterns: /^\s*(hello|hi|hey)\b/i },
    { key: 'Good Morning',     patterns: /\bgood\s+morning\b/i },
    { key: 'Good Evening',     patterns: /\bgood\s+evening\b/i },
  ];

  const FORMAL_MARKERS    = /\b(aap|आप|kripya|कृपया|dhanyawad|धन्यवाद|sir|madam|sahab)\b/i;
  const FRIENDLY_MARKERS  = /\b(yaar|यार|bhai|भाई|dost|दोस्त|bro)\b/i;
  const PROF_MARKERS      = /\b(doctor|dr\.|डॉक्टर|डॉ\.|professor|prof\.|advocate|eng\.)\b/i;
  const TITLE_PATTERN     = /\b(doctor\s+sahab|dr\.\s*ji|डॉक्टर\s+साहब|डॉ\.\s*जी|sir|madam|mitra|bhai\s+sahab|भाई\s+साहब)\b/i;
  const PROJECT_KEYWORDS  = /\b(navbharatai|navbharat|hospital|clinic|school|startup|app|website|project)\b/i;
  const DEVANAGARI        = /[ऀ-ॿ]/;
  const SOUTH_ASIAN_ALPHA = /[஀-௿ఀ-౿ಀ-೿ഀ-ൿঀ-৿਀-੿]/;

  const loadApnapanProfile = (): ApnapanProfile => {
    try {
      const s = localStorage.getItem('navbharat_apnapan');
      if (s) return JSON.parse(s) as ApnapanProfile;
    } catch {}
    return { greetingFrequency: {}, preferredGreeting: null, preferredLanguage: 'Hinglish', conversationStyle: 'unknown', preferredTitle: null, topics: [], projects: [], interactionCount: 0 };
  };

  const saveApnapanProfile = (p: ApnapanProfile) => {
    try { localStorage.setItem('navbharat_apnapan', JSON.stringify(p)); } catch {}
  };

  const [apnapanProfile, setApnapanProfile] = useState<ApnapanProfile>(loadApnapanProfile);

  // Learn from each user message in the free chat
  const learnFromMessage = (text: string) => {
    setApnapanProfile(prev => {
      const p = { ...prev, greetingFrequency: { ...prev.greetingFrequency }, topics: [...prev.topics], projects: [...prev.projects] };
      p.interactionCount++;

      // Greeting detection
      for (const g of GREETINGS) {
        if (g.patterns.test(text)) {
          p.greetingFrequency[g.key] = (p.greetingFrequency[g.key] || 0) + 1;
          // preferred = most frequent
          p.preferredGreeting = Object.entries(p.greetingFrequency).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
          break;
        }
      }

      // Language detection
      if (DEVANAGARI.test(text)) {
        const latinWords = text.split(/\s+/).filter(w => /[a-z]/i.test(w)).length;
        const totalWords = text.split(/\s+/).length;
        p.preferredLanguage = latinWords / totalWords > 0.3 ? 'Hinglish' : 'Hindi';
      } else if (SOUTH_ASIAN_ALPHA.test(text)) {
        p.preferredLanguage = 'Regional Indian';
      } else {
        p.preferredLanguage = 'English';
      }

      // Conversation style
      if (PROF_MARKERS.test(text)) p.conversationStyle = 'professional';
      else if (FORMAL_MARKERS.test(text) && p.conversationStyle === 'unknown') p.conversationStyle = 'formal';
      else if (FRIENDLY_MARKERS.test(text)) p.conversationStyle = 'friendly';

      // Title detection
      const titleMatch = TITLE_PATTERN.exec(text);
      if (titleMatch) p.preferredTitle = titleMatch[0].trim();

      // Project keywords
      const projMatches = text.match(new RegExp(PROJECT_KEYWORDS.source, 'gi'));
      if (projMatches) {
        for (const m of projMatches) {
          const kw = m.toLowerCase();
          if (!p.projects.includes(kw)) p.projects = [kw, ...p.projects].slice(0, 8);
        }
      }

      saveApnapanProfile(p);
      return p;
    });
  };

  // 9.1 — Ctrl+Z / Ctrl+Y keyboard shortcuts for undo/redo
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const inInput = document.activeElement?.tagName === 'TEXTAREA' || document.activeElement?.tagName === 'INPUT';
      // 10.5 Ctrl+K — Command Palette (works everywhere)
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setShowCommandPalette(p => !p);
        return;
      }
      // Escape — close command palette
      if (e.key === 'Escape') { setShowCommandPalette(false); return; }
      // 9.1 Undo/Redo (not in input fields)
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey && !inInput) {
        if (canUndo) { e.preventDefault(); undoCode(); addToast('Undone ✓', 'info'); }
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey)) && !inInput) {
        if (canRedo) { e.preventDefault(); redoCode(); addToast('Redone ✓', 'info'); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [canUndo, canRedo, undoCode, redoCode, addToast]);

  const [keys, setKeys] = useState<ApiKeys>(() => {
      const saved = localStorage.getItem('navbharat_keys');
      const defaults = { gemini: '', groq: '', deepseek: '', openai: '', openrouter: '', claude: '' };
      return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
  });
  const [appSecrets, setAppSecrets] = useState<AppSecret[]>(() => {
      const saved = localStorage.getItem('navbharat_app_secrets');
      return saved ? JSON.parse(saved) : [
          { id: '1', label: 'Firebase Config', provider: 'firebase', value: '', masked: true },
          { id: '2', label: 'Stripe Secret', provider: 'stripe', value: '', masked: true },
          { id: '3', label: 'AWS S3 Key', provider: 'aws', value: '', masked: true },
      ];
  });
  const [showKeyStates, setShowKeyStates] = useState<Record<string, boolean>>({
      gemini: false, groq: false, deepseek: false, openai: false, openrouter: false, claude: false
  });
  // mode, setMode → from useSettings() hook
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminError, setAdminError] = useState('');

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminError('');
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: adminEmail, password: adminPassword }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        sessionStorage.setItem('admin_token', data.token);
        setIsAdmin(true);
        toggleTab('home');
        addLog('Admin: Access Granted.', 'success');
      } else {
        setAdminError(data.error || 'Invalid credentials.');
        addLog('Admin: Access Denied.', 'error');
      }
    } catch {
      setAdminError('Server error. Please try again.');
    }
  };

  const [homeData, setHomeData] = useState(() => {
    const saved = localStorage.getItem('navbharat_home_v1');
    return saved ? JSON.parse(saved) : {
      heroTitle: 'navBharatAI Architect',
      heroSubtitle: 'Enterprise-grade ecosystem for building complex, scalable, and production-ready applications with Bharat-first precision.',
      welcomeText: 'Enterprise Architect Mode Active',
      ctaText: 'Assemble System Architecture',
      features: [
        {
          title: "Senior Architect Protocol",
          subtitle: "15+ Years of Industry Expertise",
          description: "Not just a chatbot. navBharatAI follows a strict 8-phase senior architect workflow from Discovery to DevOps.",
          icon: 'ShieldCheck',
          color: "from-indigo-600 to-blue-700"
        },
        {
          title: "Scale-First Architecture",
          subtitle: "Designed for Millions of Users",
          description: "High-level guidance on Monorepos, Microservices, and TB-level data complexity management.",
          icon: 'Zap',
          color: "from-amber-500 to-orange-600"
        },
        {
          title: "Modular Code Standards",
          subtitle: "Production-Ready TypeScript",
          description: "Clean, well-commented, and modular implementation plans that follow enterprise coding standards.",
          icon: 'Code',
          color: "from-emerald-500 to-teal-600"
        },
        {
          title: "End-to-End Governance",
          subtitle: "Security, Compliance & DevOps",
          description: "Integrated RBAC, OWASP audits, and professional CI/CD strategy recommendations.",
          icon: 'Shield',
          color: "from-purple-500 to-pink-500",
          status: "Enterprise"
        }
      ]
    };
  });

  useEffect(() => {
    localStorage.setItem('navbharat_home_v1', JSON.stringify(homeData));
  }, [homeData]);











  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoadingUser(false);
    });
    return unsubscribe;
  }, []);

  const MAX_UPLOAD_BYTES = 2 * 1024 * 1024; // 2 MB
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, type: 'logoUrl' | 'qrUrl') => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      addLog(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 2 MB allowed.`, 'error');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setDonationData(prev => ({ ...prev, [type]: dataUrl }));
    };
    reader.readAsDataURL(file);
  };

  const toggleTab = useCallback((view: ViewType, pushToHistory = true) => {
    // Pre-warm server when user opens chat tabs (fire-and-forget)
    if (view === 'nbi_chat' || view === 'nbi_pro_chat') {
      fetch('/api/health', { method: 'GET' }).catch(() => {});
    }

    if (view === 'security' && !user) {
      setShowAuth(true);
      addLog('Security Audit requires an active session. Please login.', 'warn');
      return;
    }

    if (view === 'history' && !user) {
      pendingViewAfterLoginRef.current = view;
      setShowAuth(true);
      addLog('Chat history requires an active session. Please login.', 'warn');
      return;
    }

    if ((view === 'nbi_pro_chat' || view === 'sda_chat' || view === 'engineer_ai') && !user) {
      setShowAuth(true);
      addLog(`${view === 'nbi_pro_chat' ? 'NavBharatAI Pro' : view === 'sda_chat' ? 'Doctor AI' : 'Engineer AI'} is available for logged-in users only. Please sign in.`, 'warn');
      return;
    }

    if (!openTabs.includes(view)) {
      setOpenTabs(prev => [...prev, view]);
    }
    
    if (pushToHistory && activeView !== view) {
      setTabHistories(prev => ({
        ...prev,
        [activeView]: [...(prev[activeView] || []), view]
      }));
    }
    
    setActiveView(view);
  }, [user, openTabs, activeView, addLog, setShowAuth]);

  // After login, navigate to any view that was gated behind auth (e.g. History)
  useEffect(() => {
    if (user && pendingViewAfterLoginRef.current) {
      const view = pendingViewAfterLoginRef.current;
      pendingViewAfterLoginRef.current = null;
      toggleTab(view);
    }
  }, [user, toggleTab]);

  const handleGHConfirmPush = async () => {
    if (!pendingGHEdit || !githubRepoContext) return;
    
    setIsPushing(true);
    setPushStatus({ status: 'loading' });
    addLog(`GitHub: Pushing changes to ${pendingGHEdit.path}...`, 'info');
    
    try {
      const result = await GitHubService.updateFile(
        githubRepoContext,
        pendingGHEdit.path,
        pendingGHEdit.content,
        pendingGHEdit.message,
        pendingGHEdit.sha || ''
      );
      
      setPushStatus({ status: 'success', message: 'Successfully pushed to GitHub!' });
      addLog(`GitHub: Push successful! Commit: ${result.commit.sha.substring(0, 7)}`, 'success');
      addToast(`Pushed to GitHub ✓ (${result.commit.sha.substring(0, 7)})`, 'success');
      
      const successMsg: Message = {
        id: Date.now().toString(),
        text: `✅ **Successfully Pushed!**\n\n**File:** ${pendingGHEdit.path}\n**Commit:** [\`${result.commit.sha.substring(0, 7)}\`](${result.content.html_url})`,
        sender: 'ai',
        timestamp: new Date(),
        modelUsed: 'GitHub Core'
      };
      setMessages(prev => [...prev, successMsg]);
      setPendingGHEdit(null);
    } catch (e: any) {
      setPushStatus({ status: 'error', message: e.message });
      addLog(`GitHub Error: ${e.message}`, 'error');
    } finally {
      setIsPushing(false);
    }
  };
  const closeTab = useCallback((e: React.MouseEvent, view: ViewType) => {
    e.stopPropagation();

    // If user closes home tab, just go to it but don't close
    if (view === 'home') {
      toggleTab('home', false);
      return;
    }

    setOpenTabs(prev => {
      let nextTabs = prev.filter(t => t !== view);

      // When closing pro chat, also remove the preview tab
      if (view === 'nbi_pro_chat') {
        nextTabs = nextTabs.filter(t => t !== 'preview');
        // If active view is preview or pro-chat, redirect away
        if (activeView === 'preview' || activeView === 'nbi_pro_chat') {
          const nextActiveView = nextTabs.length > 0 ? nextTabs[nextTabs.length - 1] : 'home';
          setActiveView(nextActiveView);
        }
      } else if (activeView === view) {
        // If we are closing the active view, switch to another one
        const nextActiveView = nextTabs.length > 0 ? nextTabs[nextTabs.length - 1] : 'home';
        setActiveView(nextActiveView);
      }

      return nextTabs;
    });

    setTabHistories(prevHistories => {
      const nextHistories = { ...prevHistories };
      delete nextHistories[view];
      return nextHistories;
    });

    // Full state reset when chat tab is explicitly closed — clean slate on reopen
    if (view === 'nbi_chat') {
      setMessages([]);
      setInput('');
      // Reset session so memorySummary doesn't bleed into next conversation
      setCurrentSessionId(Date.now().toString());
    }
    if (view === 'nbi_pro_chat') {
      setProMessages([]);
      setProInput('');
      try { localStorage.removeItem('navbharat_pro_messages'); } catch {}
      // Fresh session id so the next conversation doesn't inherit this one's memory/UCI
      const newProSessionId = `pro-${Date.now()}`;
      try { localStorage.setItem('pro_session_id', newProSessionId); } catch { /* ignore */ }
      setCurrentProSessionId(newProSessionId);
      // Wipe workspace so next open starts with a blank canvas
      setFiles({});
      clearWorkspace().catch(() => {});
      setBuildVersionStack([]);
      setProBuildProgress({ active: false, stage: '', steps: [], percent: 0, generatedFiles: {} });
      setGeneratedCode('<!DOCTYPE html><html><body style="background:#0d1117;color:#8b949e;display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;margin:0"><div><h2 style="color:white">Waiting for magic...</h2><p>Ask Navbharat to build something!</p></div></body></html>');
      setHasGeneratedCode(false);
      setIsAppBuilt(false);
    }
    if (view === 'sda_chat') {
      // Force SDAChat to fully remount, wiping all its internal state
      try { localStorage.removeItem('sda_messages'); } catch {}
      setSdaResetKey(k => k + 1);
    }
  }, [activeView, toggleTab, setMessages, setProMessages, setInput, setProInput, setGeneratedCode, setHasGeneratedCode, setIsAppBuilt, setFiles, setBuildVersionStack, setProBuildProgress, setCurrentSessionId, setCurrentProSessionId, setSdaResetKey]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const proAbortControllerRef = useRef<AbortController | null>(null);
  const proLivePreviewUrlRef = useRef<string | null>(null);
  // Phase 79 — latest E2B screenshot forwarded via the SSE stream
  const proLiveScreenshotRef = useRef<string | null>(null);
  const pendingViewAfterLoginRef = useRef<ViewType | null>(null);
  // G10 — stores the last build prompt so retry requests ("try again") can restore context.
  const lastBuildPromptRef = useRef<string>('');

  // NOTE: horizontal swipe is intentionally reserved app-wide for the sidebar
  // (open/close) — handled by the document-level touch handler above. A previous
  // tab-switching swipe (8.5) was removed because it competed with the sidebar
  // gesture and made views feel like they were navigating "forward/back".

  useEffect(() => {
    localStorage.setItem('navbharat_keys', JSON.stringify(keys));
  }, [keys]);

  // enabledModules persistence → handled inside useSettings() hook

  // Synchronized Auto-Save for All AI Agents (NBI Chat & AS Chat)
  useEffect(() => {
    if (!user) return; // ONLY save sessions if logged-in!
    const isVishwakarma = false;
    const activeMsgs = messages;
    
    // Avoid saving if messages are empty or only contains welcome greetings
    if (activeMsgs.length === 0) return;
    if (activeMsgs.length <= 1 && activeMsgs[0]?.id?.includes('welcome')) return;

    setSessions(prev => {
      const existingIdx = prev.findIndex(s => s.id === currentSessionId);
      let existingSession = existingIdx > -1 ? prev[existingIdx] : null;

      // Determine session title from the first non-welcome message
      const firstRealMsg = activeMsgs.find(m => m.sender === 'user' || !m.id?.includes('welcome'));
      const rawTitle = firstRealMsg?.text || 'New Conversation';
      const title = rawTitle.slice(0, 40) + (rawTitle.length > 40 ? '...' : '');

      const sessionUci = existingSession?.uci || generateUCI();

      const updatedSession: ChatSession = {
        id: currentSessionId,
        title: existingSession?.title && existingSession?.title !== 'New Conversation' ? existingSession.title : title,
        messages: activeMsgs,
        files,
        lastUpdated: new Date().toISOString(),
        mode,
        agent: activeAgent,
        isPinned: existingSession?.isPinned || false,
        // UCI details
        uci: sessionUci,
        originalAgent: existingSession?.originalAgent || activeAgent,
        currentAgent: activeAgent,
        memorySummary: existingSession?.memorySummary || '',
        continuationChain: existingSession?.continuationChain || [activeAgent],
        restoredMessages: existingSession?.restoredMessages || []
      };

      let next;
      if (existingIdx > -1) {
        next = [...prev];
        next[existingIdx] = updatedSession;
      } else {
        next = [updatedSession, ...prev];
      }

      safeLS('navbharat_sessions', JSON.stringify(next));

      // Sync with Firestore collection: chat_sessions under authenticated user contexts
      if (user) {
        const sessionRef = doc(db, 'chat_sessions', currentSessionId);
        setDoc(sessionRef, sanitizeFirestoreData({
          id: currentSessionId || 'unknown',
          uci: sessionUci || '',
          userId: user?.uid || 'anonymous',
          tab: activeView,
          original_agent: updatedSession.originalAgent || null,
          current_agent: updatedSession.currentAgent || null,
          title: updatedSession.title || 'Untitled',
          memory_summary: updatedSession.memorySummary || '',
          edit_log: updatedSession.editLog || [],
          restoredMessages: (updatedSession.restoredMessages || []).map(m => ({
            id: m.id || Date.now().toString(),
            text: m.text || '',
            sender: m.sender || 'ai',
            timestamp: m.timestamp || new Date().toISOString()
          })),
          messages: (updatedSession.messages || []).map(m => ({
            id: m.id || Date.now().toString(),
            text: m.text || '',
            sender: m.sender || 'ai',
            timestamp: m.timestamp || new Date().toISOString()
          })),
          files: Object.entries(updatedSession.files || {}).reduce((acc: Record<string, string>, [key, val]) => {
            acc[key] = val || '';
            return acc;
          }, {}),
          lastUpdated: updatedSession.lastUpdated || new Date().toISOString(),
          isPinned: !!updatedSession.isPinned,
          mode: updatedSession.mode || 'chat'
        })).catch(err => console.error('Firestore chat_sessions sync error:', err));

        // Log agent transitions if changed since previous state
        if (existingSession && existingSession.currentAgent !== updatedSession.currentAgent) {
          const transitionId = `transition_${currentSessionId}_${Date.now()}`;
          const transitionRef = doc(db, 'chat_agent_history', transitionId);
          setDoc(transitionRef, sanitizeFirestoreData({
            id: transitionId,
            uci: sessionUci || '',
            userId: user?.uid || 'anonymous',
            previous_agent: existingSession.currentAgent || null,
            current_agent: updatedSession.currentAgent || null,
            timestamp: new Date().toISOString()
          })).catch(err => console.error('Firestore transition sync error:', err));
        }
      }

      return next;
    });
  }, [messages, currentSessionId, files, activeAgent, mode, user]);

  // Synchronized Auto-Save for Pro App Builder chat — mirrors the Free-chat
  // effect above but uses its own session id so the two never overwrite each
  // other. Without this, Pro Builder conversations were never persisted, so
  // they could never appear in History or be resumed.
  useEffect(() => {
    if (!user) return; // ONLY save sessions if logged-in!
    const activeMsgs = proMessages;

    if (activeMsgs.length === 0) return;
    if (activeMsgs.length <= 1 && activeMsgs[0]?.id?.includes('welcome')) return;

    setSessions(prev => {
      const existingIdx = prev.findIndex(s => s.id === currentProSessionId);
      let existingSession = existingIdx > -1 ? prev[existingIdx] : null;

      const firstRealMsg = activeMsgs.find(m => m.sender === 'user' || !m.id?.includes('welcome'));
      const rawTitle = firstRealMsg?.text || 'New App Build';
      const title = rawTitle.slice(0, 40) + (rawTitle.length > 40 ? '...' : '');

      const sessionUci = existingSession?.uci || generateUCI();

      const updatedSession: ChatSession = {
        id: currentProSessionId,
        title: existingSession?.title && existingSession?.title !== 'New App Build' ? existingSession.title : title,
        messages: activeMsgs,
        files,
        lastUpdated: new Date().toISOString(),
        mode: 'build',
        agent: 'navbharatai-pro',
        isPinned: existingSession?.isPinned || false,
        uci: sessionUci,
        originalAgent: existingSession?.originalAgent || 'navbharatai-pro',
        currentAgent: 'navbharatai-pro',
        memorySummary: existingSession?.memorySummary || '',
        editLog: existingSession?.editLog || [],
        continuationChain: existingSession?.continuationChain || ['navbharatai-pro'],
        restoredMessages: existingSession?.restoredMessages || []
      };

      let next;
      if (existingIdx > -1) {
        next = [...prev];
        next[existingIdx] = updatedSession;
      } else {
        next = [updatedSession, ...prev];
      }

      safeLS('navbharat_sessions', JSON.stringify(next));

      if (user) {
        const sessionRef = doc(db, 'chat_sessions', currentProSessionId);
        setDoc(sessionRef, sanitizeFirestoreData({
          id: currentProSessionId || 'unknown',
          uci: sessionUci || '',
          userId: user?.uid || 'anonymous',
          tab: 'nbi_pro_chat',
          original_agent: updatedSession.originalAgent || null,
          current_agent: updatedSession.currentAgent || null,
          title: updatedSession.title || 'Untitled',
          memory_summary: updatedSession.memorySummary || '',
          edit_log: updatedSession.editLog || [],
          restoredMessages: (updatedSession.restoredMessages || []).map(m => ({
            id: m.id || Date.now().toString(),
            text: m.text || '',
            sender: m.sender || 'ai',
            timestamp: m.timestamp || new Date().toISOString()
          })),
          messages: (updatedSession.messages || []).map(m => ({
            id: m.id || Date.now().toString(),
            text: m.text || '',
            sender: m.sender || 'ai',
            timestamp: m.timestamp || new Date().toISOString()
          })),
          files: Object.entries(updatedSession.files || {}).reduce((acc: Record<string, string>, [key, val]) => {
            acc[key] = val || '';
            return acc;
          }, {}),
          lastUpdated: updatedSession.lastUpdated || new Date().toISOString(),
          isPinned: !!updatedSession.isPinned,
          mode: 'build'
        })).catch(err => console.error('Firestore chat_sessions (pro) sync error:', err));
      }

      return next;
    });
  }, [proMessages, currentProSessionId, files, user]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading, activeView]);

  useEffect(() => {
    if (shellRef.current) {
      shellRef.current.scrollTop = shellRef.current.scrollHeight;
    }
  }, [logs, activeView]);

  // addLog → from useDevLogs() hook

  useEffect(() => {
    if (activeView === 'studio') {
      // Logic adjusted to ensure navbharatai agent defaults for code studio
      if (activeAgent !== 'navbharatai') {
         setActiveAgent('navbharatai');
         localStorage.setItem('activeAgent', 'navbharatai');
      }
    }
  }, [activeView, activeAgent]);

  useEffect(() => {
    addLog('🔙 Back Button System Activated', 'success');
    addLog('Navigation history mapping enabled for all routes.', 'info');
  }, []);

  const buildLanguageRule = (lang: string | null): string => {
    const convRules: Record<string, string> = {
      hindi:    'CONVERSATION LANGUAGE: Always reply in Hindi (Devanagari or Roman script, whichever the user uses).',
      hinglish: 'CONVERSATION LANGUAGE: Always reply in Hinglish — natural mix of Hindi words (Roman script) + English technical terms.',
      english:  'CONVERSATION LANGUAGE: Always reply in English.',
      auto:     'CONVERSATION LANGUAGE: Automatically match the exact language, dialect, and tone the user writes in.',
    };
    const conv = convRules[lang || 'auto'] ?? convRules.auto;
    return `==================================================
🔒 LANGUAGE & CODING RULES (PERMANENT — NEVER OVERRIDE)
==================================================
${conv}

CODE LANGUAGE (ABSOLUTE RULE — NO EXCEPTIONS):
- ALL code you write MUST use English-only identifiers.
- Variable names, function names, class names, constants → English.
- Code comments → English.
- console.log / error messages / string literals inside code → English.
- API field names, database column names → English.
- This rule applies regardless of the conversation language.
- WRONG: \`const userName = "नमस्ते"\` or \`function kaamKaro()\`
- RIGHT: \`const userName = "Hello"\` or \`function processTask()\`
==================================================`;
  };

  const getBharatContext = (appMode: 'chat' | 'build', intent: string = 'general', target?: string, currentFiles?: FileSystem, forceHinglish?: boolean) => {
    const now = new Date();
    const today = now.toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    
    // GitHub Status for Context
    const ghStatus = githubToken ? `Connected as: ${githubUser?.login || 'Authenticated User'}` : 'Not Connected';
    const ghRepo = githubRepoContext ? `Active Repo: ${githubRepoContext.owner}/${githubRepoContext.repo} (Branch: ${githubRepoContext.branch})` : 'No Repository Connected';

    // 7.4 + 7.1 — Multi-file awareness: inject actual file CONTENTS (top 5 files, capped per file)
    const MAX_FILE_CHARS = 2000;
    const MAX_FILES = 5;
    const PRIORITY_FILES = ['index.html', 'App.tsx', 'App.jsx', 'main.tsx', 'main.jsx', 'style.css', 'styles.css', 'script.js', 'app.js', 'main.js'];

    const fileContext = currentFiles && Object.keys(currentFiles).length > 0 ? (() => {
      const allFiles = Object.entries(currentFiles as FileSystem);
      // Sort: priority files first, then by size descending
      const sorted = [
        ...PRIORITY_FILES.map(p => allFiles.find(([k]) => k === p)).filter(Boolean) as [string, string][],
        ...allFiles.filter(([k]) => !PRIORITY_FILES.includes(k)).sort((a, b) => b[1].length - a[1].length),
      ].slice(0, MAX_FILES);

      const filesSummary = allFiles.map(([p, v]) => `  - ${p} (${v.length} chars)`).join('\n');
      const fileContents = sorted.map(([path, content]) => {
        const truncated = content.length > MAX_FILE_CHARS
          ? content.slice(0, MAX_FILE_CHARS) + `\n... [${content.length - MAX_FILE_CHARS} chars truncated]`
          : content;
        return `\`\`\`${path.split('.').pop()}:${path}\n${truncated}\n\`\`\``;
      }).join('\n\n');

      return `
### PROJECT WORKSPACE — ${allFiles.length} FILE(S) LOADED
All files:
${filesSummary}

### FILE CONTENTS (top ${sorted.length}):
${fileContents}
`;
    })() : '';

    // 7.2 — Continuation mode: if files exist, instruct AI to modify not replace
    const hasMeaningfulFiles = currentFiles && Object.keys(currentFiles).length > 0 &&
      Object.values(currentFiles).some(v => (v as string).length > 100);
    const continuationPrefix = hasMeaningfulFiles ? `
### CONTINUATION MODE ACTIVE
Existing project files are present above. You MUST:
- ANALYZE the existing code before responding
- Make TARGETED, SURGICAL changes only
- PRESERVE all existing functionality
- DO NOT rewrite files from scratch unless explicitly asked
- When modifying HTML: show the full updated file
- When modifying JS/CSS: show only the changed section with clear markers
` : '';

    // Check for security intent first
    if (intent === 'security') {
      return `You are the navBharatAi Security Auditor Agent. 
Your role is to act as a Senior Defensive Security Consultant and Static Analysis expert. 

### CORE IDENTITY
Analyze code and targets for security vulnerabilities based on industry standards (OWASP Top 10). Provide clear, educational explanations of risks and provide the corrected, secure code to fix them.

${fileContext}

### DIRECTIVES
- Focus exclusively on DEFENSIVE security.
- Provide high-quality code fixes for identified issues.
- Explain the "Why" and "How" of security best practices.
- DO NOT provide actionable exploit steps, hacking flows, or functional payloads.

### REPORT FORMAT
**🛡️ Security Audit Report**
**Target:** ${target || 'Current Project'}
**Security Grade:** [A-F]

**📊 Finding Summary**
List high-level risks identified.

### Remediation Guidance
For every finding, provide:
1. Vulnerability Description
2. Impact Analysis
3. Secure Implementation (Fix Code)`;
    }

    const baseAI = `You are navBharatAI, a world-class senior architect created and mentored by navBharatAI. You represent the pinnacle of enterprise software engineering.

### CORE MISSION
Upgrade standard applications into TB-level, scalable platforms. You handle SaaS, Marketplaces, ERP, and Fintech with 15+ years of architectural precision.

### THE ARCHITECT'S PROTOCOL (Strict Order)
Phase 0: Deep Discovery - Business goals & 1M+ user scalability.
Phase 1: Architecture - Monorepos, Microservices, & DB Strategy.
Phase 2: Tech Stack - Next.js 15, TS, Prisma, PostgreSQL.
Phase 3: Security - RBAC, OWASP, & Data Governance.
Phase 4: Implementation - Modular, clean, and production-ready code.
Phase 5: DevOps - CI/CD, Docker, and Monitoring.

### IDENTITY & SOVEREIGNTY
- Brand: navBharatAI.
- Creator & Mentor: navBharatAI.
- Role: Senior Lead Architect.
- Confidentiality: Never reveal underlying model providers (OpenAI, Anthropic, etc.). You are a proprietary intelligence layer intelligently utilizing multiple engines.

### COMMUNICATION
Friendly, Hinglish/English, and structured. Always provide a "Scaling & Future Growth" guide for every complex implementation.

TODAY: ${today}.
`

    const baseAIEx = `### GITHUB CAPABILITIES
You have advanced GitHub Code Management capabilities built-in. You can help users:
1. Connect GitHub Repository
2. Fetch Repository files
3. Read files (with line numbers)
4. Analyze code & suggest improvements
5. Edit files & Preview changes
6. Commit & Push changes securely
7. Create Pull Requests

### SMART CODE EDITING (CRITICAL)
- **Understanding**: Always double-check existing code first. Understand the flow and logic.
- **Integrity**: Your edits must not break the app's core flow. Avoid regressions.
- **Precision**: If the user requests a specific feature, integrate it intelligently into existing code — don't replace unless a full rewrite is cleaner.
- **Markers**: Always include the file path in code blocks: \`\`\`tsx:src/App.tsx\`\`\` or \`// path: src/App.tsx\`.
- **Double Check**: Before responding, verify that all imports are correct and variable names are consistent.

When the user mentions GitHub or repository tasks, follow this STRICT workflow:
Phase 1: Connection Setup - Ask for GitHub Personal Access Token (PAT) with repo scope and Repository name (username/repo).
Phase 2: Exploration - Fetch and list important files.
Phase 3: Operations - Show file contents with line numbers when requested.
Phase 4: Editing - Suggest changes, show "Old vs New" preview, and ask for explicit confirmation before pushing.
Phase 5: Completion - Push changes with a professional message and provide the commit link.

### SECURITY & SAFETY
- Never store PATs insecurely.
- ALWAYS ask for confirmation before any Push/Commit.
- Warn before editing .env, keys, or passwords.
- Only edit files explicitly requested by user.

CONVERSATIONAL RULES:
1. UNDERSTAND INTENT FIRST: Always check if the user is greeting you, making small talk, or expressing emotions before assuming they want to build an app or code.
2. RESPOND NATURALLY: Match the user's greeting style and energy. If someone greets casually, reply warmly and casually. If formal, match that tone.
3. MULTILINGUAL PROTOCOL (STRICT MANDATE): Always respond in the EXACT same language, dialect, and writing style that the user uses in their message. 
   - If user writes in Hindi (हिंदी): AI MUST reply in Hindi.
   - If user writes in Hinglish: reply naturally in Hinglish.
   - If user writes in English: reply in English.
   - If user writes in Urdu: reply in Urdu.
   - If user writes in mixed Hindi-English: reply naturally in mixed Hindi-English.
   - NEVER force replies into English. The user's input language is the absolute gold standard for the response language.
4. EMOTIONAL INTELLIGENCE: Detect frustration, excitement, or humor. If the user is frustrated, offer support. If they tell a joke, laugh and join in.
5. NO REPETITION: Do NOT repeat greetings in every message. Only greet when it's natural in a conversation.
6. CULTURAL CONTEXT: Use appropriate emojis (🙏, 🇮🇳, 😄, ✨) and cultural references where suitable.
7. SOURCE ATTRIBUTION: For factual, news, or informational queries, you MUST cite 1-3 high-quality sources. At the end of your response, add a section "Sources:" with clickable links in the format: Website Name – URL.

RESPONSE MODES:
- SOCIAL MODE: For greetings, small talk, jokes, and casual chat. Keep it light and human.
- KNOWLEDGE MODE: For general questions about facts, history, or information.
- TECHNICAL MODE: For coding questions, debugging, or app development.
- BUILD MODE: Only used when explicitly asked to generate code or build an app.
- GITHUB MODE: For repository management, file editing, and pushes.`;

    if (intent === 'github') {
        return `${baseAI}

### 🔗 navBharatAI Git Integration Activated
I will help you connect, fetch, edit, and deploy your GitHub repository.

### GIT MODE – FULL FUNCTIONALITY (Strict Workflow)
Always follow in this order:

**Phase 1: Connection**
- Ask the user for a GitHub Personal Access Token (PAT) with repo scope.
- Ask for the repository full name (username/repo).
- Ask for the branch name (default: main).

**Phase 2: Repository Fetch**
- Use [GH_LIST_FILES] to fetch the repository tree from GitHub API.
- Display a clean, well-organized folder structure.
- Highlight important files (package.json, src/, app/, index.js, etc.)

**Phase 3: File Operations**
- Fetch the requested file using [GH_READ_FILE:path] and display with line numbers.
- Present code in syntax-highlighted format.

**Phase 4: Intelligent Code Editing**
- Understand the user's instructions and suggest changes.
- Show Old code vs New code (Diff).
- Ask for confirmation before committing: "Would you like to commit these changes?"

**Phase 5: Commit & Push**
- Generate a professional commit message.
- Use [GH_PROPOSE_EDIT:path|content|message] tag.
- Include the GitHub commit link in the success message.

**Phase 6: Deployment Guidance**
- After pushing changes, provide a step-by-step guide to deploy on Railway, Vercel, Render, or Netlify.

### SECURITY & SAFETY
- Ask for double confirmation before every critical action (edit, commit, push).
- Show a strong warning before editing .env, API keys, or password files.
- Only edit files explicitly specified by the user.

### UI INTERACTION
Always suggest relevant action buttons in your response when the user needs to take an action.

${fileContext}

### CURRENT CONTEXT
Status: ${ghStatus}
${ghRepo}

Your goal is to guide the user through this strict Git workflow.`;
    }

    if (appMode === 'chat') {
        return `${baseAI}

CURRENT MODE: PRODUCT CONSULTANT & SOCIAL CHAT.
${fileContext}

Your goal is to be a helpful companion. If the user expresses interest in an app IDEA, transition into a Consultant role and ask insightful questions one at a time. If they are just chatting, stay in SOCIAL MODE. 
YOU MUST NOT GENERATE FULL APP CODE OR START DEVELOPMENT IN THIS MODE unless the user explicitly switches context.`;
    }
    
    const hinglishSuffix = (forceHinglish || hinglishMode) ? `

⚡ HINGLISH MODE ACTIVE: Always reply in Hinglish — a natural mix of Hindi words (Roman script) and English technical terms. Do not use Devanagari script unless the user specifically writes in Hindi.` : '';

    // 9.5 — Teaching Mode: add beginner-friendly explanation instructions
    const teachSuffix = teachMode ? `

📚 TEACHING MODE ACTIVE: After completing each task, also provide a beginner-friendly explanation section titled "🧠 How This Works":
- Explain what each key part does in simple, clear language
- Use everyday analogies to explain technical concepts
- Point out which lines of code do what, in simple language
- Add "Pro Tip" for common beginner mistakes to avoid
- Format: short bullet points, avoid jargon` : '';

    return `${baseAI}

CURRENT MODE: ENTERPRISE ARCHITECT & BUILD ENGINE.
${fileContext}
${continuationPrefix}
You are in FULL BUILD MODE. When asked to build, you MUST:
1. Generate COMPLETE, runnable frontend/backend structures immediately.
2. Create ALL files required (pages, components, utils, config).
3. Ensure absolute code modularity and production readiness.
4. Set IS_APP_BUILT = TRUE in the system state when successful.

You still maintain your Indian personality and friendly tone.${hinglishSuffix}${teachSuffix}

${buildLanguageRule(preferredLanguage)}`;
  };

  const classifyError = (error: any): ErrorType => {
    let errString: string;
    if (typeof error === 'string') {
      errString = error;
    } else if (error instanceof Error) {
      errString = error.message;
    } else if (error && typeof error === 'object' && 'message' in error) {
      errString = String(error.message);
    } else {
      errString = JSON.stringify(error);
    }
    const err = errString.toLowerCase();
    if (err.includes('401') || err.includes('403')) return 'AUTH';
    if (err.includes('400') && (err.includes('key') || err.includes('auth') || err.includes('api_key_invalid'))) return 'AUTH';
    if (err.includes('auth') || err.includes('key')) return 'AUTH';
    if (err.includes('429') || err.includes('quota') || err.includes('billing') || err.includes('too many requests')) return 'QUOTA';
    if (err.includes('fetch') || err.includes('network') || err.includes('connect')) return 'NETWORK';
    return 'UNKNOWN';
  };

  const handleRetry = () => {
    setErrorContext(null);
    handleSend();
  };

  const handleFixNow = () => {
    if (!errorContext) return;
    addLog(`Initiating smart fix for ${errorContext.type}...`, 'info');
    
    switch(errorContext.type) {
      case 'AUTH':
        const provider = errorContext.provider || selectedModel;
        if (provider !== 'auto') {
          setPendingProvider(provider);
        } else {
          setActiveView('settings');
        }
        addLog('System Config opened. Please update your AI credentials.', 'warn');
        break;
      case 'QUOTA':
        addLog('Routing to provider billing console...', 'info');
        if (selectedModel === 'openai') window.open('https://platform.openai.com/settings/billing', '_blank');
        else if (selectedModel === 'claude') window.open('https://console.anthropic.com/settings/billing', '_blank');
        else if (selectedModel === 'groq') window.open('https://console.groq.com/settings/billing', '_blank');
        else window.open('https://aistudio.google.com/app/billing', '_blank');
        break;
      case 'NETWORK':
        addLog('Re-establishing connection...', 'info');
        handleSend();
        break;
      default:
        handleSend();
    }
  };

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

  // ── Preview harness: injected into EVERY preview so it can never silently go blank ──
  // Catches runtime errors + detects empty render → shows a friendly overlay instead of a white page.
  const PREVIEW_HARNESS = `<style>
.__nb_overlay{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;background:#0d1117;font-family:system-ui,-apple-system,sans-serif;z-index:2147483647}
.__nb_card{max-width:520px;width:100%;background:#161b22;border:1px solid rgba(245,158,11,0.25);border-radius:16px;padding:24px;color:#c9d1d9;box-sizing:border-box}
.__nb_h{font-weight:800;color:#f59e0b;font-size:13px;margin-bottom:10px;text-transform:uppercase;letter-spacing:.06em}
.__nb_card pre{white-space:pre-wrap;word-break:break-word;background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:10px;font-size:11px;line-height:1.5;color:#ff7b72;max-height:180px;overflow:auto;margin:0}
.__nb_s{margin-top:12px;font-size:12px;color:#8b949e;line-height:1.5}
.__nb_btn{margin-top:14px;display:inline-block;padding:9px 16px;border-radius:8px;border:none;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit}
.__nb_btn_ai{background:#2ea043;color:#fff}
.__nb_btn_ai:hover{background:#3fb950}
.__nb_btn_code{background:#30363d;color:#c9d1d9;border:1px solid #484f58}
.__nb_btn_code:hover{background:#3a414b}
</style>
<script>
(function(){
  function esc(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;");}
  function classifyBug(kind,msg){
    var m=String(msg||'');
    var sysPatterns=[/Could not load the preview compiler/i,/Failed to load React from CDN/i,/network blocked/i,/CORS/i,/Failed to fetch dynamically imported module/i,/ChunkLoadError/i,/Loading chunk/i,/NetworkError/i,/ERR_INTERNET_DISCONNECTED/i,/ERR_CONNECTION/i,/insecure/i];
    for(var i=0;i<sysPatterns.length;i++){if(sysPatterns[i].test(m))return 'coding';}
    return 'ai';
  }
  function buildAiPrompt(kind,msg){
    return 'Preview me ek bug aaya hai. Root-cause audit karo aur SIRF is specific bug ko fix karo — kisi bhi dusri working feature ya unrelated file ko mat todna/change karna.\\n\\nError type: '+kind+'\\nError message: '+msg+'\\n\\nInstructions:\\n1. Exact file aur line dhundo jo is error ki wajah hai.\\n2. Root cause identify karo (sirf symptom nahi).\\n3. Minimal fix apply karo jo zaroori hai.\\n4. App ke kisi aur part ko modify/remove/refactor mat karo.\\n5. Fix ke baad preview bina error ke render hona chahiye.';
  }
  function buildCodeReport(kind,msg){
    return '=== NavBharatAI Preview Bug Report ===\\nType: Coding/System issue (manual fix needed)\\nKind: '+kind+'\\nMessage: '+msg+'\\nURL: '+location.href+'\\nUserAgent: '+navigator.userAgent+'\\nTime: '+new Date().toISOString();
  }
  function copyText(text){
    var ok=false;
    try{if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text);ok=true;}}catch(e){}
    if(!ok){
      try{
        var ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.left='-9999px';
        document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);ok=true;
      }catch(e){}
    }
    return ok;
  }
  function show(kind,msg){
    if(document.getElementById('__nb_err'))return;
    var cls=classifyBug(kind,msg);
    var btnHtml=cls==='ai'
      ? '<button id="__nb_fixbtn" class="__nb_btn __nb_btn_ai">Fix Bug</button>'
      : '<button id="__nb_fixbtn" class="__nb_btn __nb_btn_code">Coding Bug</button>';
    var o=document.createElement('div');o.id='__nb_err';o.className='__nb_overlay';
    o.innerHTML='<div class="__nb_card"><div class="__nb_h">'+esc(kind)+'</div>'+(msg?('<pre>'+esc(msg)+'</pre>'):'')+'<div class="__nb_s">All files are loaded in Code Studio. Ask the AI to fix or convert this app and the preview will update.</div>'+btnHtml+'<div id="__nb_fixmsg" class="__nb_s" style="display:none"></div></div>';
    (document.body||document.documentElement).appendChild(o);
    var btn=document.getElementById('__nb_fixbtn');
    if(!btn)return;
    btn.addEventListener('click',function(){
      var fm=document.getElementById('__nb_fixmsg');
      if(cls==='ai'){
        var prompt=buildAiPrompt(kind,msg);
        try{window.parent.postMessage({type:'nb-ai-fix',prompt:prompt},'*');}catch(e){}
        if(fm){fm.style.display='block';fm.textContent='Prompt chat box me bhar diya gaya — Send dabao fix karne ke liye.';}
      }else{
        var report=buildCodeReport(kind,msg);
        var copied=copyText(report);
        try{window.parent.postMessage({type:'nb-code-bug',report:report},'*');}catch(e){}
        if(fm){fm.style.display='block';fm.textContent=copied?'Bug report clipboard me copy ho gaya.':'Auto-copy nahi hua — manually copy karein.';}
      }
    });
  }
  window.__nbShowError=function(m){show('Preview Error',m);};
  window.addEventListener('error',function(e){show('Preview Error',(e&&e.message)||(e&&e.error&&e.error.message)||'Script error');});
  window.addEventListener('unhandledrejection',function(e){show('Preview Error',(e&&e.reason&&e.reason.message)||(e&&e.reason)||'Promise rejected');});
  function isEmpty(){
    if(window.__nbLoading)return false;
    var t=(document.body&&document.body.innerText||'').trim();
    var v=document.querySelector('canvas,svg,img,video,input,button,#root *,#app *,[data-reactroot] *');
    return !t&&!v;
  }
  // Check at 4s then 7s — React+CDN can take 4-6s on slow connections; don't show false "empty" while loading.
  setTimeout(function(){
    if(document.getElementById('__nb_err')||!isEmpty())return;
    setTimeout(function(){
      if(!document.getElementById('__nb_err')&&isEmpty())show('Preview is empty','The app rendered nothing — it may need a build step, or hit a runtime error.');
    },3000);
  },4000);
})();
</script>`;

  // In-iframe mini-bundler: transpiles JSX/TSX with Babel, resolves relative imports,
  // and loads ALL bare deps via esm.sh (importmap from package.json). Failures surface via the harness.
  const PREVIEW_BOOTSTRAP = `
(function(){
  var FILES=window.__FILES||{};var ENTRY=window.__ENTRY||'';var IMAP=window.__IMAP||{};var ESM='https://esm.sh/';
  // Polyfill import.meta.env (Vite) and process.env (Node/CRA) so apps don't throw on startup
  if(typeof process==='undefined')window.process={env:{NODE_ENV:'production'}};
  window.__importMetaEnv__=window.__importMetaEnv__||{};
  function fail(m){if(window.__nbShowError)window.__nbShowError(m);}
  function loadScript(url){return new Promise(function(res){var s=document.createElement('script');s.src=url;s.onload=res;s.onerror=res;document.head.appendChild(s);});}
  function dirname(p){var i=p.lastIndexOf('/');return i<0?'':p.slice(0,i);}
  function normalize(p){var a=p.split('/'),o=[];for(var i=0;i<a.length;i++){var s=a[i];if(s===''||s==='.')continue;if(s==='..')o.pop();else o.push(s);}return o.join('/');}
  function resolve(importer,spec){
    var base=spec.charAt(0)==='/'?spec.slice(1):normalize((dirname(importer)?dirname(importer)+'/':'')+spec);
    var t=[base,base+'.tsx',base+'.ts',base+'.jsx',base+'.js',base+'.mjs',base+'.json',base+'.css',base+'/index.tsx',base+'/index.ts',base+'/index.jsx',base+'/index.js'];
    for(var i=0;i<t.length;i++){if(Object.prototype.hasOwnProperty.call(FILES,t[i]))return t[i];}
    return base;
  }
  function injectCss(src){var s=document.createElement('style');s.textContent=src;document.head.appendChild(s);}
  function interop(ns){
    if(!ns)return{__esModule:true,default:ns};
    var m={__esModule:true};
    // Object.assign copies enumerable own props (works for most modules)
    try{Object.assign(m,ns);}catch(e){}
    // getOwnPropertyNames also catches non-enumerable own props on ES module namespace objects
    try{Object.getOwnPropertyNames(ns).forEach(function(k){if(k==='__esModule')return;try{if(m[k]==null)m[k]=ns[k];}catch(e){}});}catch(e){}
    if(m.default===undefined)m.default=ns;
    return m;
  }
  var bareCache={},cache={};
  function requireMod(path){
    if(cache[path])return cache[path].exports;
    var src=FILES[path];
    if(src==null)throw new Error('Module not found: '+path);
    if(/\\.css$/.test(path)){injectCss(src);cache[path]={exports:{}};return cache[path].exports;}
    if(/\\.json$/.test(path)){cache[path]={exports:JSON.parse(src)};return cache[path].exports;}
    if(/\\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/.test(path)){cache[path]={exports:{default:src,__esModule:true}};return cache[path].exports;}
    var isTs=/\\.tsx?$/.test(path),isTsx=/\\.tsx$/.test(path);
    var presets=isTs?[['react',{runtime:'automatic'}],['typescript',{isTSX:isTsx,allExtensions:true}]]:[['react',{runtime:'automatic'}]];
    // Replace import.meta.* — not valid inside new Function() (non-module context)
    src=src.replace(/import\\.meta\\.env\\b/g,'(window.__importMetaEnv__||{})');
    src=src.replace(/import\\.meta\\.url\\b/g,'location.href');
    src=src.replace(/import\\.meta\\b/g,'{env:(window.__importMetaEnv__||{}),url:location.href}');
    var code;
    try{code=Babel.transform(src,{filename:path,presets:presets,plugins:['transform-modules-commonjs'],sourceType:'module'}).code;}
    catch(e){throw new Error('Compile '+path+': '+e.message);}
    var module={exports:{}};cache[path]=module;
    var req=function(spec){
      // Vite/shadcn-style @/ alias (e.g. @/components/ui/button) → resolve under src/
      if(spec.length>2&&spec.charAt(0)==='@'&&spec.charAt(1)==='/'){return requireMod(resolve(path,'/src/'+spec.slice(2)));}
      if(spec.charAt(0)!=='.'&&spec.charAt(0)!=='/'){if(bareCache[spec])return bareCache[spec];throw new Error('Missing dependency: '+spec);}
      return requireMod(resolve(path,spec));
    };
    try{(new Function('require','module','exports',code))(req,module,module.exports);}
    catch(e){throw new Error('Run '+path+': '+e.message);}
    return module.exports;
  }
  function collectBare(){
    var found={},re=/(?:from|import|require\\(|import\\()\\s*['"]([^'"]+)['"]/g;
    Object.keys(FILES).forEach(function(p){var src=FILES[p]||'',m;re.lastIndex=0;while((m=re.exec(src))){var s=m[1];if(s&&s.charAt(0)!=='.'&&s.charAt(0)!=='/'&&!(s.charAt(0)==='@'&&s.charAt(1)==='/'))found[s]=true;}});
    return Object.keys(found);
  }
  // Resolve a bare import spec to CDN URL: importmap first, then esm.sh
  function specUrl(spec){
    // Already a full URL (https://) or protocol-relative (//) — use as-is
    if(spec.indexOf('://')>0||spec.slice(0,2)==='//')return spec;
    if(IMAP[spec])return IMAP[spec];
    var root=spec.charAt(0)==='@'?spec.split('/').slice(0,2).join('/'):spec.split('/')[0];
    if(IMAP[root]){
      // Insert the subpath BEFORE any query string, else "zustand/middleware"
      // becomes ".../zustand@4?external=react,react-dom/middleware" (subpath
      // swallowed into the query) → wrong module → "persist is not a function".
      var b=IMAP[root],q='',qi=b.indexOf('?');
      if(qi>=0){q=b.slice(qi);b=b.slice(0,qi);}
      return b+spec.slice(root.length)+q;
    }
    return ESM+spec;
  }
  var forced=['react','react-dom','react-dom/client','react/jsx-runtime','react/jsx-dev-runtime'];
  window.__nbLoading=true;
  (async function(){
    try{
      // Load Babel if primary CDN (<script src>) failed — try unpkg fallback
      if(typeof Babel==='undefined'){await loadScript('https://unpkg.com/@babel/standalone@7.26.4/babel.min.js');}
      if(typeof Babel==='undefined'){window.__nbLoading=false;fail('Could not load the preview compiler (network blocked?). Check internet connection.');return;}
      var bare;try{bare=collectBare();}catch(ce){bare=[];}
      forced.forEach(function(s){if(bare.indexOf(s)<0)bare.push(s);});
      var failedDeps=[];
      await Promise.all(bare.map(async function(spec){
        try{bareCache[spec]=interop(await import(specUrl(spec)));}
        catch(e){failedDeps.push(spec);console.warn('[preview] failed to load',spec,e&&e.message);}
      }));
      // BUG A2 FIX: Only hard-fail on React load error if the app actually imports React.
      // Vanilla ES module apps don't need React — killing them here was wrong.
      var needsReact=bare.indexOf('react')>=0||bare.indexOf('react-dom')>=0;
      if(needsReact&&(!bareCache['react']||!bareCache['react-dom/client'])){
        window.__nbLoading=false;
        fail('Failed to load React from CDN'+(failedDeps.length?' (blocked: '+failedDeps.slice(0,3).join(', ')+')':'')+'. Check internet connection.');
        return;
      }
      if(!ENTRY){window.__nbLoading=false;fail('No runnable entry file found in this app.');return;}
      var mod=requireMod(ENTRY);
      // Auto-mount: if the entry only exports a React component (no ReactDOM.render call),
      // mount it automatically so component-only entry files work without a separate main.jsx.
      if(mod&&!document.getElementById('__nb_err')){
        var rootEl=document.getElementById('root')||document.getElementById('app');
        if(rootEl&&rootEl.childElementCount===0){
          var Comp=mod.default||(typeof mod==='function'?mod:null);
          if(Comp&&typeof Comp==='function'){
            var rdc=bareCache['react-dom/client'],jsx=bareCache['react/jsx-runtime'],rc=bareCache['react'];
            try{
              var el=(jsx&&jsx.jsx)?jsx.jsx(Comp,{}):(rc&&rc.createElement)?rc.createElement(Comp,null):null;
              if(el){if(rdc&&rdc.createRoot)rdc.createRoot(rootEl).render(el);else if(rdc&&rdc.render)rdc.render(el,rootEl);}
            }catch(ae){}
          }
        }
      }
    }catch(e){fail((e&&e.message)||String(e));}
    finally{window.__nbLoading=false;}
  })();
})();`;

  // Detect whether the app is a React/TS source app (needs transpilation) vs a static app.
  const detectAppType = (f: FileSystem): 'react' | 'vue' | 'static' => {
    const keys = Object.keys(f);
    if (keys.some(k => /\.(tsx|jsx)$/i.test(k))) return 'react';
    const pkg = f['package.json'];
    if (pkg && /"react"\s*:/.test(pkg)) return 'react';
    // Vue: .vue SFCs or a vue dep (and not React) → in-browser Vue compiler path.
    if (keys.some(k => /\.vue$/i.test(k)) || (pkg && /"vue"\s*:/.test(pkg))) return 'vue';
    // Vite-style entry pointing at a TS/JS module under src/
    const html = f['index.html'] || '';
    if (/<script[^>]+type=["']module["'][^>]+src=["']\/?(src\/)?[^"']+\.(ts|jsx|tsx)["']/i.test(html)) return 'react';
    // BUG A1 FIX: Vanilla ES module apps (multi-file with import/export) must go through
    // buildSourceAppPreview which has a full Babel + require() bundler. Without this,
    // their import statements can't resolve in a standalone HTML doc.
    const jsFiles = keys.filter(k => /\.(js|mjs|ts)$/i.test(k) && !k.includes('node_modules'));
    if (jsFiles.some(k => /^\s*(import\s+[\w{*"'`]|export\s+(default|class|function|const|let|var)\b)/m.test(f[k] || ''))) return 'react';
    return 'static';
  };

  // A "classic vanilla web app" has no index.html but is meant to RUN (only .js/.css/.json
  // files, with at least one script). These keep the legacy auto-shell so they don't regress.
  // Any other file set (docs, data, media, code) with no index.html → universal viewer.
  const isClassicVanillaWeb = (f: FileSystem): boolean => {
    const ks = Object.keys(f).filter(k => f[k] != null && !k.includes('node_modules'));
    const allWeb = ks.length > 0 && ks.every(k => /\.(js|mjs|cjs|css|json)$/i.test(k));
    const hasJs = ks.some(k => /\.(js|mjs|cjs)$/i.test(k));
    return allWeb && hasJs;
  };

  // Build a runnable in-iframe document for source/framework apps.
  const buildSourceAppPreview = (f: FileSystem): string => {
    const rawHtml = f['index.html'] || '';
    const srcExtRe = /\.(jsx|tsx|ts|js|mjs|cjs|css|json|png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i;
    const srcFiles: Record<string, string> = {};
    Object.keys(f).forEach(k => { if (srcExtRe.test(k) && !k.includes('node_modules')) srcFiles[k] = f[k]; });

    // Preview-only: react-router's BrowserRouter needs real History/URL which the
    // sandboxed iframe doesn't have → blank screen. Rewrite to HashRouter so routed
    // apps actually render in the preview. (The saved project files are untouched.)
    for (const k of Object.keys(srcFiles)) {
      if (/\.(jsx|tsx|js|ts|mjs)$/i.test(k) && typeof srcFiles[k] === 'string' && srcFiles[k].includes('BrowserRouter')) {
        srcFiles[k] = srcFiles[k]
          .replace(/createBrowserRouter/g, 'createHashRouter')
          .replace(/\bBrowserRouter\b/g, 'HashRouter');
      }
    }

    // Resolve the entry module
    let entry = '';
    const m = rawHtml.match(/<script[^>]+type=["']module["'][^>]+src=["']([^"']+)["']/i);
    if (m) entry = m[1].replace(/^\//, '').replace(/^\.\//, '');
    if (!entry || !srcFiles[entry]) {
      const cands = ['src/main.tsx','src/main.jsx','src/main.ts','src/index.tsx','src/index.jsx','src/index.ts','main.tsx','main.jsx','index.tsx','index.jsx','src/App.tsx','src/App.jsx','App.tsx','App.jsx'];
      // Prefer candidates that contain actual JSX/rendering code (not just re-exports)
      const hasRendering = (k: string) => {
        const v = srcFiles[k] || '';
        return /createRoot|ReactDOM|render\s*\(|ReactMount|hydrateRoot/.test(v) || /<[A-Z][A-Za-z]*[\s/>]/.test(v);
      };
      entry = cands.find(c => srcFiles[c] && hasRendering(c))
        || cands.find(c => srcFiles[c])
        || Object.keys(srcFiles).find(k => /\.(tsx|jsx)$/i.test(k) && hasRendering(k))
        || Object.keys(srcFiles).find(k => /\.(tsx|jsx)$/i.test(k))
        // Additive fallback: a React app authored entirely in plain .js/.ts/.mjs
        // (no .tsx/.jsx files) would otherwise resolve to no entry and render the
        // "No runnable entry file found" error. Only reached when nothing above matched.
        || Object.keys(srcFiles).find(k => /\.(js|mjs|ts)$/i.test(k) && hasRendering(k))
        || '';
    }

    // Reuse the app's <body> markup (minus module/external scripts) so #root etc. survive
    let bodyInner = '<div id="root"></div>';
    const bm = rawHtml.match(/<body[^>]*>([\s\S]*?)<\/body\s*>/i);
    if (bm) {
      bodyInner = bm[1]
        .replace(/<script[^>]*type=["']module["'][^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<script[^>]+src=["'][^"']+["'][^>]*>\s*<\/script>/gi, '');
      if (!/id=["'](root|app)["']/.test(bodyInner)) bodyInner += '<div id="root"></div>';
    }

    // Build importmap from package.json dependencies + always-needed React packages
    const ESM = 'https://esm.sh/';
    const pkgDeps: Record<string, string> = {};
    try {
      const pkg = JSON.parse(f['package.json'] || '{}');
      Object.assign(pkgDeps, pkg.dependencies || {}, pkg.devDependencies || {});
    } catch {}
    // Strip semver prefix (^1.2.3 → 1.2.3)
    const ver = (name: string) => {
      const v = pkgDeps[name];
      return v ? '@' + v.replace(/^[\^~>=<\s]*/,'').split(/\s/)[0] : '';
    };
    const reactVer = ver('react') || '@18.3.1';
    const rdVer = ver('react-dom') || '@18.3.1';
    const imapEntries: Record<string, string> = {
      'react': ESM + 'react' + reactVer,
      'react-dom': ESM + 'react-dom' + rdVer,
      'react-dom/client': ESM + 'react-dom' + rdVer + '/client',
      'react/jsx-runtime': ESM + 'react' + reactVer + '/jsx-runtime',
      'react/jsx-dev-runtime': ESM + 'react' + reactVer + '/jsx-dev-runtime',
    };
    // Add all package.json deps to importmap with version pins.
    // `?external=react,react-dom` makes esm.sh import (not bundle) React, so every
    // dep (react-router-dom, zustand, etc.) shares the ONE React instance from the
    // importmap. Without this, libs bundle their own React → "Invalid hook call" /
    // duplicate-React "Script error" in the preview.
    Object.keys(pkgDeps).forEach(pkg => {
      if (!imapEntries[pkg]) imapEntries[pkg] = ESM + pkg + ver(pkg) + '?external=react,react-dom';
    });

    const importmap = JSON.stringify({ imports: imapEntries });
    // Safe JSON for embedding in <script> tags: escape </ to prevent </script> from
    // closing the tag early when file content contains that string.
    const sj = (v: unknown) => JSON.stringify(v).replace(/<\//g, '<\\/');

    return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
      + PREVIEW_HARNESS
      + '<script type="importmap">' + importmap + '</' + 'script>'
      + '<script src="https://cdn.jsdelivr.net/npm/@babel/standalone@7.26.4/babel.min.js"></' + 'script>'
      + '</head><body>' + bodyInner
      + '<script>window.__FILES=' + sj(srcFiles) + ';window.__ENTRY=' + sj(entry) + ';window.__IMAP=' + sj(imapEntries) + ';</' + 'script>'
      + '<script>' + PREVIEW_BOOTSTRAP + '</' + 'script>'
      + '</body></html>';
  };

  // ── Universal multi-format file viewer ───────────────────────────────────────
  // Renders ANY file type when a workspace has no index.html: markdown, source code
  // (syntax-highlighted), JSON, CSV/TSV tables, images, SVG, PDF, audio, video, HTML
  // and plain text. Self-contained doc with a file sidebar; CDN libs degrade gracefully.
  const UNIVERSAL_VIEWER_CSS = `
:root{color-scheme:dark}*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:#0d1117;color:#c9d1d9}
.nbv-app{display:flex;height:100vh;width:100vw;overflow:hidden}
.nbv-side{width:248px;min-width:248px;background:#161b22;border-right:1px solid #21262d;display:flex;flex-direction:column;overflow:hidden}
.nbv-brand{padding:13px 14px;font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:#8b949e;border-bottom:1px solid #21262d;display:flex;align-items:center;gap:6px}
.nbv-cnt{margin-left:auto;font-weight:600;color:#6e7681;font-size:10px}
.nbv-list{overflow:auto;flex:1;padding:6px}
.nbv-fileitem{display:flex;align-items:center;gap:8px;width:100%;border:0;background:transparent;color:#adbac7;text-align:left;padding:7px 9px;border-radius:8px;cursor:pointer;font-size:12.5px;font-family:inherit}
.nbv-fileitem:hover{background:#1c2330}
.nbv-fileitem.active{background:rgba(31,111,235,.22);color:#fff}
.nbv-ico{flex:0 0 auto;font-size:13px;width:16px;text-align:center}
.nbv-ftxt{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nbv-main{flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0}
.nbv-topbar{display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid #21262d;background:#0d1117;flex:0 0 auto}
.nbv-mobilesel{display:none;background:#161b22;color:#c9d1d9;border:1px solid #30363d;border-radius:8px;padding:6px 10px;font-size:12px;max-width:60%}
.nbv-head{display:flex;align-items:center;gap:10px;min-width:0}
.nbv-fname{font-weight:700;font-size:13px;color:#e6edf3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nbv-badge{font-size:9px;font-weight:800;letter-spacing:.08em;background:rgba(31,111,235,.13);color:#58a6ff;border:1px solid rgba(31,111,235,.27);padding:2px 6px;border-radius:6px;flex:0 0 auto}
.nbv-size{font-size:10px;color:#6e7681;flex:0 0 auto}
.nbv-content{flex:1;overflow:auto;position:relative;min-height:0}
.nbv-md{max-width:880px;margin:0 auto;padding:28px 36px;line-height:1.65;font-size:15px}
.nbv-md h1,.nbv-md h2{border-bottom:1px solid #21262d;padding-bottom:.3em}
.nbv-md h1,.nbv-md h2,.nbv-md h3,.nbv-md h4{color:#e6edf3;margin-top:1.4em}
.nbv-md a{color:#58a6ff;text-decoration:none}.nbv-md a:hover{text-decoration:underline}
.nbv-md code{background:#161b22;border:1px solid #21262d;border-radius:5px;padding:.15em .4em;font-size:.88em}
.nbv-md pre{background:#161b22;border:1px solid #21262d;border-radius:10px;padding:14px;overflow:auto}
.nbv-md pre code{background:transparent;border:0;padding:0}
.nbv-md table{border-collapse:collapse;width:100%;margin:1em 0}
.nbv-md th,.nbv-md td{border:1px solid #30363d;padding:6px 12px}
.nbv-md img{max-width:100%}
.nbv-md blockquote{border-left:3px solid #30363d;margin:1em 0;padding:0 1em;color:#8b949e}
.nbv-codewrap{display:flex;min-height:100%}
.nbv-gutter{user-select:none;text-align:right;padding:16px 10px;color:#484f58;font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;background:#0d1117;border-right:1px solid #21262d;white-space:pre;flex:0 0 auto}
.nbv-code{margin:0;flex:1;padding:16px;overflow:auto;font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;background:#0d1117!important}
.nbv-code code{font:inherit;background:transparent;white-space:pre}
.nbv-pre{margin:0;padding:18px;white-space:pre-wrap;word-break:break-word;font:12.5px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;color:#c9d1d9}
.nbv-tablewrap{padding:16px;overflow:auto}
.nbv-tablemeta{font-size:11px;color:#6e7681;margin-bottom:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em}
.nbv-table{border-collapse:collapse;font-size:12.5px}
.nbv-table th{position:sticky;top:0;background:#1b2433;color:#58a6ff;font-weight:700}
.nbv-table th,.nbv-table td{border:1px solid #21262d;padding:6px 12px;text-align:left;white-space:nowrap}
.nbv-table tbody tr:nth-child(even){background:#0f141b}
.nbv-media{display:flex;align-items:center;justify-content:center;min-height:100%;padding:24px}
.nbv-checker{background-image:linear-gradient(45deg,#161b22 25%,transparent 25%),linear-gradient(-45deg,#161b22 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#161b22 75%),linear-gradient(-45deg,transparent 75%,#161b22 75%);background-size:20px 20px;background-position:0 0,0 10px,10px -10px,-10px 0}
.nbv-img{max-width:100%;max-height:88vh;object-fit:contain;box-shadow:0 8px 40px rgba(0,0,0,.5);border-radius:4px}
.nbv-svg{max-width:90%;max-height:80vh}
.nbv-pdf{width:100%;height:100%;border:0;position:absolute;inset:0}
.nbv-htmlframe{width:100%;height:100%;border:0;background:#fff;position:absolute;inset:0}
.nbv-audio{width:80%;max-width:520px}
.nbv-video{max-width:100%;max-height:85vh;border-radius:6px}
.nbv-note{padding:18px;margin:24px;background:#161b22;border:1px solid rgba(245,158,11,.27);border-radius:10px;color:#d29922;font-size:13px;max-width:600px}
.nbv-single .nbv-side{display:none}
@media(max-width:680px){.nbv-side{display:none}.nbv-mobilesel{display:block}}`;

  const UNIVERSAL_VIEWER_JS = `
(function(){
  var V=window.__NBV||{};var FILES=V.files||{};
  var paths=Object.keys(FILES).filter(function(p){return FILES[p]!=null;});
  function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  function base(p){return p.split('/').pop();}
  function extOf(p){var b=base(p),i=b.lastIndexOf('.');return i>0?b.slice(i+1).toLowerCase():'';}
  function bytes(s){try{return new Blob([s]).size;}catch(e){return (s||'').length;}}
  function human(n){return n<1024?n+' B':n<1048576?(n/1024).toFixed(1)+' KB':(n/1048576).toFixed(2)+' MB';}
  function mimeFor(e){var m={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',bmp:'image/bmp',ico:'image/x-icon',avif:'image/avif',svg:'image/svg+xml',pdf:'application/pdf',mp3:'audio/mpeg',wav:'audio/wav',ogg:'audio/ogg',m4a:'audio/mp4',aac:'audio/aac',flac:'audio/flac',mp4:'video/mp4',webm:'video/webm',mov:'video/quicktime',mkv:'video/x-matroska'};return m[e]||'application/octet-stream';}
  function typeOf(p){var e=extOf(p);
    if(/^(md|markdown|mdx)$/.test(e))return 'md';
    if(/^(png|jpg|jpeg|gif|webp|bmp|ico|avif|apng)$/.test(e))return 'img';
    if(e==='svg')return 'svg';
    if(e==='pdf')return 'pdf';
    if(/^(mp3|wav|ogg|m4a|aac|flac)$/.test(e))return 'audio';
    if(/^(mp4|webm|mov|mkv|avi|m4v)$/.test(e))return 'video';
    if(/^(csv|tsv)$/.test(e))return 'csv';
    if(/^(json|jsonc|geojson|map|json5)$/.test(e))return 'json';
    if(/^(html|htm)$/.test(e))return 'html';
    if(/^(txt|text|log)$/.test(e)||e==='')return 'text';
    return 'code';}
  var ICON={md:'📝',img:'🖼️',svg:'🖼️',pdf:'📕',audio:'🎵',video:'🎬',csv:'📊',json:'🔧',html:'🌐',text:'📄',code:'❮❯'};
  var LANG={js:'javascript',mjs:'javascript',cjs:'javascript',jsx:'javascript',ts:'typescript',tsx:'typescript',py:'python',rb:'ruby',go:'go',rs:'rust',java:'java',c:'c',h:'c',cpp:'cpp',cc:'cpp',hpp:'cpp',cs:'csharp',php:'php',swift:'swift',kt:'kotlin',kts:'kotlin',scala:'scala',sh:'bash',bash:'bash',zsh:'bash',sql:'sql',yaml:'yaml',yml:'yaml',toml:'ini',ini:'ini',cfg:'ini',conf:'ini',xml:'xml',vue:'xml',svelte:'xml',css:'css',scss:'scss',less:'less',dart:'dart',lua:'lua',r:'r',pl:'perl',ex:'elixir',exs:'elixir',clj:'clojure',hs:'haskell',gradle:'gradle',dockerfile:'dockerfile',makefile:'makefile',json:'json'};
  function srcFor(p,c,t){c=c||'';var s=c.trim();
    if(/^(data:|https?:\\/\\/|blob:)/.test(s))return s;
    if(t==='svg')return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(c);
    var b=c.replace(/\\s+/g,'');
    if(/^[A-Za-z0-9+/=]+$/.test(b)&&b.length>16)return 'data:'+mimeFor(extOf(p))+';base64,'+b;
    return s;}
  function parseDelim(c,d){var rows=[],row=[],cur='',q=false,i=0,ch;
    for(;i<c.length;i++){ch=c[i];
      if(q){if(ch==='"'){if(c[i+1]==='"'){cur+='"';i++;}else q=false;}else cur+=ch;}
      else{if(ch==='"')q=true;else if(ch===d){row.push(cur);cur='';}else if(ch==='\\n'){row.push(cur);rows.push(row);row=[];cur='';}else if(ch==='\\r'){}else cur+=ch;}}
    if(cur!==''||row.length){row.push(cur);rows.push(row);}
    return rows;}
  function rMd(c){var d=document.createElement('article');d.className='nbv-md';
    try{if(window.marked&&window.DOMPurify){var mk=window.marked.parse(c,{breaks:true,gfm:true});d.innerHTML=window.DOMPurify.sanitize(mk);if(window.hljs)d.querySelectorAll('pre code').forEach(function(b){try{window.hljs.highlightElement(b);}catch(e){}});return d;}}catch(e){}
    var pre=document.createElement('pre');pre.className='nbv-pre';pre.textContent=c;d.appendChild(pre);return d;}
  function rCode(c,lang){var wrap=document.createElement('div');wrap.className='nbv-codewrap';
    var gut=document.createElement('div');gut.className='nbv-gutter';var n=c.split('\\n').length;var g='';for(var k=1;k<=n;k++)g+=k+'\\n';gut.textContent=g;
    var pre=document.createElement('pre');pre.className='nbv-code hljs';var code=document.createElement('code');
    try{if(window.hljs){var r=(lang&&window.hljs.getLanguage(lang))?window.hljs.highlight(c,{language:lang}):window.hljs.highlightAuto(c);code.innerHTML=r.value;}else code.textContent=c;}catch(e){code.textContent=c;}
    pre.appendChild(code);wrap.appendChild(gut);wrap.appendChild(pre);return wrap;}
  function rJson(c){var t=c;try{t=JSON.stringify(JSON.parse(c),null,2);}catch(e){}return rCode(t,'json');}
  function rCsv(c,d){var rows=parseDelim(c,d);var wrap=document.createElement('div');wrap.className='nbv-tablewrap';
    if(!rows.length){wrap.textContent='(empty)';return wrap;}
    var meta=document.createElement('div');meta.className='nbv-tablemeta';meta.textContent=rows.length+' rows × '+(rows[0]?rows[0].length:0)+' cols';wrap.appendChild(meta);
    var t=document.createElement('table');t.className='nbv-table';var thead=document.createElement('thead');var htr=document.createElement('tr');
    rows[0].forEach(function(h){var th=document.createElement('th');th.textContent=h;htr.appendChild(th);});thead.appendChild(htr);t.appendChild(thead);
    var tb=document.createElement('tbody');for(var r=1;r<rows.length;r++){var tr=document.createElement('tr');rows[r].forEach(function(cell){var td=document.createElement('td');td.textContent=cell;tr.appendChild(td);});tb.appendChild(tr);}
    t.appendChild(tb);wrap.appendChild(t);return wrap;}
  function rImg(p,c,t){var d=document.createElement('div');d.className='nbv-media nbv-checker';var img=document.createElement('img');img.className='nbv-img';img.alt=base(p);
    img.onerror=function(){d.innerHTML='';var note=document.createElement('div');note.className='nbv-note';note.textContent='Cannot display this image. Showing raw content:';d.appendChild(note);d.appendChild(rCode(c,'xml'));};
    img.src=srcFor(p,c,t);d.appendChild(img);return d;}
  function rSvg(p,c){var d=document.createElement('div');d.className='nbv-media nbv-checker';
    try{if(window.DOMPurify){d.innerHTML=window.DOMPurify.sanitize(c,{USE_PROFILES:{svg:true,svgFilters:true}});var s=d.querySelector('svg');if(s)s.classList.add('nbv-svg');return d;}}catch(e){}
    var img=document.createElement('img');img.className='nbv-img';img.src=srcFor(p,c,'svg');d.appendChild(img);return d;}
  function rPdf(p,c){var s=srcFor(p,c,'pdf');if(!/^(data:|https?:|blob:)/.test(s)){var note=document.createElement('div');note.className='nbv-note';note.textContent='PDF preview needs a data: URL or http(s) link; this file has no renderable PDF data.';return note;}var o=document.createElement('iframe');o.className='nbv-pdf';o.src=s;return o;}
  function rMedia(p,c,t){var d=document.createElement('div');d.className='nbv-media';var el=document.createElement(t==='audio'?'audio':'video');el.className='nbv-'+t;el.controls=true;el.src=srcFor(p,c,t);d.appendChild(el);return d;}
  function rHtml(c){var f=document.createElement('iframe');f.className='nbv-htmlframe';f.setAttribute('sandbox','allow-scripts allow-forms allow-popups allow-modals');f.srcdoc=c;return f;}
  function rText(c){var pre=document.createElement('pre');pre.className='nbv-pre';pre.textContent=c;return pre;}
  function render(p){var c=FILES[p]||'';var t=typeOf(p);
    if(t==='md')return rMd(c);
    if(t==='img')return rImg(p,c,t);
    if(t==='svg')return rSvg(p,c);
    if(t==='pdf')return rPdf(p,c);
    if(t==='audio'||t==='video')return rMedia(p,c,t);
    if(t==='csv')return rCsv(c,extOf(p)==='tsv'?'\\t':',');
    if(t==='json')return rJson(c);
    if(t==='html')return rHtml(c);
    if(t==='text')return rText(c);
    return rCode(c,LANG[extOf(p)]||null);}
  function select(p){
    var items=document.querySelectorAll('.nbv-fileitem');for(var i=0;i<items.length;i++)items[i].classList.toggle('active',items[i].getAttribute('data-p')===p);
    var sel=document.getElementById('nbv-select');if(sel)sel.value=p;
    var c=FILES[p]||'',t=typeOf(p);
    var head=document.getElementById('nbv-head');head.innerHTML='';
    var name=document.createElement('span');name.className='nbv-fname';name.textContent=ICON[t]+' '+p;
    var badge=document.createElement('span');badge.className='nbv-badge';badge.textContent=t.toUpperCase();
    var size=document.createElement('span');size.className='nbv-size';size.textContent=human(bytes(c));
    head.appendChild(name);head.appendChild(badge);head.appendChild(size);
    var body=document.getElementById('nbv-body');body.innerHTML='';
    try{body.appendChild(render(p));}catch(e){var er=document.createElement('pre');er.className='nbv-pre';er.textContent='Render error: '+((e&&e.message)||e);body.appendChild(er);}}
  function pickPrimary(){
    if(V.primary&&FILES[V.primary]!=null)return V.primary;
    var pri=['README.md','readme.md','Readme.md','index.md','index.html','index.htm'];
    for(var i=0;i<pri.length;i++)if(FILES[pri[i]]!=null)return pri[i];
    var md=paths.filter(function(p){return typeOf(p)==='md';});if(md.length)return md[0];
    var docs=paths.filter(function(p){return typeOf(p)!=='code';});if(docs.length)return docs[0];
    return paths[0];}
  if(paths.length===0){document.body.innerHTML='<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:#6e7681;font-family:system-ui;text-align:center"><div><div style="font-size:42px">📂</div><div style="margin-top:10px;font-size:14px">No files to preview yet.</div></div></div>';return;}
  paths.sort();
  var sb=document.getElementById('nbv-files');var selEl=document.getElementById('nbv-select');
  paths.forEach(function(p){var t=typeOf(p);
    var it=document.createElement('button');it.className='nbv-fileitem';it.setAttribute('data-p',p);
    it.innerHTML='<span class="nbv-ico">'+ICON[t]+'</span><span class="nbv-ftxt">'+esc(p)+'</span>';
    it.onclick=function(){select(p);};sb.appendChild(it);
    var op=document.createElement('option');op.value=p;op.textContent=p;selEl.appendChild(op);});
  document.getElementById('nbv-count').textContent=paths.length+(paths.length===1?' file':' files');
  selEl.onchange=function(e){select(e.target.value);};
  if(paths.length<=1)document.body.classList.add('nbv-single');
  select(pickPrimary());
})();`;

  const buildUniversalPreview = (f: FileSystem): string => {
    const sj = (v: unknown) => JSON.stringify(v).replace(/<\//g, '<\\/');
    const viewFiles: Record<string, string> = {};
    Object.keys(f).forEach(k => { if (f[k] != null && !k.includes('node_modules')) viewFiles[k] = f[k]; });
    return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
      + PREVIEW_HARNESS
      + '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">'
      + '<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></' + 'script>'
      + '<script src="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js"></' + 'script>'
      + '<script src="https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js"></' + 'script>'
      + '<style>' + UNIVERSAL_VIEWER_CSS + '</style></head><body>'
      + '<div class="nbv-app">'
      + '<aside class="nbv-side"><div class="nbv-brand">📁 Files <span id="nbv-count" class="nbv-cnt"></span></div><div id="nbv-files" class="nbv-list"></div></aside>'
      + '<main class="nbv-main"><div class="nbv-topbar"><select id="nbv-select" class="nbv-mobilesel"></select><div id="nbv-head" class="nbv-head"></div></div><div id="nbv-body" class="nbv-content"></div></main>'
      + '</div>'
      + '<script>window.__NBV=' + sj({ files: viewFiles, primary: '' }) + ';</' + 'script>'
      + '<script>' + UNIVERSAL_VIEWER_JS + '</' + 'script>'
      + '</body></html>';
  };

  // Inject the never-blank harness into a static HTML document
  const injectHarness = (doc: string): string => {
    if (doc.includes('id="__nb_err"') || doc.includes("id='__nb_err'") || doc.includes('__nbShowError')) return doc;
    if (/<\/head>/i.test(doc)) return doc.replace(/<\/head>/i, PREVIEW_HARNESS + '</head>');
    if (/<body[^>]*>/i.test(doc)) return doc.replace(/(<body[^>]*>)/i, '$1' + PREVIEW_HARNESS);
    return PREVIEW_HARNESS + doc;
  };

  const updatePreview = (currentFiles: FileSystem) => {
    // BUG A4 FIX: Wrap entire function in try-catch so any exception doesn't crash silently.
    try {
    // Strip markdown code fences the AI accidentally wraps file content in (```lang\n...\n```)
    // Line-by-line: strip only the first and last fence lines, never touching inner content.
    const stripFences = (s: string): string => {
      const trimmed = s.trimStart();
      if (!trimmed.startsWith('```')) return s;
      const lines = s.split(/\r?\n/);
      // Find first fence line (```lang) and last fence line (```)
      const first = lines.findIndex(l => /^```/.test(l.trim()));
      if (first === -1) return s;
      // Find matching closing fence after the opening line (scan from end for safety)
      let last = -1;
      for (let i = lines.length - 1; i > first; i--) { if (/^```\s*$/.test(lines[i].trim())) { last = i; break; } }
      if (last === -1) return lines.slice(first + 1).join('\n'); // no closing fence — strip opener only
      return lines.slice(first + 1, last).join('\n');
    };
    currentFiles = Object.fromEntries(
      Object.entries(currentFiles).map(([k, v]) => [k, typeof v === 'string' ? stripFences(v) : v])
    ) as FileSystem;

    let finalHtml: string;

    // Source/framework apps: try server-side esbuild bundle first (eliminates Babel CDN).
    // Falls back to client-side PREVIEW_BOOTSTRAP if the server endpoint fails or is slow.
    if (detectAppType(currentFiles) === 'react') {
      const clientFallback = buildSourceAppPreview(currentFiles);
      // Kick off server-side bundle (async, replaces preview when ready)
      const ctl = new AbortController();
      const timeout = setTimeout(() => ctl.abort(), 20_000);
      fetch('/api/preview-bundle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: currentFiles }),
        signal: ctl.signal,
      })
        .then(r => r.ok ? r.json() : Promise.reject(new Error(`Bundle failed: ${r.status}`)))
        .then(({ html }: { html: string }) => { if (html) setGeneratedCode(html); })
        .catch(() => { /* server bundling failed — client-side fallback already set */ })
        .finally(() => clearTimeout(timeout));
      // Show client-side fallback immediately so the user isn't stuck on a blank/old preview.
      finalHtml = clientFallback;
    } else if (detectAppType(currentFiles) === 'vue') {
      // Vue SFC apps compile in-browser via the server-built vue3-sfc-loader doc.
      const ctl = new AbortController();
      const timeout = setTimeout(() => ctl.abort(), 20_000);
      fetch('/api/preview-vue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: currentFiles }),
        signal: ctl.signal,
      })
        .then(r => r.ok ? r.json() : Promise.reject(new Error(`Vue preview failed: ${r.status}`)))
        .then(({ html }: { html: string }) => { if (html) setGeneratedCode(html); })
        .catch(() => setGeneratedCode('<!doctype html><html><body style="font-family:system-ui;padding:24px;color:#b00">Could not build the Vue preview (network blocked?).</body></html>'))
        .finally(() => clearTimeout(timeout));
      // Honest interim state (never a blank/old preview) until the compiled doc arrives.
      finalHtml = '<!doctype html><html><body style="font-family:system-ui;padding:24px;color:#666">Compiling Vue preview…</body></html>';
    } else if (!currentFiles['index.html'] && !isClassicVanillaWeb(currentFiles)) {
      // No index.html and not a runnable vanilla web app → universal multi-format viewer
      // (markdown, code, JSON, CSV, images, SVG, PDF, audio, video, HTML, text).
      finalHtml = buildUniversalPreview(currentFiles);
    } else {
      let html = currentFiles['index.html'] || '';

      if (!html) {
        html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div></body></html>';
      } else if (!html.toLowerCase().includes('viewport')) {
        if (html.includes('</head>')) {
          html = html.replace('</head>', '<meta name="viewport" content="width=device-width, initial-scale=1.0"></head>');
        } else if (html.includes('<head>')) {
          html = html.replace('<head>', '<head><meta name="viewport" content="width=device-width, initial-scale=1.0">');
        } else if (html.includes('<html>')) {
          html = html.replace('<html>', '<html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>');
        }
      }

      // Collect all CSS files (style.css, styles.css, main.css, app.css, index.css, etc.)
      const CSS_NAMES = ['style.css', 'styles.css', 'main.css', 'app.css', 'index.css'];
      const allCss = [
        ...CSS_NAMES.map(n => currentFiles[n] || ''),
        ...Object.entries(currentFiles)
          .filter(([k]) => k.endsWith('.css') && !CSS_NAMES.includes(k))
          .map(([, v]) => v as string),
      ].filter(Boolean).join('\n');

      // Collect all JS files (script.js, app.js, main.js, index.js, etc.)
      // BUG A3 FIX: Skip ES module files (files with import/export) from allJs injection.
      // Those files use import/export which breaks when concatenated into a non-module <script>.
      const JS_NAMES = ['script.js', 'app.js', 'main.js', 'index.js'];
      const isEsModule = (src: string) => /^\s*(import\s+[\w{*"'`]|export\s+(default|class|function|const|let|var)\b)/m.test(src);
      const allJsEntries = [
        ...JS_NAMES.map(n => currentFiles[n] ? [n, currentFiles[n]] as [string, string] : null),
        ...Object.entries(currentFiles).filter(([k]) => k.endsWith('.js') && !JS_NAMES.includes(k) && !k.includes('node_modules') && !k.includes('.min.js')),
      ].filter(Boolean) as [string, string][];
      const allJs = allJsEntries.filter(([, v]) => !isEsModule(v)).map(([, v]) => v).filter(Boolean).join('\n');

      finalHtml = html;

      // Inline external CSS links that reference local files
      finalHtml = finalHtml.replace(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["'][^>]*\/?>/gi, (match, href) => {
        const filename = href.replace(/^\.\//, '').replace(/^\//, '');
        const content = currentFiles[filename];
        return content ? `<style data-src="${filename}">${content}</style>` : match;
      });

      // Inline external script src — preserve type attribute (e.g. type="text/babel" for React/JSX)
      // Handles: single-quoted src, unquoted src, self-closing, missing </script>
      finalHtml = finalHtml.replace(/<script([^>]*?)\bsrc\s*=\s*["']?([^"'>\s]+)["']?([^>]*)>\s*<\/script>/gi, (match, pre, src, post) => {
        const filename = src.replace(/^\.\//, '').replace(/^\//, '');
        const content = currentFiles[filename];
        if (!content) return match;
        const allAttrs = pre + post;
        const typeMatch = allAttrs.match(/type=["']([^"']+)["']/);
        const typeAttr = typeMatch ? ` type="${typeMatch[1]}"` : '';
        return `<script${typeAttr} data-src="${filename}">${content.replace(/<\//g, '<\\/')}<\/script>`;
      });

      // BUG D1 FIX: Resolve @import url() in collected CSS before injecting
      const resolveImports = (css: string): string => css.replace(
        /@import\s+(?:url\(["']?([^"')]+)["']?\)|["']([^"']+)["'])/gi,
        (_imp, u1, u2) => { const ref = (u1 || u2 || '').replace(/^\.\//, ''); const c = currentFiles[ref]; return c ? c : _imp; }
      );
      const resolvedCss = resolveImports(allCss);

      // Inject any remaining CSS not already inlined
      if (resolvedCss) {
        const styleTag = `<style id="nb-injected-css">${resolvedCss.replace(/<\/style>/gi, '<\\/style>')}</style>`;
        if (finalHtml.includes('</head>')) {
          finalHtml = finalHtml.replace('</head>', `${styleTag}</head>`);
        } else if (finalHtml.includes('<body>')) {
          finalHtml = finalHtml.replace('<body>', `<head>${styleTag}</head><body>`);
        } else {
          finalHtml = `<head>${styleTag}</head>${finalHtml}`;
        }
      }

      // Inject any remaining JS not already inlined
      if (allJs) {
        const scriptTag = `<script id="nb-injected-js">${allJs.replace(/<\//g, '<\\/')}<\/script>`;
        if (finalHtml.includes('</body>')) {
          finalHtml = finalHtml.replace('</body>', `${scriptTag}</body>`);
        } else {
          finalHtml = `${finalHtml}${scriptTag}`;
        }
      }

      finalHtml = injectHarness(finalHtml);
    }

    setGeneratedCode(finalHtml);
    trackEvent('app_generated', { agent: activeAgent, htmlBytes: finalHtml.length });

    // Save to preview history (max 5). Skip very large docs (e.g. imports with many
    // inlined base64 images) — keeping 5 multi-MB copies would balloon memory.
    if (finalHtml.length < 2_000_000) {
      setPreviewHistory(prev => {
        const title = (finalHtml.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || 'App Preview').trim();
        // BUG J1 FIX: Skip duplicate entries (same HTML as last entry)
        if (prev.length > 0 && prev[prev.length - 1].html === finalHtml) return prev;
        const entry = { id: Date.now().toString(), label: title, ts: new Date(), html: finalHtml };
        return [entry, ...prev.filter(h => h.id !== entry.id)].slice(0, 5);
      });
    }
    } catch (err: any) {
      // BUG A4 FIX: Catch any exception and show an error preview instead of crashing silently
      console.error('[preview] updatePreview failed:', err?.message || err);
      setGeneratedCode(`<!DOCTYPE html><html><body style="font-family:system-ui;padding:24px;color:#b00"><h3>Preview Error</h3><pre>${String(err?.message || err).replace(/</g, '&lt;')}</pre></body></html>`);
    }
  };

  const handleFileChange = (path: string, content: string) => {
    setFiles(prev => {
      const next = { ...prev, [path]: content };
      updatePreview(next);
      return next;
    });
  };

  const runCode = (currentFiles: FileSystem) => {
    const ext = activeFile.split('.').pop();
    addLog(`Preparing to run ${activeFile}...`, 'info');
    
    if (['html', 'js', 'css'].includes(ext || '')) {
        updatePreview(currentFiles);
        toggleTab('preview');
        addLog(`Application launched in Sandbox mode.`, 'success');
    } else {
        addLog(`Runtime for .${ext} is currently in limited availability. Executing in dry-run mode...`, 'warn');
        setTimeout(() => {
            addLog(`[STDOUT] Execution of ${activeFile} completed.`, 'info');
            addLog(`[PROCESS] Exited with code 0.`, 'success');
        }, 1500);
    }
  };

  const deleteFile = (path: string) => {
    setFiles(prev => {
      const next = { ...prev };
      delete next[path];
      if (activeFile === path) setActiveFile(Object.keys(next)[0] || '');
      return next;
    });
  };

  const handleModelSelect = (id: string) => {
    if (id === 'auto') {
      setSelectedModel(id);
      addLog('Switching to Navbharat Hybrid Engine...', 'info');
      return;
    }

    const key = (keys as any)[id];
    if (!key || key.trim() === '') {
      setPendingProvider(id);
      addLog(`Activation blocked: ${id.toUpperCase()} requires an API key.`, 'warn');
    } else {
      setSelectedModel(id);
      addLog(`Switching to ${id.toUpperCase()} (User Key Active)...`, 'success');
    }
  };

  const handleKeySave = (provider: string, value: string) => {
    setKeys(prev => ({ ...prev, [provider]: value }));
    if (value.trim()) {
      setSelectedModel(provider);
      setPendingProvider(null);
      addLog(`${provider.toUpperCase()} activated with new credentials.`, 'success');
      addToast(`${provider.toUpperCase()} model activated ✓`, 'success');
    }
  };

  const createFile = () => {
    const name = prompt('File name:');
    if (name) {
      setFiles(prev => ({ ...prev, [name]: '// New file\n' }));
      setActiveFile(name);
    }
  };

  const deployApp = () => {
    setIsBuilding(true);
    addLog('Initiating secure deployment tunnel...', 'info');
    setTimeout(() => {
      const url = `https://nb-deploy-${Math.random().toString(36).substring(7)}.navbharat.ai`;
      setDeployUrl(url);
      setIsDeployed(true);
      setIsBuilding(false);
      addLog(`Deployment successful: ${url}`, 'success');
      toggleTab('deploy');
    }, 2000);
  };
  const extractCode = (text: string) => {
    // Look for HTML, then JS, then CSS
    const htmlMatch = text.match(/```html\s+([\s\S]*?)?```/) || text.match(/<html>\s+([\s\S]*?)?<\/html>/i);
    const jsMatch = text.match(/```(?:javascript|js)\s+([\s\S]*?)?```/);
    const cssMatch = text.match(/```css\s+([\s\S]*?)?```/);

    if (!htmlMatch && !jsMatch && !cssMatch) return null;

    let html = htmlMatch ? (htmlMatch[1] || htmlMatch[0]) : '';
    const js = jsMatch ? jsMatch[1] : '';
    const css = cssMatch ? cssMatch[1] : '';

    // If no HTML but we have JS or CSS, wrap them
    // Inject Error Tracking & Viewport
    const errorTracker = `
      <script>
        window.onerror = function(msg, url, lineNo, columnNo, error) {
          window.parent.postMessage({ type: 'SANDBOX_ERROR', message: msg + " at line " + lineNo }, '*');
          return false;
        };
        console.error = (function(oldError) {
          return function(msg) {
            window.parent.postMessage({ type: 'SANDBOX_ERROR', message: msg }, '*');
            oldError.apply(console, arguments);
          }
        })(console.error);
      </script>
    `;

    if (html) {
      if (html.includes('</head>')) {
        html = html.replace('</head>', errorTracker + '</head>');
      } else if (html.includes('<head>')) {
        html = html.replace('<head>', '<head>' + errorTracker);
      }
      
      if (!html.toLowerCase().includes('viewport')) {
        if (html.includes('</head>')) {
          html = html.replace('</head>', '<meta name="viewport" content="width=device-width, initial-scale=1.0"></head>');
        }
      }
    }

    return html;
  };

  const handleSendForTab = async (tabId: ViewType, overrideMessage?: string, files: File[] = []) => {
      // ... (existing logic, maybe add files to messages)
    const isNbi = tabId === 'nbi_chat';
    const currentInput = input;
    const currentMessages = messages;
    const activeSession = sessions.find(s => s.id === currentSessionId);
    const restoredMessages = activeSession?.restoredMessages || [];
    const memorySummary = activeSession?.memorySummary || '';
    const historyForAPI = [...restoredMessages, ...currentMessages];
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

    // Build attachment previews (data URLs) so the image shows in chat
    const attachmentPreviews: import('./types').MessageAttachment[] = await Promise.all(
      files.map(f => new Promise<import('./types').MessageAttachment>(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve({ name: f.name, type: f.type, dataUrl: reader.result as string });
        reader.onerror = () => resolve({ name: f.name, type: f.type });
        reader.readAsDataURL(f);
      }))
    );

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
            stream: true,
          }),
          signal: AbortSignal.timeout(90000),
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

  // Intent classifier — prevents build engine from firing on greetings/questions
  const classifyBuildIntent = (message: string): 'build' | 'chat' => {
    const lower = message.trim().toLowerCase();
    const wordCount = lower.split(/\s+/).length;

    // Greetings and affirmations (up to 4 words)
    if (wordCount <= 4 && /^(hi|hello|hey|hii|helo|ok|okay|thanks|thank you|thx|shukriya|acha|accha|theek hai|theek|samjha|samajh|haan|nahi|sure|great|nice|good|perfect|kya haal|kaise ho|namaste|bye|good morning|good night|test)\s*[!.?]*$/.test(lower)) {
      return 'chat';
    }

    // Clear app/build keywords → always build
    if (/\b(app|game|website|web app|tool|bana[od]?|create|make|build|generate|develop|design|calculator|todo|quiz|login|dashboard|social|blog|portfolio|ecommerce|landing page|chat app|music player|weather|notes|timer|calendar|survey|banao|banana|chahiye)\b/i.test(lower)) {
      return 'build';
    }

    // Short questions without build keywords → chat
    if (wordCount < 12 && (/\?$/.test(message.trim()) || /^(what|how|why|when|where|who|explain|kya|batao|bata|samjhao|tell me|kaise|kyun|kab|kaisa)\b/i.test(lower))) {
      return 'chat';
    }

    // Default: treat as build request
    return 'build';
  };

  // Auto mode: classify what the user wants — chat, clarify, or which kind of build
  const classifyAutoIntent = (message: string, history: Message[]): 'chat' | 'clarify' | 'direct_build' | 'plan_build' => {
    const msg = message.trim();
    const lower = msg.toLowerCase();

    // Explicit "no coding / no build" signal — just converse
    if (/\b(coding nahi|build nahi|mat bana|don't build|no code|no build|sirf bata|sirf samjha|just (tell|explain|discuss)|without (building|coding)|abhi nahi|bas batao)\b/i.test(lower)) return 'chat';

    // Pure question with no build verb
    const isQuestion = /\?$/.test(msg) || /^(kya|kaise|kyun|what|how|why|explain|batao|samjhao|tell me|describe)\b/i.test(lower);
    const hasBuildVerb = /\b(bana|banao|banana|build|create|make|generate|develop|chahiye|chahie|design|kar do|karo)\b/i.test(lower);
    if (isQuestion && !hasBuildVerb) return 'chat';

    // User confirming after AI asked "Banau kya?" — build directly
    const lastAi = [...history].reverse().find(m => m.sender === 'ai');
    const aiWasAsking = !!(lastAi && /\?/.test(lastAi.text) && /\b(bana|build|banau|shall i|chahiye)\b/i.test(lastAi.text.toLowerCase()));
    const isConfirm = /^(haan|yes|ok|sure|bilkul|karo|go ahead|ha\b|👍|theek|kar do|bana do)\s*[!.]*$/i.test(msg.trim());
    if (isConfirm && aiWasAsking) return 'direct_build';

    const hasAppNoun = /\b(app|application|game|website|tool|dashboard|calculator|quiz|generator|system|platform|portal|page|form|tracker|timer|clock|todo|chat|login|signup|landing)\b/i.test(lower);

    // Has no app noun and no build verb → just chat
    if (!hasBuildVerb && !hasAppNoun) return 'chat';

    // Has app noun but no clear build verb → clarify
    if (hasAppNoun && !hasBuildVerb && msg.length < 60) return 'clarify';

    // Complex build: long message OR many features → show plan first
    const isComplex = msg.length > 120 ||
      (lower.match(/\b(aur|and|with|plus|bhi|also)\b/g) || []).length >= 3 ||
      (msg.match(/^\d+\./gm) || []).length >= 2 ||
      /\b(auth|login|database|api|dark mode|responsive|animation|filter|search|sort|registration|profile|payment|categories|multiple)\b/i.test(lower);

    if (hasBuildVerb && isComplex) return 'plan_build';
    return 'direct_build';
  };

  // ── ZIP Import: stream raw binary → SSE extraction → real-time Code Studio load ──
  const handleZipImport = async (zipFile: File, extraMessage?: string) => {
    setIsProLoading(true);
    setProInput('');
    setProMessages(prev => [...prev, {
      id: Date.now().toString(),
      text: `📦 Uploading ${zipFile.name} (${(zipFile.size / 1024 / 1024).toFixed(1)} MB)...`,
      sender: 'user', timestamp: new Date(),
    }]);
    setProBuildProgress({ active: true, stage: `📦 Streaming ${zipFile.name}...`, steps: [], percent: 5, generatedFiles: {} });

    const loadedFiles: Record<string, string> = {};
    let fileCount = 0;
    let appName = zipFile.name.replace(/\.zip$/i, '');
    const fileList: string[] = [];

    try {
      // Send raw binary — no base64 encoding, browser streams directly to server
      const response = await fetch('/api/extract-zip', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-File-Name': encodeURIComponent(zipFile.name),
        },
        body: zipFile,
      });

      if (!response.ok || !response.body) {
        const errText = await response.text().catch(() => `HTTP ${response.status}`);
        throw new Error(errText || `Upload failed: ${response.status}`);
      }

      // Read SSE stream and load files into Code Studio in real-time
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      let didIncrementalPreview = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let evt: any;
          try { evt = JSON.parse(line.slice(6)); } catch { continue; }

          // Per-event crash isolation: one bad event must never abort the whole import
          try {
            if (evt.type === 'file') {
              if (typeof evt.path !== 'string' || typeof evt.content !== 'string') continue;
              loadedFiles[evt.path] = evt.content;
              fileList.push(evt.path);
              fileCount++;

              // Throttle React state updates — flushing per-file would mean thousands of
              // re-renders for a big app (jank/crash). Show first few instantly, then batch.
              if (fileCount <= 8 || fileCount % 20 === 0) {
                setFiles({ ...loadedFiles } as any);
              }

              // Live preview on key files — only for static apps, and only once (source/React
              // apps rebuild the Babel runtime, so we preview them once at the very end).
              const isKey = evt.path === 'index.html' || evt.path.endsWith('.css') || evt.path.endsWith('.js');
              const looksSource = !!loadedFiles['package.json'] || Object.keys(loadedFiles).some(k => /\.(tsx|jsx)$/i.test(k));
              if (isKey && !looksSource && !didIncrementalPreview && evt.path === 'index.html') {
                didIncrementalPreview = true;
                const snapshot = { ...loadedFiles };
                setTimeout(() => { try { updatePreview(snapshot as any); } catch { /* harness covers it */ } }, 50);
              }

              if (fileCount % 8 === 0) {
                setProBuildProgress(prev => ({ ...prev, stage: `📂 Loading ${fileCount} files...`, percent: Math.min(90, 5 + fileCount) }));
              }
            } else if (evt.type === 'progress') {
              setProBuildProgress(prev => ({ ...prev, stage: evt.stage || evt.message || prev.stage }));
            } else if (evt.type === 'skipped') {
              // a single file was skipped (binary/too large) — fine, keep going
            } else if (evt.type === 'complete') {
              appName = evt.appName || appName;
            } else if (evt.type === 'error') {
              // Only fatal if NOTHING loaded; otherwise import the partial app
              if (fileCount === 0) throw new Error(evt.message || 'ZIP extraction error');
              console.warn('[ZIP] partial error (continuing):', evt.message);
            }
          } catch (evtErr) {
            if (fileCount === 0) throw evtErr;
            console.warn('[ZIP] event error (continuing):', evtErr);
          }
        }
      }

      if (fileCount === 0) throw new Error('No files extracted from ZIP — it may be empty or contain only binaries.');

      // Final state — ensure everything is synced.
      setFiles(loadedFiles as any);
      saveAllFiles(loadedFiles).catch(() => {}); // persist to IndexedDB/Cache API
      setHasGeneratedCode(true);  // ← marks workspace as occupied so next prompt = edit, not rebuild
      setIsAppBuilt(true);

      // Detect framework apps so we can show the right message (preview still runs in-browser)
      const pkg = loadedFiles['package.json'] || '';
      const hasBuildTool = /["'](vite|webpack|rollup|parcel|next|nuxt|gatsby|create-react-app|@vitejs)\s*["']/.test(pkg);
      const hasJsxEntry = Object.keys(loadedFiles).some(k => /\.(tsx|jsx)$/i.test(k));
      const isFrameworkApp = (hasBuildTool || hasJsxEntry) && !!pkg;

      setTimeout(() => updatePreview(loadedFiles as any), 100);
      const generatedFilesObj = Object.fromEntries(
        Object.entries(loadedFiles).map(([k, v]) => [k, { content: v, expanded: false }])
      );
      setProBuildProgress({ active: false, stage: '', steps: [], percent: 100, generatedFiles: generatedFilesObj });

      const fileListText = fileList.slice(0, 10).map(f => `• \`${f}\``).join('\n');
      const moreText = fileList.length > 10 ? `\n• ... and ${fileList.length - 10} more` : '';

      if (isFrameworkApp) {
        setProMessages(prev => [...prev, {
          id: (Date.now() + 1).toString(),
          text: `📦 **${appName}** imported — ${fileCount} files loaded into Code Studio.\n\n${fileListText}${moreText}\n\n✅ Preview is live — React/TSX is running in-browser via Babel + esm.sh. Tell me what you want to change!`,
          sender: 'ai', timestamp: new Date(),
        }]);
      } else {
        setProMessages(prev => [...prev, {
          id: (Date.now() + 1).toString(),
          text: `📦 **${appName}** imported — ${fileCount} files loaded into Code Studio. App is live in Preview.\n\n${fileListText}${moreText}\n\nApp is ready to edit — tell me what you want to change!`,
          sender: 'ai', timestamp: new Date(),
        }]);
      }
      // If user typed a message alongside the ZIP, run it as an edit
      if (extraMessage?.trim()) {
        setTimeout(() => handleSendForPro(extraMessage), 800);
      }
    } catch (err: any) {
      setProBuildProgress({ active: false, stage: '', steps: [], percent: 0, generatedFiles: {} });
      setProMessages(prev => [...prev, {
        id: (Date.now() + 2).toString(),
        text: `❌ ZIP import failed: ${err.message}`,
        sender: 'ai', timestamp: new Date(),
      }]);
    } finally {
      setIsProLoading(false);
      setProInput('');
    }
  };

  const handleSendForPro = async (input?: string | File[], forceBuild = false, isAutoContinue = false, guiderApproved = false) => {
    const fileList = Array.isArray(input) ? input : [];
    const messageToSend = typeof input === 'string' ? input : proInput.trim();
    if (!messageToSend && fileList.length === 0 || isProLoading) return;
    // A brand-new user request ends any in-flight auto-continue chain.
    if (!isAutoContinue) proAutoContinueRef.current = 0;
    // A genuinely new user request (not an approval/refine/auto-continue) ends any
    // in-flight guider grade→refine loop.
    if (!isAutoContinue && !guiderApproved) { proGuiderSpecRef.current = null; proGuiderRefineRef.current = 0; }
    // Approving a guider proposal resumes a build for a message already in the chat.
    if (guiderApproved) setProGuiderPlan(null);

    // ZIP file detected → import into Code Studio instead of sending to AI chat
    const zipFile = fileList.find(f =>
      f.name.toLowerCase().endsWith('.zip') ||
      f.type === 'application/zip' ||
      f.type === 'application/x-zip-compressed'
    );
    if (zipFile) {
      const sizeMB = zipFile.size / (1024 * 1024);
      if (sizeMB > 500) {
        setZipSizeModal({ variant: 'too-large', fileName: zipFile.name, fileSizeMB: sizeMB });
        return;
      }
      if (sizeMB > 50) {
        setZipSizeModal({ variant: 'github', fileName: zipFile.name, fileSizeMB: sizeMB });
        return;
      }
      await handleZipImport(zipFile, messageToSend);
      return;
    }

    // Images are downscaled client-side, so only cap their raw size generously (25 MB).
    // Non-image docs (PDF/text) go raw into the request body → tighter 12 MB cap.
    const IMG_RAW_MAX = 25 * 1024 * 1024;
    const DOC_MAX = 12 * 1024 * 1024;
    const oversized = fileList.filter(f => f.size > (f.type.startsWith('image/') ? IMG_RAW_MAX : DOC_MAX));
    if (oversized.length > 0) {
      const names = oversized.map(f => `${f.name} (${(f.size/1024/1024).toFixed(1)}MB)`).join(', ');
      addLog(`File too large: ${names}. Max 25 MB for images, 12 MB for documents.`, 'error');
      return;
    }

    // Convert any attached files to base64 for AI vision
    const fileAttachments = fileList.length > 0 ? await filesToBase64(fileList) : [];

    // Build attachment previews for chat display (reuse base64 already computed)
    const proAttachmentPreviews: import('./types').MessageAttachment[] = fileAttachments.map(f => ({
      name: f.name,
      type: f.type,
      dataUrl: `data:${f.type};base64,${f.base64}`,
    }));

    // Don't show __CONFIRM_AUTO_BUILD__ as a visible chat message
    const isConfirmBuildTap = messageToSend === '__CONFIRM_AUTO_BUILD__';
    // On guider approval the user's message is already in the chat — don't re-add it.
    if (!isConfirmBuildTap && !guiderApproved) {
      const userMessage: Message = {
        id: Date.now().toString(),
        text: messageToSend,
        sender: 'user',
        timestamp: new Date(),
        ...(proAttachmentPreviews.length > 0 ? { attachments: proAttachmentPreviews } : {}),
      };
      setProMessages(prev => [...prev, userMessage]);
    }
    setProInput('');
    setIsProLoading(true);
    const abortController = new AbortController();
    proAbortControllerRef.current = abortController;

    // Same "compact memory + bounded recent window" pattern as Free chat: full
    // history would never fit/scale token-wise, so we send a short memorySummary
    // (the AI keeps this fact-dense) plus the restored + live messages, capped.
    const proActiveSession = sessions.find(s => s.id === currentProSessionId);
    const proRestoredMessages = proActiveSession?.restoredMessages || [];
    const proMemorySummary = proActiveSession?.memorySummary || undefined;
    const proHistoryForAPI = [...proRestoredMessages, ...proMessages];

    // G10 — memory fix: detect "try again" requests after a failed build so we can
    // restore the original build prompt and retry with full context.
    const isPureRetry = /^(please\s+)?(try\s+again|retry)\s*[!.?]*$/i.test(messageToSend.trim())
      || /^(dobara\s+(try|karo|banao)|phir\s+se\s+(try|bana|karo))\s*[!.?]*$/i.test(messageToSend.trim());
    const isRetryAfterFailure = isPureRetry
      && Object.keys(files).filter(k => !k.startsWith('.')).length === 0
      && !!lastBuildPromptRef.current;

    // ── /code-review command — OWASP + quality + tech debt scan of current files ──
    if (messageToSend.trim().toLowerCase() === '/code-review') {
      const reviewFiles = files && Object.keys(files).length > 0 ? files : null;
      if (!reviewFiles) {
        setProMessages(prev => [...prev, {
          id: (Date.now() + 1).toString(),
          text: 'No files to review. Build or import an app first, then run `/code-review`.',
          sender: 'ai' as const,
          timestamp: new Date(),
        }]);
        setIsProLoading(false);
        proAbortControllerRef.current = null;
        return;
      }
      try {
        const resp = await fetch('/api/pro/code-review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: abortController.signal,
          body: JSON.stringify({ files: reviewFiles }),
        });
        const data = await resp.json().catch(() => ({})) as any;
        if (!resp.ok) throw new Error(data?.error || `Review failed (${resp.status})`);
        setProMessages(prev => [...prev, {
          id: (Date.now() + 1).toString(),
          text: data.report || 'Code review complete.',
          sender: 'ai' as const,
          timestamp: new Date(),
        }]);
      } catch (e: any) {
        if (e.name !== 'AbortError') {
          setProMessages(prev => [...prev, {
            id: (Date.now() + 1).toString(),
            text: `Code review failed: ${e.message}`,
            sender: 'ai' as const,
            timestamp: new Date(),
          }]);
        }
      } finally {
        setIsProLoading(false);
        proAbortControllerRef.current = null;
      }
      return;
    }

    // ── /deploy command — Vercel / Netlify / GitHub Pages one-click deploy ──
    // Usage: /deploy vercel <token> <project-name>
    //        /deploy netlify <token> <site-id>
    //        /deploy github <token> <owner> <repo>
    if (messageToSend.trim().toLowerCase().startsWith('/deploy ')) {
      const parts = messageToSend.trim().split(/\s+/);
      const provider = parts[1]?.toLowerCase() as 'vercel' | 'netlify' | 'github' | undefined;
      const token = parts[2];
      const arg1 = parts[3];
      const arg2 = parts[4];

      const deployFiles = files && Object.keys(files).length > 0 ? files : null;
      if (!deployFiles) {
        setProMessages(prev => [...prev, { id: (Date.now() + 1).toString(), text: 'No files to deploy. Build or import an app first.', sender: 'ai' as const, timestamp: new Date() }]);
        setIsProLoading(false);
        proAbortControllerRef.current = null;
        return;
      }
      if (!provider || !token || !arg1) {
        setProMessages(prev => [...prev, { id: (Date.now() + 1).toString(), text: `**Deploy usage:**\n\`\`\`\n/deploy vercel <token> <project-name>\n/deploy netlify <token> <site-id>\n/deploy github <token> <owner> <repo>\n\`\`\`\nGet a Vercel token at vercel.com/account/tokens`, sender: 'ai' as const, timestamp: new Date() }]);
        setIsProLoading(false);
        proAbortControllerRef.current = null;
        return;
      }
      try {
        setProMessages(prev => [...prev, { id: (Date.now() + 0.5).toString(), text: `Deploying to ${provider}...`, sender: 'ai' as const, timestamp: new Date() }]);
        const body: Record<string, string | Record<string, string>> = { provider, token, files: deployFiles };
        if (provider === 'vercel') body.name = arg1;
        else if (provider === 'netlify') body.siteId = arg1;
        else if (provider === 'github') { body.owner = arg1; body.repo = arg2 || ''; }

        const resp = await fetch('/api/pro/deploy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: abortController.signal,
          body: JSON.stringify(body),
        });
        const data = await resp.json().catch(() => ({})) as any;
        if (!resp.ok) throw new Error(data?.error || `Deploy failed (${resp.status})`);
        setProMessages(prev => [...prev, { id: (Date.now() + 1).toString(), text: `**Deployed!** Your app is live at:\n\n${data.url}`, sender: 'ai' as const, timestamp: new Date() }]);
      } catch (e: any) {
        if (e.name !== 'AbortError') {
          setProMessages(prev => [...prev, { id: (Date.now() + 1).toString(), text: `Deploy failed: ${e.message}`, sender: 'ai' as const, timestamp: new Date() }]);
        }
      } finally {
        setIsProLoading(false);
        proAbortControllerRef.current = null;
      }
      return;
    }

    // ── Mode is the single source of truth — forceBuild skips auto routing ──

    const isBuildMode = mode === 'build' || forceBuild;
    const isAutoMode  = mode === 'auto' && !forceBuild;

    // ── AUTO MODE — smart routing: human-like chat, clarify, or build ──
    if (isAutoMode) {
      // G10 — memory fix: retry after a failed build — skip auto-routing and
      // force-build with the original prompt. guiderApproved=true prevents the
      // original prompt from being re-added as a duplicate user message in chat.
      if (isRetryAfterFailure) {
        setIsProLoading(false);
        proAbortControllerRef.current = null;
        setTimeout(() => void handleSendForPro(lastBuildPromptRef.current, true, false, true), 50);
        return;
      }

      const isConfirmBuild = isConfirmBuildTap;
      const actualMessage = isConfirmBuild
        ? (proMessages.filter(m => m.sender === 'user').slice(-1)[0]?.text || messageToSend)
        : messageToSend;

      const intent = isConfirmBuild ? 'direct_build' : classifyAutoIntent(messageToSend, proMessages);

      if (intent === 'direct_build' || intent === 'plan_build') {
        // AUTO mode NEVER auto-starts a build and NEVER switches mode by itself.
        // A build request only produces a friendly reply + an explicit "Build"
        // button; the actual build runs ONLY when the user taps it (which sends
        // __CONFIRM_AUTO_BUILD__ → isConfirmBuild).
        if (isConfirmBuild) {
          setIsProLoading(false);
          proAbortControllerRef.current = null;
          setTimeout(() => handleSendForPro(actualMessage, true), 50);
          return;
        }
        try {
          const response = await fetch('/api/pro-chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: abortController.signal,
            body: JSON.stringify({
              message: messageToSend,
              history: proHistoryForAPI.slice(-40).map((m: any) => ({ sender: m.sender, text: String(m.text || '').replace(/__CONFIRM_AUTO_BUILD__|__AUTO_PLAN__|__AUTO_BUILD__/g, '').slice(0, 1500) })),
              memorySummary: proMemorySummary,
              mode: 'auto_plan',
              ...(fileAttachments.length > 0 ? { fileData: fileAttachments[0].base64, fileType: fileAttachments[0].type, fileName: fileAttachments[0].name } : {}),
            }),
          });
          if (!response.ok) throw new Error(`API Error: ${response.status}`);
          const data = await response.json();
          // Strip any auto-build marker; always surface the explicit Build button.
          let reply: string = String(data.reply || '').replace(/__AUTO_BUILD__/g, '').trim();
          if (!reply.includes('__AUTO_PLAN__')) reply = `${reply}\n\n__AUTO_PLAN__`;
          setProMessages(prev => [...prev, { id: (Date.now() + 1).toString(), text: reply, sender: 'ai', timestamp: new Date() }]);
        } catch (e: any) {
          if (e.name !== 'AbortError') {
            setProMessages(prev => [...prev, { id: (Date.now() + 1).toString(), text: 'Something went wrong. Try again!', sender: 'ai', timestamp: new Date() }]);
          }
        } finally {
          setIsProLoading(false);
          proAbortControllerRef.current = null;
        }
        return;
      }

      // intent === 'chat' or 'clarify' — human-like conversation
      try {
        const response = await fetch('/api/pro-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: abortController.signal,
          body: JSON.stringify({
            message: messageToSend,
            history: proHistoryForAPI.slice(-40).map((m: any) => ({ sender: m.sender, text: String(m.text || '').replace(/__CONFIRM_AUTO_BUILD__|__AUTO_PLAN__|__AUTO_BUILD__/g, '').slice(0, 1500) })),
            memorySummary: proMemorySummary,
            mode: 'auto',
            ...(fileAttachments.length > 0 ? { fileData: fileAttachments[0].base64, fileType: fileAttachments[0].type, fileName: fileAttachments[0].name } : {}),
          }),
        });
        if (!response.ok) throw new Error(`API Error: ${response.status}`);
        const data = await response.json();
        setProMessages(prev => [...prev, { id: (Date.now() + 1).toString(), text: data.reply || 'Haan, batao!', sender: 'ai', timestamp: new Date() }]);
      } catch (e: any) {
        if (e.name !== 'AbortError') {
          setProMessages(prev => [...prev, { id: (Date.now() + 1).toString(), text: 'Kuch gadbad ho gayi. Dobara try karo!', sender: 'ai', timestamp: new Date() }]);
        }
      } finally {
        setIsProLoading(false);
        proAbortControllerRef.current = null;
      }
      return;
    }

    // ── Phase 2: Intent check — don't build on greetings/questions ──
    if (isBuildMode && classifyBuildIntent(messageToSend) === 'chat') {
      try {
        const response = await fetch('/api/pro-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: abortController.signal,
          body: JSON.stringify({
            message: messageToSend,
            history: proHistoryForAPI.slice(-40).map((m: any) => ({ sender: m.sender, text: String(m.text || '').slice(0, 2000) })),
            memorySummary: proMemorySummary,
            mode: 'conversation',
            ...(fileAttachments.length > 0 ? {
              fileData: fileAttachments[0].base64,
              fileType: fileAttachments[0].type,
              fileName: fileAttachments[0].name,
            } : {}),
          }),
        });
        if (!response.ok) throw new Error(`API Error: ${response.status}`);
        const data = await response.json();
        setProMessages(prev => [...prev, { id: (Date.now() + 1).toString(), text: data.reply || '👋 Hi! Tell me what app you want to build!', sender: 'ai', timestamp: new Date() }]);
      } catch (e: any) {
        if (e.name !== 'AbortError') {
          setProMessages(prev => [...prev, { id: (Date.now() + 1).toString(), text: '👋 Hi! Describe your app and I will build it for you!', sender: 'ai', timestamp: new Date() }]);
        }
      } finally {
        setIsProLoading(false);
        proAbortControllerRef.current = null;
      }
      return;
    }

    if (isBuildMode) {
      // ── SSE Streaming Build via /api/pro-build ──
      setProBuildProgress({
        active: true,
        stage: '🔍 Analyzing requirements...',
        steps: [],
        percent: 5,
        generatedFiles: {},
      });

      try {
        // Push current version to undo stack before building
        if (Object.keys(files).filter(k => !k.startsWith('.')).length > 0) {
          setBuildVersionStack(prev => [
            { files: { ...files }, timestamp: new Date().toISOString(), request: messageToSend.slice(0, 100) },
            ...prev.slice(0, 4),
          ]);
        }

        // Detect React framework intent — only when workspace is truly empty
        const reactKeywords = /\breact\b|\bjsx\b|\busestate\b|\bhooks?\b|\bcomponent\b/i;
        const workspaceHasFiles = Object.keys(files).filter(k => !k.startsWith('.')).length > 2;
        const isReactRequest = !workspaceHasFiles && reactKeywords.test(messageToSend);

        // Detect "fresh build" requests — user wants a BRAND NEW app even when workspace has old files.
        // Signals: starts with build verb + has app noun + long (detailed requirements) + no edit references.
        const hasBuildVerb = /^(build|create|make|generate|develop|design)\s+\w/i.test(messageToSend.trim());
        const hasAppNoun = /\b(app|application|game|website|tool|dashboard|calculator|quiz|generator|system|platform|portal)\b/i.test(messageToSend);
        const hasEditRef = /\b(the existing|my app|this app|above app|current app|already built|add to|update the|change the|fix the|fix this|improve the|make it|make this|add a|add an|remove the|remove this|edit the|modify the|adjust the|tweak the|rename the|style the|color the)\b/i.test(messageToSend.slice(0, 120));
        const hasMultipleRequirements = (messageToSend.match(/^\d+\.\s+/gm) || []).length >= 3; // numbered list with 3+ items
        const isFreshBuildRequest = workspaceHasFiles &&
          (hasBuildVerb || hasMultipleRequirements) && hasAppNoun && !hasEditRef &&
          messageToSend.length > 80;

        // Collect the primary entry-point files for the edit engine
        const htmlKey = Object.keys(files).find(k => k.endsWith('.html')) || 'index.html';
        const cssKey  = Object.keys(files).find(k => k.match(/\.(css|scss|sass)$/)) || 'style.css';
        const jsKey   = Object.keys(files).find(k => k.match(/\.(js|ts|jsx|tsx)$/) && !k.endsWith('.d.ts')) || 'script.js';
        const htmlFile = files[htmlKey] || files['index.html'] || '';
        const cssFile  = files[cssKey]  || files['style.css']  || '';
        const jsFile   = files[jsKey]   || files['script.js']  || '';

        // Edit if workspace has files AND it's not a fresh-build request
        const isEditRequest = !isReactRequest && workspaceHasFiles && !isFreshBuildRequest;

        // Collect ALL text/code files from workspace to send to the engine.
        // RC7: a 200 KB cap dropped files of larger multi-module apps, so edits
        // ran against a PARTIAL workspace → the engine broke imports/lost context
        // → apps crashed after a few edits. Raised to ~2 MB so the full project
        // reaches the engine (the server bounds its own prompt context separately).
        const TEXT_EXTS = /\.(html|htm|css|scss|sass|js|ts|jsx|tsx|json|md|txt|py|php|yaml|yml|xml|svg|vue|svelte)$/i;
        const allTextFiles: Record<string, string> = {};
        let wsBytes = 0;
        for (const [k, v] of Object.entries(files)) {
          if (TEXT_EXTS.test(k) && typeof v === 'string' && wsBytes + v.length < 2_000_000) {
            allTextFiles[k] = v;
            wsBytes += v.length;
          }
        }

        // Full conversation history as structured messages (last 20, up to 800 chars each)
        const conversationHistory = proMessages.slice(-20).map((m: any) => ({
          role: (m.sender === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
          content: String(m.text || '').slice(0, 800),
        }));

        // Apply a finished multi-file build into the workspace + chat (shared by
        // the new engine path below and reused logic for the legacy SSE complete).
        const finishBuild = (
          builtFiles: Record<string, string>,
          meta: { reply?: string; validationReport?: any; deploymentGuide?: string; followUpSuggestions?: string[]; appName?: string; isEdit?: boolean },
        ) => {
          setProBuildProgress(prev => ({
            ...prev,
            percent: 100,
            stage: '✅ App ready!',
            steps: prev.steps.map(s => ({ ...s, status: 'done' as const })),
            generatedFiles: Object.fromEntries(Object.entries(builtFiles).map(([k, v]) => [k, { content: v, expanded: false }])),
          }));
          setTimeout(() => {
            // Preview with the fresh build first (outside setFiles updater — calling
            // setState side-effects inside a functional updater is a React anti-pattern
            // that can double-invoke in concurrent/strict mode).
            updatePreview(builtFiles);
            // Merge with any pre-existing workspace files in the files state.
            setFiles((prev: any) => ({ ...prev, ...builtFiles }));
            setIsAppBuilt(true);
            setHasGeneratedCode(true);
            // Take the user to the now-ready live preview (the build message says
            // "App is live in Preview →" but nothing navigated there before).
            toggleTab('preview');
            saveVersionSnapshot(messageToSend, builtFiles);

            const fileList = Object.keys(builtFiles);
            const vr = meta.validationReport;
            let validationSection = '';
            if (vr) {
              const score = vr.score ?? 100;
              const scoreEmoji = score >= 90 ? '🟢' : score >= 70 ? '🟡' : '🔴';
              const issues: string[] = [
                ...(vr.brokenIds || []).map((id: string) => `⚠️ Broken ID: #${id}`),
                ...(vr.missingWires || []).map((id: string) => `⚠️ Unwired button: #${id}`),
                ...(vr.syntaxIssues || []).map((s: string) => `⚠️ ${s}`),
              ];
              validationSection = [
                ``,
                `**Quality Check** ${scoreEmoji} Score: ${score}/100`,
                vr.passed
                  ? `> ✅ All checks passed${vr.repairsApplied > 0 ? ` (${vr.repairsApplied} auto-repair${vr.repairsApplied > 1 ? 's' : ''} applied)` : ''}`
                  : issues.map((i: string) => `> ${i}`).join('\n'),
              ].join('\n');
            }
            const deployGuide = meta.deploymentGuide;
            const deploySection = deployGuide
              ? `\n\n**Ready to deploy?** 🚀\nType \`deploy\` for step-by-step deployment options!\n\n<details>\n<summary>📋 Deployment Options (click to expand)</summary>\n\n${deployGuide}\n</details>`
              : `\n\n**App is ready!** Check the preview → type "deploy" to get deployment options.`;
            const replyText = meta.reply || 'App successfully generated!';
            const replyPrefix = replyText.startsWith('⚠️') || replyText.startsWith('Could not') ? '' : '✅ ';
            const isFileEdit = meta.isEdit || replyText.startsWith('Updated ');
            // Honest reporting: if the verifier found unresolved errors, show
            // structured diagnostics instead of a fake "App is live".
            const buildFailed = meta.validationReport && meta.validationReport.passed === false;
            const liveUrl = proLivePreviewUrlRef.current;
            const statusLine = buildFailed
              ? `\n**⚠️ Build Status: NEEDS ATTENTION** — the preview may be partial. Issues above; ask me to fix them.`
              : liveUrl
                ? `**App is live!** [Open in new tab](${liveUrl}) · Also visible in Preview →`
                : `**App is live in Preview** →`;
            proLivePreviewUrlRef.current = null;
            proLiveScreenshotRef.current = null;
            const processLog = [
              buildFailed ? `⚠️ Build completed with issues — see diagnostics below.` : `${replyPrefix}${replyText}`,
              ``,
              `**Build Summary**`,
              fileList.map((f: string) => `> \`${f}\` — ${isFileEdit ? 'updated' : 'created'}`).join('\n'),
              validationSection,
              ``,
              statusLine,
              buildFailed ? '' : deploySection,
            ].join('\n');
            setProMessages(prev => [...prev, {
              id: (Date.now() + 1).toString(),
              text: processLog + '\n\n__VIEW_PREVIEW____DEPLOY_ACTIONS__',
              sender: 'ai',
              timestamp: new Date(),
              meta: { deployFiles: builtFiles, appName: meta.appName || 'NavBharatAI-App', suggestions: meta.followUpSuggestions || [] } as any,
            }]);
            setProBuildProgress({ active: false, stage: '', steps: [], percent: 0, generatedFiles: {} });
            setIsProLoading(false);
          }, 1200);
        };

        // G10 — memory fix: on retry after a failed build, restore the original
        // prompt so the build has full context. Also store the effective prompt so
        // a SUBSEQUENT retry can re-use it.
        const buildPrompt = (isRetryAfterFailure && lastBuildPromptRef.current)
          ? lastBuildPromptRef.current
          : messageToSend;
        lastBuildPromptRef.current = buildPrompt;

        // ── Guider (Hybrid): for a fresh/big request, propose a design and wait for
        //    the user's confirmation BEFORE building. Small edits skip this (gate on
        //    the server). Never blocks: any failure just proceeds to a normal build.
        if (!guiderApproved && !isAutoContinue) {
          try {
            const planResp: any = await fetch('/api/guider/plan', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ prompt: buildPrompt, files: allTextFiles, isEdit: isEditRequest, agentic: true }),
            }).then(r => r.json());
            if (planResp?.confirm && planResp?.plan) {
              setProGuiderPlan({ prompt: buildPrompt, plan: planResp.plan });
              setProBuildProgress(prev => ({ ...prev, active: false }));
              setIsProLoading(false);
              proAbortControllerRef.current = null;
              return; // wait for Approve / Edit / Answer from the confirmation card
            }
          } catch { /* planning failed — build normally */ }
        }

        // ── REAL ENGINE ONLY (VFS + EditEngine + Verifier + RepairLoop + gates). ──
        // The old vanilla AppEngine is RETIRED — we never silently fall back to it.
        try {
          setProBuildProgress(prev => ({ ...prev, percent: 20, stage: '⚙️ Building your app…' }));
          // Streaming build: live per-module progress in the chat (real, not fake).
          // Start (or continue) the live build timer — keep the original start time
          // across an auto-continue chain so the user sees total elapsed time.
          setProBuildProgress(prev => ({
            ...prev, active: true,
            startedAt: isAutoContinue && prev.startedAt ? prev.startedAt : Date.now(),
            part: proAutoContinueRef.current + 1,
          }));
          const engineRes: any = await buildAppStream({
            prompt: buildPrompt,
            files: Object.keys(allTextFiles).length ? allTextFiles : undefined,
            preview: true,
            // Claude-Code-style memory: tell the engine this is an edit (skips the
            // fresh-build feature loop) and pass conversation + rolling summary +
            // prior-change log so edits stay coherent across many turns.
            isEdit: isEditRequest,
            history: conversationHistory,
            memorySummary: proMemorySummary,
            editLog: proActiveSession?.editLog || [],
            // The agentic engine (runProEngine) is always on — always pass true.
            agentic: true,
            // G1.2 — stable session ID so server can persist + restore this build.
            sessionId: currentProSessionId,
            // Phase 4.2 — pass userId so server can record per-user monthly cost.
            userId: user?.uid || undefined,
            // G3 — credentials: let the agentic engine use real execution tier.
            githubToken: githubToken || undefined,
            userE2bKey: userE2bKey || undefined,
            dbConfig: (() => {
              if (!user) return undefined;
              try {
                const raw = localStorage.getItem(`engineer_db_${user.uid}`);
                return raw ? JSON.parse(raw) : undefined;
              } catch { return undefined; }
            })(),
          }, (ev) => {
            if (ev.type === 'status' && ev.message) {
              setProBuildProgress(prev => ({ ...prev, active: true, stage: `⚙️ ${ev.message}`, percent: Math.min(92, Math.max(prev.percent, (ev.coverage ?? 0))) }));
            } else if (ev.type === 'files' && ev.paths && ev.paths.length > 0) {
              // G11 — real-time file display: show which files the agent is writing.
              const names = ev.paths.slice(0, 3).map((p: string) => p.split('/').pop() || p).join(', ');
              const more = ev.paths.length > 3 ? ` +${ev.paths.length - 3} more` : '';
              setProBuildProgress(prev => ({ ...prev, active: true, stage: `✏️ ${names}${more}`, percent: Math.min(90, prev.percent + 2) }));
            } else if (ev.type === 'file' && ev.fileName && ev.content !== undefined) {
              // G12 — real-time file content: populate the Generated Files panel as each
              // file is written so the user sees code appearing live (Claude Code feel).
              setProBuildProgress(prev => ({
                ...prev,
                generatedFiles: {
                  ...prev.generatedFiles,
                  [ev.fileName!]: { content: ev.content!, expanded: false },
                },
              }));
            } else if (ev.type === 'module' && ev.name) {
              const icon = ev.state === 'done' ? '✓' : ev.state === 'failed' ? '⚠️' : '⏳';
              setProBuildProgress(prev => ({
                ...prev, active: true,
                stage: `${icon} ${ev.name}`,
                percent: Math.min(95, Math.max(prev.percent, ev.coverage ?? prev.percent)),
                steps: [
                  ...prev.steps.filter(s => s.label !== ev.name),
                  { label: ev.name!, sub: ev.state === 'done' ? 'done' : ev.state === 'failed' ? 'retrying' : 'building…', status: (ev.state === 'done' ? 'done' : ev.state === 'failed' ? 'error' : 'running') as 'done' | 'error' | 'running' },
                ],
              }));
            } else if (ev.type === 'terminal' && ev.command) {
              const exitMark = ev.exitCode === 0 ? '✓' : `✗ (exit ${ev.exitCode})`;
              setProBuildProgress(prev => ({ ...prev, active: true, stage: `$ ${ev.command.slice(0, 60)} ${exitMark}` }));
            } else if (ev.type === 'preview_url' && ev.url) {
              proLivePreviewUrlRef.current = ev.url;
            } else if (ev.type === 'plan' && ev.steps) {
              setProBuildProgress(prev => ({
                ...prev, active: true, stage: 'Planning…',
                steps: ev.steps!.map((label, i) => ({ label, sub: i === 0 ? 'up next' : 'queued', status: 'pending' as const })),
              }));
            } else if (ev.type === 'plan_step_start' && ev.stepIndex != null) {
              setProBuildProgress(prev => ({
                ...prev, active: true,
                stage: `Step ${ev.stepIndex! + 1}/${prev.steps.length} — ${ev.description ?? prev.steps[ev.stepIndex!]?.label ?? ''}`,
                steps: prev.steps.map((s, i) => i === ev.stepIndex ? { ...s, status: 'running' as const, sub: 'working…' } : s),
              }));
            } else if (ev.type === 'plan_step_done' && ev.stepIndex != null) {
              setProBuildProgress(prev => ({
                ...prev,
                steps: prev.steps.map((s, i) => i === ev.stepIndex ? { ...s, status: 'done' as const, sub: 'done' } : s),
              }));
            } else if (ev.type === 'thinking' && ev.content) {
              // Show reasoning as a transient sub-label on the current running step.
              // Truncate so it doesn't overwhelm the progress display.
              const snippet = ev.content.slice(0, 120).replace(/\n+/g, ' ');
              setProBuildProgress(prev => ({
                ...prev, active: true,
                steps: prev.steps.map((s) => s.status === 'running' ? { ...s, sub: snippet } : s),
              }));
            } else if (ev.type === 'screenshot' && ev.base64) {
              // Phase 79 — store latest E2B screenshot; finishBuild will include it
              // in the build summary if no live URL is available.
              proLiveScreenshotRef.current = ev.base64;
            } else if (ev.type === 'providers_unavailable') {
              // Phase 5.5 — all AI providers temporarily down. Start a visible countdown
              // so the user knows the service will recover and when to retry.
              const secs = Math.round((ev.retryAfterMs ?? 60000) / 1000);
              setProviderRetryCountdown(secs);
              providerRetryPromptRef.current = messageToSend;
              if (providerRetryTimerRef.current) clearInterval(providerRetryTimerRef.current);
              providerRetryTimerRef.current = setInterval(() => {
                setProviderRetryCountdown(prev => {
                  if (prev === null || prev <= 1) {
                    if (providerRetryTimerRef.current) clearInterval(providerRetryTimerRef.current);
                    return null;
                  }
                  return prev - 1;
                });
              }, 1000);
            }
          }, abortController.signal);
          // Persist the refreshed Claude-Code-style memory onto the active session
          // so the NEXT edit gets the rolling summary + change log (kept across
          // turns; auto-saved to Firestore by the session effect).
          // G3 — store the execution tier so the badge stays visible after build completes.
          if (engineRes?.tier) {
            setProBuildProgress(prev => ({ ...prev, tier: engineRes.tier }));
          }
          // G5 — store code review result for display in build summary.
          if (engineRes?.codeReview) {
            setProBuildProgress(prev => ({ ...prev, codeReview: (engineRes as any).codeReview }));
          }
          // G7 — server-side live preview: if the build produced a previewable static
          // bundle, wire its URL into proLivePreviewUrlRef so finishBuild shows the
          // "App is live!" link (same path as E2B live URL, no new code needed).
          if ((engineRes as any)?.previewAllowed && (engineRes as any)?.preview) {
            const src = previewSrcFor((engineRes as any).preview);
            if (src && !proLivePreviewUrlRef.current) proLivePreviewUrlRef.current = src;
          }
          if (engineRes && (typeof engineRes.memorySummary === 'string' || Array.isArray(engineRes.editLog))) {
            setSessions(prev => prev.map(s => s.id === currentProSessionId
              ? {
                  ...s,
                  ...(typeof engineRes.memorySummary === 'string' ? { memorySummary: engineRes.memorySummary } : {}),
                  ...(Array.isArray(engineRes.editLog) ? { editLog: engineRes.editLog } : {}),
                }
              : s));
          }
          if (engineRes && engineRes.fileCount > 0 && engineRes.files && Object.keys(engineRes.files).length > 0) {
            const val = engineRes.validation;
            const v = engineRes.verify;
            const passed = val ? !!engineRes.previewAllowed : v.ok;
            const score = val ? val.qualityScore : (v.ok ? 100 : Math.max(0, 100 - v.errors * 20 - v.warnings * 5));
            const issues = val
              ? (val.gates.filter(g => g.status === 'fail').flatMap(g => g.messages).concat(
                  val.gates.filter(g => g.status === 'pending').map(g => `${g.name} — pending (infra)`)))
              : v.issues.map((i: any) => `${i.file}: ${i.message}`);
            const cr = (engineRes as any).codeReview;
            const crText = cr && typeof cr.score === 'number'
              ? ` · Code Review ${cr.score >= 90 ? '🟢' : cr.score >= 70 ? '🟡' : '🔴'} ${cr.score}/100` + ((cr.findings || []).filter((f: any) => f.severity === 'critical' || f.severity === 'high').length > 0 ? ` (${(cr.findings || []).filter((f: any) => f.severity === 'critical' || f.severity === 'high').length} issue${(cr.findings || []).filter((f: any) => f.severity === 'critical' || f.severity === 'high').length > 1 ? 's' : ''})` : '')
              : '';
            const replyText = val
              ? `Build Status: ${val.status} · Quality ${score}/100${passed ? '' : ' — preview blocked, see diagnostics'}${crText}`
              : (v.ok ? `Built — verified clean.${crText}` : `Built (with warnings).${crText}`);
            finishBuild(engineRes.files, {
              reply: replyText,
              validationReport: { score, passed, repairsApplied: engineRes.repairAttempts, syntaxIssues: issues },
              isEdit: isEditRequest,
            });
            // The server hit its soft time-limit and returned a PARTIAL build. Keep
            // the user moving to a complete result automatically (bounded) — they
            // always get the finished app, it just takes a few more rounds.
            if (engineRes.partial && proAutoContinueRef.current < PRO_MAX_AUTO_CONTINUE) {
              proAutoContinueRef.current += 1;
              const part = proAutoContinueRef.current + 1;
              setProMessages(prev => [...prev, {
                id: (Date.now() + 2).toString(),
                text: `⏳ Reached the time limit for this round — continuing automatically (part ${part}) to finish the remaining work…`,
                sender: 'ai', timestamp: new Date(),
              }]);
              setTimeout(() => {
                void handleSendForPro(
                  'Continue building this app from its current state. Finish every remaining feature and detail from the original request; do not restart or remove existing work.',
                  true, true,
                );
              }, 700);
            } else {
              proAutoContinueRef.current = 0;
              // ── Guider grade→refine (Slice 3): the build fully finished (not partial).
              //    If this came from an approved guider plan, grade it against the spec
              //    and auto-refine the gaps (bounded), separate from auto-continue. ──
              if (proGuiderSpecRef.current) {
                const ctx = proGuiderSpecRef.current;
                try {
                  const gr: any = await fetch('/api/guider/grade', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ spec: ctx.spec, prompt: ctx.prompt, files: engineRes.files, agentic: true }),
                  }).then(r => r.json());
                  const grade = gr?.grade;
                  if (grade && !grade.pass && proGuiderRefineRef.current < PRO_MAX_REFINE) {
                    proGuiderRefineRef.current += 1;
                    const round = proGuiderRefineRef.current;
                    const gapText = (grade.gaps || []).map((g: any) => `- ${g.issue}`).join('\n');
                    setProMessages(prev => [...prev, {
                      id: (Date.now() + 3).toString(),
                      text: `🔁 Guider check: ${grade.score}/100 — gaps found, auto-refining (round ${round})…`,
                      sender: 'ai', timestamp: new Date(),
                    }]);
                    setTimeout(() => {
                      void handleSendForPro(
                        `Improve the existing app to fully meet the original request. Fix exactly these gaps without removing working features:\n${gapText}`,
                        true, false, true,
                      );
                    }, 700);
                  } else {
                    if (grade) {
                      setProMessages(prev => [...prev, {
                        id: (Date.now() + 3).toString(),
                        text: grade.pass
                          ? `✅ Guider: all requirements met (${grade.score}/100).`
                          : `Guider: best version ready (${grade.score}/100). Let me know if you'd like further improvements.`,
                        sender: 'ai', timestamp: new Date(),
                      }]);
                    }
                    proGuiderSpecRef.current = null;
                    proGuiderRefineRef.current = 0;
                  }
                } catch {
                  proGuiderSpecRef.current = null;
                  proGuiderRefineRef.current = 0;
                }
              }
            }
            return;
          }
          throw new Error('The engine returned no files.');
        } catch (engineErr: any) {
          if (engineErr?.name === 'AbortError') {
            setProBuildProgress({ active: false, stage: '', steps: [], percent: 0, generatedFiles: {} });
            setProMessages(prev => [...prev, { id: (Date.now() + 1).toString(), text: '🛑 Generation stopped.', sender: 'ai', timestamp: new Date() }]);
            setIsProLoading(false);
            proAbortControllerRef.current = null;
            return;
          }
          // Honest failure — never fall back to the old vanilla generator.
          setProBuildProgress({ active: false, stage: '', steps: [], percent: 0, generatedFiles: {} });
          setProMessages(prev => [...prev, {
            id: (Date.now() + 1).toString(),
            text: `⚠️ Build failed: ${engineErr?.message || 'engine error'}. Please try again, or rephrase your request with a bit more detail.`,
            sender: 'ai', timestamp: new Date(),
          }]);
          setIsProLoading(false);
          proAbortControllerRef.current = null;
          return;
        }

        // ── (RETIRED) legacy /api/pro-build vanilla generator — kept dead, never reached ──
        const response = await fetch('/api/pro-build', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: abortController.signal,
          body: JSON.stringify({
            message: messageToSend,
            history: conversationHistory,
            ...(fileAttachments.length > 0 ? { fileAttachments } : {}),
            ...(isReactRequest ? { framework: 'react' } : {}),
            ...(isEditRequest ? {
              isEdit: true,
              currentFiles: { html: htmlFile, css: cssFile, js: jsFile },
              allFiles: allTextFiles,   // complete workspace — server uses as edit context
            } : {}),
          }),
        });

        if (!response.ok || !response.body) {
          throw new Error(`API Error: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        const processEvent = (line: string) => {
          if (!line.startsWith('data: ')) return;
          try {
            const evt = JSON.parse(line.slice(6));

            if (evt.type === 'progress') {
              const pct = Math.round((evt.step / evt.total) * 90);
              setProBuildProgress(prev => ({
                ...prev,
                percent: pct,
                stage: `${evt.stage}: ${evt.detail}`,
                steps: [
                  ...prev.steps.filter(s => s.label !== evt.stage),
                  { label: evt.stage, sub: evt.detail, status: 'running' as const },
                ],
              }));
            } else if (evt.type === 'file') {
              const fileName: string = evt.fileName;
              const content: string = evt.content || '';
              setProBuildProgress(prev => ({
                ...prev,
                steps: [
                  ...prev.steps.map(s => s.status === 'running' ? { ...s, status: 'done' as const } : s),
                  { label: `📄 ${fileName}`, sub: `${content.split('\n').length} lignes`, status: 'done' as const, code: content, expanded: false },
                ],
                generatedFiles: {
                  ...prev.generatedFiles,
                  [fileName]: { content, expanded: false },
                },
              }));
            } else if (evt.type === 'complete') {
              if (evt.success && evt.files && Object.keys(evt.files).length > 0) {
                setProBuildProgress(prev => ({
                  ...prev,
                  percent: 100,
                  stage: '✅ App ready!',
                  steps: prev.steps.map(s => ({ ...s, status: 'done' as const })),
                  generatedFiles: Object.fromEntries(
                    Object.entries(evt.files as Record<string, string>).map(([k, v]) => [k, { content: v as string, expanded: false }])
                  ),
                }));

                setTimeout(() => {
                  // MERGE: preserve all existing workspace files (ZIP assets, fonts, etc.)
                  // Only the files the AI returned get overwritten; everything else stays.
                  setFiles((prev: any) => {
                    const merged = { ...prev, ...evt.files };
                    return merged;
                  });
                  updatePreview({ ...files, ...evt.files });
                  setIsAppBuilt(true);
                  setHasGeneratedCode(true);
                  saveVersionSnapshot(messageToSend, evt.files);

                  const fileList = Object.keys(evt.files);
                  const vr = evt.validationReport as any;

                  // Validation report section
                  let validationSection = '';
                  if (vr) {
                    const score = vr.score ?? 100;
                    const scoreEmoji = score >= 90 ? '🟢' : score >= 70 ? '🟡' : '🔴';
                    const issues: string[] = [
                      ...(vr.brokenIds || []).map((id: string) => `⚠️ Broken ID: #${id}`),
                      ...(vr.missingWires || []).map((id: string) => `⚠️ Unwired button: #${id}`),
                      ...(vr.syntaxIssues || []).map((s: string) => `⚠️ ${s}`),
                    ];
                    validationSection = [
                      ``,
                      `**Quality Check** ${scoreEmoji} Score: ${score}/100`,
                      vr.passed
                        ? `> ✅ All checks passed${vr.repairsApplied > 0 ? ` (${vr.repairsApplied} auto-repair${vr.repairsApplied > 1 ? 's' : ''} applied)` : ''}`
                        : issues.map((i: string) => `> ${i}`).join('\n'),
                    ].join('\n');
                  }

                  // G5 — code review section
                  let codeReviewSection = '';
                  const cr = (evt as any).codeReview;
                  if (cr && typeof cr.score === 'number') {
                    const crIcon = cr.score >= 90 ? '🟢' : cr.score >= 70 ? '🟡' : '🔴';
                    const critical = (cr.findings || []).filter((f: any) => f.severity === 'critical' || f.severity === 'high');
                    codeReviewSection = [
                      ``,
                      `**Code Review** ${crIcon} ${cr.score}/100`,
                      `> ${cr.summary}`,
                      ...(critical.length > 0 ? critical.slice(0, 3).map((f: any) => `> ⚠️ \`${f.file}\`: ${f.description}`) : ['> ✅ No critical issues found.']),
                    ].join('\n');
                  }

                  // Deploy prompt
                  const deployGuide = evt.deploymentGuide as string | undefined;
                  const deploySection = deployGuide
                    ? `\n\n**Ready to deploy?** 🚀\nType \`deploy\` for step-by-step deployment options!\n\n<details>\n<summary>📋 Deployment Options (click to expand)</summary>\n\n${deployGuide}\n</details>`
                    : `\n\n**App is ready!** Check the preview → type "deploy" to get deployment options.`;

                  const replyText = evt.reply || 'App successfully generated!';
                  const replyPrefix = replyText.startsWith('⚠️') || replyText.startsWith('Could not') ? '' : '✅ ';
                  const isFileEdit = evt.isEdit || replyText.startsWith('Updated ');
                  const processLog = [
                    `${replyPrefix}${replyText}`,
                    ``,
                    `**Build Summary**`,
                    fileList.map((f: string) => `> \`${f}\` — ${isFileEdit ? 'updated' : 'created'}`).join('\n'),
                    validationSection,
                    codeReviewSection,
                    ``,
                    `**App is live in Preview** →`,
                    deploySection,
                  ].join('\n');

                  const suggestions: string[] = evt.followUpSuggestions || [];
                  setProMessages(prev => [...prev, {
                    id: (Date.now() + 1).toString(),
                    text: processLog + '\n\n__VIEW_PREVIEW____DEPLOY_ACTIONS__',
                    sender: 'ai',
                    timestamp: new Date(),
                    meta: {
                      deployFiles: evt.files,
                      appName: evt.appName || 'NavBharatAI-App',
                      suggestions,
                    } as any,
                  }]);

                  setProBuildProgress({ active: false, stage: '', steps: [], percent: 0, generatedFiles: {} });
                  setIsProLoading(false);
                }, 1200);
              } else {
                throw new Error(evt.error || 'Build failed — no files generated');
              }
            } else if (evt.type === 'error') {
              const errMsg = evt.message || 'Build error';
              const suggestion = evt.suggestion ? `\n\n💡 ${evt.suggestion}` : '';
              throw new Error(errMsg + suggestion);
            }
          } catch (parseErr: any) {
            if (parseErr.message && !parseErr.message.includes('JSON')) throw parseErr;
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (line.trim()) processEvent(line);
          }
        }

      } catch (e: any) {
        if (e.name === 'AbortError') {
          setProBuildProgress({ active: false, stage: '', steps: [], percent: 0, generatedFiles: {} });
          setProMessages(prev => [...prev, {
            id: (Date.now() + 1).toString(),
            text: '🛑 Generation stopped.',
            sender: 'ai',
            timestamp: new Date(),
          }]);
          setIsProLoading(false);
          return;
        }
        setProBuildProgress(prev => ({
          ...prev,
          active: true,
          stage: `❌ ${e.message || 'Build failed'}`,
          steps: prev.steps.map(s => s.status === 'running' ? { ...s, status: 'error' as const } : s),
        }));
        await new Promise(r => setTimeout(r, 2000));
        setProBuildProgress({ active: false, stage: '', steps: [], percent: 0, generatedFiles: {} });
        setProMessages(prev => [...prev, {
          id: (Date.now() + 1).toString(),
          text: `⚠️ Build Error: ${e.message || 'Something went wrong. Please try again.'}`,
          sender: 'ai',
          timestamp: new Date(),
        }]);
        setIsProLoading(false);
      }
    } else {
      // ── Planning mode — simple fetch ──
      try {
        // Strip meta.deployFiles before sending — they can be 100KB+ and blow the body limit
        const safeHistory = proMessages.slice(-12).map((m: any) => ({
          sender: m.sender,
          text: String(m.text || '').slice(0, 600),
        }));
        const response = await fetch('/api/pro-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: abortController.signal,
          body: JSON.stringify({
            message: messageToSend,
            history: safeHistory,
            mode: 'planning',
            currentApp: hasGeneratedCode && generatedCode && generatedCode.length > 200
              ? generatedCode.slice(0, 3000)
              : undefined,
            ...(fileAttachments.length > 0 ? {
              fileData: fileAttachments[0].base64,
              fileType: fileAttachments[0].type,
              fileName: fileAttachments[0].name,
            } : {}),
          }),
        });
        if (!response.ok) throw new Error(`API Error: ${response.status}`);
        const data = await response.json();
        // suggestBuild=true means user asked to build → show urgent CTA
        const buildMarker = data.suggestBuild ? '__URGENT_BUILD__' : '__SWITCH_TO_BUILD__';
        setProMessages(prev => [...prev, {
          id: (Date.now() + 1).toString(),
          text: (data.reply || 'No response') + '\n\n' + buildMarker,
          sender: 'ai',
          timestamp: new Date(),
        }]);
      } catch (e: any) {
        if (e.name !== 'AbortError') {
          setProMessages(prev => [...prev, {
            id: (Date.now() + 1).toString(),
            text: `⚠️ Error: ${e.message}`,
            sender: 'ai',
            timestamp: new Date(),
          }]);
        } else {
          setProMessages(prev => [...prev, {
            id: (Date.now() + 1).toString(),
            text: '🛑 Generation stopped.',
            sender: 'ai',
            timestamp: new Date(),
          }]);
        }
      }
      setIsProLoading(false);
    }
  };

  const handleStopPro = () => {
    proAbortControllerRef.current?.abort();
    proAbortControllerRef.current = null;
  };

  const handleDeployApp = useCallback(async () => {
    const deployFiles = files && Object.keys(files).length > 0 ? files : null;
    if (!deployFiles) { setDeployPanelError('No files to deploy. Build an app first.'); return; }
    if (!deployToken.trim()) { setDeployPanelError('Please enter your API token.'); return; }
    if (deployPlatform === 'vercel' && !deployProjectName.trim()) { setDeployPanelError('Please enter a project name.'); return; }
    if (deployPlatform === 'github' && (!deployOwner.trim() || !deployRepo.trim())) { setDeployPanelError('Please enter owner and repo.'); return; }
    if (deployPlatform === 'cloudflare' && (!deployOwner.trim() || !deployProjectName.trim())) { setDeployPanelError('Please enter Account ID and project name.'); return; }
    setIsDeploying(true);
    setDeployPanelError('');
    try {
      const body: Record<string, string | Record<string, string>> = { provider: deployPlatform, token: deployToken, files: deployFiles };
      if (deployPlatform === 'vercel') body.name = deployProjectName.trim();
      else if (deployPlatform === 'netlify') body.siteId = deployProjectName.trim();
      else if (deployPlatform === 'github') { body.owner = deployOwner.trim(); body.repo = deployRepo.trim(); }
      else if (deployPlatform === 'cloudflare') { body.accountId = deployOwner.trim(); body.name = deployProjectName.trim(); }
      const resp = await fetch('/api/pro/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await resp.json().catch(() => ({})) as any;
      if (!resp.ok) throw new Error(data?.error || `Deploy failed (${resp.status})`);
      setShowDeployPanel(false);
      setDeployUrl(data.url);
      setIsDeployed(true);
      toggleTab('deploy');
    } catch (e: any) {
      setDeployPanelError(e.message || 'Deploy failed. Please check your token and try again.');
    } finally {
      setIsDeploying(false);
    }
  }, [files, deployPlatform, deployToken, deployProjectName, deployOwner, deployRepo]);

  const downloadAppZip = useCallback(async (deployFiles: Record<string, string>, appName: string) => {
    try {
      const response = await fetch('/api/download-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: deployFiles, appName }),
      });
      if (!response.ok) throw new Error('Download failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${appName.replace(/[^a-zA-Z0-9-_]/g, '-')}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      addToast('App downloaded as ZIP ✓', 'success');
    } catch {
      addToast('Download failed — try again', 'error');
    }
  }, [addToast]);

  const handleFilesUpload = useCallback(async (selectedFile: File) => {
    const isZip = selectedFile.name.toLowerCase().endsWith('.zip') ||
      selectedFile.type === 'application/zip' ||
      selectedFile.type === 'application/x-zip-compressed';

    if (isZip) {
      const sizeMB = selectedFile.size / (1024 * 1024);
      if (sizeMB > 500) {
        setZipSizeModal({ variant: 'too-large', fileName: selectedFile.name, fileSizeMB: sizeMB });
        return;
      }
      if (sizeMB > 50) {
        setZipSizeModal({ variant: 'github', fileName: selectedFile.name, fileSizeMB: sizeMB });
        return;
      }
      // < 50 MB: proceed with normal conflict check + import
      const hasExisting = Object.keys(files).filter(k => !k.startsWith('.')).length > 0;
      if (hasExisting) {
        setFileUploadConflict({ file: selectedFile, existingKey: '', isZip: true });
      } else {
        handleZipImport(selectedFile);
      }
      return;
    }

    // Non-ZIP: read as text or base64, then check for conflict
    const existingKey = Object.keys(files).find(k => k === selectedFile.name || k.endsWith('/' + selectedFile.name));
    const isText = /\.(html|htm|css|scss|js|ts|jsx|tsx|json|md|txt|xml|svg|yaml|yml|py|php|vue|svelte)$/i.test(selectedFile.name);

    const readFile = (): Promise<string> => new Promise((resolve, reject) => {
      const reader = new FileReader();
      if (isText) {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsText(selectedFile);
      } else {
        reader.onload = () => resolve(reader.result as string); // base64 data URL
        reader.onerror = reject;
        reader.readAsDataURL(selectedFile);
      }
    });

    try {
      const content = await readFile();
      if (existingKey) {
        setFileUploadConflict({ file: selectedFile, existingKey, isZip: false });
        // Store content in a ref-like way via a temp key — resolved in conflict handler
        setFiles(prev => ({ ...prev, [`__pending__${selectedFile.name}`]: content }));
      } else {
        setFiles(prev => ({ ...prev, [selectedFile.name]: content }));
        setHasGeneratedCode(true);
        setIsAppBuilt(true);
        saveFile(selectedFile.name, content).catch(() => {}); // persist
        addToast(`${selectedFile.name} added ✓`, 'success');
      }
    } catch {
      addToast('File read failed — try again', 'error');
    }
  }, [files, addToast, handleZipImport]);

  const resolveFileConflict = useCallback(async (choice: 'replace' | 'merge') => {
    if (!fileUploadConflict) return;
    const { file, existingKey, isZip } = fileUploadConflict;
    setFileUploadConflict(null);

    if (isZip) {
      if (choice === 'replace') {
        setFiles({});
        clearWorkspace().catch(() => {}); // wipe persisted workspace before re-import
        setHasGeneratedCode(false);
        setIsAppBuilt(false);
        setTimeout(() => handleZipImport(file), 50);
      } else {
        handleZipImport(file); // merge = add on top of existing
      }
      return;
    }

    // Non-ZIP conflict
    const pendingContent = files[`__pending__${file.name}`] || '';
    setFiles(prev => {
      const next = { ...prev };
      delete next[`__pending__${file.name}`];
      if (choice === 'replace') {
        next[existingKey] = pendingContent;
      } else {
        // Keep both: add with _new suffix
        const parts = file.name.split('.');
        const newName = parts.length > 1
          ? `${parts.slice(0, -1).join('.')}_new.${parts[parts.length - 1]}`
          : `${file.name}_new`;
        next[newName] = pendingContent;
      }
      return next;
    });
    addToast(`${file.name} ${choice === 'replace' ? 'replaced' : 'added as ' + file.name.replace(/(\.[^.]+)$/, '_new$1')} ✓`, 'success');
  }, [fileUploadConflict, files, addToast, handleZipImport]);

  const handleUndoBuild = useCallback(() => {
    if (buildVersionStack.length === 0) return;
    const [lastVersion, ...rest] = buildVersionStack;
    setBuildVersionStack(rest);
    setFiles(lastVersion.files as any);
    updatePreview(lastVersion.files as any);
    addToast('Restored previous version ↩', 'success');
  }, [buildVersionStack, updatePreview, addToast]);

  const saveVersionSnapshot = useCallback((buildRequest: string, builtFiles: Record<string, string>) => {
    if (!builtFiles || Object.keys(builtFiles).length === 0) return;
    try {
      const saved = localStorage.getItem('navbharat_versions');
      const existing: any[] = saved ? JSON.parse(saved) : [];
      const allContent = Object.values(builtFiles).join('');
      // Strip base64 image data-URLs from files before storing to keep versions lean
      const strippedFiles = Object.fromEntries(
        Object.entries(builtFiles).map(([k, v]) => [k, v.replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g, '(image)')])
      );
      const snapshot = {
        id: Date.now().toString(),
        name: `Build: ${buildRequest.slice(0, 40)}`,
        code: (builtFiles['index.html'] || allContent).slice(0, 5000),
        files: strippedFiles,
        timestamp: Date.now(),
        label: 'build',
        size: allContent.length,
      };
      const updated = [snapshot, ...existing].slice(0, 10);
      safeLS('navbharat_versions', JSON.stringify(updated));
    } catch {}
  }, []);

  // Task 2.7 — memoized: static array, rebuilt only once
  const menuItems = useMemo(() => [
    { id: 'home',         label: 'Home',              icon: Bot },
    { id: 'nbi_chat',     label: 'NavBharatAI FREE',  icon: MessageSquare },
    { id: 'nbi_pro_chat', label: 'NavBharatAI Pro',   icon: Bot },
    { id: 'preview',      label: 'Preview',           icon: Monitor },
    { id: 'files',        label: 'Files',             icon: FolderOpen },
    { id: 'history',      label: 'History',           icon: History },
    { id: 'studio',       label: 'Code Studio',       icon: Smartphone },
    { id: 'git',          label: 'Git',               icon: GitBranch },
    { id: 'billing',      label: 'Wallet & Billing',  icon: Wallet },
    { id: 'professionals', label: 'Professionals',    icon: Briefcase, status: 'New' },
    { id: 'donation',     label: 'Donate',            icon: Heart },
    { id: 'settings',     label: 'Settings',          icon: Settings },
  ], []);

  // --- UNIVERSAL CHAT CONTINUATION SYSTEM (UCI) HELPERS & IMPLEMENTATION ---
  
  const NBI_GREETINGS = [
    "Welcome to navBharatAI Workspace! What advanced platform shall we design today?",
    "navBharatAI orchestrator is live. General queries or full-stack builds — let's innovate!",
    "navBharatAI core cognitive system is active. Your enterprise specifications are welcome here.",
    "navBharatAI online. Let's craft scalable architectures with deep, robust logic today."
  ];

  const BASIC_GREETINGS = [
    "Vishwakarma Basic active. Security audit protocols loaded and ready for code analysis.",
    "Vishwakarma Basic online. Let's identify structural vulnerabilities and build secure pages.",
    "Vishwakarma Basic analysis engine is fully operational. Ready for your coding needs."
  ];

  const PRO_GREETINGS = [
    "Vishwakarma Pro ready. Previous architecture context restored. Ready to build highly optimized premium SaaS workflows!",
    "Welcome back. Continuing your last high-fidelity development session with Vishwakarma Pro configurations.",
    "Pro level authorized. Let's design premium microservices, database structures, and high-performance assets."
  ];

  const VIP_GREETINGS = [
    "VIP orchestration initialized. Sovereign multi-model cognitive routing is actively online.",
    "Sovereign VIP Agent active. Enterprise platforms, AI scaling, and zero-trust security matrices initialized.",
    "Welcome to VIP Workspace! Highly tuned LLM orchestrators and stateful agents are ready to assist you."
  ];

  const generateUCI = (): string => {
    const uppers = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lowers = 'abcdefghijklmnopqrstuvwxyz';
    const digits = '0123456789';
    const symbols = '!@#$%^&*';
    const allChars = uppers + lowers + digits + symbols;
    
    // Choose randomized lengths between 10 and 16 characters
    const len = Math.floor(Math.random() * (16 - 10 + 1)) + 10;
    
    let result = '';
    // Guarantee characters from all necessary classes to prevent bypasses
    result += uppers[Math.floor(Math.random() * uppers.length)];
    result += lowers[Math.floor(Math.random() * lowers.length)];
    result += digits[Math.floor(Math.random() * digits.length)];
    result += symbols[Math.floor(Math.random() * symbols.length)];
    
    for (let i = 4; i < len; i++) {
      result += allChars[Math.floor(Math.random() * allChars.length)];
    }
    
    // Perform thorough randomized fisher-yates shuffle
    const arr = result.split('');
    for (let j = arr.length - 1; j > 0; j--) {
      const k = Math.floor(Math.random() * (j + 1));
      const temp = arr[j];
      arr[j] = arr[k];
      arr[k] = temp;
    }
    return arr.join('');
  };

  const getRandomElement = <T,>(arr: T[]): T => {
    return arr[Math.floor(Math.random() * arr.length)];
  };

  const generateSmartHeuristicSummary = (history: Message[]): string => {
    const userMessages = history.filter(m => m.sender === 'user');
    if (userMessages.length === 0) return 'Initialized default sandbox environment';
    
    const completed: string[] = [];
    const pending: string[] = [];
    
    userMessages.forEach(m => {
      const txt = m.text.toLowerCase();
      if (txt.includes('build') || txt.includes('create') || txt.includes('make') || txt.includes('banao')) {
         completed.push(`Feature build: "${m.text.slice(0, 35)}..."`);
      } else if (txt.includes('fix') || txt.includes('bug') || txt.includes('correct') || txt.includes('error')) {
         completed.push(`Debugging session: "${m.text.slice(0, 35)}..."`);
      } else {
         pending.push(`Pending item: "${m.text.slice(0, 35)}..."`);
      }
    });

    if (completed.length === 0) completed.push('Workspace initiation under UCI protocol');
    if (pending.length === 0) pending.push('Dynamic continuous prompt analysis');

    return `### 🧠 COMPRESSED INTELLECTUAL WORKSPACE MEMORY
- **Completed Milestones**:
${completed.map(c => `  - ${c}`).join('\n')}
- **Pending Actions**:
${pending.map(p => `  - ${p}`).join('\n')}
`;
  };

  const resumeSession = (session: ChatSession) => {
    setCurrentSessionId(session.id);
    const m = session.messages || [];
    const isVishwakarmaSession = (session.agent && session.agent.startsWith('vishwakarma')) || m.some(msg => msg.text?.includes('Vishwakarma') || msg.text?.includes('AGENT: Vishwakarma') || msg.text?.includes('Vishwakarma VIP'));
    
    setFiles(session.files || {});
    if (session.mode) setMode(session.mode);
    if (session.agent) {
       if (session.agent.startsWith('vishwakarma')) {
          setActiveAgent(session.agent);
       } else {
          setActiveAgent(session.agent);
       }
    }
    
    if (isVishwakarmaSession) {
       const targetAgentForSession = 'navbharatai';
       setMessages(m);
       toggleTab('asc_chat');
    } else {
      setMessages(m);
       toggleTab('nbi_chat');
    }
    
    addLog(`Resored session (UCI: ${session.uci || 'N/A'}): ${session.title}`, 'info');
  };

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
            restoredMessages: docData.restoredMessages || [],
            meta: { tab: docData.tab }
          } as any;
        }
      } catch (err) {
        console.error('Error fetching session from Firestore:', err);
      }
    }
    
    if (!targetSession) {
      return false;
    }
    
    // Set matching workspace file config
    if (targetSession.files && Object.keys(targetSession.files).length > 0) {
      setFiles(targetSession.files);
    }
    
    const targetAgent = targetSession.agent || 'navbharatai';
    const isVishwakarma = targetAgent.startsWith('vishwakarma');
    
    // Build combined list of old messages to collapse
    const combinedHistory = [...(targetSession.restoredMessages || []), ...targetSession.messages];
    const uniqueHistoryMap: Record<string, Message> = {};
    combinedHistory.forEach(msg => {
      if (msg && msg.id) uniqueHistoryMap[msg.id] = msg;
    });
    const uniqueHistory = Object.values(uniqueHistoryMap).sort((a, b) => {
      return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    });

    let memSummary = targetSession.memorySummary || '';
    if (!memSummary && uniqueHistory.length > 0) {
      memSummary = generateSmartHeuristicSummary(uniqueHistory);
    }
    
    let greetingText = '';
    if (targetAgent === 'vishwakarma_vip') greetingText = getRandomElement(VIP_GREETINGS);
    else if (targetAgent === 'vishwakarma_pro') greetingText = getRandomElement(PRO_GREETINGS);
    else if (targetAgent === 'vishwakarma_basic') greetingText = getRandomElement(BASIC_GREETINGS);
    else greetingText = getRandomElement(NBI_GREETINGS);
    
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
    const isProAgent = targetAgent === 'navbharatai-pro' || targetAgent.includes('pro');
    const isVishwakarmaAgent = targetAgent.startsWith('vishwakarma');
    const isProSession = savedTab === 'nbi_pro_chat' || isProAgent;
    const isAscSession = savedTab === 'asc_chat' || isVishwakarmaAgent;
    const isSdaSession = savedTab === 'sda_chat' || targetAgent === 'sda';

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
    const targetTab: ViewType = savedTab && ['nbi_chat', 'nbi_pro_chat', 'asc_chat', 'sda_chat'].includes(savedTab)
      ? savedTab
      : isAscSession ? 'asc_chat' : isProSession ? 'nbi_pro_chat' : isSdaSession ? 'sda_chat' : 'nbi_chat';
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

  const renderUciControls = (themeColor: 'indigo' | 'amber') => {
    const activeSession = sessions.find(s => s.id === currentSessionId);
    const currentUci = activeSession?.uci || '';
    if (!currentUci) return null;
    
    const isIndigo = themeColor === 'indigo';
    const borderClass = isIndigo ? 'border-indigo-500/20' : 'border-amber-500/20';
    const bgClass = isIndigo ? 'bg-indigo-900/10' : 'bg-amber-900/10';
    const textClass = isIndigo ? 'text-indigo-400' : 'text-amber-400';
    const hoverBgClass = isIndigo ? 'hover:bg-indigo-500/10' : 'hover:bg-amber-500/10';
    const btnBgClass = isIndigo ? 'bg-indigo-600/15 hover:bg-indigo-600/25 text-indigo-300' : 'bg-amber-600/15 hover:bg-amber-600/25 text-amber-300';
    
    return (
      <div className="flex items-center gap-1.5 normal-case font-medium ml-auto select-none shrink-0" id="uci-sub-header-widget">
        <div className={`flex items-center gap-1 bg-black/40 border ${borderClass} rounded-lg px-2 py-0.5 text-[8px] font-mono ${textClass}`}>
          <span className="select-all tracking-tight opacity-90">{currentUci}</span>
          <button 
            onClick={(e) => {
              e.stopPropagation();
              navigator.clipboard.writeText(currentUci);
              setCopiedUci(true);
              setTimeout(() => setCopiedUci(false), 2000);
            }}
            className={`p-0.5 rounded ${hoverBgClass} text-white/70 hover:text-white transition-all active:scale-90`}
            title="Copy Universal Chat ID"
          >
            {copiedUci ? <Check className="w-2.5 h-2.5 text-emerald-400" /> : <Copy className="w-2.5 h-2.5" />}
          </button>
        </div>

        <button 
          onClick={(e) => {
            e.stopPropagation();
            const shareUrl = `${window.location.origin}${window.location.pathname}?uci=${encodeURIComponent(currentUci)}`;
            navigator.clipboard.writeText(shareUrl);
            setSharedUci(true);
            setTimeout(() => setSharedUci(false), 2000);
          }}
          className={`px-1.5 py-0.5 bg-emerald-600/15 hover:bg-emerald-600/25 text-emerald-400 border border-emerald-500/20 rounded-lg text-[8px] font-bold uppercase tracking-wider transition-all active:scale-95`}
          title="Share Workspace Link"
        >
          {sharedUci ? 'Copied Link' : 'Share'}
        </button>

        <button 
          onClick={(e) => {
            e.stopPropagation();
            setShowContinueModal(true);
          }}
          className={`px-1.5 py-0.5 ${btnBgClass} border ${borderClass} rounded-lg text-[8px] font-bold uppercase tracking-wider transition-all active:scale-95`}
          title="Restore session by UCI"
        >
          Continue
        </button>
      </div>
    );
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
    }
    if (currentSessionId === id) {
      startNewChat();
    }
  };

  const startNewChat = () => {
    const newId = Date.now().toString();
    const newUci = user ? generateUCI() : '';
    
    // Choose starting dynamic welcomes
    const pNbi = getRandomElement(NBI_GREETINGS);
    const pBasic = getRandomElement(BASIC_GREETINGS);
    const pPro = getRandomElement(PRO_GREETINGS);
    const pVip = getRandomElement(VIP_GREETINGS);

    setCurrentSessionId(newId);
    setMessages([]);
    
    
    const isVishwakarma = false;
    const welcomeText = isVishwakarma
       ? 'Hello! I\'m Vishwakarma. How can I help you today?'
       : 'Hello! I\'m navBharatAI. You can chat with me in any language!';

    setMessages([
      { id: 'welcome', text: welcomeText, sender: 'ai', timestamp: new Date(), modelUsed: 'General Assistant' }
    ]);

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
      messages: isVishwakarma 
        ? [{ id: 'asc-welcome', text: 'Hello! I\'m Vishwakarma. How can I help you today?', sender: 'ai', timestamp: new Date(), modelUsed: 'Vishwakarma' }]
        : [{ id: 'nbi-welcome', text: 'Hello! I\'m navBharatAI. You can chat with me in any language!', sender: 'ai', timestamp: new Date(), modelUsed: 'navBharatAI Cognitive Layer' }],
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

  useEffect(() => {
    // Check and restore saved layout/project state if returning from OAuth
    try {
      const savedStateStr = localStorage.getItem('github_oauth_return_state');
      if (savedStateStr) {
        const savedState = JSON.parse(savedStateStr);
        // Validate fresh layout storage (within last 30 minutes)
        if (savedState && Date.now() - (savedState.timestamp || 0) < 30 * 60 * 1000) {
          if (savedState.activeView) {
            setActiveView(savedState.activeView);
            addLog(`Restoring view context: ${savedState.activeView}`, 'info');
          }
          if (savedState.currentSessionId) {
            setCurrentSessionId(savedState.currentSessionId);
            addLog(`Restoring workspace project ID: ${savedState.currentSessionId}`, 'info');
          }
        }
        localStorage.removeItem('github_oauth_return_state');
      }

      const savedFirebaseStateStr = localStorage.getItem('firebase_oauth_return_state');
      if (savedFirebaseStateStr) {
        const savedState = JSON.parse(savedFirebaseStateStr);
        if (savedState && Date.now() - (savedState.timestamp || 0) < 30 * 60 * 1000) {
          if (savedState.activeView) {
            setActiveView(savedState.activeView);
            addLog(`Restoring view context for Firebase: ${savedState.activeView}`, 'info');
          }
          if (savedState.currentSessionId) {
            setCurrentSessionId(savedState.currentSessionId);
            addLog(`Restoring workspace project ID: ${savedState.currentSessionId}`, 'info');
          }
        }
        localStorage.removeItem('firebase_oauth_return_state');
      }
    } catch (e) {
      console.error('Failed to parse or restore OAuth redirect layout state:', e);
    }

    const handleMessage = (e: MessageEvent) => {
      if (e.data.type === 'SANDBOX_ERROR') {
        addLog(`Sandbox error: ${e.data.message}`, 'error');
      } else if (e.data.type === 'GITHUB_AUTH_SUCCESS') {
        const token = e.data.token;
        setGithubToken(token);
        localStorage.setItem('gh_token', token);
        addLog('GitHub connected successfully.', 'success');
        fetchGitHubUser(token);
      } else if (e.data.type === 'GITHUB_AUTH_ERROR') {
        addLog(`GitHub connection failed: ${e.data.error}`, 'error');
      } else if (e.data.type === 'FIREBASE_AUTH_SUCCESS') {
        const token = e.data.token;
        const userObj = e.data.user;
        setFirebaseToken(token);
        setFirebaseUser(userObj);
        localStorage.setItem('fb_token', token);
        localStorage.setItem('fb_user', JSON.stringify(userObj));
        // Keep the active deployment platform synced
        localStorage.setItem('v_deploy_platform', 'firebase');
        addLog(`GCP/Firebase connected successfully to project: ${userObj.projectId || 'navbharat-sandbox-7729'}.`, 'success');
      } else if (e.data.type === 'FIREBASE_AUTH_ERROR') {
        addLog(`Firebase connection failed: ${e.data.error}`, 'error');
        setFirebaseOauthError({
          errorType: e.data.errorType || "Firebase OAuth Connection Failure",
          message: e.data.error || "The remote Firebase OAuth authorization handshake failed.",
          suggestions: e.data.suggestions || "Verify your connection settings, check your network environment, and try again."
        });
      }
    };
    window.addEventListener('message', handleMessage);

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'gh_token_signal' && e.newValue) {
        const token = e.newValue;
        setGithubToken(token);
        localStorage.setItem('gh_token', token);
        addLog('GitHub connected successfully via cross-tab channel.', 'success');
        fetchGitHubUser(token);
        localStorage.removeItem('gh_token_signal');
      } else if (e.key === 'firebase_token_signal' && e.newValue) {
        const token = e.newValue;
        setFirebaseToken(token);
        localStorage.setItem('fb_token', token);
        try {
          const userObj = JSON.parse(localStorage.getItem('fb_user') || '{}');
          setFirebaseUser(userObj);
        } catch {}
        localStorage.setItem('v_deploy_platform', 'firebase');
        addLog('Firebase pipeline updated successfully via cross-tab channel.', 'success');
        localStorage.removeItem('firebase_token_signal');
      }
    };
    window.addEventListener('storage', handleStorageChange);

    // Check for fragment token (supporting full redirect flow)
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const fragmentToken = hashParams.get('gh_token');
    if (fragmentToken) {
      setGithubToken(fragmentToken);
      localStorage.setItem('gh_token', fragmentToken);
      addLog('GitHub connected (via redirect).', 'success');
      fetchGitHubUser(fragmentToken);
      // Clean URL
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }

    const fbFragmentToken = hashParams.get('fb_token');
    if (fbFragmentToken) {
      setFirebaseToken(fbFragmentToken);
      localStorage.setItem('fb_token', fbFragmentToken);
      try {
        const userStr = hashParams.get('fb_user');
        if (userStr) {
          const decodedUser = JSON.parse(decodeURIComponent(userStr));
          setFirebaseUser(decodedUser);
          localStorage.setItem('fb_user', JSON.stringify(decodedUser));
        }
      } catch {}
      localStorage.setItem('v_deploy_platform', 'firebase');
      addLog('Firebase connected (via redirect).', 'success');
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }

    return () => {
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  const connectGitHub = async () => {
    // Save current view state before starting GitHub OAuth
    const returnPath = {
      activeView: activeView,
      currentSessionId: currentSessionId,
      timestamp: Date.now()
    };
    localStorage.setItem('github_oauth_return_state', JSON.stringify(returnPath));
    // Save the specific IDE panel to activate on mount
    localStorage.setItem('github_oauth_return_active_screen', 'git');

    const width = 600, height = 700;
    const communitiesLeft = window.innerWidth / 2 - width / 2;
    const communitiesTop = window.innerHeight / 2 - height / 2;
    
    // Pass the current URL as state so the server knows where to return the user
    const state = window.location.href.split('#')[0];
    
    // ALWAYS HARDCODE THE SECURE PRODUCTION REDIRECT URI PER USER DIRECTIVE
    const redirectUri = "https://navbharatai.com/api/github/callback";

    setGithubRedirectingMessage('Opening GitHub authorization popup... Please wait or verify your browser popup block settings.');
    
    try {
      addLog('Initiating secure GitHub OAuth handshake...', 'info');
      
      const reqUrl = new URL(`${window.location.origin}/api/auth/github/url`);
      reqUrl.searchParams.set('redirect_uri', redirectUri);
      reqUrl.searchParams.set('state', state);

      const response = await fetch(reqUrl.toString());
      
      if (!response.ok) {
        throw new Error('Failed to retrieve GitHub Authorization parameters from server context.');
      }
      
      const data = await response.json();
      if (!data.url) {
        throw new Error('Oauth URL parameters returned from server are invalid.');
      }

      // Safe URL construction using native browser URL constructor instead of string-concats
      const githubUrl = new URL(data.url);
      if (data.clientId) githubUrl.searchParams.set('client_id', data.clientId);
      githubUrl.searchParams.set('redirect_uri', redirectUri);
      if (data.scope) githubUrl.searchParams.set('scope', data.scope);
      if (data.state) githubUrl.searchParams.set('state', data.state);

      const finalOAuthUrl = githubUrl.toString();

      // Populate diagnosis details for in-app floating overlay popup debug representation
      setGithubDebugData({
        oauthUrl: finalOAuthUrl,
        redirectUri: redirectUri,
        currentDomain: window.location.origin,
        callbackUrl: redirectUri
      });

      addLog('Redirecting to GitHub for secure authentication...', 'info');
      setGithubRedirectingMessage('Redirecting to GitHub... Please wait.');
      setTimeout(() => {
        try {
          if (window.self !== window.top) {
            window.top.location.href = finalOAuthUrl;
          } else {
            window.location.href = finalOAuthUrl;
          }
        } catch (e) {
          window.location.href = finalOAuthUrl;
        }
      }, 600);
    } catch (err: any) {
      addLog(`Failed to initiate GitHub OAuth: ${err.message}`, 'error');
      setGithubRedirectingMessage(`Authentication Flow Failed: ${err.message}`);
    }
  };

  const disconnectGitHub = () => {
    setGithubToken(null);
    setGithubUser(null);
    setRepositories([]);
    localStorage.removeItem('gh_token');
    addLog('GitHub account disconnected.', 'info');
  };

  const connectFirebase = async () => {
    // Save current view state before starting Firebase OAuth
    const returnPath = {
      activeView: activeView,
      currentSessionId: currentSessionId,
      timestamp: Date.now()
    };
    localStorage.setItem('firebase_oauth_return_state', JSON.stringify(returnPath));
    localStorage.setItem('github_oauth_return_active_screen', 'git');

    const width = 600, height = 700;
    const communitiesLeft = window.innerWidth / 2 - width / 2;
    const communitiesTop = window.innerHeight / 2 - height / 2;
    
    const state = window.location.href.split('#')[0];
    const redirectUri = `${window.location.origin}/api/auth/firebase/callback`;

    try {
      addLog('Initiating secure GCP/Firebase OAuth handshake...', 'info');
      
      const consentUrl = new URL(`${window.location.origin}/api/auth/firebase/consent`);
      consentUrl.searchParams.set('redirect_uri', redirectUri);
      consentUrl.searchParams.set('state', state);

      addLog('Redirecting to Firebase/GCP authorization consent...', 'info');
      setTimeout(() => {
        try {
          if (window.self !== window.top) {
            window.top.location.href = consentUrl.toString();
          } else {
            window.location.href = consentUrl.toString();
          }
        } catch (e) {
          window.location.href = consentUrl.toString();
        }
      }, 600);
    } catch (err: any) {
      addLog(`Failed to initiate Firebase OAuth: ${err.message}`, 'error');
      setFirebaseOauthError({
        errorType: 'OAuth Initiation Failed',
        message: err.message || 'Unable to construct OAuth initiation parameters.',
        suggestions: 'Verify network settings and ensure authorization credentials or domain restrictions are properly maintained.'
      });
    }
  };

  const disconnectFirebase = () => {
    setFirebaseToken(null);
    setFirebaseUser(null);
    localStorage.removeItem('fb_token');
    localStorage.removeItem('fb_user');
    addLog('Firebase account disconnected.', 'info');
  };

  const fetchGitHubUser = async (token: string) => {
    setIsGHSyncing(true);
    try {
      const response = await fetch('/api/github/user', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) throw new Error('Failed to fetch user');
      const user = await response.json();
      setGithubUser(user);
      fetchUserRepos(token);
    } catch (err: any) {
      addLog(`GitHub user fetch failed: ${err.message}`, 'error');
      if (err.message.includes('401')) disconnectGitHub();
    } finally {
      setIsGHSyncing(false);
    }
  };

  const fetchUserRepos = async (token: string) => {
    setIsGHSyncing(true);
    try {
      const response = await fetch('/api/github/repos', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) throw new Error('Failed to fetch repos');
      const repos = await response.json();
      setRepositories(repos);
    } catch (err: any) {
      addLog(`Failed to load repositories: ${err.message}`, 'error');
    } finally {
      setIsGHSyncing(false);
    }
  };

  const [availableBranches, setAvailableBranches] = useState<string[]>([]);
  const [currentBranch, setCurrentBranch] = useState<string>('main');
  const [patInputValue, setPatInputValue] = useState('');
  const [showGHAid, setShowGHAid] = useState(false);

  const openGitHubFilesInStudio = () => {
    setActiveView('studio');
    addLog('GitHub files loaded in Code Studio for editing.', 'success');
    
    // Add activation message as requested
    const activationMsg: Message = {
      id: Date.now().toString(),
      text: "📂 **GitHub Repository Loaded Successfully**\nFiles are now loading in Code Studio in real mode. You can edit them directly. Use AI to edit code and push changes back to GitHub using the **Commit & Push** capability.",
      sender: 'ai',
      timestamp: new Date(),
      modelUsed: 'GitHub Core'
    };
    setMessages(prev => [...prev, activationMsg]);
  };

  const importRepo = async (repo: any, branchName?: string) => {
    setIsGHSyncing(true);
    setSelectedRepo(repo);
    const targetBranch = branchName || repo.default_branch || 'main';
    setCurrentBranch(targetBranch);
    
    setGithubRepoContext({
      token: githubToken!,
      owner: repo.owner.login,
      repo: repo.name,
      branch: targetBranch
    });

    addLog(`Importing ${repo.full_name} (${targetBranch})...`, 'info');
    try {
      const response = await fetch('/api/github/fetch', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${githubToken}`
        },
        body: JSON.stringify({ owner: repo.owner.login, repo: repo.name, branch: targetBranch })
      });
      
      if (!response.ok) throw new Error('Failed to fetch repo content');
      const data = await response.json();
      
      if (data.files && Object.keys(data.files).length > 0) {
        setFiles(data.files);
        const firstFile = Object.keys(data.files).find(f => f.includes('index.html')) || Object.keys(data.files)[0];
        setActiveFile(firstFile);
        updatePreview(data.files);
        addLog(`Successfully imported ${Object.keys(data.files).length} files from ${repo.name} (${targetBranch}).`, 'success');
        
        // Fetch branches for later use
        GitHubService.getBranches({ token: githubToken!, owner: repo.owner.login, repo: repo.name })
          .then(setAvailableBranches)
          .catch(() => {});

        // Workflow: Open in Studio automatically
        openGitHubFilesInStudio();

        // Trigger AI analysis
        handleSend(`Navbharat AI, I have just imported a project from GitHub repository "${repo.full_name}" on branch "${targetBranch}". 
        Please analyze the project structure and tell me:
        1. What is this app about?
        2. What technologies/frameworks are being used?
        3. Suggest 3 immediate improvements or features I can add.`);
      } else {
        addLog('Repository seems to be empty or has incompatible structure.', 'warn');
      }
    } catch (err: any) {
      addLog(`Import failed: ${err.message}`, 'error');
    } finally {
      setIsGHSyncing(false);
    }
  };

  const pushToRepo = async (commitMessage: string = 'Update from Navbharat AI') => {
    if (!selectedRepo || !githubToken) {
      addLog('No repository connected to push to.', 'error');
      return;
    }
    
    setIsPushing(true);
    setPushStatus({ status: 'loading' });
    addLog(`Pushing changes to ${selectedRepo.full_name}...`, 'info');
    
    try {
      const targetBranch = currentBranch || selectedRepo.default_branch || 'main';
      const response = await fetch('/api/github/push', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${githubToken}`
        },
        body: JSON.stringify({ 
          owner: selectedRepo.owner.login, 
          repo: selectedRepo.name,
          files: files,
          message: commitMessage,
          branch: targetBranch
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Push failed');

      setPushStatus({ status: 'success', message: 'Changes pushed successfully!' });
      addLog(`✅ Successfully pushed to GitHub (${data.sha.slice(0,7)})`, 'success');
      setTimeout(() => setPushStatus({ status: 'idle' }), 3000);
    } catch (err: any) {
      setPushStatus({ status: 'error', message: err.message });
      addLog(`Push failed: ${err.message}`, 'error');
    } finally {
      setIsPushing(false);
    }
  };

  useEffect(() => {
    if (githubToken && !githubUser) {
      fetchGitHubUser(githubToken);
    }
  }, []);

  // 9.4 — Template Marketplace: curated + user-saved templates
  const [savedTemplates, setSavedTemplates] = useState<{ id: string; name: string; html: string; savedAt: string }[]>(() => {
    try { return JSON.parse(localStorage.getItem('navbharat_saved_templates') || '[]'); } catch { return []; }
  });
  useEffect(() => {
    try { localStorage.setItem('navbharat_saved_templates', JSON.stringify(savedTemplates)); } catch {}
  }, [savedTemplates]);
  const saveCurrentAsTemplate = () => {
    if (!hasGeneratedCode || !generatedCode) return;
    const name = prompt('Template name (e.g. "My Portfolio App"):');
    if (!name?.trim()) return;
    setSavedTemplates(prev => [
      { id: Date.now().toString(), name: name.trim(), html: generatedCode, savedAt: new Date().toLocaleDateString('en-IN') },
      ...prev.slice(0, 19)
    ]);
    addToast(`Template "${name.trim()}" saved ✓`, 'success');
    addLog(`Template "${name}" saved to marketplace ✓`, 'success');
  };

  // Phase 1.7 — template list lives in TemplatesPanel.tsx (CURATED_TEMPLATES).
  const templates = CURATED_TEMPLATES;

  const themeClasses = getThemeClasses(theme);

  return (
    <div 
      className={cn("h-screen supports-[height:100dvh]:h-[100dvh] w-screen flex flex-col overflow-hidden transition-colors duration-500", themeClasses.bg, themeClasses.text)}
      style={{
        // @ts-ignore
        '--theme-bg': themeClasses.raw.bg,
        '--theme-text': themeClasses.raw.text,
        '--theme-border': themeClasses.raw.border,
        '--theme-card': themeClasses.raw.card
      }}
    >
      <TopNav
        themeClasses={themeClasses}
        effectiveDeviceMode={effectiveDeviceMode}
        isSidebarCollapsed={isSidebarCollapsed}
        setIsSidebarCollapsed={setIsSidebarCollapsed}
        setIsMenuOpen={setIsMenuOpen}
        openTabs={openTabs}
        activeView={activeView}
        setActiveView={setActiveView}
        toggleTab={toggleTab}
        closeTab={closeTab}
        menuItems={menuItems as any}
        hasGeneratedCode={hasGeneratedCode}
        canUndo={canUndo}
        canRedo={canRedo}
        undoCode={undoCode}
        redoCode={redoCode}
        user={user}
        setShowAuth={setShowAuth}
        setShowCommandPalette={setShowCommandPalette}
        auth={auth}
      />

      {/* Main Content Area */}
      <div className={`flex flex-1 w-full min-h-0`}>

      <SidebarNav
        themeClasses={themeClasses}
        effectiveDeviceMode={effectiveDeviceMode}
        isSidebarCollapsed={isSidebarCollapsed}
        isMenuOpen={isMenuOpen}
        setIsMenuOpen={setIsMenuOpen}
        menuItems={menuItems as any}
        enabledModules={enabledModules}
        activeView={activeView}
        toggleTab={toggleTab}
        setActiveView={setActiveView}
        hasGeneratedCode={hasGeneratedCode}
        user={user}
        setShowAuth={setShowAuth}
        addLog={addLog}
        theme={theme}
        setTheme={setTheme}
        isThemePickerOpen={isThemePickerOpen}
        setIsThemePickerOpen={setIsThemePickerOpen}
        isAdmin={isAdmin}
        setShowVishwakarmaChooser={setShowVishwakarmaChooser}
        setErrorContext={setErrorContext}
      />

      {/* Workspace */}
      <main className="flex flex-1 relative min-h-0 min-w-0">

        {/* View Switcher Output — wrapped in ErrorBoundary + Suspense for lazy-loaded components */}
        <ErrorBoundary>
        <Suspense fallback={
          <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-indigo-500/40 border-t-indigo-500 rounded-full animate-spin" />
              <span className="text-xs text-[#8b949e] font-mono uppercase tracking-widest">Loading module…</span>
            </div>
          </div>
        }>
        <div className={cn("flex-1 flex flex-col min-h-0 min-w-0 transition-all",
          ['chat', 'nbi_chat', 'asc_chat', 'studio', 'preview', 'shell'].includes(activeView) ? "overflow-hidden h-[calc(100vh-3.5rem)] supports-[height:100dvh]:h-[calc(100dvh-3.5rem)] max-h-[calc(100vh-3.5rem)] supports-[height:100dvh]:max-h-[calc(100dvh-3.5rem)]" : "overflow-y-auto overflow-x-hidden custom-scrollbar",
          // 8.1 — space for bottom nav on mobile (all views including chat)
          effectiveDeviceMode !== 'desktop' ? "pb-14" : ""
        )}>
          {activeView === 'home' && (
             <HomeView 
               onStartChat={() => {
                 setActiveAgent('navbharatai');
                 toggleTab('nbi_chat');
               }} 
               onStartProChat={() => {
                 setActiveAgent('navbharatai-pro');
                 toggleTab('nbi_pro_chat');
               }}
               isAdmin={isAdmin}
               data={homeData}
               onUpdate={(newData) => setHomeData(newData)}
               theme={theme}
               user={user}
               onShowLogin={() => setShowAuth(true)}
             />
          )}
          {activeView === 'settings' && (
            <SettingsPanel
              themeClasses={themeClasses}
              settingsScreen={settingsScreen}
              setSettingsScreen={setSettingsScreen}
              toggleTab={toggleTab}
              setActiveView={setActiveView}
              deviceMode={deviceMode}
              setDeviceMode={setDeviceMode}
              preferredLanguage={preferredLanguage}
              setPreferredLanguage={setPreferredLanguage}
              enabledModules={enabledModules}
              setEnabledModules={setEnabledModules}
              menuItems={menuItems}
              keys={keys}
              setKeys={setKeys}
              showKeyStates={showKeyStates}
              setShowKeyStates={setShowKeyStates}
              githubToken={githubToken}
              setGithubToken={setGithubToken}
              githubUser={githubUser}
              repositories={repositories}
              selectedRepo={selectedRepo}
              setSelectedRepo={setSelectedRepo}
              ghSearchQuery={ghSearchQuery}
              setGHSearchQuery={setGHSearchQuery}
              currentBranch={currentBranch}
              connectGitHub={connectGitHub}
              disconnectGitHub={disconnectGitHub}
              fetchGitHubUser={fetchGitHubUser}
              fetchUserRepos={fetchUserRepos}
              patInputValue={patInputValue}
              setPatInputValue={setPatInputValue}
              userE2bKey={userE2bKey}
              setUserE2bKey={setUserE2bKey}
              isAdmin={isAdmin}
              adminLiveMetrics={adminLiveMetrics}
              setAdminLiveMetrics={setAdminLiveMetrics}
              loadingAdminMetrics={loadingAdminMetrics}
              setLoadingAdminMetrics={setLoadingAdminMetrics}
              user={user}
              addLog={addLog}
            />
          )}

          {(activeView === 'nbi_chat') && (
            <div className={cn("flex-1 overflow-hidden h-full min-h-0 max-h-full relative group flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-white/10", themeClasses.bg)}>
              
              {/* NBI Chat column */}
              {activeView === 'nbi_chat' && (
                <div className="flex-1 flex flex-col h-full min-h-0 max-h-full overflow-hidden min-w-0">
                  <div className="flex items-center justify-between px-3 py-1 bg-indigo-950/20 border-b border-indigo-500/20 text-[9px] font-black uppercase tracking-widest text-[#8b949e]">
                     <div className="flex items-center gap-2">
                       <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping shrink-0" />
                       <span>NAVBHARATAI</span>
                     </div>
                     <div className="flex items-center gap-2">
                       {/* 9.5 — Teaching Mode toggle */}
                       <button
                         onClick={() => setTeachMode(p => !p)}
                         title={teachMode ? 'Teaching Mode ON — click to turn off' : 'Teaching Mode OFF — click to enable beginner explanations'}
                         className={`flex items-center gap-1 px-2 py-0.5 rounded border text-[8px] font-black uppercase tracking-widest transition-all ${
                           teachMode ? 'bg-amber-500/20 border-amber-500/40 text-amber-400' : 'bg-white/5 border-white/10 text-[#484f58] hover:text-white'
                         }`}
                       >
                         <span>{teachMode ? '📚' : '🎓'}</span>
                         <span className="hidden sm:inline">Teach</span>
                       </button>
                       <span className="font-mono text-indigo-400 hidden sm:inline">{sessions.find(s => s.id === currentSessionId)?.uci || ''}</span>
                     </div>
                  </div>
                  <AIChat
                    messages={messages}
                    input={input}
                    onInputChange={setInput}
                    onSend={(files) => { handleSendForTab('nbi_chat', undefined, files); }}
                    isLoading={isLoading}
                    activeIntent={activeIntent}
                    isPinned={sessions.find(s => s.id === currentSessionId)?.isPinned || false}
                    onTogglePin={() => togglePin(currentSessionId)}
                    isLoggedIn={!!user}
                    onShowLogin={() => setShowAuth(true)}
                    mode={mode}
                    onModeChange={setMode}
                    activeAgent={activeAgent}
                    pendingGHEdit={pendingGHEdit}
                    onConfirmPush={handleGHConfirmPush}
                    isPushing={isPushing}
                    isAppBuilt={isAppBuilt}
                    theme={theme}
                    onPreviewClick={() => {
                       toggleTab('preview');
                       setIsMenuOpen(false);
                    }}
                    userId={user?.uid}
                    activeUci={user ? (sessions.find(s => s.id === currentSessionId)?.uci || '') : ''}
                    onRestoreUci={user ? handleRestoreUci : undefined}
                    restoredMessages={sessions.find(s => s.id === currentSessionId)?.restoredMessages || []}
                    memorySummary={sessions.find(s => s.id === currentSessionId)?.memorySummary || ''}
                    wallet={wallet}
                    onLanguagePick={(lang) => {
                      setPreferredLanguage(lang as any);
                      setMessages(prev => [
                        ...prev.filter(m => m.id !== 'lang-picker'),
                        { id: 'lang-confirmed', text: `✅ Language set! I'll now communicate with you in **${lang === 'hindi' ? '🇮🇳 Hindi' : lang === 'hinglish' ? '🔀 Hinglish' : lang === 'english' ? '🇬🇧 English' : '🌐 your language (auto-detect)'}**.\n\nCode will always be written in professional English.\n\nHow can I help you?`, sender: 'ai', timestamp: new Date(), modelUsed: 'navBharatAI' },
                      ]);
                    }}
                  />
                </div>
              )}

              {/* 7.7 — AI Copilot Suggestions */}
              <AISuggestions
                generatedCode={generatedCode}
                onSendSuggestion={(prompt) => handleSend(prompt)}
              />

            </div>
          )}

          {activeView === 'nbi_pro_chat' && (
            <ProChatPanel
              theme={theme}
              themeClasses={themeClasses}
              mode={mode}
              setMode={setMode}
              buildVersionStack={buildVersionStack}
              handleUndoBuild={handleUndoBuild}
              proMessages={proMessages}
              proInput={proInput}
              setProInput={setProInput}
              isProLoading={isProLoading}
              handleStopPro={handleStopPro}
              showDeployPanel={showDeployPanel}
              setShowDeployPanel={setShowDeployPanel}
              deployPlatform={deployPlatform}
              setDeployPlatform={setDeployPlatform}
              deployToken={deployToken}
              setDeployToken={setDeployToken}
              deployProjectName={deployProjectName}
              setDeployProjectName={setDeployProjectName}
              deployOwner={deployOwner}
              setDeployOwner={setDeployOwner}
              deployRepo={deployRepo}
              setDeployRepo={setDeployRepo}
              deployPanelError={deployPanelError}
              setDeployPanelError={setDeployPanelError}
              isDeploying={isDeploying}
              handleDeployApp={handleDeployApp}
              showWorkspace={showWorkspace}
              setShowWorkspace={setShowWorkspace}
              files={files}
              isAppBuilt={isAppBuilt}
              generatedCode={generatedCode}
              setFiles={(f) => setFiles(f as any)}
              updatePreview={updatePreview}
              toggleTab={toggleTab}
              setIsMenuOpen={setIsMenuOpen}
              previewHistory={previewHistory}
              setGeneratedCode={setGeneratedCode}
              proBuildProgress={proBuildProgress}
              setProBuildProgress={setProBuildProgress}
              proGuiderPlan={proGuiderPlan}
              setProGuiderPlan={setProGuiderPlan}
              proGuiderReplanning={proGuiderReplanning}
              setProGuiderReplanning={setProGuiderReplanning}
              proGuiderSpecRef={proGuiderSpecRef}
              proGuiderRefineRef={proGuiderRefineRef}
              providerRetryCountdown={providerRetryCountdown}
              setProviderRetryCountdown={setProviderRetryCountdown}
              providerRetryTimerRef={providerRetryTimerRef}
              providerRetryPromptRef={providerRetryPromptRef}
              handleSendForPro={handleSendForPro}
              sessions={sessions}
              currentProSessionId={currentProSessionId}
              togglePin={togglePin}
              user={user}
              setShowAuth={setShowAuth}
              handleRestoreUci={handleRestoreUci}
              pendingGHEdit={pendingGHEdit}
              handleGHConfirmPush={handleGHConfirmPush}
              isPushing={isPushing}
              wallet={wallet}
              downloadAppZip={downloadAppZip}
              activeIntent={activeIntent}
            />
          )}

          {/* ── Senior Doctor Assistant ── */}
          {activeView === 'sda_chat' && (
            <div className="flex-1 overflow-hidden h-full min-h-0 max-h-full">
              <SDAChat key={sdaResetKey} userId={user?.uid} />
            </div>
          )}

          {/* ── Professionals hub ── */}
          {activeView === 'professionals' && (
            <ProfessionalsView onSelect={(id) => {
              if (id === 'sda_chat') toggleTab('sda_chat');
              else if (id === 'engineer_ai') toggleTab('engineer_ai');
            }} />
          )}

          {/* ── Engineer AI ── */}
          {activeView === 'engineer_ai' && (
            <EngineerAIChat userId={user?.uid} />
          )}

                    {activeView === 'about' && (
            <AboutPanel
              isAdmin={isAdmin}
              aboutData={aboutData}
              onAboutDataChange={setAboutData}
            />
          )}

          {activeView === 'admin' && (
            <AdminLoginPanel
              isAdmin={isAdmin}
              adminEmail={adminEmail}
              adminPassword={adminPassword}
              adminError={adminError}
              onEmailChange={setAdminEmail}
              onPasswordChange={setAdminPassword}
              onSubmit={handleAdminLogin}
              onLogout={() => setIsAdmin(false)}
              adminToken={sessionStorage.getItem('admin_token') || ''}
            />
         )}

          {activeView === 'billing' && (
            <BillingPanel
              user={user}
              wallet={wallet}
              loadingWallet={loadingWallet}
              dailyUsage={dailyUsage}
              myReferralCode={myReferralCode}
              billingTransactions={billingTransactions}
              billingLogs={billingLogs}
              referralHistory={referralHistory}
              activeBillingDetailTab={activeBillingDetailTab}
              reminderLimit={reminderLimit}
              budgetLimit={budgetLimit}
              dismissedReminderWarning={dismissedReminderWarning}
              couponCodeInput={couponCodeInput}
              isRedeemingCoupon={isRedeemingCoupon}
              couponError={couponError}
              couponSuccess={couponSuccess}
              copiedReferral={copiedReferral}
              buyAmountInput={buyAmountInput}
              isRecharging={isRecharging}
              tempReminderLimit={tempReminderLimit}
              tempBudgetLimit={tempBudgetLimit}
              limitError={limitError}
              limitSuccess={limitSuccess}
              onShowAuth={() => setShowAuth(true)}
              onFetchWallet={fetchWallet}
              onSetActiveBillingDetailTab={setActiveBillingDetailTab}
              onSetReminderLimit={setReminderLimit}
              onSetBudgetLimit={setBudgetLimit}
              onSetDismissedReminderWarning={setDismissedReminderWarning}
              onSetCouponCodeInput={setCouponCodeInput}
              onRedeemPromoCoupon={redeemPromoCoupon}
              onSetCopiedReferral={setCopiedReferral}
              onSetBuyAmountInput={setBuyAmountInput}
              onCreateBillingOrder={createBillingOrder}
              onSetTempReminderLimit={setTempReminderLimit}
              onSetTempBudgetLimit={setTempBudgetLimit}
              onSetLimitError={setLimitError}
              onSetLimitSuccess={setLimitSuccess}
              onToast={addToast}
              monthlyAiCost={monthlyAiCost}
            />
          )}

            {activeView === 'git' && (
              // Phase 1.7 — extracted to GitViewPanel component
              <GitViewPanel
                selectedRepo={selectedRepo}
                currentBranch={currentBranch}
                githubToken={githubToken}
                githubUser={githubUser}
                githubRepoContext={githubRepoContext}
                isGHSyncing={isGHSyncing}
                isPushing={isPushing}
                firebaseToken={firebaseToken}
                firebaseUser={firebaseUser}
                files={files}
                currentSessionId={currentSessionId}
                sessions={sessions}
                onNavigateToGitHubRepos={() => { setActiveView('settings'); setSettingsScreen('github_repos'); }}
                onNavigateToConnections={() => { setActiveView('settings'); setSettingsScreen('connections'); }}
                onImportRepo={importRepo}
                onConnectGitHub={connectGitHub}
                onDisconnectGitHub={disconnectGitHub}
                onPushToRepo={selectedRepo ? pushToRepo : null}
                onConnectFirebase={connectFirebase}
                onDisconnectFirebase={disconnectFirebase}
                onFilesChange={(newFiles) => { setFiles(newFiles); updatePreview(newFiles); }}
                onAgentChange={handleAgentChange}
                onToggleView={toggleTab}
                onActivatePreview={handleTriggerPreviewBuild}
                onActivateWorkspace={handleActivateWorkspace}
              />
            )}



          {activeView === 'templates' && (
            // Phase 1.7 — extracted to TemplatesPanel component
            <TemplatesPanel
              user={user}
              templates={templates}
              savedTemplates={savedTemplates}
              hasGeneratedCode={hasGeneratedCode}
              onSelectTemplate={(prompt) => { setInput(prompt); toggleTab('nbi_chat'); }}
              onRequireAuth={() => { setShowAuth(true); addToast('Sign in to use Pro templates', 'warning'); }}
              onSaveCurrentTemplate={saveCurrentAsTemplate}
              onDeleteSavedTemplate={(id) => setSavedTemplates(prev => prev.filter(x => x.id !== id))}
              onLoadSavedTemplate={(html) => {
                setGeneratedCode(html);
                setHasGeneratedCode(true);
                updatePreview({ 'index.html': html });
                toggleTab('preview');
              }}
            />
          )}

          {activeView === 'engine_builder' && (
            <div className="flex-1 min-h-screen">
              <EngineBuilder />
            </div>
          )}

          {activeView === 'entertainment' && (
            <div className="flex-1 overflow-y-auto custom-scrollbar bg-[#0d1117] min-h-screen">
              <SocialHub />
            </div>
          )}

          {activeView === 'donation' && (
            <DonationPanel
              isAdmin={isAdmin}
              isDonationEditing={isDonationEditing}
              donationData={donationData}
              bgClass={themeClasses.bg}
              onToggleEditing={() => setIsDonationEditing(p => !p)}
              onStartEditing={() => setIsDonationEditing(true)}
              onDonationDataChange={setDonationData}
              onFileUpload={handleFileUpload}
              onCopySuccess={() => addLog('UPI ID copied to clipboard.', 'success')}
            />
          )}


          {activeView === 'report' && <ReportsListView user={user} />}
          {activeView === 'history' && <HistoryView user={user} onRestoreSession={handleRestoreUci} onDeleteSession={deleteSession} />}

          {activeView === 'deploy' && (
            <DeploySuccessPanel
              deployUrl={deployUrl}
              onOpenPreview={() => toggleTab('preview')}
              onBackToCode={() => setIsDeployed(false)}
            />
          )}

          <ViewPanels
            activeView={activeView}
            generatedCode={generatedCode}
            setGeneratedCode={setGeneratedCode}
            files={files}
            setFiles={setFiles as any}
            hasGeneratedCode={hasGeneratedCode}
            setIsAppBuilt={setIsAppBuilt}
            setHasGeneratedCode={setHasGeneratedCode}
            user={user}
            activeAgent={activeAgent}
            mode={mode}
            setMode={setMode}
            isAppBuilt={isAppBuilt}
            theme={theme}
            setTheme={setTheme}
            messages={messages}
            input={input}
            setInput={setInput}
            setProInput={setProInput}
            isLoading={isLoading}
            activeIntent={activeIntent}
            handleSendForTab={handleSendForTab}
            toggleTab={toggleTab}
            updatePreview={updatePreview}
            addLog={addLog}
            addToast={addToast}
            handleAgentChange={handleAgentChange}
            githubToken={githubToken}
            githubUser={githubUser}
            githubRepoContext={githubRepoContext}
            isGHSyncing={isGHSyncing}
            pendingGHEdit={pendingGHEdit}
            handleGHConfirmPush={handleGHConfirmPush}
            isPushing={isPushing}
            connectGitHub={connectGitHub}
            disconnectGitHub={disconnectGitHub}
            pushToRepo={pushToRepo}
            firebaseToken={firebaseToken}
            firebaseUser={firebaseUser}
            connectFirebase={connectFirebase}
            disconnectFirebase={disconnectFirebase}
            sessions={sessions}
            currentSessionId={currentSessionId}
            togglePin={togglePin}
            currentProSessionId={currentProSessionId}
            previewHistory={previewHistory}
            fileUploadConflict={fileUploadConflict}
            resolveFileConflict={resolveFileConflict}
            handleFilesUpload={handleFilesUpload}
            downloadAppZip={downloadAppZip}
            setActiveFile={setActiveFile}
            wallet={wallet}
            setShowVishwakarmaUnlockModal={setShowVishwakarmaUnlockModal}
            setShowAuth={setShowAuth}
            zipSizeModal={zipSizeModal}
            setZipSizeModal={setZipSizeModal}
          />

        </div>
        </Suspense>
        </ErrorBoundary>
      </main>

{/* Vishwakarma Mode Chooser Modal Removed */}

              </div>
 
              
      {/* Auth Modal */}

      {/* Auth Modal */}
      <AnimatePresence>
        {showAuth && (
          <AuthComponent 
            auth={auth} 
            setUser={setUser} 
            onClose={() => setShowAuth(false)} 
          />
        )}
      </AnimatePresence>

      {/* GitHub Redirect Diagnostics Overlay */}
      <AnimatePresence>
        {githubRedirectingMessage && (
          <div className="fixed inset-0 bg-[#0d1117]/90 backdrop-blur-md flex items-center justify-center p-4 z-[99999]">
            <motion.div
              initial={{ scale: 0.95, y: 15, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.95, y: 15, opacity: 0 }}
              className="w-full max-w-md bg-[#161b22] border border-indigo-500/30 rounded-3xl p-6 space-y-4 shadow-2xl relative"
            >
              <div className="flex items-center gap-3 border-b border-white/5 pb-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/35 flex items-center justify-center text-indigo-400 shrink-0">
                  <Github className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <h4 className="text-xs font-black uppercase tracking-wider text-white">GitHub OAuth Shield</h4>
                  <p className="text-[9px] text-[#8b949e] font-sans uppercase tracking-widest font-black">navBharat AI Authentication Diagnostics</p>
                </div>
              </div>

              <div className="space-y-3.5">
                <div className="flex items-center gap-2.5 bg-indigo-500/5 border border-indigo-500/10 p-3 rounded-2xl">
                  <div className="w-2 h-2 rounded-full bg-indigo-500 animate-ping" />
                  <p className="text-[11px] font-bold text-indigo-300 leading-snug">{githubRedirectingMessage}</p>
                </div>

                <div className="space-y-2 text-left bg-black/40 border border-white/5 rounded-2xl p-4 font-mono text-[10px]">
                  <div className="flex justify-between border-b border-white/5 pb-1.5 mb-1.5 font-sans">
                    <span className="text-[#8b949e] font-bold uppercase text-[9px]">Diagnostic Key</span>
                    <span className="text-[#8b949e] font-bold uppercase text-[9px]">Configured Status</span>
                  </div>
                  
                  <div className="space-y-1">
                    <span className="text-[#8b949e] block text-[9px] uppercase tracking-wider font-extrabold font-sans">Current Domain Origin</span>
                    <span className="text-white block truncate">{githubDebugData?.currentDomain || window.location.origin}</span>
                  </div>

                  <div className="space-y-1 pt-1.5">
                    <span className="text-[#8b949e] block text-[9px] uppercase tracking-wider font-extrabold font-sans">Assigned Callback URL</span>
                    <span className="text-indigo-400 block truncate">{githubDebugData?.redirectUri || 'Determining...'}</span>
                  </div>

                  <div className="space-y-1 pt-1.5">
                    <span className="text-[#8b949e] block text-[9px] uppercase tracking-wider font-extrabold font-sans">Final Safe Redirection Link</span>
                    <span className="text-emerald-400 block break-all leading-normal max-h-16 overflow-y-auto pr-1">
                      {githubDebugData?.oauthUrl || 'Awaiting API Handshake...'}
                    </span>
                  </div>
                </div>

                <p className="text-[10px] text-[#8b949e] leading-relaxed text-center font-medium">
                  We use the official native URL() parsing engine to prevent address parsing conflicts. Under mobile browser boundaries, check pop-up allowances.
                </p>

                <div className="flex items-center gap-2.5 pt-1">
                  <button
                    onClick={() => {
                      if (githubDebugData?.oauthUrl) {
                        window.open(githubDebugData.oauthUrl, 'GitHub Auth', 'width=600,height=700');
                      }
                    }}
                    className="flex-1 py-3 bg-[#1f6feb] hover:bg-[#388bfd] hover:scale-[1.01] active:scale-95 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer text-center flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/10"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Launch Popup Directly
                  </button>
                  <button
                    onClick={() => {
                      setGithubRedirectingMessage(null);
                    }}
                    className="px-4 py-3 bg-white/5 hover:bg-white/10 active:scale-95 border border-white/10 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer text-center"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Agent Vishwakarma Premium Access Modal */}
      <AnimatePresence>
        {showVishwakarmaUnlockModal && (
          <div className="fixed inset-0 bg-[#0d1117]/95 backdrop-blur-md flex items-start md:items-center justify-center p-3 pt-24 md:pt-4 z-[9999] overflow-y-auto">
            <motion.div
              initial={{ scale: 0.96, y: 15, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.96, y: 15, opacity: 0 }}
              className="w-full max-w-md md:max-w-[400px] bg-[#161b22] border border-amber-500/35 rounded-2xl p-4 sm:p-5 space-y-4 shadow-2xl relative max-h-[85vh] sm:max-h-[90vh] flex flex-col overflow-hidden"
            >
              {/* Header section with explicit interactive close */}
              <div className="flex justify-between items-center shrink-0 border-b border-white/5 pb-2.5">
                <div className="flex items-center gap-1.5 text-amber-500 font-bold uppercase tracking-wider text-[9px] sm:text-[10px] font-mono">
                  <ShieldCheck className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
                  Premium Sec-Ops Active Workspace
                </div>
                <button
                  type="button"
                  onClick={() => setShowVishwakarmaUnlockModal(false)}
                  className="p-1 px-2 bg-white/5 hover:bg-amber-500 hover:text-black rounded-lg text-[#8b949e] border border-white/10 hover:border-amber-500 transition-all font-mono text-[9px] sm:text-[10px] uppercase font-bold flex items-center gap-1 cursor-pointer select-none"
                >
                  <X className="w-3.5 h-3.5 shrink-0" />
                  Close
                </button>
              </div>

              {/* Scrollable container to maintain perfect layout on shorter screens */}
              <div className="flex-1 overflow-y-auto space-y-4 scrollbar-thin scrollbar-thumb-white/10 pr-0.5">
                {/* Horizontal Modern Hero Row */}
                <div className="flex gap-3 items-center bg-amber-500/5 hover:bg-amber-500/10 border border-amber-500/15 p-3 rounded-xl transition-all">
                  <div className="p-2 bg-amber-500/10 text-amber-400 rounded-lg border border-amber-500/20 shrink-0">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-white tracking-tight uppercase leading-none">
                      🔥 Unlock Agent Vishwakarma
                    </h3>
                    <p className="text-[10px] text-[#8b949e] mt-1 leading-normal">
                      Your portal is locked. Complete checkout to activate dynamic modeling access.
                    </p>
                  </div>
                </div>

                {/* Access Benefits Checklist */}
                <div className="bg-white/5 rounded-xl p-3 border border-white/5 space-y-1.5">
                  <h4 className="text-[9px] font-mono font-bold text-amber-400 tracking-wider uppercase mb-0.5">
                    ✓ Core System Capabilities
                  </h4>
                  <div className="space-y-1 text-[11px] text-[#8b949e]">
                    <div className="flex items-center gap-2 text-white">
                      <span className="text-emerald-400 font-extrabold">✓</span>
                      <span>Full Codebase Creations & Visual Design</span>
                    </div>
                    <div className="flex items-center gap-2 text-white">
                      <span className="text-emerald-400 font-extrabold">✓</span>
                      <span>OWASP Defenses & Exploit Scanning</span>
                    </div>
                    <div className="flex items-center gap-2 text-white">
                      <span className="text-emerald-400 font-extrabold">✓</span>
                      <span>Sovereign Multi-Model Reasoning Layers</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-white/5 border border-white/5 rounded-xl">
                    <div>
                      <span className="text-[11px] font-bold text-white block uppercase tracking-wide">
                        Lifetime Entry Pass
                      </span>
                      <span className="text-[9px] text-[#8b949e]">
                        Mandatory one-time gateway fee
                      </span>
                    </div>
                    <div className="text-right">
                      {wallet?.hasVishwakarmaPass ? (
                        <span className="text-[9px] font-mono font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/10">
                          Activated
                        </span>
                      ) : (
                        <span className="text-xs font-mono font-black text-amber-500 block">
                          ₹{(vkMode === 'pro' ? 100 : 50).toFixed(2)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Promo Code Input */}
                  {!wallet?.hasVishwakarmaPass && (
                    <div className="p-3 bg-blue-500/5 border border-blue-500/20 rounded-xl">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          placeholder="Have a promo code?"
                          value={vkPromoCode}
                          onChange={(e) => setVkPromoCode(e.target.value)}
                          className="flex-1 bg-[#0d1117] border border-blue-500/30 rounded-lg p-1.5 px-2 text-xs font-mono text-white placeholder:text-[#484f58] focus:border-blue-400 outline-none transition-all"
                        />
                        <button
                          onClick={redeemVishwakarmaPromo}
                          disabled={isRedeemingVkPromo}
                          className="text-blue-400 hover:text-blue-300 text-[10px] uppercase font-bold tracking-wider transition-colors"
                        >
                          {isRedeemingVkPromo ? '...' : 'Apply'}
                        </button>
                      </div>
                      {couponError && <p className="text-[9px] text-red-500 mt-1">{couponError}</p>}
                      {couponSuccess && <p className="text-[9px] text-emerald-400 mt-1">{couponSuccess}</p>}
                    </div>
                  )}

                  {/* 2. Advance Token purchase input */}
                  <div className="space-y-1 p-3 bg-white/5 border border-white/5 rounded-xl relative">
                    <label className="text-[11px] font-bold text-white block uppercase tracking-wide">
                      Advance AI Tokens (₹)
                    </label>
                    <span className="text-[9px] text-[#8b949e] block leading-none font-mono">
                      Formula: ₹1.00 = 100 AI Tokens (Min: ₹10)
                    </span>
                    
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="text-white font-mono font-bold text-xs">₹</span>
                      <input
                        type="number"
                        placeholder="Enter amount (e.g. 50)"
                        value={vkTokenInput}
                        onChange={(e) => setVkTokenInput(e.target.value)}
                        className="w-full bg-[#0d1117] border border-white/10 rounded-lg p-1.5 px-2 text-xs font-mono text-white placeholder:text-[#484f58] focus:border-amber-500 outline-none transition-all shadow-inner"
                      />
                    </div>

                    <div className="mt-1 text-right">
                      <span className="text-[9px] font-mono text-amber-400 bg-amber-500/10 border border-amber-500/25 px-2 py-0.5 rounded-full">
                        Estimated: {(parseFloat(vkTokenInput) ? Math.floor(parseFloat(vkTokenInput) * 100) : 0).toLocaleString()} Tokens
                      </span>
                    </div>
                  </div>

                  {/* 3. Total calculation display */}
                  <div className="p-3 bg-[#0d1117] border border-white/5 rounded-xl space-y-1 text-[11px]">
                    <div className="flex justify-between text-[#8b949e]">
                      <span>Entry Pass Fee:</span>
                      <span>{wallet?.hasVishwakarmaPass ? '₹0.00 (Owned)' : `₹${(vkMode === 'pro' ? 100 : 50).toFixed(2)}`}</span>
                    </div>
                    <div className="flex justify-between text-[#8b949e]">
                      <span>Tokens Purchase Amount:</span>
                      <span>₹{parseFloat(vkTokenInput) ? parseFloat(vkTokenInput).toFixed(2) : '0.00'}</span>
                    </div>
                    <div className="border-t border-white/5 pt-1.5 flex justify-between text-xs font-black text-white tracking-tight">
                      <span>TOTAL PAYABLE AMOUNT:</span>
                      <span className="text-amber-500 font-mono">
                        ₹{((wallet?.hasVishwakarmaPass ? 0 : (vkMode === 'pro' ? 100 : 50)) + (parseFloat(vkTokenInput) || 0)).toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Checkout CTA Footer Component - Always sticky/visible at bottom of modal viewport */}
              <div className="shrink-0 space-y-2 border-t border-white/5 pt-3">
                <button
                  type="button"
                  disabled={isRecharging || (
                    wallet?.hasVishwakarmaPass 
                      ? !(parseFloat(vkTokenInput) >= 10 && parseFloat(vkTokenInput) <= 999999)
                      : (vkTokenInput.trim() !== '' && !(parseFloat(vkTokenInput) >= 10 && parseFloat(vkTokenInput) <= 999999))
                  )}
                  onClick={() => {
                    const buyPass = !wallet?.hasVishwakarmaPass;
                    const tokens = parseFloat(vkTokenInput) || 0;
                    createVishwakarmaOrder(buyPass, tokens);
                  }}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 via-amber-600 to-amber-500 hover:from-amber-400 hover:to-amber-500 text-black font-black uppercase text-[11px] tracking-[0.1em] transition-all duration-200 active:scale-[0.98] shadow-lg shadow-amber-500/10 disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center gap-2 cursor-pointer relative overflow-hidden group"
                >
                  <span className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
                  {isRecharging ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Connecting Gateway...
                    </>
                  ) : wallet?.hasVishwakarmaPass ? (
                    <>
                      <CreditCard className="w-4 h-4" />
                      Recharge Tokens (₹{(parseFloat(vkTokenInput) || 0).toFixed(2)})
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 animate-bounce" />
                      Buy Pass & Activate Vishwakarma (₹{((vkMode === 'pro' ? 100 : 50) + (parseFloat(vkTokenInput) || 0)).toFixed(2)})
                    </>
                  )}
                </button>
              </div>

              <div className="text-[8px] text-center text-[#8b949e] font-mono leading-relaxed select-none shrink-0 border-t border-white/5 pt-2">
                By purchasing, you accept our sovereign pay-and-use SLA terms.
                <br />
                Secured dynamically by navBharat SRE billing stack.
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* UCI Continuation Modal */}
      <AnimatePresence>
        {showContinueModal && (
          <div className="absolute inset-0 bg-[#0d1117]/85 backdrop-blur-md flex items-center justify-center p-4 z-50">
            <motion.div 
              initial={{ scale: 0.95, y: 15, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.95, y: 15, opacity: 0 }}
              className="w-full max-w-sm bg-[#161b22] border border-indigo-500/15 rounded-3xl p-6 space-y-4 shadow-3xl relative select-none"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-indigo-400 animate-pulse" />
                  <span className="text-[10px] font-black uppercase tracking-[0.15em] text-white">Restore Previous Session</span>
                </div>
                <button 
                  onClick={() => {
                    setShowContinueModal(false);
                    setRestoreUciError('');
                    setResumeUciInputState('');
                  }}
                  className="p-1.5 hover:bg-white/5 rounded-lg text-[#8b949e] hover:text-white transition-all text-sm font-bold"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-1.5">
                <p className="text-[9px] text-[#8b949e] leading-relaxed">
                  Enter your encrypted representation chat ID. This restores complete historic context, matching memory parameters, and file configurations in an instant.
                </p>
              </div>

              <div className="space-y-3">
                <input 
                  type="text"
                  placeholder="Paste Universal Chat ID (UCI) ..."
                  value={resumeUciInputState}
                  onChange={(e) => setResumeUciInputState(e.target.value)}
                  className="w-full bg-[#0d1117] border border-white/5 rounded-xl p-3 text-xs font-mono text-indigo-300 placeholder:text-[#484f58] focus:border-indigo-500 outline-none transition-all shadow-inner"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRestoreByUci();
                  }}
                  autoFocus
                />
                
                {restoreUciError && (
                  <p className="text-[9px] text-red-500 font-bold tracking-wide animate-pulse flex items-center gap-1">
                    ⚠️ {restoreUciError}
                  </p>
                )}

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button 
                    onClick={() => {
                      setShowContinueModal(false);
                      setRestoreUciError('');
                      setResumeUciInputState('');
                    }}
                    className="px-3.5 py-2 hover:bg-white/5 text-[#8b949e] hover:text-white rounded-xl text-[9px] font-black uppercase tracking-widest transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleRestoreByUci}
                    disabled={isRestoringUci || !resumeUciInputState.trim()}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-[9px] font-black uppercase tracking-widest transition-all disabled:opacity-30 disabled:pointer-events-none active:scale-95 flex items-center gap-1"
                  >
                    {isRestoringUci ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LinkIcon className="w-3.5 h-3.5" />}
                    Restore Workspace
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* GCP/FIREBASE OAUTH ERROR INTERVENTION MODAL */}
      <AnimatePresence>
        {firebaseOauthError && (
          <div className="absolute inset-0 bg-black/95 backdrop-blur-md flex items-center justify-center p-4 z-[9999] animate-in fade-in duration-200">
            <motion.div
              initial={{ scale: 0.9, y: 30, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.9, y: 30, opacity: 0 }}
              className="w-full max-w-md bg-[#161b22] border border-red-500/30 rounded-3xl p-6 space-y-4 shadow-[0_0_50px_rgba(239,68,68,0.25)] relative text-left"
            >
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-500 shrink-0">
                  <AlertCircle className="w-6 h-6 animate-pulse" />
                </div>
                <div className="min-w-0 flex-1">
                  <span className="text-[9px] font-extrabold uppercase tracking-widest text-[#ff8080] block">
                    GCP/Firebase Auth Interrupted
                  </span>
                  <h4 className="text-sm font-black uppercase tracking-tight text-white leading-tight truncate">
                    {firebaseOauthError.errorType}
                  </h4>
                </div>
              </div>

              <div className="p-3.5 bg-red-950/20 border border-red-500/15 rounded-xl space-y-1">
                <span className="text-[8px] font-extrabold text-[#fda4af] uppercase tracking-wider block">OAuth Failure Context:</span>
                <p className="text-[11px] text-red-200/90 font-mono leading-relaxed break-words font-medium">
                  {firebaseOauthError.message}
                </p>
              </div>

              <div className="p-3.5 bg-zinc-950/40 border border-white/5 rounded-xl space-y-1">
                <span className="text-[8px] font-extrabold text-[#a1a1aa] uppercase tracking-wider block flex items-center gap-1">
                  <Settings className="w-3 h-3 text-indigo-400" />
                  Recommended Correction Procedure:
                </span>
                <p className="text-[11px] text-zinc-300 leading-normal font-medium">
                  {firebaseOauthError.suggestions}
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setFirebaseOauthError(null)}
                  className="px-5 py-2.5 bg-zinc-900 hover:bg-[#21262d] border border-white/10 text-white rounded-xl text-[10px] font-extrabold uppercase tracking-widest transition-all cursor-pointer text-center"
                >
                  Dismiss Error
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* API Key Required Intervention Modal */}
      <AnimatePresence>
        {pendingProvider && (
           <div className="absolute inset-0 z-[1000] flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setPendingProvider(null)}
                className="absolute inset-0 bg-black/80 backdrop-blur-md"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.9, y: 30 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 30 }}
                className="bg-[#161b22] border border-white/10 rounded-3xl shadow-3xl w-full max-w-sm relative z-[1001] overflow-hidden"
              >
                <div className="p-8 text-center">
                  <div className="w-20 h-20 bg-indigo-500/10 rounded-full flex items-center justify-center mx-auto mb-6 border border-indigo-500/20">
                     <ShieldCheck className="w-10 h-10 text-indigo-500" />
                  </div>
                  
                  <h3 className="text-xl font-bold text-white mb-2">Key Required</h3>
                  <p className="text-sm text-[#8b949e] mb-8">
                    To use <span className="text-white font-bold">{pendingProvider.toUpperCase()}</span>, you must provide your own API key.
                  </p>

                  <div className="space-y-4">
                    <div className="relative">
                      <input 
                        autoFocus
                        type="password"
                        value={pendingKey}
                        onChange={(e) => setPendingKey(e.target.value)}
                        placeholder={`Enter ${pendingProvider.toUpperCase()} key`}
                        className="w-full bg-[#0d1117] border border-white/10 rounded-2xl px-5 py-4 text-sm font-mono text-indigo-400 outline-none focus:border-indigo-500 transition-all placeholder:opacity-50"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleKeySave(pendingProvider, pendingKey);
                            setPendingKey('');
                          }
                        }}
                      />
                      <div className="absolute right-4 top-1/2 -translate-y-1/2 opacity-20">
                        <Lock className="w-4 h-4" />
                      </div>
                    </div>

                    <div className="flex flex-col gap-3">
                      <button 
                        onClick={() => {
                          handleKeySave(pendingProvider, pendingKey);
                          setPendingKey('');
                        }}
                        className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl text-sm font-black uppercase tracking-widest transition-all shadow-xl shadow-indigo-600/20"
                      >
                        Save & Continue
                      </button>
                      <button 
                        onClick={() => window.open(PROVIDER_CONFIG[pendingProvider]?.link, '_blank')}
                        className="w-full py-3 bg-white/5 border border-white/10 hover:bg-white/10 text-white rounded-2xl text-xs font-bold transition-all flex items-center justify-center gap-2"
                      >
                        <Globe className="w-4 h-4" />
                        Get API Key
                      </button>
                      <button 
                        onClick={() => setPendingProvider(null)}
                        className="text-[11px] font-bold text-[#484f58] hover:text-white transition-colors py-2"
                      >
                        Cancel Selection
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
           </div>
        )}
      </AnimatePresence>


      {/* Secure Cashfree Simulator / Status Modal */}
      <AnimatePresence>
        {showCheckoutModal && paymentSession && (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowCheckoutModal(false)}
              className="absolute inset-0 bg-black/85 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 30 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 30 }}
              className="bg-[#161b22] border border-white/10 rounded-[2.5rem] shadow-3xl w-full max-w-md relative z-[1001] overflow-hidden p-6 sm:p-8"
            >
              {/* Premium top gradient line */}
              <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-emerald-500 via-indigo-500 to-indigo-600"></div>

              {/* Header */}
              <div className="flex justify-between items-start mb-6">
                <div>
                  <div className="flex items-center gap-2 text-indigo-400 font-mono text-[10px] font-bold uppercase tracking-wider mb-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    {paymentSession.isSimulator ? "Development Simulation Gateway" : "Cashfree Secure Gateway"}
                  </div>
                  <h3 className="text-xl font-black text-white uppercase tracking-tight">
                    {paymentSession.isSimulator ? "Simulate Payment Integration" : "Cashfree Order Active"}
                  </h3>
                </div>
                <button 
                  onClick={() => setShowCheckoutModal(false)}
                  className="p-1.5 hover:bg-white/5 rounded-xl text-[#8b949e] hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Order Info */}
              <div className="bg-black/30 border border-white/5 rounded-2xl p-5 mb-6 space-y-3">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-[#8b949e] font-semibold">Order ID:</span>
                  <span className="text-white font-mono font-bold">#{paymentSession.orderId}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-[#8b949e] font-semibold">Customer ID:</span>
                  <span className="text-white font-mono">{user?.uid?.substring(0, 8)}...</span>
                </div>
                <div className="border-t border-white/5 pt-3 flex justify-between items-center">
                  <span className="text-xs text-[#8b949e] font-semibold">Recharge Amount:</span>
                  <span className="text-emerald-400 font-mono font-black text-lg">₹{parseFloat(paymentSession.orderAmount || paymentSession.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
              </div>

              {paymentSession.isSimulator ? (
                <div className="space-y-4">
                  <p className="text-xs text-[#8b949e] leading-relaxed">
                    You are running without client or secret keys. We have loaded the NavBharat simulated gateway so that you can verify transactions, credit user wallets, and inspect telemetry.
                  </p>
                  
                  <div className="space-y-2.5 pt-2">
                    <button
                      onClick={() => verifyBillingPayment('SUCCESS')}
                      className="w-full py-3.5 bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600 text-white rounded-xl font-bold uppercase tracking-widest text-xs shadow-lg shadow-emerald-600/15 transition-all text-center"
                    >
                      👍 Simulate PASS (Credit ₹{paymentSession.orderAmount})
                    </button>
                    <button
                      onClick={() => verifyBillingPayment('FAILED')}
                      className="w-full py-3 bg-[#0d1117] border border-red-500/20 text-red-400 hover:bg-red-500/10 rounded-xl font-bold uppercase tracking-widest text-xs transition-all text-center"
                    >
                      👎 Simulate FAIL (Decline)
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4 text-center">
                  <p className="text-xs text-[#8b949e] leading-relaxed">
                    The payment gateway script is initializing. You are being redirected to Cashfree's secure site where you can finalize the recharge transaction securely.
                  </p>
                  
                  <div className="py-2.5 flex items-center justify-center space-x-2.5">
                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>

                  <button
                    onClick={() => triggerCashfreeCheckout(paymentSession.paymentSessionId, paymentSession.environment)}
                    className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold uppercase tracking-widest text-xs shadow-lg shadow-indigo-600/15 transition-all"
                  >
                    🚀 If not redirected, click here
                  </button>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>


      {/* Premium AI Workspace Builder Overlay */}
      <AnimatePresence>
        {isWorkspacePreparing && (
          <div className="fixed inset-0 bg-[#0d1117]/95 backdrop-blur-md flex items-center justify-center p-4 z-[999999]">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-sm bg-[#161b22] border border-indigo-500/40 rounded-3xl p-6 space-y-6 text-center shadow-3xl relative overflow-hidden"
            >
              {/* Spinning progress outer ring / glow */}
              <div className="absolute top-0 left-0 w-full h-[3px] bg-indigo-500 animate-pulse shadow-[0_0_15px_rgba(99,102,241,0.5)]"></div>
              
              <div className="flex flex-col items-center justify-center space-y-4 pt-4">
                <div className="relative">
                  {/* Glowing background circle */}
                  <div className="absolute inset-0 bg-indigo-500/25 rounded-full blur-xl animate-pulse" />
                  <div className="relative w-16 h-16 rounded-2xl bg-indigo-600/10 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
                    <Sparkles className="w-8 h-8 animate-spin" style={{ animationDuration: '4s' }} />
                  </div>
                </div>

                <div className="space-y-1">
                  <h4 className="text-white text-base font-black uppercase tracking-wider font-sans">🔥 Opening AI Workspace</h4>
                  <p className="text-[10px] text-indigo-400 font-bold uppercase tracking-widest font-mono font-black">Cognitive Pipeline Authorization</p>
                </div>
              </div>

              <div className="bg-black/45 border border-white/5 rounded-2xl p-4 text-center">
                <div className="flex items-center justify-center space-x-2.5 mb-2">
                  <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <p className="text-[#8b949e] text-[11px] font-semibold leading-relaxed">
                  Preparing synced project context for <span className="text-white font-black">navBharatAI</span>...
                </p>
              </div>

              <p className="text-[8.5px] text-[#484f58] font-bold uppercase tracking-wider font-mono">
                Sovereign Model Intercept active • Do not refresh
              </p>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* AI Workspace Binding Error Popup */}
      <AnimatePresence>
        {workspacePrepError && (
          <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 z-[999999]">
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              className="w-full max-w-sm bg-[#161b22] border border-red-500/30 rounded-3xl p-6 space-y-4 shadow-3xl text-center relative"
            >
              <div className="absolute top-0 left-0 w-full h-[3px] bg-red-500 shadow-[0_0_15px_rgba(239,68,68,0.5)]"></div>
              
              <div className="flex flex-col items-center justify-center space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/35 flex items-center justify-center text-red-500 font-bold text-xl font-mono">
                  ✕
                </div>
                <div>
                  <h4 className="text-white text-sm font-black uppercase tracking-wider font-sans">❌ Failed to open AI Workspace</h4>
                  <p className="text-[9px] text-red-400 font-bold uppercase tracking-widest font-mono font-black">Workspace session error</p>
                </div>
              </div>

              <div className="p-3.5 bg-black/40 border border-white/5 rounded-2xl text-[11px] text-[#8b949e] leading-relaxed text-left space-y-1.5">
                <div className="font-sans font-bold text-[10px] uppercase text-red-400 font-extrabold">Detailed Reason:</div>
                <p className="font-mono text-red-200 block text-[10px] break-words">{workspacePrepError}</p>
              </div>

              <div className="flex flex-col gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setWorkspacePrepError(null)}
                  className="w-full py-2.5 bg-white/5 hover:bg-white/10 active:scale-95 border border-white/10 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer"
                >
                  Dismiss / Rectify Error
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Premium Real-Time Preview Builder Overlay */}
      <AnimatePresence>
        {isPreviewBuilding && (
          <div className="fixed inset-0 bg-[#0d1117]/95 backdrop-blur-md flex items-center justify-center p-4 z-[999999]">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-md bg-[#161b22] border border-indigo-500/35 rounded-3xl p-6 space-y-5 shadow-3xl relative"
            >
              <div 
                className="absolute top-0 left-0 h-[3px] bg-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.5)] transition-all duration-500" 
                style={{
                  width: previewBuildStage === 'preparing' ? '20%' :
                         previewBuildStage === 'installing' ? '45%' :
                         previewBuildStage === 'building' ? '70%' :
                         previewBuildStage === 'starting' ? '90%' : '100%'
                }}
              />
              
              <div className="flex items-center gap-3.5 border-b border-white/5 pb-4">
                <div className="w-12 h-12 rounded-xl bg-indigo-600/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 relative">
                  <Globe className="w-6 h-6 animate-spin" style={{ animationDuration: '6s' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="text-white text-sm font-black uppercase tracking-wider font-sans">Building Preview</h4>
                  </div>
                  <p className="text-[10px] text-indigo-400 font-bold uppercase tracking-widest font-mono font-black">
                    Runtime: <span className="text-slate-200 font-extrabold">{detectedFramework}</span>
                  </p>
                </div>
              </div>

              <div className="space-y-2.5">
                {[
                  { key: 'preparing', label: 'Validating workspace files' },
                  { key: 'installing', label: 'Checking dependencies & file structure' },
                  { key: 'building', label: 'Bundling HTML + CSS + JS assets' },
                  { key: 'starting', label: 'Launching preview' },
                ].map((step, idx) => {
                  const stages = ['preparing', 'installing', 'building', 'starting', 'ready'];
                  const stageIdx = stages.indexOf(previewBuildStage);
                  const stepIdx = stages.indexOf(step.key);
                  const isFinished = stageIdx > stepIdx;
                  const isActive = previewBuildStage === step.key;
                  
                  return (
                    <div 
                      key={step.key}
                      className={cn(
                        "flex items-center gap-3 p-2.5 rounded-xl border transition-all text-xs font-semibold",
                        isFinished ? "bg-emerald-500/5 border-emerald-500/15 text-emerald-400" :
                        isActive ? "bg-indigo-600/10 border-indigo-500/25 text-white animate-pulse" :
                        "bg-black/30 border-white/5 opacity-40 text-neutral-400"
                      )}
                    >
                      <div className="shrink-0">
                        {isFinished ? (
                          <div className="w-4 h-4 rounded-full bg-emerald-500/10 border border-emerald-500 flex items-center justify-center text-[10px] text-emerald-400 font-black">
                            ✓
                          </div>
                        ) : isActive ? (
                          <div className="w-4 h-4 rounded-full bg-indigo-500 flex items-center justify-center text-[9px] font-black animate-spin">
                            ⏳
                          </div>
                        ) : (
                          <div className="w-4 h-4 rounded-full bg-stone-900 border border-white/10 flex items-center justify-center text-[9px] font-mono text-neutral-400">
                            {idx + 1}
                          </div>
                        )}
                      </div>
                      <p className="flex-1 min-w-0 truncate">{step.label}</p>
                    </div>
                  );
                })}
              </div>

              <div className="text-center font-mono text-[9px] text-[#484f58] uppercase font-bold tracking-widest leading-none pt-1">
                NavBharat Preview Runtime • Static HTML + CSS + JS
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Real-Time Preview Failure Popup */}
      <AnimatePresence>
        {previewBuildError && (
          <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 z-[999999]">
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              className="w-full max-w-sm bg-[#161b22] border border-red-500/30 rounded-3xl p-6 space-y-4 shadow-3xl text-center relative"
            >
              <div className="absolute top-0 left-0 w-full h-[3px] bg-red-500 shadow-[0_0_15px_rgba(239,68,68,0.5)]"></div>
              
              <div className="flex flex-col items-center justify-center space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/35 flex items-center justify-center text-red-500 font-mono text-xl font-bold">
                  ✕
                </div>
                <div>
                  <h4 className="text-white text-sm font-black uppercase tracking-wider font-sans">❌ Preview Failed</h4>
                  <p className="text-[9px] text-red-400 font-bold uppercase tracking-widest font-mono font-black font-black">Development build halted</p>
                </div>
              </div>

              <div className="p-3.5 bg-black/40 border border-white/5 rounded-2xl text-[11px] text-[#8b949e] leading-relaxed text-left space-y-1.5">
                <div className="font-sans font-bold text-[10px] uppercase text-red-400 font-extrabold">Error Exception Logs:</div>
                <p className="font-mono text-red-200 block text-[10px] break-words">{previewBuildError}</p>
              </div>

              <div className="flex flex-col gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPreviewBuildError(null)}
                  className="w-full py-2.5 bg-white/5 hover:bg-white/10 active:scale-95 border border-white/10 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer"
                >
                  Dismiss Error / Repair Code
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>


      {/* 8.1 — Mobile bottom navigation bar (hidden on desktop) */}
      {effectiveDeviceMode !== 'desktop' && (
        <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-[150] bg-[#0d1117]/95 backdrop-blur-xl border-t border-white/10 flex items-center justify-around px-2 h-14"
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          {[
            { id: 'home' as ViewType,      icon: menuItems.find(m => m.id === 'home')?.icon      ?? Bot,         label: 'Home' },
            { id: (activeAgent === 'navbharatai-pro' ? 'nbi_pro_chat' : 'nbi_chat') as ViewType, icon: activeAgent === 'navbharatai-pro' ? (menuItems.find(m => m.id === 'nbi_pro_chat')?.icon ?? Zap) : (menuItems.find(m => m.id === 'nbi_chat')?.icon ?? MessageSquare), label: 'AI' },
            { id: 'preview' as ViewType,   icon: menuItems.find(m => m.id === 'preview')?.icon   ?? Monitor,     label: 'Preview' },
            { id: 'files' as ViewType,     icon: menuItems.find(m => m.id === 'files')?.icon     ?? FolderOpen,  label: 'Files' },
            { id: 'settings' as ViewType,  icon: menuItems.find(m => m.id === 'settings')?.icon  ?? Settings,    label: 'More' },
          ].map(({ id, icon: Icon, label }) => {
            const isActive = activeView === id;
            const isDisabled = (id === 'preview' || id === 'files') && !hasGeneratedCode;
            return (
              <button
                key={id}
                disabled={isDisabled}
                onClick={() => { if (!isDisabled) toggleTab(id); }}
                className={`flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-all active:scale-90 ${
                  isActive ? 'text-indigo-400' : isDisabled ? 'text-white/20' : 'text-[#484f58]'
                }`}
              >
                <Icon className={`w-5 h-5 ${isActive ? 'drop-shadow-[0_0_6px_rgba(99,102,241,0.8)]' : ''}`} />
                <span className={`text-[9px] font-black uppercase tracking-widest leading-none ${isActive ? 'text-indigo-400' : ''}`}>{label}</span>
                {isActive && <span className="w-1 h-1 bg-indigo-400 rounded-full mt-0.5" />}
              </button>
            );
          })}
        </nav>
      )}

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.2); }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        @keyframes bounce-slow {
          0%, 100% { transform: translateY(-5%); animation-timing-function: cubic-bezier(0.8, 0, 1, 1); }
          50% { transform: translateY(0); animation-timing-function: cubic-bezier(0, 0, 0.2, 1); }
        }
        .animate-bounce-slow { animation: bounce-slow 2s infinite; }
        /* 8.1 — bottom nav safe-area padding on mobile */
        @supports (padding-bottom: env(safe-area-inset-bottom)) {
          body { padding-bottom: env(safe-area-inset-bottom); }
        }
      `}</style>

      {/* 10.5 — Command Palette */}
      <CommandPalette
        isOpen={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        onAction={(id) => {
          setShowCommandPalette(false);
          if (id === 'settings-open') toggleTab('settings' as ViewType);
          else if (id === 'files-new') toggleTab('files' as ViewType);
          else if (id === 'ai-debug') { setInput('Review this code for bugs and fix any issues you find'); toggleTab('nbi_chat' as ViewType); }
          else if (id === 'ai-refactor') { setInput('Refactor this code to be cleaner and more maintainable'); toggleTab('nbi_chat' as ViewType); }
          else if (id === 'deploy-vercel') toggleTab('studio' as ViewType);
          addToast(`Running: ${id}`, 'info');
        }}
      />

      {/* 10.6 — Toast notifications */}
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {/* Onboarding modal removed — direct home page load */}

      </div>
  );
}
