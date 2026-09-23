// ONE MESSAGE BOX FOR EVERY AI IN NAVBHARATAI FREE (admin 2026-09-23: "sabhi ai aur professionals ke
// inputbox ko navbharatai free ke jaisa karo — sabhi professionals navbharatai free jaise hi lagne
// chahiye").
//
// Three surfaces open from the FREE mode picker besides the free chat itself — the professionals
// (`ProfessionalChat`), Doctor AI (`SDAChat`) and the image generator — and each had hand-built its
// own composer: a square `rounded-xl` input with the paperclip OUTSIDE it on the left, a violet pill.
// Several copies of one idea is the drifted-copy class this repo keeps
// paying for, so the fix is not four restyles but ONE shell they all render:
//
//     [ 🕘 / ☰ ]  [ message box, full width           | ➤ ]
//                 [                     📎  🎤  🔊    |   ]
//
// The free chat (`AIChat.tsx`) renders this same shell, so "like the free chat" is true by
// construction rather than by copying its classes. `tests/oneComposerEverywhere.test.ts` fails if any
// of the five surfaces builds its own box again.
//
// It holds no state and sends nothing: each surface keeps its own textarea (handlers, placeholder,
// auto-grow) and its own buttons, and only takes the LOOK from here.

import React from 'react';
import { HistoryButton } from './HistoryButton';
import { ModeButton } from './ModeButton';

/** The strip the composer sits on — the free chat's, verbatim. */
export const COMPOSER_PANEL_CLASS =
  'px-3 pt-2 pb-2 border-t border-line bg-[var(--theme-card)] backdrop-blur-xl shadow-[0_-12px_40px_rgba(0,0,0,0.5)] shrink-0';

/** The rounded message box — the free chat's, verbatim. */
export const COMPOSER_BOX_CLASS =
  'bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-2xl focus-within:border-indigo-500 transition-all';

/**
 * The textarea: the box's WHOLE top row (admin 2026-09-23, with a phone screenshot of the box squeezed
 * to a sliver). It used to share one line with the controls and reserve a fixed ~176px on its right
 * for them — so the moment the box got narrow (a phone, with History and Mode beside it) the writing
 * area fell to a few pixels. The controls now have their own row underneath, so the text takes the
 * full width at ANY width, and there is no right-hand reserve to get wrong. 16px text also stops iOS
 * zooming the page on focus.
 */
export const COMPOSER_TEXTAREA_CLASS =
  'w-full bg-transparent text-[var(--theme-text)] placeholder:text-faint pl-4 pr-2 pt-2.5 pb-1 outline-none transition-all resize-none min-h-[40px] leading-relaxed text-[16px]';

/** A quiet icon control in the bottom row (attach, mic, voice, star). 36px. */
export const COMPOSER_ICON_CLASS =
  'p-2.5 text-faint hover:text-accent-text transition-colors flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed';

/**
 * Send — as TALL AS THE BOX, spanning both rows on its right (admin 2026-09-23: "send button ko bhi 2
 * line me banao"). The biggest target in the composer, at the edge the thumb reaches, and set apart
 * from the voice button by the box's own gap so a reach for Send cannot land on a paid control.
 */
export const COMPOSER_SEND_CLASS =
  'h-full min-h-[72px] w-11 bg-indigo-600 text-on-accent rounded-xl disabled:opacity-20 hover:bg-indigo-700 transition-all flex items-center justify-center shadow-lg active:scale-95';

/** The one-tap Stop that replaces Send while a reply loads — the same tall shape. */
export const COMPOSER_STOP_CLASS =
  'h-full min-h-[72px] w-11 bg-red-600 text-on-accent rounded-xl hover:bg-red-500 transition-all flex items-center justify-center shadow-lg active:scale-95';

export interface ComposerShellProps {
  /** Opens chat history. Absent ⇒ no History half in the left column. */
  onOpenHistory?: (() => void) | undefined;
  /** Opens the mode picker. Absent ⇒ no Mode half. Both absent ⇒ no left column at all. */
  onOpenMode?: (() => void) | undefined;
  /** The surface's own `<textarea>` (styled with `COMPOSER_TEXTAREA_CLASS`), plus any overlay it needs. */
  children: React.ReactNode;
  /** The quiet controls for the bottom row, right-aligned: attach, mic, voice, star. */
  controls: React.ReactNode;
  /** The Send / Stop button, which spans both rows on the right. */
  send: React.ReactNode;
}

/**
 *     ┌──┐ ┌──────────────────────────┬──┐
 *     │🕘│ │ Ask NavBharatAI…         │  │
 *     ├──┤ │                          │➤ │
 *     │☰ │ │           📎   🎤   🔊   │  │
 *     └──┘ └──────────────────────────┴──┘
 *
 * The admin's own sketch (2026-09-23). The left column is icon-only on a phone and labelled from `md`
 * up; it stretches to the box's height and its two buttons split it. Everything is `items-stretch`, so
 * as the text grows the column and the Send button grow with it.
 */
export function ComposerShell({ onOpenHistory, onOpenMode, children, controls, send }: ComposerShellProps) {
  const rail = onOpenHistory || onOpenMode ? (
    <div className="flex flex-col gap-1.5 shrink-0">
      <HistoryButton onOpen={onOpenHistory} size="rail" />
      <ModeButton onOpen={onOpenMode} size="rail" />
    </div>
  ) : null;
  return (
    <div className="flex items-stretch gap-2">
      {rail}
      <div className={`${COMPOSER_BOX_CLASS} flex-1 min-w-0 flex items-stretch`}>
        <div className="relative flex-1 min-w-0 flex flex-col">
          {children}
          <div className="flex items-center justify-end gap-1 px-1.5 pb-1">{controls}</div>
        </div>
        <div className="flex p-1.5 pl-0.5">{send}</div>
      </div>
    </div>
  );
}
