import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Menu, Search, X, RotateCcw, LogOut, Sun, Moon } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { ViewType } from '../../types';
import type { ThemeMode } from '../../lib/theme';
import type { User as FirebaseUser } from 'firebase/auth';
import { signOut } from 'firebase/auth';

interface MenuItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

export interface TopNavProps {
  themeClasses: { card: string; border: string };
  effectiveDeviceMode: string;
  isSidebarCollapsed: boolean;
  setIsSidebarCollapsed: (v: boolean) => void;
  setIsMenuOpen: (v: boolean) => void;
  openTabs: string[];
  activeView: ViewType;
  setActiveView: (view: ViewType) => void;
  toggleTab: (view: ViewType) => void;
  closeTab: (e: React.MouseEvent, tabId: string) => void;
  menuItems: MenuItem[];
  hasGeneratedCode: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undoCode: () => void;
  redoCode: () => void;
  user: FirebaseUser | null;
  setShowAuth: (v: boolean) => void;
  setShowCommandPalette: (v: boolean) => void;
  auth: any;
  /** G1: quick dark/light theme toggle */
  theme?: ThemeMode;
  setTheme?: (t: ThemeMode) => void;
}

export function TopNav({
  themeClasses, effectiveDeviceMode, isSidebarCollapsed, setIsSidebarCollapsed,
  setIsMenuOpen, openTabs, activeView, setActiveView, toggleTab, closeTab,
  menuItems, hasGeneratedCode, canUndo, canRedo, undoCode, redoCode,
  user, setShowAuth, setShowCommandPalette, auth, theme, setTheme,
}: TopNavProps) {
  return (
    <nav className={cn(
      "h-10 border-b flex items-center justify-between px-4 shrink-0 transition-all z-[100] gap-4 select-none w-full",
      themeClasses.card, themeClasses.border
    )}>
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

        {/* Command Palette trigger */}
        <button
          onClick={() => setShowCommandPalette(true)}
          className="hidden md:flex items-center gap-2 h-7 px-3 bg-white/5 hover:bg-white/8 border border-white/5 hover:border-white/15 rounded-lg text-[#484f58] hover:text-white transition-all shrink-0 mr-1"
          title="Command Palette (Ctrl+K)"
        >
          <Search className="w-3 h-3" />
          <span className="text-[10px] text-[#484f58]">Search commands...</span>
          <kbd className="text-[8px] font-black bg-white/5 border border-white/10 px-1 rounded">⌘K</kbd>
        </button>

        {/* Open tabs */}
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
                  onClick={() => setActiveView(tabId as ViewType)}
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
        {/* G1: quick dark/light theme toggle */}
        {setTheme && (
          <button
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            title={theme === 'light' ? 'Switch to Dark mode' : 'Switch to Light mode'}
            className="p-2 hover:bg-white/5 rounded-lg text-[#484f58] hover:text-white transition-all border border-white/5"
          >
            {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
          </button>
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
  );
}
