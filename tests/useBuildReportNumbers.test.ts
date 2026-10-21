import { beforeEach, describe, expect, it, vi } from 'vitest';
const harness = vi.hoisted(() => ({ value: null as any, effect: null as null | (() => void | (() => void)) }));
vi.mock('react', () => ({
  useState: (initial: unknown) => [harness.value ?? initial, (value: unknown) => { harness.value = value; }],
  useEffect: (effect: () => void | (() => void)) => { harness.effect = effect; },
}));
const loader = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/loadBuildReportNumbers', async importOriginal => ({
  ...await importOriginal<typeof import('../src/lib/loadBuildReportNumbers')>(), loadBuildReportNumbers: loader,
}));
import { useBuildReportNumbers } from '../src/hooks/useBuildReportNumbers';
const a = [{ workspaceId: 'a', id: '1', startedAt: 1 }];
const b = [{ workspaceId: 'b', id: '2', startedAt: 2 }];
const numbered = [{ ...b[0], numbering: { ordinal: 10, total: 10, asOf: 100 } }];
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
beforeEach(() => { harness.value = null; harness.effect = null; loader.mockReset(); });
describe('numbering hook lifecycle (isolated effect harness)', () => {
  it('returns browsable rows immediately and ignores a late response from a previous page/filter', async () => {
    let oldResolve!: (value: unknown) => void, newResolve!: (value: unknown) => void;
    loader.mockImplementationOnce(() => new Promise(resolve => { oldResolve = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { newResolve = resolve; }));
    expect(useBuildReportNumbers(a, 'latest', 'token-a')).toBe(a);
    const cleanup = harness.effect!();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(useBuildReportNumbers(b, 'latest', 'token-a')).toBe(b);
    if (typeof cleanup === 'function') cleanup();
    harness.effect!();
    expect(loader.mock.calls[0][3].aborted).toBe(true);
    oldResolve([{ ...a[0], numbering: { ordinal: 1, total: 1, asOf: 1 } }]); await flush();
    expect(harness.value).toBeNull();
    newResolve(numbered); await flush();
    expect(useBuildReportNumbers(b, 'latest', 'token-a')).toBe(numbered);
    expect(useBuildReportNumbers(b, 'latest', 'new-token')).toBe(b);
  });
  it('preserves rows with unavailable labels on metadata errors', async () => {
    loader.mockRejectedValue(new Error('metadata offline'));
    expect(useBuildReportNumbers(a, 'failed', 'token')).toBe(a);
    harness.effect!(); await flush();
    expect(useBuildReportNumbers(a, 'failed', 'token')).toEqual([{ ...a[0], numbering: { ordinal: null, total: null, asOf: null } }]);
  });
  it('does not publish errors after unmount or fetch empty lists', async () => {
    let reject!: (reason: Error) => void;
    loader.mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
    useBuildReportNumbers(a, 'latest', 'token'); const cleanup = harness.effect!();
    if (typeof cleanup === 'function') cleanup();
    reject(new Error('late error')); await flush(); expect(harness.value).toBeNull();
    useBuildReportNumbers(undefined, 'latest', 'token'); harness.effect!();
    expect(loader).toHaveBeenCalledTimes(1);
  });
});
