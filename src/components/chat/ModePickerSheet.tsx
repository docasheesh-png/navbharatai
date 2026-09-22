// ModePickerSheet — the sheet the footer's Mode button opens (admin 2026-08-25). See modePicker.ts for
// the composition rules; this file is only the surface. It navigates via the SAME onPick contract the
// Professionals hub uses, so selecting an expert lands in that expert's real chat — same engine, same
// disclaimers, same gating.
//
// TWO GROUPS SINCE 2026-09-22 (admin: "upar recent chat, niche new chat … 2 alag alag group hi bana
// do"): RECENT CHAT — every chat that is open, one row each, each with its own ✕; a line; NEW CHAT —
// everything that starts something. The per-row "Recent" / "New chat" tags are gone because the group
// heading now says it once. This sheet is ALSO the window switcher: the header no longer draws a chip
// per open chat, so a recent row is the way to get back to "Teacher AI (2)".

import { useMemo, useState } from 'react';
import { X, Search, Check } from 'lucide-react';
import { modePickerEntries, filterModeEntries, activeModeId, recentRowClosable, type ModeEntry } from './modePicker';
import type { ChatWindow } from '../../lib/chatWindows';

export function ModePickerSheet({
  activeView,
  activeChatId,
  openViews,
  openChats,
  hideMedical,
  onPick,
  onCloseRecent,
  onClose,
}: {
  /** The current view id — with `activeChatId`, decides which recent row carries the ✓. */
  activeView: string;
  /** The professional window on screen, when the current view is a professional. */
  activeChatId?: string | null;
  /** The open tab ids — which single-chat views (FREE, the image studio, Doctor AI) are open. */
  openViews: readonly string[];
  /** The open professional windows, in the order they were opened. */
  openChats: readonly ChatWindow[];
  /** Native-shell Play compliance: hides the medical-class experts (same rule as the hub). */
  hideMedical: boolean;
  /**
   * The id of the row that was tapped. The CALLER navigates; this sheet only reports.
   *
   * ⚠️ Deliberately NOT a list of the possible values — that list lives in modePicker.ts (`ModeEntry`)
   * and the copy that used to stand here still said `free_new` months after the row was renamed. A
   * restated fact is a fact that goes stale where no compiler can see it.
   */
  onPick: (id: string) => void;
  /**
   * Close the conversation a RECENT row refers to. Receives that row's prefixed id (the caller owns
   * `recentTargetFromId` to turn it back into a view and conversation), so this sheet never has to know
   * what closing means on any particular surface.
   *
   * Optional: without it the ✕ is not rendered at all, rather than rendered and inert.
   */
  onCloseRecent?: (recentId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const entries = useMemo(
    () => modePickerEntries({ hideMedical, activeView, openViews, openChats }),
    [hideMedical, activeView, openViews, openChats],
  );
  const visible = useMemo(() => filterModeEntries(entries, query), [entries, query]);
  const current = activeModeId(activeView, activeChatId);
  const recent = visible.filter((e) => e.kind === 'recent');
  const fresh = visible.filter((e) => e.kind !== 'recent');

  // Emoji logos (admin 2026-08-25: "emoji logo bhi sath me hon, maja aa jayega") — every expert
  // carries its own, from the completeness-tested map in modePicker.ts. Rendered in a fixed-width
  // rounded chip so 70+ rows line up whatever each emoji's natural width is.
  const rowIcon = (e: ModeEntry) => (
    <span aria-hidden className="w-8 h-8 rounded-lg bg-raised border border-line flex items-center justify-center text-[16px] leading-none shrink-0">
      {e.emoji}
    </span>
  );

  // 'navbharatai "free" — free bold me alag style me dikhe' (admin 2026-08-25). The styling belongs to
  // the WORD, so the recent row gets it too when the open AI happens to be the free chat — otherwise the
  // same name would be painted two different ways in one list.
  const rowLabel = (e: ModeEntry) => {
    if (e.name === 'NavBharatAI FREE') {
      return (
        <span className="text-[13px] text-ink">
          NavBharatAI{' '}
          <span className="font-black italic tracking-tight bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">FREE</span>
        </span>
      );
    }
    return <span className="text-[13px] font-semibold text-ink">{e.name}</span>;
  };

  const groupHeading = (text: string) => (
    <p className="px-3 pt-2 pb-1 text-[10px] font-black uppercase tracking-widest text-muted">{text}</p>
  );

  const row = (e: ModeEntry) => (
    // THE ROW IS A ROW, NOT A BUTTON (admin 2026-09-21: a recent chat has its own ✕). A button inside
    // a button is invalid HTML and the inner one's click does not reliably reach it, so the highlight
    // lives out here and the tap target is a sibling of the close control rather than its parent.
    <div
      key={e.id}
      className={`flex items-center rounded-xl transition-colors ${current === e.id ? 'bg-indigo-600/15 border border-indigo-500/30' : 'hover:bg-raised border border-transparent'}`}
    >
      <button
        onClick={() => onPick(e.id)}
        className="flex-1 min-w-0 flex items-center gap-3 px-3 py-2.5 rounded-xl text-left"
        aria-current={current === e.id ? 'true' : undefined}
      >
        {rowIcon(e)}
        <span className="flex-1 min-w-0 truncate">{rowLabel(e)}</span>
        {current === e.id && <Check className="w-4 h-4 text-accent-text shrink-0" aria-label="Current mode" />}
      </button>
      {/* CLOSE THAT CHAT, from the row that names it. Only a recent row gets it: every New row STARTS
          something, and there is nothing yet to close. NavBharatAI FREE never gets it (admin 2026-09-22,
          `recentRowClosable`): it is the home the other chats live in, and a fresh FREE chat is one tap
          away under "New chat". Absent when the caller supplies no handler, so a surface that cannot
          close a chat shows no control that pretends it can. */}
      {e.kind === 'recent' && onCloseRecent && recentRowClosable(e.id) && (
        <button
          onClick={() => onCloseRecent(e.id)}
          aria-label={`Close ${e.name}`}
          title={`Close ${e.name}`}
          className="p-2 mr-1 rounded-lg text-faint hover:text-ink hover:bg-raised shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center" role="dialog" aria-modal="true" aria-label="Choose AI mode">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-scrim backdrop-blur-sm" />
      <div
        className="relative w-full sm:max-w-md bg-surface border-t sm:border border-line sm:rounded-2xl rounded-t-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: 'min(72dvh, 40rem)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <h3 className="text-[13px] font-black uppercase tracking-widest text-ink">Choose AI mode</h3>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-muted hover:text-ink hover:bg-raised">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-4 pb-2">
          <div className="flex items-center gap-2 bg-card border border-line rounded-xl px-3 py-2">
            <Search className="w-3.5 h-3.5 text-faint shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search an expert…"
              className="flex-1 bg-transparent text-[13px] text-ink placeholder:text-faint outline-none"
            />
            {query && (
              <button onClick={() => setQuery('')} aria-label="Clear search" className="text-faint hover:text-ink">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
          {/* RECENT CHAT — absent entirely when nothing is open (the Professionals hub with no chat),
              because a heading over an empty group would promise a way back to nothing. */}
          {recent.length > 0 && (
            <div role="group" aria-label="Recent chat">
              {groupHeading('Recent chat')}
              {recent.map(row)}
              {/* ONE PLAIN LINE between where you ARE and everything that STARTS something (admin
                  2026-09-21: "recent chat aur niche new chat ke bich me line bana do"). */}
              <div className="mx-3 my-1.5 h-px bg-raised" />
            </div>
          )}
          <div role="group" aria-label="New chat">
            {groupHeading('New chat')}
            {fresh.map(row)}
          </div>
          {fresh.every((e) => e.kind !== 'professional') && (
            <p className="px-3 py-4 text-[12px] text-muted">No expert matches that search.</p>
          )}
        </div>
      </div>
    </div>
  );
}
