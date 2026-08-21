import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Info, Lock, Settings, Heart, X, Globe, Download, Flag } from 'lucide-react';
import { cn } from '../../lib/utils';
import { shouldShowDownloadApp, apkDownloadUrl } from '../../lib/appDownload';
import { TextSizeSlider } from './TextSizeSlider';
import type { ThemeMode } from '../../lib/theme';
import type { ViewType, ChatSession } from '../../types';
import type { User as FirebaseUser } from 'firebase/auth';

interface MenuItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  status?: string;
}

export interface SidebarNavProps {
  themeClasses: {
    bg: string;
    text: string;
    card: string;
    border: string;
  };
  effectiveDeviceMode: string;
  isSidebarCollapsed: boolean;
  isMenuOpen: boolean;
  setIsMenuOpen: (v: boolean) => void;
  menuItems: MenuItem[];
  enabledModules: Record<string, boolean | undefined>;
  activeView: ViewType;
  toggleTab: (view: ViewType) => void;
  setActiveView: (view: ViewType) => void;
  hasGeneratedCode: boolean;
  user: FirebaseUser | null;
  setShowAuth: (v: boolean) => void;
  addLog: (msg: string, level: string) => void;
  theme: ThemeMode;
  setTheme: (t: ThemeMode) => void;
  isThemePickerOpen: boolean;
  setIsThemePickerOpen: (v: boolean) => void;
  setShowVishwakarmaChooser: (v: boolean) => void;
  setErrorContext: (v: any) => void;
  /** Open the app-wide "Report a problem" sheet (the same one a phone shake opens). */
  onReportProblem?: () => void;
  /** Reopen a past chat (routes v5.0 → Pro v5.0, others → their own surface). Unused by this
   *  component (the "Recent Chats" menu block was removed 2026-07-01, admin request) — kept on the
   *  props interface only so App.tsx's existing call site doesn't need touching. */
  sessions?: ChatSession[];
  onResumeSession?: (session: ChatSession) => void;
}

