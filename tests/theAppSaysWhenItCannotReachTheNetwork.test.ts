import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  INITIAL_REACHABILITY,
  FAILURES_BEFORE_OFFLINE,
  MIN_PROBE_GAP_MS,
  OFFLINE_RETRY_BACKOFF_MS,
  PROBE_PATH,
  afterOsChange,
  afterProbe,
  offlineByOs,
  probeOnce,
  retryDelayMs,
  shouldProbe,
  type ReachabilityState,
} from '../src/lib/reachability';

/**
 * 📡 THE APP SAYS SO WHEN IT CANNOT REACH THE NETWORK (admin 2026-09-19, item C of five).
 *
 * 🔴 THE GAP WAS NOT A MISSING SIGNAL — IT WAS AN UNRELIABLE ONE, and saying that precisely is the
 * point of this file. `useNetworkStatus` has reported `navigator.onLine` since Phase 6.2 and App.tsx
 * raised a toast from it. But `onLine === true` means only "an interface exists": one bar and no data,
 * a captive portal, dead DNS all report TRUE, and in a WebView that is the COMMON case. In it the app
 * showed nothing at all while every request failed generically.
 *
 * What is locked here is the asymmetry and the cost, because both are easy to "simplify" away:
 *   • TWO failures to declare offline, ONE success to clear — telling somebody they are offline when
 *     they are not is the expensive mistake; being slow to say it is cheap. (Same threshold the
 *     site-uptime sweep already uses.)
 *   • NO POLLING while things are fine. A background poll from every client would be real traffic at
 *     NavBharatAI's scale, for no information.
 *   • A 503 is a SUCCESS: the question is whether a packet made the round trip, not whether the server
 *     is healthy. Conflating them would show "you are offline" to a user whose connection is perfect
 *     while we deploy.
 */

const root = process.cwd();

describe('navigator.onLine is a fast NEGATIVE and nothing more', () => {
  it('false is trusted without spending a request', () => {
    expect(offlineByOs(false)).toBe(true);
    expect(shouldProbe(INITIAL_REACHABILITY, { onLine: false, now: 1, reason: 'start' })).toBe(false);
  });

  it('true is not trusted — a probe decides', () => {
    expect(offlineByOs(true)).toBe(false);
    expect(offlineByOs(undefined)).toBe(false);
    expect(shouldProbe(INITIAL_REACHABILITY, { onLine: true, now: 1, reason: 'start' })).toBe(true);
  });

  it('going offline is applied at once; coming back only permits a probe', () => {
    const down = afterOsChange(INITIAL_REACHABILITY, false);
    expect(down.reachable).toBe(false);
    // The interface returning says nothing about the internet beyond it — the whole reason this exists.
    const up = afterOsChange(down, true);
    expect(up.reachable).toBe(false);
    expect(up.failures).toBe(0);
  });
});

describe('the asymmetry: slow to alarm, fast to clear', () => {
  it('one failure is not enough to call it offline', () => {
    const one = afterProbe(INITIAL_REACHABILITY, false, 1_000);
    expect(one.reachable).toBe(true);
    expect(one.failures).toBe(1);
  });

  it('two consecutive failures are', () => {
    const two = afterProbe(afterProbe(INITIAL_REACHABILITY, false, 1_000), false, 2_000);
    expect(two.reachable).toBe(false);
    expect(FAILURES_BEFORE_OFFLINE).toBe(2);
  });

  it('a single success clears it immediately', () => {
    const two = afterProbe(afterProbe(INITIAL_REACHABILITY, false, 1_000), false, 2_000);
    const back = afterProbe(two, true, 3_000);
    expect(back.reachable).toBe(true);
    expect(back.failures).toBe(0);
  });

  it('starts optimistic — an app must not cry offline before it has asked anything', () => {
    expect(INITIAL_REACHABILITY.reachable).toBe(true);
  });
});

