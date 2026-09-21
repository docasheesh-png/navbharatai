import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../lib/firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { MessageSquare, Clock, MoreVertical, Trash2, Search, X, Layers, Code2, Zap, Cpu, Stethoscope } from 'lucide-react';
import { cn } from '../lib/utils';
import { Skeleton, SkeletonList } from './ui/Skeleton';
import { readProfessionalHistory } from './professionals/ProfessionalHistoryView';
import { browserStore, resumeArchived, deleteArchived } from '../lib/professionalChatStore';
import { professionalRows, sortMergedRows, type ProfessionalPseudoSession } from '../lib/freeHistoryMerge';
import { shapeSessions, messagesOf } from '../lib/sessionShape';
import { readHistoryIndex, buildHistoryIndex, writeHistoryIndex } from '../lib/historyIndex';
import { groupSessionsByRecency } from './history/historyGroups';

type FilterMode = 'all' | 'chat' | 'apps' | 'free' | 'pro' | 'sda';

/** Read the on-disk index ONCE per mount. Both lazy initialisers below need it, and two reads would
 *  mean two localStorage hits and two JSON.parses on the very frame this is trying to make fast. */
let cachedRowsMemo: ReturnType<typeof readHistoryIndex> | null = null;
function cachedRowsOnce() {
  if (cachedRowsMemo === null) cachedRowsMemo = readHistoryIndex();
  return cachedRowsMemo;
}

// NavBharatAI Pro (AgentV3) sessions are saved with agent 'agentv3', tab
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
  // `vishwakarma` is kept ONLY to recognise sessions saved before that surface was deleted
  // (2026-09-12); without it an old builder session would stop being listed as a build session.
  (session.current_agent && (String(session.current_agent).includes('vishwakarma') || String(session.current_agent).includes('pro')));

