import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Menu, X, RotateCcw, LogOut, Maximize2, User, Settings, ChevronDown, Shield } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { ViewType } from '../../types';
import type { User as FirebaseUser } from 'firebase/auth';
import { signOut } from 'firebase/auth';
import { performSignOut, defaultClearAuthStorage, deleteFirebaseAuthDb } from '../../lib/signOutFlow';
import { signOutEverywhere } from '../../lib/firebase';
import { NotificationBell } from '../NotificationBell';

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
  auth: any;
  /** Enter Focus Mode — hides the header (this bar) + the mobile bottom nav so only the
   *  open page/panel is visible. A floating corner button (rendered by the app shell,
   *  since this bar disappears) brings the chrome back. */
  onEnterFocusMode?: () => void;
  /** Profile navigation */
  onOpenProfile?: () => void;
  onOpenSettings?: () => void;
  /** True once an admin session is active (a successful /admin login). Gates the "Admin Panel" entry
   *  below so it is visible ONLY to the admin — never advertised to normal users. */
  isAdmin?: boolean;
}

export function TopNav({
  themeClasses, effectiveDeviceMode, isSidebarCollapsed, setIsSidebarCollapsed,
  setIsMenuOpen, openTabs, activeView, setActiveView, toggleTab, closeTab,
  menuItems, hasGeneratedCode, canUndo, canRedo, undoCode, redoCode,
  user, setShowAuth, auth, onEnterFocusMode,
  onOpenProfile, onOpenSettings, isAdmin,
}: TopNavProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    if (dropdownOpen) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [dropdownOpen]);

  const handleLogout = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setDropdownOpen(false);
    if (!confirm('Sign out from NavBharatAI?')) return;
    // Centralized teardown (src/lib/signOutFlow.ts) — deletes Firebase's IndexedDB ONLY when
    // signOut hangs (awaited before reload), so a clean logout never corrupts the next login.
    await performSignOut({
      signOut: () => signOutEverywhere(), // clears the native plugin session too (app), not just the web SDK

      clearStorage: defaultClearAuthStorage,
      deleteAuthDb: () => deleteFirebaseAuthDb(),
      reload: () => window.location.reload(),
    });
  };

  return (
    <nav className={cn(
      "h-10 border-b flex items-center justify-between px-4 shrink-0 transition-all z-[100] gap-4 select-none w-full",
      themeClasses.card, themeClasses.border
    )}>
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {effectiveDeviceMode === 'mobile' && (
          <button
            onClick={() => setIsMenuOpen(true)}
            className="p-2 hover:bg-white/5 rounded-lg text-indigo-400 transition-all shrink-0 border border-white/5"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}

        {effectiveDeviceMode !== 'mobile' && (
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
        {/* Focus Mode — hide the header + mobile bottom nav so only the open page is visible.
            A floating corner button (app shell) brings it back; Esc also exits. */}
        {onEnterFocusMode && (
          <button
            onClick={onEnterFocusMode}
            title="Focus Mode — hide the header (Esc to exit)"
            aria-label="Enter Focus Mode"
            className="p-2 hover:bg-white/5 rounded-lg text-[#484f58] hover:text-white transition-all border border-white/5"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        )}
        {/* Admin → user messages (admin 2026-07-30): renders null when signed out. */}
        <NotificationBell user={user} />
        {!user ? (
          <button
            onClick={() => setShowAuth(true)}
            className="py-2.5 px-5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-lg shadow-indigo-600/20 active:scale-95"
          >
            Login
          </button>
        ) : (
          <div className="relative" ref={dropdownRef}>
            {/* Avatar button */}
            <button
              onClick={() => setDropdownOpen(v => !v)}
              className="flex items-center gap-2 h-9 pl-1 pr-2 bg-white/5 hover:bg-white/8 border border-white/5 hover:border-white/15 rounded-xl transition-all active:scale-95"
              title="My Account"
            >
              {user.photoURL ? (
                <img src={user.photoURL} alt="" className="w-7 h-7 rounded-lg object-cover" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-7 h-7 rounded-lg bg-indigo-600/30 border border-indigo-500/30 flex items-center justify-center">
                  <span className="text-xs font-black text-indigo-400">
                    {(user.displayName || user.email || 'U').charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
              <span className="hidden sm:block text-[11px] font-bold text-white truncate max-w-[72px]">
                {(user.displayName || user.email?.split('@')[0] || 'User')}
              </span>
              <ChevronDown className={`w-3 h-3 text-[#484f58] transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Dropdown */}
            <AnimatePresence>
              {dropdownOpen && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -4 }}
                  transition={{ duration: 0.1 }}
                  className="absolute right-0 top-full mt-1 w-48 bg-[#161b22] border border-white/10 rounded-2xl shadow-2xl overflow-hidden z-50"
                >
                  {/* User info row */}
                  <div className="px-4 py-3 border-b border-white/5">
                    <p className="text-xs font-black text-white truncate">
                      {user.displayName || user.email?.split('@')[0]}
                    </p>
                    <p className="text-[10px] text-[#484f58] truncate">{user.email}</p>
                  </div>
                  {/* Menu items */}
                  <div className="py-1">
                    <button
                      onClick={() => { setDropdownOpen(false); onOpenProfile?.(); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors text-left"
                    >
                      <User className="w-4 h-4 text-indigo-400" />
                      <span className="text-sm font-bold text-white">My Profile</span>
                    </button>
                    <button
                      onClick={() => { setDropdownOpen(false); onOpenSettings?.(); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors text-left"
                    >
                      <Settings className="w-4 h-4 text-[#8b949e]" />
                      <span className="text-sm font-bold text-[#8b949e]">Settings</span>
                    </button>
                    {/* Admin Panel — visible ONLY when an admin session is active (isAdmin). Opens the
                        existing /admin dashboard view. Normal users never see this entry. */}
                    {isAdmin && (
                      <button
                        onClick={() => { setDropdownOpen(false); setActiveView('admin'); }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-amber-500/10 transition-colors text-left group"
                      >
                        <Shield className="w-4 h-4 text-amber-400" />
                        <span className="text-sm font-bold text-amber-400">Admin Panel</span>
                      </button>
                    )}
                  </div>
                  <div className="border-t border-white/5 py-1">
                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-red-500/10 transition-colors text-left group"
                    >
                      <LogOut className="w-4 h-4 text-[#484f58] group-hover:text-red-400 transition-colors" />
                      <span className="text-sm font-bold text-[#484f58] group-hover:text-red-400 transition-colors">Sign Out</span>
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </nav>
  );
}
