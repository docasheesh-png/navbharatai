// WHAT THE USER MUST DO — the tray (admin 2026-09-20).
//
// THE COMPLAINT this answers, verbatim: *"yeh cheez abhi text chat me hi hai, aur bahut sare
// navbharatai ke response me kahi dab jati hai! ab isko bahar rakh do! user se jo jo chahiye woh sab
// question mark ❓ me!"*
//
// Every ask the build makes now lands here instead of scrolling past in the narration: the credential
// form (the SAME card as before, handed in as a slot rather than rebuilt), the gate a build is
// stopped on, and the assumptions it wants corrected. Each row ends in a decision the user can
// actually record, which is the thing that did not exist at all before: *"uske last me 'done' button
// ho, jab user woh kaam kar le to user done press karega."*
//
// ⚠️ NO ROW IS A DEAD END. Every one of them also offers "Ask NavBharatAI", which loads a question
// into the composer for the user to edit and send — because the answer the tray expects may not be
// the answer the user has (*"ho sakta hai user kuch aur soch raha ho"*). Nothing is ever sent for
// them: a message they did not choose to send is not a conversation, and it would spend their money.

import { useMemo, useState, type ReactNode } from 'react';
import { X, Check, MessageSquare, Ban, ChevronDown, ChevronRight } from 'lucide-react';
import {
  GROUP_TITLES, closedNote, closedRows, groupedOpen, isLiveOnly, traySummary,
  type UserActionView,
} from './userActionView';

const BTN = 'inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-all disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';

export function UserActionTray({
  actions,
  busyId,
  secretCard,
  onClose,
  onDone,
  onNotNeeded,
  onAsk,
  onAnswerGate,
}: {
  actions: readonly UserActionView[];
  /** The row currently being written, so its buttons cannot be double-pressed. */
  busyId: string | null;
  /**
   * The existing credential form, passed in rather than re-implemented.
   *
   * It saves straight to the encrypted vault and answers the waiting build; none of that logic is
   * duplicated here. Moving WHERE it mounts is the whole change — a second copy of a form that
   * handles live credentials is exactly the drift this repo keeps paying for elsewhere.
   */
  secretCard?: ReactNode;
  onClose: () => void;
  onDone: (action: UserActionView) => void;
  onNotNeeded: (action: UserActionView) => void;
  onAsk: (action: UserActionView) => void;
  onAnswerGate: (action: UserActionView, approve: boolean) => void;
}) {
  const [showDone, setShowDone] = useState(false);
  const groups = useMemo(() => groupedOpen(actions), [actions]);
  const done = useMemo(() => closedRows(actions), [actions]);
  const openCount = groups.reduce((n, g) => n + g.items.length, 0);

  const row = (action: UserActionView) => {
    const busy = busyId === action.id;
    return (
      <div key={action.id} className="px-3 py-2.5 rounded-xl border border-line bg-card">
        <div className="text-[13px] font-semibold text-ink break-words">{action.title}</div>
        {action.why && <div className="text-[11px] text-muted mt-0.5 break-words">{action.why}</div>}
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          {action.kind === 'approve' ? (
            <>
              <button type="button" disabled={busy} onClick={() => onAnswerGate(action, true)} className={`${BTN} bg-indigo-600 hover:bg-indigo-500 text-on-accent`}>
                <Check className="w-3.5 h-3.5" /> Approve &amp; build
              </button>
              <button type="button" disabled={busy} onClick={() => onAnswerGate(action, false)} className={`${BTN} bg-raised hover:bg-raised-hover text-body`}>
                <Ban className="w-3.5 h-3.5" /> Reject
              </button>
            </>
          ) : isLiveOnly(action) ? null : (
            <>
              <button type="button" disabled={busy} onClick={() => onDone(action)} className={`${BTN} bg-indigo-600 hover:bg-indigo-500 text-on-accent`}>
                <Check className="w-3.5 h-3.5" /> Done
              </button>
              <button type="button" disabled={busy} onClick={() => onNotNeeded(action)} className={`${BTN} bg-raised hover:bg-raised-hover text-body`}>
                <Ban className="w-3.5 h-3.5" /> Not needed
              </button>
            </>
          )}
          <button type="button" disabled={busy} onClick={() => onAsk(action)} className={`${BTN} bg-raised hover:bg-raised-hover text-body`}>
            <MessageSquare className="w-3.5 h-3.5" /> Ask NavBharatAI
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center" role="dialog" aria-modal="true" aria-label="What you need to do">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-scrim backdrop-blur-sm" />
      <div
        className="relative w-full sm:max-w-md bg-surface border-t sm:border border-line sm:rounded-2xl rounded-t-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: 'min(72dvh, 40rem)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="flex items-start justify-between px-4 pt-4 pb-2">
          <div>
            <h3 className="text-[13px] font-black uppercase tracking-widest text-ink">What you need to do</h3>
            <p className="text-[11px] text-muted mt-0.5">{traySummary(openCount)}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-muted hover:text-ink hover:bg-raised">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 pb-4 overflow-y-auto flex flex-col gap-3">
          {groups.map((section) => (
            <div key={section.group} className="flex flex-col gap-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-faint">{GROUP_TITLES[section.group]}</div>
              {section.group === 'needed' && secretCard}
              {section.items.map(row)}
            </div>
          ))}

          {/* An empty tray is reachable only by opening it deliberately — the badge is not rendered at
              zero — so it says so plainly instead of inventing something to show. */}
          {groups.length === 0 && !secretCard && (
            <div className="px-3 py-6 text-center text-[12px] text-muted">Nothing is waiting on you right now.</div>
          )}

          {done.length > 0 && (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setShowDone((v) => !v)}
                aria-expanded={showDone}
                className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-faint hover:text-muted"
              >
                {showDone ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                Done ({done.length})
              </button>
              {showDone && done.map((action) => (
                <div key={action.id} className="px-3 py-2 rounded-xl border border-line bg-well">
                  <div className="text-[12px] text-muted line-through break-words">{action.title}</div>
                  <div className="text-[10px] text-faint mt-0.5">{closedNote(action)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
