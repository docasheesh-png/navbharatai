// Shared state for the "app update available" chat notice (admin 2026-07-20). When the admin
// publishes a new version to Play / App Store, native-app users should see an update prompt as the
// FIRST message the moment they chat with any AI, in their own language, with a button that deep-
// links to the store. This module is the single source of truth so every chat surface shares ONE
// native check (not N) and one dismiss state — dismiss it in any AI and it hides everywhere for the
// session ("bas 1st message").
//
// The real update detection + store deep-link live in mobileNative.ts (the @capawesome app-update
// plugin — Play In-App Update on Android, App Store version lookup on iOS). On web every call is a
// no-op / false, so the notice never shows there.

import { useEffect, useState } from 'react';
import { checkForAppUpdate, openAppStoreForUpdate } from './mobileNative';

// One native check per app load, memoized — shared by every mounted notice + the engagement gate.
let cachedCheck: Promise<boolean> | null = null;
function checkUpdateOnce(): Promise<boolean> {
  if (!cachedCheck) cachedCheck = checkForAppUpdate().catch(() => false);
  return cachedCheck;
}

// Session-wide dismiss: once the user updates or closes the notice in ANY surface, it stays hidden
// for the rest of the session. Module-level (not persisted) — a fresh app launch re-checks honestly.
let dismissed = false;
const dismissListeners = new Set<() => void>();

/** Hide the update notice across every surface for the rest of this session. */
export function dismissUpdateNotice(): void {
  dismissed = true;
  dismissListeners.forEach((l) => l());
}

/** True once the notice has been dismissed this session. */
export function isUpdateNoticeDismissed(): boolean {
  return dismissed;
}

export interface AppUpdateNotice {
  /** A newer version is live on the store AND the notice hasn't been dismissed this session. */
  show: boolean;
  /** Dismiss the notice everywhere for this session. */
  dismiss: () => void;
  /** Open the Play / App Store listing so the user can install the update. */
  openStore: () => Promise<void>;
}

/**
 * React hook: whether to show the app-update chat notice, plus the dismiss + open-store actions.
 * Runs the (memoized) native update check once and re-renders when it resolves or when any surface
 * dismisses the notice. Returns show=false on web and until the check confirms an update.
 */
export function useAppUpdateNotice(): AppUpdateNotice {
  const [available, setAvailable] = useState(false);
  const [isDismissed, setIsDismissed] = useState<boolean>(dismissed);

  useEffect(() => {
    let alive = true;
    void checkUpdateOnce().then((v) => { if (alive) setAvailable(v); });
    const onDismiss = () => setIsDismissed(true);
    dismissListeners.add(onDismiss);
    return () => { alive = false; dismissListeners.delete(onDismiss); };
  }, []);

  return {
    show: available && !isDismissed,
    dismiss: dismissUpdateNotice,
    openStore: openAppStoreForUpdate,
  };
}

/** Test-only: reset the module memo + dismiss state between cases. */
export function __resetAppUpdateNoticeForTests(): void {
  cachedCheck = null;
  dismissed = false;
  dismissListeners.clear();
}
