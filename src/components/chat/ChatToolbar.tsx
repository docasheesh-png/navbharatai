// The one composer toolbar, shared by every AI in NavBharatAI.
//
// ADMIN 2026-08-10: "sabhi AI's ke input ka acche cheezein utha kar best input box banao, aur wahi
// sabhi jagah laga do" — specifically, NavBharatAI Free's ON SEND / SEARCH / CLEAR row above the
// input box, on every screen (Export cut).
//
// This component is a SHELL. Every decision it makes — the toggle's label and tooltip, whether the
// actions are worth showing, what Clear asks before destroying a conversation, how a search matches —
// lives in `lib/chatToolbar.ts` and is unit-tested there. Keeping the judgement out of the JSX is
// what stops the four screens drifting apart again the moment one of them is edited.
//
// The host still owns its own state, because the four AIs store messages in four different shapes.
// What they no longer own is the BEHAVIOUR.

import React from 'react';
import { Search, X } from 'lucide-react';
import {
  sendToggleLabel, sendToggleTitle, toolbarActionsVisible, clearConfirmText, searchResultLabel,
  SEND_ON_ENTER_KEY,
} from '../../lib/chatToolbar';

export interface ChatToolbarProps {
  /** How many messages the conversation holds — decides whether Search/Clear are live controls. */
  messageCount: number;
  sendOnEnter: boolean;
  onSendOnEnterChange: (next: boolean) => void;
  /** Current search text ('' when the box is closed or empty). */
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
  /** How many messages the current query matches — shown so "no matches" never looks like a bug. */
  searchMatches?: number;
  /** Wipe the conversation. The confirmation is asked HERE so every screen asks the same question. */
  onClear?: () => void;
  /** Characters typed, shown once the message is long enough for the count to mean anything. */
  charCount?: number;
  /**
   * Screen-specific badges for the left of the row (the IDE chat's "Pinned" chip, for example).
   * Unifying the CONTROLS does not mean erasing what makes a screen itself — a shared row that
   * forced every host to drop its own status badge would just be re-forked the first time one was
   * needed back.
   */
  leftSlot?: React.ReactNode;
  className?: string;
}

/** Shared pill styling — one definition, so the four screens cannot drift on hover or press state. */
const PILL = 'text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded-lg transition-all active:scale-95';
const PILL_IDLE = `${PILL} bg-white/5 text-[#8b949e] hover:text-white hover:bg-white/10`;
const PILL_ON = `${PILL} bg-indigo-600/20 text-indigo-400`;

export function ChatToolbar({
  messageCount, sendOnEnter, onSendOnEnterChange, searchQuery, onSearchQueryChange,
  searchOpen, onSearchOpenChange, searchMatches, onClear, charCount, leftSlot, className,
}: ChatToolbarProps) {
  const showActions = toolbarActionsVisible(messageCount);

  const toggleSend = () => {
    const next = !sendOnEnter;
    onSendOnEnterChange(next);
    // Persisted under ONE key for every AI — change it on any screen and all four follow.
    try { localStorage.setItem(SEND_ON_ENTER_KEY, String(next)); } catch { /* private mode — the toggle still works for this session */ }
  };

  const closeSearch = () => { onSearchOpenChange(false); onSearchQueryChange(''); };

  return (
    <div className={className}>
      {/* The search box sits INSIDE the toolbar rather than at the top of the transcript: it belongs
          to the control that opened it, and on a phone a field 600px away from its button reads as a
          different feature entirely. */}
      {searchOpen && showActions && (
        <div className="mb-1.5 flex items-center gap-2 px-2 py-1.5 rounded-lg bg-black/20 border border-white/5">
          <Search className="w-3 h-3 text-[#484f58] shrink-0" />
          <input
            autoFocus
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') closeSearch(); }}
            placeholder="Search messages…"
            className="flex-1 min-w-0 bg-transparent text-[11px] text-white outline-none placeholder:text-[#484f58]"
          />
          {searchQuery.trim() !== '' && typeof searchMatches === 'number' && (
            <span className={`text-[9px] font-mono shrink-0 ${searchMatches === 0 ? 'text-amber-400' : 'text-[#484f58]'}`}>
              {searchResultLabel(searchMatches, messageCount)}
            </span>
          )}
          <button onClick={closeSearch} title="Close search" className="text-[#484f58] hover:text-white shrink-0">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {leftSlot}
          {typeof charCount === 'number' && charCount > 60 && (
            <span className={`text-[9px] font-mono ${charCount > 1000 ? 'text-amber-400' : 'text-[#484f58]'}`}>
              {charCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button onClick={toggleSend} title={sendToggleTitle(sendOnEnter)} className={PILL_IDLE}>
            {sendToggleLabel(sendOnEnter)}
          </button>
          {showActions && (
            <>
              <button
                onClick={() => { if (searchOpen) closeSearch(); else onSearchOpenChange(true); }}
                title="Search messages"
                className={searchOpen ? PILL_ON : PILL_IDLE}
              >
                Search
              </button>
              {onClear && (
                <button
                  // Asked here, once, so no screen can quietly ship a Clear that skips the question.
                  onClick={() => { if (window.confirm(clearConfirmText(messageCount))) onClear(); }}
                  title="Clear conversation"
                  className={PILL_IDLE}
                >
                  Clear
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
