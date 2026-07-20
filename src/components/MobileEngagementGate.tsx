import React, { useEffect } from 'react';
import { checkForAppUpdate, maybeRequestReview } from '../lib/mobileNative';

// Mobile engagement gate (admin request 2026-07-11; narrowed 2026-07-20). Rendered once inside the
// native app shell; a pure no-op on web.
//
// The "update available" prompt now lives INSIDE the AI chat as the first message (admin 2026-07-20:
// AppUpdateChatNotice — contextual, in the user's language, with a store button). So this gate no
// longer shows its own bottom banner — that would double-prompt. It keeps ONE responsibility: at a
// good moment, consider the native rating card.
//
// It still checks whether an update is pending, but only to DECIDE ABOUT THE REVIEW: never ask a
// user to rate a version they're about to replace. If an update is pending, the chat notice handles
// it and we skip the review this session; otherwise we consider the earned-review prompt.
//
// Renders nothing (the review card is a native OS surface), so it adds zero DOM.
export const MobileEngagementGate: React.FC = () => {
  useEffect(() => {
    let alive = true;
    void (async () => {
      const updateAvailable = await checkForAppUpdate();
      if (!alive) return;
      // If an update is pending, the in-chat AppUpdateChatNotice handles it — don't also ask for a
      // rating on the outgoing version. Otherwise, consider the native review card (thresholded).
      if (!updateAvailable) void maybeRequestReview();
    })();
    return () => { alive = false; };
  }, []);

  return null;
};
