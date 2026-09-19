import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AXIS_LOCK_MIN_PX,
  MAX_PULL_PX,
  PULL_RESISTANCE,
  PULL_THRESHOLD_PX,
  canStartPull,
  isArmed,
  isPullGesture,
  pullDistance,
  pullProgress,
} from '../src/lib/pullToRefresh';

/**
 * ↻ PULL TO REFRESH — REAL, OR ABSENT (admin 2026-09-19, item D of five).
 *
 * The gesture every native list has, and this app had nowhere: the only way to see new data was to
 * leave the screen and come back.
 *
 * 🔴 THE HARDEST PART WAS NOT THE GESTURE — IT WAS DECIDING WHERE IT IS HONEST. A spinner over data
 * that is already current is precisely the "built but not really working" state the second absolute
 * rule bans, and the obvious target was the worst one:
 *   • App Mart's list is plain HTTP (`/api/nav-store/apps`, `/api/nav-store/web/apps`). Apps published
 *     by other creators appear ONLY on a re-fetch, so pulling gets you something. WRAPPED.
 *   • History is a Firestore `onSnapshot` LIVE listener — already current on every device the moment
 *     anything changes. A pull there would spin and fetch what is already on screen. NOT WRAPPED, and
 *     asserted below so nobody "finishes the job" later.
 */

const root = process.cwd();

describe('when a pull may begin — each condition is a real conflict', () => {
  const ok = { scrollTop: 0, touchCount: 1, refreshing: false };

  it('at the very top, one finger, not already refreshing', () => {
    expect(canStartPull(ok)).toBe(true);
  });

  it('not mid-list — otherwise it steals the first pixels of every upward flick', () => {
    expect(canStartPull({ ...ok, scrollTop: 40 })).toBe(false);
  });

  it('not with two fingers — that is a pinch, never a pull', () => {
    expect(canStartPull({ ...ok, touchCount: 2 })).toBe(false);
  });

  it('not while a refresh is already in flight', () => {
    expect(canStartPull({ ...ok, refreshing: true })).toBe(false);
  });
});

describe('the axis lock — the app has other gestures and must not steal them', () => {
  it('a downward drag is a pull', () => {
    expect(isPullGesture(0, 40)).toBe(true);
  });

  it('a sideways drag belongs to the horizontal tab rows and the swipe menu', () => {
    expect(isPullGesture(60, 20)).toBe(false);
  });

  it('a tie is NOT a pull — the safe side is leaving the other gesture alone', () => {
    expect(isPullGesture(30, 30)).toBe(false);
  });

  it('an upward or flat drag is a scroll', () => {
    expect(isPullGesture(0, -40)).toBe(false);
    expect(isPullGesture(0, 0)).toBe(false);
  });

  it('a movement too small to have a direction does not commit to one', () => {
    expect(isPullGesture(0, AXIS_LOCK_MIN_PX - 1)).toBe(false);
    expect(isPullGesture(0, AXIS_LOCK_MIN_PX + 1)).toBe(true);
  });
});

describe('the rubber band', () => {
  it('content moves less than the finger — that is what makes it feel attached', () => {
    expect(pullDistance(100)).toBe(100 * PULL_RESISTANCE);
    expect(pullDistance(100)).toBeLessThan(100);
  });

  it('is clamped, however hard the pull', () => {
    expect(pullDistance(100_000)).toBe(MAX_PULL_PX);
  });

  it('never goes negative', () => {
    expect(pullDistance(-50)).toBe(0);
  });

  it('arms at the threshold and not before', () => {
    expect(isArmed(PULL_THRESHOLD_PX - 1)).toBe(false);
    expect(isArmed(PULL_THRESHOLD_PX)).toBe(true);
  });

  it('progress is clamped 0..1, so the indicator cannot overshoot its own animation', () => {
    expect(pullProgress(-10)).toBe(0);
    expect(pullProgress(PULL_THRESHOLD_PX / 2)).toBeCloseTo(0.5);
    expect(pullProgress(MAX_PULL_PX)).toBe(1);
  });

  it('the threshold is reachable — the clamp must not sit below it', () => {
    // A MAX below the THRESHOLD would make the gesture impossible to complete, with nothing failing.
    expect(MAX_PULL_PX).toBeGreaterThan(PULL_THRESHOLD_PX);
  });
});

describe('🔴 it is wired only where a refresh really fetches', () => {
  const store = readFileSync(join(root, 'src/components/ide/NavAppStore.tsx'), 'utf8');
  const history = readFileSync(join(root, 'src/components/HistoryView.tsx'), 'utf8');

  it('App Mart is wrapped, and its refresh calls the real loaders', () => {
    expect(store).toContain('<PullToRefresh');
    expect(store).toContain('loadStatus(), loadApps(), loadWebApps()');
  });

  it('History is NOT wrapped — its list is a live snapshot', () => {
    // `onSnapshot` keeps it current on every device already; a pull would spin over data that cannot
    // be more recent than it is. Left deliberately, and asserted so it stays deliberate.
    expect(history).toContain('onSnapshot(');
    expect(history).not.toContain('PullToRefresh');
  });

  it('the refresh is AWAITED, so the indicator lasts as long as the work', () => {
    const comp = readFileSync(join(root, 'src/components/PullToRefresh.tsx'), 'utf8');
    expect(comp).toContain('Promise.resolve(onRefresh())');
    expect(comp).toContain('.finally(');
    // A failed fetch must still end the gesture — the list reports its own error.
    expect(comp).toContain('.catch(');
  });

  it('one haptic at the arming point, latched so a hovering finger cannot rattle', () => {
    const comp = readFileSync(join(root, 'src/components/PullToRefresh.tsx'), 'utf8');
    expect(comp).toContain('armedRef.current = true;');
    expect(comp).toContain("hapticNow('light')");
  });
});