function NavItem({
  item,
  activeView,
  hasGeneratedCode,
  user,
  onClick,
}: {
  item: MenuItem;
  activeView: ViewType;
  hasGeneratedCode: boolean;
  user: FirebaseUser | null;
  onClick: () => void;
}) {
  const isPreview = item.id === 'preview';
  const isLoginGated = (item.id === 'nbi_pro_chat' || item.id === 'sda_chat') && !user;
  const isDisabled = (isPreview || item.id === 'files') && !hasGeneratedCode;
  const isActive = activeView === item.id;

  return (
    <button
      key={item.id}
      disabled={isDisabled}
      title={isLoginGated ? 'Sign in to access this feature' : isDisabled ? 'Generate an app to enable this' : ''}
      onClick={onClick}
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
}

export function SidebarNav({
  themeClasses, effectiveDeviceMode, isSidebarCollapsed,
  isMenuOpen, setIsMenuOpen, menuItems, enabledModules,
  activeView, toggleTab, setActiveView, hasGeneratedCode, user, setShowAuth,
  addLog, theme, setTheme, isThemePickerOpen, setIsThemePickerOpen,
  setShowVishwakarmaChooser, setErrorContext, onReportProblem,
}: SidebarNavProps) {
  // Git lives in App Settings now (admin 2026-08-01: "Git option sidebar se App Settings me move karo"),
  // so it is excluded from the rail/drawer here. It stays in `menuItems` so its header tab + view still
  // open (from Settings → Git & Deployment).
  //
  // Preview / Files / History are also hidden from the sidebar (admin 2026-08-11: "inko need nahi hai, yeh
  // sab AI ke andar already hai") — each already has a doorway INSIDE the relevant AI's footer (Preview:
  // Pro v5.0 + bottom footer; Files: Pro v5.0 footer; History: the per-AI footer). They stay in `menuItems`
  // so their header tab + view still open from those footers — only the redundant sidebar entry is removed.
  const SIDEBAR_HIDDEN = new Set(['git', 'preview', 'files', 'history']);
  const visibleItems = menuItems.filter(item => !SIDEBAR_HIDDEN.has(item.id) && enabledModules[item.id] !== false);

  const makeClickHandler = (item: MenuItem, closeMenu?: boolean) => () => {
    if (item.id === 'preview') { toggleTab('preview'); if (closeMenu) setIsMenuOpen(false); return; }
    if (item.id === 'asc_chat') {
      if (closeMenu) { setShowVishwakarmaChooser(true); setIsMenuOpen(false); }
      else { toggleTab('asc_chat'); }
      return;
    }
    if (item.id === 'history' && !user) {
      setShowAuth(true);
      if (closeMenu) setIsMenuOpen(false);
      addLog('Chat history requires an active session. Please login.', 'warn');
      return;
    }
    toggleTab(item.id as ViewType);
    if (closeMenu) setIsMenuOpen(false);
  };

  return (
    <>
      {/* Persistent side rail — Tablet + Desktop (NOT mobile). Its visibility is driven ONLY by the
          chosen view mode (effectiveDeviceMode), never a viewport breakpoint — so forcing Desktop/Tablet
          from Settings → View Mode actually shows the rail on ANY screen size (the old `hidden lg:flex`
          made this inert on phones). */}
      {effectiveDeviceMode !== 'mobile' && (
        <aside data-tour="sidebar" className={cn(
          "bg-[#161b22] border-r border-white/10 flex flex-col h-full shadow-3xl flex-shrink-0 transition-all duration-300 ease-in-out overflow-hidden",
          isSidebarCollapsed ? 'w-0' : (effectiveDeviceMode === 'tablet' ? 'w-60' : 'w-72')
        )}>
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
          <div className="flex-1 overflow-y-auto p-4 space-y-8 custom-scrollbar">
            <div className="space-y-1.5">
              <div className="text-[10px] font-black text-indigo-500 uppercase tracking-widest px-3 mb-4 flex items-center gap-2">
                <div className="w-1 h-3 bg-indigo-500 rounded-full"></div>
                Core Navigation
              </div>
              {visibleItems.map(item => (
                <NavItem
                  key={item.id}
                  item={item}
                  activeView={activeView}
                  hasGeneratedCode={hasGeneratedCode}
                  user={user}
                  onClick={makeClickHandler(item)}
                />
              ))}
            </div>

            {/* Theme picker moved to Settings → General (admin 2026-07-16) — reachable & working in
                all view modes there, so it no longer lives on the sidebar rail or the mobile drawer. */}
          </div>
        </aside>
      )}

      {/* Mobile slide-out navigation drawer */}
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
              className={cn(
                "absolute left-0 top-0 bottom-0 w-[300px] border-r flex flex-col shadow-3xl select-none transition-colors duration-500",
                themeClasses.card, themeClasses.border, themeClasses.text
              )}
            >
              <div className={cn("p-6 border-b flex items-center justify-between", themeClasses.border)}>
                <button
                  onClick={() => { setActiveView('home'); setIsMenuOpen(false); }}
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
                  {visibleItems.map(item => (
                    <NavItem
                      key={item.id}
                      item={item}
                      activeView={activeView}
                      hasGeneratedCode={hasGeneratedCode}
                      user={user}
                      onClick={makeClickHandler(item, true)}
                    />
                  ))}

                  {/* Download app — mobile WEB on navbharatai.com only (never inside the installed app,
                      never on desktop). Downloads the direct APK when VITE_APK_DOWNLOAD_URL is set,
                      else opens the Play listing so it is always a real link. */}
                  {shouldShowDownloadApp() && (
                    <a
                      href={apkDownloadUrl()}
                      onClick={() => setIsMenuOpen(false)}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all group border border-emerald-500/25 bg-emerald-600/10 text-emerald-300 hover:bg-emerald-600/20 hover:text-emerald-200"
                    >
                      <Download className="w-4.5 h-4.5 group-hover:scale-110 transition-transform" />
                      <span className="text-sm font-bold tracking-tight">Download app</span>
                    </a>
                  )}

                  {/* REPORT A PROBLEM (admin 2026-08-21). The same sheet a phone SHAKE opens — and the
                      reason it exists: nobody discovers an invisible gesture, and iOS will not give a
                      page motion access unasked, so shake alone would leave the feature unreachable
                      for the people most likely to need it. */}
                  {onReportProblem && (
                    <button
                      onClick={() => { onReportProblem(); setIsMenuOpen(false); }}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all group border border-white/10 bg-white/[0.03] text-[#8b949e] hover:text-white hover:bg-white/[0.06]"
                    >
                      <Flag className="w-4.5 h-4.5 group-hover:scale-110 transition-transform" />
                      <span className="text-sm font-bold tracking-tight">Report a problem</span>
                    </button>
                  )}

                  {/* Theme picker moved to Settings → General (admin 2026-07-16). */}
                </div>

                <div className="space-y-4 pt-4 border-t border-white/5">
                  <div className="text-[10px] font-black text-emerald-500 uppercase tracking-widest px-3 flex items-center gap-2">
                    <div className="w-1 h-3 bg-emerald-500 rounded-full"></div>
                    System Matrix
                  </div>
                  <div className="px-1 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => { toggleTab('settings'); setIsMenuOpen(false); setErrorContext(null); }}
                        className={`flex flex-col items-center justify-center gap-2 border py-5 rounded-2xl transition-all group shadow-lg ${activeView === 'settings' ? 'bg-indigo-600 border-indigo-500' : 'bg-[#161b22] border-white/10 hover:border-indigo-500/50'}`}
                      >
                        <Settings className="w-6 h-6 text-indigo-400 group-hover:rotate-90 transition-transform duration-500" />
                        <span className={`text-[10px] font-black uppercase tracking-widest ${activeView === 'settings' ? 'text-white' : 'text-[#8b949e]'}`}>Settings</span>
                      </button>
                      <button
                        onClick={() => { toggleTab('donation'); setIsMenuOpen(false); }}
                        className="flex flex-col items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 py-5 rounded-2xl transition-all shadow-xl shadow-indigo-600/30 group"
                      >
                        <Heart className="w-6 h-6 text-white group-hover:scale-110 transition-transform" />
                        <span className="text-[10px] font-black text-white uppercase tracking-widest">Donate</span>
                      </button>
                    </div>

                    {/* Text size — one tap from anywhere (admin 2026-08-08). The user who needs this
                        is already struggling to read the screen; three taps into Settings was
                        backwards. Settings keeps its +/- stepper for precise adjustment. */}
                    <div className="pt-1">
                      <TextSizeSlider />
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5 pt-4 border-t border-white/5">
                  <button
                    onClick={() => { toggleTab('about'); setIsMenuOpen(false); }}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all group ${activeView === 'about' ? 'bg-indigo-600 text-white' : 'text-[#8b949e] hover:bg-white/5 hover:text-white'}`}
                  >
                    <Info className="w-4.5 h-4.5 text-indigo-400" />
                    <span className="text-sm font-bold tracking-tight">About Us</span>
                  </button>
                  <button
                    onClick={() => { toggleTab('connect_domain'); setIsMenuOpen(false); }}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all group ${activeView === 'connect_domain' ? 'bg-indigo-600 text-white' : 'text-[#8b949e] hover:bg-white/5 hover:text-white'}`}
                  >
                    <Globe className="w-4.5 h-4.5 text-indigo-400" />
                    <span className="text-sm font-bold tracking-tight">Connect my website</span>
                  </button>
                  <button
                    onClick={() => { toggleTab('engine_builder'); setIsMenuOpen(false); }}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all group ${activeView === 'engine_builder' ? 'bg-indigo-600 text-white' : 'text-[#8b949e] hover:bg-white/5 hover:text-white'}`}
                  >
                    <Info className="w-4.5 h-4.5 text-indigo-400" />
                    <span className="text-sm font-bold tracking-tight">App Builder v5.0</span>
                  </button>
                  {/* Admin access moved to a dedicated URL (admin 2026-07-15): reach the admin login /
                      dashboard at /admin. It's intentionally NOT a menu item so the entry isn't
                      advertised in the UI. */}
                </div>
              </div>

              <div className="p-6 border-t border-white/5 bg-[#0d1117]">
                <p className="text-[9px] text-[#484f58] text-center font-medium">Navbharat Terminal v2.4.0 • Building Future</p>
              </div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
