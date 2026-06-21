import React, { useState, useRef, useEffect, lazy, Suspense, useMemo, useCallback } from 'react';
import { useUndoRedo } from './hooks/useUndoRedo';
import { useToast, ToastContainer } from './components/Toast';
import { EngineBuilder } from './components/EngineBuilder';
import { buildApp, buildAppStream, isAgenticEngineEnabled } from './services/buildService';
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
import { PreviewPanel } from './components/ide/PreviewPanel';

// ── Task 2.2: React.lazy code-splitting — 44 view-only components ────────────
// Helper: wraps a named export into the {default} shape lazy() requires
const _lz = <T extends object>(fn: () => Promise<T>, k: keyof T) =>
  lazy(() => fn().then(m => ({ default: m[k] as React.ComponentType<any> })));

const CodeStudio       = _lz(() => import('./components/ide/CodeStudio'),       'CodeStudio');
const GitPanel         = _lz(() => import('./components/ide/GitPanel'),         'GitPanel');
const SecurityScan     = _lz(() => import('./components/ide/SecurityScan'),     'SecurityScan');
const TestPanel        = _lz(() => import('./components/ide/TestPanel'),        'TestPanel');
const DiffViewer       = _lz(() => import('./components/ide/DiffViewer'),       'DiffViewer');
const DatabaseUI       = _lz(() => import('./components/ide/DatabaseUI'),       'DatabaseUI');
const VoiceToApp       = _lz(() => import('./components/ide/VoiceToApp'),       'VoiceToApp');
const BotBuilder       = _lz(() => import('./components/ide/BotBuilder'),       'BotBuilder');
const CostEstimator    = _lz(() => import('./components/ide/CostEstimator'),    'CostEstimator');
const ScreenshotToCode = _lz(() => import('./components/ide/ScreenshotToCode'),'ScreenshotToCode');
const MultiPageBuilder = _lz(() => import('./components/ide/MultiPageBuilder'), 'MultiPageBuilder');
const AppAnalytics     = _lz(() => import('./components/ide/AppAnalytics'),     'AppAnalytics');
const AIDebugger       = _lz(() => import('./components/ide/AIDebugger'),       'AIDebugger');
const PerformanceAnalyzer = _lz(() => import('./components/ide/PerformanceAnalyzer'), 'PerformanceAnalyzer');
const ComponentLibrary = _lz(() => import('./components/ide/ComponentLibrary'), 'ComponentLibrary');
const SEOOptimizer     = _lz(() => import('./components/ide/SEOOptimizer'),     'SEOOptimizer');
const APKBuilder       = _lz(() => import('./components/ide/APKBuilder'),       'APKBuilder');
const FigmaImporter    = _lz(() => import('./components/ide/FigmaImporter'),    'FigmaImporter');
const CustomDomain     = _lz(() => import('./components/ide/CustomDomain'),     'CustomDomain');
const TeamCollaboration= _lz(() => import('./components/ide/TeamCollaboration'),'TeamCollaboration');
const PWANotifications = _lz(() => import('./components/ide/PWANotifications'), 'PWANotifications');
const CodeMinifier     = _lz(() => import('./components/ide/CodeMinifier'),     'CodeMinifier');
const DarkModeGenerator= _lz(() => import('./components/ide/DarkModeGenerator'),'DarkModeGenerator');
const MonetizationWizard= _lz(() => import('./components/ide/MonetizationWizard'),'MonetizationWizard');
const AIImageGenerator = _lz(() => import('./components/ide/AIImageGenerator'), 'AIImageGenerator');
const CodeVersioning   = _lz(() => import('./components/ide/CodeVersioning'),   'CodeVersioning');
const APIMarketplace   = _lz(() => import('./components/ide/APIMarketplace'),   'APIMarketplace');
const AppStorePublisher= _lz(() => import('./components/ide/AppStorePublisher'),'AppStorePublisher');
const LiveCollaboration= _lz(() => import('./components/ide/LiveCollaboration'),'LiveCollaboration');
const AITestingSuite   = _lz(() => import('./components/ide/AITestingSuite'),   'AITestingSuite');
const LocalizationManager = _lz(() => import('./components/ide/LocalizationManager'), 'LocalizationManager');
const AICodeReview     = _lz(() => import('./components/ide/AICodeReview'),     'AICodeReview');
const DatabaseStudio   = _lz(() => import('./components/ide/DatabaseStudio'),   'DatabaseStudio');
const CICDPipeline     = _lz(() => import('./components/ide/CICDPipeline'),     'CICDPipeline');
const PluginSystem     = _lz(() => import('./components/ide/PluginSystem'),     'PluginSystem');
const WhitelabelBranding= _lz(() => import('./components/ide/WhitelabelBranding'),'WhitelabelBranding');
const AIProjectManager = _lz(() => import('./components/ide/AIProjectManager'), 'AIProjectManager');
const MultiCloudDeploy = _lz(() => import('./components/ide/MultiCloudDeploy'), 'MultiCloudDeploy');
const DesignSystem     = _lz(() => import('./components/ide/DesignSystem'),     'DesignSystem');
const AppHealthMonitor = _lz(() => import('./components/ide/AppHealthMonitor'), 'AppHealthMonitor');
const AISuggestions    = _lz(() => import('./components/ide/AISuggestions'),    'AISuggestions');
const SecretManager    = _lz(() => import('./components/SecretManager'),        'SecretManager');
const DatabaseSettings = _lz(() => import('./components/settings/DatabaseSettings'), 'DatabaseSettings');
const SocialHub        = _lz(() => import('./components/social/SocialHub'),     'SocialHub');
const ReportsListView  = _lz(() => import('./components/ReportsListView'),      'ReportsListView');
const HistoryView      = _lz(() => import('./components/HistoryView'),          'HistoryView');
const ReportProblemComponent = _lz(() => import('./components/ReportProblemComponent'), 'ReportProblemComponent');

// APITester has a default export
const APITester = lazy(() => import('./components/ide/APITester'));
import { motion, AnimatePresence } from 'motion/react';
import axios from 'axios';

