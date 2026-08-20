import React, { lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Settings, X, ChevronRight, ChevronLeft, Monitor, LayoutDashboard, Lock, Database,
  GitFork, Terminal, Activity, GitBranch, Bot, MessageSquare, Wand2, Bug, Code,
  TestTube, Globe, GitMerge, Gauge, Minimize2, Moon, Layout, Puzzle, LayoutTemplate,
  Figma, Rocket, Smartphone, Package, IndianRupee, Users2, Palette, TrendingUp,
  BarChart2, Cpu, Sparkles, Eye, EyeOff, Github, List, LogOut, GitBranch as GitBranchIcon,
  Folder, Check, Search, RefreshCw, Box, Zap, Globe as GlobeIcon, Search as SearchIcon,
  Heart, HardDrive, ShieldCheck, Languages, Plus, ExternalLink, Copy, User, Mail, Scale, FileText,
} from 'lucide-react';
import { cn } from '../../lib/utils';
// META only — the ~45 KB of document bodies must never enter the main chunk (bundle budget);
// LegalDocPage dynamic-imports the full registry into its own lazy chunk.
import { LEGAL_META } from '../../content/legal/meta';
import { LegalDocPage } from './LegalDocPage';
import {
  type MotionMode, getStoredMotionMode, applyMotionMode,
  getStoredFontScale, applyFontScale, FONT_SCALE_MIN, FONT_SCALE_MAX, FONT_SCALE_STEP, FONT_SCALE_DEFAULT,
} from '../../lib/a11y';
import { readTapFeedbackPrefs, writeTapFeedbackPrefs, type TapFeedbackPrefs } from '../../lib/tapFeedbackPrefs';
import { SettingsScreen, ViewType, ApiKeys, PROVIDER_CONFIG } from '../../types';
import { getAgentV3WorkspaceId } from '../../lib/agentv3Workspace';
import { THEME_MODES } from '../../lib/theme';
import type { ThemeMode } from '../../lib/theme';
import type { User as FirebaseUser } from 'firebase/auth';

// Lazy-loaded sub-components (same pattern as App.tsx)
const _lz = <T extends object>(fn: () => Promise<T>, k: keyof T) =>
  lazy(() => fn().then(m => ({ default: m[k] as React.ComponentType<any> })));

const SecretManager    = _lz(() => import('../SecretManager'),             'SecretManager');
const DatabaseSettings = _lz(() => import('../settings/DatabaseSettings'), 'DatabaseSettings');
const StorageSettings  = _lz(() => import('../settings/StorageSettings'),  'StorageSettings');
const AuthSettings     = _lz(() => import('../settings/AuthSettings'),     'AuthSettings');
// "Your Website" hub (admin 2026-07-29): the ONE real domain-connect flow, now reachable from
// App Settings → Domain (it already existed for Sidebar → More and Home → Other AI → Custom Domain).
const ConnectMyWebsitePanel = _lz(() => import('./ConnectMyWebsitePanel'), 'ConnectMyWebsitePanel');
// REAL workspace logs — live v5.0 build events + the app's own captured runtime errors.
const WorkspaceLogs    = _lz(() => import('../ide/WorkspaceLogs'),         'WorkspaceLogs');

// Inlined theme-classes shape (matches getThemeClasses return type)
type ThemeClasses = {
  bg: string;
  text: string;
  border: string;
  accent: string;
  card: string;
  raw: { bg: string; text: string; border: string; card: string };
};

// MenuItem shape (mirrors what App.tsx builds in menuItems useMemo)
type MenuItem = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  status?: string;
};

export interface SettingsPanelProps {
  // layout / theme
  themeClasses: ThemeClasses;

  // navigation
  settingsScreen: SettingsScreen;
  setSettingsScreen: (s: SettingsScreen) => void;
  toggleTab: (view: ViewType) => void;
  setActiveView: (view: ViewType) => void;
  /**
   * Genuinely close Settings — the SAME teardown the header tab's ✕ runs (children, companions, state
   * reset, and where the user lands). Before this the header ✕ here only navigated to another tab, so
   * a button labelled "Close Settings" neither closed Settings nor took you anywhere you asked for.
   */
  onCloseSettings: () => void;

  // The current app's generated code — still threaded for the screens that analyse the built app.
  generatedCode?: string;

  // settings state
  deviceMode: 'auto' | 'mobile' | 'tablet' | 'desktop';
  setDeviceMode: (m: 'auto' | 'mobile' | 'tablet' | 'desktop') => void;
  preferredLanguage: 'hindi' | 'hinglish' | 'english' | 'auto' | undefined;
  setPreferredLanguage: (l: 'hindi' | 'hinglish' | 'english' | 'auto') => void;

  // theme (moved out of the sidebar into Settings → General, admin 2026-07-16)
  theme: ThemeMode;
  setTheme: (t: ThemeMode) => void;

  // modules
  enabledModules: Record<string, boolean>;
  setEnabledModules: (fn: (prev: Record<string, boolean>) => Record<string, boolean>) => void;
  menuItems: MenuItem[];

  // keys / secrets
  keys: ApiKeys;
  setKeys: (fn: (prev: ApiKeys) => ApiKeys) => void;
  showKeyStates: Record<string, boolean>;
  setShowKeyStates: (fn: (prev: Record<string, boolean>) => Record<string, boolean>) => void;

  // github
  githubToken: string | null;
  setGithubToken: (t: string | null) => void;
  githubUser: any;
  repositories: any[];
  selectedRepo: any;
  setSelectedRepo: (r: any) => void;
  ghSearchQuery: string;
  setGHSearchQuery: (q: string) => void;
  currentBranch: string;
  connectGitHub: () => void;
  disconnectGitHub: () => void;
  fetchGitHubUser: (token: string) => void;
  fetchUserRepos: (token: string) => void;

  // PAT input
  patInputValue: string;
  setPatInputValue: (v: string) => void;

  // E2B key
  userE2bKey: string;
  setUserE2bKey: (v: string) => void;

  // admin / metrics
  isAdmin: boolean;
  adminLiveMetrics: any;
  setAdminLiveMetrics: (m: any) => void;
  loadingAdminMetrics: boolean;
  setLoadingAdminMetrics: (b: boolean) => void;

  // user
  user: FirebaseUser | null;

  // logging
  addLog: (msg: string, type: 'info' | 'error' | 'success' | 'warn') => void;
}

/**
 * Motion preference (Settings → General → Accessibility). Tri-state (P-DESIGN.3): animations ON by
 * default, always Reduced, or Match system (follows the OS `prefers-reduced-motion`). Driven by the
 * accessibility engine (src/lib/a11y.ts), which toggles the `nb-reduce-motion` class on <html>,
 * persists the choice, and keeps the legacy boolean key in sync so main.tsx re-applies it on load.
 */
