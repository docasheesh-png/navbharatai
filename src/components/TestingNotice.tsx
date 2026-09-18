import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Circle, FlaskConical, MessageSquare, X } from 'lucide-react';
import type { ThemeMode } from '../lib/theme';
import { cn } from '../lib/utils';
import { TESTING_NOTICE_COPY, TESTING_NOTICE_MS, markTestingNoticeShown } from '../lib/testingNotice';
import { checklistHeadline, type ChecklistRow } from '../lib/referralChecklist';

/**
 * "We are still testing — please report what breaks." Shown once per app open, on the home screen.
 *
 * The decision (when, how long, the words) lives in `lib/testingNotice.ts` so it is testable without
 * a DOM; this file is the surface. See that module for why it is sessionStorage rather than
 * localStorage, and why the notice carries a real button instead of an instruction.
 *
 * 🔒 THE COUNTDOWN PAUSES ON HOVER, TOUCH AND FOCUS. Three seconds is the admin's figure and is kept,
 * but a message that asks the reader to DO something must not evaporate mid-sentence — and a button
 * that disappears from under a finger is worse than no button. Pausing costs nothing when nobody is
 * looking, which is the common case.
 *
 * Motion: a plain CSS animation, so `index.css`'s `.nb-reduce-motion` rule switches it off for anyone
 * who asked for reduced motion. Nothing here needs to know about that setting.
 *
 * ── THE REWARD CHECKLIST (admin 2026-09-15) ──────────────────────────────────────────────────────
 * The admin asked for the four welcome-gift steps to appear here, ✅/❌ with their ₹ and their
 * claimed/pending state. That is additive, except for one thing it could not leave alone: THE THREE
 * SECONDS. A message asking people to report bugs can afford to vanish; one showing somebody ₹100
 * they have not collected cannot, because once it has gone they cannot get it back until the next
 * cold start. So while anything is unclaimed the countdown NEVER STARTS and the user closes it
 * themselves; once everything is claimed the money section disappears and the three seconds return.
 * The decision lives in `lib/referralChecklist.ts` — this file only renders it.
 */