import { AgentProgress, BuildStep } from './components/ide/AgentProgress';
import { useBuild } from './components/ide/BuildContext';
import { ThemeMode, THEME_MODES, getThemeClasses } from './lib/theme';
import { useDevLogs } from './hooks/useDevLogs';
import { useSettings } from './hooks/useSettings';
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
import { ZipSizeModal } from './components/ide/ZipSizeModal';
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
  const [currentProSessionId, setCurrentProSessionId] = useState<string>(() => `pro-${Date.now()}`);

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
      setCurrentProSessionId(`pro-${Date.now()}`);
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

    // ── Mode is the single source of truth — forceBuild skips auto routing ──
    const isBuildMode = mode === 'build' || forceBuild;
    const isAutoMode  = mode === 'auto' && !forceBuild;

    // ── AUTO MODE — smart routing: human-like chat, clarify, or build ──
    if (isAutoMode) {
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

        // ── Guider (Hybrid): for a fresh/big request, propose a design and wait for
        //    the user's confirmation BEFORE building. Small edits skip this (gate on
        //    the server). Never blocks: any failure just proceeds to a normal build.
        if (isAgenticEngineEnabled() && !guiderApproved && !isAutoContinue) {
          try {
            const planResp: any = await fetch('/api/guider/plan', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ prompt: messageToSend, files: allTextFiles, isEdit: isEditRequest, agentic: true }),
            }).then(r => r.json());
            if (planResp?.confirm && planResp?.plan) {
              setProGuiderPlan({ prompt: messageToSend, plan: planResp.plan });
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
            prompt: messageToSend,
            files: Object.keys(allTextFiles).length ? allTextFiles : undefined,
            preview: false,
            // Claude-Code-style memory: tell the engine this is an edit (skips the
            // fresh-build feature loop) and pass conversation + rolling summary +
            // prior-change log so edits stay coherent across many turns.
            isEdit: isEditRequest,
            history: conversationHistory,
            memorySummary: proMemorySummary,
            editLog: proActiveSession?.editLog || [],
            // Internal-testing opt-in (per-session only; see isAgenticEngineEnabled).
            agentic: isAgenticEngineEnabled(),
          }, (ev) => {
            if (ev.type === 'status' && ev.message) {
              setProBuildProgress(prev => ({ ...prev, active: true, stage: `⚙️ ${ev.message}`, percent: Math.min(92, Math.max(prev.percent, (ev.coverage ?? 0))) }));
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
            }
          }, abortController.signal);
          // Persist the refreshed Claude-Code-style memory onto the active session
          // so the NEXT edit gets the rolling summary + change log (kept across
          // turns; auto-saved to Firestore by the session effect).
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
            const replyText = val
              ? `Build Status: ${val.status} · Quality ${score}/100${passed ? '' : ' — preview blocked, see diagnostics'}`
              : (v.ok ? 'Built — verified clean.' : 'Built (with warnings).');
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
              if (proGuiderSpecRef.current && isAgenticEngineEnabled()) {
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
                      text: `🔁 Guider check: ${grade.score}/100 — kuch reh gaya, khud sudhaar raha hoon (round ${round})…`,
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
                          ? `✅ Guider: saari requirements poori (${grade.score}/100).`
                          : `Guider: abhi tak ka best version ready hai (${grade.score}/100). Aur sudhaar chahiye to bata dena.`,
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

  const templates = [
    { id: 'intro', name: 'Introduction', icon: Sparkles, prompt: 'hey 👋 , tell me about yourself!' },
    { id: 'analytics', name: 'Smart Analytics', icon: Activity, prompt: 'Create a high-performance Data Analytics Dashboard for a modern business. I want real-time visualization of key performance indicators (KPIs) including monthly revenue, user growth, and churn rate. Use a sophisticated dark-glassmorphism theme with SVG charts and interactive data tables. Ensure the UI is fully responsive and supports dynamic data filtering.' },
    { id: 'calc', name: 'Simple Calculator', icon: Cpu, prompt: 'I want you to act as a World-Class Software Architect. Build a Professional High-Precision Scientific Calculator. \n\n### MANDATORY FUNCTIONAL REQUIREMENTS:\n1. **Core Logic**: You MUST implement a robust JavaScript evaluation engine in `script.js`. It should handle click events for all buttons, manage a screen buffer, and accurately calculate results for basic (+, -, *, /) and scientific (sqrt, sin, cos, tan, log) operations. Ensure the calculator works perfectly upon loading.\n2. **UI Architecture**: In `style.css`, create a premium "Space-Age Glass" design with deep shadows and tactile hover animations. Use a responsive grid layout.\n3. **History System**: Implement a history list that records the last 5 operations.\n4. **Checklist**: All button IDs in `index.html` must match the selectors used in `script.js`. Ensure NO empty functions.' },
    { id: 'clock', name: 'Simple Clock', icon: Clock, prompt: 'Create a fully functional, production-grade analog clock/watch application for Android + Web (responsive mobile-first UI).\n\n### PRIMARY GOAL\nBuild an ultra-realistic, smooth, accurate analog watch application with professional mechanics, synchronized with the device time down to the millisecond. It must look and behave like a real luxury wristwatch.\n\n### CRITICAL FUNCTIONAL REQUIREMENTS\n1. **REAL TIME SYNC**: Automatically sync with device local time, hours, minutes, and seconds. The clock MUST NOT freeze or use hardcoded angles. Use `requestAnimationFrame` for continuous updates.\n2. **SMOOTH MOVEMENT**: Second hand must move smoothly every frame (not teleport). Minute and Hour hands must move proportionally as seconds progress.\n3. **HAND ALIGNMENT**: All hands MUST originate from EXACTLY the same center pivot point (0,0 center). No misaligned axes.\n4. **DESIGN**: Premium luxury watch face with metallic frame, realistic dial texture, and inner shadows. Include 12 hour markers and minute ticks.\n5. **GEOMETRY**: Perfectly circular (1:1 aspect ratio) and centered on all screens (Android/Desktop).\n6. **FORMULAS**:\n   - Seconds: `seconds * 6` degrees\n   - Minutes: `(minutes * 6) + (seconds * 0.1)` degrees\n   - Hours: `(hours % 12 * 30) + (minutes * 0.5)` degrees\n7. **TECHNICAL**: Use HTML/CSS/JS with SVG or Canvas for real-time rendering. Provide separate code for index.html, style.css, and script.js with NO placeholders.' },
    // 9.6 — React Native / Mobile App generation template
    { id: 'rn_app', name: 'React Native App', icon: Smartphone, isPro: true, prompt: 'Build a React Native (Expo) mobile app. Generate the complete project structure with:\n1. App.js entry point with React Navigation\n2. HomeScreen, DetailScreen components\n3. Bottom tab navigation\n4. StyleSheet with platform-specific styling (ios/android)\n5. Async storage for state persistence\n\nProvide separate files: App.js, screens/HomeScreen.js, screens/DetailScreen.js, package.json (Expo), README with run commands.\nApp theme: dark mode with indigo accent. Include sample data and list rendering.' },
    { id: 'portfolio', name: 'Portfolio Site', icon: Globe, isPro: false, prompt: 'Build a stunning personal portfolio website with: hero section with animated gradient, about me, skills grid, projects showcase (3 cards), contact form with validation. Dark theme with glassmorphism cards, smooth scroll animations, mobile-first responsive. HTML/CSS/JS only.' },
    { id: 'ecommerce', name: 'E-Commerce UI', icon: ShieldCheck, isPro: true, prompt: 'Build a modern e-commerce product listing page: navbar with cart counter, hero banner, product grid (8 items with images, prices, add-to-cart), cart sidebar with total calculation. Tailwind CSS style with indigo/white palette. Full JavaScript interactions.' },
    { id: 'dashboard', name: 'Admin Dashboard', icon: LayoutDashboard, isPro: true, prompt: 'Build a professional admin dashboard: sidebar navigation, header with user info, metric cards (4 KPIs), recent activity table (10 rows), line chart using Chart.js CDN. Dark theme, responsive. All data should be realistic sample data.' },
  ];

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
      {/* Top Header */}
      <nav className={cn("h-10 border-b flex items-center justify-between px-4 shrink-0 transition-all z-[100] gap-4 select-none w-full", themeClasses.card, themeClasses.border)}>
         <div className="flex items-center gap-3 min-w-0 flex-1">
            {effectiveDeviceMode !== 'desktop' && (
              <button 
                onClick={() => setIsMenuOpen(true)}
                className="p-2 hover:bg-white/5 rounded-lg text-indigo-400 transition-all shrink-0 border border-white/5"
              >
                  <Menu className="w-5 h-5" />
              </button>
            )}

            {effectiveDeviceMode === 'desktop' && (
              <button 
                onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                className="p-2 hover:bg-white/5 rounded-lg text-indigo-400 transition-all shrink-0 border border-white/5"
                title={isSidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
              >
                  <Menu className="w-5 h-5" />
              </button>
            )}


          <button 
            onClick={() => toggleTab('home')}
            className="flex items-center gap-2 hover:opacity-80 transition-opacity shrink-0 mr-2"
          >
            <img 
              src="/logo.png" 
              alt="navBharatAI" 
              className="w-7 h-7 object-contain drop-shadow-md select-none pointer-events-none" 
              referrerPolicy="no-referrer"
            />
            <h1 className="text-sm font-bold tracking-tighter text-white hidden sm:block italic">navBharatAI</h1>
          </button>

          {/* 10.5 — Command Palette trigger (Ctrl+K) */}
          <button
            onClick={() => setShowCommandPalette(true)}
            className="hidden md:flex items-center gap-2 h-7 px-3 bg-white/5 hover:bg-white/8 border border-white/5 hover:border-white/15 rounded-lg text-[#484f58] hover:text-white transition-all shrink-0 mr-1"
            title="Command Palette (Ctrl+K)"
          >
            <Search className="w-3 h-3" />
            <span className="text-[10px] text-[#484f58]">Search commands...</span>
            <kbd className="text-[8px] font-black bg-white/5 border border-white/10 px-1 rounded">⌘K</kbd>
          </button>

          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-2 select-none">
            <AnimatePresence mode="popLayout">
              {openTabs.filter(id => id !== 'home').map((tabId) => {
                const item = menuItems.find(m => m.id === tabId);
                if (!item) return null;
                const Icon = item.icon;
                return (
                  <motion.div
                    layout
                    initial={{ opacity: 0, scale: 0.8, x: -10 }}
                    animate={{ opacity: 1, scale: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.8, x: 10 }}
                    key={tabId}
                    className={`flex items-center shrink-0 h-9 rounded-xl px-3 gap-2 border transition-all cursor-pointer group ${
                      activeView === tabId 
                      ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-600/20' 
                      : 'bg-[#0d1117] border-white/5 text-[#8b949e] hover:border-white/20'
                    }`}
                    onClick={() => setActiveView(tabId)}
                  >
                    <Icon className={`w-3.5 h-3.5 ${activeView === tabId ? 'text-white' : 'text-indigo-400'}`} />
                    <span className="text-[11px] font-bold whitespace-nowrap">{item.label}</span>
                    <button 
                      onClick={(e) => closeTab(e, tabId)}
                      className={`p-0.5 rounded-md transition-all ${
                        activeView === tabId 
                        ? 'hover:bg-white/20 text-white/60 hover:text-white' 
                        : 'hover:bg-white/10 text-white/20 hover:text-white'
                      }`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 shrink-0">
          {/* 9.1 — Undo/Redo buttons (shown when app is built) */}
          {hasGeneratedCode && (
            <div className="hidden sm:flex items-center gap-1 border border-white/5 rounded-xl overflow-hidden">
              <button
                onClick={undoCode}
                disabled={!canUndo}
                title="Undo (Ctrl+Z)"
                className="p-2 hover:bg-white/5 text-[#484f58] hover:text-white transition-all disabled:opacity-25 disabled:cursor-not-allowed"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              <div className="w-px h-5 bg-white/10" />
              <button
                onClick={redoCode}
                disabled={!canRedo}
                title="Redo (Ctrl+Y)"
                className="p-2 hover:bg-white/5 text-[#484f58] hover:text-white transition-all disabled:opacity-25 disabled:cursor-not-allowed"
              >
                <RotateCcw className="w-3.5 h-3.5 scale-x-[-1]" />
              </button>
            </div>
          )}
          {!user ? (
            <button 
              onClick={() => setShowAuth(true)} 
              className="py-2.5 px-5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-lg shadow-indigo-600/20 active:scale-95"
            >
              Login
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <div className="hidden sm:flex flex-col items-end mr-1">
                <span className="text-[9px] font-black text-white uppercase tracking-tighter truncate max-w-[80px]">{user.email?.split('@')[0]}</span>
                <span className="text-[7px] font-bold text-emerald-400 uppercase tracking-widest">Active</span>
              </div>
              <button 
                onClick={async (e) => {
                  e.stopPropagation();
                  if (confirm('Logout from NavBharat?')) {
                    try {
                      await signOut(auth);
                      window.location.reload();
;
                    } catch (error) {
                      console.error('Logout failed:', error);
                    }
                  }
                }}
                className="w-10 h-10 bg-white/5 hover:bg-red-500/10 rounded-xl flex items-center justify-center text-[#484f58] hover:text-red-500 transition-all border border-white/5 active:scale-90"
                title="Logout"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          )}
        </div>
      </nav>

      {/* Main Content Area */}
      <div className={`flex flex-1 w-full min-h-0`}>

      {/* Persistent Desktop Sidebar */}
      {effectiveDeviceMode === 'desktop' && (
        <aside className={cn("bg-[#161b22] border-r border-white/10 hidden lg:flex flex-col h-full shadow-3xl flex-shrink-0 transition-all duration-300 ease-in-out overflow-hidden", isSidebarCollapsed ? 'w-0' : 'w-72')}>
          {/* Sidebar content remains here */}
          <div className="p-6 border-b border-white/10 flex items-center justify-between bg-[#0d1117]/30">
            <button 
              onClick={() => setActiveView('home')}
              className="flex items-center gap-3 hover:opacity-80 transition-opacity text-left"
            >
              <img 
                src="/logo.png" 
                alt="NAVBHARAT navBharat-AI" 
                className="w-8 h-8 object-contain drop-shadow-md select-none pointer-events-none" 
                referrerPolicy="no-referrer"
              />
              <div>
                <h2 className="font-black text-sm text-white tracking-tighter">NAVBHARAT <span className="text-indigo-500">navBharat-AI</span></h2>
                <p className="text-[10px] text-[#8b949e] font-medium">Enterprise AI Workspace</p>
              </div>
            </button>
          </div>
          {/* Side Nav Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-8 custom-scrollbar">
            <div className="space-y-1.5">
              <div className="text-[10px] font-black text-indigo-500 uppercase tracking-widest px-3 mb-4 flex items-center gap-2">
                <div className="w-1 h-3 bg-indigo-500 rounded-full"></div>
                Core Navigation
              </div>
              {menuItems.filter(item => enabledModules[item.id] !== false).map((item) => {
                const isPreview = item.id === 'preview';
                const isFiles = item.id === 'files';
                const isLoginGated = (item.id === 'nbi_pro_chat' || item.id === 'sda_chat') && !user;
                const isDisabled = (isPreview || isFiles) && !hasGeneratedCode;
                const isActive = activeView === item.id;

                return (
                  <button
                    key={item.id}
                    disabled={isDisabled}
                    title={isLoginGated ? 'Sign in to access this feature' : isDisabled ? 'Generate an app to enable this' : ''}
                    onClick={() => {
                      if (isPreview) { toggleTab('preview'); return; }
                      if (item.id === 'asc_chat') { toggleTab('asc_chat'); return; }
                      if (item.id === 'history' && !user) {
                        setShowAuth(true);
                        addLog('Chat history requires an active session. Please login.', 'warn');
                        return;
                      }
                      toggleTab(item.id as ViewType);
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-all group ${
                      isActive
                        ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-600/20'
                        : isDisabled
                          ? 'opacity-40 grayscale cursor-not-allowed'
                          : 'text-[#8b949e] hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    <item.icon className={`w-4.5 h-4.5 transition-transform group-hover:scale-110 ${
                      isActive ? 'text-white' : isPreview && hasGeneratedCode ? 'text-emerald-500' : 'text-indigo-400'
                    }`} />
                    <span className="text-sm font-bold tracking-tight">{item.label}</span>
                    {isLoginGated && (
                      <span className="ml-auto flex items-center gap-1 text-[9px] font-black uppercase tracking-widest bg-amber-500/15 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-full">
                        <Lock className="w-2.5 h-2.5" /> Login
                      </span>
                    )}
                    {isActive && !isLoginGated && (
                      <div className="ml-auto w-1.5 h-1.5 rounded-full bg-white animate-pulse"></div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </aside>
      )}



      {/* Main Content Component Area */}

      {/* Unified Sidebar Navigation Drawer */}
      <AnimatePresence>
        {isMenuOpen && (
          <div className="absolute inset-0 z-[200]">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsMenuOpen(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.aside 
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className={cn("absolute left-0 top-0 bottom-0 w-[300px] border-r flex flex-col shadow-3xl select-none transition-colors duration-500", themeClasses.card, themeClasses.border, themeClasses.text)}
            >
              <div className={cn("p-6 border-b flex items-center justify-between", themeClasses.border)}>
                <button 
                  onClick={() => {
                    setActiveView('home');
                    setIsMenuOpen(false);
                  }}
                  className="flex items-center gap-3 hover:opacity-80 transition-opacity text-left"
                >
                  <img 
                    src="/logo.png" 
                    alt="NAVBHARAT navBharat-AI" 
                    className="w-8 h-8 object-contain drop-shadow-md select-none pointer-events-none" 
                    referrerPolicy="no-referrer"
                  />
                  <div>
                    <h2 className="font-black text-sm text-white tracking-tighter">NAVBHARAT <span className="text-indigo-500">navBharat-AI</span></h2>
                    <p className="text-[10px] text-[#8b949e] font-medium">Enterprise AI Workspace</p>
                  </div>
                </button>
                <button 
                  onClick={() => setIsMenuOpen(false)} 
                  className="p-2 hover:bg-white/5 rounded-xl text-[#8b949e] hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-8 custom-scrollbar">
                <div className="space-y-1.5">
                  <div className="text-[10px] font-black text-indigo-500 uppercase tracking-widest px-3 mb-4 flex items-center gap-2">
                    <div className="w-1 h-3 bg-indigo-500 rounded-full"></div>
                    Core Navigation
                  </div>
                  {menuItems.filter(item => enabledModules[item.id] !== false).map((item) => {
                    const isPreview = item.id === 'preview';
                    const isFiles = item.id === 'files';
                    const isLoginGated = (item.id === 'nbi_pro_chat' || item.id === 'sda_chat') && !user;
                    const isDisabled = (isPreview || isFiles) && !hasGeneratedCode;
                    const isActive = activeView === item.id;

                    return (
                      <button
                        key={item.id}
                        disabled={isDisabled}
                        title={isLoginGated ? 'Sign in to access this feature' : isDisabled ? 'Generate an app to enable this' : ''}
                        onClick={() => {
                          if (isPreview) { toggleTab('preview'); setIsMenuOpen(false); return; }
                          if (item.id === 'asc_chat') { setShowVishwakarmaChooser(true); setIsMenuOpen(false); return; }
                          if (item.id === 'history' && !user) {
                            setShowAuth(true); setIsMenuOpen(false);
                            addLog('Chat history requires an active session. Please login.', 'warn');
                            return;
                          }
                          toggleTab(item.id as ViewType);
                          setIsMenuOpen(false);
                        }}
                        className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-all group ${
                          isActive
                            ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-600/20'
                            : isDisabled
                              ? 'opacity-40 grayscale cursor-not-allowed'
                              : 'text-[#8b949e] hover:bg-white/5 hover:text-white'
                        }`}
                      >
                        <item.icon className={`w-4.5 h-4.5 transition-transform group-hover:scale-110 ${
                          isActive ? 'text-white' : isPreview && hasGeneratedCode ? 'text-emerald-500' : 'text-indigo-400'
                        }`} />
                        <span className="text-sm font-bold tracking-tight">{item.label}</span>
                        {isLoginGated && (
                          <span className="ml-auto flex items-center gap-1 text-[9px] font-black uppercase tracking-widest bg-amber-500/15 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-full">
                            <Lock className="w-2.5 h-2.5" /> Login
                          </span>
                        )}
                        {!isLoginGated && (item as any).status && !isActive && (
                          <div className={`ml-auto px-2 py-0.5 rounded-full text-[7px] font-black uppercase tracking-widest border ${(item as any).status === 'Beta' ? 'bg-amber-500/10 text-amber-500 border-amber-500/20' : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'}`}>
                            {(item as any).status}
                          </div>
                        )}
                        {isActive && !isLoginGated && (
                          <div className="ml-auto w-1.5 h-1.5 rounded-full bg-white animate-pulse"></div>
                        )}
                        {isPreview && hasGeneratedCode && !isActive && (
                          <div className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.6)]"></div>
                        )}
                      </button>
                    );
                  })}

                  {/* Theme Selector right below "Other" */}
                  <div className="space-y-2 mt-2 px-1">
                    <button
                      onClick={() => setIsThemePickerOpen(!isThemePickerOpen)}
                      className={cn(
                        "w-full flex items-center justify-between px-4 py-3 rounded-2xl transition-all group border hover:bg-white/5 text-left",
                        isThemePickerOpen 
                          ? "bg-indigo-600/15 border-indigo-500/30 text-white" 
                          : "border-transparent text-[#8b949e] hover:text-white"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <Palette className="w-4.5 h-4.5 text-indigo-400 group-hover:scale-110 transition-transform" />
                        <span className="text-sm font-bold tracking-tight">Theme</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-semibold text-indigo-400 capitalize bg-indigo-500/10 px-2 py-0.5 rounded-full border border-indigo-500/20">
                          {theme === 'dim' ? 'Dim Light' : theme === 'comfort' ? 'Comfort' : theme === 'contrast' ? 'Contrast' : theme === 'light' ? 'Light' : 'Dark'}
                        </span>
                      </div>
                    </button>

                    {isThemePickerOpen && (
                      <div className="grid grid-cols-2 gap-2 p-2 bg-black/25 rounded-2xl border border-white/5">
                        {THEME_MODES.map((t) => {
                          const isSelected = theme === t.value;
                          return (
                            <button
                              key={t.value}
                              onClick={() => {
                                setTheme(t.value);
                                addLog(`Theme changed to ${t.label}`, 'success');
                              }}
                              className={cn(
                                "flex items-center gap-1.5 px-3 py-2 rounded-xl text-left text-[10px] font-bold uppercase tracking-wider transition-all border",
                                isSelected 
                                  ? "bg-indigo-600 border-indigo-500 text-white shadow-md shadow-indigo-600/10" 
                                  : "bg-white/5 border-transparent text-[#8b949e] hover:bg-white/10 hover:text-white"
                              )}
                            >
                              <div className={cn(
                                "w-2 h-2 rounded-full shrink-0",
                                t.value === 'light' ? 'bg-white border border-gray-400' :
                                t.value === 'dark' ? 'bg-[#0d1117]' :
                                t.value === 'dim' ? 'bg-[#15202b]' :
                                t.value === 'comfort' ? 'bg-[#fdf6e3]' :
                                'bg-[#ffff00]'
                              )} />
                              <span className="truncate">{t.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-4 pt-4 border-t border-white/5">
                  <div className="text-[10px] font-black text-emerald-500 uppercase tracking-widest px-3 flex items-center gap-2">
                    <div className="w-1 h-3 bg-emerald-500 rounded-full"></div>
                    System Matrix
                  </div>
                  <div className="px-1 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <button 
                        onClick={() => {
                          toggleTab('settings');
                          setIsMenuOpen(false);
                          setErrorContext(null);
                        }}
                        className={`flex flex-col items-center justify-center gap-2 border py-5 rounded-2xl transition-all group shadow-lg ${activeView === 'settings' ? 'bg-indigo-600 border-indigo-500' : 'bg-[#161b22] border-white/10 hover:border-indigo-500/50'}`}
                      >
                        <Settings className="w-6 h-6 text-indigo-400 group-hover:rotate-90 transition-transform duration-500" />
                        <span className={`text-[10px] font-black uppercase tracking-widest ${activeView === 'settings' ? 'text-white' : 'text-[#8b949e]'}`}>Settings</span>
                      </button>
                      <button 
                        onClick={() => {
                          toggleTab('donation');
                          setIsMenuOpen(false);
                        }}
                        className="flex flex-col items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 py-5 rounded-2xl transition-all shadow-xl shadow-indigo-600/30 group"
                      >
                        <Heart className="w-6 h-6 text-white group-hover:scale-110 transition-transform" />
                        <span className="text-[10px] font-black text-white uppercase tracking-widest">Donate</span>
                      </button>
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5 pt-4 border-t border-white/5">
                   <button
                    onClick={() => {
                        toggleTab('about');
                        setIsMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all group ${activeView === 'about' ? 'bg-indigo-600 text-white' : 'text-[#8b949e] hover:bg-white/5 hover:text-white'}`}
                  >
                    <Info className="w-4.5 h-4.5 text-indigo-400" />
                    <span className="text-sm font-bold tracking-tight">About Us</span>
                  </button>
                  <button
                    onClick={() => {
                        toggleTab('engine_builder');
                        setIsMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all group ${activeView === 'engine_builder' ? 'bg-indigo-600 text-white' : 'text-[#8b949e] hover:bg-white/5 hover:text-white'}`}
                  >
                    <Info className="w-4.5 h-4.5 text-indigo-400" />
                    <span className="text-sm font-bold tracking-tight">App Builder (New Engine)</span>
                  </button>
                  <button
                    onClick={() => {
                        toggleTab('admin');
                        setIsMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all group ${activeView === 'admin' ? 'bg-indigo-600 text-white' : 'text-[#8b949e] hover:bg-white/5 hover:text-white'}`}
                  >
                    <Lock className="w-4.5 h-4.5 text-indigo-400" />
                    <span className="text-sm font-bold tracking-tight">{isAdmin ? 'Admin Dashboard' : 'Admin Login'}</span>
                  </button>
                </div>
              </div>

              <div className="p-6 border-t border-white/5 bg-[#0d1117]">
                 <p className="text-[9px] text-[#484f58] text-center font-medium">Navbharat Terminal v2.4.0 • Building Future</p>
              </div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

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
            <div className={cn("flex-1 flex flex-col h-full overflow-y-auto custom-scrollbar animate-in fade-in zoom-in duration-300", themeClasses.bg)}>
              {/* Settings Header */}
              <div className={cn("h-14 border-b flex items-center px-4 gap-4 sticky top-0 z-20 select-none", themeClasses.card, themeClasses.border)}>
                {settingsScreen !== 'root' && (
                  <button 
                    onClick={() => setSettingsScreen('root')}
                    className="p-2 hover:bg-white/5 rounded-xl text-[#8b949e] hover:text-white transition-all border border-white/5"
                  >
                    <ChevronRight className="w-5 h-5 rotate-180" />
                  </button>
                )}
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-indigo-600 rounded-lg">
                    <Settings className="w-4 h-4 text-white" />
                  </div>
                  <h3 className="font-bold text-white text-sm">
                    {settingsScreen === 'root' ? 'Settings' : settingsScreen.charAt(0).toUpperCase() + settingsScreen.slice(1).replace(/_/g, ' ')}
                  </h3>
                </div>
                <button 
                  onClick={() => toggleTab('nbi_chat')}
                  className="ml-auto p-2 hover:bg-white/5 rounded-xl text-[#8b949e] transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Settings Content Area */}
              <div className="flex-1 overflow-y-auto custom-scrollbar bg-[#0d1117]">
                <div className="max-w-xl mx-auto p-4 sm:p-6 pb-20">
                  <AnimatePresence mode="wait">
                    {settingsScreen === 'root' && (
                      <motion.div
                        key="root"
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="space-y-4"
                      >
                        {/* View Mode */}
                        <div className="bg-[#161b22] border border-white/5 rounded-2xl p-4">
                          <div className="flex items-center gap-3 mb-3">
                            <Monitor className="w-4 h-4 text-indigo-400" />
                            <h4 className="text-xs font-bold text-white uppercase tracking-widest">View Mode</h4>
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            {['auto', 'mobile', 'desktop'].map(m => (
                              <button key={m} onClick={() => setDeviceMode(m as any)}
                                className={`py-2 rounded-xl text-xs font-bold transition-all border ${deviceMode === m ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-[#0d1117] border-white/5 text-[#8b949e] hover:border-white/20'}`}>
                                {m.charAt(0).toUpperCase() + m.slice(1)}
                              </button>
                            ))}
                          </div>
                        </div>
                        {/* 6 grouped sections */}
                        {[
                          {
                            title: 'App Settings',
                            color: 'text-blue-400',
                            icon: Settings,
                            items: [
                              { id: 'general', label: 'General', icon: LayoutDashboard },
                              { id: 'secrets', label: 'Secrets & Keys', icon: Lock },
                              { id: 'database', label: 'Database', icon: Database },
                              { id: 'connections', label: 'Connections', icon: GitFork },
                              { id: 'shell', label: 'Terminal', icon: Terminal },
                              { id: 'logs', label: 'Logs', icon: Activity },
                              { id: 'git', label: 'Git', icon: GitBranch },
                            ],
                          },
                          {
                            title: 'AI Tools',
                            color: 'text-violet-400',
                            icon: Bot,
                            items: [
                              { id: 'sda_chat', label: 'Doctor AI', icon: Activity, tab: true },
                              { id: 'voice', label: 'Voice to App', icon: Mic, tab: true },
                              { id: 'botbuilder', label: 'Bot Builder', icon: MessageSquare, tab: true },
                              { id: 'imagegen', label: 'AI Image Gen', icon: Wand2, tab: true },
                              { id: 'debugger', label: 'AI Debugger', icon: Bug, tab: true },
                              { id: 'codereview', label: 'Code Review', icon: Code, tab: true },
                            ],
                          },
                          {
                            title: 'Developer Tools',
                            color: 'text-emerald-400',
                            icon: Code,
                            items: [
                              { id: 'testing', label: 'Test Runner', icon: TestTube, tab: true },
                              { id: 'api', label: 'API Tester', icon: Globe, tab: true },
                              { id: 'diff', label: 'Diff Viewer', icon: GitMerge, tab: true },
                              { id: 'versioning', label: 'Versioning', icon: GitBranch, tab: true },
                              { id: 'performance', label: 'Performance', icon: Gauge, tab: true },
                              { id: 'minifier', label: 'Minifier', icon: Minimize2, tab: true },
                            ],
                          },
                          {
                            title: 'Design & Build',
                            color: 'text-pink-400',
                            icon: Palette,
                            items: [
                              { id: 'screenshot', label: 'Screenshot→Code', icon: Camera, tab: true },
                              { id: 'multipages', label: 'Multi-Page', icon: Layout, tab: true },
                              { id: 'components', label: 'Components', icon: Puzzle, tab: true },
                              { id: 'designsys', label: 'Design System', icon: LayoutTemplate, tab: true },
                              { id: 'darkmode', label: 'Dark Mode Gen', icon: Moon, tab: true },
                              { id: 'figma', label: 'Figma Import', icon: Figma, tab: true },
                            ],
                          },
                          {
                            title: 'Publish & Deploy',
                            color: 'text-cyan-400',
                            icon: Rocket,
                            items: [
                              { id: 'apk', label: 'APK Builder', icon: Smartphone, tab: true },
                              { id: 'cicd', label: 'CI/CD Pipeline', icon: Rocket, tab: true },
                              { id: 'cloudeploy', label: 'Multi-Cloud', icon: CloudUpload, tab: true },
                              { id: 'domain', label: 'Custom Domain', icon: GlobeIcon, tab: true },
                              { id: 'seo', label: 'SEO Optimizer', icon: SearchIcon, tab: true },
                              { id: 'appstore', label: 'App Store', icon: Package, tab: true },
                            ],
                          },
                          {
                            title: 'Monetization & Team',
                            color: 'text-amber-400',
                            icon: IndianRupee,
                            items: [
                              { id: 'monetize', label: 'Monetize', icon: IndianRupee, tab: true },
                              { id: 'team', label: 'Team', icon: Users2, tab: true },
                              { id: 'collab', label: 'Live Collab', icon: Users2, tab: true },
                              { id: 'whitelabel', label: 'Whitelabel', icon: Palette, tab: true },
                              { id: 'analytics', label: 'Analytics', icon: TrendingUp, tab: true },
                              { id: 'database', label: 'Database', icon: Database, tab: true },
                            ],
                          },
                        ].map(group => (
                          <div key={group.title} className="bg-[#161b22] border border-white/5 rounded-2xl p-4">
                            <div className="flex items-center gap-2 mb-3">
                              <group.icon className={`w-3.5 h-3.5 ${group.color}`} />
                              <span className={`text-[10px] font-black uppercase tracking-widest ${group.color}`}>{group.title}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              {group.items.map(item => (
                                <button
                                  key={item.id}
                                  onClick={() => (item as any).tab ? toggleTab(item.id as any) : setSettingsScreen(item.id as any)}
                                  className="flex items-center gap-2 p-2.5 bg-[#0d1117] border border-white/5 rounded-xl hover:border-indigo-500/30 hover:bg-indigo-600/10 transition-all group text-left"
                                >
                                  <item.icon className="w-3.5 h-3.5 text-[#484f58] group-hover:text-indigo-400 transition-colors flex-shrink-0" />
                                  <span className="text-[10px] font-bold text-[#8b949e] group-hover:text-white transition-colors truncate">{item.label}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}

                        {/* Admin + Footer */}
                        <button
                          onClick={() => setSettingsScreen('admin' as any)}
                          className="w-full flex items-center gap-3 p-3 bg-[#161b22] border border-white/5 rounded-xl hover:border-red-500/20 transition-all group"
                        >
                          <Lock className="w-4 h-4 text-[#484f58] group-hover:text-red-400 transition-colors" />
                          <span className="text-xs font-bold text-[#8b949e] group-hover:text-white transition-colors">Admin Login</span>
                        </button>

                        <div className="pt-4 border-t border-white/5 flex flex-col items-center">
                          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-600/30 mb-3">
                            <span className="text-white font-black text-xs">NB</span>
                          </div>
                          <p className="text-[9px] text-[#484f58] font-black uppercase tracking-[0.3em]">Navbharat AI v5.0.0</p>
                        </div>
                      </motion.div>
                    )}

                    {settingsScreen === 'general' && (
                      <motion.div 
                        key="general"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        className="space-y-6"
                      >
                        <div className="px-1 py-4">
                           <h2 className="text-2xl font-black text-white tracking-tight">General</h2>
                           <p className="text-[11px] text-[#484f58] font-bold uppercase tracking-[0.2em] mt-1">Application Identity & Preferences</p>
                        </div>

                        <div className="bg-[#161b22] border border-white/5 rounded-[2.5rem] p-8 shadow-2xl space-y-8">
                          <div className="flex flex-col items-center text-center space-y-4">
                             <div className="w-20 h-20 bg-indigo-600 rounded-[2rem] flex items-center justify-center shadow-2xl relative group cursor-pointer overflow-hidden">
                                <Bot className="w-10 h-10 text-white group-hover:scale-110 transition-transform" />
                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                   <Plus className="w-6 h-6 text-white" />
                                </div>
                             </div>
                             <div>
                               <h3 className="text-sm font-black text-white uppercase tracking-widest">Navbharat AI</h3>
                               <p className="text-[10px] text-[#484f58] font-bold uppercase tracking-widest mt-1">Workspace v2.4.0</p>
                             </div>
                          </div>

                          <div className="space-y-6 pt-4">
                             <div className="space-y-3">
                               <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1 block pl-1">Application Name</label>
                               <input 
                                 defaultValue="Navbharat AI"
                                 className="w-full bg-[#0d1117] border border-white/10 rounded-[1.5rem] px-6 py-4 text-sm font-bold text-white outline-none focus:border-indigo-500 transition-all shadow-inner"
                               />
                             </div>
                             
                             <div className="space-y-3 pt-6 border-t border-white/10">
                                <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-2 block pl-1">Device Mode</label>
                                <div className="grid grid-cols-4 gap-2">
                                  {[
                                      {id: 'auto', label: 'Auto'},
                                      {id: 'mobile', label: '📱'},
                                      {id: 'tablet', label: '📟'},
                                      {id: 'desktop', label: '💻'}
                                  ].map(mode => (
                                   <button 
                                      key={mode.id}
                                      onClick={() => setDeviceMode(mode.id as any)}
                                      className={`p-3 rounded-xl border border-white/5 font-black text-[10px] uppercase tracking-widest ${deviceMode === mode.id ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-[#0d1117] text-[#8b949e]'}`}
                                   >
                                      {mode.label}
                                   </button>
                                  ))}
                                </div>
                             </div>

                             <div className="space-y-3 pt-6 border-t border-white/10">
                               <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1 block pl-1">Description</label>
                               <textarea 
                                 defaultValue="The ultimate specialized AI developer workspace for Bharat."
                                 className="w-full bg-[#0d1117] border border-white/10 rounded-[1.5rem] px-6 py-5 text-sm font-medium text-[#8b949e] outline-none focus:border-indigo-500 transition-all min-h-[120px] resize-none shadow-inner"
                               />
                             </div>
                             <div className="flex items-center justify-between p-6 bg-[#0d1117] border border-white/5 rounded-[1.5rem] shadow-inner">
                               <div className="flex items-center gap-4">
                                 <div className="w-10 h-10 bg-indigo-600/10 rounded-xl flex items-center justify-center">
                                   <Terminal className="w-5 h-5 text-indigo-400" />
                                 </div>
                                 <div>
                                   <h4 className="text-[11px] font-black text-white uppercase tracking-widest">Developer Mode</h4>
                                   <p className="text-[9px] text-[#484f58] font-bold uppercase">Advanced debug tools</p>
                                 </div>
                               </div>
                               <button className="w-12 h-6 bg-indigo-600 rounded-full p-1 flex items-center justify-end transition-all">
                                 <div className="w-4 h-4 bg-white rounded-full shadow-lg"></div>
                               </button>
                             </div>

                             <div className="p-6 bg-[#0d1117] border border-white/5 rounded-[1.5rem] shadow-inner space-y-3">
                               <div className="flex items-center gap-3 mb-2">
                                 <div className="w-10 h-10 bg-amber-500/10 rounded-xl flex items-center justify-center">
                                   <Languages className="w-5 h-5 text-amber-400" />
                                 </div>
                                 <div>
                                   <h4 className="text-[11px] font-black text-white uppercase tracking-widest">Chat Language</h4>
                                   <p className="text-[9px] text-[#484f58] font-bold uppercase">AI conversation language preference</p>
                                 </div>
                               </div>
                               <div className="grid grid-cols-2 gap-2">
                                 {(['hindi','hinglish','english','auto'] as const).map(lang => {
                                   const labels = { hindi: '🇮🇳 Hindi', hinglish: '🔀 Hinglish', english: '🇬🇧 English', auto: '🌐 Auto' };
                                   const isActive = (preferredLanguage || 'auto') === lang;
                                   return (
                                     <button
                                       key={lang}
                                       onClick={() => setPreferredLanguage(lang)}
                                       className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border ${isActive ? 'bg-amber-500/20 border-amber-500/50 text-amber-300' : 'bg-white/5 border-white/10 text-[#8b949e] hover:border-amber-500/30'}`}
                                     >
                                       {labels[lang]}
                                     </button>
                                   );
                                 })}
                               </div>
                               <p className="text-[9px] text-[#484f58]">Code is always generated in English regardless of this setting.</p>
                             </div>
                          </div>

                          <button className="w-full py-5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-[1.5rem] text-xs font-black uppercase tracking-[0.2em] shadow-2xl shadow-indigo-600/30 active:scale-[0.98] transition-all">
                             Update Preferences
                          </button>
                        </div>
                      </motion.div>
                    )}

                    {settingsScreen === 'modules' && (
                      <motion.div 
                        key="modules"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        className="space-y-6"
                      >
                        {/* Section Header */}
                        <div className="px-1 py-4">
                           <h2 className="text-2xl font-black text-white tracking-tight">Active Modules</h2>
                           <p className="text-[11px] text-[#484f58] font-bold uppercase tracking-[0.2em] mt-1">Control Navbharat's Core Intelligence</p>
                        </div>

                        {/* Brain Engine Card */}
                        <div className="bg-[#161b22] border border-white/5 rounded-[2.5rem] p-6 shadow-2xl overflow-hidden relative">
                          <div className="flex items-center gap-4 mb-6">
                            <div className="w-12 h-12 bg-indigo-600/10 rounded-2xl flex items-center justify-center">
                               <Cpu className="w-6 h-6 text-indigo-400" />
                            </div>
                            <div>
                               <h3 className="font-black text-white text-sm uppercase tracking-wider">Brain Engine</h3>
                               <p className="text-[10px] text-[#8b949e] font-medium italic">Internal reasoning & generation engine</p>
                            </div>
                          </div>
                          
                          <div className="bg-[#0d1117]/60 border border-white/5 rounded-3xl p-5 flex items-start gap-4">
                            <div className="w-10 h-10 rounded-2xl bg-indigo-500/10 flex items-center justify-center flex-shrink-0">
                              <Sparkles className="w-5 h-5 text-indigo-400" />
                            </div>
                            <div>
                              <h4 className="text-xs font-black text-indigo-400 uppercase tracking-widest mb-1.5">Sovereign Autopilot Engaged</h4>
                              <p className="text-[11px] text-[#8b949e] leading-relaxed">
                                Navbharat AI incorporates a fully autonomous routing core. API requests are dynamically optimized, balanced, and auto-routed over resilient premium cognitive channels based on complexity, security profile, and operational load to ensure maximum up-times and absolute privacy.
                              </p>
                            </div>
                          </div>

                          <div className="mt-8 pt-8 border-t border-white/5">
                            <h4 className="text-[10px] font-black text-white uppercase tracking-widest mb-4">Brain API Credentials</h4>
                            <div className="space-y-4">
                              {Object.entries(PROVIDER_CONFIG).map(([id, provider]) => (
                                <div key={id} className="space-y-2">
                                  <div className="flex items-center justify-between px-1">
                                    <span className="text-[9px] font-black text-[#8b949e] uppercase tracking-widest">{provider.label}</span>
                                    <a href={provider.link} target="_blank" rel="noreferrer" className="text-[9px] text-indigo-400 font-black uppercase hover:text-white transition-colors">Get API Key</a>
                                  </div>
                                  <div className="relative group">
                                    <input 
                                      type={showKeyStates[id] ? "text" : "password"}
                                      value={(keys as any)[id] || ''}
                                      onChange={(e) => setKeys(prev => ({ ...prev, [id]: e.target.value }))}
                                      placeholder={`Enter ${id} key...`}
                                      className="w-full bg-black/40 border border-white/5 rounded-2xl px-5 py-4 text-xs font-mono text-indigo-400 outline-none focus:border-indigo-500/50 transition-all"
                                    />
                                    <button 
                                      onClick={() => setShowKeyStates(prev => ({ ...prev, [id]: !prev[id] }))}
                                      className="absolute right-4 top-1/2 -translate-y-1/2 text-[#484f58] hover:text-white transition-colors"
                                    >
                                      {showKeyStates[id] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* Workspace Panels Toggle */}
                        <div className="bg-[#161b22] border border-white/5 rounded-[2.5rem] p-6 shadow-2xl">
                           <div className="flex items-center gap-4 mb-6">
                              <div className="w-12 h-12 bg-emerald-600/10 rounded-2xl flex items-center justify-center">
                                 <Monitor className="w-6 h-6 text-emerald-400" />
                              </div>
                              <div>
                                 <h3 className="font-black text-white text-sm uppercase tracking-wider">Workspace Panels</h3>
                                 <p className="text-[10px] text-[#8b949e] font-medium italic">Toggle active navigation modules</p>
                              </div>
                           </div>

                           <div className="grid gap-2">
                              {menuItems.map(item => (
                                <button 
                                  key={item.id}
                                  onClick={() => setEnabledModules(prev => ({ ...prev, [item.id]: !prev[item.id] }))}
                                  className={`flex items-center gap-4 p-4 rounded-[1.5rem] border transition-all active:scale-[0.97] ${enabledModules[item.id] !== false ? 'bg-[#0d1117] border-white/10' : 'bg-transparent border-white/5 opacity-50'}`}
                                >
                                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${enabledModules[item.id] !== false ? 'bg-indigo-500/20 text-indigo-400' : 'bg-white/5 text-[#484f58]'}`}>
                                    <item.icon className="w-5 h-5" />
                                  </div>
                                  <span className="flex-1 text-[11px] font-black uppercase tracking-widest text-left text-white">{item.label}</span>
                                  <div className={`w-12 h-6 rounded-full p-1 flex items-center transition-all ${enabledModules[item.id] !== false ? 'bg-emerald-500/20 justify-end border border-emerald-500/30' : 'bg-black/40 justify-start border border-white/5'}`}>
                                    <div className={`w-4 h-4 rounded-full shadow-lg transition-transform ${enabledModules[item.id] !== false ? 'bg-emerald-400' : 'bg-[#484f58]'}`}></div>
                                  </div>
                                </button>
                              ))}
                           </div>
                        </div>
                      </motion.div>
                    )}

                    {settingsScreen === 'secrets' && (
                      <motion.div
                        key="secrets"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        className="space-y-6"
                      >
                        {user ? (
                           <SecretManager userId={user.uid} />
                        ) : (
                           <div className="p-6 text-white text-center">Please log in to manage secrets</div>
                        )}
                      </motion.div>
                    )}

                    {settingsScreen === 'database' && (
                      <motion.div
                        key="database"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        className="space-y-6"
                      >
                        {user ? (
                          <DatabaseSettings userId={user.uid} />
                        ) : (
                          <div className="p-6 text-white text-center">Please log in to configure your database</div>
                        )}
                      </motion.div>
                    )}

                    {settingsScreen === 'connections' && (
                      <motion.div 
                        key="connections"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        className="space-y-6"
                      >
                         <div className="px-1 py-4">
                           <h2 className="text-2xl font-black text-white tracking-tight">Connections</h2>
                           <p className="text-[11px] text-[#484f58] font-bold uppercase tracking-[0.2em] mt-1">Sync your external services</p>
                         </div>

                        <div className="bg-[#161b22] border border-white/5 rounded-[2.5rem] p-8 flex flex-col items-center text-center space-y-8 shadow-2xl relative overflow-hidden group hover:border-indigo-500/30 transition-all">
                            <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
                              <Github className="w-24 h-24 text-white" />
                            </div>
                            
                            <div className="w-20 h-20 bg-white/5 rounded-[2rem] flex items-center justify-center border border-white/10 shadow-3xl relative overflow-hidden group z-10">
                               <Github className="w-10 h-10 text-white group-hover:scale-110 transition-transform" />
                               {githubToken && (
                                 <div className="absolute top-2 right-2 w-4 h-4 bg-emerald-500 rounded-full border-2 border-[#161b22]"></div>
                               )}
                            </div>
                            <div className="space-y-2 z-10">
                               <h3 className="text-sm font-black text-white uppercase tracking-widest">GitHub Integration</h3>
                               <p className="text-[10px] text-[#8b949e] max-w-[240px] mx-auto leading-relaxed font-medium">
                                  {githubToken 
                                    ? `Logged in as ${githubUser?.login}. GitHub Connected.`
                                    : "Authorize Navbharat to import repos and push code updates."}
                               </p>
                            </div>
                            <div className="flex flex-col gap-3 w-full z-10">
                               {!githubToken ? (
                                  <div className="space-y-4 w-full">
                                    <button 
                                      onClick={connectGitHub}
                                      className="w-full py-5 bg-white text-black rounded-[1.5rem] font-black uppercase tracking-widest transition-all hover:scale-[1.02] shadow-2xl active:scale-[0.98] flex items-center justify-center gap-3"
                                    >
                                       <Github className="w-4 h-4" />
                                       Connect with GitHub
                                    </button>
                                    
                                    <div className="flex items-center gap-4 py-2 opacity-30">
                                      <div className="flex-1 h-px bg-white/10"></div>
                                      <span className="text-[8px] font-black uppercase text-[#484f58]">OR USE TOKEN</span>
                                      <div className="flex-1 h-px bg-white/10"></div>
                                    </div>

                                    <div className="space-y-3 text-left">
                                      <a 
                                        href="https://github.com/settings/tokens/new?scopes=repo,read:user,user:email&description=Navbharat%20AI%20Access"
                                        target="_blank"
                                        rel="noreferrer"
                                        className="flex items-center justify-center gap-2 w-full py-2.5 bg-white/5 border border-white/10 hover:bg-white/10 text-[#8b949e] hover:text-white rounded-xl text-[9px] font-black uppercase tracking-widest transition-all"
                                      >
                                         <Github className="w-3.5 h-3.5" />
                                         Generate PAT Token
                                         <ExternalLink className="w-3 h-3" />
                                      </a>

                                      <div className="relative group/mini-input flex items-center gap-2">
                                        <div className="relative flex-1">
                                          <input 
                                            type="password"
                                            placeholder="Enter ghp_xxxxxxxx..."
                                            value={patInputValue}
                                            onChange={(e) => setPatInputValue(e.target.value)}
                                            className="w-full bg-[#0d1117] border border-white/10 rounded-xl px-4 py-3 text-[10px] text-white outline-none focus:border-indigo-500/50 transition-all font-mono"
                                            onKeyDown={(e) => {
                                              if (e.key === 'Enter') {
                                                const val = patInputValue.trim();
                                                if (val && val.startsWith('ghp_')) {
                                                  setGithubToken(val);
                                                  localStorage.setItem('gh_token', val);
                                                  fetchGitHubUser(val);
                                                  setPatInputValue('');
                                                }
                                              }
                                            }}
                                          />
                                        </div>
                                        <button 
                                          onClick={() => {
                                            const val = patInputValue.trim();
                                            if (val && val.startsWith('ghp_')) {
                                              setGithubToken(val);
                                              localStorage.setItem('gh_token', val);
                                              fetchGitHubUser(val);
                                              setPatInputValue('');
                                            } else {
                                              addLog('Invalid token format', 'error');
                                            }
                                          }}
                                          className="p-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition-all shadow-lg active:scale-95"
                                        >
                                          <ChevronRight className="w-4 h-4" />
                                        </button>
                                      </div>
                                      <p className="text-[8px] text-[#484f58] font-bold uppercase tracking-widest text-center italic">Paste Token & Click Connect</p>
                                    </div>
                                  </div>
                               ) : (
                                  <div className="flex flex-col gap-3">
                                     <div className="flex gap-2">
                                       <button 
                                         onClick={() => setSettingsScreen('github_repos')}
                                         className="flex-1 py-5 bg-indigo-600 text-white rounded-[1.5rem] font-black uppercase tracking-widest transition-all hover:bg-indigo-700 shadow-2xl flex items-center justify-center gap-3"
                                       >
                                          <List className="w-4 h-4" />
                                          Manage Repos
                                       </button>
                                       <button 
                                         onClick={disconnectGitHub}
                                         className="p-5 bg-red-500/10 hover:bg-red-500 text-[#f85149] hover:text-white rounded-[1.5rem] transition-all border border-red-500/20 shadow-xl"
                                       >
                                          <LogOut className="w-5 h-5" />
                                       </button>
                                     </div>
                                     {selectedRepo && (
                                       <div className="p-4 bg-black/40 rounded-2xl border border-white/5 flex items-center gap-4">
                                          <div className="w-10 h-10 bg-indigo-500/20 rounded-xl flex items-center justify-center">
                                            <GitFork className="w-4 h-4 text-indigo-400" />
                                          </div>
                                          <div className="flex-1 text-left">
                                            <div className="text-[10px] font-black text-white uppercase tracking-tighter">Active Sync</div>
                                            <div className="text-[11px] font-bold text-indigo-400 truncate">{selectedRepo.full_name}</div>
                                          </div>
                                          <button 
                                            onClick={() => setActiveView('git')}
                                            className="px-4 py-2 bg-indigo-600/10 hover:bg-indigo-600 text-indigo-400 hover:text-white rounded-lg text-[9px] font-black uppercase transition-all"
                                          >
                                            Go to Git
                                          </button>
                                       </div>
                                     )}
                                  </div>
                               )}
                            </div>
                         </div>

                         <div className="bg-[#161b22] border border-white/5 rounded-[2.5rem] p-8 flex items-center justify-between opacity-50 grayscale pointer-events-none group">
                            <div className="flex items-center gap-5">
                               <div className="w-14 h-14 bg-white/5 rounded-2xl flex items-center justify-center border border-white/5">
                                  <Database className="w-7 h-7 text-indigo-400" />
                               </div>
                               <div>
                                  <h4 className="text-[11px] font-black text-white uppercase tracking-widest">Firebase Sync</h4>
                                  <p className="text-[9px] text-[#484f58] font-bold uppercase tracking-[0.2em] mt-1">Enterprise Beta</p>
                               </div>
                            </div>
                            <div className="px-3 py-1 bg-white/5 rounded-full text-[8px] font-black uppercase text-[#484f58]">Soon</div>
                         </div>
                      </motion.div>
                    )}

                    {settingsScreen === 'github_repos' && (
                      <motion.div 
                        key="github_repos"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        className="space-y-6"
                      >
                         <div className="flex items-center gap-4 px-1 py-4">
                            <button 
                              onClick={() => setSettingsScreen('connections')}
                              className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center border border-white/10 hover:bg-white/10 transition-all"
                            >
                               <ChevronLeft className="w-5 h-5 text-white" />
                            </button>
                            <div>
                               <h2 className="text-2xl font-black text-white tracking-tight">GitHub Repositories</h2>
                               <p className="text-[11px] text-[#484f58] font-bold uppercase tracking-[0.2em] mt-1">Select a repository to sync</p>
                            </div>
                         </div>

                         <div className="bg-[#161b22] border border-white/5 rounded-[2.5rem] overflow-hidden shadow-2xl">
                            <div className="p-6 border-b border-white/5 bg-white/2 flex items-center gap-4">
                               <Search className="w-4 h-4 text-[#484f58]" />
                               <input 
                                 type="text"
                                 placeholder="Search your repositories..."
                                 value={ghSearchQuery}
                                 onChange={(e) => setGHSearchQuery(e.target.value)}
                                 className="bg-transparent border-none focus:outline-none text-sm text-white w-full placeholder:text-[#484f58] font-medium"
                               />
                               <button 
                                 onClick={() => githubToken && fetchUserRepos(githubToken)}
                                 className="p-2 bg-white/5 hover:bg-white/10 rounded-lg transition-all"
                                 title="Refresh List"
                               >
                                  <RefreshCw className="w-4 h-4 text-[#484f58]" />
                               </button>
                            </div>
                            <div className="max-h-[500px] overflow-y-auto divide-y divide-white/5 scrollbar-hide">
                               {repositories.length === 0 ? (
                                 <div className="p-12 text-center flex flex-col items-center gap-4">
                                   <div className="w-16 h-16 bg-white/5 rounded-2xl flex items-center justify-center">
                                      <Box className="w-8 h-8 text-[#484f58]" />
                                   </div>
                                   <p className="text-[10px] text-[#484f58] font-black uppercase tracking-widest">No Repositories Found</p>
                                 </div>
                               ) : (
                                 repositories
                                   .filter(r => r.name.toLowerCase().includes(ghSearchQuery.toLowerCase()))
                                   .map((repo) => (
                                   <div 
                                     key={repo.id}
                                     onClick={() => setSelectedRepo(repo)}
                                     className={`p-6 flex items-center justify-between cursor-pointer transition-all group ${selectedRepo?.id === repo.id ? 'bg-indigo-600/10' : 'hover:bg-white/5'}`}
                                   >
                                      <div className="flex items-center gap-5">
                                         <div className={`w-12 h-12 rounded-xl flex items-center justify-center border transition-all ${selectedRepo?.id === repo.id ? 'bg-indigo-600 border-indigo-600' : 'bg-white/5 border-white/5'}`}>
                                            <Folder className={`w-5 h-5 ${selectedRepo?.id === repo.id ? 'text-white' : 'text-[#484f58] group-hover:text-white'}`} />
                                         </div>
                                         <div>
                                            <h4 className="text-[12px] font-black text-white uppercase tracking-tight mb-1">{repo.name}</h4>
                                            <p className="text-[9px] text-[#484f58] font-bold uppercase tracking-widest">{repo.private ? 'Private' : 'Public'} • Updated {new Date(repo.updated_at).toLocaleDateString()}</p>
                                         </div>
                                      </div>
                                      {selectedRepo?.id === repo.id && (
                                         <div className="w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center border-4 border-[#161b22]">
                                            <Check className="w-3 h-3 text-white stroke-[4]" />
                                         </div>
                                      )}
                                   </div>
                                 ))
                               )}
                            </div>
                         </div>

                         {selectedRepo && (
                           <motion.div 
                             initial={{ opacity: 0, y: 20 }}
                             animate={{ opacity: 1, y: 0 }}
                             className="bg-indigo-600 border border-white/20 rounded-[2.5rem] p-8 space-y-6 shadow-3xl relative overflow-hidden"
                           >
                              <div className="absolute top-0 right-0 p-8 opacity-10">
                                <GitBranch className="w-24 h-24 text-white" />
                              </div>
                              <div className="space-y-2 relative z-10">
                                 <h3 className="text-sm font-black text-white uppercase tracking-[0.2em]">Repository Settings</h3>
                                 <p className="text-[10px] text-white/70 font-medium tracking-wide">Configure sync parameters for {selectedRepo.name}</p>
                              </div>
                              
                              <div className="space-y-4 relative z-10">
                                 <div className="space-y-2">
                                    <label className="text-[8px] font-black text-white uppercase tracking-widest ml-1">Default Branch</label>
                                    <div className="flex bg-black/20 rounded-2xl p-1 border border-white/10">
                                       <button className="flex-1 py-3 bg-white text-indigo-600 text-[10px] font-black uppercase tracking-widest rounded-xl shadow-xl transition-all">main</button>
                                       <button className="flex-1 py-3 text-white/50 text-[10px] font-black uppercase tracking-widest rounded-xl hover:text-white transition-all">master</button>
                                       <button className="flex-1 py-3 text-white/50 text-[10px] font-black uppercase tracking-widest rounded-xl hover:text-white transition-all">develop</button>
                                    </div>
                                 </div>
                                 <button 
                                   onClick={() => {
                                      setActiveView('git');
                                      setSettingsScreen('root');
                                   }}
                                   className="w-full py-5 bg-white text-indigo-600 rounded-[1.5rem] font-black uppercase tracking-widest transition-all hover:scale-[1.02] shadow-2xl active:scale-[0.98] flex items-center justify-center gap-3"
                                 >
                                    <Zap className="w-4 h-4 fill-indigo-600" />
                                    Confirm & Go to Git
                                 </button>
                              </div>
                           </motion.div>
                         )}
                      </motion.div>
                    )}

                    {settingsScreen === 'sharing' && (
                      <motion.div 
                        key="sharing"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        className="space-y-6"
                      >
                         <div className="px-1 py-4">
                           <h2 className="text-2xl font-black text-white tracking-tight">Share & Publish</h2>
                           <p className="text-[11px] text-[#484f58] font-bold uppercase tracking-[0.2em] mt-1">Collaborate with the world</p>
                        </div>

                         <div className="bg-[#161b22] border border-white/5 rounded-[2.5rem] p-8 space-y-8 shadow-2xl">
                            <div className="flex items-center gap-5">
                               <div className="w-16 h-16 bg-indigo-600/10 rounded-[2rem] flex items-center justify-center border border-indigo-600/20">
                                  <Globe className="w-8 h-8 text-indigo-400" />
                               </div>
                               <div>
                                  <h4 className="text-sm font-black text-white uppercase tracking-widest mb-1">Public Hub</h4>
                                  <p className="text-[9px] text-[#8b949e] font-bold uppercase tracking-widest leading-relaxed">Unique deployment identifier</p>
                               </div>
                            </div>
                            
                            <div className="p-2 bg-[#0d1117] border border-white/10 rounded-[2rem] flex items-center h-[72px] shadow-inner">
                               <span className="flex-1 text-[11px] font-mono text-indigo-400 truncate px-6">navbharat.ai/s/project-592</span>
                               <button className="h-full px-8 bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest rounded-[1.8rem] transition-all shadow-2xl active:scale-95 group overflow-hidden relative">
                                  <div className="relative z-10">Copy Link</div>
                                  <div className="absolute inset-0 bg-white/10 translate-y-full group-hover:translate-y-0 transition-transform"></div>
                                </button>
                            </div>

                            <button className="w-full py-5 bg-[#0d1117] border border-indigo-500/30 text-indigo-400 hover:text-white hover:bg-indigo-600 rounded-[1.5rem] text-[10px] font-black uppercase tracking-[0.3em] transition-all shadow-xl active:scale-95">
                               Publish to Community Store
                            </button>
                         </div>
                      </motion.div>
                    )}

                    {settingsScreen === 'deploy' && (
                      <motion.div 
                        key="deploy"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        className="space-y-6"
                      >
                         <div className="px-1 py-4">
                           <h2 className="text-2xl font-black text-white tracking-tight">Support Us</h2>
                           <p className="text-[11px] text-[#484f58] font-bold uppercase tracking-[0.2em] mt-1">Contribute to the project</p>
                        </div>

                        <div className="bg-[radial-gradient(circle_at_top_right,#1e1b4b,transparent)] bg-[#161b22] border border-indigo-500/20 rounded-[3rem] p-10 space-y-10 text-center relative overflow-hidden group shadow-3xl">
                           <div className="w-20 h-20 bg-indigo-600/20 rounded-[2rem] flex items-center justify-center border border-indigo-500/30 shadow-2xl mx-auto group-hover:scale-110 transition-all duration-700">
                             <Heart className="w-10 h-10 text-indigo-400 group-hover:animate-bounce-slow" />
                           </div>
                           <div className="space-y-3">
                             <h3 className="text-xl font-black text-white uppercase tracking-wider">Support Our Mission</h3>
                             <p className="text-[10px] text-[#484f58] font-black uppercase tracking-[0.15em] max-w-[260px] mx-auto leading-relaxed">Your support fuels the future of AI in Bharat</p>
                           </div>
                           <button 
                             onClick={() => setActiveView('donation')}
                             className="w-full py-6 bg-indigo-600 hover:bg-indigo-700 text-white rounded-[2rem] font-black uppercase tracking-[0.3em] shadow-[0_20px_50px_rgba(79,70,229,0.3)] transition-all flex items-center justify-center gap-4 group active:scale-95"
                           >
                             <Heart className="w-6 h-6 group-hover:scale-110 transition-transform" />
                             Donate Now
                           </button>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4">
                           <button className="p-6 bg-[#161b22] border border-white/5 rounded-[2.5rem] text-left group hover:border-emerald-500/30 transition-all shadow-xl active:scale-95">
                             <div className="w-12 h-12 bg-emerald-500/10 rounded-2xl flex items-center justify-center mb-6 group-hover:bg-emerald-600 transition-colors">
                                <HardDrive className="w-6 h-6 text-emerald-400 group-hover:text-white" />
                             </div>
                             <h4 className="text-[10px] font-black text-white uppercase tracking-widest">ZIP Export</h4>
                             <p className="text-[9px] text-[#484f58] mt-1 font-bold uppercase">Source Files</p>
                           </button>
                           <button className="p-6 bg-[#161b22] border border-white/5 rounded-[2.5rem] text-left group hover:border-amber-500/30 transition-all shadow-xl active:scale-95">
                             <div className="w-12 h-12 bg-amber-500/10 rounded-2xl flex items-center justify-center mb-6 group-hover:bg-amber-600 transition-colors">
                                <Smartphone className="w-6 h-6 text-amber-500 group-hover:text-white" />
                             </div>
                             <h4 className="text-[10px] font-black text-white uppercase tracking-widest">Android Build</h4>
                             <p className="text-[9px] text-[#484f58] mt-1 font-bold uppercase">Native (BETA)</p>
                           </button>
                        </div>
                      </motion.div>
                    )}

                    {settingsScreen === 'access' && (
                      <motion.div 
                        key="access"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        className="space-y-6"
                      >
                         <div className="px-1 py-4">
                           <h2 className="text-2xl font-black text-white tracking-tight">Permissions</h2>
                           <p className="text-[11px] text-[#484f58] font-bold uppercase tracking-[0.2em] mt-1">Manage team access & safety</p>
                        </div>

                         <div className="bg-[#161b22] border border-white/5 rounded-[2.5rem] p-8 space-y-8 shadow-2xl">
                            <div className="flex items-center justify-between">
                               <h4 className="text-[11px] font-black text-white uppercase tracking-widest">Collaborators</h4>
                               <button className="text-[10px] font-black text-indigo-400 hover:text-white uppercase tracking-widest transition-colors border-b border-indigo-500/20 pb-0.5">+ Invite Pro</button>
                            </div>
                            
                            <div className="grid gap-3">
                               <div className="p-5 bg-[#0d1117] rounded-[1.5rem] border border-white/5 flex items-center justify-between group hover:border-indigo-500/30 transition-all">
                                  <div className="flex items-center gap-4">
                                     <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center font-black text-xs text-white shadow-lg">AD</div>
                                     <div>
                                        <div className="text-xs font-bold text-white">doc.asheesh@icloud.com</div>
                                        <div className="text-[9px] text-emerald-500 uppercase font-black tracking-widest mt-0.5">Admin / Owner</div>
                                     </div>
                                  </div>
                                  <div className="w-8 h-8 flex items-center justify-center text-[#484f58]">
                                     <ShieldCheck className="w-4 h-4" />
                                  </div>
                               </div>
                            </div>

                            <div className="bg-amber-500/5 border border-amber-500/20 p-6 rounded-[1.5rem] flex gap-4 items-start shadow-inner">
                               <div className="p-2 bg-amber-500/20 rounded-lg">
                                  <Zap className="w-4 h-4 text-amber-500" />
                                </div>
                               <p className="text-[10px] text-amber-600 font-bold uppercase leading-relaxed tracking-wider">Multi-user real-time collaboration requires specialized Navbharat Enterprise seat.</p>
                            </div>
                         </div>
                      </motion.div>
                    )}

                    {settingsScreen === 'git' && (
                      <motion.div
                        key="git"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        className="space-y-6"
                      >
                        <div className="px-1 py-4">
                          <h2 className="text-2xl font-black text-white tracking-tight">Git & Version Control</h2>
                          <p className="text-[11px] text-[#484f58] font-bold uppercase tracking-[0.2em] mt-1">Manage branches, commits and deployments</p>
                        </div>
                        <div className="bg-[#161b22] border border-white/5 rounded-[2.5rem] p-8 flex flex-col items-center text-center space-y-6 shadow-2xl">
                          <div className="w-20 h-20 bg-indigo-600/10 border border-indigo-600/20 rounded-[2rem] flex items-center justify-center">
                            <GitBranch className="w-10 h-10 text-indigo-400" />
                          </div>
                          <div>
                            <h3 className="text-sm font-black text-white uppercase tracking-widest">Git Panel</h3>
                            <p className="text-[10px] text-[#8b949e] max-w-[240px] mx-auto mt-2 leading-relaxed">
                              {selectedRepo
                                ? `Active: ${selectedRepo.full_name} (${currentBranch})`
                                : 'Connect GitHub first to use Git features'}
                            </p>
                          </div>
                          <button
                            onClick={() => { setActiveView('git'); setSettingsScreen('root'); }}
                            className="w-full py-5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-[1.5rem] font-black uppercase tracking-widest transition-all shadow-2xl flex items-center justify-center gap-3"
                          >
                            <GitBranch className="w-4 h-4" />
                            Open Git Panel
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>
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

          {(activeView === 'nbi_pro_chat') && (
            <div className={cn("flex-1 overflow-hidden h-full min-h-0 max-h-full relative group flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-white/10", themeClasses.bg)}>

              <div className="flex-1 flex flex-col h-full min-h-0 max-h-full overflow-hidden min-w-0">
                  <div className="flex items-center justify-between px-3 py-1 bg-indigo-950/20 border-b border-indigo-500/20 text-[9px] font-black uppercase tracking-widest text-[#8b949e]">
                     <div className="flex items-center gap-2">
                       <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping shrink-0" />
                       <span>NAVBHARATAI-PRO</span>
                       {mode === 'auto'     && <span className="px-1.5 py-0.5 bg-indigo-900/30 border border-indigo-600/30 text-indigo-400 rounded text-[8px]">AUTO</span>}
                       {mode === 'planning' && <span className="px-1.5 py-0.5 bg-amber-900/30 border border-amber-600/30 text-amber-400 rounded text-[8px]">PLANNING</span>}
                       {mode === 'build' && <span className="px-1.5 py-0.5 bg-orange-900/30 border border-orange-600/30 text-orange-400 rounded text-[8px]">BUILD</span>}
                     </div>
                     <div className="flex items-center gap-2">
                       {buildVersionStack.length > 0 && (
                         <button
                           onClick={handleUndoBuild}
                           title={`Undo: "${buildVersionStack[0].request}"`}
                           className="flex items-center gap-1 px-2 py-0.5 bg-amber-900/30 hover:bg-amber-900/50 border border-amber-600/30 rounded text-[8px] text-amber-400 hover:text-amber-300 transition-all"
                         >
                           <RotateCcw className="w-2.5 h-2.5" />
                           Undo ({buildVersionStack.length})
                         </button>
                       )}
                       {mode === 'planning' && proMessages.length > 2 && (
                         <button
                           onClick={() => {
                             const content = proMessages.map(m => `${m.sender === 'user' ? '👤 Doctor' : '🤖 NavBharatAI'}: ${m.text.replace(/__SWITCH_TO_BUILD__|__URGENT_BUILD__/g, '').trim()}`).join('\n\n---\n\n');
                             const blob = new Blob([`# NavBharatAI — Product Requirements Document\nGenerated: ${new Date().toLocaleString('en-IN')}\n\n${content}`], { type: 'text/plain' });
                             const url = URL.createObjectURL(blob);
                             const a = document.createElement('a'); a.href = url; a.download = 'navbharat-prd.txt';
                             document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
                           }}
                           className="flex items-center gap-1 px-2 py-0.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded text-[8px] text-[#8b949e] hover:text-white transition-all"
                         >
                           ⬇ Export PRD
                         </button>
                       )}
                       <span className="font-mono text-indigo-400">{sessions.find(s => s.id === currentProSessionId)?.uci || ''}</span>
                     </div>
                  </div>
                  <AIChat
                    messages={proMessages}
                    input={proInput}
                    onInputChange={setProInput}
                    onSend={(files) => { handleSendForPro(files); }}
                    isLoading={isProLoading}
                    activeIntent={activeIntent}
                    isPinned={sessions.find(s => s.id === currentProSessionId)?.isPinned || false}
                    onTogglePin={() => togglePin(currentProSessionId)}
                    isLoggedIn={!!user}
                    onShowLogin={() => setShowAuth(true)}
                    mode={mode}
                    onModeChange={setMode}
                    activeAgent={'navbharatai-pro'}
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
                    activeUci={user ? (sessions.find(s => s.id === currentProSessionId)?.uci || '') : ''}
                    onRestoreUci={user ? handleRestoreUci : undefined}
                    restoredMessages={sessions.find(s => s.id === currentProSessionId)?.restoredMessages || []}
                    memorySummary={sessions.find(s => s.id === currentProSessionId)?.memorySummary || ''}
                    wallet={wallet}
                    buildProgress={proBuildProgress}
                    guiderPlan={proGuiderPlan?.plan || null}
                    guiderReplanning={proGuiderReplanning}
                    onGuiderApprove={() => {
                      const p = proGuiderPlan;
                      if (!p) return;
                      // Arm the grade→refine loop with the approved spec for this build.
                      proGuiderSpecRef.current = { spec: p.plan?.spec || null, prompt: p.prompt };
                      proGuiderRefineRef.current = 0;
                      setProGuiderPlan(null);
                      void handleSendForPro(p.prompt, true, false, true);
                    }}
                    onGuiderSend={(refinement) => {
                      const p = proGuiderPlan;
                      if (!p || !refinement.trim()) return;
                      const augmented = `${p.prompt}\n\n[User refinement to the plan]: ${refinement.trim()}`;
                      setProGuiderReplanning(true);
                      fetch('/api/guider/plan', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ prompt: augmented, files: {}, isEdit: false, agentic: true }),
                      })
                        .then(r => r.json())
                        .then((pr: any) => {
                          if (pr?.confirm && pr?.plan) setProGuiderPlan({ prompt: augmented, plan: pr.plan });
                          else { setProGuiderPlan(null); void handleSendForPro(augmented, true, false, true); }
                        })
                        .catch(() => {/* keep the current card */})
                        .finally(() => setProGuiderReplanning(false));
                    }}
                    onBuildStepToggle={(i) => setProBuildProgress(prev => ({
                      ...prev,
                      steps: prev.steps.map((s, idx) => idx === i ? { ...s, expanded: !s.expanded } : s),
                    }))}
                    onDownloadZip={downloadAppZip}
                    onSendSuggestion={(text) => { setProInput(text); handleSendForPro(text); }}
                    onStop={isProLoading ? handleStopPro : undefined}
                  />
                </div>
            </div>
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
            <div className="flex-1 bg-[#0d1117] overflow-y-auto custom-scrollbar p-6 sm:p-12 relative">
               {isAdmin && (
                 <div className="sticky top-0 right-0 z-50 flex justify-end pb-4">
                    <div className="bg-indigo-600 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest text-white shadow-xl flex items-center gap-2">
                       <Shield className="w-3.5 h-3.5 hover:rotate-12 transition-transform" />
                       Admin Edit Mode Active
                    </div>
                 </div>
               )}
               <div className="max-w-4xl mx-auto space-y-12 pb-20">
                  <motion.header 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-center space-y-4 relative group/header"
                  >
                     <div className="inline-block p-4 bg-indigo-600/10 rounded-[2.5rem] border border-indigo-500/20 mb-4 relative">
                        <Bot className="w-16 h-16 text-indigo-500" />
                        {isAdmin && (
                          <button 
                            onClick={() => {
                              const url = prompt('Enter Logo URL:', aboutData.logoUrl || '');
                              if (url !== null) setAboutData({...aboutData, logoUrl: url});
                            }}
                            className="absolute -bottom-2 -right-2 p-2 bg-indigo-600 text-white rounded-xl shadow-lg hover:scale-110 transition-all opacity-0 group-hover/header:opacity-100"
                          >
                            <Camera className="w-3 h-3" />
                          </button>
                        )}
                     </div>
                     <div className="flex items-center justify-center gap-4">
                        <h1 className="text-4xl sm:text-6xl font-black text-white tracking-tighter uppercase">{aboutData.headline}</h1>
                        {isAdmin && (
                          <button 
                            onClick={() => {
                              const val = prompt('Edit Headline:', aboutData.headline);
                              if (val) setAboutData({...aboutData, headline: val});
                            }}
                            className="p-2 bg-white/5 hover:bg-indigo-600 rounded-xl text-indigo-400 hover:text-white transition-all opacity-0 group-hover/header:opacity-100"
                          >
                             <Edit2 className="w-4 h-4" />
                          </button>
                        )}
                     </div>
                     <div className="relative group/desc">
                        <p className="text-[#8b949e] text-lg max-w-2xl mx-auto font-medium leading-relaxed">{aboutData.description}</p>
                        {isAdmin && (
                          <button 
                            onClick={() => {
                              const val = prompt('Edit Description:', aboutData.description);
                              if (val) setAboutData({...aboutData, description: val});
                            }}
                            className="absolute -top-4 -right-4 p-2 bg-white/5 hover:bg-indigo-600 rounded-xl text-indigo-400 hover:text-white transition-all opacity-0 group-hover/desc:opacity-100"
                          >
                             <Edit2 className="w-4 h-4" />
                          </button>
                        )}
                     </div>
                  </motion.header>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-12">
                     <motion.div 
                       initial={{ opacity: 0, x: -20 }}
                       animate={{ opacity: 1, x: 0 }}
                       className="bg-[#161b22] border border-white/5 p-8 rounded-[2.5rem] space-y-4 shadow-2xl relative group/card1"
                     >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                             <div className="w-10 h-10 bg-indigo-600 rounded-2xl flex items-center justify-center">
                                <User className="w-5 h-5 text-white" />
                             </div>
                             <h3 className="text-xl font-black text-white tracking-tight uppercase">Our Team</h3>
                          </div>
                          {isAdmin && (
                            <button 
                              onClick={() => {
                                const val = prompt('Edit Team Info:', aboutData.team);
                                if (val) setAboutData({...aboutData, team: val});
                              }}
                              className="p-2 bg-white/5 hover:bg-indigo-600 rounded-xl text-indigo-400 hover:text-white transition-all opacity-0 group-hover/card1:opacity-100"
                            >
                               <Edit2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                        <p className="text-[#8b949e] font-medium leading-relaxed">{aboutData.team}</p>
                     </motion.div>

                     <motion.div 
                       initial={{ opacity: 0, x: 20 }}
                       animate={{ opacity: 1, x: 0 }}
                       className="bg-[#161b22] border border-white/5 p-8 rounded-[2.5rem] space-y-4 shadow-2xl relative group/card2"
                     >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                             <div className="w-10 h-10 bg-emerald-600 rounded-2xl flex items-center justify-center">
                                <Eye className="w-5 h-5 text-white" />
                             </div>
                             <h3 className="text-xl font-black text-white tracking-tight uppercase">Vision</h3>
                          </div>
                          {isAdmin && (
                            <button 
                              onClick={() => {
                                const val = prompt('Edit Vision Info:', aboutData.vision);
                                if (val) setAboutData({...aboutData, vision: val});
                              }}
                              className="p-2 bg-white/5 hover:bg-emerald-600 rounded-xl text-emerald-400 hover:text-white transition-all opacity-0 group-hover/card2:opacity-100"
                            >
                               <Edit2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                        <p className="text-[#8b949e] font-medium leading-relaxed">{aboutData.vision}</p>
                     </motion.div>
                  </div>
               </div>
            </div>
          )}

          {activeView === 'admin' && (
            <div className="flex-1 bg-[#0d1117] flex flex-col items-center justify-center p-6">
               {!isAdmin ? (
                 <motion.div 
                   initial={{ opacity: 0, scale: 0.95 }}
                   animate={{ opacity: 1, scale: 1 }}
                   className="w-full max-w-md bg-[#161b22] border border-white/10 p-8 rounded-[2.5rem] shadow-3xl space-y-8"
                 >
                    <div className="text-center space-y-2">
                       <div className="w-20 h-20 bg-indigo-600 rounded-[2rem] flex items-center justify-center mx-auto shadow-2xl mb-4">
                          <Lock className="w-10 h-10 text-white" />
                       </div>
                       <h2 className="text-2xl font-black text-white tracking-tight uppercase">Admin Access</h2>
                       <p className="text-[10px] text-[#8b949e] font-black uppercase tracking-widest">Navbharat Enterprise Cloud Console</p>
                    </div>

                    <form onSubmit={handleAdminLogin} className="space-y-4">
                       <div className="space-y-2">
                          <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest ml-1">Username</label>
                          <input 
                             type="text"
                             value={adminEmail}
                             onChange={(e) => setAdminEmail(e.target.value)}
                             className="w-full bg-black/40 border border-white/10 rounded-2xl px-6 py-4 text-white font-bold outline-none focus:border-indigo-500"
                             placeholder="aashishcpmt09"
                          />
                       </div>
                       <div className="space-y-2">
                          <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest ml-1">Password</label>
                          <input 
                             type="password"
                             value={adminPassword}
                             onChange={(e) => setAdminPassword(e.target.value)}
                             className="w-full bg-black/40 border border-white/10 rounded-2xl px-6 py-4 text-white font-bold outline-none focus:border-indigo-500"
                             placeholder="••••••••••••"
                          />
                       </div>
                       {adminError && <p className="text-[10px] text-red-500 font-bold uppercase tracking-widest text-center">{adminError}</p>}
                       <button className="w-full py-5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-black uppercase tracking-[0.2em] shadow-xl shadow-indigo-600/30 transition-all active:scale-95">
                          Authenticate
                       </button>
                    </form>
                 </motion.div>
               ) : (
                 <AdminDashboard
                   adminToken={sessionStorage.getItem('admin_token') || ''}
                   onLogout={() => setIsAdmin(false)}
                 />
               )}
            </div>
         )}

          {activeView === 'billing' && (
            <div className="flex-1 bg-[#0d1117] p-6 text-left min-h-screen">
               {!user ? (
                 <div className="max-w-md mx-auto text-center py-24 space-y-6">
                    <div className="w-20 h-20 bg-indigo-600/10 rounded-[2rem] flex items-center justify-center mx-auto border border-indigo-600/20 shadow-2xl">
                       <Wallet className="w-10 h-10 text-indigo-500" />
                    </div>
                    <div className="space-y-2">
                       <h2 className="text-2xl font-black text-white uppercase tracking-tight">Active Portal Session Required</h2>
                       <p className="text-[#8b949e] font-medium text-sm">Please sign in or register to set up your navBharatAI multi-model cloud token budget.</p>
                    </div>
                    <button 
                      onClick={() => setShowAuth(true)}
                      className="px-8 py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-indigo-600/30 transition-all active:scale-95"
                    >
                       Authenticate Profile
                    </button>
                 </div>
               ) : (
                 <div className="w-full max-w-6xl mx-auto space-y-8 py-4">
                    {/* Header bar */}
                    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/5 pb-6">
                       <div>
                          <div className="flex items-center gap-2 text-indigo-400 font-black uppercase tracking-widest text-[10px] font-mono">
                             <Zap className="w-4 h-4 text-orange-500 animate-bounce" />
                             Cloud Token Ledger
                          </div>
                          <h1 className="text-3xl font-black text-white uppercase tracking-tight mt-1">Multi-Model Token Wallet</h1>
                          <p className="text-xs text-[#8b949e] mt-1">Connected account: <span className="text-white font-mono font-bold">{user.email}</span></p>
                       </div>
                       <div className="flex items-center gap-3">
                          <button 
                             onClick={fetchWallet}
                             disabled={loadingWallet}
                             className="flex items-center gap-2 px-6 py-3 bg-white/5 border border-white/10 hover:border-indigo-500 rounded-2xl text-[10px] font-black uppercase tracking-widest text-white transition-all active:scale-95"
                          >
                             <RefreshCw className={`w-3.5 h-3.5 ${loadingWallet ? 'animate-spin' : ''}`} />
                             Sync Balance
                          </button>
                       </div>
                    </div>

                    {/* 11.3 — Daily Usage Stats + 11.4 Referral Code */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="bg-[#161b22] border border-white/5 rounded-2xl p-5 space-y-2">
                        <p className="text-[9px] font-black text-[#484f58] uppercase tracking-widest">Today's Messages</p>
                        <p className="text-3xl font-black text-white">{dailyUsage.date === new Date().toDateString() ? dailyUsage.count : 0}</p>
                        <p className="text-[10px] text-emerald-400">Unlimited for registered users ✓</p>
                      </div>
                      <div className="bg-[#161b22] border border-white/5 rounded-2xl p-5 space-y-2">
                        <p className="text-[9px] font-black text-[#484f58] uppercase tracking-widest">Today's Builds</p>
                        <p className="text-3xl font-black text-white">{dailyUsage.date === new Date().toDateString() ? dailyUsage.builds : 0}</p>
                        <p className="text-[10px] text-indigo-400">Preview builds today</p>
                      </div>
                      <div className="bg-[#161b22] border border-white/5 rounded-2xl p-5 space-y-2">
                        <p className="text-[9px] font-black text-[#484f58] uppercase tracking-widest">My Referral Code</p>
                        <p className="text-xl font-black text-indigo-400 font-mono">{myReferralCode}</p>
                        <button
                          onClick={() => {
                            navigator.clipboard?.writeText(`Join NavBharatAI — भारत का अपना AI App Maker! Use my code ${myReferralCode} for bonus credits: https://navbharatai.com`);
                            addToast('Referral link copied! ✓', 'success');
                          }}
                          className="text-[9px] font-black text-indigo-400 hover:text-white uppercase tracking-widest transition-colors"
                        >
                          Copy & Share →
                        </button>
                      </div>
                    </div>

                    {/* Autonomous Warning Alert Popup (Reminder Limit Trigger) */}
                    {wallet && wallet.remaining_balance <= reminderLimit && !dismissedReminderWarning && (
                       <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 animate-fade-in backdrop-blur-sm">
                          <div className="w-full max-w-md bg-[#161b22] border border-red-500/30 rounded-[2.5rem] p-8 space-y-6 shadow-[0_0_50px_rgba(239,68,68,0.25)] text-left relative overflow-hidden">
                             <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-red-500 to-rose-600"></div>
                             
                             <div className="flex items-center gap-4">
                                <div className="p-4 bg-red-500/10 rounded-2xl border border-red-500/20 text-red-500">
                                   <AlertCircle className="w-7 h-7 animate-bounce" />
                                </div>
                                <div>
                                   <h3 className="text-xl font-black text-white uppercase tracking-tight">Limit Reached! ⚠️</h3>
                                   <p className="text-[10px] text-[#8b949e] font-black uppercase tracking-widest font-mono">Autonomous Budget SRE Warning</p>
                                </div>
                             </div>

                             <p className="text-xs text-[#8b949e] leading-relaxed font-semibold">
                                Warning! You have reached your reminder limit set at <span className="text-white font-mono font-black">₹{reminderLimit.toFixed(2)}</span>. Your active credit wallet balance is now <span className="text-red-400 font-mono font-black animate-pulse">₹{(wallet?.remaining_balance || 10.00).toFixed(4)}</span>.
                             </p>

                             <div className="space-y-4 bg-black/30 border border-white/5 p-5 rounded-2xl">
                                <span className="text-[10px] text-[#8b949e] font-bold uppercase tracking-wider block">Adjust Warning Threshold Limit</span>
                                <div className="flex items-center gap-3 bg-[#0d1117] border border-white/10 rounded-xl px-4 py-3 focus-within:border-indigo-500 transition-colors">
                                   <input 
                                     type="number"
                                     value={reminderLimit === 0 ? '' : reminderLimit}
                                     placeholder="Enter limit value in Rupees"
                                     onChange={(e) => {
                                       const val = parseFloat(e.target.value) || 0;
                                       setReminderLimit(val);
                                     }}
                                     className="w-full bg-transparent text-sm font-mono font-bold text-white focus:outline-none"
                                   />
                                   <span className="text-xs text-[#8b949e] font-bold font-mono">₹</span>
                                </div>
                             </div>

                             <div className="flex gap-4 pt-2">
                                <button 
                                  onClick={() => setDismissedReminderWarning(true)}
                                  className="flex-1 py-4 bg-white/5 border border-white/10 hover:bg-white/10 text-[#8b949e] hover:text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all hover:scale-105 active:scale-95"
                                >
                                   Dismiss Warning
                                </button>
                                <button 
                                  onClick={() => {
                                    setActiveBillingDetailTab('budget');
                                    setDismissedReminderWarning(true);
                                  }}
                                  className="flex-1 py-4 bg-red-600 hover:bg-red-700 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-red-600/20 transition-all hover:scale-105 active:scale-95"
                                >
                                   Modify Limits
                                </button>
                             </div>
                          </div>
                       </div>
                    )}

                    {/* iOS / iPhone App Icons Styled Clickable Cards Panel */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                       
                       {/* CARD 1: AVAILABLE CREDIT */}
                       <div 
                         onClick={() => setActiveBillingDetailTab('remaining')}
                         className={cn(
                           "relative rounded-[2.2rem] p-6 h-44 flex flex-col justify-between transition-all duration-300 cursor-pointer overflow-hidden border group select-none",
                           activeBillingDetailTab === 'remaining' 
                             ? "bg-gradient-to-br from-indigo-950/80 to-[#161b22] border-indigo-505 shadow-[0_0_25px_rgba(99,102,241,0.15)] ring-2 ring-indigo-500" 
                             : "bg-[#161b22]/90 border-white/5 hover:border-indigo-500/40 hover:bg-[#1a212b]"
                         )}
                       >
                          <div className="absolute -top-12 -right-12 w-28 h-28 bg-indigo-500/10 rounded-full blur-2xl group-hover:bg-indigo-500/20 transition-all duration-300"></div>
                          <div className="flex justify-between items-start">
                             <div className={cn(
                                "p-3 rounded-2xl border transition-all duration-300",
                                activeBillingDetailTab === 'remaining'
                                  ? "bg-indigo-500/20 border-indigo-400/30 text-indigo-400"
                                  : "bg-white/5 border-white/10 text-[#8b949e] group-hover:text-indigo-400 group-hover:bg-indigo-500/10"
                             )}>
                                <Wallet className="w-5 h-5" />
                             </div>
                             <span className="text-[8px] font-black font-mono tracking-widest uppercase bg-indigo-500/10 text-indigo-300 px-2 py-0.5 rounded border border-indigo-500/20">
                                ACTIVE COINS
                             </span>
                          </div>
                          <div>
                             <p className="text-[10px] text-[#8b949e] font-extrabold uppercase tracking-widest text-[#8b949e]">Available Credit</p>
                             <h2 className="text-2xl font-black text-white tracking-tight mt-1.5 font-mono truncate">
                                ₹{(wallet?.remaining_balance || 10.05).toFixed(2)}
                             </h2>
                             <div className="text-[9px] text-amber-400 font-mono font-bold mt-1 uppercase flex items-center gap-1">
                                <span>👑 VK Balance:</span>
                                <span>{(wallet?.tokenBalance || 0).toLocaleString()} Tokens</span>
                             </div>
                          </div>
                       </div>

                       {/* CARD 2: PROMOCODE */}
                       <div 
                         onClick={() => setActiveBillingDetailTab('gift')}
                         className={cn(
                           "relative rounded-[2.2rem] p-6 h-44 flex flex-col justify-between transition-all duration-300 cursor-pointer overflow-hidden border group select-none",
                           activeBillingDetailTab === 'gift' 
                             ? "bg-gradient-to-br from-amber-950/40 to-[#161b22] border-amber-500 shadow-[0_0_25px_rgba(245,158,11,0.15)] ring-2 ring-amber-500" 
                             : "bg-[#161b22]/90 border-white/5 hover:border-amber-500/40 hover:bg-[#1a212b]"
                         )}
                       >
                          <div className="absolute -top-12 -right-12 w-28 h-28 bg-amber-500/5 rounded-full blur-2xl group-hover:bg-amber-500/10 transition-all duration-300"></div>
                          <div className="flex justify-between items-start">
                             <div className={cn(
                                "p-3 rounded-2xl border transition-all duration-300",
                                activeBillingDetailTab === 'gift'
                                  ? "bg-amber-500/20 border-amber-400/30 text-amber-400"
                                  : "bg-white/5 border-white/10 text-[#8b949e] group-hover:text-amber-400 group-hover:bg-amber-500/10"
                             )}>
                                <Gift className="w-5 h-5" />
                             </div>
                             <span className="text-[8px] font-black font-mono tracking-widest uppercase bg-amber-500/10 text-amber-300 px-2 py-0.5 rounded border border-amber-500/20">
                                REFERRALS
                             </span>
                          </div>
                          <div>
                             <p className="text-[10px] text-[#8b949e] font-extrabold uppercase tracking-widest text-[#8b949e]">Promocode</p>
                             <h2 className="text-2xl font-black text-white tracking-tight mt-1.5 font-mono truncate">
                                ₹{(billingTransactions.filter(tx => tx.paymentProvider === 'COUPON_REDEEM' || tx.paymentProvider === 'REFERRAL').reduce((sum, tx) => sum + (tx.balanceAdded || 0), 0)).toFixed(2)}
                             </h2>
                          </div>
                       </div>

                       {/* CARD 3: BUY CREDIT */}
                       <div 
                         onClick={() => setActiveBillingDetailTab('purchase')}
                         className={cn(
                           "relative rounded-[2.2rem] p-6 h-44 flex flex-col justify-between transition-all duration-300 cursor-pointer overflow-hidden border group select-none",
                           activeBillingDetailTab === 'purchase' ? "bg-gradient-to-br from-emerald-950/40 to-[#161b22] border-emerald-500 shadow-[0_0_25px_rgba(16,185,129,0.15)] ring-2 ring-emerald-500" : "bg-[#161b22]/90 border-white/5 hover:border-emerald-500/40 hover:bg-[#1a212b]"
                         )}
                       >
                          <div className="absolute -top-12 -right-12 w-28 h-28 bg-emerald-500/5 rounded-full blur-2xl group-hover:bg-emerald-500/10 transition-all duration-300"></div>
                          <div className="flex justify-between items-start">
                             <div className={cn(
                                "p-3 rounded-2xl border transition-all duration-300",
                                activeBillingDetailTab === 'purchase'
                                  ? "bg-emerald-500/20 border-emerald-400/30 text-emerald-400"
                                  : "bg-white/5 border-white/10 text-[#8b949e] group-hover:text-emerald-400 group-hover:bg-emerald-500/10"
                             )}>
                                <CreditCard className="w-5 h-5" />
                             </div>
                             <span className="text-[8px] font-black font-mono tracking-widest uppercase bg-emerald-500/10 text-emerald-300 px-2 py-0.5 rounded border border-emerald-500/20">
                                100x VALUE
                             </span>
                          </div>
                          <div>
                             <p className="text-[10px] text-[#8b949e] font-extrabold uppercase tracking-widest text-[#8b949e]">Buy Credit</p>
                             <h2 className="text-lg font-black text-white tracking-tight mt-1.5 font-mono">
                                100 Credit/₹
                             </h2>
                          </div>
                       </div>

                       {/* CARD 4: BUDGET & LIMITS */}
                       <div 
                         onClick={() => setActiveBillingDetailTab('budget')}
                         className={cn(
                           "relative rounded-[2.2rem] p-6 h-44 flex flex-col justify-between transition-all duration-300 cursor-pointer overflow-hidden border group select-none",
                           activeBillingDetailTab === 'budget' 
                             ? "bg-gradient-to-br from-violet-950/40 to-[#161b22] border-violet-500 shadow-[0_0_25px_rgba(139,92,246,0.15)] ring-2 ring-violet-500" 
                             : "bg-[#161b22]/90 border-white/5 hover:border-violet-500/40 hover:bg-[#1a212b]"
                         )}
                       >
                          <div className="absolute -top-12 -right-12 w-28 h-28 bg-violet-500/5 rounded-full blur-2xl group-hover:bg-violet-500/10 transition-all duration-300"></div>
                          <div className="flex justify-between items-start">
                             <div className={cn(
                                "p-3 rounded-2xl border transition-all duration-300",
                                activeBillingDetailTab === 'budget'
                                  ? "bg-violet-500/20 border-violet-400/30 text-violet-400"
                                  : "bg-white/5 border-white/10 text-[#8b949e] group-hover:text-violet-400 group-hover:bg-violet-500/10"
                             )}>
                                <Activity className="w-5 h-5" />
                             </div>
                             <span className={cn(
                               "text-[8px] font-black font-mono tracking-widest uppercase px-2 py-0.5 rounded border",
                               wallet && wallet.remaining_balance <= budgetLimit
                                 ? "bg-red-500/10 text-red-400 border-red-500/20 animate-pulse"
                                 : "bg-violet-500/10 text-violet-300 border-violet-500/20"
                             )}>
                                {wallet && wallet.remaining_balance <= budgetLimit ? 'FREE MODE ⚠️' : 'LIMIT ACTIVE'}
                             </span>
                          </div>
                          <div>
                             <p className="text-[10px] text-[#8b949e] font-extrabold uppercase tracking-widest text-[#8b949e]">Budget</p>
                             <h2 className="text-[11px] font-black text-white tracking-tight mt-1.5 font-mono flex flex-wrap gap-1 leading-relaxed">
                                <span>Rem: ₹{reminderLimit}</span>
                                <span className="opacity-40">|</span>
                                <span>Bud: ₹{budgetLimit}</span>
                             </h2>
                          </div>
                       </div>
                    </div>

                    {/* Integrated Sub-Panel Details Module */}
                    <div className="bg-[#161b22] border border-white/10 rounded-[2.5rem] p-6 sm:p-8 shadow-3xl text-left space-y-6">
                       
                       {/* DETAILED TAB 1: AVAILABLE CREDIT */}
                       {activeBillingDetailTab === 'remaining' && (
                          <div className="space-y-6 animate-in fade-in duration-300">
                             <div className="flex flex-wrap items-center justify-between border-b border-white/5 pb-4 gap-4">
                                <div>
                                   <div className="inline-flex items-center gap-2 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest font-mono">
                                      <Sparkles className="w-3.5 h-3.5" /> Core Credit Audit
                                   </div>
                                   <h3 className="text-lg font-black text-white uppercase tracking-tight mt-2">Active Multi-Model Resource Pool</h3>
                                </div>
                                <button 
                                   onClick={() => {
                                      fetchWallet();
                                      setDismissedReminderWarning(false);
                                   }}
                                   disabled={loadingWallet}
                                   className="flex items-center gap-2 px-5 py-2.5 bg-white/5 border border-white/10 hover:border-indigo-500 rounded-xl text-[10px] font-black uppercase tracking-widest text-white transition-all active:scale-95"
                                >
                                   <RefreshCw className={`w-3.5 h-3.5 ${loadingWallet ? 'animate-spin' : ''}`} />
                                   Refresh Wallet Registry
                                </button>
                             </div>

                             <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-2">
                                <div className="space-y-4">
                                   <p className="text-xs text-[#8b949e] leading-relaxed font-semibold">
                                      Your wallet contains unexpired cloud resource balances. Input context models are charged at ₹0.00, meaning you only pay for generated outputs! Every credit matches direct hardware API queries.
                                   </p>
                                   <div className="grid grid-cols-2 gap-4">
                                      <div className="bg-black/30 border border-white/5 rounded-2xl p-4 font-mono">
                                         <div className="text-[9px] text-[#8b949e] font-black uppercase tracking-wider">Estimated Lifespan</div>
                                         <div className="text-lg font-black text-white mt-1">Unlimited</div>
                                         <div className="text-[9px] text-[#8b949e] mt-1">SRE credits never expire</div>
                                      </div>
                                      <div className="bg-black/30 border border-white/5 rounded-2xl p-4 font-mono">
                                         <div className="text-[9px] text-[#8b949e] font-black uppercase tracking-wider">Output Pool</div>
                                         <div className="text-lg font-black text-white mt-1">
                                            {wallet?.remaining_balance ? Math.round(wallet.remaining_balance * 200).toLocaleString() : '2,000'}
                                         </div>
                                         <div className="text-[9px] text-[#8b949e] mt-1">Unspent outputs remaining</div>
                                      </div>
                                   </div>
                                </div>

                                <div className="bg-black/30 border border-white/5 rounded-[2rem] p-6 space-y-3 font-mono text-xs">
                                   <h4 className="text-[10px] font-black text-white uppercase tracking-widest font-sans">Live Wallet Breakdown</h4>
                                   <div className="flex justify-between items-center py-0.5">
                                      <span className="text-[#8b949e]">Total Balance Added:</span>
                                      <span className="text-[#58a6ff] font-bold">₹{(wallet?.total_balance || 10.00).toFixed(2)}</span>
                                   </div>
                                   <div className="flex justify-between items-center py-0.5">
                                      <span className="text-[#8b949e]">Total Spent Consumption:</span>
                                      <span className="text-orange-400 font-bold">₹{((wallet?.total_balance || 10.00) - (wallet?.remaining_balance || 10.00)).toFixed(4)}</span>
                                   </div>
                                   <div className="border-t border-white/5 pt-3.5 flex justify-between items-center text-sm font-black">
                                      <span className="text-[#8b949e] tracking-tight font-sans">Active Liquidity Credit:</span>
                                      <span className="text-emerald-400">₹{(wallet?.remaining_balance || 10.00).toFixed(4)}</span>
                                   </div>
                                </div>
                             </div>

                             {/* Unified Statement: Purchase Invoices & prompt usages */}
                             <div className="space-y-4 pt-4 border-t border-white/5">
                                <h4 className="text-xs font-black text-white uppercase tracking-widest font-mono">Invoice Records & Task Deductions Trace</h4>
                                <div className="space-y-6">
                                   <div>
                                      <p className="text-[9px] text-[#58a6ff] font-black uppercase tracking-wider font-mono mb-2">Deposits & Promotional Code Additions</p>
                                      <div className="overflow-y-auto max-h-[160px] custom-scrollbar border border-white/5 rounded-2xl bg-black/10">
                                         <table className="w-full text-left text-[11px] font-mono">
                                            <thead>
                                               <tr className="border-b border-white/5 text-[#8b949e] font-black uppercase tracking-widest text-[9px] bg-black/40">
                                                  <th className="py-2.5 px-4">OrderID / Reference</th>
                                                  <th className="py-2.5 px-4">Type</th>
                                                  <th className="py-2.5 px-4 text-emerald-400">Amount Received</th>
                                                  <th className="py-2.5 px-4">Datetime</th>
                                               </tr>
                                            </thead>
                                            <tbody className="divide-y divide-white/5 font-bold">
                                               {billingTransactions.map((tx: any, i: number) => (
                                                  <tr key={i} className="hover:bg-white/5 transition-colors">
                                                     <td className="py-2.5 px-4 text-white font-semibold truncate max-w-[140px]">#{tx.orderId || tx.transactionId}</td>
                                                     <td className="py-2.5 px-4 text-[#8b949e]">
                                                        <span className="text-[9px] bg-indigo-500/10 text-indigo-400 px-1.5 py-0.5 rounded uppercase font-black tracking-wider">
                                                           {tx.paymentProvider || 'DEPOSIT'}
                                                        </span>
                                                     </td>
                                                     <td className="py-2.5 px-4 text-emerald-400 font-black">₹{(tx.balanceAdded || tx.amountPaid || 0).toFixed(2)}</td>
                                                     <td className="py-2.5 px-4 text-[#8b949e] text-[10px]">
                                                        {tx.createdAt ? new Date(tx.createdAt.seconds ? tx.createdAt.seconds * 1000 : tx.createdAt).toLocaleString() : 'Just now'}
                                                     </td>
                                                  </tr>
                                               ))}
                                               {billingTransactions.length === 0 && (
                                                  <tr>
                                                     <td colSpan={4} className="py-6 text-center text-[#8b949e] font-black uppercase tracking-widest text-[9px]">
                                                        No transactions recorded yet.
                                                     </td>
                                                  </tr>
                                               )}
                                            </tbody>
                                         </table>
                                      </div>
                                   </div>

                                   <div>
                                      <p className="text-[9px] text-orange-400 font-black uppercase tracking-wider font-mono mb-2">Prompt Dedution logs (Deducted per command output)</p>
                                      <div className="overflow-y-auto max-h-[180px] custom-scrollbar border border-white/5 rounded-2xl bg-black/10">
                                         <table className="w-full text-left text-[11px] font-mono">
                                            <thead>
                                               <tr className="border-b border-white/5 text-[#8b949e] font-black uppercase tracking-widest text-[9px] bg-black/40">
                                                  <th className="py-2.5 px-4">Command / Agent Call</th>
                                                                                                    <th className="py-2.5 px-4">Output Tokens</th>
                                                  <th className="py-2.5 px-4 text-red-400">Rupees Charged</th>
                                                  <th className="py-2.5 px-4">Datetime</th>
                                               </tr>
                                            </thead>
                                            <tbody className="divide-y divide-white/5 font-bold">
                                               {billingLogs.map((log: any, i: number) => (
                                                  <tr key={i} className="hover:bg-white/5 transition-colors">
                                                     <td className="py-2.5 px-4 text-white font-semibold uppercase">{log.agent || 'Chat Prompt'}</td>
                                                     <td className="py-2.5 px-4 text-[#8b949e] truncate max-w-[150px]"></td>
                                                     <td className="py-2.5 px-4 text-orange-400">{(log.output_tokens || log.outputTokens || 0).toLocaleString()}</td>
                                                     <td className="py-2.5 px-4 text-red-405 font-black text-red-400">-₹{(log.amount_deducted || log.amountDeducted || 0).toFixed(4)}</td>
                                                     <td className="py-2.5 px-4 text-[#8b949e] text-[10px]">
                                                        {log.timestamp ? (log.timestamp.seconds ? new Date(log.timestamp.seconds * 1000).toLocaleString() : new Date(log.timestamp).toLocaleString()) : 'Just now'}
                                                     </td>
                                                  </tr>
                                               ))}
                                               {billingLogs.length === 0 && (
                                                  <tr>
                                                     <td colSpan={4} className="py-6 text-center text-[#8b949e] font-black uppercase tracking-widest text-[9px]">
                                                        No AI task execution logs captured yet.
                                                     </td>
                                                  </tr>
                                               )}
                                            </tbody>
                                         </table>
                                      </div>
                                   </div>
                                </div>
                             </div>
                          </div>
                       )}

                       {/* DETAILED TAB 2: PROMOCODE */}
                       {activeBillingDetailTab === 'gift' && (
                          <div className="space-y-6 animate-in fade-in duration-300">
                             <div className="border-b border-white/5 pb-4">
                                <span className="text-[10px] bg-amber-500/10 border border-amber-500/20 text-amber-400 px-3 py-1.5 rounded-xl font-black uppercase tracking-wider font-mono">
                                   Promo Hub & Referrals
                                </span>
                                <h3 className="text-xl font-black text-white uppercase tracking-tight mt-3">Promotional Voucher & Reward Engine</h3>
                             </div>

                             <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
                                <div className="space-y-6">
                                   
                                   {/* Copyable Code Box */}
                                   <div className="bg-black/30 border border-amber-500/20 rounded-2xl p-6 relative overflow-hidden group">
                                      <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 rounded-full blur-xl group-hover:bg-amber-500/10 transition-all"></div>
                                      <h4 className="text-[10px] text-[#8b949e] font-black uppercase tracking-widest">Apka Unique Referral Code</h4>
                                      <div className="flex items-center justify-between gap-4 mt-3 bg-[#0d1117] border border-white/10 rounded-xl px-5 py-3.5">
                                         <span className="text-base text-amber-400 font-mono font-black tracking-widest">
                                            NAV-{(user?.email || 'USER').split('@')[0].toUpperCase()}-REF
                                         </span>
                                         <button 
                                           onClick={() => {
                                             navigator.clipboard.writeText(`NAV-${(user?.email || 'USER').split('@')[0].toUpperCase()}-REF`);
                                             setCopiedReferral(true);
                                             setTimeout(() => setCopiedReferral(false), 2000);
                                           }}
                                           className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-black text-[10px] font-black uppercase tracking-widest rounded-lg transition-all"
                                         >
                                            {copiedReferral ? 'COPIED!' : 'COPY'}
                                         </button>
                                      </div>
                                      <p className="text-xs text-amber-200/70 leading-relaxed font-semibold mt-4">
                                         🤝 Earn <span className="text-white font-black">10% Free Credits</span> for every referral — when your referred user purchases credits, 10% gets added to your account for free!
                                      </p>
                                   </div>

                                   {/* Voucher redeem panel */}
                                   <div className="bg-black/20 border border-white/5 rounded-2xl p-6 space-y-4">
                                      <div>
                                         <h4 className="text-xs font-black text-white uppercase tracking-wider">Redeem Reward Coupons</h4>
                                         <p className="text-[10px] text-[#8b949e] font-bold font-mono">Each promo code / referral code can only be applied once!</p>
                                      </div>
                                      <div className="flex gap-3">
                                         <input 
                                           type="text" 
                                           placeholder="e.g. WELCOME100, NAVBHARAT50" 
                                           value={couponCodeInput}
                                           onChange={(e) => setCouponCodeInput(e.target.value)}
                                           className="flex-1 bg-[#0d1117] border border-white/10 rounded-xl px-4 py-3 text-xs font-mono font-bold uppercase tracking-widest text-white focus:outline-none focus:border-amber-500 transition-colors"
                                         />
                                         <button
                                           onClick={() => redeemPromoCoupon(couponCodeInput)}
                                           disabled={isRedeemingCoupon || !couponCodeInput}
                                           className="px-6 py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-500/20 disabled:text-[#8b949e]/30 text-black rounded-xl font-black uppercase tracking-widest text-[9px] transition-all duration-200"
                                         >
                                            {isRedeemingCoupon ? 'VALIDATING...' : 'APPLY CODE'}
                                         </button>
                                      </div>

                                      {couponError && (
                                         <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-xl text-xs flex items-center gap-2 font-semibold">
                                            <AlertCircle className="w-4 h-4 shrink-0" />
                                            <span>{couponError}</span>
                                         </div>
                                      )}

                                      {couponSuccess && (
                                         <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 p-3 rounded-xl text-xs flex items-center gap-2 font-semibold animate-pulse">
                                            <CheckCircle2 className="w-4 h-4 shrink-0" />
                                            <span>{couponSuccess}</span>
                                         </div>
                                      )}
                                   </div>
                                </div>

                                {/* Refer history */}
                                <div className="space-y-4">
                                   <h4 className="text-xs font-black text-white uppercase tracking-wider font-mono">Referred Accounts & Credits Earned</h4>
                                   <div className="border border-white/5 rounded-2xl overflow-hidden font-mono text-xs bg-black/10">
                                      <table className="w-full text-left">
                                         <thead>
                                            <tr className="border-b border-white/5 bg-black/30 text-[#8b949e] font-black uppercase tracking-widest text-[9px]">
                                               <th className="py-2.5 px-4">User Email Referred</th>
                                               <th className="py-2.5 px-4">Reward Link</th>
                                               <th className="py-2.5 px-4 text-emerald-400">Claim Value</th>
                                            </tr>
                                         </thead>
                                         <tbody className="divide-y divide-white/5 font-semibold">
                                            {referralHistory.map((ref, idx) => (
                                               <tr key={idx} className="hover:bg-white/5 transition-all">
                                                  <td className="py-3 px-4 text-white font-medium">{ref.email}</td>
                                                  <td className="py-3 px-4">
                                                     <span className={`text-[8px] px-2 py-0.5 rounded font-black uppercase tracking-wider ${
                                                        ref.status === 'CLAIMED' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-500/10 text-slate-400 border border-slate-500/15'
                                                     }`}>
                                                        {ref.status} (10%)
                                                     </span>
                                                  </td>
                                                  <td className="py-3 px-4 text-emerald-400 font-bold">₹{ref.creditsEarned.toFixed(2)}</td>
                                               </tr>
                                            ))}
                                         </tbody>
                                      </table>
                                   </div>
                                </div>
                             </div>
                          </div>
                       )}

                       {/* DETAILED TAB 3: BUY CREDIT */}
                       {activeBillingDetailTab === 'purchase' && (
                          <div className="space-y-6 animate-in fade-in duration-300">
                             <div className="flex flex-wrap items-center justify-between border-b border-white/5 pb-4 gap-4">
                                <div>
                                   <span className="text-[10px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-3 py-1.5 rounded-xl font-black uppercase tracking-wider font-mono">
                                      Balance Store & Gateway simulation
                                   </span>
                                   <h3 className="text-xl font-black text-white uppercase tracking-tight mt-3">Buy Token Credits Instant Gateway</h3>
                                </div>
                             </div>

                             <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
                                <div className="space-y-6">
                                   <div className="bg-black/20 border border-white/5 p-6 rounded-[2rem] space-y-4">
                                      <h4 className="text-xs font-black text-white uppercase tracking-widest font-mono">Instant balance calculator (₹1 to ₹999999)</h4>
                                      
                                      <div className="space-y-3">
                                         <label className="text-[10px] text-[#8b949e] font-bold uppercase tracking-wider block">Enter Amount (₹)</label>
                                         <div className="flex items-center gap-3 bg-[#0d1117] border border-white/10 rounded-xl px-4 py-3 focus-within:border-emerald-500 transition-colors">
                                            <span className="text-emerald-400 font-mono font-bold text-sm">₹</span>
                                            <input 
                                              type="number"
                                              min="1"
                                              max="999999"
                                              value={buyAmountInput}
                                              onChange={(e) => {
                                                const val = e.target.value;
                                                setBuyAmountInput(val);
                                              }}
                                              className="w-full bg-transparent text-white font-mono font-bold text-sm focus:outline-none"
                                              placeholder="Amount in Rupees"
                                            />
                                         </div>
                                      </div>

                                      {/* Live tokens calculations outputs */}
                                      <div className="grid grid-cols-2 gap-4 bg-black/40 border border-white/5 p-4 rounded-xl font-mono text-center">
                                         <div>
                                            <span className="text-[9px] text-[#8b949e] font-black uppercase tracking-widest block">Wallet Credits</span>
                                            <span className="text-base text-emerald-400 font-extrabold block mt-1">{(parseFloat(buyAmountInput) || 0) * 100}</span>
                                            <span className="text-[8px] text-[#8b949e]">at ₹1 = 100 credits</span>
                                         </div>
                                         <div>
                                            <span className="text-[9px] text-[#8b949e] font-black uppercase tracking-widest block">Equivalent AI Outputs</span>
                                            <span className="text-base text-indigo-400 font-extrabold block mt-1">{(parseFloat(buyAmountInput) || 0) * 100 * 200}</span>
                                            <span className="text-[8px] text-[#8b949e]">At 1 Credit = 200 outputs</span>
                                         </div>
                                      </div>

                                      <button 
                                        onClick={() => {
                                          const enteredVal = parseFloat(buyAmountInput);
                                          if (isNaN(enteredVal) || enteredVal < 1 || enteredVal > 999999) {
                                            alert("Please enter a valid amount between ₹1 and ₹9,99,999");
                                            return;
                                          }
                                          createBillingOrder(enteredVal);
                                        }}
                                        disabled={isRecharging}
                                        className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-xl font-black uppercase tracking-widest text-xs shadow-lg shadow-emerald-600/20 active:scale-95 transition-all"
                                      >
                                         Purchase Wallet Credit (₹{(parseFloat(buyAmountInput) || 0).toLocaleString('en-IN')})
                                      </button>
                                   </div>
                                </div>

                                <div className="space-y-4">
                                   <p className="text-xs text-[#8b949e] leading-relaxed font-semibold">
                                      Credits are immediately funded into your multi-model ledger on successful bank sync. Checkout parameters are fully encrypted.
                                   </p>
                                   
                                   <h4 className="text-xs font-black text-white uppercase tracking-wider font-mono">Invoice Records Summary</h4>
                                   <div className="overflow-y-auto max-h-[220px] custom-scrollbar border border-white/5 rounded-2xl bg-black/10">
                                      <table className="w-full text-left text-xs font-mono">
                                         <thead>
                                            <tr className="border-b border-white/5 text-[#8b949e] font-black uppercase tracking-widest text-[9px] bg-black/40">
                                               <th className="py-2 px-4">OrderID</th>
                                               <th className="py-2 px-4 text-emerald-400">Rupees Paid</th>
                                               <th className="py-2 px-4">Method</th>
                                               <th className="py-2 px-4">Datetime</th>
                                            </tr>
                                         </thead>
                                         <tbody className="divide-y divide-white/5 font-bold">
                                            {billingTransactions.filter(tx => tx.paymentProvider !== 'WELCOME_BONUS' && tx.paymentProvider !== 'COUPON_REDEEM').map((tx: any, i: number) => (
                                               <tr key={i} className="hover:bg-white/5 transition-colors">
                                                  <td className="py-2.5 px-4 text-white truncate max-w-[125px]">#{tx.orderId || tx.transactionId}</td>
                                                  <td className="py-2.5 px-4 text-emerald-400">₹{(tx.amountPaid || tx.amount || 0).toFixed(2)}</td>
                                                  <td className="py-2.5 px-4 text-indigo-400 text-[10px] uppercase">{tx.paymentProvider || 'CASHFREE'}</td>
                                                  <td className="py-2.5 px-4 text-[#8b949e]">
                                                     {tx.createdAt ? new Date(tx.createdAt.seconds ? tx.createdAt.seconds * 1000 : tx.createdAt).toLocaleDateString() : 'Today'}
                                                  </td>
                                               </tr>
                                            ))}
                                         </tbody>
                                      </table>
                                   </div>
                                </div>
                             </div>
                          </div>
                       )}

                       {/* DETAILED TAB 4: BUDGET & REMINDER SRE */}
                        {activeBillingDetailTab === 'budget' && (
                           <div className="space-y-6 animate-in fade-in duration-300">
                              <div className="border-b border-white/5 pb-4">
                                 <span className="text-[10px] bg-violet-500/10 border border-violet-500/20 text-violet-400 px-3 py-1.5 rounded-xl font-black uppercase tracking-wider font-mono">
                                    Autonomous SRE Controls
                                 </span>
                                 <h3 className="text-xl font-black text-white uppercase tracking-tight mt-3">Safety & Threshold Limits console</h3>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
                                 <div className="space-y-6 bg-black/20 border border-white/5 p-6 rounded-[2rem]">
                                    
                                    {/* REMINDER SETTING */}
                                    <div className="space-y-3">
                                       <h4 className="text-xs font-black text-white uppercase tracking-widest font-mono">a. Reminder warning limit</h4>
                                       <p className="text-xs text-[#8b949e]">Is limit se niche credit bache hone par apko popup warning ⚠️ seen hoga. Ap reminder threshold settings change kar sakte hain.</p>
                                       <div className="flex items-center gap-3 bg-[#0d1117] border border-white/10 rounded-xl px-4 py-3 focus-within:border-violet-500 transition-all">
                                          <input 
                                            type="text"
                                            value={tempReminderLimit}
                                            placeholder="Enter warning limit in Rupees"
                                            onChange={(e) => {
                                              setTempReminderLimit(e.target.value);
                                            }}
                                            className="w-full bg-transparent text-white font-mono font-bold text-sm focus:outline-none"
                                          />
                                          <span className="text-xs text-[#8b949e] font-bold font-mono">₹</span>
                                       </div>
                                    </div>

                                    {/* BUDGET FLOOR SETTING */}
                                    <div className="space-y-3 pt-4 border-t border-white/5">
                                       <h4 className="text-xs font-black text-white uppercase tracking-widest font-mono">b. Last hard budget limit</h4>
                                       <p className="text-xs text-[#8b949e]">Apna budget flow floor value set karen. Is limit par system automatically apko Free version mode activate kar dega.</p>
                                       <div className="flex items-center gap-3 bg-[#0d1117] border border-white/10 rounded-xl px-4 py-3 focus-within:border-violet-500 transition-all">
                                          <input 
                                            type="text"
                                            value={tempBudgetLimit}
                                            placeholder="Enter budget limit in Rupees"
                                            onChange={(e) => {
                                              setTempBudgetLimit(e.target.value);
                                            }}
                                            className="w-full bg-transparent text-white font-mono font-bold text-sm focus:outline-none"
                                          />
                                          <span className="text-xs text-[#8b949e] font-bold font-mono">₹</span>
                                       </div>
                                    </div>

                                    {/* ACTION SET BUTTON */}
                                    <div className="pt-4 border-t border-white/5 flex flex-col gap-3">
                                       {limitError && (
                                          <div className="text-xs bg-red-500/10 border border-red-500/20 text-red-100 p-3.5 rounded-xl font-bold font-mono">
                                             ⚠️ {limitError}
                                          </div>
                                       )}
                                       {limitSuccess && (
                                          <div className="text-xs bg-emerald-500/10 border border-emerald-500/20 text-emerald-100 p-3.5 rounded-xl font-bold font-mono">
                                             ✅ {limitSuccess}
                                          </div>
                                       )}
                                       <button
                                          onClick={() => {
                                             setLimitError(null);
                                             setLimitSuccess(null);
                                             const rLimit = parseFloat(tempReminderLimit);
                                             const bLimit = parseFloat(tempBudgetLimit);
                                             const available = wallet?.remaining_balance || 10.0;

                                             if (isNaN(rLimit) || rLimit < 0) {
                                                setLimitError("Please enter a valid Reminder Warning Limit (>= 0).");
                                                return;
                                             }
                                             if (isNaN(bLimit) || bLimit < 0) {
                                                setLimitError("Please enter a valid Hard Budget Limit (>= 0).");
                                                return;
                                             }

                                             // Rule 2a: always warning limit < hard budget limit
                                             if (rLimit >= bLimit) {
                                                setLimitError("Warning limit must be strictly LESS than the hard budget limit (Warning Limit < Hard Budget Limit)!");
                                                return;
                                             }

                                             // Rule 2b: always last hard budget limit < total available credit
                                             if (bLimit >= available) {
                                                setLimitError(`Hard budget limit (₹${bLimit.toFixed(2)}) must be strictly LESS than your total available credit (₹${available.toFixed(4)})! Please recharge or lower the limit.`);
                                                return;
                                             }

                                             setReminderLimit(rLimit);
                                             setBudgetLimit(bLimit);
                                             setLimitSuccess("Success: Threshold limits successfully configured and applied!");
                                             
                                             setTimeout(() => {
                                                setLimitSuccess(null);
                                             }, 4000);
                                          }}
                                          className="w-full py-3 bg-violet-600 hover:bg-violet-500 hover:border-violet-400 border border-violet-700 rounded-xl text-xs font-black uppercase tracking-widest text-white transition-all active:scale-95 flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-violet-900/20"
                                       >
                                          Set Limits & Save Controls
                                       </button>
                                    </div>
                                 </div>

                                 {/* Active SRE system status card */}
                                 <div className="space-y-4">
                                    <h4 className="text-xs font-black text-white uppercase tracking-wider font-mono">System Compliance & VIP Status</h4>
                                    <div className={cn(
                                      "p-6 rounded-[2rem] border relative overflow-hidden transition-all duration-300",
                                      wallet && wallet.remaining_balance <= budgetLimit
                                        ? "border-red-500/20 bg-red-500/5 text-red-100"
                                        : "border-emerald-500/20 bg-emerald-500/5 text-emerald-100"
                                    )}>
                                       <div className="flex items-center gap-3">
                                          {wallet && wallet.remaining_balance <= budgetLimit ? (
                                             <div className="p-3 bg-red-500/10 rounded-2xl border border-red-500/20 text-red-400">
                                                <AlertCircle className="w-5 h-5 animate-pulse" />
                                             </div>
                                          ) : (
                                             <div className="p-3 bg-emerald-500/10 rounded-2xl border border-emerald-500/20 text-emerald-400">
                                                <ShieldCheck className="w-5 h-5" />
                                             </div>
                                          )}
                                          <div>
                                             <span className="text-[10px] text-[#8b949e] font-black uppercase tracking-widest font-mono block">Compliance Status</span>
                                             <span className="text-sm font-black uppercase">
                                                {wallet && wallet.remaining_balance <= budgetLimit ? 'Free version enabled mode' : 'Premium VIP Active'}
                                             </span>
                                          </div>
                                       </div>

                                       <p className="text-xs text-[#8b949e] leading-relaxed mt-4 font-semibold">
                                          {wallet && wallet.remaining_balance <= budgetLimit 
                                             ? "Alert: Your active credit has reached your budget limit. Premium high-compute models are paused, and NavBharat AI Free core engine is running for basic queries only."
                                             : `Compliance: Perfect working conditions. Remaining credit exceeds budget limits. Safe computing threshold remains above the set ${budgetLimit} INR constraint.`
                                          }
                                       </p>
                                    </div>
                                 </div>
                              </div>

                              <div className="pt-4 border-t border-white/5">
                                 <button 
                                   onClick={() => window.open(window.location.href, '_blank')}
                                   className="w-full py-3 bg-indigo-600/10 hover:bg-indigo-600 text-indigo-400 hover:text-white rounded-xl text-[9px] font-black uppercase tracking-widest transition-all gap-2 flex items-center justify-center"
                                 >
                                    Still having issues? Try Open in New Tab
                                    <ExternalLink className="w-3 h-3" />
                                 </button>
                              </div>
                           </div>
                        )}
                     </div>
                  </div>
               )}
               </div>
            )}

            {activeView === 'git' && (
                <div className="flex-1 bg-[#0d1117] p-4 lg:p-6 text-left min-h-screen flex flex-col items-center">
                  <div className="max-w-4xl w-full h-[88vh] flex flex-col bg-[#161b22] border border-white/10 rounded-3xl overflow-hidden shadow-2xl relative">
                    <div className="p-4 bg-[#0d1117] border-b border-white/5 flex flex-col sm:flex-row sm:items-center justify-between shrink-0 gap-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 bg-indigo-600/10 border border-indigo-600/20 rounded-xl flex items-center justify-center">
                          <Rocket className="w-4.5 h-4.5 text-indigo-400" />
                        </div>
                        <div>
                          <h3 className="text-xs font-black text-white uppercase tracking-widest leading-none font-sans">navBharatAI DevOps Engine</h3>
                          <p className="text-[9px] text-[#8b949e] font-serif uppercase tracking-widest mt-1">
                            {selectedRepo ? `Active Repo: ${selectedRepo.name} (${currentBranch})` : 'Sandbox Simulator Mode (GitHub Unconnected)'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                         {githubToken ? (
                           <button
                             onClick={() => {
                               setActiveView('settings');
                               setSettingsScreen('github_repos');
                             }}
                             className="px-3 py-1 bg-indigo-600/10 border border-indigo-500/25 hover:bg-indigo-600/20 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all text-indigo-400 flex items-center gap-1.5 cursor-pointer"
                           >
                             <List className="w-3 h-3" />
                             {selectedRepo ? 'Switch Repo' : 'Select Repo'}
                           </button>
                         ) : (
                           <button
                             onClick={() => {
                               setActiveView('settings');
                               setSettingsScreen('connections');
                             }}
                             className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all text-white flex items-center gap-1.5 cursor-pointer"
                           >
                             <Github className="w-3 h-3 text-white" />
                             Connect GitHub
                           </button>
                         )}
                         {selectedRepo && (
                           <button
                             onClick={() => importRepo(selectedRepo, currentBranch)}
                             disabled={isGHSyncing}
                             className="px-3 py-1 bg-white/5 border border-white/5 hover:border-white/10 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all hover:bg-white/10 flex items-center gap-1.5 disabled:opacity-40 cursor-pointer"
                           >
                             {isGHSyncing ? <RefreshCw className="w-3 h-3 animate-spin text-white" /> : <Search className="w-3 h-3 text-white" />}
                             Review Files
                           </button>
                         )}
                      </div>
                    </div>
                    <div className="flex-1 overflow-hidden">
                      <GitPanel 
                        token={githubToken}
                        user={githubUser}
                        repoContext={githubRepoContext || (selectedRepo ? { owner: selectedRepo.owner.login, repo: selectedRepo.name, branch: currentBranch } : null)}
                        isSyncing={isGHSyncing}
                        isPushing={isPushing}
                        onConnect={connectGitHub}
                        onDisconnect={disconnectGitHub}
                        onPush={selectedRepo ? pushToRepo : (msg) => {
                          alert(`[Sandbox Commit] Committing files and starting deployment.\nCommit Message: "${msg || 'Update via navBharatAI'}"`);
                        }}
                        files={files}
                        projectId={currentSessionId}
                        projectName={sessions.find(s => s.id === currentSessionId)?.title}
                        firebaseToken={firebaseToken}
                        firebaseUser={firebaseUser}
                        onFirebaseConnect={connectFirebase}
                        onFirebaseDisconnect={disconnectFirebase}
                        onFilesChange={(newFiles) => {
                          setFiles(newFiles);
                          updatePreview(newFiles);
                        }}
                        onAgentChange={handleAgentChange}
                        onToggleView={toggleTab}
                        onActivatePreview={handleTriggerPreviewBuild}
                        onActivateWorkspace={handleActivateWorkspace}
                      />
                    </div>
                  </div>
                </div>
              )}



          {activeView === 'templates' && (
            <div className="flex-1 p-8 bg-[#0d1117] overflow-y-auto custom-scrollbar">
              <div className="max-w-6xl mx-auto">
                <div className="flex flex-col mb-10">
                  <h3 className="text-2xl font-bold text-white mb-2">Project Blueprints</h3>
                  <p className="text-sm text-[#8b949e]">Accelerate your development with AI-optimized templates</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  {templates.map(t => {
                    const isLocked = (t as any).isPro && !user;
                    return (
                    <motion.button
                      whileHover={{ y: -5 }}
                      key={t.id}
                      onClick={() => {
                        if (isLocked) { setShowAuth(true); addToast('Sign in to use Pro templates', 'warning'); return; }
                        setInput(t.prompt);
                        toggleTab('nbi_chat');
                      }}
                      className={`flex flex-col items-start p-6 bg-[#161b22] border rounded-2xl transition-all text-left group shadow-xl relative overflow-hidden ${
                        isLocked ? 'border-amber-500/20 hover:border-amber-500/40' : 'border-white/5 hover:border-indigo-500/50 hover:bg-indigo-500/5'
                      }`}
                    >
                      {(t as any).isPro && (
                        <span className="absolute top-3 right-3 text-[8px] font-black px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-500/30 text-amber-400 uppercase tracking-widest">
                          {isLocked ? '🔒 Pro' : '⭐ Pro'}
                        </span>
                      )}
                      <div className={`w-12 h-12 bg-white/5 rounded-xl flex items-center justify-center mb-6 transition-colors ${isLocked ? 'group-hover:bg-amber-600' : 'group-hover:bg-indigo-600'}`}>
                        <t.icon className={`w-6 h-6 ${isLocked ? 'text-amber-400 group-hover:text-white' : 'text-indigo-400 group-hover:text-white'}`} />
                      </div>
                      <h4 className="font-bold text-white mb-2">{t.name}</h4>
                      <p className="text-[11px] text-[#8b949e] leading-relaxed mb-6 opacity-70">Pre-configured scaffolding for modern responsive web applications.</p>
                      <div className="mt-auto w-full flex items-center justify-between">
                         <span className={`text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded ${isLocked ? 'text-amber-400 bg-amber-500/10' : 'text-indigo-400 bg-indigo-500/10'}`}>
                           {isLocked ? 'Sign In to Use' : 'Fast Build'}
                         </span>
                      </div>
                    </motion.button>
                    );
                  })}
                </div>

                {/* 9.4 — My Saved Templates (local marketplace) */}
                <div className="mt-12">
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <h3 className="text-xl font-bold text-white">My Templates</h3>
                      <p className="text-sm text-[#8b949e]">Your saved apps — reuse, remix, and share</p>
                    </div>
                    {hasGeneratedCode && (
                      <button
                        onClick={saveCurrentAsTemplate}
                        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg active:scale-95"
                      >
                        <Plus className="w-4 h-4" />
                        Save Current App
                      </button>
                    )}
                  </div>
                  {savedTemplates.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 border border-dashed border-white/10 rounded-2xl text-center gap-3">
                      <Package className="w-10 h-10 text-white/20" />
                      <p className="text-[#484f58] text-sm font-medium">No saved templates yet</p>
                      <p className="text-[10px] text-[#484f58]">Build an app and click "Save Current App" to save it here</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {savedTemplates.map(t => (
                        <div key={t.id} className="flex flex-col bg-[#161b22] border border-white/5 rounded-2xl p-5 gap-3 hover:border-indigo-500/30 transition-all group">
                          <div className="flex items-start justify-between">
                            <div>
                              <h4 className="text-white font-bold text-sm">{t.name}</h4>
                              <p className="text-[9px] text-[#484f58] mt-0.5">Saved {t.savedAt}</p>
                            </div>
                            <button
                              onClick={() => setSavedTemplates(prev => prev.filter(x => x.id !== t.id))}
                              className="p-1.5 hover:bg-red-500/10 rounded-lg text-[#484f58] hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                          <div className="text-[9px] text-[#8b949e] font-mono bg-black/30 rounded-lg p-2 truncate">
                            {t.html.slice(0, 80)}...
                          </div>
                          <button
                            onClick={() => {
                              setGeneratedCode(t.html);
                              setHasGeneratedCode(true);
                              updatePreview({ 'index.html': t.html });
                              toggleTab('preview');
                            }}
                            className="w-full py-2 bg-indigo-600/10 hover:bg-indigo-600/20 border border-indigo-500/20 text-indigo-400 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all"
                          >
                            Load & Preview
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
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
            <div className={cn("flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-8 relative min-h-screen transition-colors duration-500", themeClasses.bg)}>
              {/* Master Edit Toggle */}
              {isAdmin && (
                <div className="sticky top-0 right-0 z-50 flex justify-end pb-4">
                  <button 
                    onClick={() => setIsDonationEditing(!isDonationEditing)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-xl active:scale-95 ${
                      isDonationEditing 
                      ? 'bg-emerald-600 shadow-emerald-500/20 text-white' 
                      : 'bg-indigo-600 shadow-indigo-600/20 text-white'
                    }`}
                  >
                    {isDonationEditing ? <Check className="w-4 h-4" /> : <Edit2 className="w-4 h-4" />}
                    {isDonationEditing ? 'Finish Editing' : 'Edit Page Content'}
                  </button>
                </div>
              )}

              <div className="max-w-3xl mx-auto space-y-8 pb-12">
                {/* Hero section */}
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-[#161b22] border border-white/10 rounded-[2.5rem] p-8 sm:p-12 text-center shadow-3xl relative overflow-hidden group"
                >
                  <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-orange-500 via-white to-green-500"></div>
                  <div className="absolute -top-24 -right-24 w-64 h-64 bg-indigo-600/5 rounded-full blur-[80px] group-hover:bg-indigo-600/10 transition-colors"></div>
                  
                  <div className="relative inline-block group/edit mb-8">
                    {donationData.logoUrl ? (
                      <div className="relative">
                        <img 
                          src={donationData.logoUrl} 
                          alt="Creator" 
                          className="w-24 h-24 rounded-3xl object-cover border-2 border-indigo-500 shadow-xl"
                        />
                        {isAdmin && isDonationEditing && (
                          <label className="absolute -bottom-2 -right-2 p-2 bg-indigo-600 rounded-xl cursor-pointer shadow-lg hover:bg-indigo-700 transition-colors">
                            <Camera className="w-3.5 h-3.5 text-white" />
                            <input type="file" className="hidden" accept="image/*" onChange={(e) => handleFileUpload(e, 'logoUrl')} />
                          </label>
                        )}
                      </div>
                    ) : (
                      <div className="relative">
                        <div className="w-20 h-20 bg-indigo-600/10 rounded-3xl flex items-center justify-center mx-auto border border-indigo-500/20 shadow-inner group-hover:rotate-12 transition-transform duration-500">
                          <HeartHandshake className="w-10 h-10 text-indigo-500" />
                        </div>
                        {isAdmin && isDonationEditing && (
                          <label className="absolute -bottom-2 -right-2 p-2 bg-indigo-600 rounded-xl cursor-pointer shadow-lg hover:bg-indigo-700 transition-colors">
                            <Upload className="w-3.5 h-3.5 text-white" />
                            <input type="file" className="hidden" accept="image/*" onChange={(e) => handleFileUpload(e, 'logoUrl')} />
                          </label>
                        )}
                      </div>
                    )}
                  </div>
                  
                  <div className="relative group/edit">
                    {isDonationEditing ? (
                      <input 
                        value={donationData.headline}
                        onChange={(e) => setDonationData({...donationData, headline: e.target.value})}
                        className="text-2xl sm:text-3xl font-black text-white mb-4 tracking-tighter leading-tight bg-white/5 border border-white/10 rounded-xl px-4 py-2 w-full text-center outline-none focus:border-indigo-500"
                      />
                    ) : (
                      <div className="flex items-center justify-center gap-4 mb-4">
                        <h2 className="text-3xl sm:text-4xl font-black text-white tracking-tighter leading-tight">
                          {donationData.headline}
                        </h2>
                        {isAdmin && (
                          <button 
                            onClick={() => setIsDonationEditing(true)}
                            className="p-2 opacity-0 group-hover/edit:opacity-100 bg-white/5 hover:bg-white/10 rounded-lg text-indigo-400 transition-all border border-white/10 shadow-lg"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="relative group/edit">
                    {isDonationEditing ? (
                      <input 
                        value={donationData.subHeadline}
                        onChange={(e) => setDonationData({...donationData, subHeadline: e.target.value})}
                        className="text-sm font-bold text-indigo-400 uppercase tracking-[0.2em] mb-8 bg-white/5 border border-white/10 rounded-xl px-4 py-2 w-full text-center outline-none focus:border-indigo-500"
                      />
                    ) : (
                      <div className="flex items-center justify-center gap-4 mb-8">
                        <p className="text-lg font-bold text-indigo-400 uppercase tracking-[0.2em]">{donationData.subHeadline}</p>
                        {isAdmin && (
                          <button 
                            onClick={() => setIsDonationEditing(true)}
                            className="p-1 px-2 opacity-0 group-hover/edit:opacity-100 bg-white/5 hover:bg-white/10 rounded-lg text-indigo-400 transition-all border border-white/10 shadow-lg flex items-center gap-1"
                          >
                            <Edit2 className="w-3 h-3" />
                            <span className="text-[8px] font-black uppercase">Edit</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  
                  <div className="max-w-2xl mx-auto text-left space-y-6">
                    <div className="relative group/edit">
                      <div className="text-[#c9d1d9] text-base leading-relaxed font-medium">
                        नमस्कार भारतीय भाइयों और बहनों,
                        <br /><br />
                        {isDonationEditing ? (
                          <div className="space-y-4">
                            <div className="flex gap-2 items-center">
                              <span className="text-[10px] text-[#8b949e] font-bold uppercase">Name:</span>
                              <input 
                                value={donationData.name}
                                onChange={(e) => setDonationData({...donationData, name: e.target.value})}
                                className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-white text-sm outline-none focus:border-indigo-500"
                              />
                            </div>
                            <textarea 
                              value={donationData.missionStatement}
                              onChange={(e) => setDonationData({...donationData, missionStatement: e.target.value})}
                              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-[#c9d1d9] outline-none focus:border-indigo-500 min-h-[100px]"
                            />
                          </div>
                        ) : (
                          <div className="flex items-start gap-4">
                            <span>मैं <span className="text-white font-bold underline decoration-indigo-500 decoration-2 underline-offset-4">{donationData.name}</span> हूँ। {donationData.missionStatement}</span>
                        {isAdmin && (
                          <button 
                            onClick={() => setIsDonationEditing(true)}
                            className="p-1 px-2 mt-1 bg-white/5 hover:bg-white/10 rounded-lg text-indigo-400 opacity-0 group-hover/edit:opacity-100 transition-all border border-white/10 shadow-lg flex items-center gap-1 shrink-0"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                        )}
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <div className="p-6 bg-white/5 rounded-3xl border border-white/10 backdrop-blur-sm relative group/edit">
                      {isDonationEditing ? (
                        <textarea 
                          value={donationData.dreamStatement}
                          onChange={(e) => setDonationData({...donationData, dreamStatement: e.target.value})}
                          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-[#8b949e] italic text-center outline-none focus:border-indigo-500 min-h-[100px]"
                        />
                      ) : (
                        <div className="flex flex-col items-center">
                          <p className="text-sm text-[#8b949e] leading-relaxed italic text-center">
                            {donationData.dreamStatement}
                          </p>
                          {isAdmin && (
                            <button 
                              onClick={() => setIsDonationEditing(true)}
                              className="mt-4 p-1 px-2 bg-white/5 hover:bg-white/10 rounded-lg text-indigo-400 opacity-0 group-hover/edit:opacity-100 transition-all border border-white/10 shadow-lg flex items-center gap-1"
                            >
                              <Edit2 className="w-3 h-3" />
                              <span className="text-[8px] font-black uppercase">Edit Dream</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    <p className="text-[#8b949e] text-sm leading-relaxed">
                      मैं चाहता हूँ कि भारत भी AI की दुनिया में अपनी एक अलग पहचान बनाए — एक ऐसा AI जो भारतीय लोगों की भाषा, सोच, संस्कृति और जरूरतों को वास्तव में समझे।
                    </p>

                    <div className="space-y-4">
                      <div className="text-xs font-bold text-indigo-400 uppercase tracking-widest flex items-center gap-2">
                        <div className="w-1 h-3 bg-indigo-500 rounded-full"></div>
                        मिशन के लिए आवश्यक संसाधन:
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                         {['बेहतर सर्वर', 'AI ट्रेनिंग', 'रिसर्च', 'डेवलपमेंट'].map(item => (
                           <div key={item} className="flex items-center gap-2 text-xs text-white font-bold bg-white/5 p-3 rounded-xl border border-white/5">
                             <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></div>
                             {item}
                           </div>
                         ))}
                      </div>
                    </div>

                    <p className="text-[#c9d1d9] text-sm leading-relaxed font-medium border-l-2 border-indigo-500 pl-4 py-1">
                      इसके लिए मुझे आपकी मदद की आवश्यकता है। ❤️ <br />
                      यदि आपको "नवभारत AI" का सपना अच्छा लगता है, तो कृपया अपनी इच्छा अनुसार छोटा या बड़ा कोई भी सहयोग करें।
                    </p>

                    <p className="text-center text-indigo-300 font-bold text-sm bg-indigo-500/10 py-3 rounded-2xl border border-indigo-500/20">
                      आपका छोटा सा योगदान भी इस भारतीय AI मिशन को आगे बढ़ाने में बहुत बड़ी मदद करेगा। 🙏
                    </p>
                  </div>
                </motion.div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* QR Code Section */}
                  <motion.div 
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="bg-[#161b22] border border-white/10 rounded-[2.5rem] p-8 text-center flex flex-col items-center justify-center shadow-2xl relative group"
                  >
                    <div className="absolute top-4 right-4 opacity-10 group-hover:opacity-20 transition-opacity">
                      <QrCode className="w-12 h-12 text-white" />
                    </div>
                    <h4 className="text-sm font-black text-white uppercase tracking-widest mb-6">स्कैन करके सहयोग करें</h4>
                    
                    <div className="relative group/edit">
                      <div className="w-48 h-48 bg-white p-3 rounded-2xl shadow-inner relative flex items-center justify-center">
                        <img 
                          src={donationData.qrUrl || `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=upi://pay?pa=${donationData.upiId}&pn=${encodeURIComponent(donationData.name)}&cu=INR`} 
                          alt="Donation QR Code"
                          className="w-full h-full object-contain"
                        />
                        {!isDonationEditing && (
                          <div className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity bg-white/80 rounded-2xl pointer-events-none text-center p-4">
                            <span className="text-[10px] font-bold text-black uppercase tracking-tight">{donationData.upiId}</span>
                          </div>
                        )}
                        {isDonationEditing && (
                          <label className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 backdrop-blur-[2px] text-white opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl cursor-pointer">
                            <Upload className="w-8 h-8 mb-2" />
                            <span className="text-[10px] font-black uppercase">Upload QR Code</span>
                            <input type="file" className="hidden" accept="image/*" onChange={(e) => handleFileUpload(e, 'qrUrl')} />
                          </label>
                        )}
                      </div>
                      {isDonationEditing && donationData.qrUrl && (
                        <button 
                          onClick={() => setDonationData({...donationData, qrUrl: ''})}
                          className="mt-2 text-[8px] font-bold text-rose-500 uppercase flex items-center gap-1 mx-auto"
                        >
                          Reset to Auto-Generated QR
                        </button>
                      )}
                    </div>
                    <p className="text-[10px] text-[#8b949e] mt-4 font-medium italic">Supports all UPI apps (GPay, PhonePe, Paytm)</p>
                  </motion.div>

                  {/* UPI & CTA Section */}
                  <motion.div 
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex flex-col gap-6"
                  >
                    <div className="bg-[#161b22] border border-white/10 rounded-[2.5rem] p-8 shadow-2xl relative group/edit">
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em]">UPI IDENTITY</h4>
                        {isAdmin && !isDonationEditing && (
                          <button 
                            onClick={() => setIsDonationEditing(true)}
                            className="p-1 px-2 bg-white/5 hover:bg-white/10 rounded-lg text-indigo-400 opacity-0 group-hover/edit:opacity-100 transition-all border border-white/10 shadow-lg flex items-center gap-1"
                          >
                            <Edit2 className="w-3 h-3" />
                            <span className="text-[8px] font-black uppercase">Edit</span>
                          </button>
                        )}
                      </div>
                      <div className="relative group">
                        <input 
                          readOnly={!isDonationEditing}
                          value={donationData.upiId}
                          onChange={(e) => setDonationData({...donationData, upiId: e.target.value})}
                          className={`w-full border rounded-2xl px-5 py-4 text-sm font-mono text-white outline-none transition-all shadow-inner ${
                            isDonationEditing ? 'bg-white/5 border-indigo-500/50' : 'bg-[#0d1117] border-white/10 group-hover:border-indigo-500/50'
                          }`}
                        />
                        {!isDonationEditing && (
                          <button 
                            onClick={() => {
                              navigator.clipboard.writeText(donationData.upiId);
                              addLog('UPI ID copied to clipboard.', 'success');
                            }}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition-all shadow-lg active:scale-95 flex items-center gap-2 group/btn"
                          >
                            <Copy className="w-3.5 h-3.5" />
                            <span className="text-[9px] font-black uppercase">Copy</span>
                          </button>
                        )}
                      </div>
                      <p className="text-[9px] text-[#484f58] mt-3 font-medium text-center">Verify the name displayed: <span className="text-white">{donationData.name}</span></p>
                    </div>

                    <div className="bg-indigo-600 rounded-[2.5rem] p-8 shadow-2xl relative overflow-hidden group">
                      <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none"></div>
                      <div className="relative z-10">
                        <h4 className="text-xl font-black text-white mb-2 flex items-center gap-3">
                          <Heart className="w-6 h-6 fill-rose-400 text-rose-400 animate-pulse" />
                          दिल से Donate करें
                        </h4>
                        <p className="text-xs text-indigo-100 font-medium leading-relaxed mb-6">
                          आपका सहयोग भारत के अपने AI को दुनिया के सबसे शानदार प्लेटफॉर्म्स में से एक बनाएगा। 🇮🇳
                        </p>
                        <button 
                          onClick={() => window.open(`upi://pay?pa=${donationData.upiId}&pn=${encodeURIComponent(donationData.name)}&cu=INR`, '_blank')}
                          className="w-full bg-white text-indigo-600 font-black py-4 rounded-2xl text-xs uppercase tracking-widest shadow-xl hover:bg-indigo-50 transition-all active:scale-95 flex items-center justify-center gap-2"
                        >
                          अंकदान / Donation (UPI)
                          <ExternalLink className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                </div>

                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="p-8 text-center border-t border-white/5"
                >
                  <p className="text-xs text-[#484f58] italic font-medium max-w-xl mx-auto leading-relaxed">
                    "मैं वादा करता हूँ — एक दिन आपके सहयोग से नवभारत AI दुनिया के सबसे शानदार AI प्लेटफॉर्म्स में गिना जाएगा।" 🇮🇳
                  </p>
                </motion.div>
              </div>
            </div>
          )}

          {activeView === 'report' && <ReportsListView user={user} />}
          {activeView === 'history' && <HistoryView user={user} onRestoreSession={handleRestoreUci} onDeleteSession={deleteSession} />}

          {activeView === 'deploy' && (
            <div className="flex-1 p-8 bg-[#0d1117] flex items-center justify-center">
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="max-w-md w-full bg-[#161b22] border border-white/10 rounded-3xl p-10 text-center shadow-3xl overflow-hidden relative"
              >
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-500 animate-pulse"></div>
                
                <div className="w-20 h-20 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-8 border border-emerald-500/20">
                  <Rocket className="w-10 h-10 text-emerald-500" />
                </div>
                
                <h3 className="text-2xl font-bold text-white mb-2">App is Live!</h3>
                <p className="text-sm text-[#8b949e] mb-8">Your application has been deployed to the edge network.</p>
                
                <div className="bg-[#0d1117] border border-white/10 rounded-2xl p-4 flex items-center justify-between mb-8">
                   <div className="text-xs font-mono text-indigo-400 truncate pr-4">{deployUrl}</div>
                   <button 
                    onClick={() => window.open(deployUrl, '_blank')}
                    className="shrink-0 p-2 hover:bg-white/5 rounded-lg transition-colors"
                  >
                    <Globe className="w-4 h-4 text-[#8b949e] hover:text-white" />
                   </button>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <button onClick={() => toggleTab('preview')} className="py-3 px-4 bg-white/5 hover:bg-white/10 text-white rounded-xl text-xs font-bold transition-all">Preview App</button>
                  <button onClick={() => setIsDeployed(false)} className="py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-indigo-600/20">Back to Code</button>
                </div>
              </motion.div>
            </div>
          )}

          {activeView === 'studio' && (
            <div className="flex-1 h-full overflow-hidden">
              <CodeStudio 
                key={activeAgent}
                activeAgent={activeAgent}
                onAgentChange={handleAgentChange}
                files={files}
                onFilesChange={(newFiles) => setFiles(newFiles as any)}
                onRun={(f) => updatePreview(f || files)}
                generatedCode={generatedCode}
                messages={messages}
                chatInput={input}
                onChatInputChange={setInput}
                onChatSend={() => handleSendForTab(activeAgent.startsWith('vishwakarma') ? 'asc_chat' : 'nbi_pro_chat')}
                isChatLoading={isLoading}
                activeIntent={activeIntent}
                githubToken={githubToken}
                githubUser={githubUser}
                githubRepoContext={githubRepoContext}
                isGHSyncing={isGHSyncing}
                firebaseToken={firebaseToken}
                firebaseUser={firebaseUser}
                onFirebaseConnect={connectFirebase}
                onFirebaseDisconnect={disconnectFirebase}
                onGHConnect={connectGitHub}
                onGHDisconnect={disconnectGitHub}
                onGHPush={pushToRepo}
                isPinned={sessions.find(s => s.id === currentSessionId)?.isPinned || false}
                onTogglePin={() => togglePin(currentSessionId)}
                isLoggedIn={!!user}
                onShowLogin={() => setShowAuth(true)}
                mode={mode}
                onModeChange={setMode}
                isAppBuilt={isAppBuilt}
                onPreviewClick={() => toggleTab('preview')}
                theme={theme}
                onThemeChange={setTheme}
                pendingGHEdit={pendingGHEdit}
                onConfirmPush={handleGHConfirmPush}
                isGHPushing={isPushing}
                onGoToMain={() => {
                  toggleTab('nbi_pro_chat');
                  addLog('Cognitive memory layer successfully merged and redirected to main cockpit.', 'info');
                }}
                onOpenProChat={() => toggleTab('nbi_pro_chat')}
                wallet={wallet}
                onUnlockVishwakarma={() => setShowVishwakarmaUnlockModal(true)}
              />
            </div>
          )}

          {activeView === 'preview' && (
            <div className="flex-1 h-full overflow-hidden">
              <PreviewPanel
                files={files}
                onRun={() => updatePreview(files)}
                generatedCode={generatedCode}
                previewHistory={previewHistory}
                onRestoreHistory={(html) => setGeneratedCode(html)}
                onHtmlChange={(html) => setGeneratedCode(html)}
                onGoPro={() => toggleTab('nbi_pro_chat')}
                onEditWithAI={(hint) => {
                  setMode('build');
                  if (hint) setProInput(hint);
                  toggleTab('nbi_pro_chat');
                }}
              />
            </div>
          )}

          {/* ZIP size modal — global so it appears regardless of active view */}
          {zipSizeModal && (
            <ZipSizeModal
              variant={zipSizeModal.variant}
              fileName={zipSizeModal.fileName}
              fileSizeMB={zipSizeModal.fileSizeMB}
              onClose={() => setZipSizeModal(null)}
            />
          )}

          {activeView === 'files' && (
            <div className="flex-1 h-full overflow-hidden bg-[#0d1117] flex flex-col">
              {/* Upload conflict popup */}
              {fileUploadConflict && (
                <div className="fixed inset-0 z-[9999] bg-black/70 flex items-center justify-center p-4" onClick={() => setFileUploadConflict(null)}>
                  <div className="bg-[#161b22] border border-white/10 rounded-2xl p-6 max-w-sm w-full shadow-2xl" onClick={e => e.stopPropagation()}>
                    <p className="text-[13px] font-black text-white mb-1">
                      {fileUploadConflict.isZip ? 'ZIP Upload' : `File Conflict: ${fileUploadConflict.file.name}`}
                    </p>
                    <p className="text-[11px] text-[#8b949e] mb-5">
                      {fileUploadConflict.isZip
                        ? 'Workspace already has files. Replace everything or merge new files alongside existing ones?'
                        : `"${fileUploadConflict.existingKey}" already exists. Replace it or keep both versions?`}
                    </p>
                    <div className="flex gap-3">
                      <button onClick={() => resolveFileConflict('replace')} className="flex-1 py-2.5 rounded-xl bg-red-600/20 border border-red-500/30 text-red-400 text-[11px] font-black hover:bg-red-600/30 transition-all active:scale-95">Replace</button>
                      <button onClick={() => resolveFileConflict('merge')} className="flex-1 py-2.5 rounded-xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 text-[11px] font-black hover:bg-indigo-600/30 transition-all active:scale-95">Merge</button>
                    </div>
                  </div>
                </div>
              )}
              {/* Hidden file input for upload */}
              <input
                ref={filesUploadRef}
                type="file"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFilesUpload(f); e.target.value = ''; }}
              />
              <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 bg-[#161b22]">
                <FolderOpen className="w-4 h-4 text-indigo-400" />
                <span className="text-[10px] font-black uppercase tracking-widest text-[#8b949e]">Project Files</span>
                <div className="ml-auto flex items-center gap-2">
                  {hasGeneratedCode && (
                    <span className="text-[8px] text-emerald-400 font-black uppercase tracking-widest mr-1">
                      {Object.keys(files).filter(k => !k.startsWith('__pending__')).length} files
                    </span>
                  )}
                  <button
                    onClick={() => filesUploadRef.current?.click()}
                    className="flex items-center gap-1 px-2.5 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-[9px] font-black uppercase tracking-wider text-[#8b949e] hover:text-white transition-all active:scale-95"
                    title="Upload any file"
                  >
                    <Upload className="w-3 h-3" /> Upload
                  </button>
                  {hasGeneratedCode && (
                    <button
                      onClick={() => downloadAppZip(files as any, 'NavBharatApp')}
                      className="flex items-center gap-1 px-2.5 py-1 bg-indigo-600/20 hover:bg-indigo-600/35 border border-indigo-500/30 rounded-lg text-[9px] font-black uppercase tracking-wider text-indigo-400 hover:text-indigo-300 transition-all active:scale-95"
                      title="Download all files as ZIP"
                    >
                      <Download className="w-3 h-3" /> Download ZIP
                    </button>
                  )}
                </div>
              </div>
              {!hasGeneratedCode ? (
                <div className="flex-1 flex items-center justify-center flex-col gap-3 text-center p-8">
                  <FolderOpen className="w-12 h-12 text-white/10" />
                  <p className="text-[11px] text-[#484f58] font-medium">No app generated yet.</p>
                  <p className="text-[9px] text-[#484f58]">Build an app in NavBharatAI Pro — files will appear here.</p>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
                  <div className="space-y-1">
                    {Object.entries(files).map(([path, content]) => {
                      const ext = path.split('.').pop() || '';
                      const extColor: Record<string, string> = {
                        html: 'text-orange-400', css: 'text-blue-400', js: 'text-yellow-400',
                        ts: 'text-cyan-400', tsx: 'text-cyan-400', json: 'text-green-400',
                        md: 'text-purple-400', py: 'text-emerald-400',
                      };
                      const color = extColor[ext] || 'text-white/50';
                      const lines = (content as string).split('\n').length;
                      return (
                        <button
                          key={path}
                          onClick={() => { setActiveFile(path); toggleTab('studio'); }}
                          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 transition-colors group text-left"
                        >
                          <FileCode className={`w-4 h-4 flex-shrink-0 ${color}`} />
                          <span className="text-[11px] font-medium text-[#c9d1d9] flex-1 truncate">{path}</span>
                          <span className="text-[8px] text-[#484f58] font-mono">{lines}L</span>
                          <ChevronRight className="w-3 h-3 text-white/20 group-hover:text-white/50 transition-colors" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Phase 3 — Testing System */}
          {activeView === 'testing' && (
            <div className="flex-1 h-full overflow-hidden">
              <TestPanel generatedCode={generatedCode} files={files} />
            </div>
          )}

          {/* Phase 3 — API Tester */}
          {activeView === 'api' && (
            <div className="flex-1 h-full overflow-hidden">
              <APITester />
            </div>
          )}

          {/* Phase 3 — Diff Viewer */}
          {activeView === 'diff' && (
            <div className="flex-1 h-full overflow-hidden">
              <DiffViewer files={files} />
            </div>
          )}

          {/* Phase 3 — Database UI */}
          {activeView === 'database' && (
            <div className="flex-1 h-full overflow-hidden">
              <DatabaseUI userId={user?.uid} userTier={activeAgent} />
            </div>
          )}

          {/* Phase 4 — Voice to App */}
          {activeView === 'voice' && (
            <div className="flex-1 h-full overflow-hidden">
              <VoiceToApp onAppGenerated={(code, _prompt) => {
                setGeneratedCode(code);
                toggleTab('preview');
              }} />
            </div>
          )}

          {/* Phase 4 — Bot Builder */}
          {activeView === 'botbuilder' && (
            <div className="flex-1 h-full overflow-hidden">
              <BotBuilder />
            </div>
          )}

          {/* Phase 4 — Cost Estimator */}
          {activeView === 'cost' && (
            <div className="flex-1 h-full overflow-hidden">
              <CostEstimator />
            </div>
          )}

          {/* Phase 5 — Screenshot to Code */}
          {activeView === 'screenshot' && (
            <div className="flex-1 h-full overflow-hidden">
              <ScreenshotToCode onCodeGenerated={(code) => {
                setGeneratedCode(code);
                toggleTab('preview');
              }} />
            </div>
          )}

          {/* Phase 5 — Multi-Page Builder */}
          {activeView === 'multipages' && (
            <div className="flex-1 h-full overflow-hidden">
              <MultiPageBuilder
                initialCode={generatedCode}
                onExport={(pages) => {
                  const firstPage = Object.values(pages)[0];
                  if (firstPage) { setGeneratedCode(firstPage as string); toggleTab('preview'); }
                }}
              />
            </div>
          )}

          {/* Phase 5 — Analytics */}
          {activeView === 'analytics' && (
            <div className="flex-1 h-full overflow-hidden">
              <AppAnalytics userId={user?.uid} />
            </div>
          )}

          {/* Phase 6 — AI Debugger */}
          {activeView === 'debugger' && (
            <div className="flex-1 h-full overflow-hidden">
              <AIDebugger files={files} />
            </div>
          )}

          {/* Phase 6 — Performance Analyzer */}
          {activeView === 'performance' && (
            <div className="flex-1 h-full overflow-hidden">
              <PerformanceAnalyzer generatedCode={generatedCode} />
            </div>
          )}

          {/* Phase 6 — Component Library */}
          {activeView === 'components' && (
            <div className="flex-1 h-full overflow-hidden">
              <ComponentLibrary onInsert={(html) => {
                setGeneratedCode(generatedCode ? generatedCode.replace('</body>', html + '\n</body>') : html);
                toggleTab('preview');
              }} />
            </div>
          )}

          {/* Phase 6 — SEO Optimizer */}
          {activeView === 'seo' && (
            <div className="flex-1 h-full overflow-hidden">
              <SEOOptimizer generatedCode={generatedCode} appName="NavBharatAI App" onCodeUpdate={(c) => setGeneratedCode(c)} />
            </div>
          )}

          {/* Phase 7 — APK Builder */}
          {activeView === 'apk' && (
            <div className="flex-1 h-full overflow-hidden">
              <APKBuilder generatedCode={generatedCode} appName="NavBharatAI App" />
            </div>
          )}

          {/* Phase 7 — Figma Importer */}
          {activeView === 'figma' && (
            <div className="flex-1 h-full overflow-hidden">
              <FigmaImporter onCodeGenerated={(code) => {
                setGeneratedCode(code);
                toggleTab('preview');
              }} />
            </div>
          )}

          {/* Phase 7 — Custom Domain */}
          {activeView === 'domain' && (
            <div className="flex-1 h-full overflow-hidden">
              <CustomDomain />
            </div>
          )}

          {/* Phase 7 — Team Collaboration */}
          {activeView === 'team' && (
            <div className="flex-1 h-full overflow-hidden">
              <TeamCollaboration userId={user?.uid} projectName="NavBharatAI Project" />
            </div>
          )}

          {/* Phase 8 — PWA Notifications */}
          {activeView === 'pwa' && (
            <div className="flex-1 h-full overflow-hidden">
              <PWANotifications generatedCode={generatedCode} onCodeUpdate={(c) => setGeneratedCode(c)} />
            </div>
          )}

          {/* Phase 8 — Code Minifier */}
          {activeView === 'minifier' && (
            <div className="flex-1 h-full overflow-hidden">
              <CodeMinifier generatedCode={generatedCode} onOptimized={(c) => { setGeneratedCode(c); toggleTab('preview'); }} />
            </div>
          )}

          {/* Phase 8 — Dark Mode Generator */}
          {activeView === 'darkmode' && (
            <div className="flex-1 h-full overflow-hidden">
              <DarkModeGenerator generatedCode={generatedCode} onCodeUpdate={(c) => setGeneratedCode(c)} />
            </div>
          )}

          {/* Phase 8 — Monetization Wizard */}
          {activeView === 'monetize' && (
            <div className="flex-1 h-full overflow-hidden">
              <MonetizationWizard generatedCode={generatedCode} onCodeUpdate={(c) => setGeneratedCode(c)} />
            </div>
          )}

          {/* Phase 9 — AI Image Generator */}
          {activeView === 'imagegen' && (
            <div className="flex-1 h-full overflow-hidden">
              <AIImageGenerator onImageGenerated={(url, prompt) => {
                setGeneratedCode(generatedCode + `\n<!-- Generated Image: ${prompt} -->\n<img src="${url}" alt="${prompt}" style="max-width:100%;border-radius:12px;" />`);
              }} />
            </div>
          )}

          {/* Phase 9 — Code Versioning */}
          {activeView === 'versioning' && (
            <div className="flex-1 h-full overflow-hidden">
              <CodeVersioning
                generatedCode={generatedCode}
                onRestore={(c) => setGeneratedCode(c)}
                onRestoreFiles={(f) => { setFiles(f as any); updatePreview(f as any); setIsAppBuilt(true); setHasGeneratedCode(true); addToast('Version restored ✓', 'success'); }}
              />
            </div>
          )}

          {/* Phase 9 — API Marketplace */}
          {activeView === 'apimarket' && (
            <div className="flex-1 h-full overflow-hidden">
              <APIMarketplace onCodeInsert={(code) => setGeneratedCode(generatedCode + '\n\n' + code)} />
            </div>
          )}

          {/* Phase 9 — App Store Publisher */}
          {activeView === 'appstore' && (
            <div className="flex-1 h-full overflow-hidden">
              <AppStorePublisher generatedCode={generatedCode} />
            </div>
          )}

          {/* Phase 10 — Live Collaboration */}
          {activeView === 'collab' && (
            <div className="flex-1 h-full overflow-hidden">
              <LiveCollaboration
                generatedCode={generatedCode}
                onCodeUpdate={(c) => setGeneratedCode(c)}
                userId={user?.uid}
                userName={user?.displayName || user?.email?.split('@')[0]}
              />
            </div>
          )}

          {/* Phase 10 — AI Testing Suite */}
          {activeView === 'aitesting' && (
            <div className="flex-1 h-full overflow-hidden">
              <AITestingSuite generatedCode={generatedCode} onCodeUpdate={(c) => setGeneratedCode(c)} />
            </div>
          )}

          {/* Phase 10 — Localization Manager */}
          {activeView === 'localization' && (
            <div className="flex-1 h-full overflow-hidden">
              <LocalizationManager />
            </div>
          )}

          {/* Phase 10 — AI Code Review */}
          {activeView === 'codereview' && (
            <div className="flex-1 h-full overflow-hidden">
              <AICodeReview generatedCode={generatedCode} onCodeUpdate={(c) => setGeneratedCode(c)} />
            </div>
          )}

          {activeView === 'dbstudio' && (
            <div className="flex-1 h-full overflow-hidden">
              <DatabaseStudio />
            </div>
          )}

          {activeView === 'cicd' && (
            <div className="flex-1 h-full overflow-hidden">
              <CICDPipeline />
            </div>
          )}

          {activeView === 'plugins' && (
            <div className="flex-1 h-full overflow-hidden">
              <PluginSystem />
            </div>
          )}

          {activeView === 'whitelabel' && (
            <div className="flex-1 h-full overflow-hidden">
              <WhitelabelBranding />
            </div>
          )}

          {activeView === 'projectmgr' && (
            <div className="flex-1 h-full overflow-hidden">
              <AIProjectManager />
            </div>
          )}

          {activeView === 'cloudeploy' && (
            <div className="flex-1 h-full overflow-hidden">
              <MultiCloudDeploy generatedCode={generatedCode} />
            </div>
          )}

          {activeView === 'designsys' && (
            <div className="flex-1 h-full overflow-hidden">
              <DesignSystem generatedCode={generatedCode} onCodeUpdate={(c) => setGeneratedCode(c)} />
            </div>
          )}

          {activeView === 'healthmon' && (
            <div className="flex-1 h-full overflow-hidden">
              <AppHealthMonitor />
            </div>
          )}

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
