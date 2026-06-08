
import React from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, Home, BarChart2, History, Settings, CreditCard, Lock } from 'lucide-react';

export const Sidebar: React.FC<{onLinkClick?: () => void}> = ({ onLinkClick }) => {
  return (
    <aside className="w-72 bg-[#161b22] border-r border-white/10 flex flex-col h-full shadow-3xl flex-shrink-0">
      <div className="p-6 border-b border-white/10 flex items-center justify-between bg-[#0d1117]/30">
        <Link 
          to="/chat"
          onClick={onLinkClick}
          className="flex items-center gap-3 hover:opacity-80 transition-opacity text-left"
        >
          <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
        </Link>
      </div>

      <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
        <Link to="/" onClick={onLinkClick} className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 text-slate-300 transition-all text-xs font-bold uppercase tracking-widest">
          <Home className="w-4 h-4" /> Dashboard
        </Link>
        <Link to="/chat" onClick={onLinkClick} className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 text-slate-300 transition-all text-xs font-bold uppercase tracking-widest">
          <BarChart2 className="w-4 h-4" /> Reports
        </Link>
        <Link to="/ide" onClick={onLinkClick} className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 text-slate-300 transition-all text-xs font-bold uppercase tracking-widest">
          <History className="w-4 h-4" /> IDE
        </Link>
        <Link to="/donate" onClick={onLinkClick} className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 text-slate-300 transition-all text-xs font-bold uppercase tracking-widest">
          <CreditCard className="w-4 h-4" /> Donate
        </Link>
        <Link to="/settings" onClick={onLinkClick} className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 text-slate-300 transition-all text-xs font-bold uppercase tracking-widest">
          <Settings className="w-4 h-4" /> Settings
        </Link>
        <Link to="/admin" onClick={onLinkClick} className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 text-slate-300 transition-all text-xs font-bold uppercase tracking-widest">
          <Lock className="w-4 h-4" /> Admin Login
        </Link>
      </nav>
    </aside>
  );
};
