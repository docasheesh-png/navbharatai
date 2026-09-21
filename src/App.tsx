import UpdateBanner from './components/UpdateBanner';
import { platformFixRequestPrompt } from './lib/platformFixRequest';
import React, { useState, useRef, useEffect, useLayoutEffect, lazy, Suspense, useMemo, useCallback } from 'react';
// Native GitHub OAuth return — the deep-link parse and the resume decision, kept pure and tested.
import { tokenFromDeepLink, ticketFromDeepLink, redeemGithubTicket, resumeOutcome, RESUME_GRACE_MS, GITHUB_CANCELLED_MESSAGE } from './lib/githubOauthReturn';
// Native Supabase-connect return — the SAME deep-link shape, its own path (2026-09-14 fix).
import { nonceFromSupabaseDeepLink, errorFromSupabaseDeepLink, SUPABASE_NATIVE_RETURN_EVENT } from './lib/supabaseOauthReturn';
import { restartScreenEnter, shouldAnimateViewChange } from './lib/screenTransition';
import { routeForPath, deepLinkTarget, type DeepLinkView } from './lib/deepLinkRoute';
import { readTapFeedbackPrefs, shouldOpenMenuOnSwipe } from './lib/tapFeedbackPrefs';
import { useUndoRedo } from './hooks/useUndoRedo';
import { useToast, ToastContainer } from './components/Toast';
import { resolveGithubConnectionForUser } from './lib/githubConnection';
import { sanitizeFileMap } from './lib/fileMapSanitize';
import { computeTabClose } from './lib/tabClose';
import { parentForOpen } from './lib/tabParenting';
import { historySurfaceFor, historyFilterFor } from './lib/historySurface';
import { HistoryPopup } from './components/history/HistoryPopup';
// AgentV3Panel is rendered via ProV3Surface (the gated v5.0 surface), not directly here.
// FilesPanel → moved to ViewPanels.tsx
import { v3MobileFooterActive, type V3FooterApi } from './components/agentv3/v3FooterApi';
import { adminMobileFooterActive, type AdminFooterApi } from './components/admin/adminFooterApi';
import { shouldRenderV3Surface, v3SurfaceDisplayClass } from './components/agentv3/v3SurfaceMount';
import { AppLockGate, AppLockScreen, useAreaLocked } from './components/AppLockGate';
import { restoreV3Tab, v3TabIsOpen, v3IsActive, V3_TAB_FLAG, V3_ACTIVE_FLAG } from './components/agentv3/v3TabPersistence';
import { clearStickySession } from './components/agentv3/v3SessionContinuity';
// Lazy — keeps the bundled AppKnowledgeBase (imported by the Offline AI) OUT of the main index chunk,
// so it loads as its own split chunk only when the user opens Offline AI (bundle-budget safe).
import { ViewPanels } from './components/panels/ViewPanels';
import { SidebarNav } from './components/panels/SidebarNav';
import { TopNav } from './components/panels/TopNav';
import { AppModals } from './components/panels/AppModals';
// AgentV3Launcher removed — v5.0 reached via the two gates (nbi_pro_chat + Professionals), not a floating button.
import { fetchBuildSession } from './services/buildService';
import { Bot, Zap, MessageSquare, Heart, Settings, Wallet, GitBranch, Monitor, FolderOpen, MoreHorizontal, History, Smartphone, Minimize2, Briefcase, LayoutGrid, Layers, Store, Info, Package, Wand2, FileDiff } from 'lucide-react';
import { TirangaLoader } from './components/ui/TirangaLoader';
import { cn } from './lib/utils';
// Play compliance (admin 2026-08-04): medical-class assistants are hidden inside the Play-distributed
// native shell so the Play Console health declarations stay truthful. Web is untouched.
import { isNativeApp } from './lib/mobileNative';
import { medicalViewBlocked, medicalFeaturesHidden } from './lib/playCompliance';
import { isComingSoonTool } from './lib/comingSoonTools';
// SDAChat kept eager — used immediately on tab open
import { PROFESSIONAL_CHATS, PROFESSIONALS_IMPLEMENTED_ELSEWHERE } from './components/professionals/professionalConfigs';
import {
  endConversation, latestOpenConversationId, newConversationId, resumeArchived, deleteOpenConversation,
  browserStore as professionalStore,
} from './lib/professionalChatStore';
import {
  openWindow, closeWindow, windowsOf, nextActiveAfterClose, windowLabel, capMessage, isWindowedProfessional, MAX_OPEN_CHATS,
  type ChatWindow, type ConversationRef,
} from './lib/chatWindows';
import { MOBILE_NAV_TOTAL_HEIGHT, publishMobileNavHeight } from './lib/mobileNav';
import { startFreshCase } from './lib/sdaCaseStore';
import { newSdaCaseId } from './lib/sdaCaseId';
import { ModePickerSheet } from './components/chat/ModePickerSheet';
import { ActionDot } from './components/ActionDot';
import type { ActionTone } from './lib/actionNavigator';
import { isModeSurface, FREE_MODE_ID, IMAGE_MODE_ID, viewFromRecentId, startsFreshOnPick, modeEmojiFor } from './components/chat/modePicker';
import { ReportSheet } from './components/ReportSheet';
import { TestingNotice } from './components/TestingNotice';
import { shouldShowTestingNotice, testingNoticeAlreadyShown } from './lib/testingNotice';
import { useReferralProgress } from './hooks/useReferralProgress';
import { useHeldReferralCode } from './hooks/useHeldReferralCode';
import { useShakeToReport } from './hooks/useShakeToReport';
// EngineerAIChat retired — replaced by NavBharatAI Pro (ProV3Surface).
import { ErrorBoundary } from './components/ErrorBoundary';
import { onAuthStateChanged, getRedirectResult, GithubAuthProvider, User as FirebaseUser } from 'firebase/auth';
// One shared, tested describer for social sign-in outcomes (see socialSignInPolicy).
import { socialRedirectFailureMessage, authErrorDetail } from './components/socialSignInPolicy';
import { doc, setDoc } from 'firebase/firestore';
import { Capacitor } from '@capacitor/core';

// Firebase init now lives in ONE place — src/lib/firebase.ts (root-cause fix 2026-07-11: a second
// initializeApp there with a stale JSON config either crashed with app/duplicate-app or, load-order
// depending, put the WRONG cross-origin authDomain on the default app — silently breaking the first
// Google sign-in). Re-exported here so every existing `import { auth, db } from './App'` still works.
import { auth, db, signOutEverywhere, ensureNativeSessionPersisted } from './lib/firebase';
import { readRedirectMarker, clearRedirectMarker, redirectReturnVerdict, redirectLostMessage } from './lib/redirectSignInMarker';
import { isNewAccount, decideSignupReport, SIGNUP_REPORTED_KEY } from './lib/signupSignal';
import { authedHeaders } from './lib/authHeaders';
import { LS_EVICTABLE, safeLS } from './lib/localStorageSafe';
import { rememberGithubOwner, clearGithubConnection, readGithubOwner } from './lib/githubTokenStore';
import { performSignOut, defaultClearAuthStorage, deleteFirebaseAuthDb } from './lib/signOutFlow';
import { authGateDecision, isAuthGatedView } from './lib/authGate';
import { initPushNotifications, teardownPushNotifications } from './lib/pushNotifications';

// ── Eager imports — always needed on first render ───────────────────────────

// ── Lazy imports still used directly in App.tsx ──────────────────────────────
// Helper: wraps a named export into the {default} shape lazy() requires
const _lz = <T extends object>(fn: () => Promise<T>, k: keyof T) =>
  lazy(() => fn().then(m => ({ default: m[k] as React.ComponentType<any> })));

const SecretManager    = _lz(() => import('./components/SecretManager'),        'SecretManager');
const DatabaseSettings = _lz(() => import('./components/settings/DatabaseSettings'), 'DatabaseSettings');
const ReportsListView  = _lz(() => import('./components/ReportsListView'),      'ReportsListView');

// ── Route-level views, lazy (2026-08-24) ──────────────────────────────────────────────────────
// Every one of these renders INSIDE the <Suspense> boundary around the view switcher, and none
// of them is the default view — so nobody downloads a screen they have not opened. They were
// static imports, which is what kept ~640 KB of app code in ONE first-paint chunk even though
// the build already emitted 92 chunks.
//
// This only became possible on 2026-08-24, when App.tsx stopped being importable: while a
// cycle ran back through the root, splitting DUPLICATED the shared graph instead of dividing
// it (an earlier attempt cost ~170 KB — see vite.config.ts). See tests/appModuleGraph.test.ts.
//
// TopNav, SidebarNav and HomeView are deliberately NOT here: the first two render outside the
// boundary and are always visible, and HomeView is the default view — making it lazy would put
// a loading state on every cold start to save nothing.
const GitViewPanel = _lz(() => import('./components/panels/GitViewPanel'), 'GitViewPanel');
const ProV3Surface = _lz(() => import('./components/agentv3/ProV3Surface'), 'ProV3Surface');
const TemplatesPanel = _lz(() => import('./components/panels/TemplatesPanel'), 'TemplatesPanel');
const SettingsPanel = _lz(() => import('./components/panels/SettingsPanel'), 'SettingsPanel');
const AdminLoginPanel = _lz(() => import('./components/panels/AdminLoginPanel'), 'AdminLoginPanel');
const BillingPanel = _lz(() => import('./components/panels/BillingPanel'), 'BillingPanel');
const NBIChatPanel = _lz(() => import('./components/panels/NBIChatPanel'), 'NBIChatPanel');
const SDAChat = _lz(() => import('./components/sda/SDAChat'), 'SDAChat');
const ProfessionalsView = _lz(() => import('./components/professionals/ProfessionalsView'), 'ProfessionalsView');
const ProfessionalChat = _lz(() => import('./components/professionals/ProfessionalChat'), 'ProfessionalChat');
const ProfilePage = _lz(() => import('./components/profile/ProfilePage'), 'ProfilePage');
const RepoAnalystTool = _lz(() => import('./components/repoAnalyst/RepoAnalystTool'), 'RepoAnalystTool');
const DonationPanel = _lz(() => import('./components/panels/DonationPanel'), 'DonationPanel');
const AboutPanel = _lz(() => import('./components/panels/AboutPanel'), 'AboutPanel');
const DeploySuccessPanel = _lz(() => import('./components/panels/DeploySuccessPanel'), 'DeploySuccessPanel');

const HistoryView      = _lz(() => import('./components/HistoryView'),          'HistoryView');
const ProfessionalHistoryView = _lz(() => import('./components/professionals/ProfessionalHistoryView'), 'ProfessionalHistoryView');
import axios from 'axios';

import { useBuild } from './components/ide/BuildContext';
import { useDevLogs } from './hooks/useDevLogs';
import { usePaymentEngine } from './hooks/usePaymentEngine';
import { usePreviewBundler } from './hooks/usePreviewBundler';
import { useChatEngine } from './hooks/useChatEngine';
import { useSessionManager } from './hooks/useSessionManager';
import { useZipImport } from './hooks/useZipImport';
import { useGitHubConnect } from './hooks/useGitHubConnect';
import { useSettings } from './hooks/useSettings';
import { useNetworkStatus } from './hooks/useNetworkStatus';
import OfflineBanner from './components/OfflineBanner';
import { Message, ChatSession, ApiKeys, ViewType, SettingsScreen, FileSystem, ErrorContext } from './types';
import { generateUCI } from './lib/chatUtils';
import { sanitizeFirestoreData } from './lib/firestoreUtils';
import { safeLocalJson } from './lib/safeLocalJson';

// AuthComponent → moved to AppModals
// ReportProblemComponent → lazy above
import { HomeView } from './components/home/HomeView';
import { OtherAIView } from './components/home/OtherAIView';
import { GitHubService } from './lib/githubService';
import { trackEvent } from './lib/analytics';
import { makeWorkspaceSyncer, type WorkspaceSyncer } from './lib/workspaceSync';
import { saveFile, loadAllFiles, clearWorkspace, deleteFile as storageDeleteFile } from './lib/storage';
import { getAgentV3WorkspaceId } from './lib/agentv3Workspace';
import { chunkFilesForSync, totalFilesBytes } from './lib/chunkFilesForSync';
import { type ApnapanProfile, loadApnapanProfile, saveApnapanProfile, updateApnapanProfile } from './lib/apnapanEngine';
import { isZipFile, isTextFile, classifyZipSize } from './lib/uploadClassify';
import {
  DEFAULT_HOME_DATA,
  DEFAULT_DONATION_DATA,
  loadPersistedContent,
} from './config/defaultContent';
// ZipSizeModal component → moved to ViewPanels.tsx
import type { ZipSizeModalVariant } from './components/ide/ZipSizeModal';
import { aboutContent, type AboutContent, type AboutOverrides } from './content/about';
import { decideBackAction, HARDWARE_BACK_EVENT } from './lib/androidBack';
import { loadNativeShellContext, exitNativeApp } from './lib/nativeShell';
import { ExitConfirmDialog } from './components/ExitConfirmDialog';
// AgentMode → re-exported from ./types

