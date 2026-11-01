import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { dispatchGithubBuild, githubBuildGet } from './githubBuildApi';

vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const rejected = (status: number, headers = {}, message = '') => ({ response: { status, headers, data: { message } } });

beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());

describe('bounded build-status reads', () => {
  it('recovers from a lost connection and a 502 with a timeout on every attempt', async () => {
    vi.mocked(axios.get).mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockRejectedValueOnce(rejected(502)).mockResolvedValueOnce({ data: { status: 'completed' } });
    const pending = githubBuildGet('/runs', { headers: { Accept: 'application/json' } });
    await vi.runAllTimersAsync();
    expect((await pending).data.status).toBe('completed');
    expect(axios.get).toHaveBeenCalledTimes(3);
    for (const [, options] of vi.mocked(axios.get).mock.calls) expect(options?.timeout).toBe(10_000);
  });

  it('stops after three transient failures and preserves the final error', async () => {
    const failure = rejected(503);
    vi.mocked(axios.get).mockRejectedValue(failure);
    const assertion = expect(githubBuildGet('/runs')).rejects.toBe(failure);
    await vi.runAllTimersAsync();
    await assertion;
    expect(axios.get).toHaveBeenCalledTimes(3);
  });

  it.each([401, 403, 404, 422])('does not retry a definitive HTTP %s rejection', async (status) => {
    const failure = rejected(status);
    vi.mocked(axios.get).mockRejectedValue(failure);
    await expect(githubBuildGet('/runs')).rejects.toBe(failure);
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it('honours a short Retry-After and leaves a long rate limit to the next poll', async () => {
    vi.mocked(axios.get).mockRejectedValueOnce(rejected(429, { 'retry-after': '2' }))
      .mockResolvedValueOnce({ data: 'ready' });
    const pending = githubBuildGet('/runs');
    await vi.advanceTimersByTimeAsync(1999);
    expect(axios.get).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).data).toBe('ready');
    vi.mocked(axios.get).mockClear().mockRejectedValue(rejected(429, { 'retry-after': '60' }));
    await expect(githubBuildGet('/runs')).rejects.toMatchObject({ response: { status: 429 } });
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it('keeps the longer binary download timeout', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({ data: new ArrayBuffer(0) });
    await githubBuildGet('/artifact', { timeout: 90_000 });
    expect(axios.get).toHaveBeenCalledWith('/artifact', { timeout: 90_000 });
  });
});

describe('build dispatch cannot duplicate an accepted build', () => {
  it('waits for a newly pushed workflow to be indexed before its one accepted dispatch', async () => {
    vi.mocked(axios.post).mockRejectedValueOnce(rejected(404))
      .mockRejectedValueOnce(rejected(422, {}, "Workflow does not have 'workflow_dispatch' trigger"))
      .mockResolvedValueOnce({ status: 204 });
    const pending = dispatchGithubBuild('/dispatches', { ref: 'main' }, {});
    await vi.runAllTimersAsync();
    expect((await pending).status).toBe(204);
    expect(axios.post).toHaveBeenCalledTimes(3);
    expect(axios.post).toHaveBeenLastCalledWith('/dispatches', { ref: 'main' }, { timeout: 15_000 });
  });

  it.each([new Error('timeout after acceptance'), rejected(500), rejected(502), rejected(401), rejected(422, {}, 'Unexpected inputs')])(
    'does not resend a dispatch after ambiguous failure or invalid inputs (%j)', async (failure) => {
      vi.mocked(axios.post).mockRejectedValue(failure);
      await expect(dispatchGithubBuild('/dispatches', {}, {})).rejects.toBe(failure);
      expect(axios.post).toHaveBeenCalledTimes(1);
    });

  it('bounds indexing retries when the workflow is actually missing', async () => {
    vi.mocked(axios.post).mockRejectedValue(rejected(404));
    const assertion = expect(dispatchGithubBuild('/dispatches', {}, {})).rejects.toMatchObject({ response: { status: 404 } });
    await vi.runAllTimersAsync();
    await assertion;
    expect(axios.post).toHaveBeenCalledTimes(3);
  });
});
