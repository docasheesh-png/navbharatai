import { describe, it, expect } from 'vitest';
import { cpuPercentFromDelta, gradeLoad, readMemoryLimitBytes, serverLoad } from './serverLoad';

describe('cpuPercentFromDelta', () => {
  it('turns a microsecond delta over elapsed time into percent of one core', () => {
    // 500ms of CPU in 1000ms of wall clock = 50% of one core.
    expect(cpuPercentFromDelta(500_000, 1000)).toBe(50);
    // A worker can exceed 100% only across cores; on one core, full use is 100%.
    expect(cpuPercentFromDelta(1_000_000, 1000)).toBe(100);
  });

  it('returns null rather than a bogus percentage for impossible input', () => {
    expect(cpuPercentFromDelta(500_000, 0)).toBeNull();
    expect(cpuPercentFromDelta(-1, 1000)).toBeNull();
    expect(cpuPercentFromDelta(NaN, 1000)).toBeNull();
    expect(cpuPercentFromDelta(500_000, NaN)).toBeNull();
  });
});

describe('gradeLoad — event-loop lag leads, because it is what users feel', () => {
  it('is healthy when everything is quiet', () => {
    expect(gradeLoad({ cpuPercent: 20, memoryPercent: 30, eventLoopP99Ms: 5 })).toEqual({ level: 'ok', reason: '' });
  });

  it('calls a blocked thread CRITICAL even while CPU looks calm', () => {
    // The case the panel exists for: 30% CPU, and every user waiting a third of a second.
    const g = gradeLoad({ cpuPercent: 30, memoryPercent: 40, eventLoopP99Ms: 300 });
    expect(g.level).toBe('critical');
    expect(g.reason).toContain('blocked thread');
  });

  it('warns before it is critical', () => {
    expect(gradeLoad({ cpuPercent: 10, memoryPercent: 10, eventLoopP99Ms: 120 }).level).toBe('warn');
  });

  it('grades memory harder than CPU — memory gets an instance KILLED, CPU only slows it', () => {
    expect(gradeLoad({ cpuPercent: 0, memoryPercent: 92, eventLoopP99Ms: 1 }).level).toBe('critical');
    expect(gradeLoad({ cpuPercent: 0, memoryPercent: 80, eventLoopP99Ms: 1 }).level).toBe('warn');
    // A busy server that still answers fast is NOT a problem.
    expect(gradeLoad({ cpuPercent: 120, memoryPercent: 40, eventLoopP99Ms: 5 }).level).toBe('ok');
  });

  it('reports the WORST signal, not the first one it finds', () => {
    const g = gradeLoad({ cpuPercent: 160, memoryPercent: 95, eventLoopP99Ms: 10 });
    expect(g.level).toBe('critical');
    expect(g.reason).toContain('memory');
  });

  it('ignores a signal it does not have instead of assuming the worst', () => {
    expect(gradeLoad({ cpuPercent: null, memoryPercent: null, eventLoopP99Ms: null })).toEqual({ level: 'ok', reason: '' });
  });
});

describe('readMemoryLimitBytes — a wrong denominator is worse than none', () => {
  it('reads a real cgroup v2 limit', () => {
    expect(readMemoryLimitBytes(() => '536870912')).toBe(536870912);
  });

  it('treats cgroup v2 "max" as unknown, not as a limit', () => {
    expect(readMemoryLimitBytes(() => 'max')).toBeNull();
  });

  it('treats the cgroup v1 "no limit" sentinel as unknown', () => {
    // v1 writes a number near 2^63 for "unlimited"; a percentage of that would read ~0% forever,
    // hiding a container about to be killed for memory.
    expect(readMemoryLimitBytes(() => '9223372036854771712')).toBeNull();
  });

  it('returns null when no cgroup file can be read at all', () => {
    expect(readMemoryLimitBytes(() => { throw new Error('ENOENT'); })).toBeNull();
  });

  it('ignores a blank or non-numeric value', () => {
    expect(readMemoryLimitBytes(() => '')).toBeNull();
    expect(readMemoryLimitBytes(() => 'nonsense')).toBeNull();
  });
});

