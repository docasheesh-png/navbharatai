import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectMobileBuildArtifacts, fetchMobileBuildFile, fetchMobileBuildJson, findMobileBuildToCancel, mobileBuildDispatchTime, mobileBuildFileName, MOBILE_BUILD_WATCH_MS, selectMobileBuildRun, usableMobileBuildArtifacts, type MobileBuildRun } from './mobileBuildWatch';

const dispatchedAt = Date.parse('2026-11-01T09:00:00.700Z');
const expected = { branch: 'main', dispatchedAt };
const build = (id: number, patch: Partial<MobileBuildRun> = {}): MobileBuildRun => ({
  id, status: 'in_progress', conclusion: null, url: `https://github.com/a/b/actions/runs/${id}`,
  branch: 'main', event: 'workflow_dispatch', createdAt: '2026-11-01T09:00:00Z', ...patch,
});
const apk = { id: 12, name: 'debug-apk', sizeBytes: 1000 };
const aab = { id: 13, name: 'release-aab', sizeBytes: 2000 };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('dispatch metadata and cancellation safety', () => {
  it('reads the server ISO timestamp instead of depending on the device clock', () => {
    expect(mobileBuildDispatchTime('2026-11-01T09:00:00.700Z')).toBe(dispatchedAt);
    expect(mobileBuildDispatchTime(dispatchedAt)).toBe(dispatchedAt);
    expect(mobileBuildDispatchTime('invalid')).toBeUndefined();
    expect(mobileBuildDispatchTime(null)).toBeUndefined();
  });

  it('cannot cancel another build when Stop races a dispatch whose response is still pending', async () => {
    const load = vi.fn().mockResolvedValue([build(9)]);
    await expect(findMobileBuildToCancel({ seen: new Set(), dispatchedAt, pending: true }, 'main', load)).resolves.toBeUndefined();
    expect(load).not.toHaveBeenCalled();
  });

  it('only finds the correlated build after dispatch has been acknowledged', async () => {
    const load = vi.fn().mockResolvedValue([
      build(9, { displayTitle: 'Build APK other-request' }),
      build(8, { displayTitle: 'Build APK this-request' }),
    ]);
    await expect(findMobileBuildToCancel({ seen: new Set(), dispatchedAt, requestId: 'this-request' }, 'main', load)).resolves.toBe(8);
  });

  it('cancels the pinned run even when a newer run has displaced it from the list', async () => {
    const load = vi.fn();
    await expect(findMobileBuildToCancel({ seen: new Set(), dispatchedAt, runId: 8 }, 'main', load)).resolves.toBe(8);
    expect(load).not.toHaveBeenCalled();
  });
});

