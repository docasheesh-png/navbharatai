import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Briefcase, MessageSquare, LogIn, Trash2, Search, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { PROFESSIONAL_CHATS } from './professionalConfigs';
import {
  browserStore, readActive, readArchive, hasRealExchange, resumeArchived, deleteArchived, activeKey,
  type ProfMsg,
} from '../../lib/professionalChatStore';

// PROFESSIONAL-SCOPED HISTORY (admin 2026-08-11: "Professional ki History sirf Professional ki dikhaye,
// puri NavBharatAI ki nahi").
//
// WHY A SEPARATE VIEW: professional conversations are NOT stored in the Firestore `chat_sessions` that the
// generic HistoryView reads — each professional keeps its own rolling buffer in localStorage under
// `prof_<id>_messages` (see ProfessionalChat). So the generic history could only ever show free/pro/build
// sessions here (unrelated) and ZERO of the professional's real chats. This view reads the RIGHT source:
// the localStorage buffers, one row per professional the user has actually talked to.

interface ProfHistoryItem {
  id: string;
  name: string;
  /** A short preview — the last thing said in the conversation. */
  preview: string;
  /** How many messages the user + assistant have exchanged (excludes the opening welcome). */
  turns: number;
  /**
   * Set when the user has ENDED this conversation with ✕ — it is archived rather than live.
   * Doubles as the conversation's id within its professional (see professionalChatStore).
   */
  endedAt?: number;
}

/**
 * Read every professional's conversations — the live one AND the ones the user has closed — keeping
 * only those with a REAL exchange (a lone opening welcome is not "history").
 *
 * ENDED CONVERSATIONS APPEAR HERE (admin 2026-08-19). Before ✕ genuinely closed a professional chat,
 * there was only ever one conversation per professional and this read a single key. Now closing one
 * archives it, so a user can have several — and if this view still read only the live slot, pressing ✕
 * would have looked exactly like deleting the conversation. Reads localStorage.
 */
export function readProfessionalHistory(): ProfHistoryItem[] {
  const store = browserStore();
  if (!store) return [];
  const items: ProfHistoryItem[] = [];
  const describe = (msgs: ProfMsg[]) => ({
    preview: String(msgs[msgs.length - 1]?.content || '').replace(/\s+/g, ' ').trim().slice(0, 120),
    turns: msgs.filter((m) => m?.role === 'user').length,
  });
  for (const [id, config] of Object.entries(PROFESSIONAL_CHATS)) {
    const live = readActive(store, id);
    if (hasRealExchange(live)) items.push({ id, name: config.name, ...describe(live) });
    for (const past of readArchive(store, id)) {
      if (!hasRealExchange(past.messages)) continue;
      items.push({ id, name: config.name, endedAt: past.endedAt, ...describe(past.messages) });
    }
  }
  return items;
}

/** A stable React key / identity for a row — a professional can now hold several conversations. */
const rowId = (item: ProfHistoryItem) => `${item.id}#${item.endedAt ?? 'live'}`;

