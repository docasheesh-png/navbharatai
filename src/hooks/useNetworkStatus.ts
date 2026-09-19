import { useState, useEffect, useRef, useCallback } from 'react';
import {
  INITIAL_REACHABILITY,
  PROBE_TIMEOUT_MS,
  afterOsChange,
  afterProbe,
  offlineByOs,
  probeOnce,
  retryDelayMs,
  shouldProbe,
  type ProbeReason,
  type ReachabilityState,
} from '../lib/reachability';

export interface NetworkStatus {
  online: boolean;
  /** Effective connection type if available (e.g. '4g', '3g', '2g', 'slow-2g'). null if API unavailable. */
  effectiveType: string | null;
  /** Round-trip time estimate in ms. null if API unavailable. */
  rtt: number | null;
  /** Downlink speed estimate in Mbps. null if API unavailable. */
  downlink: number | null;
  /**
   * Did a real request reach the server and come back? (admin 2026-09-19, item C of five.)
   *
   * 🔴 `online` ABOVE IS NOT THIS, and reading it as if it were is the defect this field exists to fix.
   * `navigator.onLine === false` is trustworthy; `=== true` means only "an interface exists" — one bar
   * and no data, a captive portal or dead DNS all report TRUE. In a WebView that is the common case,
   * and in it the app showed no offline state at all while every request failed generically.
   *
   * `online` is kept exactly as it was, so its existing consumer is untouched. Prefer `reachable` for
   * anything a user SEES; `online` remains the right field for "has the interface just changed?".
   */
  reachable: boolean;
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
  const [status, setStatus] = useState<Omit<NetworkStatus, 'reachable'>>(() => ({
    online: typeof navigator !== 'undefined' ? navigator.onLine : true,
    ...readConnection(),
  }));
  // Optimistic on launch: an app that announces "you are offline" before it has asked anything is
  // worse than one that is briefly quiet.
  const [reach, setReach] = useState<ReachabilityState>(INITIAL_REACHABILITY);
  const reachRef = useRef(reach);
  reachRef.current = reach;

  /**
   * One probe, if there is a reason and the gap allows it.
   *
   * 💸 THERE IS NO POLLING WHILE THINGS ARE FINE. A healthy user pays roughly one tiny request per
   * foreground; the backoff timer below exists only while we believe we are offline, so a working app
   * schedules nothing at all. At NavBharatAI's scale a background poll from every client would be real
   * traffic for no information.
   */
  const runProbe = useCallback(async (reason: ProbeReason) => {
    const now = Date.now();
    const onLine = typeof navigator !== 'undefined' ? navigator.onLine : true;
    if (!shouldProbe(reachRef.current, { onLine, now, reason })) return;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS) : null;
    const ok = await probeOnce(
      (url, init) => fetch(url, init as RequestInit),
      { signal: controller?.signal },
    );
    if (timer !== null) window.clearTimeout(timer);
    setReach((prev) => afterProbe(prev, ok, Date.now()));
  }, []);

  useEffect(() => {
    const update = () => setStatus({ online: navigator.onLine, ...readConnection() });
    const onOnline = () => {
      update();
      // The interface came back. That says nothing about the internet beyond it — which is the whole
      // point of this file — so a probe decides rather than the event.
      setReach((prev) => afterOsChange(prev, true));
      void runProbe('online-event');
    };
    const onOffline = () => {
      update();
      setReach((prev) => afterOsChange(prev, false)); // the OS is certain; no request needed
    };
    const onVisible = () => { if (!document.hidden) void runProbe('foreground'); };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);

    const nav = navigator as any;
    const conn = nav.connection ?? nav.mozConnection ?? nav.webkitConnection;
    conn?.addEventListener?.('change', update);

    if (offlineByOs(typeof navigator !== 'undefined' ? navigator.onLine : true)) {
      setReach((prev) => afterOsChange(prev, false));
    } else {
      void runProbe('start');
    }

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
      conn?.removeEventListener?.('change', update);
    };
  }, [runProbe]);

  // Recovery watch — armed ONLY while we believe we are offline (retryDelayMs returns null otherwise).
  useEffect(() => {
    const delay = retryDelayMs(reach);
    if (delay === null) return;
    const t = window.setTimeout(() => { void runProbe('recovery'); }, delay);
    return () => window.clearTimeout(t);
  }, [reach, runProbe]);

  return { ...status, reachable: reach.reachable };
}
