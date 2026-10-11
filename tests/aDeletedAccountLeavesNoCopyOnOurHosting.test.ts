// A DELETED ACCOUNT LEAVES NO COPY OF ITS APPS ON OUR HOSTING (admin 2026-10-11, Q-795 — "zaroor theek ho").
//
// Every green build keeps a static copy of the app (a "snapshot") in the bucket under `s-<hash>` or in a
// Firebase channel `sn-…`, both keyed by the workspace id. Account deletion erased every Firestore store of
// the user's workspaces and left those copies served for ever. THE CLASS: a copy of the user's app outside
// the stores an eraser lists. The eraser now removes both locations for every workspace, and it runs BEFORE
// the Firestore erase, because the workspace ids are listed only in the stores that erase deletes.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { eraseUserSnapshots, snapshotTargets, SNAPSHOT_WORKSPACE_SOURCES } from '../src/server/lib/snapshotErase';
import { snapshotSubdomain } from '../src/server/AgentV3/bucketOnlyPublish';
import { snapshotChannelId } from '../src/server/AgentV3/previewSnapshot';

const UID = 'abcDEF1234567890abcDEF123456';
const ws = (s: string) => `agentv3-${UID}-${s}`;

describe('the snapshot eraser', () => {
  it('🔒 removes the bucket copy AND the channel of every workspace the user owns, and only theirs', async () => {
    const removed: string[] = [];
    const channels: string[] = [];
    const r = await eraseUserSnapshots(UID, {
      listWorkspaceIds: async () => [ws('s1'), ws('s2'), ws('s1'), 'agentv3-SOMEONEELSE-x'],
      removeBucket: async (sub) => { removed.push(sub); return { attempted: true, deleted: true }; },
      deleteChannel: async (id) => { channels.push(id); return true; },
    });
    expect(r.workspaces).toBe(2);
    expect(removed.sort()).toEqual([snapshotSubdomain(ws('s1')), snapshotSubdomain(ws('s2'))].sort());
    expect(channels.sort()).toEqual([snapshotChannelId(ws('s1')), snapshotChannelId(ws('s2'))].sort());
    expect(r.bucketRemoved).toBe(2);
    expect(r.channelsRemoved).toBe(2);
    expect(r.failures).toEqual([]);
  });

  it('a location that could not be removed is NAMED, never counted as done', async () => {
    const r = await eraseUserSnapshots(UID, {
      listWorkspaceIds: async () => [ws('s1')],
      removeBucket: async () => ({ attempted: true, deleted: false, error: 'denied' }),
      deleteChannel: async () => { throw new Error('403'); },
    });
    expect(r.bucketRemoved).toBe(0);
    expect(r.channelsRemoved).toBe(0);
    expect(r.failures.join(' ')).toMatch(/bucket s-.*denied/);
    expect(r.failures.join(' ')).toMatch(/channel sn-.*403/);
  });

  it('refuses a uid it cannot range safely, exactly like the Firestore eraser', async () => {
    const r = await eraseUserSnapshots('abc-d', { listWorkspaceIds: async () => ['x'], removeBucket: async () => ({ attempted: true, deleted: true }), deleteChannel: async () => true });
    expect(r.refusal).toBe('ambiguous-uid');
    expect(r.workspaces).toBe(0);
  });

  it('the two locations are the ones the snapshot writer uses — derived, never guessed', () => {
    const [t] = snapshotTargets([ws('s1')]);
    expect(t.bucketSub).toMatch(/^s-[0-9a-f]+$/);
    expect(t.channelId).toMatch(/^sn-/);
    expect(SNAPSHOT_WORKSPACE_SOURCES).toContain('agentv3_sandboxes');
  });
});

describe('the account deletion runs it, in the only order that works', () => {
  it('🔒 the snapshot erase runs BEFORE the Firestore erase that deletes the workspace ids', () => {
    const route = readFileSync('src/server/routes/profile.ts', 'utf8');
    const block = route.slice(route.indexOf("app.delete('/api/profile'"));
    const snap = block.indexOf('eraseUserSnapshots(identity.uid, liveSnapshotEraseDeps())');
    const apps = block.indexOf('deleteUserWorkspaceData(identity.uid)');
    expect(snap).toBeGreaterThan(-1);
    expect(apps).toBeGreaterThan(snap);
    expect(block).toMatch(/\n\s+snapshots,\n/); // reported on its own line
  });

  it('the deletion page promises it', () => {
    expect(readFileSync('src/content/legal/accountDeletion.ts', 'utf8')).toContain('the saved copy of its last working build');
  });
});
