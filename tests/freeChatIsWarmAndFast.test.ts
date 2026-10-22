import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { shouldWarm, warmBackend, startWarmingBackend, WARM_MIN_GAP_MS, __resetWarmBackend } from '../src/lib/warmBackend';
import { watchdogLimits, DEFAULT_FIRST_TOKEN_MS, DEFAULT_FREE_FIRST_TOKEN_MS } from '../src/server/AI/Router/streamWatchdog';
import { runWarmup } from '../src/server/routes/warm';

/**
 * FREE CHAT, FAST (admin 2026-10-22). Measured before building anything: the app-context lookup a chat message pays is
 * ~1–2 ms, so the wait a person feels is (1) a cold server and (2) a free rung that accepts the request and never speaks —
 * 30 s before the next rung even starts. This locks the three things that answer those: the server is woken while the person
 * types, the first chat message finds its settings already read, and a silent free rung is given up on in 10 s, not 30.
 */
beforeEach(() => __resetWarmBackend());

describe('waking the server on open', () => {
  it('goes out once, then at most once every four minutes', () => {
    const send = vi.fn(async () => undefined);
    expect(warmBackend(1_000_000, send)).toBe(true);
    expect(warmBackend(1_000_000 + 60_000, send)).toBe(false);
    expect(warmBackend(1_000_000 + WARM_MIN_GAP_MS, send)).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    expect(shouldWarm(5, 0)).toBe(true);
  });
  it('never throws or breaks the page, whatever the network does', async () => {
    expect(() => warmBackend(1, () => { throw new Error('offline'); })).not.toThrow();
    __resetWarmBackend();
    expect(() => warmBackend(1, async () => { throw new Error('offline'); })).not.toThrow();
  });
  it('wakes once on open and again when the person comes back to the tab, and cleans up', () => {
    const listeners = new Map<string, () => void>();
    const doc = {
      visibilityState: 'visible' as DocumentVisibilityState,
      addEventListener: (t: string, f: () => void) => { listeners.set(t, f); },
      removeEventListener: (t: string) => { listeners.delete(t); },
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    const stop = startWarmingBackend(doc as never);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toBe('/api/warm');
    expect(listeners.has('visibilitychange')).toBe(true);
    stop();
    expect(listeners.has('visibilitychange')).toBe(false);
    fetchSpy.mockRestore();
  });
  it('App.tsx starts it', () => {
    expect(readFileSync('src/App.tsx', 'utf8')).toContain('useEffect(() => startWarmingBackend(), []);');
  });
});

describe('the server warms what the first chat message needs — and makes no model call', () => {
  it('the warm report includes the settings and modules the chat handler reads first', async () => {
    const report = await runWarmup();
    const names = report.steps.map((s) => s.step);
    for (const n of ['chat:maintenanceSetting', 'chat:lazyModules']) expect(names).toContain(n);
  });
  it('the warm module still makes no billed call (hard rule in its header)', () => {
    const src = readFileSync('src/server/routes/warm.ts', 'utf8');
    expect(src).not.toMatch(/\.route\(|routeStream|executeStream|generateContent|messages\.create/);
  });
});

describe('a silent free rung is given up on in 10 s, not 30', () => {
  it('the free ladder waits 10 s for a first word; every other ladder keeps 30 s', () => {
    expect(DEFAULT_FREE_FIRST_TOKEN_MS).toBe(10_000);
    expect(watchdogLimits({} as never, 'free')!.firstTokenMs).toBe(10_000);
    expect(watchdogLimits({} as never, 'pro')!.firstTokenMs).toBe(DEFAULT_FIRST_TOKEN_MS);
    expect(watchdogLimits({} as never)!.firstTokenMs).toBe(DEFAULT_FIRST_TOKEN_MS);
  });
  it('the env override still wins on the free ladder, and its floor still protects a healthy provider', () => {
    expect(watchdogLimits({ CHAT_STREAM_FIRST_TOKEN_MS: '20000' } as never, 'free')!.firstTokenMs).toBe(20_000);
    expect(watchdogLimits({ CHAT_STREAM_FIRST_TOKEN_MS: '1' } as never, 'free')!.firstTokenMs).toBe(5_000);
  });
  it('the router passes its universe to the watchdog', () => {
    expect(readFileSync('src/server/AI/Router/AIRouter.ts', 'utf8')).toContain('watchdogLimits(process.env, this.universe)');
  });
});
