import { useState, useEffect } from 'react';
import { db } from '../lib/firebase';
import { collection, query, orderBy, onSnapshot, doc, updateDoc, arrayUnion } from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';
import { 
  MessageSquare, User, Clock, AlertCircle, ChevronDown, ChevronUp, Send, CheckCircle2, Flag
} from 'lucide-react';
import { cn } from '../lib/utils';
import { TirangaLoader } from './ui/TirangaLoader';

export const ReportsListView = ({ user }: { user: any }) => {
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [commentText, setCommentText] = useState<Record<string, string>>({});

  useEffect(() => {
    const q = query(collection(db, 'reports'), orderBy('timestamp', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setReports(data);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleAddComment = async (reportId: string) => {
    const text = commentText[reportId];
    if (!text?.trim() || !user) return;

    try {
      const reportRef = doc(db, 'reports', reportId);
      await updateDoc(reportRef, {
        comments: arrayUnion({
          userId: user.uid,
          userEmail: user.email,
          userName: user.displayName || user.email?.split('@')[0],
          text: text.trim(),
          timestamp: new Date().toISOString() // Using ISO string for simpler local display in array
        })
      });
      setCommentText(prev => ({ ...prev, [reportId]: '' }));
    } catch (err) {
      console.error('Error adding comment:', err);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0d1117]">
        <div className="flex flex-col items-center gap-4">
          <TirangaLoader className="w-12 h-12" />
          <span className="text-[10px] font-black text-[#484f58] uppercase tracking-widest">Loading Bug Matrix...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-[#0d1117] h-full overflow-hidden">
      <div className="p-8 border-b border-white/5 bg-[#161b22]/50">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="space-y-1">
            <h2 className="text-3xl font-black text-white italic tracking-tighter uppercase flex items-center gap-3">
              <AlertCircle className="w-8 h-8 text-red-500" />
              Bug Registry
            </h2>
            <p className="text-[10px] text-[#8b949e] font-black uppercase tracking-[0.3em]">
              Community reported issues & analysis
            </p>
          </div>
          <div className="px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-xl">
             <span className="text-[10px] font-black text-red-500 uppercase tracking-widest">{reports.length} Reports Active</span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-8 custom-scrollbar">
        <div className="max-w-4xl mx-auto space-y-6">
          {reports.length === 0 ? (
            <div className="py-20 flex flex-col items-center justify-center text-center space-y-6">
              <div className="w-20 h-20 bg-emerald-500/10 rounded-[2.5rem] flex items-center justify-center border border-emerald-500/20">
                <CheckCircle2 className="w-10 h-10 text-emerald-500" />
              </div>
              <div>
                <h3 className="text-xl font-black text-white italic">Maximum Stability</h3>
                <p className="text-xs text-[#8b949e] mt-1 uppercase tracking-widest font-bold">No issues reported in current matrix</p>
              </div>
            </div>
          ) : (
            reports.map((report) => (
              <motion.div 
                key={report.id}
                layout
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  "bg-[#161b22] border rounded-[2rem] overflow-hidden transition-all duration-300",
                  expandedId === report.id ? "border-indigo-500 shadow-2xl shadow-indigo-500/10 ring-1 ring-indigo-500/20" : "border-white/5 hover:border-white/10"
                )}
              >
                <div 
                  className="p-6 cursor-pointer"
                  onClick={() => setExpandedId(expandedId === report.id ? null : report.id)}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-4 flex-1">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-indigo-600/10 rounded-2xl flex items-center justify-center border border-white/5">
                          <Flag className="w-5 h-5 text-indigo-400" />
                        </div>
                        <div>
                          <div className="text-[10px] font-black text-white uppercase tracking-widest mb-0.5">{report.userName}</div>
                          <div className="flex items-center gap-2 text-[9px] text-[#484f58] font-bold">
                            <Clock className="w-3 h-3" />
                            {report.timestamp?.toDate ? report.timestamp.toDate().toLocaleString() : 'Just now'}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <div className="p-4 bg-[#0d1117] border border-red-500/10 rounded-2xl">
                          <div className="text-[9px] font-black text-red-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                             <AlertCircle className="w-3 h-3" /> Error Description
                          </div>
                          <p className="text-xs text-white leading-relaxed font-medium">{report.error}</p>
                        </div>
                      </div>
                    </div>
                    
                    <button className="p-2 hover:bg-white/5 rounded-xl transition-all self-start">
                      {expandedId === report.id ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                <AnimatePresence>
                  {expandedId === report.id && (
                    <motion.div 
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="border-t border-white/5 px-6 pb-6 pt-2 space-y-6"
                    >
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="p-4 bg-[#0d1117] border border-white/5 rounded-2xl">
                          <div className="text-[9px] font-black text-[#8b949e] uppercase tracking-widest mb-2">Original Response</div>
                          <div className="text-[10px] text-[#c9d1d9] font-mono line-clamp-6 opacity-60 italic">{report.originalText}</div>
                        </div>
                        <div className="p-4 bg-[#0d1117] border border-emerald-500/10 rounded-2xl">
                          <div className="text-[9px] font-black text-emerald-500 uppercase tracking-widest mb-2">Suggested Correction</div>
                          <p className="text-xs text-emerald-100/80 leading-relaxed">{report.suggestion}</p>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="flex items-center gap-2 text-[10px] font-black text-white uppercase tracking-widest">
                          <MessageSquare className="w-4 h-4 text-indigo-400" /> 
                          Solutions & Comments ({report.comments?.length || 0})
                        </div>

                        <div className="space-y-3">
                          {report.comments?.map((c: any, i: number) => (
                            <div key={i} className="p-4 bg-[#0d1117]/50 rounded-2xl border border-white/5 flex gap-3">
                              <div className="w-8 h-8 bg-white/5 rounded-lg flex items-center justify-center shrink-0">
                                <User className="w-4 h-4 text-[#484f58]" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-[10px] font-black text-indigo-400 uppercase tracking-tight">{c.userName}</span>
                                  <span className="text-[8px] text-[#484f58] font-bold">{new Date(c.timestamp).toLocaleString()}</span>
                                </div>
                                <p className="text-xs text-[#c9d1d9] leading-relaxed">{c.text}</p>
                              </div>
                            </div>
                          ))}
                        </div>

                        {user ? (
                          <div className="flex gap-2 mt-6">
                            <input 
                              type="text"
                              value={commentText[report.id] || ''}
                              onChange={(e) => setCommentText(prev => ({ ...prev, [report.id]: e.target.value }))}
                              onKeyDown={(e) => e.key === 'Enter' && handleAddComment(report.id)}
                              placeholder="Contribute to the resolution..."
                              className="flex-1 bg-[#0d1117] border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none focus:border-indigo-500 transition-all font-medium"
                            />
                            <button 
                              onClick={() => handleAddComment(report.id)}
                              className="p-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition-all"
                            >
                              <Send className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <div className="p-4 bg-indigo-600/5 border border-indigo-500/10 rounded-2xl text-center">
                            <span className="text-[9px] font-black text-indigo-400 uppercase tracking-widest">Please login to comment on this registry</span>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