function MotionModeControl() {
  const [mode, setMode] = React.useState<MotionMode>(() => getStoredMotionMode());
  const apply = (next: MotionMode) => {
    setMode(next);
    applyMotionMode(next);
  };
  const options: { id: MotionMode; label: string; hint: string }[] = [
    { id: 'animated', label: 'On',     hint: 'Animations on (default)' },
    { id: 'reduced',  label: 'Reduced', hint: 'Minimise all motion' },
    { id: 'system',   label: 'System',  hint: 'Follow your OS setting' },
  ];
  return (
    <div className="p-4 sm:p-6 bg-[#0d1117] border border-white/5 rounded-2xl sm:rounded-[1.5rem] shadow-inner">
      <div className="flex items-center gap-4 mb-4">
        <div className="w-10 h-10 bg-indigo-600/10 rounded-xl flex items-center justify-center text-lg">🇮🇳</div>
        <div>
          <div className="text-sm font-bold text-white">Motion</div>
          <div className="text-[11px] text-[#8b949e] mt-0.5 max-w-xs">Animations (like the waving flag) are on by default. Choose Reduced for less motion, or System to follow your device.</div>
        </div>
      </div>
      <div role="radiogroup" aria-label="Motion preference" className="grid grid-cols-3 gap-2">
        {options.map(o => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={mode === o.id}
            title={o.hint}
            onClick={() => apply(o.id)}
            className={`p-3 rounded-xl border font-black text-[10px] uppercase tracking-widest transition-colors ${mode === o.id ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-[#161b22] text-[#8b949e] border-white/5 hover:text-white'}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Touch feedback — the click sound and the vibration (Settings → General Settings).
 *
 * ADMIN REQUEST 2026-08-16: "har touch par click sound ya vibration hota hai — user jab chahe on/off
 * kar sake. default: sound=on, vibration=off."
 *
 * Two independent switches, not one three-way choice, because they are genuinely independent: a user
 * on a train may want silence AND a buzz; a user in a meeting may want neither. Forcing "one or the
 * other" would make a real combination unreachable.
 *
 * The change takes effect on the VERY NEXT TAP — `installTapHaptics` reads the preference per tap
 * rather than at boot — so this control can never become a switch that does nothing until restart.
 * Self-contained state, same pattern as MotionModeControl above.
 */
function TouchFeedbackControl() {
  const [prefs, setPrefs] = React.useState<TapFeedbackPrefs>(() => readTapFeedbackPrefs());
  const set = (patch: Partial<TapFeedbackPrefs>) => setPrefs(writeTapFeedbackPrefs({ ...prefs, ...patch }));
  const rows: { key: keyof TapFeedbackPrefs; icon: string; label: string; hint: string }[] = [
    { key: 'sound', icon: '🔊', label: 'Click sound', hint: 'A soft tick when you tap. Follows your phone\'s silent mode.' },
    { key: 'vibration', icon: '📳', label: 'Vibration', hint: 'A short buzz when you tap. Off by default — it can feel heavy on some phones.' },
  ];
  return (
    <div className="p-4 sm:p-6 bg-[#0d1117] border border-white/5 rounded-2xl sm:rounded-[1.5rem] shadow-inner">
      <div className="flex items-center gap-4 mb-4">
        <div className="w-10 h-10 bg-indigo-600/10 rounded-xl flex items-center justify-center text-lg">👆</div>
        <div>
          <div className="text-sm font-bold text-white">Touch feedback</div>
          <div className="text-[11px] text-[#8b949e] mt-0.5 max-w-xs">What the app does when you tap something. Changes apply straight away.</div>
        </div>
      </div>
      <div className="space-y-2">
        {rows.map((r) => (
          <button
            key={r.key}
            type="button"
            role="switch"
            aria-checked={prefs[r.key]}
            aria-label={r.label}
            onClick={() => set({ [r.key]: !prefs[r.key] } as Partial<TapFeedbackPrefs>)}
            className="w-full flex items-center gap-3 p-3 min-h-[44px] rounded-xl border bg-[#161b22] border-white/5 hover:border-white/20 transition-colors text-left"
          >
            <span className="text-base shrink-0" aria-hidden="true">{r.icon}</span>
            <span className="flex-1 min-w-0">
              <span className="block text-[11px] font-black text-white uppercase tracking-widest">{r.label}</span>
              <span className="block text-[10px] text-[#586069] leading-relaxed mt-0.5">{r.hint}</span>
            </span>
            {/* The switch itself. aria-checked above carries the state for a screen reader, so this
                is decoration — hence aria-hidden, not a second announcement of the same fact. */}
            <span
              aria-hidden="true"
              className={`w-10 h-6 rounded-full shrink-0 p-0.5 transition-colors ${prefs[r.key] ? 'bg-indigo-600' : 'bg-[#30363d]'}`}
            >
              <span className={`block w-5 h-5 rounded-full bg-white transition-transform ${prefs[r.key] ? 'translate-x-4' : ''}`} />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Text-size / zoom control (Settings → General → Accessibility, P-DESIGN.3). Adjusts `--nb-font-scale`
 * on <html> in layout-safe steps within [90%, 140%]; because the UI is rem-based this scales the whole
 * app. Persisted + re-applied on load (main.tsx) via the accessibility engine.
 */
function FontScaleControl() {
  const [scale, setScale] = React.useState<number>(() => getStoredFontScale());
  const set = (next: number) => setScale(applyFontScale(next));
  const pct = Math.round(scale * 100);
  return (
    <div className="p-4 sm:p-6 bg-[#0d1117] border border-white/5 rounded-2xl sm:rounded-[1.5rem] shadow-inner">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-indigo-600/10 rounded-xl flex items-center justify-center text-lg">🔠</div>
          <div>
            <div className="text-sm font-bold text-white">Text Size</div>
            <div className="text-[11px] text-[#8b949e] mt-0.5 max-w-xs">Scale the whole interface for readability. Current: {pct}%.</div>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Decrease text size"
          disabled={scale <= FONT_SCALE_MIN}
          onClick={() => set(scale - FONT_SCALE_STEP)}
          className="w-10 h-10 rounded-xl border border-white/5 bg-[#161b22] text-white text-lg font-black disabled:opacity-30 disabled:cursor-not-allowed hover:border-indigo-500 transition-colors"
        >A−</button>
        <div className="flex-1 text-center text-sm font-black text-white tabular-nums" aria-live="polite">{pct}%</div>
        <button
          type="button"
          aria-label="Increase text size"
          disabled={scale >= FONT_SCALE_MAX}
          onClick={() => set(scale + FONT_SCALE_STEP)}
          className="w-10 h-10 rounded-xl border border-white/5 bg-[#161b22] text-white text-lg font-black disabled:opacity-30 disabled:cursor-not-allowed hover:border-indigo-500 transition-colors"
        >A+</button>
        <button
          type="button"
          onClick={() => set(FONT_SCALE_DEFAULT)}
          className="px-4 h-10 rounded-xl border border-white/5 bg-[#161b22] text-[#8b949e] text-[10px] font-black uppercase tracking-widest hover:text-white transition-colors"
        >Reset</button>
      </div>
    </div>
  );
}

/**
 * "made by NavBharatAI" signature toggle (Settings → General, admin 2026-07-16). When ON (default),
 * every app the user builds carries a small "made by NavBharatAI" badge in the bottom-right corner
 * that links to navbharatai.com — the viral-growth mechanic (a friend clicks it → lands on
 * navbharatai.com → becomes a customer). Persisted to localStorage `navbharat_app_signature`
 * ('off' when disabled); the build request reads it (AgentV3Panel) and the server bakes the badge
 * into the built app's index.html. Self-contained (own state), same pattern as MotionModeControl.
 */
function AppSignatureToggle() {
  const KEY = 'navbharat_app_signature';
  const [enabled, setEnabled] = React.useState<boolean>(() => {
    try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
  });
  const toggle = () => {
    setEnabled((prev) => {
      const next = !prev;
      try { localStorage.setItem(KEY, next ? 'on' : 'off'); } catch { /* ignore */ }
      return next;
    });
  };
  return (
    <div className="flex items-center justify-between p-4 sm:p-6 bg-[#0d1117] border border-white/5 rounded-2xl sm:rounded-[1.5rem] shadow-inner">
      <div className="flex items-center gap-4 min-w-0">
        <div className="w-10 h-10 bg-indigo-600/10 rounded-xl flex items-center justify-center shrink-0">
          <Heart className="w-5 h-5 text-indigo-400" />
        </div>
        <div className="min-w-0">
          <h4 className="text-[11px] font-black text-white uppercase tracking-widest">&ldquo;Made by NavBharatAI&rdquo; Signature</h4>
          <p className="text-[10px] text-[#8b949e] mt-1 leading-relaxed max-w-xs">
            Show a small &ldquo;made by NavBharatAI&rdquo; badge in the bottom-right corner of every app you build. It links to navbharatai.com.
          </p>
        </div>
      </div>
      <button
        role="switch"
        aria-checked={enabled}
        aria-label="Toggle the made-by-NavBharatAI signature on built apps"
        onClick={toggle}
        className={`w-12 h-6 rounded-full p-1 flex items-center transition-all shrink-0 ${enabled ? 'bg-indigo-600 justify-end' : 'bg-black/40 justify-start border border-white/10'}`}
      >
        <div className="w-4 h-4 bg-white rounded-full shadow-lg"></div>
      </button>
    </div>
  );
}

export function SettingsPanel({
  themeClasses,
  settingsScreen,
  setSettingsScreen,
  toggleTab,
  setActiveView,
  onCloseSettings,
  generatedCode,
  deviceMode,
  setDeviceMode,
  preferredLanguage,
  setPreferredLanguage,
  theme,
  setTheme,
  enabledModules,
  setEnabledModules,
  menuItems,
  keys,
  setKeys,
  showKeyStates,
  setShowKeyStates,
  githubToken,
  setGithubToken,
  githubUser,
  repositories,
  selectedRepo,
  setSelectedRepo,
  ghSearchQuery,
  setGHSearchQuery,
  currentBranch,
  connectGitHub,
  disconnectGitHub,
  fetchGitHubUser,
  fetchUserRepos,
  patInputValue,
  setPatInputValue,
  userE2bKey,
  setUserE2bKey,
  isAdmin,
  adminLiveMetrics,
  setAdminLiveMetrics,
  loadingAdminMetrics,
  setLoadingAdminMetrics,
  user,
  addLog,
}: SettingsPanelProps) {
  return (
    <div className={cn("flex-1 flex flex-col h-full overflow-y-auto custom-scrollbar modal-scroll-lock animate-in fade-in zoom-in duration-300", themeClasses.bg)}>
      {/* Settings Header */}
      <div className={cn("h-14 border-b flex items-center px-4 gap-4 sticky top-0 z-20 select-none", themeClasses.card, themeClasses.border)}>
        {settingsScreen !== 'root' && (
          <button
            onClick={() => setSettingsScreen('root')}
            aria-label="Back to Settings"
            className="p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center hover:bg-white/5 active:bg-white/10 rounded-xl text-[#8b949e] hover:text-white transition-all border border-white/5"
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
          onClick={onCloseSettings}
          aria-label="Close Settings"
          className="ml-auto p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center hover:bg-white/5 active:bg-white/10 rounded-xl text-[#8b949e] transition-all"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Settings Content Area.
          The ROOT screen widens on desktop (lg+) and flows its section cards into a multi-column
          masonry grid (see the root motion.div) so a wide screen no longer shows the narrow,
          stretched-mobile column. Sub-screens (General, Connections, …) are designed for a single
          reading column, so they stay capped at max-w-xl. */}
      <div className="flex-1 overflow-y-auto custom-scrollbar bg-[#0d1117]">
        <div className={cn("mx-auto p-4 sm:p-6 pb-20", settingsScreen === 'root' ? "max-w-xl lg:max-w-5xl xl:max-w-6xl" : "max-w-xl")}>
          <AnimatePresence mode="wait">
            {settingsScreen === 'root' && (
              <motion.div
                key="root"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                /* Mobile: a single stacked column (space-y-4). Desktop (lg+): the section cards flow
                   into a 2-column (lg) / 3-column (xl) masonry so the wide screen is filled attractively
                   instead of showing one narrow mobile-style list. break-inside-avoid keeps each card whole. */
                className="space-y-4 lg:space-y-0 lg:columns-2 xl:columns-3 lg:gap-4 [&>*]:break-inside-avoid lg:[&>*]:mb-4"
              >
                {/* G2: User profile card */}
                {user && (
                  <div className="bg-[#161b22] border border-white/5 rounded-2xl p-4 flex items-center gap-3">
                    <div className="w-11 h-11 rounded-full overflow-hidden shrink-0 bg-indigo-600 flex items-center justify-center border border-white/10">
                      {user.photoURL ? (
                        <img src={user.photoURL} alt={user.displayName || 'User'} className="w-full h-full object-cover" referrerPolicy="no-referrer" loading="lazy" />
                      ) : (
                        <span className="text-white font-black text-sm">{(user.displayName || user.email || 'U').charAt(0).toUpperCase()}</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-black text-white truncate">{user.displayName || 'User'}</p>
                      <p className="text-[9px] text-[#484f58] truncate font-mono">{user.email}</p>
                    </div>
                  </div>
                )}

                {/* View Mode MOVED into Settings → General Settings (admin 2026-08-14). It used to
                    float here as a loose card belonging to no group, which is why it was hard to
                    find: it is a preference about how NavBharatAI looks, so it belongs beside Theme
                    and Font size rather than above the group list. */}
                {/* Grouped settings sections.
                    "App Settings" holds EVERYTHING a real, working website needs, in ONE place
                    (admin 2026-07-29): Domain (+ DNS + SSL), Hosting & Deploy (Multi-Cloud — the single
                    publish surface), Database, Authentication, Storage, Secrets & API Keys, plus the
                    developer tools General, Terminal and Logs. Frontend + Backend CODE is built for the
                    user by NavBharatAI Pro, so they are not settings — see the honest note below. */}
                {[
                  {
                    title: 'Account',
                    color: 'text-indigo-400',
                    icon: User as any,
                    desc: '',
                    items: [
                      // Opens the SAME real profile page as the top-right avatar → Profile (view
                      // 'my_profile'). It used to point at a non-existent 'profile' view → blank page.
                      { id: 'my_profile', label: 'My Profile', icon: User as any, nav: true },
                    ],
                  },
                  {
                    // GET MY APP AS AN ANDROID FILE (admin 2026-08-04). The APK Builder already lived in
                    // Other AI → Publish & Deploy, but a user who has just built an app is looking for it
                    // HERE — in the "More" tab of the app they are standing in — not two screens away in a
                    // tool directory. `tab: true` routes through the SAME toggleTab('apk') destination the
                    // Other AI tile uses, so there is one APK Builder and no second copy to drift.
                    title: 'Your App',
                    color: 'text-green-400',
                    icon: Smartphone as any,
                    desc: 'Turn the app you built into a real Android file you can install',
                    items: [
                      { id: 'apk', label: 'Download APK', icon: Smartphone as any, tab: true },
                    ],
                  },
                  {
                    // GENERAL SETTINGS — its own group (admin 2026-08-14). "General" used to be a single
                    // tile INSIDE App Settings, which put two unrelated things in one box: App Settings
                    // is about the app the USER BUILT (its domain, its database, its hosting), while
                    // theme, view mode, font size and chat language are about how NAVBHARATAI ITSELF
                    // looks and behaves. Above App Settings because it is reached far more often.
                    title: 'General Settings',
                    color: 'text-indigo-400',
                    icon: LayoutDashboard,
                    desc: 'How NavBharatAI looks and behaves — view mode, theme, text size, language',
                    items: [
                      // ⚠️ The id stays 'general'. It is a SCREEN id, not just a tile id, and other
                      // surfaces (and the knowledge base) navigate to it by name — renaming it would
                      // open a blank page from every one of them. The doorway moved; the room did not.
                      { id: 'general', label: 'General', icon: LayoutDashboard },
                    ],
                  },
                  {
                    title: 'App Settings',
                    color: 'text-blue-400',
                    icon: Settings,
                    desc: 'Everything your BUILT APP needs — website, data & tools',
                    items: [
                      // The real-website essentials, in one hub. Domain covers DNS + SSL (auto). Database
                      // also provides login + storage when you connect Firebase/Supabase; the dedicated
                      // Authentication (Clerk/Auth0) + Storage (S3/Cloudinary) tiles cover standalone providers.
                      { id: 'domain', label: 'Domain', icon: Globe },
                      { id: 'database', label: 'Database', icon: Database },
                      { id: 'auth', label: 'Authentication', icon: ShieldCheck },
                      { id: 'storage', label: 'Storage', icon: HardDrive },
                      { id: 'secrets', label: 'Secrets & API Keys', icon: Lock },
                      // Developer tools stay right here in App Settings (admin 2026-07-29:
                      // "app settings me se terminal aur logs ko hatana mat"). TERMINAL was later
                      // REMOVED from that pair (admin 2026-08-11, "ide ke andar already hai") — it
                      // mounted the very same TerminalPanel on the very same workspace as Code Studio,
                      // so it was a second doorway to one room, exactly like the 'database' tile that
                      // was removed from Home for making users think there were two databases. LOGS
                      // stays: the 2026-07-29 instruction still holds for it, and it has no IDE twin.
                      // 🔒 GIT & DEPLOYMENT — RESCUED FROM A DEAD SCREEN (found 2026-08-14 while
                      // regrouping). Its only button lived inside the `modules` screen, and NOTHING in
                      // the entire app ever set settingsScreen to 'modules' — so the screen could not
                      // be opened, and since Git had already been taken off the sidebar (2026-08-01,
                      // "moved into Settings"), the whole DevOps surface — GitHub connect, commit/push,
                      // ZIP export, deploy — was unreachable by any route. Meanwhile the knowledge base
                      // confidently told users where to find it. `tab: true` routes through the SAME
                      // toggleTab('git') the dead button used, so this is the one real surface, now with
                      // a doorway. It belongs in App Settings: Git is about the app the user BUILT.
                      { id: 'git', label: 'Git & Deployment', icon: GitBranch as any, tab: true },
                      // 'General' MOVED OUT to its own "General Settings" group above (admin
                      // 2026-08-14) — it was never an app setting.
                      { id: 'logs', label: 'Logs', icon: Activity },
                    ],
                  },
                  {
                    // Legal & Trust (admin 2026-08-08): every document a user, an enterprise reviewer
                    // or Play Store needs, one tap from Settings. The tiles are DRIVEN by the legal
                    // registry, so a new document there appears here with no edit.
                    title: 'Legal & Trust',
                    color: 'text-amber-400',
                    icon: Scale as any,
                    desc: 'Privacy, terms, data processing, security and our NDA template',
                    items: LEGAL_META.map((d) => ({ id: d.id, label: d.title.replace(' (DPA)', '').replace('Security at NavBharatAI', 'Security Documents').replace(' (NDA)', ''), icon: FileText as any })),
                  },
                  // The 5 builder-tool groups (AI Tools, Developer Tools, Design & Build, Publish &
                  // Deploy, Monetization & Team) were MOVED to the home page's "Other AI" card
                  // (admin 2026-07-23) — see src/components/home/homeToolGroups.ts. Settings now keeps
                  // only genuine settings (Account & Profile, App Settings). The tool destinations
                  // (toggleTab ids) are unchanged; only the doorway moved.
                ].map(group => (
                  <div key={group.title} className="bg-[#161b22] border border-white/5 rounded-2xl p-4">
                    <div className={cn('flex items-center gap-2', group.desc ? 'mb-1' : 'mb-3')}>
                      <group.icon className={`w-3.5 h-3.5 ${group.color}`} />
                      <span className={`text-[10px] font-black uppercase tracking-widest ${group.color}`}>{group.title}</span>
                    </div>
                    {group.desc && (
                      <p className="text-[10px] text-[#586069] font-bold mb-3 leading-relaxed">{group.desc}</p>
                    )}
                    {/* Mobile-friendly tiles (admin 2026-07-21): a comfortable ≥52px tap target, labels
                        WRAP instead of truncating (so "Insights & Webhooks"/"Screenshot→Code" read fully on
                        a phone), and the icon is visible at rest (no hover on touch). 2 columns fit a phone
                        fine because each group is small. */}
                    <div className="grid grid-cols-2 gap-2.5">
                      {group.items.map(item => (
                        <button
                          key={item.id}
                          onClick={() => {
                            if ((item as any).tab) { toggleTab(item.id as any); }
                            else if ((item as any).nav) { setActiveView(item.id as any); }
                            else { setSettingsScreen(item.id as any); }
                          }}
                          className="flex items-center gap-2 p-3 min-h-[52px] bg-[#0d1117] border border-white/5 rounded-xl hover:border-indigo-500/30 hover:bg-indigo-600/10 active:bg-indigo-600/20 transition-all group text-left"
                        >
                          <item.icon className="w-4 h-4 text-[#8b949e] group-hover:text-indigo-400 transition-colors flex-shrink-0" />
                          <span className="text-[11px] font-bold text-[#8b949e] group-hover:text-white transition-colors leading-tight">{item.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}

                {/* Honest note (admin 2026-07-29): of the 10 things a real website needs, the FRONTEND
                    (the UI code) and the BACKEND (the API/server code) are not settings you configure —
                    NavBharatAI Pro builds them for you. So they get an honest info line here, not a fake
                    tile that does nothing (real-features rule). */}
                {/* HOSTING — an honest info line, not a tile (the same rule as Frontend & Backend below).
                    The "Hosting & Deploy" tile was REMOVED on 2026-08-20: it duplicated the v5.0 Publish
                    sheet, could not see a v5.0 app at all, and had published a placeholder to a real URL
                    as a success. But the REASSURANCE it carried — "your app is already hosted" — was the
                    genuinely useful part of that screen, and a user opening App Settings looking for
                    hosting deserves an answer here rather than silence. So the answer stays; only the
                    broken second doorway is gone. */}
                <div className="bg-[#161b22] border border-white/5 rounded-2xl p-4 flex items-start gap-3">
                  <div className="p-2 bg-emerald-600/10 rounded-lg shrink-0">
                    <Globe className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-[11px] font-bold text-white leading-relaxed">Hosting — your app is already hosted</p>
                    <p className="text-[10px] text-[#586069] font-bold mt-0.5 leading-relaxed">
                      Every app you build gets a live HTTPS link the moment it builds — no server to set up.
                      To publish a permanent version, or to deploy to your own Vercel / Netlify / Cloudflare
                      account, use the <span className="text-[#8b949e]">Publish</span> button inside NavBharatAI
                      Pro v5.0. For your own domain, use the <span className="text-[#8b949e]">Domain</span> tile above.
                    </p>
                  </div>
                </div>

                <div className="bg-[#161b22] border border-white/5 rounded-2xl p-4 flex items-start gap-3">
                  <div className="p-2 bg-indigo-600/10 rounded-lg shrink-0">
                    <Sparkles className="w-4 h-4 text-indigo-400" />
                  </div>
                  <div>
                    <p className="text-[11px] font-bold text-white leading-relaxed">Frontend &amp; Backend — built for you</p>
                    <p className="text-[10px] text-[#586069] font-bold mt-0.5 leading-relaxed">
                      Your app&apos;s screens (frontend) and its server/API (backend) are written automatically by
                      NavBharatAI Pro when you build. There&apos;s nothing to configure here — just describe your app.
                    </p>
                  </div>
                </div>

                {/* Support — direct email to the NavBharatAI team. An <a href="mailto:"> anchor is used
                    (not a JS handler) because Capacitor's native WebView opens the device mail app for
                    mailto: link clicks, and browsers open the default mail client — one line, works on
                    web + Android + iOS with no plugin. */}
                <a
                  href="mailto:info@navbharatai.com?subject=NavBharatAI%20Support%20Request"
                  className="w-full flex items-center gap-3 p-3 bg-[#161b22] border border-white/5 rounded-xl hover:border-indigo-500/20 transition-all group"
                >
                  <Mail className="w-4 h-4 text-[#484f58] group-hover:text-indigo-400 transition-colors flex-shrink-0" />
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs font-bold text-[#8b949e] group-hover:text-white transition-colors">Support &amp; Help</span>
                    <span className="text-[9px] text-[#484f58] truncate">Email us at info@navbharatai.com</span>
                  </div>
                </a>

                {/* Admin + Footer */}
                {isAdmin && (
                  <button
                    onClick={() => setSettingsScreen('metrics' as any)}
                    className="w-full flex items-center gap-3 p-3 bg-[#161b22] border border-white/5 rounded-xl hover:border-indigo-500/20 transition-all group"
                  >
                    <BarChart2 className="w-4 h-4 text-[#484f58] group-hover:text-indigo-400 transition-colors" />
                    <span className="text-xs font-bold text-[#8b949e] group-hover:text-white transition-colors">Live Metrics</span>
                  </button>
                )}
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

            {settingsScreen.startsWith('legal_') && (
              <LegalDocPage docId={settingsScreen} />
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
                   <h2 className="text-2xl font-black text-white tracking-tight">General Settings</h2>
                   {/* Was "Application Identity & Preferences" — the identity half (app name and
                       description) was a dead field and has been removed, so the subtitle now
                       describes what this screen actually does. */}
                   <p className="text-[11px] text-[#484f58] font-bold uppercase tracking-[0.2em] mt-1">How NavBharatAI looks &amp; behaves</p>
                </div>

                <div className="bg-[#161b22] border border-white/5 rounded-3xl sm:rounded-[2.5rem] p-4 sm:p-8 shadow-2xl space-y-6 sm:space-y-8">
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
                {/* View Mode — the FIRST control in General Settings. It decides the whole layout, so a
                          user who came here to change how the app looks is looking for exactly this. */}
                     <div className="bg-[#161b22] border border-white/5 rounded-2xl p-4">
                       <div className="flex items-center gap-3 mb-3">
                         <Monitor className="w-4 h-4 text-indigo-400" />
                         <h4 className="text-xs font-bold text-white uppercase tracking-widest">View Mode</h4>
                       </div>
                       <div className="grid grid-cols-2 gap-2">
                         {[
                           { id: 'auto', label: '🖥️ Auto' },
                           { id: 'mobile', label: '📱 Mobile' },
                           { id: 'tablet', label: '📟 Tablet' },
                           { id: 'desktop', label: '💻 Desktop' },
                         ].map(m => (
                           <button key={m.id} onClick={() => setDeviceMode(m.id as any)}
                             className={`py-2.5 min-h-[44px] rounded-xl text-xs font-bold transition-all border ${deviceMode === m.id ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-[#0d1117] border-white/5 text-[#8b949e] hover:border-white/20 active:bg-white/5'}`}>
                             {m.label}
                           </button>
                         ))}
                       </div>
                       <p className="text-[10px] text-[#586069] mt-2 leading-relaxed">
                         Auto follows your screen size. Mobile shows the compact layout (menu + bottom bar); Tablet & Desktop show the side rail.
                       </p>
                     </div>

                     {/* Theme — moved here from the sidebar (admin 2026-07-16). Lives in Settings →
                         General so it is reachable and working in ALL view modes (mobile, tablet,
                         desktop), not only the sidebar rail/drawer. Drives the same setTheme as before. */}
                     <div className="space-y-3">
                        <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-2 block pl-1">Theme</label>
                        <div className="grid grid-cols-2 gap-2">
                          {THEME_MODES.map((t) => {
                            const isSelected = theme === t.value;
                            return (
                              <button
                                key={t.value}
                                onClick={() => setTheme(t.value)}
                                className={cn(
                                  "flex items-center gap-2 px-4 py-3 rounded-xl text-left text-[11px] font-black uppercase tracking-wider transition-all border",
                                  isSelected
                                    ? "bg-indigo-600 border-indigo-500 text-white shadow-md shadow-indigo-600/10"
                                    : "bg-[#0d1117] border-white/5 text-[#8b949e] hover:bg-white/5 hover:text-white"
                                )}
                              >
                                <div className={cn(
                                  "w-3 h-3 rounded-full shrink-0 border border-black/20",
                                  t.value === 'light' ? 'bg-white border-gray-400' :
                                  t.value === 'dark' ? 'bg-[#0d1117]' :
                                  t.value === 'dim' ? 'bg-[#15202b]' :
                                  t.value === 'comfort' ? 'bg-[#fdf6e3]' :
                                  'bg-[#ffff00]'
                                )} />
                                {t.label}
                              </button>
                            );
                          })}
                        </div>
                     </div>

                     <div className="space-y-3 pt-6 border-t border-white/10">
                        <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-2 block pl-1">Accessibility</label>
                        <MotionModeControl />
                        <FontScaleControl />
                        {/* Touch feedback sits under Accessibility deliberately: for a user who finds
                            the tick or the buzz distracting, this IS an accessibility control. */}
                        <TouchFeedbackControl />
                     </div>

                     {/* The "Description" textarea was REMOVED here (admin 2026-08-14). It was
                         uncontrolled (`defaultValue`, no onChange, no save) and nothing anywhere read
                         it — a user could type into it and every word was discarded on navigation,
                         while the box looked like a setting they had configured. */}
                     {/* "Developer Mode" was REMOVED here (admin 2026-08-14). It was a toggle with no onClick,
                         no state and a hardcoded ON appearance — it advertised "advanced debug tools"
                         and did nothing at all. A control that cannot be switched is not a setting;
                         per rule 2 there are only two valid states, working or not built. */}

                                          {/* "Made by NavBharatAI" signature toggle — badge on every built app (admin 2026-07-16). */}
                     <AppSignatureToggle />

                     <div className="p-4 sm:p-6 bg-[#0d1117] border border-white/5 rounded-2xl sm:rounded-[1.5rem] shadow-inner space-y-3">
                       <div className="flex items-center gap-3 mb-2">
                         <div className="w-10 h-10 shrink-0 bg-amber-500/10 rounded-xl flex items-center justify-center">
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
                               className={`px-3 py-2.5 min-h-[44px] rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border ${isActive ? 'bg-amber-500/20 border-amber-500/50 text-amber-300' : 'bg-white/5 border-white/10 text-[#8b949e] hover:border-amber-500/30 active:bg-white/10'}`}
                             >
                               {labels[lang]}
                             </button>
                           );
                         })}
                       </div>
                       <p className="text-[9px] text-[#484f58]">Code is always generated in English regardless of this setting.</p>
                     </div>
                  </div>

                  {/* G15: Copy user/session ID for support */}
                  {user && (
                    <div className="p-4 bg-[#0d1117] border border-white/5 rounded-2xl space-y-2">
                      <p className="text-[9px] font-black text-[#484f58] uppercase tracking-widest">Support ID</p>
                      <div className="flex items-center gap-2">
                        <span className="flex-1 text-[10px] font-mono text-[#484f58] truncate">{user.uid}</span>
                        <button
                          onClick={() => { navigator.clipboard.writeText(user.uid).catch(() => {}); }}
                          className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[#484f58] hover:text-white transition-colors"
                          title="Copy user ID"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  )}

                  {/* G19: Session count */}
                  <div className="p-4 bg-[#0d1117] border border-white/5 rounded-2xl space-y-2">
                    <p className="text-[9px] font-black text-[#484f58] uppercase tracking-widest">Session Stats</p>
                    <div className="flex items-center gap-3">
                      <div className="flex flex-col">
                        <span className="text-[18px] font-black text-white leading-none">
                          {(() => { try { return JSON.parse(localStorage.getItem('navbharat_sessions') || '[]').length; } catch { return 0; } })()}
                        </span>
                        <span className="text-[8px] text-[#484f58] font-bold uppercase tracking-widest">Total Sessions</span>
                      </div>
                    </div>
                  </div>

                  {/* G4: Reset all editor settings */}
                  <button
                    onClick={() => {
                      ['ide_wordWrap','ide_minimap','ide_fontSize','ide_tabSize','ide_formatOnSave','ide_trimWhitespace','ide_finalNewline'].forEach(k => localStorage.removeItem(k));
                      window.location.reload();
                    }}
                    className="w-full py-3 bg-transparent border border-white/10 hover:border-red-500/30 hover:text-red-400 text-[#484f58] rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                  >
                    Reset Editor Settings to Default
                  </button>

                  <button className="w-full py-5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-[1.5rem] text-xs font-black uppercase tracking-[0.2em] shadow-2xl shadow-indigo-600/30 active:scale-[0.98] transition-all">
                     Update Preferences
                  </button>
                </div>
              </motion.div>
            )}

            {/* The `modules` screen was REMOVED here (2026-08-14). NOTHING in the app ever set
                settingsScreen to 'modules', so it could not be opened — and it was the only home of
                the Git & Deployment button, which is why that whole surface was unreachable. Git now
                has a real tile in App Settings; the rest of this screen was a static "Brain Engine"
                blurb with no controls, so nothing else was lost. Unreachable UI is how the bug
                happened, so the screen goes rather than staying as a trap for the next reader. */}
            {settingsScreen === 'secrets' && (
              <motion.div
                key="secrets"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                {user ? (
                   <Suspense fallback={null}><SecretManager userId={user.uid} /></Suspense>
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
                  <Suspense fallback={null}><DatabaseSettings userId={user.uid} workspaceId={getAgentV3WorkspaceId(user.uid)} /></Suspense>
                ) : (
                  <div className="p-6 text-white text-center">Please log in to configure your database</div>
                )}
              </motion.div>
            )}

            {/* Authentication (admin 2026-07-29): connect a login/signup provider (Clerk / Auth0 /
                Supabase / Firebase). Credentials are encrypted in Secrets & API Keys; the server's
                userAuthContext tells the builder to wire that exact provider for all login/session.
                Supabase/Firebase auth also comes with the Database connection. */}
            {settingsScreen === 'auth' && (
              <motion.div
                key="auth"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                {user ? (
                  <Suspense fallback={null}><AuthSettings userId={user.uid} /></Suspense>
                ) : (
                  <div className="p-6 text-white text-center">Please log in to connect authentication</div>
                )}
              </motion.div>
            )}

            {/* Storage (admin 2026-07-29): connect a STANDALONE file-storage provider (S3-compatible /
                Cloudinary) for real uploads. Credentials are encrypted in Secrets & API Keys; the server's
                userStorageContext + StorageGenerator wire real direct-to-storage uploads into the built
                app. Firebase/Supabase storage already comes with the Database connection. */}
            {settingsScreen === 'storage' && (
              <motion.div
                key="storage"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                {user ? (
                  <Suspense fallback={null}><StorageSettings userId={user.uid} /></Suspense>
                ) : (
                  <div className="p-6 text-white text-center">Please log in to connect your storage</div>
                )}
              </motion.div>
            )}

            {/* Domain (admin 2026-07-29): the ONE real "connect my website" flow — pick the app you
                built, enter your purchased domain, get the exact DNS records, press Check until Live.
                DNS + SSL are handled inside this flow (SSL auto-provisions once DNS verifies). Same
                real component used by Sidebar → More and Home → Other AI → Custom Domain. */}
            {settingsScreen === 'domain' && (
              <motion.div
                key="domain"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                {user ? (
                  <Suspense fallback={null}>
                    <ConnectMyWebsitePanel onBack={() => setSettingsScreen('root')} uid={user.uid} />
                  </Suspense>
                ) : (
                  <div className="p-6 text-white text-center">Please log in to connect a domain to your app</div>
                )}
              </motion.div>
            )}



            {/* REAL workspace logs (admin 2026-07-20): live build events from the durable v5.0 live
                channel + runtime errors captured from the app's own preview console. Same shared
                workspaceId as Pro v5.0 / Code Studio / Files / Preview, so this screen always shows
                the app the user is actually building. Honest empty states — nothing simulated. */}
            {settingsScreen === 'logs' && (
              <motion.div
                key="logs"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <div className="px-1 pt-4">
                  <h2 className="text-2xl font-black text-white tracking-tight">Logs</h2>
                  <p className="text-[11px] text-[#484f58] font-bold uppercase tracking-[0.2em] mt-1">Live build log &amp; runtime errors of your app</p>
                </div>
                {user ? (
                  <div className="bg-[#161b22] border border-white/10 rounded-2xl overflow-hidden shadow-2xl h-[55vh] sm:h-[62vh] min-h-[300px]">
                    <Suspense fallback={<div className="p-6 text-[10px] font-black uppercase tracking-widest text-[#484f58]">Loading logs…</div>}>
                      <WorkspaceLogs
                        workspaceId={getAgentV3WorkspaceId(user.uid)}
                        userId={user.uid}
                        email={user.email || ''}
                      />
                    </Suspense>
                  </div>
                ) : (
                  <div className="p-6 text-white text-center">Please log in to see your app&apos;s logs</div>
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

                <div className="bg-[#161b22] border border-white/5 rounded-3xl sm:rounded-[2.5rem] p-4 sm:p-8 flex flex-col items-center text-center space-y-8 shadow-2xl relative overflow-hidden group hover:border-indigo-500/30 transition-all">
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

                 {/* G3 — E2B API key: unlocks real cloud VM for Pro builds */}
                 <div className="bg-[#161b22] border border-white/5 rounded-3xl sm:rounded-[2.5rem] p-4 sm:p-8 space-y-5">
                    <div className="flex items-center gap-5">
                       <div className={`w-14 h-14 rounded-2xl flex items-center justify-center border transition-all ${userE2bKey ? 'bg-green-600/10 border-green-500/30' : 'bg-white/5 border-white/5'}`}>
                          <Cpu className={`w-7 h-7 ${userE2bKey ? 'text-green-400' : 'text-[#484f58]'}`} />
                       </div>
                       <div>
                          <h4 className="text-[11px] font-black text-white uppercase tracking-widest">E2B Cloud Execution</h4>
                          <p className="text-[9px] text-[#484f58] font-bold uppercase tracking-[0.2em] mt-1">
                            {userE2bKey ? 'Real cloud VM active — npm, browser, deploy enabled' : 'Optional — unlocks real npm + browser in Pro builds'}
                          </p>
                       </div>
                    </div>
                    <div className="space-y-2">
                       <input
                         type="password"
                         value={userE2bKey}
                         onChange={e => {
                           setUserE2bKey(e.target.value);
                           try { localStorage.setItem('engineer_e2b_key', e.target.value); } catch {}
                         }}
                         placeholder="e2b_sk_…"
                         className="w-full bg-[#0d1117] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-[#484f58] focus:outline-none focus:border-indigo-500/50 font-mono"
                       />
                       <p className="text-[9px] text-[#484f58]">Free tier available at <span className="text-indigo-400">e2b.dev</span>. Without a key, Pro runs in fast in-memory mode.</p>
                    </div>
                 </div>

                 <div className="bg-[#161b22] border border-white/5 rounded-3xl sm:rounded-[2.5rem] p-4 sm:p-8 flex items-center justify-between opacity-50 grayscale pointer-events-none group">
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

                 <div className="bg-[#161b22] border border-white/5 rounded-3xl sm:rounded-[2.5rem] overflow-hidden shadow-2xl">
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
                     className="bg-indigo-600 border border-white/20 rounded-3xl sm:rounded-[2.5rem] p-4 sm:p-8 space-y-6 shadow-3xl relative overflow-hidden"
                   >
                      <div className="absolute top-0 right-0 p-8 opacity-10">
                        <GitBranchIcon className="w-24 h-24 text-white" />
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

                 <div className="bg-[#161b22] border border-white/5 rounded-3xl sm:rounded-[2.5rem] p-4 sm:p-8 space-y-8 shadow-2xl">
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
                       <span className="flex-1 min-w-0 text-[11px] font-mono text-indigo-400 truncate px-3 sm:px-6">navbharat.ai/s/project-592</span>
                       <button className="h-full shrink-0 px-4 sm:px-8 bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest rounded-[1.8rem] transition-all shadow-2xl active:scale-95 group overflow-hidden relative">
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

                <div className="bg-[radial-gradient(circle_at_top_right,#1e1b4b,transparent)] bg-[#161b22] border border-indigo-500/20 rounded-3xl sm:rounded-[3rem] p-5 sm:p-10 space-y-6 sm:space-y-10 text-center relative overflow-hidden group shadow-3xl">
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

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                   <button className="p-4 sm:p-6 bg-[#161b22] border border-white/5 rounded-3xl sm:rounded-[2.5rem] text-left group hover:border-emerald-500/30 transition-all shadow-xl active:scale-95">
                     <div className="w-12 h-12 bg-emerald-500/10 rounded-2xl flex items-center justify-center mb-6 group-hover:bg-emerald-600 transition-colors">
                        <HardDrive className="w-6 h-6 text-emerald-400 group-hover:text-white" />
                     </div>
                     <h4 className="text-[10px] font-black text-white uppercase tracking-widest">ZIP Export</h4>
                     <p className="text-[9px] text-[#484f58] mt-1 font-bold uppercase">Source Files</p>
                   </button>
                   <button className="p-4 sm:p-6 bg-[#161b22] border border-white/5 rounded-3xl sm:rounded-[2.5rem] text-left group hover:border-amber-500/30 transition-all shadow-xl active:scale-95">
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

                 <div className="bg-[#161b22] border border-white/5 rounded-3xl sm:rounded-[2.5rem] p-4 sm:p-8 space-y-8 shadow-2xl">
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

                    <div className="bg-amber-500/5 border border-amber-500/20 p-4 sm:p-6 rounded-2xl sm:rounded-[1.5rem] flex gap-3 sm:gap-4 items-start shadow-inner">
                       <div className="p-2 bg-amber-500/20 rounded-lg">
                          <Zap className="w-4 h-4 text-amber-500" />
                        </div>
                       <p className="text-[10px] text-amber-600 font-bold uppercase leading-relaxed tracking-wider">Multi-user real-time collaboration requires specialized Navbharat Enterprise seat.</p>
                    </div>
                 </div>
              </motion.div>
            )}

            {/* The 'git' sub-screen was removed with its tile (admin 2026-07-20): it only relaunched
                the sidebar's Git panel (setActiveView('git')), a redundant hop. Git lives in the
                sidebar menu — the one real GitViewPanel/GitPanel surface. */}

            {/* G2 — Admin Live Metrics Dashboard */}
            {settingsScreen === 'metrics' && (
              <motion.div
                key="metrics"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
                onViewportEnter={() => {
                  if (!adminLiveMetrics && !loadingAdminMetrics) {
                    setLoadingAdminMetrics(true);
                    const token = localStorage.getItem('admin_token') || '';
                    fetch('/api/admin/metrics', { headers: { Authorization: `Bearer ${token}` } })
                      .then(r => r.json()).then(setAdminLiveMetrics).catch(() => {}).finally(() => setLoadingAdminMetrics(false));
                  }
                }}
              >
                <div className="px-1 py-4">
                  <h2 className="text-2xl font-black text-white tracking-tight">Live Metrics</h2>
                  <p className="text-[11px] text-[#484f58] font-bold uppercase tracking-[0.2em] mt-1">Build stats, AI cost & success rates</p>
                </div>
                {loadingAdminMetrics && (
                  <div className="flex items-center justify-center py-12 text-[#484f58] text-sm">Loading metrics…</div>
                )}
                {adminLiveMetrics && (
                  <div className="space-y-4">
                    {/* Phase 4.3 — active health alerts (error rate / preview rate / latency) */}
                    {Array.isArray(adminLiveMetrics.alerts) && adminLiveMetrics.alerts.length > 0 && (
                      <div className="space-y-2">
                        {adminLiveMetrics.alerts.map((al: any) => (
                          <div
                            key={al.id}
                            className={`rounded-2xl px-5 py-4 border flex items-start gap-3 ${al.severity === 'critical' ? 'bg-red-950/30 border-red-600/40' : 'bg-amber-950/30 border-amber-600/40'}`}
                          >
                            <span className={`text-lg leading-none ${al.severity === 'critical' ? 'text-red-400' : 'text-amber-400'}`}>{al.severity === 'critical' ? '⛔' : '⚠️'}</span>
                            <div>
                              <div className={`text-[10px] font-black uppercase tracking-widest ${al.severity === 'critical' ? 'text-red-400' : 'text-amber-400'}`}>{al.severity} · {al.id}</div>
                              <div className="text-xs text-white mt-0.5">{al.message}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Build Stats */}
                    <div className="bg-[#161b22] border border-white/5 rounded-3xl sm:rounded-[2.5rem] p-4 sm:p-8 space-y-6">
                      <h4 className="text-[11px] font-black text-white uppercase tracking-widest">Build Stats</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                        {[
                          { label: 'Total Builds', value: adminLiveMetrics.builds?.total ?? 0, color: 'text-white' },
                          { label: 'Success Rate', value: `${Math.round((adminLiveMetrics.builds?.successRate ?? 0) * 100)}%`, color: (adminLiveMetrics.builds?.successRate ?? 0) >= 0.8 ? 'text-emerald-400' : 'text-amber-400' },
                          { label: 'Preview Rate', value: `${Math.round((adminLiveMetrics.builds?.previewRate ?? 0) * 100)}%`, color: 'text-indigo-400' },
                          { label: 'Avg Build Time', value: `${Math.round((adminLiveMetrics.builds?.avgMs ?? 0) / 1000)}s`, color: 'text-[#8b949e]' },
                        ].map(({ label, value, color }) => (
                          <div key={label} className="bg-[#0d1117] rounded-2xl p-5 border border-white/5">
                            <div className={`text-2xl font-black ${color}`}>{value}</div>
                            <div className="text-[9px] text-[#484f58] font-bold uppercase tracking-widest mt-1">{label}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                    {/* AI Cost by Provider */}
                    <div className="bg-[#161b22] border border-white/5 rounded-3xl sm:rounded-[2.5rem] p-4 sm:p-8 space-y-4">
                      <div className="flex items-center justify-between">
                        <h4 className="text-[11px] font-black text-white uppercase tracking-widest">AI Cost by Provider</h4>
                        <span className="text-[11px] font-black text-amber-400">${(adminLiveMetrics.totalCostUsd ?? 0).toFixed(4)} total</span>
                      </div>
                      {Object.entries(adminLiveMetrics.tokens || {}).length === 0 && (
                        <p className="text-[10px] text-[#484f58]">No AI calls recorded yet.</p>
                      )}
                      {Object.entries(adminLiveMetrics.tokens || {}).map(([provider, usage]: [string, any]) => (
                        <div key={provider} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                          <div>
                            <div className="text-xs font-bold text-white capitalize">{provider}</div>
                            <div className="text-[9px] text-[#484f58]">{usage.requests} reqs · {(usage.inputTokens + usage.outputTokens).toLocaleString()} tokens</div>
                          </div>
                          <span className="text-[11px] font-black text-amber-400">${(usage.costUsd ?? 0).toFixed(4)}</span>
                        </div>
                      ))}
                    </div>
                    {/* Refresh */}
                    <button
                      onClick={() => {
                        setLoadingAdminMetrics(true);
                        const token = localStorage.getItem('admin_token') || '';
                        fetch('/api/admin/metrics', { headers: { Authorization: `Bearer ${token}` } })
                          .then(r => r.json()).then(setAdminLiveMetrics).catch(() => {}).finally(() => setLoadingAdminMetrics(false));
                      }}
                      className="w-full py-4 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-[1.5rem] font-black uppercase tracking-widest text-xs transition-all flex items-center justify-center gap-2"
                    >
                      <BarChart2 className="w-4 h-4" />
                      Refresh Metrics
                    </button>
                  </div>
                )}
                {!adminLiveMetrics && !loadingAdminMetrics && (
                  <div className="bg-[#161b22] border border-white/5 rounded-3xl sm:rounded-[2.5rem] p-4 sm:p-8 flex flex-col items-center text-center space-y-4">
                    <BarChart2 className="w-10 h-10 text-[#484f58]" />
                    <p className="text-[10px] text-[#484f58]">Admin login required to view metrics.</p>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
