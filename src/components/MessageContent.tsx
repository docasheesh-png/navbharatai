import React, { useState } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';

// Allow inline generated images (Free-chat image generation returns a `data:image/...;base64,...` markdown
// image). react-markdown's default urlTransform strips every non-http(s) protocol — including data: — for
// XSS safety, which would blank the generated image. We re-allow ONLY `data:image/` (an image payload is
// inert — it cannot execute), and defer everything else to the safe default.
const allowInlineImages = (url: string, key: string, node: unknown): string =>
  /^data:image\//i.test(url) ? url : defaultUrlTransform(url, key, node as never);
import { ChevronDown, ChevronUp, ThumbsUp, ThumbsDown, Flag, X, MessageSquare, Send, Loader2 } from 'lucide-react';
import { TirangaLoader } from './ui/TirangaLoader';
import { cn } from '../lib/utils';
import { auth, db } from '../lib/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

export const MessageContent = ({ text, sender, user }: { text: string; sender: 'user' | 'ai'; user: any }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [feedback, setFeedback] = useState<'liked' | 'disliked' | null>(null);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportData, setReportData] = useState({ error: '', suggestion: '' });
  const [reported, setReported] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Threshold for folding: 4 lines or 300 characters
  const lineCount = text.split('\n').length;
  const isLongText = text.length > 300 || lineCount > 4;

  const handleReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setIsSubmitting(true);
    try {
      await addDoc(collection(db, 'reports'), {
        originalText: text,
        error: reportData.error,
        suggestion: reportData.suggestion,
        userId: user.uid,
        userEmail: user.email,
        userName: user.displayName || user.email?.split('@')[0],
        timestamp: serverTimestamp(),
        comments: []
      });
      setReported(true);
      setShowReportModal(false);
    } catch (err) {
      console.error('Error reporting:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const ReportModal = () => (
    <div className="fixed inset-0 z-[600] flex items-center justify-center p-4">
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm" 
        onClick={() => setShowReportModal(false)}
      />
      <div className="relative w-full max-w-sm bg-[#161b22] border border-white/10 rounded-3xl shadow-2xl p-6 space-y-6">
        <button 
          onClick={() => setShowReportModal(false)}
          className="absolute top-4 right-4 p-2 hover:bg-white/5 rounded-full text-[#484f58] hover:text-white transition-all"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="space-y-1">
          <h3 className="text-sm font-black text-white uppercase tracking-widest">Report Response</h3>
          <p className="text-[10px] text-[#484f58] font-bold uppercase">Help us improve the response quality</p>
        </div>

        <form onSubmit={handleReport} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[9px] font-black text-[#484f58] uppercase tracking-widest ml-1">What is the error?</label>
            <textarea 
              required
              value={reportData.error}
              onChange={e => setReportData({...reportData, error: e.target.value})}
              placeholder="Describe what's wrong..."
              className="w-full bg-[#0d1117] border border-white/10 rounded-xl p-3 text-xs text-white outline-none focus:border-red-500/50 transition-all min-h-[80px] resize-none"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[9px] font-black text-[#484f58] uppercase tracking-widest ml-1">Correct Answer suggestion</label>
            <textarea 
              required
              value={reportData.suggestion}
              onChange={e => setReportData({...reportData, suggestion: e.target.value})}
              placeholder="What should it have said?..."
              className="w-full bg-[#0d1117] border border-white/10 rounded-xl p-3 text-xs text-white outline-none focus:border-emerald-500/50 transition-all min-h-[80px] resize-none"
            />
          </div>

          <button 
            type="submit"
            disabled={isSubmitting}
            className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isSubmitting ? <><TirangaLoader className="w-3 h-3" /> Submitting...</> : 'Submit Report'}
          </button>
        </form>
      </div>
    </div>
  );

  const FeedbackButtons = () => (
    <div className="flex items-center gap-1.5 mt-3 opacity-40 group-hover/msg:opacity-100 transition-opacity">
      <button 
        onClick={(e) => { e.stopPropagation(); setFeedback(feedback === 'liked' ? null : 'liked'); }}
        className={cn(
          "flex items-center gap-1 text-[8px] font-black uppercase tracking-widest px-1.5 py-1 rounded transition-all",
          feedback === 'liked' ? "bg-emerald-500/20 text-emerald-400" : "hover:bg-white/5 text-[#484f58] hover:text-white"
        )}
        title="Helpful"
      >
        <ThumbsUp className="w-2.5 h-2.5" />
        {feedback === 'liked' && <span>Liked</span>}
      </button>
      <button 
        onClick={(e) => { e.stopPropagation(); setFeedback(feedback === 'disliked' ? null : 'disliked'); }}
        className={cn(
          "flex items-center gap-1 text-[8px] font-black uppercase tracking-widest px-1.5 py-1 rounded transition-all",
          feedback === 'disliked' ? "bg-red-500/20 text-red-500" : "hover:bg-white/5 text-[#484f58] hover:text-white"
        )}
        title="Not Helpful"
      >
        <ThumbsDown className="w-2.5 h-2.5" />
        {feedback === 'disliked' && <span>Disliked</span>}
      </button>
      <div className="w-px h-2.5 bg-white/5 mx-0.5" />
      <button 
        onClick={(e) => { 
          e.stopPropagation(); 
          if (!user) {
            alert('Please login to report issues.');
            return;
          }
          setShowReportModal(true); 
        }}
        className={cn(
          "flex items-center gap-1 text-[8px] font-black uppercase tracking-widest px-1.5 py-1 rounded transition-all",
          reported ? "bg-amber-500/20 text-amber-500" : "hover:bg-white/5 text-[#484f58] hover:text-white"
        )}
        title={user ? "Report issue" : "Login to report"}
      >
        <Flag className="w-2.5 h-2.5" />
        {reported ? <span>Reported</span> : !user ? <span>Login to Report</span> : <span>Report</span>}
      </button>
    </div>
  );

  const content = (
    <div className="markdown-body">
      <ReactMarkdown
        urlTransform={allowInlineImages}
        components={{
          // Constrain a generated (or any) inline image so it fits the chat bubble neatly.
          img: ({ node, ...props }) => (
            // eslint-disable-next-line jsx-a11y/alt-text
            <img {...props} style={{ maxWidth: '100%', height: 'auto', borderRadius: 12, marginTop: 8 }} loading="lazy" />
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );

  if (!isLongText) {
    return (
      <div className="group/msg">
        {content}
        {sender === 'ai' && <FeedbackButtons />}
        {showReportModal && <ReportModal />}
      </div>
    );
  }

  return (
    <div 
      className="relative cursor-pointer group/msg"
      onClick={() => setIsExpanded(!isExpanded)}
    >
      <div className={cn(
        "transition-all duration-300 relative",
        !isExpanded ? "max-h-[100px] overflow-hidden" : "max-h-[5000px]"
      )}>
        {content}
        {!isExpanded && (
          <div className={cn(
            "absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t to-transparent pointer-events-none",
            sender === 'user' ? "from-indigo-600" : "from-[#161b22]"
          )} />
        )}
      </div>
      
      <div className="flex items-center justify-between gap-2">
        <div className="flex justify-start mt-2">
          <button 
            className={cn(
              "flex items-center gap-1 text-[9px] font-black uppercase tracking-widest px-2 pr-3 py-1 rounded-lg transition-all",
              sender === 'user' 
                ? "bg-white/10 text-white hover:bg-white/20" 
                : "bg-indigo-600/10 text-indigo-400 hover:bg-indigo-600/20"
            )}
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
          >
            {isExpanded ? (
              <><ChevronUp className="w-3 h-3" /> See Less</>
            ) : (
              <><ChevronDown className="w-3 h-3" /> See More</>
            )}
          </button>
        </div>
        {sender === 'ai' && <div className="mt-[-4px]"><FeedbackButtons /></div>}
        {showReportModal && <ReportModal />}
      </div>
    </div>
  );
};
