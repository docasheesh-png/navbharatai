import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Execute the actual access callback with inert injected I/O, not a copied implementation.
// No component import, Firebase initialization, provider call or real network request.
const source = readFileSync(join(__dirname, '..', 'src/components/ide/NavAppStore.tsx'), 'utf8');
const marker = '  const loadStatus = useCallback(async () => {';
const start = source.indexOf(marker);
const end = source.indexOf('\n  }, []);', start);
if (start < 0 || end <= start) throw new Error('Store access callback not found');
const body = source.slice(start + marker.length, end);

function fixture(fetch: (...args: any[]) => Promise<any>) {
  const deps = {
    fetch, AbortController, setTimeout, clearTimeout,
    liveRef: { current: true }, statusRequestRef: { current: 0 }, statusReportedRef: { current: false },
    storeHeaders: async () => ({ 'x-admin-token': 'inert-test-token' }),
    readStoreStatus: vi.fn(() => ({ status: { isAdmin: true }, problem: null })),
    setStatus: vi.fn(), setStatusLoading: vi.fn(), setStatusProblem: vi.fn(), setReviewError: vi.fn(),
  };
  const names = Object.keys(deps);
  const run = new Function(...names, `return async () => {${body}}`)(...Object.values(deps)) as () => Promise<void>;
  return { ...deps, run };
}

afterEach(() => { vi.useRealTimers(); });

describe('store access timeout remains an actionable diagnosis', () => {
  it('does not replace the timeout with a generic network error after abort rejection', async () => {
    vi.useFakeTimers();
    const f = fixture(vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    })));
    const pending = f.run();
    await vi.advanceTimersByTimeAsync(15_000);
    await pending;
    expect(f.setStatusProblem).toHaveBeenLastCalledWith('The access check timed out. Check your connection and try again.');
    expect(f.setStatusLoading).toHaveBeenLastCalledWith(false);
    expect(f.setStatus).not.toHaveBeenCalledWith({ isAdmin: true });
  });

  it('ignores a response that finishes after the timeout even if the transport ignores abort', async () => {
    vi.useFakeTimers();
    let resolve!: (value: unknown) => void;
    const f = fixture(vi.fn(() => new Promise(r => { resolve = r; })));
    const pending = f.run();
    await vi.advanceTimersByTimeAsync(15_000);
    resolve({ ok: true, status: 200, json: async () => ({}) });
    await pending;
    expect(f.readStoreStatus).not.toHaveBeenCalled();
    expect(f.setStatusProblem).toHaveBeenLastCalledWith('The access check timed out. Check your connection and try again.');
    expect(f.setStatus).not.toHaveBeenCalledWith({ isAdmin: true });
  });

  it('retains the distinct message for a non-timeout network failure', async () => {
    vi.useFakeTimers();
    const f = fixture(vi.fn(async () => { throw new Error('offline'); }));
    await f.run();
    expect(f.setStatusProblem).toHaveBeenLastCalledWith('Could not verify store access. Check your connection and try again.');
    expect(vi.getTimerCount()).toBe(0);
  });
});
