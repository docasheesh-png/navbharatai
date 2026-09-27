import React from 'react';
import { FlaskConical, MessageSquare } from 'lucide-react';
import { TESTING_NOTICE_COPY } from '../lib/testingNotice';

/**
 * "We are still testing — please report what breaks." A card pinned in the Notifications panel.
 *
 * It used to float over the home screen once per app open; the admin moved it here on 2026-09-27
 * (*"popup ki jagah notification me aye, jisse user disturb na ho"*). Same icon, same words, same
 * button — only its place changed. Everything about WHEN it raises a dot lives in
 * `lib/testingNotice.ts`, so it is testable without a DOM; this file only draws it.
 *
 * It is not a message: it cannot be selected or deleted, and the panel hides it while selecting, the
 * same treatment the rewards checklist gets beside it.
 *
 * Colour comes from theme tokens only — `tests/themeTokensOnly.test.ts` holds this file at zero literals.
 */
export const TestingNoticeCard: React.FC<{
  /** Opens the app-wide "Report a problem" sheet — the same one the sidebar and a phone shake open. */
  onReport: () => void;
}> = ({ onReport }) => (
  <div className="px-4 py-3 border-b bg-card border-line text-ink" data-testid="testing-notice">
    <div className="flex items-start gap-3">
      <span className="mt-0.5 shrink-0 rounded-lg bg-amber-500/15 p-1.5 text-warn">
        <FlaskConical size={16} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-bold leading-snug">{TESTING_NOTICE_COPY.title}</p>
        <p className="mt-0.5 text-[12px] leading-snug text-muted">{TESTING_NOTICE_COPY.body}</p>
        <button
          onClick={onReport}
          className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-on-accent hover:bg-indigo-500"
        >
          <MessageSquare size={13} aria-hidden="true" /> {TESTING_NOTICE_COPY.action}
        </button>
      </div>
    </div>
  </div>
);
