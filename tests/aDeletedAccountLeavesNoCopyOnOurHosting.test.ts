// Legacy workspace attribution is fail closed. Retention and independently verified
// migration remain open; prefix shape must never authorize deleting another owner.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { eraseUserSnapshots, snapshotTargets, SNAPSHOT_WORKSPACE_SOURCES } from '../src/server/lib/snapshotErase';

const UID = 'abcDEF1234567890abcDEF123456';
const ws = (s: string) => `agentv3-${UID}-${s}`;

describe('the snapshot eraser', () => {
  it.each(['abc', 'abc-d', UID])('retains every legacy snapshot for %s until ownership is independently verified', async (uid) => {
    const removed: string[] = [];
    const channels: string[] = [];
    let lists = 0;
    const r = await eraseUserSnapshots(uid, {
      listWorkspaceIds: async () => { lists++; return ['agentv3-abc-d-session1', ws('s1')]; },
      removeBucket: async (sub) => { removed.push(sub); return { attempted: true, deleted: true }; },
      deleteChannel: async (id) => { channels.push(id); return true; },
    });
    expect(r).toEqual({ uid, workspaces: 0, bucketRemoved: 0, channelsRemoved: 0, failures: [], refusal: 'ownership-unverified' });
    expect(lists).toBe(0);
    expect(removed).toEqual([]);
    expect(channels).toEqual([]);
  });

  it('refuses unusable or anonymous identities without invoking storage', async () => {
    const r = await eraseUserSnapshots('anon', {
      listWorkspaceIds: async () => { throw new Error('must not enumerate'); },
      removeBucket: async () => { throw new Error('must not delete'); },
      deleteChannel: async () => { throw new Error('must not delete'); },
    });
    expect(r.refusal).toBe('unusable-uid');
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