export function ProfessionalHistoryView({
  onOpen,
  onBack,
}: {
  /** Resume a professional's chat — `id` is that professional's ViewType. */
  onOpen: (id: string) => void;
  onBack?: () => void;
}) {
  const [reloadKey, setReloadKey] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const all = useMemo(() => readProfessionalHistory(), [reloadKey]);

  const items = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return all;
    return all.filter((i) => i.name.toLowerCase().includes(q) || i.preview.toLowerCase().includes(q));
  }, [all, searchQuery]);

  const clearOne = (item: ProfHistoryItem) => {
    const store = browserStore();
    if (!store) return;
    if (item.endedAt === undefined) {
      try { store.removeItem(activeKey(item.id)); } catch { /* ignore */ }
    } else {
      deleteArchived(store, item.id, item.endedAt);
    }
    setReloadKey((k) => k + 1);
  };

  // "Open" must open the conversation the user clicked, not a blank chat. An ENDED conversation is
  // therefore made live again first — and whatever is live at that moment is archived rather than
  // overwritten, so resuming an old chat can never cost the user a newer one.
  const openOne = (item: ProfHistoryItem) => {
    const store = browserStore();
    if (store && item.endedAt !== undefined) resumeArchived(store, item.id, item.endedAt);
    onOpen(item.id);
  };

  return (
    <div className="flex-1 flex flex-col bg-[#0d1117] h-full overflow-hidden p-6">
      <div className="flex items-center gap-3 mb-5">
        {onBack && (
          <button
            onClick={onBack}
            className="text-xs font-bold text-[#8b949e] hover:text-white transition-colors px-2.5 py-1.5 rounded-lg hover:bg-white/5"
            aria-label="Back"
          >
            ← Back
          </button>
        )}
        <h2 className="text-3xl font-black text-white italic tracking-tighter uppercase flex items-center gap-3">
          <Briefcase className="w-8 h-8 text-teal-500" />
          Professional History
        </h2>
      </div>

      {/* Search (only when there is something to search) */}
      {all.length > 0 && (
        <div className="relative mb-5">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#484f58]" />
          <input
            type="text"
            placeholder="Search your professional chats..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#161b22] border border-white/8 rounded-xl pl-8 pr-8 py-2 text-[11px] text-white placeholder-[#484f58] outline-none focus:border-teal-500/50 transition-colors"
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
      )}

      <div className="text-[9px] font-black uppercase tracking-widest text-[#484f58] mb-3">
        {items.length} conversation{items.length !== 1 ? 's' : ''}{searchQuery ? ` matching "${searchQuery}"` : ''}
      </div>

      <div className="flex-1 overflow-y-auto space-y-4 custom-scrollbar" role="list" aria-label="Professional history">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-6">
            <div className="w-20 h-20 bg-teal-600/10 border border-teal-600/20 rounded-[2rem] flex items-center justify-center">
              <Briefcase className="w-10 h-10 text-teal-400/50" />
            </div>
            <div className="text-center space-y-2">
              <p className="text-sm font-black text-white uppercase tracking-widest">
                {searchQuery ? `No results for "${searchQuery}"` : 'No professional chats yet'}
              </p>
              <p className="text-[11px] text-[#484f58] max-w-xs mx-auto leading-relaxed">
                {searchQuery
                  ? 'Try a different search term.'
                  : 'Talk to a Professional (Doctor, Lawyer, Teacher, CA…) and your conversations will show up here.'}
              </p>
            </div>
          </div>
        ) : (
          items.map((item) => (
            <motion.div
              key={rowId(item)}
              layout
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="border rounded-2xl p-6 bg-[#161b22] border-white/5 hover:border-teal-500/30 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            >
              <div className="space-y-2 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-bold text-white text-base leading-snug">{item.name}</h3>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest border bg-teal-500/10 text-teal-400 border-teal-500/25">
                    <MessageSquare className="w-2.5 h-2.5" /> {item.turns} message{item.turns !== 1 ? 's' : ''}
                  </span>
                  {item.endedAt !== undefined && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest border bg-white/5 text-[#8b949e] border-white/10">
                      Closed {new Date(item.endedAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
                {item.preview && <p className="text-[12px] text-[#8b949e] leading-relaxed line-clamp-2">{item.preview}</p>}
              </div>

              <div className="flex items-center gap-3 shrink-0 self-start sm:self-auto">
                <button
                  onClick={() => openOne(item)}
                  className="flex items-center justify-center gap-2 px-5 py-2.5 bg-teal-600 hover:bg-teal-500 active:scale-95 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all shadow-lg shrink-0"
                >
                  Open <LogIn className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => clearOne(item)}
                  aria-label={`Delete ${item.name} conversation`}
                  className={cn(
                    'p-2.5 rounded-xl border transition-all flex items-center justify-center',
                    'bg-[#21262d]/50 hover:bg-red-500/10 border-white/5 text-[#8b949e] hover:text-red-400',
                  )}
                  title="Delete this conversation"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
}

export default ProfessionalHistoryView;
