import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Menu, X, RotateCcw, LogOut, Maximize2, User, Settings, ChevronDown, Shield } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { ViewType } from '../../types';
import type { User as FirebaseUser } from 'firebase/auth';
import { performSignOut, defaultClearAuthStorage, deleteFirebaseAuthDb } from '../../lib/signOutFlow';
import { signOutEverywhere } from '../../lib/firebase';

interface MenuItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

export interface TopNavProps {
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
  /**
   * Open tabs that must NOT be drawn as chips: views that live INSIDE a chat tab because they were
   * entered through its Mode button (admin 2026-09-22: "mode switch karne se header me new window/tab
   * na create ho"). Decided by `lib/headerTab.ts`, never here — the header draws what it is told.
   */
  hiddenTabs?: string[];
  /**
   * The chip to light. Usually `activeView`; while a chat lives inside another tab it is THAT tab, so
   * a user in Teacher AI still sees "NavBharatAI FREE" lit — they are in a mode of it, not elsewhere.
   */
  highlightedTab?: string;
  hasGeneratedCode: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undoCode: () => void;
  redoCode: () => void;
  user: FirebaseUser | null;
  /**
   * Unread notifications — drawn as a DOT on the ☰ button (admin 2026-09-22: *"agar notification aaye
   * to 3-line menu button par dot dikhe"*). The bell itself left this bar to leave the row to the open
   * tabs. The number lives on the sidebar's Notifications row; here only the fact.
   */
  unreadNotifications?: number;
  /**
   * The balance is finished, so the ☰ button carries the SAME dot (admin 2026-09-22) — the first step
   * of the trail that ends on the Purchase button. It is a second REASON for one dot, never a second
   * dot: two marks on one button would be two problems where the user has one.
   */
  walletNeedsTopUp?: boolean;
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
  effectiveDeviceMode, isSidebarCollapsed, setIsSidebarCollapsed,
  setIsMenuOpen, openTabs, activeView, setActiveView, toggleTab, closeTab,
  menuItems, hasGeneratedCode, canUndo, canRedo, undoCode, redoCode,
  user, setShowAuth, auth, onEnterFocusMode,
  onOpenProfile, onOpenSettings, isAdmin, unreadNotifications = 0, walletNeedsTopUp = false,
  hiddenTabs = [], highlightedTab,
}: TopNavProps) {
  const hidden = new Set(hiddenTabs);
  const lit = highlightedTab ?? activeView;
  /** The one dot both ☰ buttons draw — a fact, never a number; the number is in the sidebar.
   *  Two reasons can raise it (an unread notification, a finished balance) and it stays ONE dot. */
  const menuNeedsAttention = unreadNotifications > 0 || walletNeedsTopUp;
  const menuDot = menuNeedsAttention ? (
    <span aria-hidden className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-danger ring-2 ring-card" />
  ) : null;
  // The label must say WHICH, or a screen-reader user is told there is something and not what. When
  // both are true the balance is named first: it is the one that stops the app working.
  const menuLabel = walletNeedsTopUp
    ? (unreadNotifications > 0
      ? `Menu, balance finished, ${unreadNotifications} unread notifications`
      : 'Menu, balance finished — add credit')
    : unreadNotifications > 0 ? `Menu, ${unreadNotifications} unread notifications` : 'Menu';
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  // ONE ACCOUNT AT A TIME (admin 2026-09-19). The avatar menu used to carry a "Switch account" list
  // of every account this device had seen, plus "Add another account". It is GONE — see
  // `tests/oneAccountAtATime.test.ts` for the reasoning, in one line: the Firebase SDK holds a single
  // live session, so every switch re-authenticated, and a switcher that makes you sign in again is
  // not a switcher. Signing out and signing in is the same number of taps and tells the truth.

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
      // THE ROW BELONGS TO THE WINDOWS (admin 2026-09-22: "header me tab/window dikh nahi rahi hai, jyada
      // jagah banao"). Gaps are tight, the bell is gone, and the strip below is `flex-1 min-w-0` so it
      // takes every pixel the fixed controls leave — and scrolls inside that width instead of pushing
      // the controls off the edge.
      "h-10 border-b flex items-center justify-between px-2 sm:px-3 shrink-0 transition-all z-[100] gap-2 select-none w-full bg-card border-line"
    )}>
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {effectiveDeviceMode === 'mobile' && (
          <button
            onClick={() => setIsMenuOpen(true)}
            aria-label={menuLabel}
            className="relative p-2 hover:bg-raised rounded-lg text-accent-text transition-all shrink-0 border border-line"
          >
            <Menu className="w-5 h-5" />
            {menuDot}
          </button>
        )}

        {effectiveDeviceMode !== 'mobile' && (
          <button
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            aria-label={menuLabel}
            className="relative p-2 hover:bg-raised rounded-lg text-accent-text transition-all shrink-0 border border-line"
            title={isSidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
          >
            <Menu className="w-5 h-5" />
            {menuDot}
          </button>
        )}

        <button
          onClick={() => toggleTab('home')}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity shrink-0"
        >
          <img
            src="/logo.png"
            alt="navBharatAI"
            className="w-7 h-7 object-contain drop-shadow-md select-none pointer-events-none"
            referrerPolicy="no-referrer"
          />
          <h1 className="text-sm font-bold tracking-tighter text-ink hidden md:block italic">navBharatAI</h1>
        </button>

        {/* Open tabs — every pixel the fixed controls leave, scrolling inside it. */}
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-2 select-none flex-1 min-w-0">
          <AnimatePresence mode="popLayout">
            {openTabs.filter(id => id !== 'home' && !hidden.has(id)).map((tabId) => {
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
                    lit === tabId
                      ? 'bg-indigo-600 border-indigo-500 text-on-accent shadow-lg shadow-indigo-600/20'
                      : 'bg-surface border-line text-muted hover:border-line'
                  }`}
                  onClick={() => setActiveView(tabId as ViewType)}
                >
                  <Icon className={`w-3.5 h-3.5 ${lit === tabId ? 'text-ink' : 'text-accent-text'}`} />
                  <span className="text-[11px] font-bold whitespace-nowrap">{item.label}</span>
                  <button
                    onClick={(e) => closeTab(e, tabId)}
                    className={`p-0.5 rounded-md transition-all ${
                      lit === tabId
                        ? 'hover:bg-raised text-muted hover:text-ink'
                        : 'hover:bg-raised text-faint hover:text-ink'
                    }`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </motion.div>
              );
            })}
            {/* NO PER-CONVERSATION CHIPS (admin 2026-09-22: "mode switch karne se header me new
                window/tab na create ho"). The chips that stood here from 2026-09-21 to 2026-09-22
                moved into the Mode list's Recent group, which is now the window switcher. A view
                entered through a chat tab's Mode button is in `hiddenTabs` and draws nothing here. */}
          </AnimatePresence>
        </div>
      </div>

      {/* Action Controls — Focus Mode sits LAST (admin 2026-09-22: "expand button ko thoda right me
          khiska do"), past the account, at the edge of the bar. */}
      <div className="flex items-center gap-1.5 shrink-0">
        {hasGeneratedCode && (
          <div className="hidden sm:flex items-center gap-1 border border-line rounded-xl overflow-hidden">
            <button
              onClick={undoCode}
              disabled={!canUndo}
              title="Undo (Ctrl+Z)"
              className="p-2 hover:bg-raised text-faint hover:text-ink transition-all disabled:opacity-25 disabled:cursor-not-allowed"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <div className="w-px h-5 bg-raised" />
            <button
              onClick={redoCode}
              disabled={!canRedo}
              title="Redo (Ctrl+Y)"
              className="p-2 hover:bg-raised text-faint hover:text-ink transition-all disabled:opacity-25 disabled:cursor-not-allowed"
            >
              <RotateCcw className="w-3.5 h-3.5 scale-x-[-1]" />
            </button>
          </div>
        )}
        {!user ? (
          <button
            onClick={() => setShowAuth(true)}
            className="py-2 px-3.5 bg-indigo-600 hover:bg-indigo-700 text-on-accent rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-lg shadow-indigo-600/20 active:scale-95"
          >
            Login
          </button>
        ) : (
          <div className="relative" ref={dropdownRef}>
            {/* Avatar button */}
            <button
              onClick={() => setDropdownOpen(v => !v)}
              className="flex items-center gap-2 h-9 pl-1 pr-2 bg-raised hover:bg-raised-hover border border-line hover:border-line rounded-xl transition-all active:scale-95"
              title="My Account"
            >
              {user.photoURL ? (
                <img src={user.photoURL} alt="" className="w-7 h-7 rounded-lg object-cover" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-7 h-7 rounded-lg bg-indigo-600/30 border border-indigo-500/30 flex items-center justify-center">
                  <span className="text-xs font-black text-accent-text">
                    {(user.displayName || user.email || 'U').charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
              <span className="hidden sm:block text-[11px] font-bold text-ink truncate max-w-[72px]">
                {(user.displayName || user.email?.split('@')[0] || 'User')}
              </span>
              <ChevronDown className={`w-3 h-3 text-faint transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Dropdown */}
            <AnimatePresence>
              {dropdownOpen && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -4 }}
                  transition={{ duration: 0.1 }}
                  className="absolute right-0 top-full mt-1 w-48 bg-card border border-line rounded-2xl shadow-2xl overflow-hidden z-50"
                >
                  {/* User info row */}
                  <div className="px-4 py-3 border-b border-line">
                    <p className="text-xs font-black text-ink truncate">
                      {user.displayName || user.email?.split('@')[0]}
                    </p>
                    <p className="text-[10px] text-faint truncate">{user.email}</p>
                  </div>
                  {/* Menu items */}
                  <div className="py-1">
                    <button
                      onClick={() => { setDropdownOpen(false); onOpenProfile?.(); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-raised transition-colors text-left"
                    >
                      <User className="w-4 h-4 text-accent-text" />
                      <span className="text-sm font-bold text-ink">My Profile</span>
                    </button>
                    <button
                      onClick={() => { setDropdownOpen(false); onOpenSettings?.(); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-raised transition-colors text-left"
                    >
                      <Settings className="w-4 h-4 text-muted" />
                      <span className="text-sm font-bold text-muted">Settings</span>
                    </button>
                    {/* Admin Panel — visible ONLY when an admin session is active (isAdmin). Opens the
                        existing /admin dashboard view. Normal users never see this entry. */}
                    {isAdmin && (
                      <button
                        onClick={() => { setDropdownOpen(false); setActiveView('admin'); }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-amber-500/10 transition-colors text-left group"
                      >
                        <Shield className="w-4 h-4 text-warn" />
                        <span className="text-sm font-bold text-warn">Admin Panel</span>
                      </button>
                    )}
                  </div>
                  <div className="border-t border-line py-1">
                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-red-500/10 transition-colors text-left group"
                    >
                      <LogOut className="w-4 h-4 text-faint group-hover:text-danger transition-colors" />
                      <span className="text-sm font-bold text-faint group-hover:text-danger transition-colors">Sign Out</span>
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
        {/* Focus Mode — hide the header + mobile bottom nav so only the open page is visible.
            A floating corner button (app shell) brings it back; Esc also exits. Last in the row, so
            it sits at the bar's right edge, clear of the account menu. */}
        {onEnterFocusMode && (
          <button
            onClick={onEnterFocusMode}
            title="Focus Mode — hide the header (Esc to exit)"
            aria-label="Enter Focus Mode"
            className="p-2 hover:bg-raised rounded-lg text-faint hover:text-ink transition-all border border-line"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        )}
      </div>
    </nav>
  );
}