describe('💸 it never polls while things are fine', () => {
  it('a reachable state schedules no retry at all', () => {
    expect(retryDelayMs(INITIAL_REACHABILITY)).toBeNull();
  });

  it('an unreachable state backs off, and the backoff is bounded', () => {
    let s: ReachabilityState = afterProbe(afterProbe(INITIAL_REACHABILITY, false, 1), false, 2);
    const delays: number[] = [];
    for (let i = 0; i < 6; i++) {
      delays.push(retryDelayMs(s) as number);
      s = afterProbe(s, false, 10 + i);
    }
    expect(delays[0]).toBe(OFFLINE_RETRY_BACKOFF_MS[0]);
    expect(delays.every((d) => d !== null)).toBe(true);
    // Never grows without bound, and never drops below the first step.
    expect(Math.max(...delays)).toBe(OFFLINE_RETRY_BACKOFF_MS[OFFLINE_RETRY_BACKOFF_MS.length - 1]);
    expect(delays).toEqual([...delays].sort((a, b) => a - b));
  });

  it('two reasons arriving together do not cost two requests', () => {
    const after = afterProbe(INITIAL_REACHABILITY, true, 1_000);
    expect(shouldProbe(after, { onLine: true, now: 1_500, reason: 'foreground' })).toBe(false);
    expect(shouldProbe(after, { onLine: true, now: 1_000 + MIN_PROBE_GAP_MS, reason: 'foreground' })).toBe(true);
  });

  it('a recovery retry ignores the gap, because it has already waited its own delay', () => {
    const after = afterProbe(INITIAL_REACHABILITY, false, 1_000);
    expect(shouldProbe(after, { onLine: true, now: 1_500, reason: 'recovery' })).toBe(true);
  });
});

describe('probeOnce — what counts as reaching the network', () => {
  it('🔒 a 503 is a SUCCESS: the packet made the round trip', async () => {
    const ok = await probeOnce(async () => ({ status: 503 }));
    expect(ok, 'a deploying server is not the user being offline').toBe(true);
  });

  it('a throw is a failure', async () => {
    expect(await probeOnce(async () => { throw new TypeError('Failed to fetch'); })).toBe(false);
  });

  it('asks the cheap readiness route, and defeats the cache', async () => {
    let seen = '';
    let init: { method: string; cache: string } | null = null;
    await probeOnce(async (url, i) => { seen = url; init = i as never; return {}; });
    expect(seen.startsWith(PROBE_PATH)).toBe(true);
    // A cached 200 would prove nothing about the network right now.
    expect(init!.cache).toBe('no-store');
    expect(seen).toMatch(/[?&]_=\d+/);
  });
});

describe('the wiring — one hook, not a second one', () => {
  const hook = readFileSync(join(root, 'src/hooks/useNetworkStatus.ts'), 'utf8');
  const app = readFileSync(join(root, 'src/App.tsx'), 'utf8');
  const appCode = app
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join('\n');

  it('`reachable` rides the EXISTING hook rather than a parallel one', () => {
    // A second hook would be a second answer to one question — the class autopsy 1a7f4a58 named.
    expect(hook).toContain('reachable');
    expect(hook).toContain("from '../lib/reachability'");
  });

  it('the old `online` field is untouched, so its existing consumer still works', () => {
    expect(hook).toMatch(/online:\s*navigator\.onLine/);
  });

  it('the banner is driven by `reachable`, never by `online`', () => {
    expect(appCode).toContain('<OfflineBanner reachable={networkStatus.reachable} />');
    expect(appCode).not.toMatch(/OfflineBanner[^/]*networkStatus\.online/);
  });

  it('the vanishing toast is gone; only the RECOVERY is a toast', () => {
    // A toast for a state that lasts minutes leaves anyone who looked away with an app that is
    // silently failing.
    expect(appCode).not.toContain('No internet connection — changes may not save');
    expect(appCode).toContain("addToast('Back online', 'success')");
  });

  it('recovery is announced only to someone who saw the banner, never on first load', () => {
    expect(appCode).toContain('wasUnreachableRef.current = true');
  });
});

describe('the banner itself', () => {
  const banner = readFileSync(join(root, 'src/components/OfflineBanner.tsx'), 'utf8');

  it('renders nothing while reachable', () => {
    expect(banner).toContain('if (reachable) return null;');
  });

  it('is announced to a screen reader', () => {
    expect(banner).toContain('role="status"');
    expect(banner).toContain('aria-live="polite"');
  });

  it('🔒 names no vendor — the White-Label Law applies to failures too', () => {
    for (const vendor of ['GLM', 'Kimi', 'Claude', 'Anthropic', 'Gemini', 'Vertex', 'Grok', 'OpenAI', 'Moonshot']) {
      expect(banner, `${vendor} must never appear on a user-facing surface`).not.toContain(vendor);
    }
  });

  it('uses theme tokens, not colour literals', () => {
    // The theme ratchet would catch this anyway; asserting it here keeps the reason legible.
    expect(banner).not.toMatch(/text-white|bg-\[#|text-\[#|bg-gray-|text-gray-/);
  });
});
