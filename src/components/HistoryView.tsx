import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../lib/firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { motion } from 'motion/react';
import { MessageSquare, Clock, ShieldCheck, LogIn, MoreVertical, Trash2, Search, X, Layers, Code2, Zap, Cpu, Stethoscope } from 'lucide-react';
import { cn } from '../lib/utils';
import { Skeleton, SkeletonList } from './ui/Skeleton';

type FilterMode = 'all' | 'chat' | 'apps' | 'free' | 'pro' | 'sda';

// NavBharatAI Pro v5.0 (AgentV3) sessions are saved with agent 'agentv3', tab
// 'engine_builder', and a doc id prefixed 'v3_'. They are Pro-tier builds and
// must be classified as Pro (not Free) so they list under the Pro filter and in
// the app-builder view.
const isV3Session = (session: any) => {
  const a = String(session.agent || session.current_agent || session.currentAgent || session.original_agent || '').toLowerCase();
  const tab = String(session.tab || session.meta?.tab || '').toLowerCase();
  const id = String(session.id || '').toLowerCase();
  return a.includes('agentv3') || tab === 'engine_builder' || id.startsWith('v3_');
};

const isAppSession = (session: any) =>
  (session.files && Object.keys(session.files).length > 0) ||
  (session.mode && (session.mode === 'build' || session.mode === 'app_builder')) ||
  isV3Session(session) ||
  (session.current_agent && (String(session.current_agent).includes('vishwakarma') || String(session.current_agent).includes('pro')));

