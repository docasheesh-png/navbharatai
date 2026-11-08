import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestRouterOneCatalog, RouterOneCatalogPanel } from './RouterOneCatalogPanel';
afterEach(() => vi.unstubAllGlobals());
const status = { enabled: true, mode: 'synced', lastGood: { syncedAt: 123, ranked: [] }, lastError: null };
describe('Router One catalog admin caller', () => {
  it.each([false, true])('calls the real authenticated endpoint, refresh=%s', async refresh => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(status)));
    vi.stubGlobal('fetch', fetcher);
    const signal = new AbortController().signal;
    expect(await requestRouterOneCatalog('synthetic-token', refresh, signal)).toEqual({ enabled: true, mode: 'synced', syncedAt: 123, modelCount: 0, hasError: false });
    expect(fetcher).toHaveBeenCalledWith(`/api/v1/agentv3/router-one/catalog${refresh ? '/refresh' : ''}`, { method: refresh ? 'POST' : 'GET', headers: { 'x-admin-token': 'synthetic-token' }, signal });
  });
  it.each([{}, null, { ...status, lastGood: {} }])('does not report success for malformed status', async body => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body))));
    await expect(requestRouterOneCatalog('synthetic', false, new AbortController().signal)).rejects.toThrow('incomplete');
  });
  it('preserves unknown catalog and failed sync distinctly', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...status, lastGood: null, lastError: { at: 123, message: 'private upstream text' } }))));
    expect(await requestRouterOneCatalog('synthetic', false, new AbortController().signal)).toEqual({ enabled: true, mode: 'synced', syncedAt: null, modelCount: null, hasError: true });
  });
  it('surfaces authorization failures without upstream body text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('private upstream text', { status: 403 })));
    await expect(requestRouterOneCatalog('synthetic', true, new AbortController().signal)).rejects.toThrow('HTTP 403');
  });
  it('starts unread with refresh disabled and never exposes credentials', () => {
    const html = renderToStaticMarkup(<RouterOneCatalogPanel adminToken="never-display" />);
    expect(html).toContain('Status has not been read');
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('never-display');
  });
});
