import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { deploymentStore, withDeploymentPersistence, isLiveDeployment, readDeploymentForPublish, type DeploymentStatus } from '../src/server/AgentV3/DeploymentStore';

// Slice 3 — registry queries + takedown status. Under VITEST Firestore is skipped, so the store
// methods are best-effort no-ops that must never throw and return safe empties. The takedown
// re-publish guard requires a strict registry read; no database is treated as unavailable.

describe('DeploymentStore registry — best-effort, VITEST-skipped', () => {
  it('list / listByUser return [] and setStatus returns false without Firestore, never throwing', async () => {
    await expect(deploymentStore.list()).resolves.toEqual([]);
    await expect(deploymentStore.list({ status: 'taken_down', limit: 10 })).resolves.toEqual([]);
    await expect(deploymentStore.listByUser('u1')).resolves.toEqual([]);
    await expect(deploymentStore.setStatus('ws-1', 'taken_down')).resolves.toBe(false);
    await expect(deploymentStore.setStatus('', 'active')).resolves.toBe(false);
  });

  it('getMany returns an empty map without Firestore (and for empty/blank input), never throwing', async () => {
    await expect(deploymentStore.getMany(['ws-1', 'ws-2'])).resolves.toEqual(new Map());
    await expect(deploymentStore.getMany([])).resolves.toEqual(new Map());
    await expect(deploymentStore.getMany([undefined, null, ''])).resolves.toEqual(new Map());
  });

  it('strict moderation reads distinguish an unavailable database from a missing app', async () => {
    await expect(deploymentStore.getStrict('ws-1')).rejects.toThrow(/temporarily unavailable/);
  });
});

describe('isLiveDeployment — the single definition behind the history-menu "Live" dot', () => {
  it('is live only for an active record with a URL', () => {
    expect(isLiveDeployment({ url: 'https://app.web.app', status: 'active' })).toBe(true);
    // status defaults to 'active' on legacy records written before the registry field existed
    expect(isLiveDeployment({ url: 'https://app.web.app' })).toBe(true);
  });
  it('is NEVER live for held / taken-down / urlless / missing records (no fake status)', () => {
    expect(isLiveDeployment({ url: 'https://app.web.app', status: 'held' })).toBe(false);
    expect(isLiveDeployment({ url: 'https://app.web.app', status: 'taken_down' })).toBe(false);
    expect(isLiveDeployment({ url: '', status: 'active' })).toBe(false);
    expect(isLiveDeployment(null)).toBe(false);
    expect(isLiveDeployment(undefined)).toBe(false);
  });
});

describe('withDeploymentPersistence — moderation and registry guard', () => {
  const record = (status: DeploymentStatus) => ({ workspaceId: 'ws-1', userId: 'u1', url: 'x', fileCount: 1, updatedAt: 1, status });
  beforeEach(() => { vi.spyOn(deploymentStore, 'getStrict').mockResolvedValue(null); });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it.each(['taken_down', 'held'] as const)('BLOCKS a first-party republish of %s before invoking the provider', async (status) => {
    vi.mocked(deploymentStore.getStrict).mockResolvedValue(record(status));
    const base = vi.fn(async () => 'https://x');
    const wrapped = withDeploymentPersistence(base, 'u1', 'firebase');
    await expect(wrapped('ws-1', new Map())).rejects.toThrow(status === 'held' ? /held for review/i : /taken down/i);
    expect(base).not.toHaveBeenCalled();
  });

  it.each(['active', 'unpublished', 'plan_paused', null] as const)('permits publishing when the known registry state is %s', async (status) => {
    vi.mocked(deploymentStore.getStrict).mockResolvedValue(status ? record(status) : null);
    const wrapped = withDeploymentPersistence(async () => 'https://ok.web.app', 'u1', 'firebase');
    await expect(wrapped('ws-1', new Map())).resolves.toBe('https://ok.web.app');
  });

  it('refuses an unreadable registry without exposing provider details or invoking the provider', async () => {
    vi.mocked(deploymentStore.getStrict).mockRejectedValue(new Error('secret-connection-details'));
    const base = vi.fn(async () => 'https://x');
    const wrapped = withDeploymentPersistence(base, 'u1', 'firebase');
    await expect(wrapped('ws-1', new Map())).rejects.toThrow('The deployment registry is temporarily unavailable. Please retry publishing shortly.');
    expect(base).not.toHaveBeenCalled();
  });

  it('bounds a hung registry read, refuses publishing, and clears its timer', async () => {
    vi.useFakeTimers();
    vi.mocked(deploymentStore.getStrict).mockReturnValue(new Promise(() => {}));
    const refusal = expect(readDeploymentForPublish('ws-1')).rejects.toThrow(/temporarily unavailable/);
    await vi.advanceTimersByTimeAsync(3_000);
    await refusal;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the deadline on a successful registry lookup', async () => {
    vi.useFakeTimers();
    await expect(readDeploymentForPublish('ws-1')).resolves.toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does NOT run the takedown guard for BYO providers (user\'s own host)', async () => {
    const wrapped = withDeploymentPersistence(async () => 'https://user.vercel.app', 'u1', 'vercel');
    await expect(wrapped('ws-1', new Map())).resolves.toBe('https://user.vercel.app');
    expect(deploymentStore.getStrict).not.toHaveBeenCalled();
  });
});
