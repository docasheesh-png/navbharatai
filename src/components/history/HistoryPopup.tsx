// HistoryPopup — the Free chat's History, opened OVER the conversation instead of replacing it.
//
// Admin 2026-08-28: "NavBharatAI Pro v5 jaise history chat ke andar hi popup jaise khulti hai — free
// me bhi waisa hi." v5's History is a panel that drops over the build you are already in; Free's
// switched the whole app to a separate tab, so you left your conversation to look at a list of
// conversations and then had to navigate back.
//
// 🔒 IT RENDERS THE EXISTING HistoryView, IT DOES NOT REIMPLEMENT IT. The merged Free + Doctor AI +
// professionals list, and the per-row mode tag the admin asked for, already shipped on 2026-08-25
// (PR #2687) and are covered by their own tests. A second list would be a second set of bugs and
// would drift from the tab the moment either changed — so this component is a CONTAINER: backdrop,
// panel, header, close behaviour. Nothing about which rows appear or how they are tagged lives here.

import React, { useEffect, useRef } from 'react';
import { X, History as HistoryIcon } from 'lucide-react';
import { HistoryView } from '../HistoryView';

export interface HistoryPopupProps {
  user: any;
  /** Closes the popup — backdrop, ✕, Escape, and after any row is opened. */
  onClose: () => void;
  onRestoreSession?: (uci: string) => void;
  onDeleteSession?: (id: string) => void;
  onOpenProfessional?: (viewId: string) => void;
}

// NO `filter` PROP, DELIBERATELY. The popup serves the Free surface only (see historySurface.ts), so
// the list is always the merged, tagged Free view. A prop with one possible value advertises a
// flexibility that does not exist — and HistoryView has no 'professional' filter at all: the
// Professionals hub renders a different component entirely, which is exactly why that surface keeps
// the tab and is not routed through here.

export const HistoryPopup: React.FC<HistoryPopupProps> = ({
  user,
  onClose,
  onRestoreSession,
  onDeleteSession,
  onOpenProfessional,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);

  // ESCAPE CLOSES IT. A popup with no keyboard exit is a trap for anyone on a physical keyboard, and
  // the listener is removed on unmount so it can never outlive the popup and swallow a later Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Move focus into the panel so a screen reader lands here rather than staying on the chat behind it.
  useEffect(() => { panelRef.current?.focus(); }, []);

  // OPENING A ROW MUST ALSO CLOSE THE POPUP. Without this the chosen conversation loads UNDERNEATH a
  // list that is still covering it — the user taps, something happens, and they see the same list.
  const closeAfter = <T,>(fn: ((arg: T) => void) | undefined) => (arg: T) => { fn?.(arg); onClose(); };

  return (
    <div className="fixed inset-0 z-[130] flex items-end sm:items-center sm:justify-center">
      <div
        className="absolute inset-0 bg-black/60 cursor-pointer touch-manipulation"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Chat history"
        className={
          'relative w-full sm:max-w-2xl bg-[#0d1117] border border-zinc-800 shadow-2xl outline-none '
          // A bottom sheet on a phone (thumb reach) and a centred dialog on a wider screen. The height
          // is capped so the popup always reads as something laid OVER the chat rather than a new
          // screen, and the list inside scrolls instead of the page behind it.
          + 'rounded-t-2xl sm:rounded-2xl max-h-[80vh] supports-[height:100dvh]:max-h-[80dvh] flex flex-col'
        }
      >
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-zinc-800 shrink-0">
          <HistoryIcon className="w-4 h-4 text-indigo-400 shrink-0" />
          <span className="text-sm font-semibold text-zinc-200 truncate min-w-0">Chat history</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close history"
            className="ml-auto p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 shrink-0 touch-manipulation"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {/* pb-[env(safe-area-inset-bottom)]: on a phone the sheet sits against the bottom edge, where
            the home indicator would otherwise cover the last row. */}
        <div className="flex-1 min-h-0 overflow-y-auto pb-[env(safe-area-inset-bottom,0px)]">
          <HistoryView
            user={user}
            onRestoreSession={closeAfter(onRestoreSession)}
            onDeleteSession={onDeleteSession}
            initialFilter="free"
            lockFilter
            includeProfessionals
            onOpenProfessional={closeAfter(onOpenProfessional)}
          />
        </div>
      </div>
    </div>
  );
};
