import { Capacitor } from '@capacitor/core';
import { auth } from './firebase';
import { logoutCurrentDevice, isAccountLogoutPending } from './accountSessions';
import { createSessionMonitor, SESSION_CHECK_INTERVAL_MS } from './sessionMonitor';
import type { User } from 'firebase/auth';

/** The same lifecycle on web and bundled mobile; a suspended/offline device checks when it returns. */
export function startSessionMonitor(): () => void {
  const monitor = createSessionMonitor({
    currentUser: () => auth.currentUser,
    invalidate: (user, refreshToken) => logoutCurrentDevice(user as User, true, refreshToken),
    fetch: (input, init) => fetch(input, init), // retain the existing native API rewrite/App Check transport
    visible: () => document.visibilityState !== 'hidden' && !isAccountLogoutPending(),
  });
  const check = () => { void monitor.check().catch(() => {}); };
  let stopped = false;
  let removeNative: (() => void) | undefined;
  if (Capacitor.isNativePlatform()) {
    void import('@capacitor/app').then(async ({ App }) => {
      const listener = await App.addListener('appStateChange', ({ isActive }) => { if (isActive) check(); });
      if (stopped) void listener.remove();
      else removeNative = () => { void listener.remove(); };
    }).catch(() => {});
  }
  window.addEventListener('online', check);
  window.addEventListener('focus', check);
  document.addEventListener('visibilitychange', check);
  const timer = setInterval(check, SESSION_CHECK_INTERVAL_MS);
  check();
  return () => {
    stopped = true;
    monitor.stop();
    clearInterval(timer);
    removeNative?.();
    window.removeEventListener('online', check);
    window.removeEventListener('focus', check);
    document.removeEventListener('visibilitychange', check);
  };
}
