import { afterEach, expect, it, vi } from 'vitest';
import { DEPLOYMENT_BUDGET_OBSERVATION_TIMEOUT_MS, publishDeploymentPaidLimit } from './deploymentBudget';
afterEach(() => vi.useRealTimers());
it('coalesces ten thousand observations without caching reservation authority', async () => {
  const database = {}, observe = vi.fn(async () => ({ capNanoUsd: 10e9, revision: 1 }));
  await Promise.all(Array.from({ length: 10_000 }, () => publishDeploymentPaidLimit(database, 10e9, observe)));
  expect(observe).toHaveBeenCalledOnce();
});
it('publishes zero and later configuration changes independently', async () => {
  const database = {}, observe = vi.fn(async () => ({ capNanoUsd: 0, revision: 2 }));
  await publishDeploymentPaidLimit(database, 0, observe);
  await publishDeploymentPaidLimit(database, 2e9, observe);
  expect(observe).toHaveBeenCalledTimes(2);
});
it('does not share observations across database authorities', async () => {
  const observe = vi.fn(async () => ({ capNanoUsd: 0, revision: 1 }));
  await Promise.all([publishDeploymentPaidLimit({}, 0, observe), publishDeploymentPaidLimit({}, 0, observe)]);
  expect(observe).toHaveBeenCalledTimes(2);
});
it('coalesces failures, fails closed, and retries after a bounded cooldown', async () => {
  vi.useFakeTimers(); const database = {}, observe = vi.fn().mockRejectedValue(new Error('private transport detail'));
  await expect(publishDeploymentPaidLimit(database, 0, observe)).rejects.toThrow('Shared paid-budget observation unavailable');
  await expect(publishDeploymentPaidLimit(database, 0, observe)).rejects.toThrow('Shared paid-budget observation unavailable');
  expect(observe).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(1000); observe.mockResolvedValue({ capNanoUsd: 0, revision: 1 });
  await expect(publishDeploymentPaidLimit(database, 0, observe)).resolves.toBeUndefined();
  expect(observe).toHaveBeenCalledTimes(2);
});
it.each([NaN, -1, 10e9 + 1, Infinity])('rejects invalid configured cap %s without observing', async cap => {
  const observe = vi.fn(); await expect(publishDeploymentPaidLimit({}, cap, observe)).rejects.toThrow(); expect(observe).not.toHaveBeenCalled();
});
it.each([{ capNanoUsd: 1, revision: 1 }, { capNanoUsd: 0, revision: 0 }, { capNanoUsd: 0, revision: NaN }])('rejects invalid observation %j', async policy => {
  await expect(publishDeploymentPaidLimit({}, 0, async () => policy)).rejects.toThrow('Shared paid-budget observation unavailable');
});
it('bounds a stalled observation and never treats a late write as permission', async () => {
  vi.useFakeTimers();
  const database = {};
  let complete!: (value: { capNanoUsd: number; revision: number }) => void;
  const observe = vi.fn(() => new Promise<{ capNanoUsd: number; revision: number }>(resolve => { complete = resolve; }));
  const result = publishDeploymentPaidLimit(database, 0, observe);
  const rejection = expect(result).rejects.toThrow('Shared paid-budget observation unavailable');
  await vi.advanceTimersByTimeAsync(DEPLOYMENT_BUDGET_OBSERVATION_TIMEOUT_MS);
  await rejection;
  complete({ capNanoUsd: 0, revision: 1 });
  await Promise.resolve();
  await expect(publishDeploymentPaidLimit(database, 0, observe)).rejects.toThrow('Shared paid-budget observation unavailable');
  expect(observe).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1000);
  await expect(publishDeploymentPaidLimit(database, 0, async () => ({ capNanoUsd: 0, revision: 2 }))).resolves.toBeUndefined();
  expect(vi.getTimerCount()).toBe(0);
});
