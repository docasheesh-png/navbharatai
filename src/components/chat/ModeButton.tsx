// THE MODE BUTTON — one definition, so every chat surface offers the same way out.
//
// THE ASK (admin 2026-09-21): *"navbharatai free chat me mode selector show hota hai, par jab ek bar
// mode badal diya jaye to, dusre professionals me mode select ka option hi nahi hai. input box se
// pahle mode button add karo, jisse kabhi bhi kisi bhi mode me se kisi bhi mode me jaya ja sake."*
//
// 🔴 THE GAP WAS A ONE-WAY DOOR. `isModeSurface()` already names every surface that should carry this
// — the free chat, the Professionals hub, Doctor AI, the image studio and every expert — and on a
// PHONE they all do, because the bottom bar's Mode item is rendered for exactly that list. On desktop
// there is no bottom bar, and the button existed only inside the free chat's composer. So switching
// to an expert on a desktop left the user with no control that leads anywhere else: the picker's own
// docblock calls a row that takes you somewhere with no way back "a trap", and that is what the other
// surfaces were.
//
// ⚠️ IT IS A BUTTON, NOT A MENU. It holds no mode, knows no list and makes no decision — it opens the
// ONE `ModePickerSheet` that the bottom bar opens. A second list would drift from the first the day a
// professional is added, and the picker's composition rules (recent row, Play-compliance filter, the
// new-chat semantics) would have to be duplicated to no benefit.
//
// 🔒 WHERE IT IS HIDDEN, AND WHY THAT IS THE CALLER'S DECISION: pass `onOpen` as `undefined` and
// nothing renders. App.tsx already computes that condition once —
// `showsGlobalMobileNav ? undefined : () => setShowModePicker(true)` — so a phone never shows two Mode
// controls, and no surface has to re-derive "am I on a phone?" for itself.

import { Layers, ChevronDown } from 'lucide-react';

/**
 * One half of the composer's left column (History above, Mode below). Shared by both buttons so the
 * two halves can never differ in size. `flex-1` splits the column's height between them.
 */
export const RAIL_BUTTON_CLASS =
  'flex-1 min-h-[36px] w-11 md:w-auto md:px-3 shrink-0 flex items-center justify-center gap-1.5 rounded-xl border border-line bg-card text-[11px] font-bold text-muted hover:text-ink hover:border-indigo-500 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';

export interface ModeButtonProps {
  /** Open the picker. `undefined` ⇒ render nothing (the bottom bar is carrying Mode). */
  onOpen?: (() => void) | undefined;
  /**
   * `inline` sits in a composer row beside the message box (h-12, matching a textarea's resting
   * height); `compact` is for a tighter header or toolbar. Two sizes, no free-form className for the
   * box itself — a shared control whose shape every caller can override is four controls again.
   */
  size?: 'inline' | 'compact' | 'rail';
  className?: string;
}

export function ModeButton({ onOpen, size = 'inline', className = '' }: ModeButtonProps) {
  if (!onOpen) return null;
  // `rail` (admin 2026-09-23): the lower half of the composer's left column, under History. On a phone
  // it is the icon alone — the word cost half the row's width and squeezed the message box to nothing —
  // and from `md` up, where there is room, the word comes back. The name is always in aria-label/title.
  if (size === 'rail') {
    return (
      <button
        type="button"
        onClick={onOpen}
        aria-label="Choose AI mode"
        aria-haspopup="dialog"
        title="Choose AI mode — NavBharatAI FREE, Image Generator AI or any expert"
        className={`${RAIL_BUTTON_CLASS} ${className}`}
      >
        <Layers className="w-4 h-4 shrink-0" />
        <span className="hidden md:inline">Mode</span>
      </button>
    );
  }
  const box = size === 'inline' ? 'h-12 px-3 text-[11px]' : 'h-9 px-2.5 text-[10px]';
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Choose AI mode"
      aria-haspopup="dialog"
      title="Choose AI mode — NavBharatAI FREE, Image Generator AI or any expert"
      className={`${box} shrink-0 flex items-center gap-1.5 rounded-2xl border border-line bg-card font-bold text-muted hover:text-ink hover:border-indigo-500 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${className}`}
    >
      <Layers className={size === 'inline' ? 'w-3.5 h-3.5' : 'w-3 h-3'} />
      Mode
      <ChevronDown className="w-3 h-3 text-faint" />
    </button>
  );
}
