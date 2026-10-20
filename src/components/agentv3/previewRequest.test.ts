import { afterEach, describe, expect, it, vi } from 'vitest';

const headers = vi.hoisted(() => vi.fn(async (refresh: boolean) => ({
  'Content-Type': 'application/json', Authorization: `Bearer ${refresh ? 'fresh' : 'cached'}`,
})));
vi.mock('../../lib/authHeaders', () => ({ authJsonHeaders: headers }));
import { previewRequest } from './previewRequest';

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('verified preview requests recover a stale token once', () => {
  for (const status of [401, 403]) {
    it(`refreshes after ${status} and preserves the JSON body, keepalive and signal`, async () => {
      const init = { method: 'POST', body: JSON.stringify({ workspaceId: 'agentv3-owner-session' }), keepalive: true, signal: new AbortController().signal };
      const refusal = new Response('refused', { status });
      const success = new Response('streamed result');
      const fetcher = vi.fn().mockResolvedValueOnce(refusal).mockResolvedValueOnce(success);
      vi.stubGlobal('fetch', fetcher);
      expect(await previewRequest('/api/agentv3/preview-diagnose', init)).toBe(success);
      expect(headers.mock.calls).toEqual([[false], [true]]);
      expect(refusal.bodyUsed).toBe(true);
      expect(fetcher.mock.calls.map(([, req]) => req)).toEqual([
        { ...init, headers: new Headers({ 'Content-Type': 'application/json', Authorization: 'Bearer cached' }) },
        { ...init, headers: new Headers({ 'Content-Type': 'application/json', Authorization: 'Bearer fresh' }) },
      ]);
    });
  }
  it('returns a second refusal without looping', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('refused', { status: 403 }));
    vi.stubGlobal('fetch', fetcher);
    expect((await previewRequest('/api/agentv3/preview-health', {})).status).toBe(403);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  for (const status of [200, 400, 404, 429, 500]) {
    it(`does not replay a ${status} response`, async () => {
      const response = new Response('result', { status });
      const fetcher = vi.fn().mockResolvedValue(response);
      vi.stubGlobal('fetch', fetcher);
      expect(await previewRequest('/api/agentv3/preview-health', {})).toBe(response);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(headers.mock.calls).toEqual([[false]]);
    });
  }
  it('replaces stale caller authorization case-insensitively', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('result'));
    vi.stubGlobal('fetch', fetcher);
    await previewRequest('/api/agentv3/preview-health', { headers: { authorization: 'Bearer obsolete', 'X-Preview': 'value' } });
    const sent = fetcher.mock.calls[0][1].headers as Headers;
    expect(sent.get('authorization')).toBe('Bearer cached');
    expect(sent.get('X-Preview')).toBe('value');
  });
  it('does not replay a network failure whose outcome is unknown', async () => {
    const error = new Error('connection lost');
    const fetcher = vi.fn().mockRejectedValue(error);
    vi.stubGlobal('fetch', fetcher);
    await expect(previewRequest('/api/agentv3/preview-diagnose', {})).rejects.toBe(error);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
