// THE TEMPORARY RED MARK ON A CARD PROPOSED FOR DELETION.
//
// ADMIN 2026-09-21: *"un par temporary red mark laga do! mai ja kar check karunga kon kon se card par
// mark hai. woh apke delete karwa dunga!!"*
//
// So this badge has exactly one job: be unmissable while walking the panel, and say WHY on a tap. The
// reasoning lives in `unusedCards.ts`, not here — this file only draws it.
//
// 🔒 IT CHANGES NOTHING ABOUT THE CARD. No card is hidden, disabled or emptied by a mark. The admin
// asked to REVIEW first and delete after, so a mark that already removed the data would have decided
// for them — and if a mark turns out to be wrong, nothing has been lost in the meantime.
//
// ⚠️ It carries `data-nb-no-copy` so a page copy sent into the chat does not read as if these labels
// were part of the panel's real content.

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { reasonLabel, unusedCard } from './unusedCards';

export interface UnusedCardMarkProps {
  /** An id registered in `unusedCards.ts`. An unknown id renders NOTHING rather than a blank badge. */
  id: string;
}

export function UnusedCardMark({ id }: UnusedCardMarkProps) {
  const [open, setOpen] = useState(false);
  const entry = unusedCard(id);
  // An id nothing registers draws no badge: a red mark with no reason behind it is the one thing that
  // would make this review untrustworthy.
  if (!entry) return null;

  return (
    <span className="inline-flex flex-col items-start gap-1 shrink-0" data-nb-no-copy="">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={`${entry.title} — proposed for deletion. Tap for the reason.`}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-danger/50 bg-danger/10 text-[9px] font-black uppercase tracking-wider text-danger"
      >
        <AlertTriangle className="w-3 h-3" />
        {reasonLabel(entry.reason)}
      </button>
      {open ? (
        <span className="block max-w-[22rem] rounded-xl border border-danger/40 bg-card p-2 text-[11px] leading-relaxed text-body">
          <span className="block font-black text-danger mb-1">Proposed for deletion</span>
          <span className="block">{entry.why}</span>
          {entry.caveat ? (
            <span className="block mt-1 text-warn font-bold">Keep in mind: {entry.caveat}</span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

export default UnusedCardMark;
