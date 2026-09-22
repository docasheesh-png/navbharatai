// "YOUR BALANCE IS EMPTY" IS AN ACTION, NOT AN ERROR — the ONE card that says so (admin 2026-09-22).
//
// Admin: *"agar user ke pas balance khatam hai, to proper likh kar ana chahiye. this is paid
// service!!"* The server already answers with an honest sentence and a machine-readable code
// (`walletEmptyNotice.ts`), and `walletEmptyRefusal.ts` is the one predicate that recognises it.
// This is the third and last piece: what the user actually SEES when it happens.
//
// 🔴 WHY IT IS A COMPONENT AND NOT A COPIED `<div>`. The image studio shipped this card first, and
// four more screens needed the same one — Doctor AI, the App Debugger, the Design System and the
// App Scanner. This repo has paid for the drifted-copy class at least five times (`safeRelPath` ×4,
// `tagsOnLine` ×2, the HTML boot guard ×2, `PLAYWRIGHT_BROWSERS_PATH` ×2, the empty-balance SENTENCE
// itself ×3 — which is what `walletEmptyNotice.ts` exists to have ended). Five hand-written copies
// of a PRICE explanation is the same bug waiting to happen in the one place a user is being asked
// for money.
//
// 🔒 THERE IS NO "TRY AGAIN" HERE, ON PURPOSE. The next press would be refused by the same gate, so
// offering a retry is what made a price look like a bug. The only control is the one that works.
import React from 'react';
import { Wallet } from 'lucide-react';
import { openAddCredit } from '../../lib/walletEmptyRefusal';

export interface AddCreditNoticeProps {
  /** The server's own sentence (via `walletEmptyMessage`) — it is the only one that knows the balance. */
  message: string;
  /** Container classes, so a chat bubble keeps its bubble shape and a panel banner keeps its own. */
  className?: string;
  /** Optional heading override; the default is the instruction, not a diagnosis. */
  title?: string;
}

export function AddCreditNotice({ message, className, title }: AddCreditNoticeProps): React.ReactElement {
  return (
    <div className={className ?? 'rounded-lg border border-line bg-card px-3 py-3 space-y-2'}>
      <p className="text-xs font-semibold text-warn">{title ?? 'Add credit to carry on'}</p>
      <p className="text-xs text-muted leading-relaxed">{message}</p>
      <button
        type="button"
        onClick={openAddCredit}
        className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[11px] font-semibold text-on-accent"
      >
        <Wallet className="w-3.5 h-3.5" /> Add credit
      </button>
    </div>
  );
}

export default AddCreditNotice;
