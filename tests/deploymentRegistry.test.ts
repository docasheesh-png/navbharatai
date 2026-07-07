import { describe, it, expect } from 'vitest';
import { deploymentStore, withDeploymentPersistence, isLiveDeployment } from '../src/server/AgentV3/DeploymentStore';

// Slice 3 — registry queries + takedown status. Under VITEST Firestore is skipped, so the store
// methods are best-effort no-ops that must never throw and return safe empties. The takedown
// re-publish guard is testable via a stubbed store.get.

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

describe('withDeploymentPersistence — taken-down republish guard', () => {
  it('BLOCKS a first-party republish when the registry marks the app taken_down (base never called)', async () => {
    const orig = deploymentStore.get;
    (deploymentStore as any).get = async () => ({ workspaceId: 'ws-1', userId: 'u1', url: 'x', fileCount: 1, updatedAt: 1, status: 'taken_down' });
    try {
      let called = false;
      const wrapped = withDeploymentPersistence(async () => { called = true; return 'https://x'; }, 'u1', 'firebase');
      await expect(wrapped('ws-1', new Map([['dist/i.js', Buffer.alloc(1024)]]))).rejects.toThrow(/taken down/i);
      expect(called).toBe(false);
    } finally {
      (deploymentStore as any).get = orig;
    }
  });

  it('ALLOWS a normal first-party deploy when the app is active', async () => {
    const orig = deploymentStore.get;
    (deploymentStore as any).get = async () => ({ workspaceId: 'ws-1', userId: 'u1', url: 'x', fileCount: 1, updatedAt: 1, status: 'active' });
    try {
      const wrapped = withDeploymentPersistence(async () => 'https://ok.web.app', 'u1', 'firebase');
      await expect(wrapped('ws-1', new Map([['dist/i.js', Buffer.alloc(1024)]]))).resolves.toBe('https://ok.web.app');
    } finally {
      (deploymentStore as any).get = orig;
    }
  });

  it('does NOT run the takedown guard for BYO providers (user\'s own host)', async () => {
    const orig = deploymentStore.get;
    let getCalled = false;
    (deploymentStore as any).get = async () => { getCalled = true; return null; };
    try {
      const wrapped = withDeploymentPersistence(async () => 'https://user.vercel.app', 'u1', 'vercel');
      await expect(wrapped('ws-1', new Map([['dist/i.js', Buffer.alloc(1024)]]))).resolves.toBe('https://user.vercel.app');
      expect(getCalled).toBe(false);
    } finally {
      (deploymentStore as any).get = orig;
    }
  });
});
