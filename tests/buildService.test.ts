import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildApp, startPreview, previewIframeSrc } from '../src/services/buildService';

afterEach(() => vi.restoreAllMocks());

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as any);
}

describe('buildService', () => {
  it('buildApp posts to /api/build and returns the parsed response', async () => {
    const resp = { ok: true, files: { 'index.html': '<h1>hi</h1>' }, fileCount: 1, applied: 1, failed: 0, verify: { ok: true, errors: 0, warnings: 0, issues: [] }, repairAttempts: 0, baselineSnapshotId: 's1' };
    const fetchMock = mockFetch(200, resp);
    vi.stubGlobal('fetch', fetchMock);

    const r = await buildApp({ prompt: 'make a page', preview: true });
    expect(r.ok).toBe(true);
    expect(r.files['index.html']).toContain('hi');
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/build');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toMatchObject({ prompt: 'make a page', preview: true });
  });

  it('buildApp throws with the server error message on failure', async () => {
    vi.stubGlobal('fetch', mockFetch(500, { error: 'Build failed' }));
    await expect(buildApp({ prompt: 'x' })).rejects.toThrow('Build failed');
  });

  it('startPreview posts files to /api/preview', async () => {
    const fetchMock = mockFetch(200, { ok: true, target: 'static', url: '/preview/abc', sessionId: 'abc' });
    vi.stubGlobal('fetch', fetchMock);
    const r = await startPreview({ 'index.html': '<h1>x</h1>' }, 'p1');
    expect(r.target).toBe('static');
    expect(r.url).toBe('/preview/abc');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ projectId: 'p1' });
  });

  it('previewIframeSrc builds the static preview path', () => {
    expect(previewIframeSrc('abc')).toBe('/preview/abc');
  });
});
