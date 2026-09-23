// THE HISTORY BUTTON — the free chat's door to its own past conversations, on DESKTOP.
//
// THE ASK (admin 2026-09-23): *"navbharatai free ke andar history ka option nahi hai (footer nahi hai,
// is liye). to history button ko, input box wali line me, mode selecter se pahle (left me) rakho! (only
// in desktop — mobile me theek hai)"*.
//
// On a phone the bottom bar carries History, one item beside Mode. On a desktop there is no bottom bar,
// so inside the free chat there was no control that leads to History at all — the sidebar row exists
// (#3257) but is one menu away from the conversation. Mode already had exactly this gap and the same
// answer (`ModeButton`); this is its sibling, placed to its left: [ History ] [ Mode ▾ ] [ message box ].
//
// ⚠️ IT IS A BUTTON, NOT A SECOND HISTORY. It holds no list and makes no decision — it calls the ONE
// opener App.tsx owns (`openHistoryForCurrentSurface`), which decides the list's scope, popup-vs-tab and
// the sign-in gate. The bottom bar calls the same function, so the two doors can never disagree.
//
// 🔒 WHERE IT IS HIDDEN IS THE CALLER'S DECISION: pass `onOpen` as `undefined` and nothing renders.
// App.tsx computes that ONCE from the same `showsGlobalMobileNav` boolean that renders the bottom bar,
// so a phone never shows two History controls.

import { History } from 'lucide-react';
import { RAIL_BUTTON_CLASS } from './ModeButton';

export interface HistoryButtonProps {
  /** Open history. `undefined` ⇒ render nothing (the bottom bar is carrying History). */
  onOpen?: (() => void) | undefined;
  /** `rail` = the upper half of the composer's left column; icon only on a phone. See ModeButton. */
  size?: 'inline' | 'rail';
  className?: string;
}

export function HistoryButton({ onOpen, size = 'inline', className = '' }: HistoryButtonProps) {
  if (!onOpen) return null;
  if (size === 'rail') {
    return (
      <button
        type="button"
        onClick={onOpen}
        aria-label="Open chat history"
        title="Chat history — your earlier conversations"
        className={`${RAIL_BUTTON_CLASS} ${className}`}
      >
        <History className="w-4 h-4 shrink-0" />
        <span className="hidden md:inline">History</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Open chat history"
      title="Chat history — your earlier conversations"
      // Same box as ModeButton's `inline` size (h-12, matching the message box's resting height), so the
      // three pieces of the row line up; only the icon and the word differ.
      className={`h-12 px-3 text-[11px] shrink-0 flex items-center gap-1.5 rounded-2xl border border-line bg-card font-bold text-muted hover:text-ink hover:border-indigo-500 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${className}`}
    >
      <History className="w-3.5 h-3.5" />
      History
    </button>
  );
}