export const HistoryView = ({
  user,
  onRestoreSession,
  onDeleteSession,
  initialFilter,
  lockFilter,
  includeProfessionals,
  onOpenProfessional,
  embedded,
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
  /**
   * The FREE surface's unified history (admin 2026-08-25, amending the 2026-08-11 scoping): show
   * Free + Doctor + every professional conversation in ONE list, each row tagged with its mode.
   * Professional conversations live in localStorage, not Firestore — see freeHistoryMerge.ts.
   */
  includeProfessionals?: boolean;
  /** Open a professional's chat (the row's conversation was already resumed if it was archived). */
  /** Open a professional conversation — the view id and the conversation it is (or has been resumed as). */
  onOpenProfessional?: (viewId: string, conversationId: string) => void;
  /**
   * Rendered INSIDE something that already has a title (the Free chat's history popup), so this view
   * drops its own big heading and its outer padding (admin 2026-09-20). A popup titled "Chat history"
   * with "SESSION HISTORY" printed again underneath it spends a quarter of a phone screen saying the
   * same thing twice. The TAB keeps its heading — it is a whole screen and needs one.
   */
  embedded?: boolean;
}) => {
  // LOCAL-FIRST (admin 2026-08-31: "history load hone me bahut time lagta hai"). The list used to
  // wait for Firestore's first snapshot before rendering anything — and that snapshot is expensive
  // for a reason worth stating: a `chat_sessions` document carries the full `messages` transcript, a
  // SECOND copy in `restoredMessages`, and the built app's entire `files` contents. Opening a list of
  // titles downloaded all of it, and the query has no limit.
  //
  // The index on disk holds the handful of fields this screen actually renders, so the first frame
  // comes from localStorage and Firestore's snapshot corrects it a moment later. Read with the lazy
  // initialiser (not an effect) so it is present on the FIRST render — an effect would still show one
  // frame of skeleton, which is the flash this exists to remove.
  const [sessions, setSessions] = useState<any[]>(() => cachedRowsOnce());
  // Only a user with NOTHING cached waits. Everyone else sees their history immediately, and the
  // network becomes a refresh rather than a gate.
  const [loading, setLoading] = useState(() => cachedRowsOnce().length === 0);
  // Has the real (Firestore) list arrived yet? Drives one honest notice below: an index row carries
  // no message TEXT, so until this flips, a search matches titles only. Reporting fewer results
  // without saying so would be a confidently wrong answer, which is worse than a slow one.
  const [hydrated, setHydrated] = useState(false);
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<FilterMode>(initialFilter ?? 'all');
  const [searchQuery, setSearchQuery] = useState('');
  // Professional conversations for the unified FREE history — localStorage, refreshed on demand
  // (a delete refreshes it; there is no snapshot listener to lean on for localStorage).
  const [profItems, setProfItems] = useState<ReturnType<typeof readProfessionalHistory>>([]);
  useEffect(() => {
    if (includeProfessionals) setProfItems(readProfessionalHistory());
  }, [includeProfessionals]);

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
      // shapeSessions at the DOOR: every reader below — the search filter, the title fallback, and any
      // added later — can then treat `messages` as an array without knowing that a stored session might
      // not have one. See sessionShape.ts for the crash this closes.
      const data = shapeSessions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })))
        .sort((a: any, b: any) => {
          const ta = a.lastUpdated ? new Date(a.lastUpdated).getTime() : 0;
          const tb = b.lastUpdated ? new Date(b.lastUpdated).getTime() : 0;
          return tb - ta;
        });
      setSessions(data);
      setLoading(false);
      setHydrated(true);
      // The next mount must not reuse this mount's stale snapshot.
      cachedRowsMemo = null;
      // Refresh the head start for next time — including sessions created on another device, which
      // `navbharat_sessions` on THIS device would never have seen.
      writeHistoryIndex(buildHistoryIndex(data));
    }, () => {
      try {
        // Same treatment, and here it also covers the LIST: JSON.parse returns whatever is on this
        // device, and `.sort` on a non-array throws before a single component renders.
        //
        // This is the OFFLINE path and it still reads the full local sessions, because when Firestore
        // is unreachable the richer local copy is the best we have — the index is only a head start
        // for the online case. A cached index already on screen is left alone rather than replaced by
        // a shorter list.
        const local = shapeSessions(JSON.parse(localStorage.getItem('navbharat_sessions') || '[]'));
        if (local.length > 0) {
          setSessions(local.sort((a: any, b: any) => new Date(b.lastUpdated as string).getTime() - new Date(a.lastUpdated as string).getTime()));
        }
      } catch { /* empty */ }
      setLoading(false);
      // The offline list IS the full local copy, so message-text search works against it — the
      // title-only caveat below does not apply once this path has run.
      setHydrated(true);
      cachedRowsMemo = null;
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

    if (includeProfessionals && effectiveFilter === 'free') {
      // The unified FREE scope (admin 2026-08-25): Free + Doctor sessions from Firestore, plus every
      // professional conversation from localStorage — one list, tagged per row, live chats on top.
      result = result.filter(s => isFreeSession(s) || isSdaSession(s));
      result = sortMergedRows([...result, ...professionalRows(profItems, Date.now())], Date.now());
    }
    else if (effectiveFilter === 'apps') result = result.filter(isAppSession);
    else if (effectiveFilter === 'chat') result = result.filter(s => !isAppSession(s));
    else if (effectiveFilter === 'free') result = result.filter(isFreeSession);
    else if (effectiveFilter === 'pro')  result = result.filter(isProSession);
    else if (effectiveFilter === 'sda')  result = result.filter(isSdaSession);

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(s =>
        (s.title && s.title.toLowerCase().includes(q)) ||
        (s.profName && s.profName.toLowerCase().includes(q)) ||
        (s.uci && s.uci.toLowerCase().includes(q)) ||
        (s.id && s.id.toLowerCase().includes(q)) ||
        // No Array.isArray here any more: shapeSessions guarantees it upstream. Leaving the old guard
        // would keep implying the field is untrustworthy at THIS reader and safe at the others, which
        // is the exact asymmetry that hid the crash.
        (messagesOf(s).some((m) => typeof m.text === 'string' && m.text.toLowerCase().includes(q)))
      );
    }

    return result;
  }, [sessions, filterMode, searchQuery, includeProfessionals, effectiveFilter, profItems]);

  /**
   * ONE ROW = ONE TAPPABLE LINE. The whole line opens the conversation; the kebab is the only other
   * target on it. Kept as a local function rather than a component so it closes over the same state
   * the old inline map did (`confirmDeleteId`, `openDropdownId`) — extracting a component would mean
   * threading five props and a second set of handlers for no gain.
   */
  const renderRow = (session: any) => {
    const isConfirming = confirmDeleteId === session.id;
    const sessionIsApp = isAppSession(session);
    // A professional pseudo-row (unified FREE history) — lives in localStorage, not Firestore.
    const prof = (session as Partial<ProfessionalPseudoSession>).profViewId ? (session as ProfessionalPseudoSession) : null;
    // B25: fallback to first-message excerpt when title is blank.
    const title = session.title && session.title !== 'New Conversation'
      ? session.title
      : messagesOf(session).find((m) => m.sender === 'user')?.text?.slice(0, 50) || 'New Conversation';
    // THE MODE, AS A DOT. It used to be a bordered chip with a word in it, on a row that already had
    // three other chips. The colour carries it for a sighted user and `aria-label` carries it for
    // everyone else, so the information survives at a tenth of the width.
    const mode = prof ? { label: prof.profName, dot: 'bg-teal-500' }
      : isSdaSession(session) ? { label: 'Doctor AI', dot: 'bg-rose-500' }
      : isProSession(session) ? { label: 'Pro', dot: 'bg-violet-500' }
      : { label: 'Free', dot: 'bg-amber-500' };
    const openRow = () => {
      if (!prof) { onRestoreSession && onRestoreSession(session.uci || session.id); return; }
      // An archived conversation is genuinely RESUMED (same rule as Professional History) so
      // opening it continues that exact conversation rather than starting a fresh one — under the id
      // it had, so the server continues the same memory. An open one is simply named.
      const store = browserStore();
      let conversationId = prof.profConversationId ?? null;
      if (store && prof.profEndedAt) conversationId = resumeArchived(store, prof.profViewId, prof.profEndedAt);
      if (!conversationId) { setProfItems(readProfessionalHistory()); return; } // gone — refresh, never open a blank chat
      onOpenProfessional?.(prof.profViewId, conversationId);
    };
    const deleteRow = () => {
      if (!prof) { onDeleteSession && onDeleteSession(session.id); return; }
      const store = browserStore();
      if (store && prof.profEndedAt) {
        deleteArchived(store, prof.profViewId, prof.profEndedAt);
        setProfItems(readProfessionalHistory());
      }
    };

    // THE CONFIRMATION IS INLINE AND COMPACT, and it still names what is about to go. A destructive
    // action on a one-line row must not become a one-tap action.
    if (isConfirming) {
      return (
        <div
          key={session.id}
          role="listitem"
          className="flex items-center gap-2 mx-1 my-0.5 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/25"
        >
          <Trash2 className="w-3.5 h-3.5 shrink-0 text-danger" />
          <span className="min-w-0 flex-1 truncate text-[11px] text-danger">
            Delete “{title}”? This cannot be undone.
          </span>
          <button
            onClick={() => { deleteRow(); setConfirmDeleteId(null); }}
            className="shrink-0 px-2.5 py-1 rounded-lg bg-red-600 text-on-accent text-[10px] font-black uppercase tracking-wider active:scale-95"
          >
            Delete
          </button>
          <button
            onClick={() => setConfirmDeleteId(null)}
            className="shrink-0 px-2.5 py-1 rounded-lg bg-raised border border-line text-ink text-[10px] font-black uppercase tracking-wider active:scale-95"
          >
            Cancel
          </button>
        </div>
      );
    }

    return (
      <div key={session.id} role="listitem" className="relative flex items-center gap-0.5 mx-1">
        <button
          type="button"
          onClick={openRow}
          // The accessible name carries everything the chips used to say out loud.
          aria-label={`${title} — ${mode.label}${sessionIsApp ? ' — app' : ''}`}
          title={title}
          className="min-w-0 flex-1 flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-colors hover:bg-raised active:bg-raised-hover touch-manipulation"
        >
          <span aria-hidden="true" className={cn('w-1.5 h-1.5 rounded-full shrink-0', mode.dot)} />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-body">{title}</span>
          {prof?.profLive && (
            <span className="shrink-0 text-[9px] font-black uppercase tracking-widest text-success">Live</span>
          )}
          {/* One glyph, because opening an app session genuinely does something else. */}
          {sessionIsApp && <Code2 aria-hidden="true" className="w-3 h-3 shrink-0 text-faint" />}
        </button>

        {!(prof && prof.profLive) && (
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setOpenDropdownId(openDropdownId === session.id ? null : session.id)}
              aria-label={`Options for ${title}`}
              className={cn(
                'p-2 rounded-xl transition-colors touch-manipulation',
                openDropdownId === session.id ? 'bg-raised text-ink' : 'text-faint hover:text-ink hover:bg-raised'
              )}
            >
              <MoreVertical className="w-4 h-4" />
            </button>

            {openDropdownId === session.id && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setOpenDropdownId(null)} />
                <div className="absolute right-0 mt-1 w-44 bg-raised border border-line rounded-xl shadow-2xl z-50 py-1 overflow-hidden">
                  <button
                    onClick={() => { setOpenDropdownId(null); setConfirmDeleteId(session.id); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-[11px] font-bold text-danger hover:bg-red-500/10 transition-colors text-left"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col bg-surface h-full overflow-hidden p-6">
        <div className="h-8 w-48 mb-5"><Skeleton className="h-full w-full" rounded="rounded-lg" /></div>
        <SkeletonList count={6} />
      </div>
    );
  }

  return (
    <div className={cn('flex-1 flex flex-col bg-surface h-full overflow-hidden', embedded ? 'px-3 pt-3 pb-0' : 'p-6')}>
      {/* Header — dropped when something above already carries the title (see `embedded`). */}
      {!embedded && (
      <h2 className="text-3xl font-black text-ink italic tracking-tighter uppercase flex items-center gap-3 mb-5">
        <MessageSquare className="w-8 h-8 text-accent-text" />
        Session History
      </h2>
      )}

      {/* Filter + Search bar. When the view is LOCKED to a scope (e.g. Free → History), the filter tabs
          are hidden entirely so the user only ever sees that scope's sessions — just the search remains. */}
      <div className="flex flex-col gap-2 mb-5">
        {/* Row 1 + 2: type / AI-mode filters — hidden when the caller locked the scope. */}
        {!lockFilter && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 bg-card border border-line rounded-xl p-1 shrink-0">
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
                  filterMode === key ? "bg-indigo-600 text-on-accent shadow-md" : "text-muted hover:text-ink hover:bg-raised"
                )}
              >
                {icon}{label}
              </button>
            ))}
          </div>

          {/* Row 2: AI mode filters */}
          <div className="flex items-center gap-1 bg-card border border-line rounded-xl p-1 shrink-0">
            {([
              { key: 'free', label: 'Free', icon: <Zap className="w-3 h-3" />, color: 'bg-emerald-600 text-on-accent' },
              { key: 'pro',  label: 'Pro',  icon: <Cpu className="w-3 h-3" />, color: 'bg-violet-600 text-on-accent' },
              { key: 'sda',  label: 'SDA',  icon: <Stethoscope className="w-3 h-3" />, color: 'bg-rose-600 text-on-accent' },
            ] as { key: FilterMode; label: string; icon: React.ReactNode; color: string }[]).map(({ key, label, icon, color }) => (
              <button
                key={key}
                onClick={() => setFilterMode(key)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                  filterMode === key ? `${color} text-ink shadow-md` : "text-muted hover:text-ink hover:bg-raised"
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
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-faint" />
          <input
            type="text"
            placeholder="Search by title, CUI, or message..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-card border border-line rounded-xl pl-8 pr-8 py-2 text-[12px] text-ink placeholder-faint outline-none focus:border-indigo-500/50 transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-faint hover:text-ink transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* THE COUNT ONLY ANSWERS A QUESTION SOMEBODY ASKED (admin 2026-09-20). "235 SESSIONS" above an
          idle list is a number nobody came for, and on a phone it costs a row of the list it is
          describing — neither Claude's sidebar nor ChatGPT's prints one. While SEARCHING it is the
          answer ("did my search find anything?"), so it stays exactly there. */}
      {searchQuery.trim() !== '' && (
        <div className="text-[9px] font-black uppercase tracking-widest text-faint mb-3">
          {filteredSessions.length} result{filteredSessions.length !== 1 ? 's' : ''} for "{searchQuery}"
        </div>
      )}

      {/* HONEST CAVEAT WHILE THE LIST IS STILL THE CACHED ONE (admin 2026-08-31).
          The instant first paint comes from a local index that holds titles and dates but NO message
          text — that is exactly why it is small enough to be instant. So for the moment before the
          real list lands, a search can only match titles. Saying nothing would mean quietly reporting
          fewer results than exist, which is a wrong answer dressed as a fast one. It appears only
          while searching, and disappears by itself the instant the full list arrives. */}
      {!hydrated && searchQuery.trim() !== '' && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2">
          <Clock className="h-3 w-3 shrink-0 text-warn" />
          <p className="text-[10px] leading-relaxed text-warn">
            Searching titles only — still loading your messages, so results may grow in a moment.
          </p>
        </div>
      )}

      {/* ── THE LIST (admin 2026-09-20: "claude and gpt jaisa karo … open chat button … hatao isko") ──
          One tappable line per conversation, grouped by when it happened. What was removed, and why
          each removal is a removal rather than a restyle:

            • **The "Open Chat" button.** The row IS the button now, which is how every list on a phone
              works and the only honest way to delete that control — a row you can see but not tap
              would be worse than the button it replaced.
            • **The `CUI:` id.** A support identifier on every row of a user's own history. It is still
              SEARCHABLE (the box above matches it, unchanged), so nothing became unfindable.
            • **The full timestamp and the agent line.** The group heading says when; a row repeating it
              cost a whole line each. This is the single change that turns cards back into a list.
            • **The App/Chat and mode chips.** The mode survives as a coloured dot and, for a screen
              reader, inside the row's own label — quieter, not lost. An app session keeps one glyph,
              because opening one genuinely does something different.

          Delete STAYS, behind the quiet kebab, with its existing confirmation. Claude and ChatGPT both
          keep it; dropping a real capability to look like them would be a regression wearing a
          redesign. */}
      <div className="flex-1 overflow-y-auto custom-scrollbar" role="list" aria-label="Session history">
        {filteredSessions.length === 0 ? (
          /* F18: helpful empty state with CTA */
          <div className="flex flex-col items-center justify-center py-20 gap-6">
            <div className="w-20 h-20 bg-indigo-600/10 border border-indigo-600/20 rounded-[2rem] flex items-center justify-center">
              <MessageSquare className="w-10 h-10 text-accent-text" />
            </div>
            <div className="text-center space-y-2">
              <p className="text-sm font-black text-ink uppercase tracking-widest">
                {searchQuery ? `No results for "${searchQuery}"` : 'No sessions yet'}
              </p>
              <p className="text-[11px] text-faint max-w-xs mx-auto leading-relaxed">
                {searchQuery
                  ? 'Try a different search term or clear the filter.'
                  : 'Start a conversation in the Pro Chat or ask the AI to build an app — your sessions will appear here.'}
              </p>
            </div>
            {!searchQuery && (
              <button
                onClick={() => onRestoreSession?.('new')}
                className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-on-accent rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-lg"
              >
                Start a New Chat
              </button>
            )}
          </div>
        ) : (
          groupSessionsByRecency(filteredSessions, Date.now()).map((group) => (
            <div key={group.label} className="mb-4 last:mb-0">
              {/* The heading that lets every row beneath it drop its own date. */}
              <div className="px-3 pb-1 pt-1 text-[10px] font-black uppercase tracking-widest text-faint">
                {group.label}
              </div>
              {group.rows.map((session) => renderRow(session))}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
