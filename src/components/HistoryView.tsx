import React, { useState, useEffect } from 'react';
import { db } from '../App';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { motion } from 'motion/react';
import { MessageSquare, Clock, ShieldCheck, LogIn, MoreVertical, Trash2, X } from 'lucide-react';
import { cn } from '../lib/utils';

export const HistoryView = ({ 
  user,
  onRestoreSession,
  onDeleteSession
}: { 
  user: any;
  onRestoreSession?: (uci: string) => void;
  onDeleteSession?: (id: string) => void;
}) => {
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'chat_sessions'),
      where('userId', '==', user.uid),
      orderBy('lastUpdated', 'desc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setSessions(data);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [user]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0d1117]">
        <div className="w-12 h-12 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-[#0d1117] h-full overflow-hidden p-8">
      <h2 className="text-3xl font-black text-white italic tracking-tighter uppercase flex items-center gap-3 mb-8">
        <MessageSquare className="w-8 h-8 text-indigo-500" />
        Session History
      </h2>
      <div className="flex-1 overflow-y-auto space-y-4 custom-scrollbar">
        {sessions.length === 0 ? (
          <div className="text-center py-20 text-[#8b949e] font-black uppercase tracking-widest text-sm">
            No past sessions found.
          </div>
        ) : (
          sessions.map((session) => {
            const isConfirming = confirmDeleteId === session.id;
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
                        Delete this chat session permanently?
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
                        <h3 className="font-bold text-white text-base leading-snug">{session.title}</h3>
                        <span className="inline-flex items-center px-2 py-0.5 bg-indigo-500/10 text-indigo-400 border border-indigo-500/25 rounded-md font-mono text-[10px] tracking-normal lowercase">
                          CUI: {session.uci || session.id}
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
