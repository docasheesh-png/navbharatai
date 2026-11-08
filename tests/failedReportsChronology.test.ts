import { describe, expect, it, vi } from 'vitest';
import { loadFailedBuildReports, newestFailedReports } from '../src/lib/loadFailedBuildReports';
import type { FailedBuildPage, FailedBuildRow } from '../src/lib/failedBuildReports';

const row = (workspaceId: string, startedAt: number, extra: Partial<FailedBuildRow> = {}): FailedBuildRow => ({
  workspaceId, historyId: String(startedAt), buildId: null, startedAt, endedAt: startedAt + 10,
  appLabel: 'Synthetic build', rootCause: 'Synthetic failure', reportDigest: 'a'.repeat(64), ...extra,
});
const page = (reports: FailedBuildRow[], nextCursor: string | null = null): FailedBuildPage => ({ reports, nextCursor, scanned: 10 });

describe('complete newest-first Failed BR inventory', () => {
  it('continues through empty batches and sorts across workspaces and pages', async () => {
    const request = vi.fn().mockResolvedValueOnce(page([row('a', 100)], 'batch-2'))
      .mockResolvedValueOnce(page([], 'batch-3'))
      .mockResolvedValueOnce(page([row('z', 900), row('b', 200)]));
    const progress: FailedBuildPage[] = [];
    const result = await loadFailedBuildReports(request, new AbortController().signal, value => progress.push(value));
    expect(result.reports.map(r => r.startedAt)).toEqual([900, 200, 100]);
    expect(result).toMatchObject({ scanned: 30, nextCursor: null });
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/failedbr/reports?limit=50', '/api/v1/failedbr/reports?limit=50&cursor=batch-2',
      '/api/v1/failedbr/reports?limit=50&cursor=batch-3',
    ]);
    expect(progress.map(p => p.reports.length)).toEqual([1, 1, 3]);
  });

  it('starts a fresh traversal so new failures before an earlier cursor are discovered', async () => {
    let fresh = false;
    const request = vi.fn(async (url: string) => {
      const cursor = new URL(url, 'https://example.test').searchParams.get('cursor');
      if (!cursor) return page(fresh ? [row('a-new-workspace', 999)] : [], 'old-workspace');
      return page([row('z-old-workspace', 100)]);
    });
    expect((await loadFailedBuildReports(request, new AbortController().signal)).reports.map(r => r.startedAt)).toEqual([100]);
    fresh = true;
    expect((await loadFailedBuildReports(request, new AbortController().signal)).reports.map(r => r.startedAt)).toEqual([999, 100]);
    expect(request.mock.calls[2][0]).toBe('/api/v1/failedbr/reports?limit=50');
  });

  it('preserves distinct builds in a workspace and deduplicates legacy latest/history overlap', () => {
    const latest = row('a', 200, { historyId: 'latest' });
    const history = row('a', 200, { permanentReportId: 7 });
    const old = row('a', 100);
    const result = newestFailedReports([latest, old, history, latest, old]);
    expect(result).toEqual([history, old]);
    expect(latest.historyId).toBe('latest');
  });

  it('uses build time, unaffected by later saves or differing durations, with deterministic ties', () => {
    const rows = [row('z', 200), row('a', 100, { endedAt: 999 }), row('a', 200)];
    expect(newestFailedReports(rows).map(r => `${r.workspaceId}/${r.startedAt}`)).toEqual(['a/200', 'z/200', 'a/100']);
    expect(rows[0].workspaceId).toBe('z');
  });

  it('loads beyond the old single-batch and numbering request limits without losing rows', async () => {
    const request = vi.fn().mockResolvedValueOnce(page(Array.from({ length: 50 }, (_, i) => row('a', i + 1)), 'next'))
      .mockResolvedValueOnce(page(Array.from({ length: 25 }, (_, i) => row('z', 100 + i))));
    const result = await loadFailedBuildReports(request, new AbortController().signal);
    expect(result.reports).toHaveLength(75);
    expect(result.reports[0].startedAt).toBe(124);
    expect(result.reports.at(-1)?.startedAt).toBe(1);
  });

  it('rejects a mid-scan failure rather than returning an apparently complete partial inventory', async () => {
    const request = vi.fn().mockResolvedValueOnce(page([row('a', 100)], 'next'))
      .mockRejectedValueOnce(new Error('Storage unavailable'));
    await expect(loadFailedBuildReports(request, new AbortController().signal)).rejects.toThrow('Storage unavailable');
  });

  it('rejects an error or malformed response instead of treating it as an empty list', async () => {
    for (const data of [{ error: 'Unauthorized' }, { ...page([]), reports: [{ workspaceId: 1 }] }]) {
      await expect(loadFailedBuildReports(async () => data, new AbortController().signal)).rejects.toThrow('unreadable');
    }
  });

  it('aborts before further requests or state updates after sign-out/unmount', async () => {
    const controller = new AbortController();
    const progress = vi.fn();
    const request = vi.fn(async () => { controller.abort(); return page([row('a', 100)], 'next'); });
    await expect(loadFailedBuildReports(request, controller.signal, progress)).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]).toHaveLength(2);
    expect(progress).not.toHaveBeenCalled();
  });

  it('stops a repeated cursor instead of endlessly polling the same batch', async () => {
    const request = vi.fn().mockResolvedValue(page([], 'same'));
    await expect(loadFailedBuildReports(request, new AbortController().signal)).rejects.toThrow('did not advance');
    expect(request).toHaveBeenCalledTimes(2);
  });
});
