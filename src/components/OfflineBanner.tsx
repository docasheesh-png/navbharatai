import React from 'react';
import { WifiOff } from 'lucide-react';

/**
 * THE APP SAYS SO WHEN IT CANNOT REACH THE NETWORK (admin 2026-09-19, item C of five).
 *
 * WHY A BANNER AND NOT THE TOAST THAT WAS ALREADY THERE. App.tsx raised a toast on
 * `navigator.onLine === false`. A toast is the wrong shape for this: it disappears after a few seconds
 * while the CONDITION lasts for minutes, so anyone who looked away comes back to an app that is quietly
 * failing with no explanation. A state that persists needs a surface that persists.
 *
 * WHAT IT IS DRIVEN BY MATTERS MORE THAN ITS LOOKS: `reachable` from useNetworkStatus, which is a real
 * round trip, not `navigator.onLine` — see src/lib/reachability.ts for why that flag reports TRUE on a
 * phone with one bar and no data.
 *
 * It offers a RETRY even though recovery is automatic, because a person who has just walked back into
 * signal should not have to wait out a backoff to find out. The automatic watch stays either way.
 *
 * 🔒 No vendor or provider name appears here, per the White-Label Law: to the user this is NavBharatAI
 * failing to reach NavBharatAI, whatever the real topology is.
 */
export interface OfflineBannerProps {
  /** False when a real request could not complete — NOT `navigator.onLine`. */
  reachable: boolean;
  /** Probe now. Optional: the banner is still honest without a manual retry. */
  onRetry?: () => void;
}

export const OfflineBanner: React.FC<OfflineBannerProps> = ({ reachable, onRetry }) => {
  if (reachable) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      // Sits just under the header (3.5rem + the notch), so it can never collide with the safe area or
      // be pushed off-screen by the bottom nav. Fixed rather than in the flow: the main container's
      // height is a calc() off the header, and adding a row to the flow would overflow it.
      className="fixed left-0 right-0 z-40 px-4"
      style={{ top: 'calc(3.5rem + var(--nb-safe-top))' }}
    >
      <div className="mx-auto flex max-w-lg items-center gap-2 rounded-xl border border-line bg-card px-3 py-2 shadow-lg">
        <WifiOff className="h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
        <span className="min-w-0 flex-1 text-xs text-body">
          You are offline. NavBharatAI will reconnect on its own.
        </span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="shrink-0 rounded-lg border border-line px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-accent-text active:scale-95"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
};

export default OfflineBanner;
