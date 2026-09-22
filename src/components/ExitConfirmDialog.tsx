// "Exit NavBharatAI?" — the one thing standing between Android's Back button and a closed app.
//
// WHY IT EXISTS (admin 2026-09-17): Back used to close the app instantly from every screen. Going
// straight from "I tapped Back" to "my app is gone, mid-build" is the single most common way a phone
// app earns a one-star review, and it is why every serious Android app asks first.
//
// THE RULES THIS FOLLOWS, and each is deliberate rather than decorative:
//   • ENGLISH, as the admin asked and as the language standard in CLAUDE.md requires of all UI text.
//   • CANCEL IS THE SAFE DEFAULT — it holds the initial focus, so a stray Enter on a keyboard-attached
//     device keeps the user in the app. Destructive actions never start focused.
//   • ESCAPE CANCELS, and so does the hardware Back button (handled by the caller's own decision
//     table). Back must dismiss this dialog, never confirm it.
//   • THE BACKDROP DOES NOT DISMISS. An accidental tap beside a dialog should not be able to decide
//     anything; the two buttons are the only answers, which is also what keeps the choice honest.
//   • IT TRAPS FOCUS while open, so a screen reader or a keyboard cannot wander into the page behind
//     a modal question.

import React, { useCallback, useEffect, useRef } from 'react';
import { LogOut } from 'lucide-react';

export interface ExitConfirmDialogProps {
  open: boolean;
  /** The user chose to leave. */
  onExit: () => void;
  /** The user chose to stay — Cancel, Escape, or the hardware Back button. */
  onCancel: () => void;
}

export const ExitConfirmDialog: React.FC<ExitConfirmDialogProps> = ({ open, onExit, onCancel }) => {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Focus lands on CANCEL, never on Exit — see the header. Deferred a frame because the element does
  // not exist until this render has been committed.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => cancelRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { e.stopPropagation(); onCancel(); return; }
    if (e.key !== 'Tab') return;
    // A modal question must not let focus escape to the page behind it. Two focusables, so the trap is
    // a wrap rather than a general implementation — simpler, and it cannot go wrong on a third element
    // that does not exist.
    const focusables = panelRef.current?.querySelectorAll<HTMLElement>('button');
    if (!focusables || focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }, [onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-5 bg-scrim backdrop-blur-sm"
      role="presentation"
      onKeyDown={onKeyDown}
    >
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="nbai-exit-title"
        aria-describedby="nbai-exit-body"
        className="w-full max-w-[340px] rounded-2xl bg-card border border-line shadow-2xl p-5"
      >
        <div className="flex items-center gap-2.5 mb-2">
          <span className="w-9 h-9 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center flex-shrink-0">
            <LogOut size={16} className="text-danger" />
          </span>
          <h2 id="nbai-exit-title" className="text-base font-bold text-ink">Exit NavBharatAI?</h2>
        </div>

        <p id="nbai-exit-body" className="text-sm text-muted leading-relaxed mb-5">
          Do you want to close the app? Your work is saved.
        </p>

        <div className="flex gap-2.5">
          {/* Cancel first in the DOM so it takes focus, and GRAY as the admin specified — the calm
              choice should not compete with the destructive one for attention. */}
          <button
            ref={cancelRef}
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 rounded-xl bg-raised hover:bg-raised-hover text-ink text-sm font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-line"
          >
            Cancel
          </button>
          <button
            onClick={onExit}
            className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-on-accent text-sm font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-red-400/60"
          >
            Exit
          </button>
        </div>
      </div>
    </div>
  );
};