// Large keys that can be evicted when localStorage is nearly full.
// Ordered from least-important to most-important.
// D21: derive a human-friendly app name from the user's build prompt
function inferAppName(prompt: string): string {
  const p = prompt.trim();
  // "build/create/make/design/generate a(n)? X (app|tool|dashboard|...)"
  const m1 = p.match(/(?:build|create|make|generate|design)\s+(?:me\s+)?(?:a|an|the)?\s*([a-zA-Z][a-zA-Z\s]{1,28}?)(?:\s+(?:app|application|website|web\s*app|dashboard|tool|platform|system|tracker|manager|portal|page|site))?\s*(?:with|using|in\b|that|which|\.|,|!|\?|$)/i);
  if (m1 && m1[1].trim().length >= 2) {
    const words = m1[1].trim().split(/\s+/);
    if (words.length <= 5) {
      return words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    }
  }
  // Direct "X app" / "X dashboard" / "X tool"
  const m2 = p.match(/\b([A-Za-z][a-zA-Z\s]{1,25}?)\s+(?:app|dashboard|tool|tracker|manager|website|portal)\b/i);
  if (m2) {
    const words = m2[1].trim().split(/\s+/);
    if (words.length >= 1 && words.length <= 4) {
      return words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    }
  }
  return 'NavBharat App';
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

  const [deviceMode, setDeviceMode] = useState<'auto' | 'mobile' | 'tablet' | 'desktop'>(() => {
    try {
      const s = localStorage.getItem('navbharat_device_mode');
      if (s === 'auto' || s === 'mobile' || s === 'tablet' || s === 'desktop') return s;
    } catch { /* ignore */ }
    return 'auto';
  });
  const [effectiveDeviceMode, setEffectiveDeviceMode] = useState<'mobile' | 'tablet' | 'desktop'>('mobile');
  // REPORT A PROBLEM, FROM ANYWHERE (admin 2026-08-21). Shake opens it on a phone; the visible entry
  // in the sidebar opens the same sheet, because an invisible gesture cannot be the only way in (and
  // iOS will not give a page motion access unasked). `reportOpen` lives at the app root so the sheet
  // is available on every screen rather than being re-implemented per surface.
  const [reportOpen, setReportOpen] = useState(false);
  /**
   * WHICH SCREEN THE REPORT SHEET OPENS ON, and how many replies are waiting.
   *
   * ADMIN 2026-09-17. The sheet now has two doors (file something new / read our replies), and two
   * things need to reach it from out here: a tapped "New message from NavBharatAI" must land on the
   * conversation list rather than the menu, and the SIDEBAR needs its unread dot without opening the
   * sheet at all.
   *
   * 🔑 THE COUNT IS POLLED SEPARATELY AND DELIBERATELY SO. `/api/report/unread` answers with a single
   * number; the alternative — reusing `/api/report/mine` — ships every conversation on a timer to
   * decide whether to draw a six-pixel dot, which is how a feature nobody notices becomes the reason
   * a phone on a slow connection stalls.
   */
  const [reportMode, setReportMode] = useState<'choose' | 'list'>('choose');
  const [unreadReports, setUnreadReports] = useState(0);
  // Persist the chosen View Mode so it survives reloads (Settings → View Mode).
  useEffect(() => { try { localStorage.setItem('navbharat_device_mode', deviceMode); } catch { /* ignore */ } }, [deviceMode]);

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

  // P3.1 — wallet / billing / credits / referral slice extracted into usePaymentEngine (behavior-
  // preserving). Destructured back into the SAME identifiers the render tree already references, so
  // the JSX below is unchanged. The hook owns the Cashfree URL-callback effect + all /api/payment/* +
  // /api/wallet/* actions; nothing payment-owned flows into the build/preview/chat pipeline.
  const {
    FREE_DAILY_MESSAGES,
    wallet, setWallet,
    dailyUsage, setDailyUsage, incrementDailyUsage, isFreeLimitReached,
    billingLogs, setBillingLogs,
    billingTransactions, setBillingTransactions,
    loadingWallet, setLoadingWallet,
    monthlyAiCost, setMonthlyAiCost,
    isRecharging, setIsRecharging,
    paymentSession, setPaymentSession,
    showCheckoutModal, setShowCheckoutModal,
    rechargeStatus, setRechargeStatus,
    activeBillingDetailTab, setActiveBillingDetailTab,
    customPurchaseCredits, setCustomPurchaseCredits,
    showPurchaseFormPanel, setShowPurchaseFormPanel,
    couponCodeInput, setCouponCodeInput,
    isRedeemingCoupon, setIsRedeemingCoupon,
    couponError, setCouponError,
    couponSuccess, setCouponSuccess,
    buyAmountInput, setBuyAmountInput,
    fetchWallet,
    createBillingOrder,
    storeRail, storeConfig, platformFeePct, buyStorePack, buyingProductId, storePurchaseNotice,
    verifyBillingPayment,
    redeemPromoCoupon,
  } = usePaymentEngine({ user, addLog });

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    return localStorage.getItem('navbharat_sidebar_collapsed') === 'true';
  });

  // Pre-warm server on app load so chat is instant when user opens it
  useEffect(() => { fetch('/api/health', { method: 'GET' }).catch(() => {}); }, []);
  // 12.2 — Track app load
  useEffect(() => { trackEvent('app_load', { referrer: document.referrer, ua: navigator.userAgent.slice(0, 100) }); }, []);
  // DNA-level theming (admin 2026-07-14): the ACTIVE theme lives as `data-theme` on <html>, the single
  // source of truth. index.css defines the semantic palette per theme and theme-compat.css remaps the
  // app's hardcoded palette to it — so this one attribute recolours the WHOLE app, on desktop AND mobile
  // (fixes "themes only work on mobile / only header changes"). Portalled modals at <body> inherit it too.
  useEffect(() => {
    try { document.documentElement.setAttribute('data-theme', theme); } catch { /* no document */ }
    // NATIVE FEEL (admin 2026-07-26): follow the theme on the NATIVE status bar too. It used to be
    // pinned to light at startup, so switching to dark mode left a bright status bar sitting above a
    // dark app — a mismatch no real app has. No-op on web; best-effort, never blocks the theme switch.
    void (async () => {
      try {
        const { loadNativeShellContext, syncStatusBarToTheme } = await import('./lib/nativeShell');
        await syncStatusBarToTheme(await loadNativeShellContext(), theme);
      } catch { /* polish only */ }
    })();
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('navbharat_sidebar_collapsed', isSidebarCollapsed.toString());
  }, [isSidebarCollapsed]);


  useEffect(() => {
    localStorage.setItem('navbharat_admin_v1', isAdmin.toString());
  }, [isAdmin]);

  // hinglishMode → from useSettings() hook
  const [loadingUser, setLoadingUser] = useState(true);
  /**
   * 🔒 APP LOCK — is NavBharatAI Pro locked right now? (admin 2026-09-13.)
   *
   * Asked here rather than by a wrapper around the surface, because that surface must NOT be unmounted:
   * it is kept alive across tab switches so a mid-stream build survives, and a gate that unmounted it
   * would destroy the build the user is waiting for. So the answer is read here, the surface is hidden
   * with the same `hidden` class the keep-alive already uses, and the PIN card renders in its place.
   * Default OFF — `useAreaLocked` is false for every user who has not ticked this area.
   */
  const proLocked = useAreaLocked(user?.uid ?? '', 'pro_builder');
  // v5.0 continuity: a hard browser reload must land BACK in NavBharatAI Pro with the same
  // project restored (messages/files/preview) — not dumped to Home. We persist ONLY the v5.0 view
  // (narrow scope; other views still default to Home on reload) in sessionStorage so it survives a
  // reload within the same tab but not a brand-new tab. This restore path deliberately bypasses
  // toggleTab, which is how AgentV3Panel tells a RELOAD (restore) apart from a fresh OPEN (new chat).
  const readV3ViewFlag = (): boolean => {
    try { return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(V3_ACTIVE_FLAG) === '1'; } catch { return false; }
  };
  // SEPARATE from the view flag above: "is the v5.0 TAB open?", which must survive a round trip
  // through another tab. Switching to Settings used to erase the single old flag, so a full page load
  // on the way back (the Supabase consent redirect) returned with NO v5.0 tab at all and the user had
  // to reopen their app from scratch. See v3TabPersistence.ts for the full root cause.
  const readV3TabFlag = (): boolean => {
    try { return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(V3_TAB_FLAG) === '1'; } catch { return false; }
  };
  // Admin access moved OFF the sidebar to a dedicated URL (admin 2026-07-15): /admin deep-links straight
  // into the existing admin view (login → MFA → dashboard). Keeping it a URL (not a visible menu item)
  // means the admin entry isn't advertised in the UI, and it reuses ALL the existing, tested admin
  // wiring rather than duplicating it. A trailing slash is tolerated.
  // Both readers below ask ONE rule (src/lib/deepLinkRoute.ts), which is also what the native shell
  // uses for an incoming App Link and what the Android manifest's claimed paths are asserted against.
  // Before this they were two private path tests, and a deep link would have needed a third — which is
  // precisely how autopsy 1a7f4a58's two subsystems came to answer the same question differently.
  const readUrlRoute = (): DeepLinkView | null => {
    try {
      if (typeof window === 'undefined') return null;
      return routeForPath(window.location.pathname, window.location.search)?.view ?? null;
    } catch { return null; }
  };
  const readAdminRoute = (): boolean => readUrlRoute() === 'admin';
  // Nav App Store deep-link (admin 2026-08-01): navbharatai.com/?view=appstore (or /store) opens the
  // Nav App Store panel straight away, so a shareable link can drop someone directly on the store's
  // Browse tab (public, no login needed) instead of them hunting through Other AI → Publish & Deploy.
  // It reuses the existing 'appstore' view — no duplicate wiring. A trailing slash on /store is tolerated.
  // `/store` opens the store; `/store/app/<id>` is a SHARE LINK to one web app — it must land in the
  // store too (NavAppStore reads the id itself and opens the player directly). `?view=appstore` is the
  // older share link, still in circulation. All three live in routeForPath now.
  const readStoreRoute = (): boolean => readUrlRoute() === 'appstore';
  /**
   * "wahi se start ho" (admin 2026-09-17) — the places the app may land somebody in on launch.
   *
   * Sourced from the professionals REGISTRY rather than a pattern: `other_ai` is the builder-tools
   * hub and matches any `_ai` test, so a regex would have resumed people into a grid of tools they
   * never opened. `PROFESSIONALS_IMPLEMENTED_ELSEWHERE` carries Doctor AI, which has its own
   * component instead of a config — the same list `tabParenting.test.ts` keeps honest.
   */
  const RESUMABLE_PROFESSIONALS = useMemo(
    () => [...Object.keys(PROFESSIONAL_CHATS), ...PROFESSIONALS_IMPLEMENTED_ELSEWHERE],
    [],
  );
  /**
   * 🔒 DOES THE URL ALREADY SAY WHERE TO GO? Then the remembered place must not argue with it.
   *
   * Deliberately broad — ANY non-root path, ANY query string, ANY hash. A share link, an OAuth
   * return (`#gh_token`, `?sbconnect`), `/privacy`, `/store/app/<id>`: each is somebody stating a
   * destination, and a guess about where they might want to be must never override a statement of
   * where they asked to be. An unreadable URL counts as "explicit" for the same reason — when in
   * doubt, leave today's behaviour alone.
   */
  const hasExplicitDestination = (): boolean => {
    try {
      if (typeof window === 'undefined') return true;
      if (readAdminRoute() || readStoreRoute() || readV3ViewFlag()) return true;
      if (window.location.pathname.replace(/\/+$/, '') !== '') return true;
      if ((window.location.search || '').length > 1) return true;
      if ((window.location.hash || '').length > 1) return true;
      return false;
    } catch { return true; }
  };
  const [activeView, setActiveView] = useState<ViewType>(() =>
    readAdminRoute() ? 'admin'
      : readStoreRoute() ? 'appstore'
      : readV3ViewFlag() ? 'nbi_pro_chat'
      : 'home',
  );
  // Scoped History: the NavBharatAI Free footer opens History filtered to Free only. It resets to
  // 'all' whenever we leave the History view, so opening History from anywhere else shows everything.
  const [historyInitialFilter, setHistoryInitialFilter] = useState<'all' | 'free' | 'professional'>('all');
  // The Free chat's History opens OVER the conversation (admin 2026-08-28, matching Pro v5.0)
  // instead of switching to the History tab. Which surfaces get it lives in lib/historySurface.ts.
  const [historyPopupOpen, setHistoryPopupOpen] = useState(false);
  useEffect(() => { if (activeView !== 'history') setHistoryInitialFilter('all'); }, [activeView]);
  // A popup belongs to the screen it was opened over. Leaving the Free chat with it still open would
  // leave the list hanging over whatever came next, so changing view always dismisses it. Opening the
  // popup does NOT change activeView, so this can never close it the moment it opens.
  useEffect(() => { setHistoryPopupOpen(false); }, [activeView]);
  /**
   * THE SCREEN ANNOUNCES ITSELF (admin 2026-09-19) — a fade-through on the incoming view.
   *
   * `useLayoutEffect`, not `useEffect`: the class must be on the node in the SAME frame React commits
   * the new screen. One frame later and the first frame of the new screen has already been painted at
   * full opacity, so the animation starts from a flash — visibly worse than no animation at all.
   *
   * 🔒 NO `key={activeView}` ON THE CONTAINER. That is the obvious way to restart a CSS animation and
   * it would REMOUNT the whole subtree on every tab tap, discarding scroll positions, half-typed
   * messages and open panels. The animation is restarted by hand on the same DOM node instead.
   *
   * The gate is in CSS (native shell, and off under prefers-reduced-motion), so this runs on the
   * website too and does nothing there.
   */
  const screenRef = useRef<HTMLDivElement | null>(null);
  const previousViewRef = useRef<ViewType | null>(null);
  useLayoutEffect(() => {
    if (shouldAnimateViewChange(previousViewRef.current, activeView)) restartScreenEnter(screenRef.current);
    previousViewRef.current = activeView;
  }, [activeView]);
  // Keep the address bar honest about the admin view: reflect /admin while it's open (so a refresh or
  // bookmark reopens it) and restore / on leaving. replaceState (not push) so it never pollutes history.
  useEffect(() => {
    try {
      const onAdminPath = window.location.pathname.replace(/\/+$/, '') === '/admin';
      if (activeView === 'admin' && !onAdminPath) window.history.replaceState(null, '', '/admin');
      else if (activeView !== 'admin' && onAdminPath) window.history.replaceState(null, '', '/');
    } catch { /* history unavailable — best effort */ }
  }, [activeView]);
  // Phase 3.1 — unified Chat+IDE: when an app exists, the live workspace (code +
  // preview) docks to the right of the Pro Chat on desktop. User can collapse it.
  const [settingsScreen, setSettingsScreen] = useState<SettingsScreen>('root');
  /**
   * Where App Mart should open when something navigated there ON PURPOSE. Null until a caller says
   * so, so the store's own default (Browse) is untouched for every other way in.
   */
  const [storeTarget, setStoreTarget] = useState<{ tab?: 'browse' | 'publish' | 'mine' | 'review'; workspaceId: string | null } | null>(null);
  const [githubRedirectingMessage, setGithubRedirectingMessage] = useState<string | null>(null);
  /**
   * A mirror of the message above, for the native listeners.
   *
   * Those listeners are registered ONCE and live for the whole session, so they close over the state as
   * it was at registration — reading `githubRedirectingMessage` inside one would forever see `null` and
   * conclude nothing is in flight. A ref is the value they can actually see.
   */
  const githubRedirectingRef = useRef<string | null>(null);
  useEffect(() => { githubRedirectingRef.current = githubRedirectingMessage; }, [githubRedirectingMessage]);
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
    text: `👋 **Welcome to NavBharatAI!**\n\nWhich language would you like to chat in?\n_(You can always change this later in Settings)_\n\n[🇮🇳 Hindi] [🔀 Hinglish] [🇬🇧 English] [🌐 Auto-detect]`,
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
  // Focus Mode — hides the header (TopNav) + the mobile bottom nav so only the open page/panel is
  // visible. Opt-in (default off) so first-time users always see the normal chrome; persisted so a
  // reload keeps the user's choice. Exited via the floating corner button or Esc (see the keydown
  // effect below) — both always rendered/active even while the header itself is hidden.
  const [focusMode, setFocusMode] = useState<boolean>(() => localStorage.getItem('navbharat_focus_mode') === 'true');
  useEffect(() => { localStorage.setItem('navbharat_focus_mode', focusMode.toString()); }, [focusMode]);
  // 10.6 — Toast notifications
  const { toasts, addToast, removeToast } = useToast();
  // Enter Focus Mode + a ONE-TIME hint so the header disappearing is never confusing —
  // shown only the first time a given browser turns it on.
  const handleEnterFocusMode = () => {
    setFocusMode(true);
    try {
      if (localStorage.getItem('navbharat_focus_mode_hint_seen') !== 'true') {
        addToast('Header hidden — tap the corner icon or press Esc to bring it back', 'info');
        localStorage.setItem('navbharat_focus_mode_hint_seen', 'true');
      }
    } catch { /* localStorage may be unavailable (e.g. some private-browsing modes) */ }
  };
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
  const [sdaResetKey, setSdaResetKey] = useState(0);
  /** Which Doctor AI case History asked for, if any — see SDAChat's `openCaseId`. */
  const [sdaOpenCaseId, setSdaOpenCaseId] = useState<string | undefined>(undefined);
  // The Mode sheet (admin 2026-08-25): footer Mode button → pick FREE / a new FREE chat / any expert.
  const [showModePicker, setShowModePicker] = useState(false);
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

  /**
   * OFFLINE IS A STATE, SO IT GETS A SURFACE THAT LASTS (admin 2026-09-19, item C of five).
   *
   * Phase 6.2 raised a TOAST here on `networkStatus.online`. Two things were wrong with that, and the
   * second is the one that mattered:
   *
   *   1. a toast disappears after a few seconds while the condition lasts for minutes, so anyone who
   *      looked away came back to an app that was quietly failing with no explanation. The persistent
   *      <OfflineBanner/> below is the fix for that half.
   *   2. it read `navigator.onLine`, which reports TRUE on a phone with one bar and no data, a captive
   *      portal or dead DNS — the common WebView case. `reachable` is a real round trip instead. See
   *      src/lib/reachability.ts.
   *
   * What survives as a toast is the RECOVERY, which genuinely is a moment rather than a state — and it
   * is announced only to somebody who actually saw the banner, never on first load.
   */
  const wasUnreachableRef = useRef(false);
  useEffect(() => {
    if (!networkStatus.reachable) { wasUnreachableRef.current = true; return; }
    if (wasUnreachableRef.current) {
      wasUnreachableRef.current = false;
      addToast('Back online', 'success');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [networkStatus.reachable]);
  
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
        const res = await fetch(`/api/sync/${user.uid}`, { headers: await authedHeaders() });
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
      authedHeaders({ 'Content-Type': 'application/json' }).then((headers) =>
        fetch(`/api/sync/${user.uid}`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ sessions, lastApp }),
        })
      ).catch(() => {});
    }, 2500);
    return () => clearTimeout(handle);
  }, [sessions, user]);
  
  // Universal Chat Continuation (UCI) State Managers inside App.tsx
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
  // The v5.0 tab is restored when its TAB flag is set — or when only the legacy active-view flag is
  // present (a session that began before the split), so this fix can never itself close someone's app.
  const [openTabs, setOpenTabs] = useState<ViewType[]>(() =>
    (restoreV3Tab(readV3TabFlag(), readV3ViewFlag()) ? ['nbi_pro_chat'] : []));
  // child→parent tab map: which tab opened each option, so ✕-closing Settings/Professionals also closes
  // the options launched from inside it (admin bug 2026-07-11). Populated in toggleTab, pruned in closeTab.
  const [tabOpeners, setTabOpeners] = useState<Partial<Record<ViewType, ViewType>>>({});
  // CONVERSATION WINDOWS (admin 2026-09-21: *"ek sath ek bar me 5 modes me chat kar sakte hai"*). Up to
  // five professional chats open at once, each its OWN conversation — two Teacher AI windows are two
  // conversations, and the id minted here is what the server keeps their memory apart by. Held BESIDE
  // `openTabs`, never inside it: the tab list is one slot per view id (see lib/chatWindows.ts). A
  // professional's view is in `openTabs` while it has at least one window; `activeChatId` says which of
  // its windows is on screen.
  const [openChats, setOpenChats] = useState<ChatWindow[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  /**
   * THE window on screen: the active view's window named by `activeChatId`, else that view's last
   * window. The fallback is not decoration — `closeTab` lands on "the last remaining tab", which can be
   * an expert whose window was never the focused one, and a professional view with no window on screen
   * would be a tab with nothing behind it. Every reader (the render, the header chips, the Mode sheet's
   * ✕) asks this one value, so they cannot disagree about which conversation is showing.
   */
  const activeChat = useMemo(() => {
    const same = windowsOf(openChats, activeView);
    return same.find((w) => w.id === activeChatId) ?? same[same.length - 1] ?? null;
  }, [openChats, activeView, activeChatId]);
  // Fresh-open nonce: bumped by toggleTab ONLY when the user deliberately OPENS v5.0 from the menu/
  // sidebar (a plain open → start a NEW chat). A reload restores the v5.0 view WITHOUT toggleTab, so
  // the nonce stays 0 → AgentV3Panel takes the RESTORE path instead. A History reopen sets v3Resume
  // and suppresses the bump (see v3ResumeInFlightRef) so it resumes that saved chat, not a new one.
  const [v3OpenNonce, setV3OpenNonce] = useState(0);
  const v3ResumeInFlightRef = useRef(false);

  // Touch swipe → sidebar control (replaces the accidental browser back/forward).
  //
  // 🔒 TWO FIXES FROM ONE REPORT (admin 2026-08-28: "left se right finger swipe ho jaye GALTI SE BHI to
  // slidebar menu open ho jata hai"):
  //
  //   1. OPENING IS OFF BY DEFAULT. It is opt-in under Settings → Touch feedback, and the preference is
  //      read PER TOUCH (not captured at mount), so flipping the switch takes effect on the very next
  //      swipe — the same discipline `installTapHaptics` follows, and the reason this effect still has
  //      no dependency on the preference.
  //   2. WHEN ON, IT MUST START AT THE LEFT EDGE. The real cause of the accidental opens was that this
  //      listened on `document` for ANY mostly-horizontal 70px swipe ANYWHERE: scrolling the preview's
  //      horizontal toolbar, flicking a code block or nudging a carousel all read as "open the menu".
  //      An edge-anchored start is what every OS back-gesture uses, and it cannot collide with content
  //      that scrolls sideways in the middle of the screen.
  //
  // CLOSING is deliberately NOT gated or edge-anchored: it only does anything while the menu is already
  // open and covering the screen, so it can neither surprise the user nor fight page content.
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
      if (dx > 0) {
        if (!shouldOpenMenuOnSwipe(startX, readTapFeedbackPrefs())) return;
        setIsMenuOpen(true);                           // left EDGE → right: open (opt-in)
      } else {
        setIsMenuOpen(prev => (prev ? false : prev));  // right→left: close if open, else nothing
      }
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
  const [donationData, setDonationData] = useState(() => loadPersistedContent('navbharat_donation_v1', DEFAULT_DONATION_DATA));
  // ABOUT US — served from the SERVER so every user sees the same page (2026-09-20).
  //
  // 🔴 It used to be `loadPersistedContent('navbharat_about_v1', …)` with a `localStorage.setItem`
  // beside it and NO server route anywhere in the repo — so an admin's edit was saved on that one
  // browser and reached nobody, while the page showed an "Admin Edit Mode Active" badge over it.
  // The shipped copy (`content/about.ts`) is the fallback, so the page is complete before the fetch
  // returns and stays complete if it fails.
  const [about, setAbout] = useState<AboutContent>(() => aboutContent(null));
  // ⚠️ The overrides are their OWN state, never derived back out of `about`. Deriving them would save
  // the shipped copy as an override, and the page would then be frozen against every later edit to
  // content/about.ts — a change nobody would see failing.
  const [aboutOverrides, setAboutOverrides] = useState<AboutOverrides>({});
  const [aboutSaveState, setAboutSaveState] = useState<'idle' | 'saving' | 'error'>('idle');

  useEffect(() => {
    let active = true;
    fetch('/api/site/about')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (!active || !body?.about) return;
        setAbout(body.about as AboutContent);
        setAboutOverrides((body.overrides ?? {}) as AboutOverrides);
      })
      .catch(() => { /* the shipped copy is already on screen — a failed fetch changes nothing */ });
    return () => { active = false; };
  }, []);

  const saveAboutOverride = useCallback(async (patch: AboutOverrides) => {
    // Show the admin's own edit at once, but do NOT call it saved until the server says so.
    const next = { ...aboutOverrides, ...patch };
    setAbout(aboutContent(next));
    setAboutSaveState('saving');
    try {
      const res = await fetch('/api/admin/site/about', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': localStorage.getItem('admin_token') || '' },
        body: JSON.stringify({ overrides: next }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) { setAboutSaveState('error'); return; }
      if (body.about) setAbout(body.about as AboutContent);
      setAboutOverrides((body.overrides ?? next) as AboutOverrides);
      setAboutSaveState('idle');
    } catch {
      setAboutSaveState('error');
    }
  }, [aboutOverrides]);



  // Platform SRE & Cost Analytics State (Admin Console)
  const [adminAnalytics, setAdminAnalytics] = useState<any>(null);
  const [loadingAdminAnalytics, setLoadingAdminAnalytics] = useState(false);
  // G2 — live metrics snapshot for the admin metrics dashboard panel.
  const [adminLiveMetrics, setAdminLiveMetrics] = useState<any>(null);
  const [loadingAdminMetrics, setLoadingAdminMetrics] = useState(false);


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

  const [githubRepoContext, setGithubRepoContext] = useState<any>(() => safeLocalJson<any>('navbharat_gh_context', null));

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

  const [isSearching, setIsSearching] = useState(false);
  const [files, setFiles] = useState<FileSystem>({
    'index.html': `<!DOCTYPE html><html><body style="background:#0d1117;color:#8b949e;display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;margin:0"><div><h2 style="color:white">Welcome to Navbharat AI Sandbox</h2><p>Edit index.html to see changes or ask AI to build something!</p></div></body></html>`,
    'script.js': 'console.log("Welcome to your AI workspace");',
    'style.css': 'body { margin: 0; font-family: system-ui; }'
  });
  const [activeFile, setActiveFile] = useState<string>('index.html');
  const [fileUploadConflict, setFileUploadConflict] = useState<{ file: File; existingKey: string; isZip: boolean } | null>(null);
  const [zipSizeModal, setZipSizeModal] = useState<{ variant: ZipSizeModalVariant; fileName: string; fileSizeMB: number } | null>(null);
  const filesUploadRef = useRef<HTMLInputElement>(null);
  const [isDeployed, setIsDeployed] = useState(false);
  const [deployUrl, setDeployUrl] = useState('');
  const [showDeployPanel, setShowDeployPanel] = useState(false);
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

  // ── Apnapan Engine — user personalization profile (logic in src/lib/apnapanEngine.ts) ──
  const [apnapanProfile, setApnapanProfile] = useState<ApnapanProfile>(loadApnapanProfile);

  const learnFromMessage = (text: string) => {
    setApnapanProfile(prev => {
      const next = updateApnapanProfile(text, prev);
      saveApnapanProfile(next);
      return next;
    });
  };

  // 9.1 — Ctrl+Z / Ctrl+Y keyboard shortcuts for undo/redo
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const inInput = document.activeElement?.tagName === 'TEXTAREA' || document.activeElement?.tagName === 'INPUT';
      // L7: Escape — close any open modal overlay
      if (e.key === 'Escape') {
        if (showAuth) { setShowAuth(false); return; }
        if (showCheckoutModal) { setShowCheckoutModal(false); return; }
        if (showPurchaseFormPanel) { setShowPurchaseFormPanel(false); return; }
        if (showDeployPanel) { setShowDeployPanel(false); return; }
        if (showContinueModal) { setShowContinueModal(false); return; }
        // No modal was open — if Focus Mode is on, Esc brings the header back (always works, even
        // though the on-screen toggle/floating button might be out of view).
        if (focusMode) { setFocusMode(false); return; }
        return;
      }
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
  }, [canUndo, canRedo, undoCode, redoCode, addToast, showAuth, showCheckoutModal, showPurchaseFormPanel, showDeployPanel, showContinueModal, focusMode]);

  const [keys, setKeys] = useState<ApiKeys>(() => {
      const defaults = { gemini: '', groq: '', deepseek: '', openai: '', openrouter: '', claude: '' };
      return { ...defaults, ...safeLocalJson<Partial<ApiKeys>>('navbharat_keys', {}) };
  });
  const [showKeyStates, setShowKeyStates] = useState<Record<string, boolean>>({
      gemini: false, groq: false, deepseek: false, openai: false, openrouter: false, claude: false
  });
  // mode, setMode → from useSettings() hook
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminError, setAdminError] = useState('');
  // P-SEC.3 — admin TOTP MFA second factor.
  const [adminTotp, setAdminTotp] = useState('');
  const [adminMfaRequired, setAdminMfaRequired] = useState(false);

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminError('');
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: adminEmail, password: adminPassword, totp: adminTotp }),
      });
      const raw = await res.text();
      let data: any = {};
      try { data = JSON.parse(raw); } catch { /* non-JSON response (rate-limit text, HTML error, etc.) */ }
      if (res.ok && data.ok) {
        // ROOT-CAUSE FIX (admin 2026-07-25: "mobile app open karo to login karna pad raha hai" — the
        // admin dashboard's fetches were silently 401ing after every cold app restart with "Admin
        // session expired — please log out and log in again"). sessionStorage is tied to the WebView's
        // current top-level navigation and is GUARANTEED empty after a fresh launch (a full app kill +
        // reopen is a brand-new navigation, on both iOS and Android, every single time) — unlike
        // localStorage, which is disk-backed and survives a cold restart. The `isAdmin` flag was
        // already correctly in localStorage; the token that flag's dashboard actually needs was not.
        localStorage.setItem('admin_token', data.token);
        setIsAdmin(true);
        setAdminMfaRequired(false);
        setAdminTotp('');
        toggleTab('home');
        addLog('Admin: Access Granted.', 'success');
      } else {
        // P-SEC.3 — the server asks for a second factor: reveal the code field, don't treat
        // it as a hard failure on the first prompt.
        if (data.mfaRequired) {
          setAdminMfaRequired(true);
          setAdminError(adminTotp ? (data.error || 'Invalid authenticator code.') : '');
          addLog('Admin: Authenticator code required.', 'info');
        } else {
          // Surface the REAL reason: server JSON error, or the raw status + body.
          setAdminError(data.error || `HTTP ${res.status}: ${raw.slice(0, 200) || '(empty response)'}`);
          addLog('Admin: Access Denied.', 'error');
        }
      }
    } catch (err: any) {
      setAdminError(`Network error: ${err?.message ?? String(err)}`);
    }
  };

  const [homeData, setHomeData] = useState(() => loadPersistedContent('navbharat_home_v1', DEFAULT_HOME_DATA));

  useEffect(() => {
    localStorage.setItem('navbharat_home_v1', JSON.stringify(homeData));
  }, [homeData]);











  useEffect(() => {
    // Finalize a social sign-in that used the REDIRECT fallback (popup is primary).
    // signInWithRedirect navigates the whole page away and back, so the auth modal
    // that started it is gone on return — getRedirectResult MUST run here at the app
    // root to complete it. For a GitHub redirect we also capture the OAuth token so
    // NavBharatAI can connect to the user's repos.
    // WEB ONLY — getRedirectResult: the native app never uses the redirect flow (it signs in via the
    // native plugin), and its auth instance is deliberately created WITHOUT the popup/redirect resolver
    // (src/lib/firebase.ts — the WKWebView init-hang root fix), so calling getRedirectResult there would
    // throw on every launch.
    //
    // ⚠️ ROOT CAUSE of the "iOS app opens logged-out after every restart" bug (admin 2026-08-02, survived
    // 8 fix attempts): this web-only guard used to be `if (Capacitor.isNativePlatform()) return;` — an
    // EARLY RETURN that also skipped the onAuthStateChanged subscription below. On the native app NOTHING
    // listened to Firebase auth: a restored session (and the cold-restart persistence heal wired inside
    // the listener) never reached the UI, so every relaunch looked logged-out even when the session was
    // saved. In-session login only appeared to work because AuthComponent flips the UI directly. The
    // guard must therefore wrap ONLY getRedirectResult — the listener below runs on BOTH platforms.
    if (!Capacitor.isNativePlatform()) {
      getRedirectResult(auth)
        .then((result) => {
          if (result?.user) {
            try {
              const ghCred = GithubAuthProvider.credentialFromResult(result);
              if (ghCred?.accessToken) {
                localStorage.setItem('gh_token', ghCred.accessToken);
                rememberGithubOwner(result.user.uid); // this token belongs to THIS user
                setGithubToken(ghCred.accessToken);
              }
            } catch { /* not a GitHub sign-in — ignore */ }
            setUser(result.user);
            setLoadingUser(false);
            setShowAuth(false);
          }
          // JUDGE THE RETURN (admin 2026-08-22 — the Apple login loop). A null result here is
          // ambiguous: it is what an ordinary page load reports AND what "came back from Apple with
          // nothing" reports. The marker written before we handed over the page is the only thing that
          // separates them, so this is the one place the reported failure can be seen at all.
          const store = typeof sessionStorage !== 'undefined' ? sessionStorage : null;
          const marker = readRedirectMarker(store, Date.now());
          const verdict = redirectReturnVerdict({
            marker,
            resultUser: result?.user ?? null,
            currentUser: auth.currentUser,
          });
          if (verdict !== 'none') clearRedirectMarker(store);   // judged once, never twice
          if (verdict === 'recovered') {
            // The session landed even though getRedirectResult gave nothing — a real SDK race this
            // codebase has hit twice on the popup path. Telling a signed-in user it failed would be
            // the worst possible answer, so adopt the session instead.
            setUser(auth.currentUser);
            setLoadingUser(false);
            setShowAuth(false);
          } else if (verdict === 'lost') {
            addToast(redirectLostMessage(marker?.provider), 'error');
          }
        })
        .catch((e) => {
          const code = e?.code || '';
          // BOTH, NEVER `code || message` (2026-08-22). The old line was `code || e?.message || e`, and
          // the code is always truthy — so Google's own explanation of the failure, which the SDK puts
          // in `.message` whenever the server sent one after ` : `, was never printed. That is why the
          // admin's screenshot of a real, reproducible Apple failure showed a bare
          // `auth/invalid-credential` and not one word about WHY. See authErrorDetail.
          const detail = authErrorDetail(e);
          console.error('[auth] social redirect failed:', code || e?.message || e, detail ? `— ${detail}` : '');
          // SAY WHY (admin 2026-08-21). This used to show "Sign-in failed. Please try again." for every
          // cause — true of all of them, useful for none, and on a phone there is no console to read the
          // real code from. socialRedirectFailureMessage names the causes we can act on and carries the
          // raw code for the rest; it returns null only for auth/no-auth-event, which is what a normal
          // page load reports when no redirect was pending.
          // …and the detail travels to the TOAST too, because on a phone there is no console at all —
          // which is the entire reason this function exists.
          const message = socialRedirectFailureMessage(code, detail);
          if (message) addToast(message, 'error');
        });
    }
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoadingUser(false);
      if (currentUser) {
        setShowAuth(false);
        // Native push notifications (admin 2026-07-26): register this device's FCM token now that a
        // real, verified session exists. No-op on web; best-effort — never blocks sign-in.
        void initPushNotifications(currentUser.uid);
        // COLD-RESTART LOGOUT FIX (admin 2026-07-25) — verify the signed-in session was written to a
        // DURABLE store and self-heal it if it was not (the native auth instance can silently be running
        // in-memory, which is what made every app relaunch come back logged out). Fire-and-forget: it is
        // best-effort, never throws, and must never delay the UI reacting to a successful sign-in.
        void ensureNativeSessionPersisted();
        // FORGET THE OLD ACCOUNT ROSTER (admin 2026-09-19 — the switcher was removed).
        //
        // Until today this same spot RECORDED every account that signed in on this device, to feed a
        // "Switch account" list. That list is gone, so the stored copy must go too rather than sit in
        // localStorage for ever with no screen that can clear it: on a shared or family phone it is a
        // list of everyone who ever signed in here, and its own module warned about exactly that. The
        // two sign-in hint keys it wrote go with it — nothing reads them any more, and a key nobody
        // reads is precisely what this repo has already had to delete once before.
        //
        // Runs on every signed-in load and costs three `removeItem` calls on an empty store, which is
        // cheaper than a flag recording that the cleanup has happened.
        try {
          if (typeof localStorage !== 'undefined') {
            for (const k of ['nbai:accounts', 'nbai:sign-in-hint', 'nbai:sign-in-provider']) localStorage.removeItem(k);
          }
        } catch { /* blocked storage — there is nothing stored to clean up either */ }
        // REGISTRATION CONVERSION — reported HERE for the same reason the roster above is: this is
        // the ONE place every successful sign-in passes through, so all eight paths (email, phone
        // web/native, Google popup/redirect/native, GitHub) are covered without each growing its own
        // wiring, and a ninth added later is covered for free.
        //
        // "New account" is derived from Firebase's own stamps rather than from which button was
        // pressed, and it is deduped per uid — onAuthStateChanged also fires on every page load and
        // token refresh, and Firebase keeps reporting the same creationTime forever, so without the
        // guard one signup would re-report on every reload and inflate the number ad spend is
        // optimised against. See signupSignal.ts.
        try {
          const decision = decideSignupReport(
            localStorage.getItem(SIGNUP_REPORTED_KEY),
            currentUser.uid,
            isNewAccount(currentUser.metadata?.creationTime, currentUser.metadata?.lastSignInTime),
          );
          if (decision.report) {
            if (decision.nextStored) localStorage.setItem(SIGNUP_REPORTED_KEY, decision.nextStored);
            trackEvent('signup', { provider: currentUser.providerData?.[0]?.providerId || 'unknown' });
          }
        } catch { /* measurement must never affect signing in */ }
        // GITHUB CONNECTION IS PER-USER: pick up this user's OWN GitHub token, but NEVER inherit a
        // token authorized by a different NavBharatAI user on this browser (the "every user sees my
        // account" bug). resolveGithubConnectionForUser decides keep / claim / clear.
        try {
          const stored = localStorage.getItem('gh_token');
          const owner = readGithubOwner();
          const r = resolveGithubConnectionForUser(currentUser.uid, stored, owner);
          if (r.reason === 'cleared-different-user') {
            clearGithubConnection();
            setGithubToken(null);
            setGithubUser(null);
          } else if (r.token) {
            if (r.changed) rememberGithubOwner(r.ownerUid); // claim a legacy/unowned token
            setGithubToken(r.token);
          }
        } catch { /* connection guard is best-effort — never blocks sign-in */ }
      }
    });
    return unsubscribe;
  }, []);

  // Close auth modal the moment any login method completes (defensive belt-and-
  // suspenders — onAuthStateChanged above handles it, but the extra effect
  // catches any edge case where user becomes non-null without the listener firing
  // before the modal is shown again).
  useEffect(() => {
    if (user) setShowAuth(false);
  }, [user]);

  // STABLE LOGIN, part 2 (admin 2026-07-20): the gates above open protected views OPTIMISTICALLY while
  // the saved session is still restoring (so a returning user never sees a login flash). This is the
  // honest other half: the moment the restore SETTLES genuinely logged-out while a protected view is
  // open (tapped during the window, or a reload that restored straight into Pro v5.0), ask for sign-in
  // NOW. A signed-in restore hits the `if (user) setShowAuth(false)` effect above instead — zero friction.
  useEffect(() => {
    if (loadingUser || user) return;
    if (isAuthGatedView(activeView)) setShowAuth(true);
  }, [loadingUser, user, activeView]);

  // Admin login = full app access. When the admin is signed in (separate server
  // password auth), treat them as a logged-in user so the app never forces the
  // Firebase login modal. A real Firebase sign-in always takes precedence; the
  // synthetic identity is cleared on admin logout. The app only reads
  // user.uid / email / displayName (no Firebase methods), so this is safe.
  useEffect(() => {
    if (isAdmin && !user) {
      setUser({
        uid: 'admin',
        email: 'admin@navbharatai.in',
        displayName: 'Admin',
        photoURL: null,
      } as unknown as FirebaseUser);
      setLoadingUser(false);
    } else if (!isAdmin && user && (user as { uid?: string }).uid === 'admin') {
      setUser(null);
    }
  }, [isAdmin, user]);

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

  /**
   * Open (or focus) a view. Returns whether it navigated — false when a gate refused (Play compliance,
   * a held-back tool, sign-in required) or, for a professional, when the window cap did.
   *
   * `conversationId` (2026-09-21) names WHICH conversation to show for a professional: a fresh id from
   * the Mode picker's "New chat", an ongoing one from History. `resumeEndedAt` names an ENDED one to
   * bring back — the cap is checked FIRST and the archive touched only once a window is certain, so a
   * refused open never leaves a row "ongoing" with nothing behind it. Without either, a professional
   * with no window open reopens its most recent ongoing conversation (or starts one), and one with
   * windows open is simply focused — so every door into an expert leads to a window, by construction.
   */
  const toggleTab = useCallback((view: ViewType, pushToHistory = true, conversationId?: string, resumeEndedAt?: number): boolean => {
    // Play compliance choke point: EVERY tab-open path goes through toggleTab, so blocking here (plus
    // the render guards below) means a medical view cannot open in the native shell no matter which
    // button, deep link, or restored state asked for it.
    if (medicalViewBlocked(view, isNativeApp())) return false;
    // HELD-BACK TOOLS (admin 2026-09-15): the Other page already renders these tiles disabled, but the
    // gate belongs HERE too, for the same reason the medical one does — this is the single path every
    // tab-open takes, so a tool the admin has not tested cannot be reached by any button, deep link or
    // future doorway that forgets to ask. Re-enabling is one line in lib/comingSoonTools.ts.
    if (isComingSoonTool(view)) return false;
    // Pre-warm server when user opens chat tabs (fire-and-forget)
    if (view === 'nbi_chat' || view === 'nbi_pro_chat') {
      fetch('/api/health', { method: 'GET' }).catch(() => {});
    }

    // v5.0 fresh-open signal: a deliberate open of the Pro tab starts a NEW chat. A History reopen
    // sets v3Resume first and flags v3ResumeInFlightRef so we DON'T bump the nonce (it must resume,
    // not start fresh). The nonce is never bumped on reload (reload restores the view without calling
    // toggleTab), which is exactly how the panel distinguishes open-new from reload-restore.
    if (view === 'nbi_pro_chat') {
      if (v3ResumeInFlightRef.current) {
        v3ResumeInFlightRef.current = false; // consume the resume signal — no fresh-open this time
        setV3OpenNonce(0);                   // clear any stale fresh-open nonce so a remount resumes, not news
      } else {
        setV3OpenNonce(Date.now());
      }
    }

    // STABLE LOGIN (admin 2026-07-20: "har baar login karna pad raha hai"): these gates used to check
    // only `!user` — but on every app open Firebase restores the saved session ASYNCHRONOUSLY, so for
    // the first ~0.3–2s `user` is null even for a signed-in returning user, and tapping a protected tab
    // flashed the LOGIN screen (users then logged in again — every single open). authGateDecision opens
    // optimistically while the restore is still running (never flash login at a returning user); a
    // genuinely signed-out user is prompted the moment the restore SETTLES (the effect below toggleTab).
    if (authGateDecision(view, !!user, loadingUser) === 'login') {
      if (view === 'history') pendingViewAfterLoginRef.current = view;
      setShowAuth(true);
      addLog(
        view === 'security' ? 'Security Audit requires an active session. Please login.'
          : view === 'history' ? 'Chat history requires an active session. Please login.'
          : `${view === 'sda_chat' ? 'Doctor AI' : 'NavBharatAI Pro'} is available for logged-in users only. Please sign in.`,
        'warn',
      );
      return false;
    }

    // A PROFESSIONAL IS ENTERED THROUGH A WINDOW (admin 2026-09-21). After every gate above, so a refused
    // view never gets one. A named conversation is opened (or focused) as its own window; otherwise the
    // expert's last ongoing conversation is reopened — the continuity a reload used to get from the one
    // live slot — or a new one is minted. The cap refuses honestly, with a toast, and does NOT navigate:
    // an expert tab with no window behind it would be the fake-window class. Repo Analyst is in the
    // config map but has its own tool below, so it is not windowed (lib/chatWindows.ts says which).
    if (isWindowedProfessional(view)) {
      const existing = windowsOf(openChats, view);
      const store = professionalStore();
      let wanted: string | null = conversationId ?? null;
      if (resumeEndedAt !== undefined) {
        // Cap BEFORE the archive is touched (review finding 2026-09-21): a resume that is then refused
        // would leave the row "ongoing" with no window, and could shed an on-screen window's own
        // conversation from the store's open list.
        if (openChats.length >= MAX_OPEN_CHATS) { addToast(capMessage(), 'warning'); return false; }
        wanted = store ? resumeArchived(store, view, resumeEndedAt) : null;
        if (!wanted) return false; // the record is gone — the view re-reads rather than opening a blank chat
      }
      if (!wanted && existing.length === 0) wanted = (store && latestOpenConversationId(store, view)) || newConversationId();
      if (wanted) {
        if (!existing.some((w) => w.id === wanted)) {
          const opened = openWindow(openChats, { id: wanted, professionalId: view });
          if (!opened.opened) { addToast(capMessage(), 'warning'); return false; }
          setOpenChats(opened.windows);
        }
        setActiveChatId(wanted);
      } else if (!existing.some((w) => w.id === activeChatId)) {
        setActiveChatId(existing[existing.length - 1].id);
      }
    }

    if (!openTabs.includes(view)) {
      setOpenTabs(prev => [...prev, view]);
      // Remember which tab OPENED this one when it is launched from inside Settings or Professionals,
      // so ✕-closing that parent also closes the option it spawned (admin bug 2026-07-11). Opened from
      // anywhere else → no parent link (it's an independent tab).
      // The rule asks about the CHILD as well as the parent — see lib/tabParenting.ts. Asking only
      // "who opened this?" left a professional opened from NavBharatAI Free with no parent, so ✕-ing
      // Free orphaned it (admin 2026-08-25); asking only "was it opened from Free?" would have made
      // Settings a child of Free and closed it too.
      // `parentForOpen` resolves the DOOR, not the room beside it: a professional opened from inside
      // another professional inherits the tab both were entered through (2026-09-20). Without that,
      // ✕-closing Free left the second one behind — and ✕-closing the first would have taken it down.
      setTabOpeners(prev => {
        const parent = parentForOpen(view as string, activeView as string, prev as Record<string, string | undefined>);
        return parent ? { ...prev, [view]: parent as ViewType } : prev;
      });
    }

    if (pushToHistory && activeView !== view) {
      setTabHistories(prev => ({
        ...prev,
        [activeView]: [...(prev[activeView] || []), view]
      }));
    }
    
    setActiveView(view);
    return true;
  }, [user, openTabs, activeView, addLog, setShowAuth, openChats, activeChatId, addToast]);

  // Cross-component navigation (billing PR 5): deeply-nested surfaces (e.g. the v5.0 panel inside
  // ProV3Surface, which gets no nav callback) can request a view switch by dispatching
  // `navbharat:navigate` with { detail: { view } } instead of threading a prop through every layer.
  useEffect(() => {
    const onNavigate = (e: Event) => {
      const detail = (e as CustomEvent<{ view?: ViewType; settingsScreen?: string; fixPrompt?: string; autoSend?: boolean; signIn?: 'phone'; storeTab?: 'browse' | 'publish' | 'mine' | 'review'; storeWorkspaceId?: string }>).detail;
      // OPEN THE SIGN-IN SCREEN (admin 2026-08-22). The verify sheet refuses a number that belongs to
      // another account and offers the one thing that helps — signing in with it, which opens that
      // account. It rides this existing event rather than a new prop chain: the sheet lives four
      // components deep and App is the only place that owns `showAuth`.
      if (detail?.signIn === 'phone') { setShowAuth(true); return; }
      if (detail?.view) toggleTab(detail.view);
      // A surface that hit a wall can hand v5 the whole problem (the APK build's "Fix" button). The
      // nonce lets the SAME text re-trigger, so pressing Fix twice is not silently ignored.
      if (detail?.fixPrompt) {
        setV3PendingFix({ text: detail.fixPrompt, nonce: Date.now(), autoSend: detail.autoSend === true });
      }
      // Landing on Settings' ROOT when the caller meant a specific screen is a dead end: the user is
      // sent away mid-task and has to find their way back. Carrying the screen makes "connect my own
      // database" land on the database form itself.
      if (detail?.settingsScreen) setSettingsScreen(detail.settingsScreen as SettingsScreen);
      // Same reasoning as `settingsScreen`, for App Mart: the publish sheet's "Publish on App Mart"
      // button knows which tab AND which app it means, so landing the user on Browse would make them
      // find their own way to the form they just asked for.
      if (detail?.storeTab || detail?.storeWorkspaceId) {
        setStoreTarget({ tab: detail.storeTab, workspaceId: detail.storeWorkspaceId ?? null });
      }
    };
    window.addEventListener('navbharat:navigate', onNavigate as EventListener);
    return () => window.removeEventListener('navbharat:navigate', onNavigate as EventListener);
  }, [toggleTab, setSettingsScreen]);


  // A shake anywhere in the app opens the report sheet. The hook is a no-op on desktop and wherever
  // the device will not give a page motion access — see useShakeToReport for why iOS is deliberate.
  /**
   * The testing notice, for THIS app open. Seeded from sessionStorage so a reload or a fresh app
   * launch shows it again while tapping Home a second time does not — see lib/testingNotice.ts.
   * Read once, in the initialiser, so a re-render can never resurrect a notice the user dismissed.
   */
  const [testingNoticeOpen, setTestingNoticeOpen] = useState(() => !testingNoticeAlreadyShown());

  /**
   * 🔴 ANDROID'S HARDWARE BACK BUTTON (admin 2026-09-17: *"kisi bhi page par back press karne se
   * app band ho jati hai"*).
   *
   * It closed the app from every screen because the old handler asked the WebView whether it could go
   * back, and this app never puts anything in the WebView's history — `toggleTab` ends in
   * `setActiveView`. So the answer was always "no", and "no" meant exit. The full account is in
   * `androidBack.ts`; what lives HERE is the only thing that could not live there: the app's state.
   *
   * ⚠️ THE ORDER OF `openOverlays` IS OUTERMOST-FIRST — the LAST entry is what Back closes. In
   * practice only one of these is ever open at a time, so the order decides almost nothing; it is
   * written down anyway because the day two of them overlap is not the day to be guessing.
   *
   * 🔒 ADDING A NEW FULL-SCREEN OVERLAY? Add it to this list. Leaving it out is not a crash — Back
   * will jump to Home from on top of it, which is the wrong answer rather than no answer.
   */
  const [exitPromptOpen, setExitPromptOpen] = useState(false);

  useEffect(() => {
    const onHardwareBack = () => {
      const openOverlays: string[] = [];
      if (isMenuOpen) openOverlays.push('menu');
      if (showDeployPanel) openOverlays.push('deploy');
      if (showModePicker) openOverlays.push('mode-picker');
      if (historyPopupOpen) openOverlays.push('history');
      if (showContinueModal) openOverlays.push('continue');
      if (reportOpen) openOverlays.push('report');
      if (zipSizeModal) openOverlays.push('zip-size');
      if (showAuth) openOverlays.push('auth');
      if (testingNoticeOpen) openOverlays.push('testing-notice');

      const action = decideBackAction({ exitPromptOpen, openOverlays, isHome: activeView === 'home' });
      switch (action.type) {
        case 'dismiss-exit-prompt': setExitPromptOpen(false); return;
        case 'close-overlay':
          switch (action.id) {
            case 'menu': setIsMenuOpen(false); return;
            case 'deploy': setShowDeployPanel(false); return;
            case 'mode-picker': setShowModePicker(false); return;
            case 'history': setHistoryPopupOpen(false); return;
            case 'continue': setShowContinueModal(false); return;
            case 'report': setReportOpen(false); return;
            case 'zip-size': setZipSizeModal(null); return;
            case 'auth': setShowAuth(false); return;
            case 'testing-notice': setTestingNoticeOpen(false); return;
            // An id with no closer would be a Back press that does nothing — the one outcome
            // `androidBack.ts` refuses to produce. Falling through to Home keeps Back meaningful.
            default: toggleTab('home'); return;
          }
        case 'go-home': toggleTab('home'); return;
        case 'confirm-exit': setExitPromptOpen(true); return;
      }
    };
    window.addEventListener(HARDWARE_BACK_EVENT, onHardwareBack as EventListener);
    return () => window.removeEventListener(HARDWARE_BACK_EVENT, onHardwareBack as EventListener);
  }, [
    exitPromptOpen, activeView, toggleTab,
    isMenuOpen, showDeployPanel, showModePicker, historyPopupOpen,
    showContinueModal, reportOpen, zipSizeModal, showAuth, testingNoticeOpen,
  ]);

  /**
   * The user pressed Exit. `exitNativeApp` reports whether the plugin really ran, and a false is NOT
   * treated as "closed anyway": the dialog closes so the user is not stranded staring at a dead
   * button, and they remain in a working app. Never claim an exit we could not perform.
   */
  const confirmExitApp = useCallback(() => {
    void loadNativeShellContext()
      .then((ctx) => { exitNativeApp(ctx); })
      .catch(() => { /* best effort — the dialog closes either way */ })
      .finally(() => setExitPromptOpen(false));
  }, []);
  // The four welcome-gift steps, for the notice's checklist. Returns empty without a request on the
  // website and for a signed-out visitor, so nothing here costs anything outside the Android app.
  const referralProgress = useReferralProgress(user?.uid ?? null);
  // A code typed on the sign-in screen is applied here, once, the moment there is an account for it.
  // Returns a message either way; it can never throw into the screen the user just signed in to.
  useHeldReferralCode(user?.uid ?? null, referralProgress.refresh);
  useShakeToReport(useCallback(() => { setReportMode('choose'); setReportOpen(true); }, []));

  /**
   * Keep the sidebar's unread dot honest.
   *
   * Refreshed on sign-in, every three minutes, and once more whenever the sheet CLOSES — that last
   * one is what makes the dot go out immediately after somebody reads a reply, instead of lingering
   * for up to a poll interval on a menu they are still looking at.
   *
   * A failed poll leaves the previous number alone rather than clearing it: guessing zero would hide
   * a real reply, and guessing anything else would invent one.
   */
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      if (!user) { if (alive) setUnreadReports(0); return; }
      try {
        const res = await fetch('/api/report/unread', { headers: await authedHeaders() });
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        if (alive && typeof data?.unread === 'number') setUnreadReports(data.unread);
      } catch { /* leave the last known number — see above */ }
    };
    void pull();
    const t = setInterval(() => void pull(), 180_000);
    return () => { alive = false; clearInterval(t); };
  }, [user, reportOpen]);

  // Persist ONLY the v5.0 view so a reload lands back in Pro v5.0 (see activeView init). Any other
  // view clears the flag, so leaving v5.0 and reloading correctly returns to Home.
  useEffect(() => {
    try {
      if (v3IsActive(activeView)) sessionStorage.setItem(V3_ACTIVE_FLAG, '1');
      else sessionStorage.removeItem(V3_ACTIVE_FLAG);
    } catch { /* storage unavailable (private mode) — reload just falls back to Home */ }
  }, [activeView]);

  // …and SEPARATELY persist whether the v5.0 TAB is open, which is a different question (window
  // semantics: a tab stays open while another tab is in front). This is what carries v5.0 across a
  // full-page round trip — the Supabase consent redirect above being the one that exposed it: with
  // only the active-view flag, opening Settings erased v5.0 and the user had to reload their whole
  // app to get back. ✕-closing the tab removes it from openTabs, which clears the flag here.
  useEffect(() => {
    try {
      if (v3TabIsOpen(openTabs)) sessionStorage.setItem(V3_TAB_FLAG, '1');
      else sessionStorage.removeItem(V3_TAB_FLAG);
    } catch { /* storage unavailable (private mode) — degrades to the old behaviour, never worse */ }
  }, [openTabs]);

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
  // P3.1 — preview build / client-side bundler slice extracted into usePreviewBundler (behavior-
  // preserving). Placed here so all its deps (files, setGeneratedCode, activeFile, activeAgent,
  // toggleTab, incrementDailyUsage) are defined above, and closeTab below can still reset preview
  // state. Destructured back into the SAME identifiers the render tree already referenced.
  const {
    isPreviewBuilding, setIsPreviewBuilding,
    previewBuildError, setPreviewBuildError,
    previewBuildStage, setPreviewBuildStage,
    detectedFramework, setDetectedFramework,
    problems, setProblems,
    previewHistory, setPreviewHistory,
    handleTriggerPreviewBuild,
    updatePreview,
    handleFileChange,
    runCode,
  } = usePreviewBundler({ files, setFiles, setGeneratedCode, activeFile, activeAgent, toggleTab, incrementDailyUsage, addLog, addToast });

  // `e` is OPTIONAL so the SAME close runs from two places: the header tab's ✕ (which must stop the
  // click from also selecting the tab) and a panel's own "Close" button, which has no tab click to
  // stop. Giving the panel its own close would have meant a second copy of the tab/child/companion
  // teardown below — the kind of duplicate that drifts and then disagrees.
  const closeTab = useCallback((e: React.MouseEvent | undefined, view: ViewType) => {
    e?.stopPropagation();

    // If user closes home tab, just go to it but don't close
    if (view === 'home') {
      toggleTab('home', false);
      return;
    }

    // Compute the FULL set of tabs to close: the tab itself + every option opened from inside it
    // (Settings/Professionals children) + fixed companions (the Pro chat owns the preview tab). This is
    // what makes ✕-closing Settings/Professionals also close the options launched from within them.
    const { closing, nextTabs, nextActiveView } = computeTabClose(
      view,
      openTabs as string[],
      activeView as string,
      tabOpeners as Record<string, string>,
      { nbi_pro_chat: ['preview'] },
    );
    const closingSet = new Set<string>(closing);

    setOpenTabs(prev => prev.filter(t => !closingSet.has(t)));
    if (nextActiveView !== null) setActiveView(nextActiveView as ViewType);
    // Every WINDOW of a closing professional goes with it (their transcripts are archived below).
    setOpenChats(prev => prev.filter(w => !closingSet.has(w.professionalId)));
    if (openChats.some(w => w.id === activeChatId && closingSet.has(w.professionalId))) setActiveChatId(null);

    setTabHistories(prevHistories => {
      const nextHistories = { ...prevHistories };
      for (const v of closing) delete nextHistories[v as ViewType];
      return nextHistories;
    });
    // Drop the parent links for every tab we just closed so they can't leak into a future close.
    setTabOpeners(prev => {
      const next = { ...prev };
      for (const v of closing) delete next[v as ViewType];
      return next;
    });

    // Per-tab state reset for EVERY tab actually closed (the parent and each child), so nothing is left
    // half-open on reopen — Settings drops back to its root menu, and the chat tabs get a clean slate.
    for (const v of closing) {
      if (v === 'settings') {
        // ✕-closing Settings clears the open sub-option so the next open starts at the root menu.
        setSettingsScreen('root');
      } else if (v === 'nbi_chat') {
        setMessages([]);
        setInput('');
        // Reset session so memorySummary doesn't bleed into next conversation
        setCurrentSessionId(Date.now().toString());
      } else if (v === 'nbi_pro_chat') {
        // ✕ CLOSE = one of the only ways the v5.0 chat ends (admin rule 2026-07-05): clear the sticky
        // session so the NEXT open starts a fresh chat. Everything short of this ✕ (tab switches,
        // reload, phone off) restores the same chat. A still-running build keeps running server-side
        // and lands in ☰ History with all its build files (durable WorkspaceFileStore).
        clearStickySession(user?.uid);
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
      } else if (v === 'sda_chat') {
        // Closing Doctor AI ends the CASE on screen and reopens on a fresh one — the same promise ✕
        // makes for every professional. 🔴 It used to keep that promise by DELETING the transcript
        // (`removeItem('sda_messages')`), which with one shared key and one shared Firestore document
        // destroyed the patient's case outright. `startFreshCase` keeps the promise without the loss:
        // the next case gets its own address, and this one stays in History as its own row.
        setSdaOpenCaseId(undefined);
        startFreshCase(typeof window !== 'undefined' ? window.localStorage : null, newSdaCaseId(), user?.uid);
        setSdaResetKey(k => k + 1);
      } else if (PROFESSIONAL_CHATS[v]) {
        // ✕ ENDS A PROFESSIONAL CHAT (admin 2026-08-19: "close (x) kar de, to chat close nahi hota").
        // Every config-driven professional restores itself from localStorage on mount, so removing the
        // tab alone left the conversation waiting to reappear on the next open. Doctor AI behaved
        // correctly only because of its hand-written branch above — which is why this is a RULE over
        // PROFESSIONAL_CHATS and not a 70th special case. The transcript is archived, not deleted: it
        // stays in Professional History, where it can be reopened. Since 2026-09-21 a professional can
        // hold several WINDOWS, and closing its tab ends every one of them — and only them: a
        // conversation that is "ongoing" in storage but has no window on screen (opened before a reload,
        // never closed) is not touched, because the user did not close it.
        const store = professionalStore();
        if (store) for (const w of windowsOf(openChats, v)) endConversation(store, v, w.id);
      }
    }
  }, [openTabs, activeView, tabOpeners, toggleTab, user, openChats, activeChatId, setMessages, setProMessages, setInput, setProInput, setGeneratedCode, setHasGeneratedCode, setIsAppBuilt, setFiles, setBuildVersionStack, setProBuildProgress, setCurrentSessionId, setCurrentProSessionId, setSdaResetKey, setSettingsScreen]);
  /**
   * Close ONE conversation window (admin 2026-09-21) — the header chip's ✕ and the Mode sheet's recent-row
   * ✕. Its transcript is archived (it reappears under History); its sibling windows with the same expert
   * stay open and the focus moves to the last of them. The LAST window of an expert closes the expert's
   * tab through `closeTab`, so there is one teardown for a professional tab, not two.
   */
  const closeChatWindow = useCallback((e: React.MouseEvent | undefined, id: string) => {
    e?.stopPropagation();
    const { windows, closed } = closeWindow(openChats, id);
    if (!closed) return;
    const store = professionalStore();
    if (store) endConversation(store, closed.professionalId, id);
    setOpenChats(windows);
    if (windowsOf(windows, closed.professionalId).length === 0) {
      if (activeChatId === id) setActiveChatId(null);
      closeTab(undefined, closed.professionalId as ViewType);
      return;
    }
    if (activeChatId === id) {
      const next = nextActiveAfterClose(windows, closed);
      if (next) setActiveChatId(next.id);
    }
  }, [openChats, activeChatId, closeTab]);

  /**
   * DELETE an ongoing conversation (History's delete on an "Ongoing" row): the transcript goes — never
   * archived — and so does its window if one is open. Windows stay mounted while hidden, so a delete
   * that left the window standing was undone by that window's own next save (review finding
   * 2026-09-21). Storage first, then the window, so the tab teardown finds nothing to archive.
   */
  const deleteProfessionalConversation = useCallback((professionalId: string, conversationId: string) => {
    const store = professionalStore();
    if (store) deleteOpenConversation(store, professionalId, conversationId);
    const { windows, closed } = closeWindow(openChats, conversationId);
    if (!closed) return;
    setOpenChats(windows);
    if (windowsOf(windows, closed.professionalId).length === 0) {
      if (activeChatId === conversationId) setActiveChatId(null);
      closeTab(undefined, closed.professionalId as ViewType);
      return;
    }
    if (activeChatId === conversationId) {
      const next = nextActiveAfterClose(windows, closed);
      if (next) setActiveChatId(next.id);
    }
  }, [openChats, activeChatId, closeTab]);

  /** One History row → one window (see toggleTab): open by id, or resume by archive stamp. */
  const openProfessionalConversation = useCallback(
    (professionalId: string, ref: ConversationRef): boolean =>
      toggleTab(professionalId as ViewType, true, ref.conversationId, ref.endedAt),
    [toggleTab],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const pendingViewAfterLoginRef = useRef<ViewType | null>(null);
  // Debounce timers for Firestore chat_sessions writes — prevents exhausting the free-tier
  // daily write quota when messages update on every AI turn.
  const fsNBIDebounceRef = useRef<ReturnType<typeof setTimeout>>();
  const fsProDebounceRef = useRef<ReturnType<typeof setTimeout>>();

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

      // Firestore chat_sessions sync moved to a debounced useEffect below to avoid
      // exhausting the free-tier daily write quota on every message update.

      // Log agent transitions if changed since previous state (rare write — kept inline)
      if (user && existingSession && existingSession.currentAgent !== updatedSession.currentAgent) {
        const transitionId = `transition_${currentSessionId}_${Date.now()}`;
        const transitionRef = doc(db, 'chat_agent_history', transitionId);
        setDoc(transitionRef, sanitizeFirestoreData({
          id: transitionId,
          uci: sessionUci || '',
          userId: user?.uid || 'anonymous',
          previous_agent: existingSession.currentAgent || null,
          current_agent: updatedSession.currentAgent || null,
          timestamp: new Date().toISOString()
        })).catch(() => {});
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

      // Firestore chat_sessions sync moved to a debounced useEffect below.

      return next;
    });
  }, [proMessages, currentProSessionId, files, user]);

  // Debounced Firestore sync for NBI Chat sessions.
  // Fires at most once per 2 s of quiet after messages change, so a 20-turn conversation
  // produces 1–2 writes instead of 20 — keeps the free-tier daily write quota healthy.
  useEffect(() => {
    if (!user) return;
    const session = sessions.find(s => s.id === currentSessionId);
    if (!session || !session.messages?.length) return;
    // v5.0 (AgentV3) sessions are single-writer: their transcript lives ONLY in the server
    // conversation store, and their chat_sessions row is metadata-only, written by AgentV3Panel.
    // Never let this generic writer touch a v3_ doc — a stale full-doc write here would re-add a
    // messages copy and reintroduce the transcript-corruption class of bugs.
    if (typeof session.id === 'string' && session.id.startsWith('v3_')) return;
    clearTimeout(fsNBIDebounceRef.current);
    fsNBIDebounceRef.current = setTimeout(() => {
      const sessionRef = doc(db, 'chat_sessions', session.id);
      setDoc(sessionRef, sanitizeFirestoreData({
        id: session.id || 'unknown',
        uci: session.uci || '',
        userId: user.uid,
        tab: activeView,
        original_agent: session.originalAgent || null,
        current_agent: session.currentAgent || null,
        title: session.title || 'Untitled',
        memory_summary: session.memorySummary || '',
        edit_log: session.editLog || [],
        restoredMessages: (session.restoredMessages || []).map(m => ({
          id: m.id || '',
          text: m.text || '',
          sender: m.sender || 'ai',
          timestamp: m.timestamp || new Date().toISOString()
        })),
        messages: (session.messages || []).map(m => ({
          id: m.id || '',
          text: m.text || '',
          sender: m.sender || 'ai',
          timestamp: m.timestamp || new Date().toISOString()
        })),
        files: Object.entries(session.files || {}).reduce((acc: Record<string, string>, [k, v]) => { acc[k] = v || ''; return acc; }, {}),
        lastUpdated: session.lastUpdated || new Date().toISOString(),
        isPinned: !!session.isPinned,
        mode: session.mode || 'chat'
      })).catch(err => {
        if ((err as any)?.code !== 'resource-exhausted') {
          console.error('Firestore chat_sessions sync error:', err);
        }
      });
    }, 2000);
  }, [sessions, currentSessionId, user, activeView]);

  // Debounced Firestore sync for Pro Builder sessions.
  useEffect(() => {
    if (!user) return;
    const session = sessions.find(s => s.id === currentProSessionId);
    if (!session || !session.messages?.length) return;
    // v5.0 (AgentV3) docs are single-writer (server transcript + panel-owned metadata row) —
    // same rule as the NBI writer above: this generic writer must never touch a v3_ doc.
    if (typeof session.id === 'string' && session.id.startsWith('v3_')) return;
    clearTimeout(fsProDebounceRef.current);
    fsProDebounceRef.current = setTimeout(() => {
      const sessionRef = doc(db, 'chat_sessions', session.id);
      setDoc(sessionRef, sanitizeFirestoreData({
        id: session.id || 'unknown',
        uci: session.uci || '',
        userId: user.uid,
        tab: 'nbi_pro_chat',
        original_agent: session.originalAgent || null,
        current_agent: session.currentAgent || null,
        title: session.title || 'Untitled',
        memory_summary: session.memorySummary || '',
        edit_log: session.editLog || [],
        restoredMessages: (session.restoredMessages || []).map(m => ({
          id: m.id || '',
          text: m.text || '',
          sender: m.sender || 'ai',
          timestamp: m.timestamp || new Date().toISOString()
        })),
        messages: (session.messages || []).map(m => ({
          id: m.id || '',
          text: m.text || '',
          sender: m.sender || 'ai',
          timestamp: m.timestamp || new Date().toISOString()
        })),
        files: Object.entries(session.files || {}).reduce((acc: Record<string, string>, [k, v]) => { acc[k] = v || ''; return acc; }, {}),
        lastUpdated: session.lastUpdated || new Date().toISOString(),
        isPinned: !!session.isPinned,
        mode: 'build'
      })).catch(err => {
        if ((err as any)?.code !== 'resource-exhausted') {
          console.error('Firestore chat_sessions (pro) sync error:', err);
        }
      });
    }, 2000);
  }, [sessions, currentProSessionId, user]);

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




  // P3.1 — GitHub connect/disconnect/fetch extracted into useGitHubConnect (behavior-preserving).
  // Placed with the other hook calls so the message-listener + callback effects below resolve the
  // returned handlers; all deps (activeView, currentSessionId, github setters, addLog) are above.
  const { connectGitHub, disconnectGitHub, fetchGitHubUser, fetchUserRepos } = useGitHubConnect({
    activeView, currentSessionId,
    setGithubRedirectingMessage, setGithubDebugData, setIsGHSyncing, setGithubUser, setRepositories,
    setGithubToken, addLog,
  });

  // P3.1 — free (NBI) chat engine extracted into useChatEngine (behavior-preserving). Placed here so
  // every dep (state, setters, updatePreview, handleGHConfirmPush, learnFromMessage, payment hook) is
  // defined above, and the retry/Enter consumers below still resolve handleSend/handleSendForTab.
  const { handleSendForTab, handleSend, stop: stopChat, unsend: unsendChat } = useChatEngine({
    input, messages, isLoading, sessions, currentSessionId, activeAgent, mode, activeView, activeIntent,
    errorContext, preferredLanguage, user, keys, invalidKeys, selectedModel, apnapanProfile,
    hasGeneratedCode, generatedCode, pendingGHEdit, githubToken, files, FREE_DAILY_MESSAGES, isFreeLimitReached,
    setMessages, setInput, setIsLoading, setActiveIntent, setErrorContext, setIsSearching, setPreferredLanguage,
    setMode, setShowAuth, setUser, setGithubToken, setGithubRepoContext,
    setFiles, setHasGeneratedCode, setIsDeployed, setIsAppBuilt,
    addLog, addToast, incrementDailyUsage, handleGHConfirmPush, learnFromMessage, updatePreview,
  });




  // PREVIEW_HARNESS → exported from src/lib/previewUtils.ts

  // PREVIEW_BOOTSTRAP → exported from src/lib/previewUtils.ts

  // Detect whether the app is a React/TS source app (needs transpilation) vs a static app.


  // buildSourceAppPreview → imported from src/lib/previewUtils.ts

  // UNIVERSAL_VIEWER_CSS → exported from src/lib/previewUtils.ts
  // UNIVERSAL_VIEWER_JS → exported from src/lib/previewUtils.ts
  // buildUniversalPreview → imported from src/lib/previewUtils.ts
  // injectHarness → imported from src/lib/previewUtils.ts




  // (the old single-file `deleteFile` helper was dead code — superseded by deleteWorkspaceFiles below)

  // Batch removal side-effect from the IDE file explorer (multi-select / delete-all). The React
  // `files` state is updated by the caller via onFilesChange; here we clear the deleted paths from
  // durable storage (IndexedDB/Cache) so they don't reappear after a reload.
  const handleFilesRemoved = useCallback(async (paths: string[]) => {
    if (!paths.length) return;
    // 1) Clear from durable IDE storage so they don't resurrect on reload.
    for (const p of paths) storageDeleteFile(p).catch(() => {});
    // 2) Propagate the delete to the v5.0 workspace so v5.0 also forgets the files (best-effort;
    //    needs a signed-in user, and the server gates on v5.0 being enabled → no-op otherwise).
    const uid = user?.uid;
    if (!uid) return;
    try {
      const workspaceId = getAgentV3WorkspaceId(uid);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      try {
        const tok = await auth.currentUser?.getIdToken();
        if (tok) headers.Authorization = `Bearer ${tok}`;
      } catch { /* token optional — server falls back to claimed userId */ }
      await fetch('/api/agentv3/delete-files', {
        method: 'POST',
        headers,
        body: JSON.stringify({ workspaceId, userId: uid, email: user?.email || '', paths }),
      });
    } catch { /* best-effort — never block the IDE delete */ }
  }, [user]);

  // THE one real file delete — every UI delete (Files panel, v5.0 Files tab, sidebar Files) flows
  // through here: React state + open-editor fix + IndexedDB + the v5.0 durable workspace. Before
  // this, the Files-panel delete only touched React state, so a "deleted" file silently resurrected
  // on the next reload (a fake delete — forbidden by the real-features rule).
  const deleteWorkspaceFiles = useCallback((paths: string[]) => {
    if (!paths.length) return;
    setFiles(prev => {
      const next = { ...(prev as Record<string, string>) };
      for (const p of paths) delete next[p];
      return next as typeof prev;
    });
    if (paths.includes(activeFile)) {
      const remaining = Object.keys(files as Record<string, string>).filter((k) => !paths.includes(k));
      setActiveFile(remaining[0] || '');
    }
    void handleFilesRemoved(paths); // IndexedDB + v5.0 workspace (durable, best-effort)
  }, [activeFile, files, handleFilesRemoved]);

  // Push the IDE workspace files into the NavBharatAI Pro (AgentV3) workspace so v5.0 KNOWS
  // which files exist (e.g. after a ZIP upload). Best-effort: needs a signed-in user; the server
  // also gates on v5.0 being enabled (returns 404 → no sandbox is spun) so this is a no-op for
  // non-v5.0 users. The workspace id is the SAME one the v5.0 chat panel uses (shared localStorage
  // session), so the IDE and v5.0 operate on one workspace.
  //
  // ROOT-CAUSE FIX (report 2026-07-27, "100MB/1GB zip upload complete ho jaata hai lekin files
  // v5.0 me nahi aati"): this used to send the ENTIRE file map as one JSON POST, which silently
  // failed once the extracted content crossed the server's ~30MB body limit — true for almost any
  // real app regardless of the original ZIP's size — and the failure was swallowed with no user
  // feedback. Now the file map is split into safely-sized chunks (chunkFilesForSync) sent
  // sequentially, so total project size no longer determines success; only genuine network/server
  // failures are reported, honestly, instead of a fake "complete".
  const syncFilesToV3 = useCallback(async (filesToSync: Record<string, string>, opts?: { silent?: boolean; source?: 'ide-edit' | 'import' }): Promise<void> => {
    const uid = user?.uid;
    if (!uid) return;
    const paths = Object.keys(filesToSync || {});
    if (paths.length === 0) return;
    const workspaceId = getAgentV3WorkspaceId(uid);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    try {
      const tok = await auth.currentUser?.getIdToken();
      if (tok) headers.Authorization = `Bearer ${tok}`;
    } catch { /* token optional — server falls back to claimed userId */ }
    const chunks = chunkFilesForSync(filesToSync);
    const totalBytes = totalFilesBytes(filesToSync);
    let imported = 0;
    let notEnabled = false;
    let failedChunks = 0;
    let githubUrl: string | null = null;
    let needsGithub = false;
    for (let i = 0; i < chunks.length; i++) {
      const isLast = i === chunks.length - 1;
      try {
        const res = await fetch('/api/agentv3/import-files', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            workspaceId, userId: uid, email: user?.email || '', files: chunks[i],
            ...(opts?.source ? { source: opts.source } : {}),
            ...(isLast ? { finalize: true, totalBytes, githubToken: githubToken || undefined } : {}),
          }),
        });
        if (res.status === 404) { notEnabled = true; break; } // v5.0 not enabled — silent no-op
        if (!res.ok) { failedChunks++; continue; }
        const j = await res.json().catch(() => ({} as any));
        imported += typeof j?.imported === 'number' ? j.imported : Object.keys(chunks[i]).length;
        if (j?.github?.url) githubUrl = j.github.url;
        if (j?.needsGithub) needsGithub = true;
      } catch { failedChunks++; }
    }
    if (notEnabled || opts?.silent) return;
    if (failedChunks === 0) {
      addToast(`Synced ${imported} file${imported === 1 ? '' : 's'} to NavBharatAI Pro ✓${githubUrl ? ' — also backed up to GitHub' : ''}`, 'success');
    } else {
      addToast(`⚠️ Synced ${imported} file(s), but ${failedChunks} batch${failedChunks === 1 ? '' : 'es'} failed — check your connection and try importing again`, 'warning');
    }
    if (needsGithub) {
      addToast('This project is large — connect GitHub (⚙ → GitHub) so every file stays safely backed up', 'info');
    }
  }, [user, addToast, githubToken]);

  // Phase S1 — IDE↔v5.0 edit sync: a debounced, echo-suppressed syncer that durably pushes a user's
  // Code Studio edits into the v5.0 workspace (silent, best-effort). Re-created when syncFilesToV3
  // changes (i.e. on sign-in). The IDE edit seam calls onLocalChange; the v5.0→IDE path calls noteRemote.
  const workspaceSyncerRef = useRef<WorkspaceSyncer | null>(null);
  useEffect(() => {
    workspaceSyncerRef.current = makeWorkspaceSyncer({ sync: (changed) => syncFilesToV3(changed, { silent: true, source: 'ide-edit' }) });
    return () => workspaceSyncerRef.current?.dispose();
  }, [syncFilesToV3]);

  /**
   * THE one edit seam for hand-edited files. Every surface where a human edits a file — Code Studio and
   * the Git panel — must go through this, or its edits live only in React state and are lost on reload.
   *
   * ROOT CAUSE it fixes (admin 2026-08-04, "save button ko live karo"): the syncer above was wired into
   * the Git panel only. Code Studio's own `onFilesChange` called the raw `setFiles`, so **typing in the
   * IDE never reached the durable v5.0 workspace at all** — the comment above claimed "the IDE edit seam
   * calls onLocalChange" while the IDE was the one seam that didn't. Saving looked fine, the preview
   * updated, and the edit quietly did not survive a refresh. One shared handler makes that drift
   * impossible instead of relying on each new surface remembering.
   */
  const applyIdeFileChange = useCallback((newFiles: FileSystem) => {
    workspaceSyncerRef.current?.onLocalChange(files, newFiles);
    setFiles(newFiles);
    updatePreview(newFiles);
  }, [files, updatePreview]);

  /**
   * Push any pending edits to the durable store NOW and resolve once they are actually stored.
   * Save says "Saved" only after this resolves — announcing success while a 1.2s debounce is still
   * pending would be a fake success message, and the user would trust it and close the tab.
   */
  /**
   * A project the user just UPLOADED has landed server-side — make it the app's file set.
   *
   * REPLACE, not merge. The warning the user agreed to says the old files are deleted, and a merge
   * would leave orphans from the previous project sitting in their new one, which is both untrue to
   * the consent given and a genuinely confusing result.
   *
   * Marked as REMOTE first: the archive is already durable on the server, so letting the edit syncer
   * treat it as local typing would upload the whole project straight back — megabytes of pointless
   * traffic on the phone connection that just finished sending it.
   *
   * Then the preview is rebuilt from the new files, so Code Studio, the Files view, the preview and
   * v5.0 all show the uploaded project at the same moment rather than drifting apart.
   */
  const replaceProjectFiles = useCallback((incoming: Record<string, string>) => {
    const clean = sanitizeFileMap(incoming);
    if (Object.keys(clean).length === 0) return;
    workspaceSyncerRef.current?.noteRemote(clean);
    setFiles(clean);
    updatePreview(clean);
    // No need to touch the hydration guard: it only runs while the file set is EMPTY, and it is not
    // empty any more — the uploaded project is now what is open.
    addLog(`Project replaced — ${Object.keys(clean).length} files uploaded.`, 'success');
  }, [updatePreview, addLog]);

  const flushIdeEdits = useCallback(
    () => workspaceSyncerRef.current?.flush() ?? Promise.resolve(),
    [],
  );


  const handleKeySave = (provider: string, value: string) => {
    setKeys(prev => ({ ...prev, [provider]: value }));
    if (value.trim()) {
      setSelectedModel(provider);
      setPendingProvider(null);
      addLog(`${provider.toUpperCase()} activated with new credentials.`, 'success');
      addToast(`${provider.toUpperCase()} model activated ✓`, 'success');
    }
  };




  // Intent classifier — prevents build engine from firing on greetings/questions

  // ── ZIP Import: stream raw binary → SSE extraction → real-time Code Studio load ──
  // P3.1 — handleZipImport extracted into useZipImport (behavior-preserving). Deps (pro-chat setters,
  // setFiles, syncFilesToV3, updatePreview, toggleTab, addToast) are all defined above; the file-drop /
  // conflict-resolve callers below resolve the returned handleZipImport unchanged.
  const { handleZipImport } = useZipImport({
    setFiles, setHasGeneratedCode, setIsAppBuilt, setIsProLoading, setProBuildProgress, setProInput,
    setProMessages, syncFilesToV3, updatePreview, toggleTab, addToast,
  });



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
    if (isZipFile(selectedFile.name, selectedFile.type)) {
      const sizeMB = selectedFile.size / (1024 * 1024);
      const bucket = classifyZipSize(selectedFile.size);
      if (bucket === 'too-large') {
        setZipSizeModal({ variant: 'too-large', fileName: selectedFile.name, fileSizeMB: sizeMB });
        return;
      }
      // Up to 5 GB: proceed with the normal conflict check + import (chunked transport handles size)
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
    const isText = isTextFile(selectedFile.name);

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



  // Task 2.7 — memoized: static array, rebuilt only once
  const menuItems = useMemo(() => [
    { id: 'home',         label: 'Home',              icon: Bot },
    { id: 'nbi_chat',     label: 'NavBharatAI FREE',  icon: MessageSquare },
    { id: 'nbi_pro_chat', label: 'NavBharatAI Pro', icon: Bot },
    { id: 'professionals', label: 'Professionals',    icon: Briefcase, status: 'New' },
    // Other AI opens its OWN header tab like Free/Pro/Professionals (admin 2026-07-23): without a menuItems
    // entry, TopNav's `if (!item) return null` silently dropped the tab, so opening Other AI showed no
    // header window. Same LayoutGrid icon as its Home card, for consistency.
    { id: 'other_ai',     label: 'Other',              icon: LayoutGrid },
    // 🔴 APP MART HAD NO ENTRY HERE, SO IT OPENED AS A WINDOW WITH NO WINDOW (admin 2026-09-21:
    // "app mart ko bhi multi window system me add karo, slidebar menu me aur header me multi
    // tab/window (x=close) me bhi add karo"). `toggleTab('appstore')` pushed it into `openTabs`
    // correctly, and TopNav then did `menuItems.find(m => m.id === tabId); if (!item) return null` —
    // so the tab existed in state, rendered no chip, and had no ✕ to close it with. Getting out meant
    // navigating somewhere else and leaving it open behind you.
    //
    // ⚠️ THIS IS THE `other_ai` BUG ABOVE, VERBATIM, TWO YEARS OF ENTRIES LATER — same file, same
    // line of TopNav, same silent outcome. Its comment records the identical symptom for Other AI on
    // 2026-07-23, and SidebarNav's `SIDEBAR_HIDDEN` block warns about the same `return null` a third
    // time. The class is: THIS LIST IS THE REGISTRY FOR A WINDOW, and an id that opens a tab without
    // being in it is a window nobody can see or shut.
    //
    // ONE ENTRY SERVES BOTH SURFACES THE ADMIN ASKED FOR, by construction rather than by two edits:
    // TopNav renders the header chip with its ✕, and SidebarNav's `visibleItems` renders the menu row
    // (App Mart is in neither `SIDEBAR_HIDDEN` nor `DRAWER_HIDDEN`, and had no door in the rail, the
    // drawer list or the System Matrix — so this adds exactly one door per half, never a duplicate).
    // `Store` is the same icon its own Home tile carries, for the reason the `other_ai` entry gives.
    { id: 'appstore',     label: 'App Mart',          icon: Store },
    { id: 'preview',      label: 'Preview',           icon: Monitor },
    { id: 'files',        label: 'Files',             icon: FolderOpen },
    { id: 'history',      label: 'History',           icon: History },
    { id: 'studio',       label: 'Code Studio',       icon: Smartphone },
    { id: 'git',          label: 'Git',               icon: GitBranch },
    { id: 'billing',      label: 'Wallet & Billing',  icon: Wallet },
    { id: 'donation',     label: 'Donate',            icon: Heart },
    { id: 'settings',     label: 'Settings',          icon: Settings },
    // 🔎 THE FOUR SIBLINGS OF THE APP MART BUG (admin 2026-09-21, "haan" — ship all four).
    //
    // Each of these opens a tab through `toggleTab` and, until now, had no `menuItems` entry — so
    // each was a window that rendered no chip and no ✕, exactly as App Mart was. They were found by
    // COMPUTING the set (every `toggleTab('x')` in the client tree, minus this registry, minus the
    // professional child surfaces) rather than by reading: a first pass by eye said five and was
    // wrong, because `repo_analyst` turned out to be a professional id.
    //
    // 🔒 ALL FOUR ARE ALSO IN `SIDEBAR_HIDDEN`, AND THAT PAIRING IS THE WHOLE POINT. Registering an
    // id here does two things at once — it gives TopNav a chip AND gives SidebarNav a menu row — and
    // only the first was wanted. The admin has trimmed that sidebar repeatedly and on purpose
    // ("inko need nahi hai", "sidebar menu me se bhi isko hata do"), so four new rows would have been
    // a fix trading one problem for another. This is the pattern `git` / `preview` / `files` /
    // `history` / `professionals` already use, and `SidebarNav`'s own comment explains why it hides
    // rather than deletes: the entry is what makes the window exist.
    //
    // ⚠️ App Mart itself is deliberately NOT in that set — a sidebar row is half of what was asked
    // for there. These four were never asked for in the sidebar, only closable.
    //
    // Labels and icons match each surface's OWN door, so a chip is recognisable as the thing it
    // opens: About Us carries the `Info` of its drawer row, Diff the `FileDiff` of AgentV3Panel's own
    // Diff tab pill, AI Image Gen the `Wand2` of its tool-grid tile.
    // ⚠️ APK Builder is the ONE deviation: its tool-grid tile uses `Smartphone`, which Code Studio
    // already owns four lines above in this very list. Two identical chips in one strip defeats the
    // recognisability the consistency rule exists to serve, so it takes `Package` — an app bundle.
    { id: 'about',        label: 'About Us',          icon: Info },
    { id: 'apk',          label: 'APK Builder',       icon: Package },
    { id: 'diff',         label: 'Diff',              icon: FileDiff },
    { id: 'imagegen',     label: 'AI Image Gen',      icon: Wand2 },
  ], []);

  // --- UNIVERSAL CHAT CONTINUATION SYSTEM (UCI) HELPERS & IMPLEMENTATION ---
  
  // Agent greetings (NBI/Basic/Pro/VIP) → imported from src/lib/agentGreetings.ts

  // generateUCI → imported from src/lib/chatUtils.ts
  // getRandomElement → imported from src/lib/chatUtils.ts
  // generateSmartHeuristicSummary → imported from src/lib/chatUtils.ts

  // A v5.0 session restored from History → handed to AgentV3Panel via this prop;
  // the nonce makes each "open chat" re-adopt even if the panel is already mounted.
  const [v3Resume, setV3Resume] = useState<{ sessionId: string; messages: Array<{ role: 'user' | 'agent'; text: string; ts: number }>; nonce: number } | null>(null);
  // The v5.0 build's live preview URL + workspace, lifted from AgentV3Panel so the MAIN slide-out
  // "Preview" menu renders the SAME working v5.0 preview (was wired to the retired v2.0 generatedCode).
  // `framework` + `running` are ALSO lifted (2026-07-01) so the sidebar's PreviewSurface can reach full
  // feature parity with the in-panel one — auto-resuming a dead sandbox and the framework-aware
  // Diagnose flow both need them (previously only the in-panel PreviewSurface received these props).
  const [v3Preview, setV3Preview] = useState<{ previewUrl?: string; workspaceId?: string; framework?: string; running?: boolean }>({});

  /**
   * HYDRATE the app's file set from the v5.0 workspace whenever one becomes known and we are holding
   * nothing.
   *
   * ROOT CAUSE (admin 2026-08-05: "old app ka code Code Studio me kholа — kuch bhi nahi dikha").
   * AgentV3Panel pushes its files up ONLY from a `state.done` effect — i.e. only after a build
   * FINISHES IN THIS SESSION. Opening an app built earlier never satisfies that, so `files` stayed
   * empty: Code Studio showed nothing, and `generatedCode` stayed the "Waiting for magic…"
   * placeholder — while the v5 panel, reading the server directly, correctly reported
   * "PREVIEW LIVE · 13 FILES". Two views of one app, disagreeing.
   *
   * Reads the SAME endpoint the import path already uses, so there is one source of truth. Guarded to
   * run once per workspace and ONLY while `files` is empty — it must never overwrite the user's live
   * edits or race the build's own sync.
   */
  const hydratedWorkspaceRef = useRef<string | null>(null);
  useEffect(() => {
    const workspaceId = v3Preview.workspaceId;
    if (!workspaceId || !user?.uid) return;
    if (hydratedWorkspaceRef.current === workspaceId) return;
    if (Object.keys(files).length > 0) return;   // never clobber what is already open
    hydratedWorkspaceRef.current = workspaceId;
    let cancelled = false;
    (async () => {
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        const tok = await auth.currentUser?.getIdToken().catch(() => null);
        if (tok) headers.Authorization = `Bearer ${tok}`;
        const res = await fetch('/api/agentv3/workspace-files', {
          method: 'POST',
          headers,
          body: JSON.stringify({ workspaceId, userId: user.uid, email: user.email || '' }),
        });
        const data = await res.json().catch(() => null);
        if (cancelled || !res.ok || !data?.files || typeof data.files !== 'object') return;
        const clean = sanitizeFileMap(data.files);
        if (Object.keys(clean).length === 0) return;
        // Mark them as REMOTE so the edit syncer does not echo them straight back to the server as if
        // the user had just typed them.
        workspaceSyncerRef.current?.noteRemote(clean);
        setFiles(clean);
        addLog(`Loaded ${Object.keys(clean).length} files from your workspace.`, 'success');
      } catch {
        // Honest degradation: the Files/Code Studio views keep their existing empty state rather than
        // showing a half-loaded project. A retry happens naturally on the next workspace change.
        hydratedWorkspaceRef.current = null;
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v3Preview.workspaceId, user?.uid]);
  // Dynamic per-view footer (admin 2026-07-07): while v5.0 is the active view on mobile/tablet, the
  // bottom nav swaps to v5.0's own items. AgentV3Panel registers its REAL actions here (null when
  // v5.0 is closed/unmounted — the nav then falls back to the default items, never dead buttons).
  const [v3FooterApi, setV3FooterApi] = useState<V3FooterApi | null>(null);
  /**
   * The admin console's own tab strip, published upward so the ONE bottom bar can BE it
   * (admin 2026-09-20). Null whenever the console is not mounted, which is what makes the bar fall
   * straight back to its ordinary items on logout — see components/admin/adminFooterApi.ts.
   */
  const [adminFooterApi, setAdminFooterApi] = useState<AdminFooterApi | null>(null);
  /** The footer strip's scroll container, so the open tab can be scrolled back into view. */
  const adminStripRef = useRef<HTMLElement | null>(null);
  // "Fix with AI" clicked from the SIDEBAR preview (outside the v5.0 panel's own UI) — prefills the
  // v5.0 chat input with the error and switches to it. Nonce so the SAME text re-triggers the effect
  // even if the previous fix request is still sitting in the input unsent.
  const [v3PendingFix, setV3PendingFix] = useState<{ text: string; nonce: number; autoSend?: boolean } | null>(null);
  // A deploy requested from the Git panel for a specific real provider → v5.0 runs its real
  // build+deploy pipeline for it (see AgentV3Panel pendingDeploy).
  const [v3DeployRequest, setV3DeployRequest] = useState<{ provider: string; nonce: number } | null>(null);
  // Code Studio's Preview button asks NavBharatAI Pro to open ON its Preview surface (admin 2026-09-15).
  // A nonce, not a boolean, for the same reason freshOpenNonce is one: a second press must re-open the
  // preview even after the user has switched to Pro Chat inside the panel. 0 = nobody asked.
  const [v3OpenPreviewNonce, setV3OpenPreviewNonce] = useState(0);
  // Snapshot of the workspace files taken right BEFORE each v5.0 build (admin autopsy 2026-07-21) —
  // the Diff Viewer's "previous version" so it shows exactly what the last build changed.
  const [previousFiles, setPreviousFiles] = useState<Record<string, string>>({});

  const resumeSession = (session: ChatSession) => {
    // v5.0 (engine_builder) sessions resume INSIDE v5.0 — adopt the saved sessionId
    // (so the backend continues with the same workspace/memory, best-effort) and
    // restore the saved thread. Detected by the agentv3 agent tag or the v3_ id.
    const isV3 = session.agent === 'agentv3'
      || (session as any).originalAgent === 'agentv3'
      || (session as any).currentAgent === 'agentv3'
      || (typeof session.id === 'string' && session.id.startsWith('v3_'));
    if (isV3) {
      setCurrentSessionId(session.id);
      const sid = (session.id || '').replace(/^v3_/, '') || session.id;
      const msgs = (session.messages || []).map((mm: any) => ({
        role: (mm.sender === 'user' || mm.role === 'user') ? 'user' as const : 'agent' as const,
        text: mm.text ?? mm.content ?? '',
        ts: mm.timestamp ? (Date.parse(mm.timestamp) || Date.now()) : (mm.ts ?? Date.now()),
      }));
      setV3Resume({ sessionId: sid, messages: msgs, nonce: Date.now() });
      v3ResumeInFlightRef.current = true; // resume, not a fresh open — suppress the new-chat bump
      toggleTab('nbi_pro_chat'); // v5.0 now lives in nbi_pro_chat
      addLog(`Resumed NavBharatAI Pro session: ${session.title}`, 'info');
      return;
    }

    setCurrentSessionId(session.id);
    const m = session.messages || [];
    // A session saved before Vishwakarma was deleted (2026-09-12). Its surface is gone, so it opens in
    // the Pro chat — the same mapping resolveSessionSurface makes — rather than being unopenable.
    const isLegacyBuilderSession = !!(session.agent && session.agent.startsWith('vishwakarma'));
    
    setFiles(session.files || {});
    if (session.mode) setMode(session.mode);
    if (session.agent) setActiveAgent(isLegacyBuilderSession ? 'navbharatai-pro' : session.agent);
    
    setMessages(m);
    toggleTab(isLegacyBuilderSession ? 'nbi_pro_chat' : 'nbi_chat');
    
    addLog(`Resored session (UCI: ${session.uci || 'N/A'}): ${session.title}`, 'info');
  };


  // P3.1 — session restore/management (UCI restore, delete, new chat) extracted into useSessionManager
  // (behavior-preserving). All deps are defined above; the panels/modal consumers below resolve the
  // returned handlers unchanged. v3ResumeInFlightRef stays App-owned (shared with the toggleTab bump).
  const { handleRestoreUci, handleRestoreByUci, deleteSession, startNewChat } = useSessionManager({
    sessions, user, currentSessionId, resumeUciInputState, mode,
    v3ResumeInFlightRef,
    setV3Resume, setCurrentSessionId, setFiles, setSessions, setSdaResetKey, setCurrentProSessionId,
    setSdaOpenCaseId,
    setProMessages, setMessages, setGeneratedCode, setHasGeneratedCode, setActiveAgent, setErrorContext,
    setIsAppBuilt, setRestoreUciError, setIsRestoringUci, setResumeUciInputState, setShowContinueModal,
    toggleTab, addToast, addLog, initialFreeChatMessages: initialNbiMessages,
  });

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
        // Only trust an auth token that came from our own origin (the OAuth callback popup is
        // served same-origin). A cross-origin sender here means a hostile page trying to inject
        // its own GitHub token into this session — reject it.
        if (e.origin !== window.location.origin) return;
        const token = e.data.token;
        setGithubToken(token);
        localStorage.setItem('gh_token', token);
        rememberGithubOwner(auth.currentUser?.uid);
        addLog('GitHub connected successfully.', 'success');
        fetchGitHubUser(token);
      } else if (e.data.type === 'GITHUB_AUTH_ERROR') {
        addLog(`GitHub connection failed: ${e.data.error}`, 'error');
      } else if (e.data.type === 'FIREBASE_AUTH_SUCCESS') {
        // Same-origin guard: reject a cross-origin page injecting a forged Firebase token.
        if (e.origin !== window.location.origin) return;
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
        rememberGithubOwner(auth.currentUser?.uid);
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

    // NATIVE (Capacitor) Supabase-connect return (2026-09-14 fix):
    // com.navbharat.ai://supabase-callback?nonce=… (or ?error=…). Stash into the SAME sessionStorage
    // keys the web redirect already uses, land on Settings → Database, and fire the event
    // SupabaseConnectCard listens for — it stays mounted the whole time on native (no page navigation),
    // so it cannot pick this up on its own. Kept as its own function (not inlined into the appUrlOpen
    // callback below) so the GitHub listener's own shape and tested content stay unchanged.
    /**
     * AN APP LINK ARRIVED — take the user where the link said, not to Home (admin 2026-09-19).
     *
     * This is the half that makes the manifest's `autoVerify` worth having. Android hands us the FULL
     * https URL; the native shell's own document lives at localhost, so `window.location` knows nothing
     * about it. Two things therefore have to happen, in this order:
     *
     *   1. WRITE THE PATH ONTO THE LOCAL ORIGIN FIRST. `/store/app/<id>` is a share link to ONE app, and
     *      NavAppStore reads that id from `window.location.pathname` itself. Setting the view without
     *      writing the path would open the store's Browse tab — the app opens, and the link the person
     *      actually tapped is gone. That is the failure this whole feature exists to avoid.
     *   2. Then switch the view.
     *
     * `deepLinkTarget` rejects anything that is not https on one of OUR hosts, so the custom-scheme
     * returns handled below (com.navbharat.ai://…) can never reach this — the two are disjoint by
     * protocol, not by ordering.
     */
    const handleAppLinkOpen = (url: string | undefined): boolean => {
      const target = deepLinkTarget(url);
      if (!target) return false;
      try {
        window.history.replaceState(null, '', `${target.path || '/'}${target.search}`);
      } catch { /* history unavailable — the view switch below is still worth doing */ }
      setActiveView(target.view);
      return true;
    };

    const handleSupabaseUrlOpen = (url: string | undefined): boolean => {
      const sbNonce = nonceFromSupabaseDeepLink(url);
      const sbErr = errorFromSupabaseDeepLink(url);
      if (!sbNonce && !sbErr) return false;
      try {
        if (sbNonce) sessionStorage.setItem('nbai.sbConnectNonce', sbNonce);
        if (sbErr) sessionStorage.setItem('nbai.sbConnectError', sbErr);
      } catch { /* private mode — the card's status refresh still shows the true state */ }
      toggleTab('settings');
      setSettingsScreen('database');
      window.dispatchEvent(new CustomEvent(SUPABASE_NATIVE_RETURN_EVENT));
      void import('@capacitor/browser').then(({ Browser }) => Browser.close().catch(() => {})).catch(() => {});
      return true;
    };

    // NATIVE (Capacitor) GitHub OAuth return. The in-app browser redirects to
    // com.navbharat.ai://github-callback#gh_token=…, which fires the App plugin's `appUrlOpen`. Extract
    // the token, connect, and close the in-app browser so the user lands back in the app. NO-OP on web
    // (isNativePlatform() is false), so every browser/desktop flow above is untouched.
    let removeGithubUrlOpen: (() => void) | undefined;
    void (async () => {
      try {
        const { Capacitor } = await import('@capacitor/core');
        if (Capacitor.isNativePlatform?.() !== true) return;
        const { App: CapApp } = await import('@capacitor/app');
        const handle = await CapApp.addListener('appUrlOpen', (data: { url?: string }) => {
          if (handleSupabaseUrlOpen(data?.url)) return; // see handleSupabaseUrlOpen above
          if (handleAppLinkOpen(data?.url)) return; // an https navbharatai.com link — see above
          // A TICKET, when the server had a verified identity to bind one to; the raw token otherwise.
          // Both are handled because the server chooses, not the client — see githubOauthReturn.ts.
          // The ticket path exists because a custom URI scheme is claimable by any installed app, and
          // this token carries `repo workflow` on all of the user's private repositories.
          const ticket = ticketFromDeepLink(data?.url);
          const directToken = tokenFromDeepLink(data?.url);
          if (!ticket && !directToken) return; // not our GitHub deep link — ignore

          void (async () => {
            let token = directToken;
            if (ticket) {
              token = await redeemGithubTicket(ticket);
              if (!token) {
                // The ticket is single-purpose and short-lived; a failure here is a dead end, not
                // something to retry silently. Say so and clear the overlay rather than spinning.
                addLog('GitHub sign-in could not be completed. Please try connecting again.', 'error');
                setGithubRedirectingMessage(null);
                void import('@capacitor/browser').then(({ Browser }) => Browser.close().catch(() => {})).catch(() => {});
                return;
              }
            }
            if (!token) return;
          setGithubToken(token);
          localStorage.setItem('gh_token', token);
          rememberGithubOwner(auth.currentUser?.uid);
          addLog('GitHub connected successfully.', 'success');
          fetchGitHubUser(token);
          // THE REPORTED BUG (admin 2026-08-17). Everything above already worked — the sign-in genuinely
          // succeeded and the token was stored — but the "Opening GitHub… Please wait." overlay was
          // cleared NOWHERE except its own Dismiss button. On the web the full-page redirect destroys
          // that state, so it never showed; on native the app never navigates, so it sat there forever
          // over a login that had already finished. The success path now has something to say.
          setGithubRedirectingMessage(null);
          void import('@capacitor/browser').then(({ Browser }) => Browser.close().catch(() => {})).catch(() => {});
          })();
        });
        removeGithubUrlOpen = () => { try { handle.remove(); } catch { /* already removed */ } };

        // THE SAME STUCK STATE FROM THE OTHER DIRECTION: the user backs out of the in-app browser, so no
        // deep link ever fires and the overlay freezes identically. Once the app is in the foreground
        // again, "Opening GitHub… Please wait." is simply not true any more, whichever way it ended.
        const resumeHandle = await CapApp.addListener('appStateChange', ({ isActive }: { isActive: boolean }) => {
          if (!isActive) return;
          // A successful return fires BOTH this and the deep link, on some platforms in an unhelpful
          // order — so give the deep link its chance before concluding anything, and then decide from
          // the state rather than from the event. `resumeOutcome` refuses to call a success a
          // cancellation; telling somebody their working sign-in failed is worse than saying nothing.
          window.setTimeout(() => {
            const outcome = resumeOutcome({
              stillWaiting: githubRedirectingRef.current !== null,
              hasToken: !!localStorage.getItem('gh_token'),
            });
            if (outcome === 'cancelled') setGithubRedirectingMessage(GITHUB_CANCELLED_MESSAGE);
          }, RESUME_GRACE_MS);
        });
        const removeUrlOpen = removeGithubUrlOpen;
        removeGithubUrlOpen = () => {
          removeUrlOpen?.();
          try { resumeHandle.remove(); } catch { /* already removed */ }
        };
      } catch { /* not native / plugin absent — the web flows above handle the token */ }
    })();

    // Check for fragment token (supporting full redirect flow)
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const fragmentToken = hashParams.get('gh_token');
    if (fragmentToken) {
      setGithubToken(fragmentToken);
      localStorage.setItem('gh_token', fragmentToken);
      rememberGithubOwner(auth.currentUser?.uid);
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

    // Supabase one-tap connect, returning from the SAME-TAB consent redirect. The callback bounces
    // here with either the completion nonce or an honest error; stash it for SupabaseConnectCard
    // (which does the authenticated /complete call), clean the URL, and land the user straight back
    // on Settings → Database — the exact screen they left — instead of the home view.
    const searchParams = new URLSearchParams(window.location.search);
    const sbNonce = searchParams.get('sbconnect');
    const sbError = searchParams.get('sberror');
    if (sbNonce || sbError) {
      try {
        if (sbNonce) sessionStorage.setItem('nbai.sbConnectNonce', sbNonce);
        if (sbError) sessionStorage.setItem('nbai.sbConnectError', sbError);
      } catch { /* private mode — the card's status refresh still shows the true state */ }
      searchParams.delete('sbconnect');
      searchParams.delete('sberror');
      const qs = searchParams.toString();
      window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
      toggleTab('settings');
      setSettingsScreen('database');
    }

    return () => {
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('storage', handleStorageChange);
      removeGithubUrlOpen?.();
    };
  }, []);


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


  const [availableBranches, setAvailableBranches] = useState<string[]>([]);
  const [currentBranch, setCurrentBranch] = useState<string>('main');
  const [patInputValue, setPatInputValue] = useState('');

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

  /**
   * Is the global mobile bottom-nav actually on screen?
   *
   * SINGLE SOURCE OF TRUTH, deliberately. This condition and the strip of padding that reserves space
   * for it must never disagree — and they have drifted twice already. Focus mode was the first (56px
   * held for a nav that wasn't rendered), and Code Studio was the second: the nav was hidden inside the
   * IDE so it wouldn't stack two footers, but its reservation stayed, pushing Code Studio's own footer
   * 56px off the screen edge with a dead strip beneath it (admin screenshot, 2026-08-04).
   * Both the padding and the <nav> read THIS, so a future "hide the nav here too" cannot repeat it.
   *
   * Code Studio is excluded because it draws its OWN footer; botbuilder because it is full-bleed.
   */
  const showsGlobalMobileNav =
    effectiveDeviceMode === 'mobile' && !focusMode && activeView !== 'botbuilder' && activeView !== 'studio';

  /**
   * THE ONE ANSWER TO "can this surface open the mode picker?" (admin 2026-09-21).
   *
   * Every chat surface gets the same value, so a phone never shows two Mode controls (the bottom bar
   * already carries one) and no surface re-derives the device question for itself. `undefined` is
   * what hides the button — `ModeButton` renders nothing rather than rendering something inert.
   *
   * ⚠️ It is defined ONCE and passed down deliberately: the free chat, Doctor AI, the image studio and
   * all 70-odd expert chats read it, and a condition spelled out at each call site is a condition that
   * disagrees with itself the first time this rule changes.
   */
  const modePickerOpener = showsGlobalMobileNav ? undefined : () => setShowModePicker(true);

  /**
   * …and publish that same answer to CSS, for the THIRD consumer of it.
   *
   * The bar is `fixed bottom-0` at z-150, so it paints over every dialog below that z-index. Two
   * consumers already read the boolean above — the <nav> itself, and the page padding that keeps the
   * composer clear of it. Modal sheets are the third: `nb-sheet-overlay` (index.css) has to know how
   * much of the visible viewport our own chrome is occupying, and a stylesheet cannot work that out,
   * because it depends on device mode / focus mode / the active view rather than on a media query.
   *
   * Written to <html> rather than the root <div> below, because the dialogs that portal to
   * document.body — the publish celebration, the report sheet — sit outside that div and would not
   * inherit the variable from it.
   */
  useEffect(() => { publishMobileNavHeight(showsGlobalMobileNav); }, [showsGlobalMobileNav]);

  /**
   * ── THE BOTTOM BAR IS THE ADMIN CONSOLE'S TAB STRIP (admin 2026-09-20) ────────────────────────
   *
   * *"jab admin panel open hota hai, to footer me yeh home|ai|preview|studio|more … isko badalna
   * hai!! … MONITOR, USERS, ai engine, revenue … jo abhi header me hai, unko rakho."*
   *
   * True only when all three hold — the bar is on screen, the admin console is the active view, and
   * the console has actually published its tabs. That last clause is what makes this safe rather
   * than clever: during the login gate, and for the instant before the dashboard mounts, there is no
   * api and the bar shows its ordinary items instead of an empty strip.
   */
  const adminStrip = showsGlobalMobileNav && activeView === 'admin' && !!adminFooterApi;

  /**
   * KEEP THE OPEN TAB IN VIEW. Nine chips do not fit a phone's width, so after tapping Revenue and
   * coming back the active chip can be off-screen — the user would see a strip with nothing lit and
   * no clue where they are. Fires on the ACTIVE ID only, never on every render, so it can never
   * fight a swipe the user is in the middle of.
   */
  useEffect(() => {
    if (!adminStrip) return;
    const el = adminStripRef.current?.querySelector('[data-admin-tab-active="true"]');
    try { (el as HTMLElement | null)?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }); }
    catch { /* an older engine without scrollIntoViewOptions — the strip still scrolls by hand */ }
  }, [adminStrip, adminFooterApi?.activeId]);

  return (
    <div
      className="h-screen supports-[height:100dvh]:h-[100dvh] w-screen flex flex-col overflow-hidden transition-colors duration-500 bg-surface text-body"
      style={{
        // Native safe-area (admin 2026-07-13): pad the whole app in from the device's top notch /
        // dynamic island and the left/right rounded-corner insets so the header is never cropped.
        // The root's own bg-surface fills the reserved strip, so it reads as a normal status-bar
        // area. Bottom is handled by the fixed mobile nav (its own env padding), so no bottom pad here.
        // On the web these vars are 0 → no visual change. box-sizing:border-box (Tailwind preflight)
        // means the padding shrinks the content box, so the header + content calc below stay exact.
        paddingTop: 'var(--nb-safe-top)',
        paddingLeft: 'var(--nb-safe-left)',
        paddingRight: 'var(--nb-safe-right)',
        // NOTE: --theme-* now come from <html data-theme> (index.css) — the single source of truth — so
        // they follow the theme AND respect [data-fixed-dark] subtrees. No inline override here.
      }}
    >
      {/* "A new version is on Play" — native Android only, and silent everywhere else. All of the
          decide/never-nag/never-guess logic lives in src/lib/appUpdate.ts; this renders its verdict. */}
      <UpdateBanner />
      {/* L3: skip to main content for keyboard/screen-reader users */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-[9999] focus:px-4 focus:py-2 focus:bg-indigo-600 focus:text-white focus:rounded-xl focus:text-sm focus:font-bold"
      >
        Skip to main content
      </a>
      {/* Focus Mode hides the header entirely — the floating corner button (below) or Esc bring it back. */}
      {!focusMode && (
        <TopNav
          onOpenReports={() => { setReportMode('list'); setReportOpen(true); }}
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
          chatWindows={openChats.map((w) => ({
            id: w.id,
            label: windowLabel(openChats, w.id, PROFESSIONAL_CHATS[w.professionalId]?.name ?? w.professionalId),
            emoji: modeEmojiFor(w.professionalId),
            active: activeChat?.id === w.id,
          }))}
          onSelectChatWindow={(id) => {
            const win = openChats.find((w) => w.id === id);
            if (!win) return;
            setActiveChatId(id);
            setActiveView(win.professionalId as ViewType);
          }}
          onCloseChatWindow={closeChatWindow}
          hasGeneratedCode={hasGeneratedCode}
          canUndo={canUndo}
          canRedo={canRedo}
          undoCode={undoCode}
          redoCode={redoCode}
          user={user}
          setShowAuth={setShowAuth}
          auth={auth}
          onEnterFocusMode={handleEnterFocusMode}
          onOpenProfile={() => setActiveView('my_profile')}
          onOpenSettings={() => setActiveView('settings')}
          isAdmin={isAdmin}
        />
      )}

      {/* Main Content Area */}
      <div className={`flex flex-1 w-full min-h-0`}>

      <SidebarNav
        onReportProblem={() => { setReportMode('choose'); setReportOpen(true); }}
        unreadReports={unreadReports}
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
        setErrorContext={setErrorContext}
        sessions={sessions}
        onResumeSession={resumeSession}
      />
      {/* Workspace */}
      <main id="main-content" className="flex flex-1 relative min-h-0 min-w-0">

        {/* View Switcher Output — wrapped in ErrorBoundary + Suspense for lazy-loaded components */}
        <ErrorBoundary>
        <Suspense fallback={
          <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <TirangaLoader className="w-8 h-8" />
              <span className="text-xs text-[#8b949e] font-mono uppercase tracking-widest">Loading module…</span>
            </div>
          </div>
        }>
        <div ref={screenRef} className={cn("flex-1 flex flex-col min-h-0 min-w-0 transition-all",
          ['chat', 'nbi_chat', 'studio', 'preview', 'shell'].includes(activeView) ? "overflow-hidden h-[calc(100vh-3.5rem-var(--nb-safe-top))] supports-[height:100dvh]:h-[calc(100dvh-3.5rem-var(--nb-safe-top))] max-h-[calc(100vh-3.5rem-var(--nb-safe-top))] supports-[height:100dvh]:max-h-[calc(100dvh-3.5rem-var(--nb-safe-top))]" : "overflow-y-auto overflow-x-hidden custom-scrollbar",
          // 8.1 — space for bottom nav on mobile (all views including chat). Gated on !focusMode so it
          // stays in lock-step with the bottom nav itself, which is hidden in focus mode (see the mobile
          // <nav> below, also `!focusMode`). Without this, focus mode reserved 56px for a nav that isn't
          // rendered — leaving an empty dead strip under the v5.0 composer, above the phone browser bar.
          // Reserve the bottom-nav strip ONLY when that nav is really rendered. Both this padding and
          // the <nav> itself now read the SAME flag, because they drifted apart twice: focus mode once
          // (fixed below), and Code Studio again on 2026-08-04 — the global nav was hidden inside the
          // IDE without dropping its 56px reservation, so Code Studio's own footer floated 56px above
          // the screen edge with a dead strip beneath it. A shared boolean makes that drift impossible.
          // Height comes from the SHARED constant, never a hand-typed pb-14: the bar is 3.5rem PLUS the
          // device's home-indicator inset, and reserving only the 3.5rem hid the composer by exactly
          // the inset on every iPhone. See lib/mobileNav.ts.
          ""
        )}
        style={showsGlobalMobileNav ? { paddingBottom: MOBILE_NAV_TOTAL_HEIGHT } : undefined}>
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
               onOpenOtherAI={() => toggleTab('other_ai')}
               onOpenAppMart={() => toggleTab('appstore')}
               isAdmin={isAdmin}
               data={homeData}
               onUpdate={(newData) => setHomeData(newData)}
               user={user}
               onShowLogin={() => setShowAuth(true)}
             />
          )}
          {activeView === 'other_ai' && (
            <OtherAIView
              onBack={() => toggleTab('home')}
              onOpenTool={(id) => { if (user) { toggleTab(id as any); } else { setShowAuth(true); } }}
            />
          )}
          {activeView === 'settings' && (
            <SettingsPanel
              effectiveDeviceMode={effectiveDeviceMode}
              settingsScreen={settingsScreen}
              setSettingsScreen={setSettingsScreen}
              toggleTab={toggleTab}
              setActiveView={setActiveView}
              onCloseSettings={() => closeTab(undefined, 'settings')}
              generatedCode={generatedCode}
              deviceMode={deviceMode}
              setDeviceMode={setDeviceMode}
              preferredLanguage={preferredLanguage}
              setPreferredLanguage={setPreferredLanguage}
              theme={theme}
              setTheme={setTheme}
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
            <NBIChatPanel
              teachMode={teachMode}
              setTeachMode={setTeachMode}
              sessions={sessions}
              currentSessionId={currentSessionId}
              messages={messages}
              input={input}
              setInput={setInput}
              onSend={(files) => handleSendForTab('nbi_chat', undefined, files)}
              onStop={stopChat}
              onUnsend={unsendChat}
              isLoading={isLoading}
              activeIntent={activeIntent}
              togglePin={togglePin}
              user={user}
              setShowAuth={setShowAuth}
              mode={mode}
              setMode={setMode}
              activeAgent={activeAgent}
              pendingGHEdit={pendingGHEdit}
              onConfirmPush={handleGHConfirmPush}
              isPushing={isPushing}
              isAppBuilt={isAppBuilt}
              theme={theme}
              onPreviewClick={() => { toggleTab('preview'); setIsMenuOpen(false); }}
              onRestoreUci={handleRestoreUci}
              wallet={wallet}
              setPreferredLanguage={setPreferredLanguage}
              setMessages={setMessages}
              onNewChat={startNewChat}
              // DESKTOP GETS THE SAME MODE PICKER (admin 2026-09-20). On mobile the bottom bar's Mode
              // button opens it; that bar is not rendered on desktop, so the composer carries the
              // button instead — gated on the SAME condition that renders the bar, so exactly one of
              // the two exists on any screen, and both open the one `showModePicker` sheet below.
              onOpenModePicker={modePickerOpener}
            />
          )}

          {/* Reachable from every screen: shake, or the sidebar's "Report a problem". It portals to
              document.body, so being rendered here costs nothing in layout. */}
          <ReportSheet open={reportOpen} onClose={() => setReportOpen(false)} view={activeView} initialMode={reportMode} />
          {/* Android's Back button, on the home screen, asks before closing the app. Rendered beside
              the other sheets so it is inside the same tree the back handler reads its state from. */}
          <ExitConfirmDialog
            open={exitPromptOpen}
            onExit={confirmExitApp}
            onCancel={() => setExitPromptOpen(false)}
          />

          {/* WE ARE STILL TESTING — say so once per app open, on the home screen, and hand over the
              way to report rather than only asking for it. Rendered beside the sheet it opens, so
              the notice and its destination are one change. See lib/testingNotice.ts. */}
          {shouldShowTestingNotice({ activeView, alreadyShown: !testingNoticeOpen }) && (
            <TestingNotice
              theme={theme}
              onReport={() => { setReportMode('choose'); setReportOpen(true); }}
              onDone={() => setTestingNoticeOpen(false)}
              // Empty everywhere but a signed-in Android app with something unclaimed, so the notice
              // behaves exactly as it did before for everyone else. See lib/referralChecklist.ts.
              rewardRows={referralProgress.rows}
              onOpenRewards={() => { setActiveView('billing'); setActiveBillingDetailTab('gift'); }}
            />
          )}

          {shouldRenderV3Surface(activeView, v3Preview.running === true, openTabs.includes('nbi_pro_chat')) && (
            /* NavBharatAI Pro — replaces the retired Pro v2.0 builder. ProV3Surface shows the
               real v5.0 builder when it's enabled for this account, else an honest "rolling out"
               message (never a broken builder). The old ProChatPanel (v2.0) is retired.

               WINDOW SEMANTICS (admin, 2026-07-05 IMG_5715): the surface stays MOUNTED while the v5.0
               tab is OPEN in the tab bar — its chat + live build stream survive switching among any
               number of other tabs (10+ windows), exactly like a real window. The earlier running-only
               keep-alive had an unmount race: the build finishing (or a stream blip) while another tab
               was active unmounted the surface in the background and the chat evaporated → "blank page,
               new chat". Unmounts only on explicit tab close (and never mid-build). `contents` when
               active is a layout no-op; `hidden` keeps it alive invisibly. See v3SurfaceMount. */
          <div className={v3SurfaceDisplayClass(activeView, proLocked)} aria-hidden={activeView !== 'nbi_pro_chat' || proLocked}>
            <ProV3Surface
              userId={user?.uid}
              email={user?.email}
              resume={v3Resume}
              freshOpenNonce={v3OpenNonce}
              openPreviewNonce={v3OpenPreviewNonce}
              /* In focus mode (header hidden) the v5.0 composer drops its outer frame so the
                 input reads as a clean floating popup — see AgentV3Panel's footer. */
              focusMode={focusMode}
              /* Dynamic footer (admin 2026-07-07): mobile/tablet only — exactly when the bottom nav
                 is visible, so v5.0's header controls and their footer replacements never both hide. */
              mobileFooter={v3MobileFooterActive(effectiveDeviceMode, focusMode)}
              onFooterApi={setV3FooterApi}
              /* LIVE FILE SYNC (admin 2026-09-20) — `live` marks a push from a build that is STILL
                 RUNNING, so Code Studio shows the app as it is written instead of only at the end.
                 The one risk that creates is real: the v5.0 surface stays mounted while the user is
                 in Code Studio, so they can be typing in a file at the moment the build writes one.
                 A path with un-flushed local edits is therefore held back — only that path, and only
                 on a live push. The end-of-build sync is deliberately unchanged (no `live`), because
                 by then the user's edits have flushed and the build's result is the project. */
              onFilesSync={(synced, opts) => {
                let clean = sanitizeFileMap(synced);
                if (opts?.live) {
                  const dirty = new Set(workspaceSyncerRef.current?.pendingPaths() ?? []);
                  if (dirty.size > 0) clean = Object.fromEntries(Object.entries(clean).filter(([p]) => !dirty.has(p)));
                }
                if (Object.keys(clean).length === 0) return;
                workspaceSyncerRef.current?.noteRemote(clean);
                setFiles((prev) => ({ ...prev, ...clean }));
              }}
              /* Phase S3 conflict guard: before a v5.0 build starts, force-flush any pending IDE edits to
                 the durable store so the build never runs on a stale file set (and so the user's latest
                 hand edits are what v5.0 reads/acknowledges). Best-effort — never blocks the build. */
              onBeforeBuild={() => { setPreviousFiles({ ...files }); return workspaceSyncerRef.current?.flush() ?? Promise.resolve(); }}
              onOpenInIDE={(path: string) => { setActiveFile(path); toggleTab('studio'); }}
              onPreviewState={setV3Preview}
              pendingFix={v3PendingFix}
              pendingDeploy={v3DeployRequest}
              /* Same FilesPanel bundle the sidebar "Files" menu uses (see ViewPanels), so the v5.0
                 "Files" tab and the sidebar "Files" are ONE feature with two gates — same component,
                 same data (uploads + v5.0 builds), same actions. */
              filesPanel={{
                files,
                hasGeneratedCode,
                fileUploadConflict,
                onResolveConflict: resolveFileConflict,
                onUpload: handleFilesUpload,
                onDownloadZip: () => downloadAppZip(files as any, 'NavBharatApp'),
                onOpenFile: (path: string) => { setActiveFile(path); toggleTab('studio'); },
                onAddFile: (path: string) => {
                  const next = { ...(files as Record<string, string>), [path]: '' };
                  setFiles(next as any);
                  setActiveFile(path);
                  toggleTab('studio');
                },
                // REAL delete — state + IndexedDB + v5.0 durable workspace (deleteWorkspaceFiles),
                // so the file never resurrects on reload and v5.0 forgets it too.
                onDeleteFile: (path: string) => deleteWorkspaceFiles([path]),
                onRenameFile: (oldPath: string, newPath: string) => {
                  const prev = files as Record<string, string>;
                  // Source must verifiably hold a string — writing `undefined` into the map crashed
                  // the whole app at render (report 2026-07-07: "undefined is not an object ('ce.split')").
                  if (prev[newPath] !== undefined || typeof prev[oldPath] !== 'string') return;
                  const next = { ...prev, [newPath]: prev[oldPath] };
                  delete next[oldPath];
                  setFiles(next as any);
                },
                onDuplicateFile: (sourcePath: string, targetPath: string) => {
                  const prev = files as Record<string, string>;
                  if (prev[targetPath] !== undefined || typeof prev[sourcePath] !== 'string') return;
                  setFiles({ ...prev, [targetPath]: prev[sourcePath] } as any);
                },
                sessionId: currentProSessionId,
                onRestoreVersion: (restoredFiles: any, commitMsg: string) => {
                  setFiles(restoredFiles);
                  addLog(`Restored to: ${commitMsg}`, 'success');
                  toggleTab('studio');
                },
                // Mobile (admin 2026-07-07): tap a file → Open / Copy file / Copy path / Delete
                // (hover actions don't exist on touch). Desktop keeps tap-to-open.
                tapActions: effectiveDeviceMode !== 'desktop',
              }}
            />
          </div>
          )}

          {/* The PIN card that stands in for the Pro builder while it is locked. The surface above is
              still mounted and, if a build was running, still running — it is only invisible. */}
          {activeView === 'nbi_pro_chat' && proLocked && user?.uid && (
            <AppLockScreen userId={user.uid} area="pro_builder" />
          )}

          {/* ── Senior Doctor Assistant (hidden in the Play native shell — playCompliance) ── */}
          {activeView === 'sda_chat' && !medicalViewBlocked('sda_chat', isNativeApp()) && (
            <div className="flex-1 overflow-hidden h-full min-h-0 max-h-full">
              <SDAChat key={sdaResetKey} userId={user?.uid} openCaseId={sdaOpenCaseId} onOpenModePicker={modePickerOpener} />
            </div>
          )}

          {/* ── Professionals hub ── */}
          {activeView === 'professionals' && (
            <ProfessionalsView onSelect={(id) => {
              if (id === 'sda_chat') toggleTab('sda_chat');
              else if (id === 'nbi_pro_chat') toggleTab('nbi_pro_chat'); // NavBharatAI Pro gate
              else if (id === 'engineer_ai') toggleTab('nbi_pro_chat'); // legacy id → Pro v5.0
              else if (id === 'teacher_ai') toggleTab('teacher_ai');
              else if (id === 'mentor_ai') toggleTab('mentor_ai');
              else if (id === 'thesis_ai') toggleTab('thesis_ai');
              else if (id === 'accountant_ai') toggleTab('accountant_ai');
              else if (id === 'lawyer_ai') toggleTab('lawyer_ai');
              else if (id === 'finance_ai') toggleTab('finance_ai');
              else if (id === 'astrologer_ai') toggleTab('astrologer_ai');
              else if (id === 'govt_schemes_ai') toggleTab('govt_schemes_ai');
              else if (id === 'kisan_ai') toggleTab('kisan_ai');
              else if (id === 'nutritionist_ai') toggleTab('nutritionist_ai');
              else if (id === 'wellness_ai') toggleTab('wellness_ai');
              else if (id === 'fitness_ai') toggleTab('fitness_ai');
              else if (id === 'vet_ai') toggleTab('vet_ai');
              else if (id === 'parenting_ai') toggleTab('parenting_ai');
              else if (id === 'cybersafety_ai') toggleTab('cybersafety_ai');
              else if (id === 'insurance_ai') toggleTab('insurance_ai');
              else if (id === 'chef_ai') toggleTab('chef_ai');
              else if (id === 'travel_ai') toggleTab('travel_ai');
              else if (id === 'vastu_ai') toggleTab('vastu_ai');
              else if (id === 'yoga_ai') toggleTab('yoga_ai');
              else if (id === 'english_ai') toggleTab('english_ai');
              else if (id === 'resume_ai') toggleTab('resume_ai');
              else if (id === 'gardening_ai') toggleTab('gardening_ai');
              else if (id === 'pharmacist_ai') toggleTab('pharmacist_ai');
              else if (id === 'business_ai') toggleTab('business_ai');
              else if (id === 'homerepair_ai') toggleTab('homerepair_ai');
              else if (id === 'realestate_ai') toggleTab('realestate_ai');
              else if (id === 'driving_ai') toggleTab('driving_ai');
              else if (id === 'petcare_ai') toggleTab('petcare_ai');
              else if (id === 'beauty_ai') toggleTab('beauty_ai');
              else if (id === 'music_ai') toggleTab('music_ai');
              else if (id === 'sports_ai') toggleTab('sports_ai');
              else if (id === 'photography_ai') toggleTab('photography_ai');
              else if (id === 'speaking_ai') toggleTab('speaking_ai');
              else if (id === 'events_ai') toggleTab('events_ai');
              else if (id === 'eldercare_ai') toggleTab('eldercare_ai');
              else if (id === 'interior_ai') toggleTab('interior_ai');
              else if (id === 'studyabroad_ai') toggleTab('studyabroad_ai');
              else if (id === 'disability_ai') toggleTab('disability_ai');
              else if (id === 'fashion_ai') toggleTab('fashion_ai');
              else if (id === 'productivity_ai') toggleTab('productivity_ai');
              else if (id === 'relationship_ai') toggleTab('relationship_ai');
              else if (id === 'vehicle_ai') toggleTab('vehicle_ai');
              else if (id === 'stocks_ai') toggleTab('stocks_ai');
              else if (id === 'techhelp_ai') toggleTab('techhelp_ai');
              else if (id === 'mathscience_ai') toggleTab('mathscience_ai');
              else if (id === 'coding_ai') toggleTab('coding_ai');
              else if (id === 'maternity_ai') toggleTab('maternity_ai');
              else if (id === 'firstaid_ai') toggleTab('firstaid_ai');
              else if (id === 'environment_ai') toggleTab('environment_ai');
              else if (id === 'gk_ai') toggleTab('gk_ai');
              else if (id === 'safety_ai') toggleTab('safety_ai');
              else if (id === 'translate_ai') toggleTab('translate_ai');
              else if (id === 'civic_ai') toggleTab('civic_ai');
              else if (id === 'sarkari_ai') toggleTab('sarkari_ai');
              else if (id === 'spiritual_ai') toggleTab('spiritual_ai');
              else if (id === 'crafts_ai') toggleTab('crafts_ai');
              else if (id === 'festival_ai') toggleTab('festival_ai');
              else if (id === 'writing_ai') toggleTab('writing_ai');
              else if (id === 'aptitude_ai') toggleTab('aptitude_ai');
              else if (id === 'disaster_ai') toggleTab('disaster_ai');
              else if (id === 'nature_ai') toggleTab('nature_ai');
              else if (id === 'freelance_ai') toggleTab('freelance_ai');
              else if (id === 'babynames_ai') toggleTab('babynames_ai');
              else if (id === 'hygiene_ai') toggleTab('hygiene_ai');
              else if (id === 'volunteer_ai') toggleTab('volunteer_ai');
              else if (id === 'astronomy_ai') toggleTab('astronomy_ai');
              else if (id === 'calligraphy_ai') toggleTab('calligraphy_ai');
              else if (id === 'dance_ai') toggleTab('dance_ai');
              else if (id === 'games_ai') toggleTab('games_ai');
              else if (id === 'techbuy_ai') toggleTab('techbuy_ai');
              else if (id === 'adventure_ai') toggleTab('adventure_ai');
              else if (id === 'budget_ai') toggleTab('budget_ai');
              else if (id === 'repo_analyst') toggleTab('repo_analyst');
            }} />
          )}

          {/* ── Config-driven professionals (Teacher, Mentor, …) — ONE render site for every expert, and
              one mounted chat per OPEN CONVERSATION (admin 2026-09-21: five chats at once). This replaced
              73 hand-written `activeView === 'x_ai'` blocks, which could only ever mount ONE conversation
              per expert. A window that is not on screen stays mounted but hidden, so a reply arriving
              while the user is in another window is not lost — it is a window, not a page. The medical
              gate is the SAME rule toggleTab applies (defence in depth, exactly as the Doctor AI block). */}
          {openChats.map((win) => {
            const cfg = PROFESSIONAL_CHATS[win.professionalId];
            if (!cfg || !isWindowedProfessional(win.professionalId) || medicalViewBlocked(win.professionalId, isNativeApp())) return null;
            const onScreen = activeChat?.id === win.id;
            return (
              <div key={win.id} className={onScreen ? 'flex-1 overflow-hidden h-full min-h-0 max-h-full' : 'hidden'}>
                <ProfessionalChat config={cfg} userId={user?.uid} conversationId={win.id} onScreen={onScreen} onOpenModePicker={modePickerOpener} />
              </div>
            );
          })}
          {activeView === 'repo_analyst' && (
            <div className="flex-1 overflow-hidden h-full min-h-0 max-h-full">
              <RepoAnalystTool userId={user?.uid} />
            </div>
          )}

          {/* ── Engineer AI — RETIRED (replaced by NavBharatAI Pro). UI entry removed. ── */}

                    {activeView === 'about' && (
            <AboutPanel
              isAdmin={isAdmin}
              about={about}
              saveState={aboutSaveState}
              onOverrideChange={saveAboutOverride}
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
              adminToken={localStorage.getItem('admin_token') || ''}
              adminTotp={adminTotp}
              onTotpChange={setAdminTotp}
              mfaRequired={adminMfaRequired}
              /* The bottom bar carries the admin tabs on mobile, so the dashboard's header strip
                 stands down and publishes the strip upward instead (admin 2026-09-20). Desktop is
                 untouched by construction — this boolean is false there. */
              mobileFooter={adminMobileFooterActive(effectiveDeviceMode, focusMode)}
              onFooterApi={setAdminFooterApi}
            />
         )}

          {activeView === 'billing' && (
            /* 🔒 APP LOCK — "Wallet & Billing" (admin 2026-09-13). The OUTER lock: ticking this covers the
               whole screen, including the plans card and the recharge tab that have their own finer
               toggles inside it (see `coveredByBilling` — the settings list says so rather than leaving
               two ticks that appear to do nothing). Default OFF. */
            <AppLockGate userId={user?.uid ?? ''} area="billing" render={() => (
            <BillingPanel
              user={user}
              wallet={wallet}
              loadingWallet={loadingWallet}
              dailyUsage={dailyUsage}
              billingTransactions={billingTransactions}
              billingLogs={billingLogs}
              activeBillingDetailTab={activeBillingDetailTab}
              couponCodeInput={couponCodeInput}
              isRedeemingCoupon={isRedeemingCoupon}
              couponError={couponError}
              couponSuccess={couponSuccess}
              buyAmountInput={buyAmountInput}
              isRecharging={isRecharging}
              storeRail={storeRail}
              storeConfig={storeConfig}
              platformFeePct={platformFeePct}
              buyingProductId={buyingProductId}
              storePurchaseNotice={storePurchaseNotice}
              onBuyStorePack={(id) => { void buyStorePack(id); }}
              onShowAuth={() => setShowAuth(true)}
              onFetchWallet={fetchWallet}
              onSetActiveBillingDetailTab={setActiveBillingDetailTab}
              onSetCouponCodeInput={setCouponCodeInput}
              onRedeemPromoCoupon={redeemPromoCoupon}
              referral={referralProgress}
              onRefreshReferral={referralProgress.refresh}
              onSetBuyAmountInput={setBuyAmountInput}
              onCreateBillingOrder={createBillingOrder}
              onToast={addToast}
              monthlyAiCost={monthlyAiCost}
            />
            )} />
          )}

          {activeView === 'my_profile' && (
            <ProfilePage
              effectiveDeviceMode={effectiveDeviceMode}
              user={user}
              onNavigateToBilling={() => { setActiveView('billing'); }}
              onNavigateToSettings={() => { setActiveView('settings'); }}
              onLogout={async () => {
                if (!confirm('Sign out from NavBharatAI?')) return;
                // Centralized teardown (src/lib/signOutFlow.ts) — root-cause fix for the
                // "logout ke baad login hota hi nahi" desktop bug: it deletes Firebase's
                // IndexedDB ONLY when signOut hangs, and AWAITS that delete before reload,
                // so the next login's persistence is never corrupted.
                await performSignOut({
                  signOut: () => signOutEverywhere(), // clears the NATIVE plugin session too (app), not just the web SDK
                  clearStorage: defaultClearAuthStorage,
                  // The GitHub connection must NOT outlive the session — else the next user on this
                  // browser would inherit it (and see/push to this user's GitHub account). Also
                  // unregister this device's push token so a signed-out device stops receiving pushes
                  // meant for this account (best-effort, async — never blocks logout).
                  extraCleanup: () => { clearGithubConnection(); void teardownPushNotifications(); },
                  deleteAuthDb: () => deleteFirebaseAuthDb(),
                  reload: () => window.location.reload(),
                });
              }}
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
                onFilesChange={applyIdeFileChange}
                onAgentChange={handleAgentChange}
                onToggleView={toggleTab}
                onActivatePreview={handleTriggerPreviewBuild}
                onActivateWorkspace={handleActivateWorkspace}
                onDeployViaV5={(provider) => { setV3DeployRequest({ provider, nonce: Date.now() }); toggleTab('nbi_pro_chat'); }}
              />
            )}



          {activeView === 'templates' && (
            // Phase 1.7 — extracted to TemplatesPanel component
            <TemplatesPanel
              user={user}
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

          {/* Separate 'engine_builder' v5.0 view REMOVED — v5.0 is now reached only via the two
              gates (sidebar "NavBharatAI Pro" = nbi_pro_chat, and Professionals → Pro v5.0),
              both rendering ProV3Surface above. The floating launcher is removed too. */}

          {activeView === 'donation' && (
            <DonationPanel
              isAdmin={isAdmin}
              isDonationEditing={isDonationEditing}
              donationData={donationData}
              onToggleEditing={() => setIsDonationEditing(p => !p)}
              onStartEditing={() => setIsDonationEditing(true)}
              onDonationDataChange={setDonationData}
              onFileUpload={handleFileUpload}
              onCopySuccess={() => addLog('UPI ID copied to clipboard.', 'success')}
            />
          )}


          {/* The Mode sheet (admin 2026-08-25). Selecting navigates through the SAME toggleTab paths
              the Professionals hub uses, so every expert opens its real chat — engine, disclaimers and
              pass-gate untouched. "FREE +" mints a new free session; the old one stays in History. */}
          {showModePicker && (
            <ModePickerSheet
              activeView={activeView}
              hideMedical={medicalFeaturesHidden(isNativeApp())}
              onClose={() => setShowModePicker(false)}
              // ✕ ON THE RECENT ROW (admin 2026-09-21). It closes the conversation that row names —
              // the SAME `closeTab` the header tab's ✕ calls, so there is one way to close a chat
              // rather than a second copy of the rule (which is what would decide, differently, what
              // happens to the preview, the draft and the session id).
              onCloseRecent={(recentId) => {
                const view = viewFromRecentId(recentId);
                if (!view) return;
                setShowModePicker(false);
                // For an expert the recent row names the WINDOW on screen — close that conversation
                // only; its sibling windows with the same expert stay open (2026-09-21).
                if (activeChat && activeChat.professionalId === view) { closeChatWindow(undefined, activeChat.id); return; }
                closeTab(undefined, view as ViewType);
              }}
              onPick={(id) => {
                setShowModePicker(false);
                // ROW 1 — the only row that starts nothing. It names the AI already open and takes the
                // user back to THAT conversation (admin: "1st option, jo ki open kon sa yeh batata hai").
                const resume = viewFromRecentId(id);
                if (resume) { toggleTab(resume as ViewType); return; }
                // Everything else opens a NEW chat, which is the whole point of the change.
                if (id === FREE_MODE_ID) { startNewChat(); toggleTab('nbi_chat'); return; }
                // The image studio is Other Tools' own view — free and paid together, nothing forked.
                if (id === IMAGE_MODE_ID) { toggleTab(IMAGE_MODE_ID as ViewType); return; }
                if (medicalViewBlocked(id, isNativeApp())) return; // defense in depth behind the filter
                // ✅ DOCTOR AI NOW STARTS FRESH TOO (2026-09-19). It was the one row still resuming,
                // because every case shared one Firestore document and one transcript key — so "new
                // chat" would have destroyed the previous patient's workup. Each case now owns its
                // address (sdaCaseStore.ts), so starting one deletes nothing: the case before it keeps
                // its own row in History → SDA. Same call the ✕ makes, so there is one way to begin a
                // case rather than a second copy of the rule.
                if (id === 'sda_chat') {
                  setSdaOpenCaseId(undefined);
                  startFreshCase(typeof window !== 'undefined' ? window.localStorage : null, newSdaCaseId(), user?.uid);
                  setSdaResetKey(k => k + 1);
                  toggleTab(id as ViewType);
                  return;
                }
                // A professional's "New chat" opens a NEW WINDOW with a fresh conversation (admin
                // 2026-09-21: five chats at once). It used to END the live one first, because a
                // professional could hold only one conversation; now the one already open simply stays
                // open beside it. See modePicker.ts.
                if (startsFreshOnPick(id)) {
                  toggleTab(id as ViewType, true, newConversationId());
                  return;
                }
                toggleTab(id as ViewType);
              }}
            />
          )}
          {/* The Free chat's History, laid OVER the conversation rather than replacing it (admin
              2026-08-28, matching Pro v5.0). It renders the SAME HistoryView the tab does — the
              merged Free + Doctor AI + professionals list with a mode tag on every row, which
              shipped 2026-08-25 (#2687) — so the two can never drift apart. */}
          {historyPopupOpen && (
            <HistoryPopup
              user={user}
              onClose={() => setHistoryPopupOpen(false)}
              onRestoreSession={handleRestoreUci}
              onDeleteSession={deleteSession}
              onOpenProfessional={openProfessionalConversation}
              onDeleteProfessional={deleteProfessionalConversation}
            />
          )}
          {activeView === 'report' && <ReportsListView user={user} />}
          {activeView === 'history' && (historyInitialFilter === 'professional'
            ? <ProfessionalHistoryView onOpen={openProfessionalConversation} onDelete={deleteProfessionalConversation} onBack={() => toggleTab('professionals')} />
            : <HistoryView user={user} onRestoreSession={handleRestoreUci} onDeleteSession={deleteSession} initialFilter={historyInitialFilter} lockFilter={historyInitialFilter === 'free'}
                includeProfessionals={historyInitialFilter === 'free'}
                onOpenProfessional={openProfessionalConversation} onDeleteProfessional={deleteProfessionalConversation} />)}

          {activeView === 'deploy' && (
            <DeploySuccessPanel
              deployUrl={deployUrl}
              onOpenPreview={() => toggleTab('preview')}
              onBackToCode={() => setIsDeployed(false)}
            />
          )}

          <ViewPanels
            onOpenModePicker={modePickerOpener}
            effectiveDeviceMode={effectiveDeviceMode}
            storeInitialTab={storeTarget?.tab}
            storePublishWorkspaceId={storeTarget?.workspaceId ?? null}
            v3Preview={v3Preview}
            previousFiles={previousFiles}
            onV3FixError={(errText) => setV3PendingFix({ text: platformFixRequestPrompt(errText), nonce: Date.now() })}
            onBuildViaV5Prompt={(text) => { setV3PendingFix({ text, nonce: Date.now() }); toggleTab('nbi_pro_chat'); }}
            /* Code Studio's "Preview" button (admin 2026-09-15: "ide me koi user preview press kare to
               navbharatai pro, open hi preview wala page"). Same shape as the AI button beside it —
               NavBharatAI Pro opens in its OWN window, alongside Code Studio — with the nonce telling the
               panel to land on its Preview surface rather than the chat. */
            onOpenProPreview={() => { setV3OpenPreviewNonce(Date.now()); toggleTab('nbi_pro_chat'); }}
            onAutoFixInV5={(workspaceId, text) => {
              // Open the SCANNED Pro v5 app's session (so v5 fixes THAT app's files) with the fix
              // prompt prefilled — a fresh fix conversation in the v5 page (admin 2026-07-24).
              const uid = user?.uid || 'anon';
              const prefix = `agentv3-${uid}-`;
              const sid = workspaceId.startsWith(prefix) ? workspaceId.slice(prefix.length) : workspaceId;
              setV3Resume({ sessionId: sid, messages: [], nonce: Date.now() });
              v3ResumeInFlightRef.current = true; // retarget that app's session, don't bump a fresh-open
              setV3PendingFix({ text, nonce: Date.now() });
              toggleTab('nbi_pro_chat');
            }}
            onSwitchApp={(sid: string) => {
              // Time Machine: switch the workspace to another of the user's apps so its versions become
              // restorable (reuses the proven session-resume path). The Versioning view stays open and
              // reloads that app's history via the updated currentProSessionId.
              if (!sid || sid === currentProSessionId) return;
              setCurrentProSessionId(sid);
              setV3Resume({ sessionId: sid, messages: [], nonce: Date.now() });
              v3ResumeInFlightRef.current = true;
            }}
            problems={problems}
            activeView={activeView}
            generatedCode={generatedCode}
            setGeneratedCode={setGeneratedCode}
            files={files}
            setFiles={setFiles as any}
            onIdeFilesChange={applyIdeFileChange}
            onFlushIdeEdits={flushIdeEdits}
            onReplaceProjectFiles={replaceProjectFiles}
            onFilesRemoved={handleFilesRemoved}
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
            setShowAuth={setShowAuth}
            zipSizeModal={zipSizeModal}
            setZipSizeModal={setZipSizeModal}
          />

        </div>
        </Suspense>
        </ErrorBoundary>
      </main>


              </div>
 
              
      {/* AgentV3 (Vargen 3.0) launcher — admin-only, flag-gated; renders nothing when disabled. */}
      {/* Floating v5.0 launcher REMOVED — v5.0 is reached via the two gates only (see ProV3Surface). */}

      {/* Auth Modal + all overlay modals → AppModals */}
      <AppModals
        showAuth={showAuth}
        auth={auth}
        setUser={setUser}
        onCloseAuth={() => setShowAuth(false)}
        githubRedirectingMessage={githubRedirectingMessage}
        githubDebugData={githubDebugData}
        setGithubRedirectingMessage={setGithubRedirectingMessage}
        showContinueModal={showContinueModal}
        setShowContinueModal={setShowContinueModal}
        setRestoreUciError={setRestoreUciError}
        setResumeUciInputState={setResumeUciInputState}
        resumeUciInputState={resumeUciInputState}
        restoreUciError={restoreUciError}
        handleRestoreByUci={handleRestoreByUci}
        isRestoringUci={isRestoringUci}
        firebaseOauthError={firebaseOauthError}
        setFirebaseOauthError={setFirebaseOauthError}
        pendingProvider={pendingProvider}
        setPendingProvider={setPendingProvider}
        pendingKey={pendingKey}
        setPendingKey={setPendingKey}
        handleKeySave={handleKeySave}
        showCheckoutModal={showCheckoutModal}
        setShowCheckoutModal={setShowCheckoutModal}
        paymentSession={paymentSession}
        user={user}
        verifyBillingPayment={verifyBillingPayment}
        isWorkspacePreparing={isWorkspacePreparing}
        workspacePrepError={workspacePrepError}
        setWorkspacePrepError={setWorkspacePrepError}
        isPreviewBuilding={isPreviewBuilding}
        previewBuildStage={previewBuildStage}
        detectedFramework={detectedFramework}
        previewBuildError={previewBuildError}
        setPreviewBuildError={setPreviewBuildError}
      />

      {/* 8.1 — Mobile bottom navigation bar (hidden on desktop, and hidden in Focus Mode too).
          DYNAMIC PER-VIEW FOOTER (admin 2026-07-07): the bar is ONE component (same design, same
          gating) but its ITEMS follow the active view. v5.0 active → its own six items (History ·
          Pro Chat · Preview · Files · Report · More), driven by the REAL panel actions registered
          via onFooterApi. Every other view keeps the default items. */}
      {/* CODE STUDIO OWNS ITS OWN FOOTER (admin 2026-08-04, with screenshot). Code Studio already renders
          a full IDE footer of its own — CODE · FILES · PREVIEW · AI · MORE — so on mobile the screen was
          showing TWO stacked navigation bars: the IDE's, and this global one right below it. Two footers
          is not a cosmetic annoyance on a phone; it eats a double slice of the smallest screen we have,
          and the two rows disagree about where you are (the IDE says CODE, the global bar says STUDIO).
          Inside the IDE, the IDE's own bar is the correct and only one. `botbuilder` is excluded here for
          the same reason and has been for a while. */}
      {/* 🔴 NO backdrop-blur HERE, AND THAT IS A PERFORMANCE DECISION (admin 2026-09-19: the Android
          app scrolled badly — "page scroll karne me lag hota hai").

          This bar used to be `bg-[var(--surface-base)]/95 backdrop-blur-xl`. Three facts together made
          that the most expensive pixel in the app, and the third is what made it pointless:

            • It is `fixed` and `showsGlobalMobileNav` is true for essentially the whole mobile app, so
              it sits over the scrolling content at all times.
            • `backdrop-blur-xl` is a 24px blur, and the content behind it MOVES while the user scrolls,
              so the compositor had to re-blur that full-width strip on EVERY frame.
            • The surface over it was 95% opaque, so at most 5% of that blur ever reached anyone's eye.

          We were paying a per-frame, full-width GPU blur to produce an effect nobody could see. On a
          desktop GPU that is invisible in both senses; in an Android WebView on a mid-range phone it is
          exactly the kind of work that turns a 60fps scroll into a stuttering one.

          🔎 WHY THIS ONE AND NOT THE OTHER 42 `backdrop-blur` SITES, because the contrast is the
          evidence: almost every other one is a MODAL overlay (`fixed inset-0 bg-scrim`), which appears
          only while a dialog is open and blurs a background that is not moving — there the blur is both
          cheap and visible. This was the only blur living permanently over scrolling content.

          ⚠️ HONEST LIMIT: no session here can drive a real Android device, so this is a mechanism-level
          finding from the code plus how WebView compositing works, NOT a measurement on a phone. It is
          recorded that way in PROGRESS.md. What IS certain is the cost side — a per-frame blur is real
          work — and that removing it cannot change what the user sees beyond that 5%.

          `bg-surface` is the same `--surface-base` colour the bar already used, just opaque — which is
          also what a native Android tab bar looks like. */}
      {showsGlobalMobileNav && (
        <nav className={`fixed bottom-0 left-0 right-0 z-[150] bg-surface border-t border-[var(--border-soft)] flex items-stretch px-2 ${adminStrip ? 'overflow-x-auto no-scrollbar gap-1' : 'justify-around'}`}
          ref={adminStrip ? adminStripRef : undefined}
          style={{
            // The bar is a FIXED 3.5rem of tappable content PLUS the device's home-indicator inset BELOW it.
            // Adding the safe-area to the height (instead of the old fixed h-14 with padding eating INTO it
            // under box-sizing:border-box) stops the icons/labels from being squeezed and poking above the
            // top border — so it reads as a clean native tab bar (admin 2026-07-15).
            height: MOBILE_NAV_TOTAL_HEIGHT,
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            // NOT PANNABLE (admin report 2026-09-14): a touch starting on this bar and dragging up could
            // move the whole app, revealing white space beneath it on iOS Safari — the global `pan-x
            // pan-y` rule (index.css) permits vertical pan on every element so ordinary scroll views keep
            // working, but this bar has no scrollable content of its own and a real native tab bar never
            // pans under a swipe either. `none` stops a drag from being recognised as a pan gesture here
            // at all; taps on the buttons inside are untouched (touch-action only governs panning).
            //
            // 🔴 EXCEPT ON THE ADMIN STRIP, AND THIS IS THE ONE LINE THAT MADE THAT FEATURE POSSIBLE
            // (admin 2026-09-20: *"left right swipable header hoga"*). `none` forbids EVERY pan,
            // horizontal included — so a swipable footer with `none` on it is a footer that cannot be
            // swiped, and the nine tabs past the screen edge would have been unreachable by the exact
            // gesture that was asked for. `pan-x` permits the horizontal pan and nothing else, so the
            // 2026-09-14 bug it was written for — a drag UP moving the whole app — stays closed here
            // too. Tightening this back to `none` would silently re-break the swipe.
            touchAction: adminStrip ? 'pan-x' : 'none',
            // Momentum on iOS, so the strip reads as a native scroller rather than a stiff row.
            ...(adminStrip ? { WebkitOverflowScrolling: 'touch' as const } : {}),
          }}
        >
          {adminStrip ? (
            /* ── THE ADMIN CONSOLE'S OWN TABS, IN THE FOOTER (admin 2026-09-20) ──────────────────
               *"is footer me MONITOR, USERS, ai engine, revenue … jo abhi header me hai, unko rakho"*.
               Nine tabs do not fit five fixed slots, which is exactly why the admin asked for a
               swipable strip rather than a swap: the row scrolls, and every tab keeps its full name.

               🔒 THIS BRANCH NAMES NO TAB. It renders `adminFooterApi.items` — the console's own
               table, with its own live badges — so adding a tab to `TABS` in AdminDashboard puts it
               here automatically. A hardcoded list in this file would drift the first time a page
               was added, and nothing would fail: the strip would simply be missing it. */
            adminFooterApi!.items.map((item) => {
              const Icon = item.icon;
              const active = item.id === adminFooterApi!.activeId;
              return (
                <button
                  key={item.id}
                  data-admin-tab={item.id}
                  data-admin-tab-active={active ? 'true' : undefined}
                  onClick={() => adminFooterApi!.select(item.id)}
                  aria-label={item.label}
                  aria-current={active ? 'page' : undefined}
                  className={`relative shrink-0 flex flex-col items-center justify-center gap-0.5 px-3 h-full min-h-[44px] min-w-[68px] rounded-xl transition-all active:scale-90 ${active ? 'bg-indigo-600/15 text-accent-text' : 'text-muted'}`}
                >
                  <span className="relative inline-flex">
                    <Icon className={`w-5 h-5 shrink-0 ${active ? 'drop-shadow-[0_0_6px_rgba(99,102,241,0.8)]' : ''}`} />
                    {/* The counter the header strip already shows. `badge` is null for anything
                        unmeasured and a null draws NOTHING — never a zero, which on this row would
                        read as "I looked, there is no work here". */}
                    {item.badge && (
                      <span
                        className={`absolute -top-1.5 -right-2.5 min-w-[14px] px-0.5 h-3.5 rounded-full text-[8px] font-black leading-[14px] text-center ${item.hot ? 'bg-red-500 text-on-accent' : 'bg-indigo-600 text-on-accent'}`}
                        aria-label={`${item.label}: ${item.badge}`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </span>
                  <span className="text-[9px] font-black uppercase tracking-wider leading-none truncate max-w-[64px] px-0.5">{item.label}</span>
                </button>
              );
            })
          ) : activeView === 'nbi_pro_chat' && v3FooterApi ? (
            [
              { key: 'history', icon: History,        label: 'History',  onTap: v3FooterApi.openHistory, active: false },
              { key: 'chat',    icon: MessageSquare,  label: 'Pro Chat', onTap: v3FooterApi.openChat,    active: v3FooterApi.section === 'chat' },
              { key: 'preview', icon: Monitor,        label: 'Preview',  onTap: v3FooterApi.openPreview, active: v3FooterApi.section === 'preview', dot: v3FooterApi.previewReady },
              { key: 'files',   icon: FolderOpen,     label: 'Files',    onTap: v3FooterApi.openFiles,   active: v3FooterApi.section === 'files', count: v3FooterApi.fileCount },
              // Code Studio (admin 2026-08-04): replaces the footer's old "Report" item, which merely
              // duplicated the action already in the More sheet. Studio edits the SAME live file map
              // v5.0 builds into (files state + workspace syncer), so this is one feature reached from
              // two places — not a second editor.
              { key: 'studio',  icon: Smartphone,     label: 'Code Studio', onTap: () => toggleTab('studio'), active: false },
              // The Action Navigator's roll-up (admin 2026-09-21). A TONE, not a boolean: the colour
              // decision lives in ActionDot alone, so this row cannot invent a third meaning for a dot.
              { key: 'more',    icon: MoreHorizontal, label: 'More',     onTap: v3FooterApi.openMore,    active: v3FooterApi.section === 'diff' || v3FooterApi.section === 'terminal' || v3FooterApi.section === 'history', badgeTone: v3FooterApi.moreBadge, badgeLabel: v3FooterApi.moreBadgeLabel },
            ].map(({ key, icon: Icon, label, onTap, active, busy, dot, count, badgeTone, badgeLabel }: { key: string; icon: React.ComponentType<{ className?: string }>; label: string; onTap: () => void; active: boolean; busy?: boolean; dot?: boolean; count?: number; badgeTone?: ActionTone | null; badgeLabel?: string | null }) => (
              <button
                key={key}
                onClick={onTap}
                aria-label={label}
                aria-current={active ? 'page' : undefined}
                className={`relative flex flex-col items-center justify-center gap-0.5 flex-1 h-full min-h-[44px] transition-all active:scale-90 ${active ? 'text-indigo-400' : 'text-[#484f58]'}`}
              >
                <span className="relative inline-flex">
                  {busy
                    ? <TirangaLoader className="w-5 h-5 shrink-0" />
                    : <Icon className={`w-5 h-5 shrink-0 ${active ? 'drop-shadow-[0_0_6px_rgba(99,102,241,0.8)]' : ''}`} />}
                  {/* Admin 2026-07-07: green dot = the app is genuinely viewable (real state, never a timer). */}
                  {dot && <span className="absolute -top-0.5 -right-1 w-2 h-2 bg-emerald-400 rounded-full shadow-[0_0_5px_rgba(52,211,153,0.9)]" aria-label="Preview ready" />}
                  {/* The Action Navigator's dot — same corner as the green one above, and the two
                      never coexist: green rides Preview, this rides More. */}
                  {badgeTone && (
                    <span className="absolute -top-0.5 -right-1">
                      <ActionDot tone={badgeTone} label={badgeLabel ?? null} />
                    </span>
                  )}
                  {/* Admin 2026-07-07: the REAL built-file count on the Files item. */}
                  {typeof count === 'number' && count > 0 && (
                    <span className="absolute -top-1.5 -right-2.5 min-w-[14px] px-0.5 h-3.5 rounded-full bg-indigo-600 text-white text-[8px] font-black leading-[14px] text-center" aria-label={`${count} files`}>{count > 99 ? '99+' : count}</span>
                  )}
                </span>
                <span className={`text-[9px] font-black uppercase tracking-wider leading-none truncate max-w-full px-0.5 ${active ? 'text-indigo-400' : ''}`}>{label}</span>
                {active && <span className="w-1 h-1 bg-indigo-400 rounded-full mt-0.5" />}
              </button>
            ))
          ) : isModeSurface(activeView) ? (
            // Per-AI footer (admin 2026-07-28; Mode made REAL 2026-08-25): NavBharatAI Free, the
            // Professionals hub, Doctor AI and every professional chat share a focused nav —
            // History / AI / Mode / Settings. Mode opens the picker (FREE / new FREE chat / any
            // expert); it is the professionals' new front door now that the Home tile is gone.
            [
              { key: 'history',  id: 'history' as ViewType,  icon: History,   label: 'History' },
              { key: 'ai',       id: activeView,              icon: activeView === 'nbi_chat' ? MessageSquare : Briefcase, label: 'AI' },
              { key: 'mode',     id: null,                    icon: Layers,    label: 'Mode' },
              { key: 'settings', id: 'settings' as ViewType, icon: Settings,  label: 'Settings' },
            ].map(({ key, id, icon: Icon, label }) => {
              const isActive = key === 'ai' ? true : (id != null && activeView === id);
              return (
                <button
                  key={key}
                  onClick={() => {
                    if (key === 'mode') { setShowModePicker(true); return; }
                    // History scoping (admin 2026-08-11, amended 2026-08-25): the FREE surface now shows
                    // Free + Doctor + every professional conversation, each with its mode tag — one
                    // unified list ("free ki history me sabhi ayegi tag ke sath"). The Professionals
                    // hub keeps its professional-only view.
                    if (id === 'history') {
                      setHistoryInitialFilter(historyFilterFor(activeView as string));
                      // POPUP OVER THE CHAT on the Free surface — you glance at the list and you are
                      // back in the same conversation, exactly as Pro v5.0 behaves. Every other
                      // surface keeps the History tab byte-for-byte.
                      if (historySurfaceFor(activeView as string) === 'popup') {
                        // The SAME auth gate the tab uses, called rather than re-implemented: history
                        // is sign-in-only, and a second copy of that rule would drift. authGateDecision
                        // opens optimistically while Firebase is still restoring, so a returning user
                        // is never shown the login screen by mistake.
                        if (authGateDecision('history', !!user, loadingUser) === 'login') {
                          pendingViewAfterLoginRef.current = 'history';
                          setShowAuth(true);
                          addLog('Chat history requires an active session. Please login.', 'warn');
                          return;
                        }
                        setHistoryPopupOpen(true);
                        return;
                      }
                    }
                    if (id) toggleTab(id);
                  }}
                  aria-label={label}
                  aria-current={isActive ? 'page' : undefined}
                  className={`flex flex-col items-center justify-center gap-0.5 flex-1 h-full min-h-[44px] transition-all active:scale-90 ${isActive ? 'text-indigo-400' : 'text-[#484f58]'}`}
                >
                  <span className="relative inline-flex">
                    <Icon className={`w-5 h-5 shrink-0 ${isActive ? 'drop-shadow-[0_0_6px_rgba(99,102,241,0.8)]' : ''}`} />
                  </span>
                  <span className={`text-[9px] font-black uppercase tracking-wider leading-none truncate max-w-full px-0.5 ${isActive ? 'text-indigo-400' : ''}`}>{label}</span>
                  {isActive && <span className="w-1 h-1 bg-indigo-400 rounded-full mt-0.5" />}
                </button>
              );
            })
          ) : (
          [
            { id: 'home' as ViewType,      icon: menuItems.find(m => m.id === 'home')?.icon      ?? Bot,         label: 'Home' },
            { id: (activeAgent === 'navbharatai-pro' ? 'nbi_pro_chat' : 'nbi_chat') as ViewType, icon: activeAgent === 'navbharatai-pro' ? (menuItems.find(m => m.id === 'nbi_pro_chat')?.icon ?? Zap) : (menuItems.find(m => m.id === 'nbi_chat')?.icon ?? MessageSquare), label: 'AI' },
            { id: 'preview' as ViewType,   icon: menuItems.find(m => m.id === 'preview')?.icon   ?? Monitor,     label: 'Preview' },
            { id: 'studio' as ViewType,    icon: menuItems.find(m => m.id === 'studio')?.icon    ?? Smartphone,  label: 'Studio' },
            { id: 'settings' as ViewType,  icon: menuItems.find(m => m.id === 'settings')?.icon  ?? Settings,    label: 'More' },
          ].map(({ id, icon: Icon, label }) => {
            const isActive = activeView === id;
            // Preview is v5.0-first (admin 2026-07-07: one preview, three gates): enable it whenever a v3
            // workspace exists, not only for the retired v2 generatedCode path.
            const isDisabled = id === 'preview' ? !(v3Preview.workspaceId || hasGeneratedCode) : (id === 'studio' && !hasGeneratedCode);
            return (
              <button
                key={id}
                disabled={isDisabled}
                onClick={() => { if (!isDisabled) toggleTab(id); }}
                aria-label={label}
                aria-current={isActive ? 'page' : undefined}
                className={`flex flex-col items-center justify-center gap-0.5 flex-1 h-full min-h-[44px] transition-all active:scale-90 ${
                  isActive ? 'text-indigo-400' : isDisabled ? 'text-white/20' : 'text-[#484f58]'
                }`}
              >
                <Icon className={`w-5 h-5 shrink-0 ${isActive ? 'drop-shadow-[0_0_6px_rgba(99,102,241,0.8)]' : ''}`} />
                <span className={`text-[9px] font-black uppercase tracking-wider leading-none truncate max-w-full px-0.5 ${isActive ? 'text-indigo-400' : ''}`}>{label}</span>
                {isActive && <span className="w-1 h-1 bg-indigo-400 rounded-full mt-0.5" />}
              </button>
            );
          })
          )}
        </nav>
      )}

      {/* OFFLINE — a persistent bar, not a toast that vanishes while the condition lasts (item C).
          Driven by `reachable` (a real round trip), never by navigator.onLine. Rendered here, at the
          app root, so it appears on every screen rather than in whichever panel happened to add it. */}
      <OfflineBanner reachable={networkStatus.reachable} />

      {/* Focus Mode — floating "bring the header back" button. Pinned to the TOP-right corner (admin
          request) so it never collides with the composer at the bottom edge; always visible (works on
          both mouse and touch, unlike a hover-reveal) on the top-most layer so it's discoverable and
          never lost behind other UI; safe-area-aware for the notch / browser chrome up top. Esc does
          the same thing (see the keydown effect above). */}
      {/* BLUR-OVER-SCROLL-OK: this one keeps its backdrop-blur, deliberately, and the reason is the
          mirror image of the bottom nav's (see the note on that <nav> above). It renders ONLY in focus
          mode, it is 36x36px rather than the full width of the screen, and at 60% opacity the blur is
          genuinely visible instead of being hidden under a 95%-opaque surface. Cost small, effect real
          — the opposite trade to the one that was removed.
          ⚠️ The marker above is what `tests/theAppDoesNotBlurWhatNobodyCanSee.test.ts` looks for: a
          blur placed over the app's own scrolling content has to justify itself in place, or CI fails. */}
      {focusMode && (
        <button
          onClick={() => setFocusMode(false)}
          title="Exit Focus Mode (Esc)"
          aria-label="Exit Focus Mode — show header"
          className="fixed z-[9999] top-3 right-3 w-9 h-9 flex items-center justify-center rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-md border border-white/15 text-white/70 hover:text-white shadow-lg transition-all active:scale-90"
          style={{ marginTop: 'env(safe-area-inset-top, 0px)', marginRight: 'env(safe-area-inset-right, 0px)' }}
        >
          <Minimize2 className="w-4 h-4" />
        </button>
      )}

      {/* SCROLLBAR RULES DELIBERATELY ABSENT (2026-09-19). They used to sit at the top of this block —
          a second copy of .custom-scrollbar / .no-scrollbar, already declared in src/index.css. The copy
          here read like the winner (unlayered beats @layer base) and was DEAD: since Chromium 121 a
          non-auto scrollbar-color, which index.css sets, makes the engine ignore every
          ::-webkit-scrollbar pseudo-element on that box. One rule, one home — index.css. The native
          shell hides scrollbars outright there, under html.nb-native-shell. */}
      <style>{`
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


      {/* 10.6 — Toast notifications */}
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {/* Onboarding modal removed — direct home page load */}

      </div>
  );
}
