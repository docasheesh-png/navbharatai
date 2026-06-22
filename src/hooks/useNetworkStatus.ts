import { useState, useEffect } from 'react';

export interface NetworkStatus {
  online: boolean;
  /** Effective connection type if available (e.g. '4g', '3g', '2g', 'slow-2g'). null if API unavailable. */
  effectiveType: string | null;
  /** Round-trip time estimate in ms. null if API unavailable. */
  rtt: number | null;
  /** Downlink speed estimate in Mbps. null if API unavailable. */
  downlink: number | null;
}

function readConnection(): Pick<NetworkStatus, 'effectiveType' | 'rtt' | 'downlink'> {
  const nav = navigator as any;
  const conn = nav.connection ?? nav.mozConnection ?? nav.webkitConnection;
  return {
    effectiveType: conn?.effectiveType ?? null,
    rtt: conn?.rtt ?? null,
    downlink: conn?.downlink ?? null,
  };
}

/**
 * Phase 6.2 — real-time network status for mobile UX.
 * Fires on every online/offline transition and on NetworkInformation change events.
 * Works on all browsers — fields beyond `online` are Chrome/Android-only.
 */
export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>(() => ({
    online: typeof navigator !== 'undefined' ? navigator.onLine : true,
    ...readConnection(),
  }));

  useEffect(() => {
    const update = () => setStatus({ online: navigator.onLine, ...readConnection() });

    window.addEventListener('online', update);
    window.addEventListener('offline', update);

    const nav = navigator as any;
    const conn = nav.connection ?? nav.mozConnection ?? nav.webkitConnection;
    conn?.addEventListener?.('change', update);

    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      conn?.removeEventListener?.('change', update);
    };
  }, []);

  return status;
}
