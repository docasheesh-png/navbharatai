import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadBuildReportNumbers, unavailableReportNumbers } from '../src/lib/loadBuildReportNumbers';
const rows = [{ workspaceId: 'synthetic', id: '100', startedAt: 100, prompt: 'private synthetic report prompt' }];
const numbering = { ordinal: 9, total: 10, asOf: 1000 };
afterEach(() => { vi.unstubAllGlobals(); });
describe('metadata-only client numbering', () => {
  it('sends only row references and joins by identity/timestamp, not response order', async () => {
    const fetcher = vi.fn(async () => Response.json({ numbers: [{ workspaceId: 'synthetic', historyId: '100', startedAt: 100, numbering }] }));
    vi.stubGlobal('fetch', fetcher);
    const signal = new AbortController().signal;
    const result = await loadBuildReportNumbers('latest', rows, 'fixture-token', signal);
    expect(result[0].numbering).toEqual(numbering);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/admin/all-builds/numbers'); expect(url).not.toContain('synthetic');
    expect(JSON.parse(String(init.body))).toEqual({ reports: [{ workspaceId: 'synthetic', historyId: '100', startedAt: 100 }] });
    expect(init.signal).toBe(signal); expect(String(init.body)).not.toContain('private synthetic');
  });
  it('preserves browsable rows when numbering is unavailable', () => {
    expect(unavailableReportNumbers(rows)).toEqual([{ ...rows[0], numbering: { ordinal: null, total: null, asOf: null } }]);
  });
  it('rejects errors, malformed ranks, duplicates and stale/mismatched references', async () => {
    for (const payload of [{ error: 'failure' }, { numbers: [{ workspaceId: 'other', historyId: '100', startedAt: 100, numbering }] }, { numbers: [{ workspaceId: 'synthetic', historyId: '100', startedAt: 101, numbering }] }, { numbers: [{ workspaceId: 'synthetic', historyId: '100', startedAt: 100, numbering: { ...numbering, ordinal: -1 } }] }]) {
      vi.stubGlobal('fetch', vi.fn(async () => Response.json(payload)));
      await expect(loadBuildReportNumbers('latest', rows, 'fixture', new AbortController().signal)).rejects.toThrow();
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    await expect(loadBuildReportNumbers('failed', rows, 'fixture', new AbortController().signal)).rejects.toThrow(/unavailable/);
  });
  it('has no request for empty or undated rows and never guesses a number', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect(await loadBuildReportNumbers('latest', [], 'fixture', new AbortController().signal)).toEqual([]);
    expect((await loadBuildReportNumbers('latest', [{ workspaceId: 'legacy' }], 'fixture', new AbortController().signal))[0].numbering?.ordinal).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
