import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('axios', () => ({ default: { get: m.get } }));
import { fetchPublicRepo } from './githubFetch';
beforeEach(() => {
  m.get.mockReset().mockImplementation(async (url: string) => ({ data: url.includes('/git/trees/') ? { tree: [{ type: 'blob', path: 'package.json' }] } : { default_branch: 'main' } }));
});
afterEach(() => { vi.restoreAllMocks(); });
describe('Repo Analyst read-only fetch cancellation', () => {
  it('forwards a selected request signal to every metadata and content fetch', async () => {
    const signal = new AbortController().signal;
    await fetchPublicRepo({ owner: 'acme', repo: 'widget' }, 'non-secret-fixture', signal);
    expect(m.get).toHaveBeenCalledTimes(5);
    for (const [, config] of m.get.mock.calls) expect(config).toMatchObject({ signal, headers: { Authorization: 'token non-secret-fixture' } });
  });
  it('does not issue even a metadata request when already cancelled', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(fetchPublicRepo({ owner: 'acme', repo: 'widget' }, undefined, controller.signal)).rejects.toThrow();
    expect(m.get).not.toHaveBeenCalled();
  });
  it('does not swallow cancellation as an optional README miss and continue more requests', async () => {
    const controller = new AbortController();
    m.get.mockImplementationOnce(async () => ({ data: { default_branch: 'main' } }));
    m.get.mockImplementationOnce(async () => { controller.abort(); throw new Error('cancelled request'); });
    await expect(fetchPublicRepo({ owner: 'acme', repo: 'widget' }, undefined, controller.signal)).rejects.toThrow();
    expect(m.get).toHaveBeenCalledTimes(2);
  });
  it('unselected callers retain the original request options without an added signal', async () => {
    await fetchPublicRepo({ owner: 'acme', repo: 'widget' });
    for (const [, config] of m.get.mock.calls) expect(config).not.toHaveProperty('signal');
  });
});
