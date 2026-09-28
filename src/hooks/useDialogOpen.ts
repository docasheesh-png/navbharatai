import { useEffect, useRef, type RefObject } from 'react';

/**
 * A dialog's two opening duties: put the focus on `focusRef` ONCE, when it opens, and close on Escape.
 *
 * 🔴 WHY THIS IS A HOOK (admin 2026-09-28: Teacher AI → Exam mode → Settings, "language ka dropdown bas 1
 * second ke liye khulta hai"). Both dialogs that did this inline wrote one effect keyed on `[onClose]`
 * and moved the focus inside it. Their parents pass `onClose` as an inline arrow, so it is a NEW function
 * on every parent render — and every re-run of the effect pulled the focus back to the heading. A native
 * `<select>` closes its list the moment it loses focus, so the language picker shut on the next render
 * of the exam screen, about a second after it opened.
 *
 * So the focus moves on OPEN only (empty deps), and Escape calls whatever `onClose` is current through a
 * ref, which keeps the listener correct without re-running anything when the parent re-renders.
 */
export function useDialogOpen(focusRef: RefObject<HTMLElement | null>, onClose: () => void): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    focusRef.current?.focus();
    // Opening only: a re-render of the parent must never take the focus back from what the user is in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCloseRef.current(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
