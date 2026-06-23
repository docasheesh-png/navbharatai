import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Menu, ChevronLeft, X, LogOut } from 'lucide-react';
import { cn } from '../lib/utils';

export const Header = ({
  effectiveDeviceMode,
  setIsMenuOpen,
  navHistory,
  goBack,
  toggleTab,
  activeView,
  openTabs,
  menuItems,
  setActiveView,
  closeTab,
  user,
  setShowAuth,
  auth,
  signOut,
  themeClasses
}: any) => {
  return (
    <nav className={cn("h-14 border-b flex items-center justify-between px-4 shrink-0 transition-all z-[100] gap-4 select-none w-full", themeClasses.card, themeClasses.border)}>
       <div className="flex items-center gap-3 min-w-0 flex-1">
          {effectiveDeviceMode !== 'desktop' && (
            <button 
              onClick={() => setIsMenuOpen(true)}
              className="p-2 hover:bg-white/5 rounded-lg text-indigo-400 transition-all shrink-0 border border-white/5"
            >
                <Menu className="w-5 h-5" />
            </button>
          )}

        {navHistory.length > 1 && (
          <motion.button 
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            onClick={goBack}
            className="p-2 hover:bg-white/5 rounded-lg text-white/70 hover:text-white transition-all shrink-0 border border-white/5 bg-white/5 flex items-center gap-1 group"
            title="Go Back"
          >
            <ChevronLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
            <span className="text-[10px] font-black uppercase tracking-widest hidden md:block">Back</span>
          </motion.button>
        )}

        <button 
          onClick={() => toggleTab('home')}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity shrink-0 mr-2 !bg-transparent !border-none !shadow-none"
        >
          <img 
            src="/assets/logo.png" 
            alt="logo" 
            className="w-7 h-7 object-contain select-none pointer-events-none !bg-transparent !border-none !shadow-none" 
            referrerPolicy="no-referrer"
          />
        </button>
        
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-2 select-none">
          <AnimatePresence mode="popLayout">
            {openTabs.map((tabId: string) => {
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
                  onClick={() => toggleTab(tabId)}
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
                if (!confirm('Logout from NavBharat?')) return;
                // Logout must ALWAYS work. signOut() can hang when the Firebase auth
                // helper iframe is unavailable, so cap it with a timeout and then
                // forcibly clear the persisted session + reload — the app comes back
                // signed out no matter what.
                try {
                  await Promise.race([
                    signOut(auth).catch(() => {}),
                    new Promise((resolve) => setTimeout(resolve, 2500)),
                  ]);
                } catch { /* ignore — fall through to the hard clear below */ }
                try {
                  for (const k of Object.keys(localStorage)) {
                    if (/^firebase:authUser/i.test(k) || /firebaseLocalStorage/i.test(k)) localStorage.removeItem(k);
                  }
                } catch { /* storage may be unavailable — reload still signs out */ }
                window.location.reload();
              }}
              className="w-10 h-10 bg-white/5 hover:bg-red-500/10 rounded-xl flex items-center justify-center text-[#484f58] hover:text-red-500 transition-all border border-white/5 active:scale-90"
            >
                <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </nav>
  );
};