describe('serverLoad sampler', () => {
  it('produces a snapshot with real process values and never throws', () => {
    serverLoad.start();
    const s = serverLoad.snapshot();
    expect(s.memoryRssBytes).toBeGreaterThan(0);
    expect(s.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(s.inFlightRequests).toBe(0);
    expect(['ok', 'warn', 'critical']).toContain(s.level);
  });

  it('start() is idempotent — a second call cannot double-enable the histogram', () => {
    expect(() => { serverLoad.start(); serverLoad.start(); }).not.toThrow();
  });

  it('counts a request in flight and releases it when the response finishes', () => {
    const listeners: Record<string, Array<() => void>> = {};
    const res: any = { on: (ev: string, fn: () => void) => { (listeners[ev] ||= []).push(fn); } };
    let nexted = false;
    serverLoad.middleware({} as any, res, () => { nexted = true; });
    expect(nexted).toBe(true);
    expect(serverLoad.snapshot().inFlightRequests).toBe(1);
    listeners.finish.forEach((fn) => fn());
    expect(serverLoad.snapshot().inFlightRequests).toBe(0);
  });

  it('releases an ABANDONED request too — otherwise the count only ever climbs', () => {
    // A user navigating away fires 'close', not 'finish'. Without that listener the panel would
    // slowly drift upward and stop meaning anything.
    const listeners: Record<string, Array<() => void>> = {};
    const res: any = { on: (ev: string, fn: () => void) => { (listeners[ev] ||= []).push(fn); } };
    serverLoad.middleware({} as any, res, () => {});
    expect(serverLoad.snapshot().inFlightRequests).toBe(1);
    listeners.close.forEach((fn) => fn());
    expect(serverLoad.snapshot().inFlightRequests).toBe(0);
  });

  it('a request that fires BOTH finish and close is only released once', () => {
    const listeners: Record<string, Array<() => void>> = {};
    const res: any = { on: (ev: string, fn: () => void) => { (listeners[ev] ||= []).push(fn); } };
    serverLoad.middleware({} as any, res, () => {});
    serverLoad.middleware({} as any, { on: () => {} } as any, () => {});
    expect(serverLoad.snapshot().inFlightRequests).toBe(2);
    listeners.finish.forEach((fn) => fn());
    listeners.close.forEach((fn) => fn());
    // Double-release would have shown 0 and then gone NEGATIVE on the next request.
    expect(serverLoad.snapshot().inFlightRequests).toBe(1);
  });
});

describe('reading the load never changes what the next reader sees (audit 2026-10-11, F15)', () => {
  it('🔒 snapshot() does not reset the lag window — only the timed rotate() does', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./serverLoad.ts', import.meta.url), 'utf8');
    const snap = src.slice(src.indexOf('  snapshot(): ServerLoadSnapshot {'));
    expect(snap).not.toMatch(/\.reset\(\)/);
    const rotate = src.slice(src.indexOf('  rotate(): void {'), src.indexOf('  snapshot(): ServerLoadSnapshot {'));
    expect(rotate).toMatch(/this\.histogram\.reset\(\)/);
  });

  it('lagOverWindows reports the worse of the current and previous window', async () => {
    const { lagOverWindows } = await import('./serverLoad');
    expect(lagOverWindows(null, null)).toBeNull();
    expect(lagOverWindows({ p50: 1, p99: 2 }, null)).toEqual({ p50: 1, p99: 2 });
    expect(lagOverWindows(null, { p50: 3, p99: 400 })).toEqual({ p50: 3, p99: 400 });
    expect(lagOverWindows({ p50: 5, p99: 20 }, { p50: 3, p99: 400 })).toEqual({ p50: 5, p99: 400 });
  });

  it('🔒 the admin Monitor reads the load once per response', async () => {
    const { readFileSync } = await import('node:fs');
    const admin = readFileSync(new URL('../routes/admin.ts', import.meta.url), 'utf8');
    const start = admin.indexOf("app.get('/api/admin/monitor'");
    const route = admin.slice(start, admin.indexOf('app.get(', start + 10));
    expect(route.match(/serverLoad\.snapshot\(\)/g) ?? []).toHaveLength(1);
  });
});
