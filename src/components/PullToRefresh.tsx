import React, { useCallback, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  MAX_PULL_PX,
  canStartPull,
  isArmed,
  isPullGesture,
  pullDistance,
  pullProgress,
} from '../lib/pullToRefresh';
import { hapticNow } from '../lib/nativeShell';

/**
 * PULL TO REFRESH (admin 2026-09-19, item D of five).
 *
 * Wraps a scrollable list and answers a downward drag at the top of it by fetching again — the gesture
 * every native list has and this app had nowhere.
 *
 * 🔴 ONLY WRAP A LIST WHOSE `onRefresh` REALLY FETCHES. A spinner over data that is already current is
 * the "built but not really working" state the second absolute rule bans. See src/lib/pullToRefresh.ts
 * for the two real examples in this codebase — App Mart (an HTTP fetch, so pulling gets you something)
 * and History (a live Firestore snapshot, so pulling gets you nothing and it is deliberately not wired).
 *
 * The gesture decisions are all in that module and unit-tested; this component is the DOM half only.
 */
export interface PullToRefreshProps {
  /** Must actually re-fetch. Awaited, so the indicator stays until the data is really back. */
  onRefresh: () => Promise<unknown>;
  /** The scrollable content. This component owns the scroll container. */
  children: React.ReactNode;
  className?: string;
  /** Off by default nowhere — pass false to disable (e.g. while a modal owns the gestures). */
  enabled?: boolean;
}

export const PullToRefresh: React.FC<PullToRefreshProps> = ({ onRefresh, children, className, enabled = true }) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const armedRef = useRef(false);
  const [distance, setDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const reset = useCallback(() => {
    startRef.current = null;
    armedRef.current = false;
    setDistance(0);
  }, []);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (!enabled) return;
    const el = scrollRef.current;
    if (!el) return;
    if (!canStartPull({ scrollTop: el.scrollTop, touchCount: e.touches.length, refreshing })) {
      startRef.current = null;
      return;
    }
    const t = e.touches[0];
    startRef.current = { x: t.clientX, y: t.clientY };
    armedRef.current = false;
  }, [enabled, refreshing]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    const start = startRef.current;
    if (!start || refreshing) return;
    const t = e.touches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (!isPullGesture(dx, dy)) {
      // Sideways, or upward: this belongs to the scroller (or to a horizontal tab row beside it).
      if (distance > 0) setDistance(0);
      return;
    }
    const next = pullDistance(dy);
    setDistance(next);
    // One buzz, exactly when the pull becomes a release-to-refresh — the moment a native list confirms
    // the gesture. Latched, or a finger hovering on the threshold would rattle.
    if (!armedRef.current && isArmed(next)) {
      armedRef.current = true;
      hapticNow('light');
    }
  }, [distance, refreshing]);

  const onTouchEnd = useCallback(() => {
    const armed = armedRef.current;
    startRef.current = null;
    armedRef.current = false;
    if (!armed) { setDistance(0); return; }
    setRefreshing(true);
    // Held at the threshold, not at the finger's position: the indicator should sit where the spinner
    // lives while the work happens, exactly as a native list does.
    setDistance(MAX_PULL_PX / 2);
    void Promise.resolve(onRefresh())
      .catch(() => { /* the list shows its own error; the gesture must still finish */ })
      .finally(() => { setRefreshing(false); setDistance(0); });
  }, [onRefresh]);

  const progress = pullProgress(distance);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center"
        style={{ height: distance, opacity: progress }}
        aria-hidden={distance === 0}
      >
        <div className="flex items-end pb-1">
          <RefreshCw
            className={`h-4 w-4 text-accent-text ${refreshing ? 'animate-spin' : ''}`}
            style={refreshing ? undefined : { transform: `rotate(${progress * 270}deg)` }}
          />
        </div>
      </div>
      <div
        ref={scrollRef}
        className={className}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={reset}
        style={{ transform: distance > 0 ? `translateY(${distance}px)` : undefined }}
      >
        {children}
      </div>
    </div>
  );
};

export default PullToRefresh;