export const HistoryView = ({
  user,
  onRestoreSession,
  onDeleteSession,
  initialFilter,
  lockFilter,
}: {
  user: any;
  onRestoreSession?: (uci: string) => void;
  onDeleteSession?: (id: string) => void;
  /** Pre-select a filter when History is opened from a scoped entry point (e.g. the
   *  NavBharatAI Free footer opens it filtered to 'free'). The user can still switch. */
  initialFilter?: FilterMode;
  /** When true, LOCK the view to `initialFilter` and hide the type/mode filter tabs entirely — so
   *  "NavBharatAI Free → History" shows ONLY Free sessions and cannot be switched to the whole app
   *  (admin 2026-08-11: "Free ki history sirf Free ki dikhaye, puri NavBharatAI ki nahi"). */
  lockFilter?: boolean;
}) => {
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<FilterMode>(initialFilter ?? 'all');
  const [searchQuery, setSearchQuery] = useState('');

  // Re-apply the scoped filter whenever the caller changes it (e.g. opened from the Free footer).
  // When locked, the filter is fixed to the scoped value and the tabs are not rendered at all.
  useEffect(() => { if (initialFilter) setFilterMode(initialFilter); }, [initialFilter]);
  const effectiveFilter: FilterMode = lockFilter && initialFilter ? initialFilter : filterMode;

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'chat_sessions'),
      where('userId', '==', user.uid)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .sort((a: any, b: any) => {
          const ta = a.lastUpdated ? new Date(a.lastUpdated).getTime() : 0;
          const tb = b.lastUpdated ? new Date(b.lastUpdated).getTime() : 0;
          return tb - ta;
        });
      setSessions(data);
      setLoading(false);
    }, () => {
      try {
        const local = JSON.parse(localStorage.getItem('navbharat_sessions') || '[]');
        setSessions(local.sort((a: any, b: any) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime()));
      } catch { /* empty */ }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [user]);

  const isProSession = (s: any) => {
    const a = String(s.agent || s.current_agent || s.currentAgent || '').toLowerCase();
    return a.includes('pro') || a.includes('vishwakarma') || isV3Session(s);
  };
  const isSdaSession = (s: any) => {
    const a = String(s.agent || s.current_agent || s.currentAgent || '').toLowerCase();
    return a.includes('sda') || a.includes('doctor');
  };
  const isFreeSession = (s: any) => !isProSession(s) && !isSdaSession(s);

  const filteredSessions = useMemo(() => {
    let result = sessions;

    if (effectiveFilter === 'apps') result = result.filter(isAppSession);
    else if (effectiveFilter === 'chat') result = result.filter(s => !isAppSession(s));
    else if (effectiveFilter === 'free') result = result.filter(isFreeSession);
    else if (effectiveFilter === 'pro')  result = result.filter(isProSession);
    else if (effectiveFilter === 'sda')  result = result.filter(isSdaSession);

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(s =>
        (s.title && s.title.toLowerCase().includes(q)) ||
        (s.uci && s.uci.toLowerCase().includes(q)) ||
        (s.id && s.id.toLowerCase().includes(q)) ||
        (s.messages && Array.isArray(s.messages) &&
          s.messages.some((m: any) => m.text && m.text.toLowerCase().includes(q)))
      );
    }

    return result;
  }, [sessions, filterMode, searchQuery]);

  if (loading) {
    return (
      <div className="flex-1 flex flex-col bg-[#0d1117] h-full overflow-hidden p-6">
        <div className="h-8 w-48 mb-5"><Skeleton className="h-full w-full" rounded="rounded-lg" /></div>
        <SkeletonList count={6} />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-[#0d1117] h-full overflow-hidden p-6">
      {/* Header */}
      <h2 className="text-3xl font-black text-white italic tracking-tighter uppercase flex items-center gap-3 mb-5">
        <MessageSquare className="w-8 h-8 text-indigo-500" />
        Session History
      </h2>

      {/* Filter + Search bar. When the view is LOCKED to a scope (e.g. Free → History), the filter tabs
          are hidden entirely so the user only ever sees that scope's sessions — just the search remains. */}
      <div className="flex flex-col gap-2 mb-5">
        {/* Row 1 + 2: type / AI-mode filters — hidden when the caller locked the scope. */}
        {!lockFilter && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 bg-[#161b22] border border-white/8 rounded-xl p-1 shrink-0">
            {([
              { key: 'all',  label: 'All',  icon: <Layers className="w-3 h-3" /> },
              { key: 'chat', label: 'Chat', icon: <MessageSquare className="w-3 h-3" /> },
              { key: 'apps', label: 'Apps', icon: <Code2 className="w-3 h-3" /> },
            ] as { key: FilterMode; label: string; icon: React.ReactNode }[]).map(({ key, label, icon }) => (
              <button
                key={key}
                onClick={() => setFilterMode(key)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                  filterMode === key ? "bg-indigo-600 text-white shadow-md" : "text-[#8b949e] hover:text-white hover:bg-white/5"
                )}
              >
                {icon}{label}
              </button>
            ))}
          </div>

          {/* Row 2: AI mode filters */}
          <div className="flex items-center gap-1 bg-[#161b22] border border-white/8 rounded-xl p-1 shrink-0">
            {([
              { key: 'free', label: 'Free', icon: <Zap className="w-3 h-3" />, color: 'bg-emerald-600' },
              { key: 'pro',  label: 'Pro',  icon: <Cpu className="w-3 h-3" />, color: 'bg-violet-600' },
              { key: 'sda',  label: 'SDA',  icon: <Stethoscope className="w-3 h-3" />, color: 'bg-rose-600' },
            ] as { key: FilterMode; label: string; icon: React.ReactNode; color: string }[]).map(({ key, label, icon, color }) => (
              <button
                key={key}
                onClick={() => setFilterMode(key)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                  filterMode === key ? `${color} text-white shadow-md` : "text-[#8b949e] hover:text-white hover:bg-white/5"
                )}
              >
                {icon}{label}
              </button>
            ))}
          </div>
        </div>
        )}

        {/* Search box */}
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#484f58]" />
          <input
            type="text"
            placeholder="Search by title, CUI, or message..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-[#161b22] border border-white/8 rounded-xl pl-8 pr-8 py-2 text-[11px] text-white placeholder-[#484f58] outline-none focus:border-indigo-500/50 transition-colors font-mono"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#484f58] hover:text-white transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Count indicator */}
      <div className="text-[9px] font-black uppercase tracking-widest text-[#484f58] mb-3">
        {filteredSessions.length} session{filteredSessions.length !== 1 ? 's' : ''}
        {searchQuery ? ` matching "${searchQuery}"` : ''}
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto space-y-4 custom-scrollbar" role="list" aria-label="Session history">
        {filteredSessions.length === 0 ? (
          /* F18: helpful empty state with CTA */
          <div className="flex flex-col items-center justify-center py-20 gap-6">
            <div className="w-20 h-20 bg-indigo-600/10 border border-indigo-600/20 rounded-[2rem] flex items-center justify-center">
              <MessageSquare className="w-10 h-10 text-indigo-400/50" />
            </div>
            <div className="text-center space-y-2">
              <p className="text-sm font-black text-white uppercase tracking-widest">
                {searchQuery ? `No results for "${searchQuery}"` : 'No sessions yet'}
              </p>
              <p className="text-[11px] text-[#484f58] max-w-xs mx-auto leading-relaxed">
                {searchQuery
                  ? 'Try a different search term or clear the filter.'
                  : 'Start a conversation in the Pro Chat or ask the AI to build an app — your sessions will appear here.'}
              </p>
            </div>
            {!searchQuery && (
              <button
                onClick={() => onRestoreSession?.('new')}
                className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-lg"
              >
                Start a New Chat
              </button>
            )}
          </div>
        ) : (
          filteredSessions.map((session) => {
            const isConfirming = confirmDeleteId === session.id;
            const sessionIsApp = isAppSession(session);
            return (
              <motion.div
                key={session.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className={cn(
                  "border rounded-2xl p-6 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative",
                  isConfirming
                    ? "bg-red-950/20 border-red-500/30 shadow-lg shadow-red-500/5 animate-pulse"
                    : "bg-[#161b22] border-white/5 hover:border-indigo-500/30"
                )}
              >
                {isConfirming ? (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between w-full gap-4">
                    <div className="space-y-1">
                      <h4 className="font-bold text-red-400 text-sm flex items-center gap-2">
                        <Trash2 className="w-4 h-4 text-red-500" />
                        Delete this session permanently?
                      </h4>
                      <p className="text-xs text-[#8b949e]">
                        All messages and context for <span className="font-mono text-red-300">CUI: {session.uci || session.id}</span> will be deleted. This cannot be undone.
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 self-start sm:self-auto">
                      <button
                        onClick={() => {
                          onDeleteSession && onDeleteSession(session.id);
                          setConfirmDeleteId(null);
                        }}
                        className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all active:scale-95 cursor-pointer shadow-md hover:shadow-red-500/20"
                      >
                        Yes, Delete
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="px-4 py-2 bg-[#21262d] hover:bg-[#30363d] text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all active:scale-95 cursor-pointer border border-white/10"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {/* B25: fallback to first-message excerpt when title is blank */}
                        <h3 className="font-bold text-white text-base leading-snug">
                          {session.title && session.title !== 'New Conversation'
                            ? session.title
                            : session.messages?.find((m: any) => m.sender === 'user')?.text?.slice(0, 50) || 'New Conversation'}
                        </h3>
                        <span className="inline-flex items-center px-2 py-0.5 bg-indigo-500/10 text-indigo-400 border border-indigo-500/25 rounded-md font-mono text-[10px] tracking-normal lowercase">
                          CUI: {session.uci || session.id}
                        </span>
                        {/* App / Chat badge */}
                        <span className={cn(
                          "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest border",
                          sessionIsApp
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
                            : "bg-indigo-500/10 text-indigo-400 border-indigo-500/20"
                        )}>
                          {sessionIsApp ? <><Code2 className="w-2.5 h-2.5" /> App</> : <><MessageSquare className="w-2.5 h-2.5" /> Chat</>}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10px] text-[#8b949e] font-bold uppercase tracking-widest">
                        <span className="flex items-center gap-1.5"><Clock className="w-3 h-3 animate-pulse" /> {new Date(session.lastUpdated).toLocaleString()}</span>
                        <span className="flex items-center gap-1.5"><ShieldCheck className="w-3 h-3 text-emerald-500" /> {session.current_agent || 'navbharatai'}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0 self-start sm:self-auto z-10">
                      <button
                        onClick={() => onRestoreSession && onRestoreSession(session.uci || session.id)}
                        className="flex items-center justify-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all shadow-lg hover:shadow-indigo-500/20 shrink-0 cursor-pointer"
                      >
                        Open Chat
                        <LogIn className="w-3.5 h-3.5" />
                      </button>

                      <div className="relative">
                        <button
                          onClick={() => setOpenDropdownId(openDropdownId === session.id ? null : session.id)}
                          className={cn(
                            "p-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-center",
                            openDropdownId === session.id
                              ? "bg-indigo-600 border-indigo-500 text-white"
                              : "bg-[#21262d]/50 hover:bg-[#30363d] border-white/5 text-[#8b949e] hover:text-white"
                          )}
                          title="Options"
                        >
                          <MoreVertical className="w-4 h-4" />
                        </button>

                        {openDropdownId === session.id && (
                          <>
                            <div
                              className="fixed inset-0 z-40 bg-black/5"
                              onClick={() => setOpenDropdownId(null)}
                            />
                            <div className="absolute right-0 mt-2 w-48 bg-[#1f242c] border border-white/10 rounded-xl shadow-2xl z-50 py-1.5 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                              <button
                                onClick={() => {
                                  setOpenDropdownId(null);
                                  setConfirmDeleteId(session.id);
                                }}
                                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs font-bold text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors text-left cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                Delete Session
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </motion.div>
            );
          })
        )}
      </div>
    </div>
  );
};