describe('bounded mobile build requests', () => {
  const hungUntilAborted = (signal: AbortSignal) => new Promise<never>((_resolve, reject) => {
    const fail = () => reject(new Error('Request aborted'));
    if (signal.aborted) fail();
    else signal.addEventListener('abort', fail, { once: true });
  });

  it('aborts hung response headers instead of leaving the build spinner forever', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => hungUntilAborted(init.signal!)));
    const result = expect(fetchMobileBuildJson('/runs')).rejects.toThrow('Request aborted');
    await vi.advanceTimersByTimeAsync(45_000);
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the deadline active until the JSON body has been consumed', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => ({
      json: () => hungUntilAborted(init.signal!),
    })));
    const result = expect(fetchMobileBuildJson('/runs')).rejects.toThrow('Request aborted');
    await vi.advanceTimersByTimeAsync(45_000);
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('allows the configured longer setup budget and clears its timer on success', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }))));
    const result = await fetchMobileBuildJson('/setup', {}, 10 * 60 * 1000);
    expect(result.data).toEqual({ ok: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the deadline on immediate network failure too', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Offline')));
    await expect(fetchMobileBuildJson('/trigger')).rejects.toThrow('Offline');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('selectMobileBuildRun — watching the build this press started', () => {
  it('never selects a run present before dispatch', () => {
    expect(selectMobileBuildRun([build(4), build(3)], new Set([4]), expected)?.id).toBe(3);
  });

  it('rejects a new run on another branch', () => {
    expect(selectMobileBuildRun([build(4, { branch: 'other' }), build(3)], new Set(), expected)?.id).toBe(3);
  });

  it('rejects push-triggered builds and old runs outside the baseline page', () => {
    expect(selectMobileBuildRun([
      build(8, { event: 'push' }),
      build(7, { createdAt: '2026-11-01T08:59:58Z' }),
    ], new Set(), expected)).toBeUndefined();
  });

  it('accepts GitHub second-precision timestamps for a dispatch later in the same second', () => {
    expect(selectMobileBuildRun([build(4)], new Set(), expected)?.id).toBe(4);
  });

  it('correlates simultaneous manual builds on the same branch by their request identifier', () => {
    expect(selectMobileBuildRun([
      build(9, { displayTitle: 'Build APK someone-else' }),
      build(8, { displayTitle: 'Build APK request-123' }),
    ], new Set(), { ...expected, requestId: 'request-123' })?.id).toBe(8);
  });

  it('does not silently degrade request matching when a title is not readable', () => {
    expect(selectMobileBuildRun([build(4)], new Set(), { ...expected, requestId: 'request-123' })).toBeUndefined();
  });

  it('uses request correlation even when the device clock is ahead of the runner', () => {
    expect(selectMobileBuildRun([
      build(8, { createdAt: '2026-11-01T08:00:00Z', displayTitle: 'Build APK request-123' }),
    ], new Set(), { ...expected, requestId: 'request-123' })?.id).toBe(8);
  });

  it('keeps the selected run even after another user starts a newer build', () => {
    expect(selectMobileBuildRun([build(10), build(8)], new Set(), { ...expected, runId: 8 })?.id).toBe(8);
  });

  it('never substitutes another run when the pinned run disappears from the list', () => {
    expect(selectMobileBuildRun([build(10)], new Set(), { ...expected, runId: 8 })).toBeUndefined();
  });

  it('continues to support legacy server run summaries without optional metadata', () => {
    const { branch: _branch, event: _event, createdAt: _createdAt, ...legacy } = build(4);
    expect(selectMobileBuildRun([legacy], new Set(), expected)?.id).toBe(4);
  });

  it('allows queue time plus the entire generated workflow timeout before ending observation', () => {
    expect(MOBILE_BUILD_WATCH_MS).toBeGreaterThan(30 * 60 * 1000);
  });
});

describe('actual app file downloads', () => {
  const bytes = new Uint8Array([0x50, 0x4b, 3, 4, 10, 20]);

  it('keeps the server filename and consumed binary instead of inferring a misleading extension', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes, {
      headers: { 'content-disposition': 'attachment; filename="app-release.aab"' },
    })));
    const result = await fetchMobileBuildFile('/download', {}, 'release-aab');
    expect(result.filename).toBe('app-release.aab');
    expect(new Uint8Array(await result.blob.arrayBuffer())).toEqual(bytes);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ['release-aab', 'app-release.aab'],
    ['release-ipa', 'App.ipa'],
    ['debug-apk', 'app-debug.apk'],
    ['app-apk', 'app-release.apk'],
    ['custom.aab', 'custom.aab'],
  ])('preserves the fallback output kind for %s', (artifact, filename) => {
    expect(mobileBuildFileName(null, artifact)).toBe(filename);
  });

  it('decodes UTF-8 file names and strips paths from the response header', () => {
    expect(mobileBuildFileName("attachment; filename*=UTF-8''my%20app.apk", 'app-apk')).toBe('my app.apk');
    expect(mobileBuildFileName('attachment; filename="../../app-release.aab"', 'app-apk')).toBe('app-release.aab');
    expect(mobileBuildFileName('attachment; filename="not-an-app.html"', 'release-aab')).toBe('app-release.aab');
  });

  it('shows the server failure instead of silently doing nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'That file expired. Build a fresh copy.' }), { status: 404 })));
    await expect(fetchMobileBuildFile('/download', {}, 'app-apk')).rejects.toThrow('That file expired. Build a fresh copy.');
  });

  it.each(['', '<html>proxy unavailable</html>'])('does not save an empty or HTML response as a successful app', async (body) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body)));
    await expect(fetchMobileBuildFile('/download', {}, 'app-apk')).rejects.toThrow('incomplete or invalid');
  });

  it.each(['headers', 'body'])('bounds stalled binary %s reads and clears the download timer', async (stage) => {
    vi.useFakeTimers();
    const hang = (signal: AbortSignal) => new Promise<never>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('Request aborted')), { once: true });
    });
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => stage === 'headers'
      ? hang(init.signal!) : { ok: true, blob: () => hang(init.signal!) }));
    const result = expect(fetchMobileBuildFile('/download', {}, 'app-apk')).rejects.toThrow('Request aborted');
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('propagates a caller abort and leaves no timer behind', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => new Promise<never>((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true });
    })));
    const result = expect(fetchMobileBuildFile('/download', { signal: controller.signal }, 'app-apk')).rejects.toThrow('Cancelled');
    controller.abort();
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('explains an actual browser abort in actionable language', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => new Promise<never>((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    })));
    const result = expect(fetchMobileBuildFile('/download', {}, 'app-apk')).rejects.toThrow('Please try again');
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    await result;
  });

  it('only presents nonempty actual app artifacts from a saved build', () => {
    expect(usableMobileBuildArtifacts([
      apk, aab, { id: 14, name: 'release-ipa', sizeBytes: 100 },
      { id: 15, name: 'logs', sizeBytes: 100 }, { id: 16, name: 'app-apk', sizeBytes: 0 },
      { id: -1, name: 'app-apk', sizeBytes: 20 }, null,
    ])).toEqual([apk, aab, { id: 14, name: 'release-ipa', sizeBytes: 100 }]);
    expect(usableMobileBuildArtifacts({ artifacts: [apk] })).toEqual([]);
  });
});

