// ReportNoteDialog — "what went wrong?", asked before a build report is sent to the admin.
//
// Admin 2026-08-28: "jab user report button press kare, to ek input box popup open ho, jahan user
// apni problem likh sake, aur user ka text build report me aa jaye."
//
// WHY IT IS WORTH A DIALOG. The report already carries a complete technical record of the build, and
// that record answers only the engine's own question — did this meet the engine's expectations? It
// cannot say the button does nothing, the app is the wrong app, or the Hindi came out as English.
// Those are the failures every automated check passes straight over, and only the person looking at
// the screen can report them.
//
// 🔒 THE BOX IS OPTIONAL, DELIBERATELY. Making it compulsory would produce reports that say "." to
// get past it, and a forced full stop is worse evidence than an honest blank — it looks like a
// description and contains nothing. Send is always enabled; the placeholder does the persuading.

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, AlertTriangle, Loader2 } from 'lucide-react';

/**
 * Must equal the server's USER_NOTE_MAX (AdminBuildReportStore).
 *
 * The server caps as a defence against a crafted request; this cap is what the USER experiences. They
 * have to match, or a user types a long, careful description, sees no warning, and silently loses the
 * end of it — the one outcome worse than no note at all. Pinned by a test that imports both.
 */
export const REPORT_NOTE_MAX = 2000;

export interface ReportNoteDialogProps {
  /** Which build this note is about, shown so the user knows what they are describing. */
  buildLabel?: string;
  sending: boolean;
  onCancel: () => void;
  onSend: (note: string) => void;
}

export const ReportNoteDialog: React.FC<ReportNoteDialogProps> = ({ buildLabel, sending, onCancel, onSend }) => {
  const [note, setNote] = useState('');
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // Focus the box, because the box IS the dialog — anything else makes the user click twice to do
  // the only thing this screen is for.
  useEffect(() => { areaRef.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !sending) onCancel();
      // Ctrl/Cmd+Enter sends — the convention everywhere else a multi-line box has a submit.
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !sending) onSend(note);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [note, sending, onCancel, onSend]);

  const left = REPORT_NOTE_MAX - note.length;

  // 🔒 PORTALLED TO THE BODY (2026-09-22), and that is what decides the z-index question.
  //
  // Rendered in place, this dialog lived inside AgentV3Panel — a subtree that can carry a transform
  // or a backdrop-filter, either of which becomes the CONTAINING BLOCK for a `position: fixed`
  // descendant (tests/theSheetOpensOverTheScreenNotInsideAFooter.test.ts records an image size
  // selector breaking exactly that way). Measured in place, the card rested 90px UNDER the tab bar.
  //
  // Portalled, it is appended after the app root, so at z-150 — EQUAL to the bar's — it paints
  // OVER the bar by DOM order, deterministically. That is why it takes `nb-sheet-over-nav`, which is
  // the rule `sheetOverlayGeometry.test.ts` already enforces for z ≥ 150: a sheet that covers the
  // bar must not also hold a strip for it. (An earlier draft of this change reasoned the opposite
  // from the un-portalled position; that test caught it.)
  const sheet = (
    <div className="nb-sheet-overlay-flush nb-sheet-over-nav fixed inset-0 z-[150] flex items-end sm:items-center sm:justify-center">
      <div
        className="absolute inset-0 bg-scrim cursor-pointer touch-manipulation"
        onClick={() => { if (!sending) onCancel(); }}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Describe the problem"
        // `nb-sheet-partial` keeps the design's "laid over the page" 85%, but CLAMPED to the room
        // the overlay really has — a bare 85vh is measured against the LARGE viewport and against a
        // screen that still owes space to the notch and the tab bar.
        className="nb-sheet-partial relative w-full sm:max-w-lg bg-card border border-line shadow-2xl rounded-t-2xl sm:rounded-2xl flex flex-col"
        style={{ ['--nb-sheet-cap' as string]: '85%' }}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-line shrink-0">
          <AlertTriangle className="w-4 h-4 text-warn shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-body truncate">What went wrong?</div>
            {buildLabel && <div className="text-[11px] text-faint truncate">{buildLabel}</div>}
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={sending}
            aria-label="Cancel"
            className="ml-auto p-1.5 rounded-lg text-muted hover:text-body hover:bg-raised disabled:opacity-40 shrink-0 touch-manipulation"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto">
          <textarea
            ref={areaRef}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={REPORT_NOTE_MAX}
            rows={5}
            placeholder="Tell us what happened in your own words — what you expected, and what you got instead. For example: “the Save button does nothing”, “it built a to-do app but I asked for a shop”, “the page is blank on my phone”."
            className="w-full resize-y rounded-xl bg-surface border border-line px-3 py-2.5 text-sm text-body placeholder-faint focus:outline-none focus:border-indigo-500 leading-relaxed"
          />
          <div className="mt-1.5 flex items-center gap-2 text-[11px]">
            <span className="text-faint">
              Your build details are attached automatically — you only need to describe the problem.
            </span>
            {/* The counter appears only when it starts to matter. A permanent 2000-character counter
                is noise; one that arrives near the limit is a warning. */}
            {left <= 200 && (
              <span className={`ml-auto tabular-nums shrink-0 ${left <= 0 ? 'text-danger' : 'text-warn'}`}>{left}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 px-4 py-3 border-t border-line shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={onCancel}
            disabled={sending}
            className="px-3 py-2 rounded-xl text-sm text-muted hover:bg-raised disabled:opacity-40 touch-manipulation"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSend(note)}
            disabled={sending}
            className="ml-auto inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-on-accent text-sm font-semibold touch-manipulation"
          >
            {sending ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</> : 'Send report'}
          </button>
        </div>
      </div>
    </div>
  );
  // With no document (a server render, or `renderToStaticMarkup` in this file's own test) there is no
  // body to portal into, so the sheet renders in place — the only meaningful thing to do there, and
  // what keeps its content assertions honest rather than rendering nothing to satisfy them.
  return typeof document === 'undefined' ? sheet : createPortal(sheet, document.body);
};
