import { describe, it, expect } from 'vitest';
import { deploymentStore, withDeploymentPersistence, isLiveDeployment, publishedAppList } from './DeploymentStore';
import { liveAppCount, publishedAppCap } from '../lib/HostingQuota';

describe('DeploymentStore (R5 §5.1, VITEST-skip: no Firestore)', () => {
  it('record() is a best-effort no-op in tests and never throws', async () => {
    await expect(deploymentStore.record('agentv3-u1-s1', 'u1', 'https://x.web.app', 5)).resolves.toBeUndefined();
  });

  it('get() returns null in tests (Firestore skipped)', async () => {
    expect(await deploymentStore.get('agentv3-u1-s1')).toBeNull();
  });
});

describe('withDeploymentPersistence', () => {
  it('returns the base deploy URL unchanged and preserves the DeployFn signature', async () => {
    let calledWith: { ws: string; size: number } | null = null;
    const base = async (ws: string, files: Map<string, Buffer>) => {
      calledWith = { ws, size: files.size };
      return `https://site--${ws}.web.app`;
    };
    const wrapped = withDeploymentPersistence(base, 'u1');
    const files = new Map<string, Buffer>([['index.html', Buffer.from('<h1>hi</h1>')]]);
    const url = await wrapped('agentv3-u1-s1', files);
    expect(url).toBe('https://site--agentv3-u1-s1.web.app');
    expect(calledWith).toEqual({ ws: 'agentv3-u1-s1', size: 1 });
  });

  it('propagates a deploy failure (recording never masks a real error)', async () => {
    const base = async () => { throw new Error('Firebase 403'); };
    const wrapped = withDeploymentPersistence(base, null);
    await expect(wrapped('ws', new Map())).rejects.toThrow('Firebase 403');
  });
});

/**
 * "YOUR PUBLISHED APPS" (admin 2026-08-21: "user apni saari live apps ek jagah dekhe aur wahin se hata
 * sake").
 *
 * THE GAP: Unpublish only reaches the app whose chat is open. Delete the chat and the app stays live
 * forever with nothing pointing at it — still holding one of the five free slots and one of the
 * platform's scarce Firebase channels. This list is keyed by USER, which is what makes an orphaned
 * app reachable again.
 */
describe('publishedAppList — the user\'s own live apps', () => {
  const rec = (over: Record<string, unknown> = {}) => ({
    workspaceId: 'ws-a', url: 'https://p--ws-a-h.web.app', status: 'active',
    sizeMb: 1.5, updatedAt: 1000, ...over,
  }) as never;

  it('lists only LIVE apps — an unpublished or taken-down one offers nothing to act on', () => {
    const apps = publishedAppList([
      rec(),
      rec({ workspaceId: 'ws-b', status: 'unpublished' }),
      rec({ workspaceId: 'ws-c', status: 'taken_down' }),
      rec({ workspaceId: 'ws-d', status: 'held' }),
    ]);
    expect(apps.map((a) => a.workspaceId)).toEqual(['ws-a']);
  });

  it('THE ORPHAN CASE: an app whose chat was deleted is still listed, and flagged as such', () => {
    // markOrphaned deliberately does NOT change status — the app really is still serving, and hiding
    // it here would recreate the very hole this endpoint closes.
    const apps = publishedAppList([rec({ orphaned: true })]);
    expect(apps).toHaveLength(1);
    expect(apps[0].orphaned).toBe(true);
    expect(publishedAppList([rec()])[0].orphaned).toBe(false);
  });

  it('a record with no URL is not live, whatever its status says', () => {
    expect(publishedAppList([rec({ url: '' })])).toEqual([]);
    expect(isLiveDeployment({ url: '', status: 'active' })).toBe(false);
  });

  it('a legacy record with no status still counts as live (it really was)', () => {
    expect(publishedAppList([rec({ status: undefined })]).map((a) => a.workspaceId)).toEqual(['ws-a']);
  });

  it('an unknown size is reported as UNKNOWN, never as 0.0 MB', () => {
    // "0.0 MB" would be a measurement we never took. The UI says "size unknown" for null.
    expect(publishedAppList([rec({ sizeMb: undefined })])[0].sizeMb).toBeNull();
    expect(publishedAppList([rec({ updatedAt: undefined })])[0].updatedAt).toBeNull();
  });

  it('survives an empty or failed lookup rather than throwing at the user', () => {
    expect(publishedAppList([])).toEqual([]);
    expect(publishedAppList(null)).toEqual([]);
    expect(publishedAppList([rec({ workspaceId: '' })])).toEqual([]);
  });

  /**
   * THE CONSISTENCY RULE. The screen shows "N of 5 used"; the publish gate refuses at the same
   * number. If the two counted different things, a user could see "3 of 5" and still be refused —
   * a limit that lies about itself.
   */
  it('its count matches EXACTLY what the five-app cap enforces', () => {
    const records = [
      rec(), rec({ workspaceId: 'ws-b' }), rec({ workspaceId: 'ws-c' }),
      rec({ workspaceId: 'ws-d', status: 'unpublished' }),   // freed — counted by neither
    ];
    expect(publishedAppList(records)).toHaveLength(liveAppCount(records as never));
    expect(publishedAppList(records).length).toBeLessThan(publishedAppCap());
  });
});