describe('collectMobileBuildArtifacts — a green job is only ready when its file is readable', () => {
  it('retries artifact publication lag without starting a new build', async () => {
    const load = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValue([apk]);
    const pause = vi.fn().mockResolvedValue(undefined);
    await expect(collectMobileBuildArtifacts(load, 'apk', () => true, pause)).resolves.toEqual([apk]);
    expect(load).toHaveBeenCalledTimes(3);
    expect(pause.mock.calls).toEqual([[1000], [2000]]);
  });

  it('recovers a failed status read before returning a ready file', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('GitHub temporarily unavailable')).mockResolvedValue([apk]);
    await expect(collectMobileBuildArtifacts(load, 'apk', () => true, async () => {})).resolves.toEqual([apk]);
  });

  it('does not declare an APK ready from a log, zero-byte upload or unrelated artifact', async () => {
    const load = vi.fn().mockResolvedValue([
      { id: 8, name: 'build-logs', sizeBytes: 30 },
      { id: 9, name: 'debug-apk', sizeBytes: 0 },
      { id: -4, name: 'debug-apk', sizeBytes: 30 },
      aab,
    ]);
    await expect(collectMobileBuildArtifacts(load, 'apk', () => true, async () => {})).rejects.toThrow('not available yet');
    expect(load).toHaveBeenCalledTimes(6);
  });

  it('does not call a Play bundle ready when only its companion APK is published', async () => {
    const load = vi.fn().mockResolvedValueOnce([apk]).mockResolvedValue([apk, aab]);
    await expect(collectMobileBuildArtifacts(load, 'aab', () => true, async () => {})).resolves.toEqual([apk, aab]);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('preserves the actual final read failure after bounded retries', async () => {
    const load = vi.fn().mockRejectedValue(new Error('Reconnect GitHub'));
    await expect(collectMobileBuildArtifacts(load, 'apk', () => true, async () => {})).rejects.toThrow('Reconnect GitHub');
    expect(load).toHaveBeenCalledTimes(6);
  });

  it('does no work after the user stops watching', async () => {
    const load = vi.fn();
    await expect(collectMobileBuildArtifacts(load, 'apk', () => false, async () => {})).resolves.toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it('cannot publish stale success after a stop while an artifact read is in flight', async () => {
    let active = true;
    const load = vi.fn(async () => { active = false; return [apk]; });
    await expect(collectMobileBuildArtifacts(load, 'apk', () => active, async () => {})).resolves.toBeNull();
  });

  it('abandons retries if the user stops during backoff', async () => {
    let active = true;
    const load = vi.fn().mockResolvedValue([]);
    await expect(collectMobileBuildArtifacts(load, 'apk', () => active, async () => { active = false; })).resolves.toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
  });
});