export const TestingNotice: React.FC<{
  theme: ThemeMode;
  /** Opens the app-wide "Report a problem" sheet — the same one the sidebar and a phone shake open. */
  onReport: () => void;
  /** Called when the notice leaves the screen, however it left. */
  onDone: () => void;
  /**
   * The unclaimed-reward rows, or empty. EMPTY IS THE DEFAULT AND MEANS "behave exactly as before" —
   * on the website, for a signed-out visitor, while the lookup is in flight, and for anyone who has
   * claimed all four. Nothing about the notice changes until there is genuinely money on screen.
   */
  rewardRows?: ChecklistRow[];
  /** Opens the screen where the pending steps can actually be completed. */
  onOpenRewards?: () => void;
}> = ({ onReport, onDone, rewardRows = [], onOpenRewards }) => {
  // THE FIRST FILE ON TOKENS (admin 2026-09-18, "pura theme system badlo"). `getThemeClasses(theme)`
  // used to hand this card one hardcoded palette per theme; the `theme` prop is kept in the contract
  // so App.tsx is untouched, but the colours now come from the semantic tokens in index.css —
  // `bg-card`, `border-line`, `text-ink` — which every theme defines. tests/themeTokensOnly.test.ts
  // holds this file at ZERO literal colours; it is the proof the token pipeline works end to end.
  const [leaving, setLeaving] = useState(false);
  const [paused, setPaused] = useState(false);
  // One timer, cleared on every path out — a stray timer would fire onDone after the parent unmounted.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closed = useRef(false);

  const close = useCallback(() => {
    if (closed.current) return; // the X and the timer can both arrive; the second must be a no-op
    closed.current = true;
    if (timer.current) clearTimeout(timer.current);
    setLeaving(true);
    // Long enough for the exit animation; reduced motion simply skips the animation, not the delay,
    // so the two paths agree on when `onDone` fires.
    setTimeout(onDone, 200);
  }, [onDone]);

  // Remember it was shown the moment it IS shown — not when it closes. A user who navigates away
  // after one second has still seen it, and showing it again on their next tap Home is the nagging
  // reading of "once per app open".
  useEffect(() => { markTestingNoticeShown(); }, []);

  // 🔒 UNCLAIMED MONEY MEANS NO COUNTDOWN AT ALL — not a longer one, and not merely a paused one.
  // A timer that fires while somebody is reading four lines about ₹100 takes the money off the
  // screen, and they cannot ask for it back.
  const waitForUser = rewardRows.some((r) => !r.claimed);

  useEffect(() => {
    if (paused || closed.current || waitForUser) return;
    timer.current = setTimeout(close, TESTING_NOTICE_MS);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [paused, close, waitForUser]);

  const hold = useCallback(() => setPaused(true), []);
  const release = useCallback(() => setPaused(false), []);

  return (
    <div
      // `status` + polite: it is information, not an alert — it must not interrupt a screen reader
      // mid-sentence, and it is not an error.
      role="status"
      aria-live="polite"
      onMouseEnter={hold}
      onMouseLeave={release}
      onFocus={hold}
      onBlur={release}
      onTouchStart={hold}
      onTouchEnd={release}
      className={cn(
        // 🔴 CENTRED WITHOUT A TRANSFORM, DELIBERATELY — see the note above `nb-testing-notice-in`
        // in index.css. `left-1/2 -translate-x-1/2` put the card HALF OFF THE LEFT EDGE on a real
        // phone, because Tailwind v4 centres with the standalone `translate` property while the
        // entry animation centres again with `transform`, and CSS applies both. Left and right
        // insets plus `mx-auto` need no transform at all, so the animation owns `transform` alone
        // and the two can never fight again.
        'fixed z-[60] mx-auto max-w-md',
        'left-[calc(env(safe-area-inset-left,0px)+1rem)] right-[calc(env(safe-area-inset-right,0px)+1rem)]',
        // Below the top bar on every screen, and clear of the notch on a phone.
        'top-[calc(env(safe-area-inset-top,0px)+4.5rem)]',
        'rounded-2xl border p-3.5 shadow-2xl backdrop-blur',
        'bg-card border-line text-ink',
        leaving ? 'nb-testing-notice-out' : 'nb-testing-notice-in',
      )}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 rounded-lg bg-amber-500/15 p-1.5 text-warn">
          <FlaskConical size={16} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold leading-snug">{TESTING_NOTICE_COPY.title}</p>
          <p className="mt-0.5 text-xs leading-snug opacity-80">{TESTING_NOTICE_COPY.body}</p>
          {waitForUser && (
            <div className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-2.5">
              <p className="text-[11px] font-bold text-success">{checklistHeadline(rewardRows)}</p>
              <ul className="mt-1.5 space-y-1">
                {rewardRows.map((row) => (
                  <li key={row.step} className="flex items-start gap-1.5 text-[11px] leading-snug">
                    {row.claimed
                      ? <CheckCircle2 size={13} className="mt-px shrink-0 text-success" aria-hidden="true" />
                      : <Circle size={13} className="mt-px shrink-0 opacity-40" aria-hidden="true" />}
                    <span className={row.claimed ? 'opacity-60' : 'font-semibold'}>{row.label}</span>
                  </li>
                ))}
              </ul>
              {onOpenRewards && (
                <button
                  onClick={() => { close(); onOpenRewards(); }}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-on-accent hover:bg-emerald-500"
                >
                  Claim now
                </button>
              )}
            </div>
          )}
          <button
            onClick={() => { close(); onReport(); }}
            className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-on-accent hover:bg-indigo-500"
          >
            <MessageSquare size={13} aria-hidden="true" /> {TESTING_NOTICE_COPY.action}
          </button>
        </div>
        <button
          onClick={close}
          aria-label={TESTING_NOTICE_COPY.dismiss}
          className="shrink-0 rounded-lg p-1 opacity-50 transition-opacity hover:opacity-100"
        >
          <X size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};
