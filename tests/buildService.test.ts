import { describe, it, expect, vi, afterEach } from 'vitest';
import { startPreview, previewIframeSrc, previewSrcFor } from '../src/services/buildService';

afterEach(() => vi.restoreAllMocks());

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as any);
}

describe('buildService', () => {
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

  it('previewSrcFor resolves the iframe src per runtime target', () => {
    expect(previewSrcFor({ ok: true, target: 'static', sessionId: 'abc' })).toBe('/preview/abc');
    expect(previewSrcFor({ ok: true, target: 'server-container', sessionId: 'srv' })).toBe('/preview-app/srv/');
    expect(previewSrcFor({ ok: false, target: 'webcontainer', reason: 'pending' })).toBeNull();
    expect(previewSrcFor(undefined)).toBeNull();
  });
});
