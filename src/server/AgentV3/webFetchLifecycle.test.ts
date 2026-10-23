import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ check: vi.fn(), init: vi.fn((x: RequestInit) => x) }));
vi.mock('../lib/ssrfGuard', () => ({ assertPublicHttpUrl: mocks.check, publicOnlyInit: mocks.init }));
import { webFetchUrl } from './webFetch';
beforeEach(() => { vi.clearAllMocks(); mocks.check.mockResolvedValue({ ok: true }); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it('does not perform DNS or fetch for a closed parent', async () => {
 const c = new AbortController(); c.abort(); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
 expect((await webFetchUrl('https://example.com', { signal: c.signal })).ok).toBe(false);
 expect(mocks.check).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
it('bounds DNS and does not start fetch after its late success', async () => {
 let resolve!: (v: { ok: boolean }) => void;
 mocks.check.mockImplementation(() => new Promise(r => { resolve = r; }));
 const c = new AbortController(); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
 const pending = webFetchUrl('https://example.com', { signal: c.signal });
 await vi.waitFor(() => expect(mocks.check).toHaveBeenCalled()); c.abort();
 expect((await pending).ok).toBe(false); resolve({ ok: true }); await Promise.resolve();
 expect(fetch).not.toHaveBeenCalled();
});
it('bounds fetch that ignores cancellation and propagates abort to its signal', async () => {
 vi.useFakeTimers(); let signal!: AbortSignal;
 vi.stubGlobal('fetch', vi.fn((_u, init) => { signal = init.signal; return new Promise(() => {}); }));
 const pending = webFetchUrl('https://example.com', { deadlineAtMs: Date.now() + 20 });
 await vi.advanceTimersByTimeAsync(21);
 expect((await pending).ok).toBe(false); expect(signal.aborted).toBe(true); expect(mocks.init).toHaveBeenCalled();
});
it('bounds body reads and observes rejected cleanup without blocking completion', async () => {
 const c = new AbortController(); const read = vi.fn(() => new Promise(() => {}));
 const cancel = vi.fn(async () => { throw Error('closed'); });
 vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'text/plain' }), body: { getReader: () => ({ read, cancel }) } })));
 const pending = webFetchUrl('https://example.com', { signal: c.signal });
 await vi.waitFor(() => expect(read).toHaveBeenCalled()); c.abort();
 expect((await pending).ok).toBe(false); expect(cancel).toHaveBeenCalledOnce();
});
