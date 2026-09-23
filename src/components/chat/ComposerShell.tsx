// ONE MESSAGE BOX FOR EVERY AI IN NAVBHARATAI FREE (admin 2026-09-23: "sabhi ai aur professionals ke
// inputbox ko navbharatai free ke jaisa karo — sabhi professionals navbharatai free jaise hi lagne
// chahiye").
//
// Four surfaces open from the FREE mode picker besides the free chat itself — the professionals
// (`ProfessionalChat`), Doctor AI (`SDAChat`), the image generator and Image Studio Pro — and each had
// hand-built its own composer: a square `rounded-xl` input with the paperclip OUTSIDE it on the left,
// a violet pill, an amber pill. Four copies of one idea is the drifted-copy class this repo keeps
// paying for, so the fix is not four restyles but ONE shell they all render:
//
//     [ left controls, e.g. Mode ▾ ]  [ message box ……………… 📎 🎤 🔊 ➤ ]
//
// The box, its text and its control row are the free chat's own (`AIChat.tsx`, the composer the admin
// pointed at). `tests/everyComposerLooksLikeTheFreeChat.test.ts` reads AIChat's classes back and fails
// if these constants ever stop matching them, so the two cannot drift either.
//
// It holds no state and sends nothing: each surface keeps its own textarea (handlers, placeholder,
// auto-grow) and its own buttons, and only takes the LOOK from here.

import React from 'react';

/** The strip the composer sits on — the free chat's, verbatim. */
export const COMPOSER_PANEL_CLASS =
  'px-3 pt-2 pb-2 border-t border-line bg-[var(--theme-card)] backdrop-blur-xl shadow-[0_-12px_40px_rgba(0,0,0,0.5)] shrink-0';

/** The rounded message box — the free chat's, verbatim. */
export const COMPOSER_BOX_CLASS =
  'bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-2xl focus-within:border-indigo-500 transition-all';

/**
 * The textarea inside the box. Same 48px resting height, left inset and 16px text as the free chat (16px
 * also stops iOS zooming the page on focus). The RIGHT inset is not here: it depends on how many controls
 * sit in the row, so each surface sets it with `composerTextPadding`.
 */
export const COMPOSER_TEXTAREA_CLASS =
  'w-full bg-transparent text-[var(--theme-text)] placeholder:text-faint pl-5 py-2.5 outline-none transition-all resize-none min-h-[48px] leading-relaxed text-[16px]';

/** A quiet icon control in the row (attach, mic, star). 36px, like every control in the free chat's row. */
export const COMPOSER_ICON_CLASS =
  'p-2.5 text-faint hover:text-accent-text transition-colors flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed';

/** The send button — the free chat's. */
export const COMPOSER_SEND_CLASS =
  'p-2.5 bg-indigo-600 text-on-accent rounded-xl disabled:opacity-20 hover:bg-indigo-700 transition-all flex items-center justify-center shadow-lg active:scale-95';

/** The one-tap Stop that replaces Send while a reply loads — the free chat's. */
export const COMPOSER_STOP_CLASS =
  'p-2.5 bg-red-600 text-on-accent rounded-xl hover:bg-red-500 transition-all flex items-center justify-center shadow-lg active:scale-95';

/**
 * How far typed text must stay from the right edge so it never runs under the control row. Each control
 * is 36px with a 4px gap and the row is inset 8px — the arithmetic the free chat's own comment derives.
 * Pure.
 */
export function composerTextPadding(controls: number): string {
  const n = Number.isFinite(controls) && controls > 0 ? Math.floor(controls) : 0;
  return `${n === 0 ? 20 : 8 + n * 36 + (n - 1) * 4 + 8}px`;
}

export interface ComposerShellProps {
  /** Controls OUTSIDE the box, on its left (Mode, and later History). Absent ⇒ the box takes the row. */
  left?: React.ReactNode;
  /** The surface's own `<textarea>`, styled with `COMPOSER_TEXTAREA_CLASS`. */
  children: React.ReactNode;
  /** The controls INSIDE the box, on its right, in the free chat's order: attach, mic, voice, send. */
  controls: React.ReactNode;
}

export function ComposerShell({ left, children, controls }: ComposerShellProps) {
  const box = (
    <div className={COMPOSER_BOX_CLASS}>
      <div className="relative flex items-center">
        {children}
        <div className="absolute right-2 bottom-1.5 flex gap-1 items-center">{controls}</div>
      </div>
    </div>
  );
  if (!left) return box;
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-end gap-2">
      <div className="flex items-end gap-2">{left}</div>
      {box}
    </div>
  );
}
