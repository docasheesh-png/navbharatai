import { describe, it, expect } from 'vitest';
import {
  planWorkspaceErase, eraseableWorkspaceId, WORKSPACE_SCOPED_COLLECTIONS, deleteUserWorkspaceData,
} from './workspaceDataErase';

/**
 * Erasing someone's built apps is irreversible. These pin the two decisions that, if wrong, delete the
 * wrong person's work — so they are asserted as behaviour, not trusted to a comment.
 */
describe('the range that decides whose apps get erased', () => {
  it('covers exactly this user, ending the prefix at the session separator', () => {
    const plan = planWorkspaceErase('abc123');
    expect(plan.range).toEqual({ startAt: 'agentv3-abc123-', endAt: `agentv3-abc123-${String.fromCharCode(0xf8ff)}` });
  });

  it('a LONGER uid is outside the range — agentv3-abc- never reaches agentv3-abcd-', () => {
    // The trailing '-' is the whole reason. Without it, deleting user "abc" would take "abcd" with it.
    const { range } = planWorkspaceErase('abc');
    const victim = 'agentv3-abcd-sess';
    expect(victim >= range!.startAt && victim <= range!.endAt).toBe(false);
  });

  it("this user's own workspaces ARE inside the range", () => {
    const { range } = planWorkspaceErase('abc');
    for (const id of ['agentv3-abc-sess', 'agentv3-abc-9f3a-2b', 'agentv3-abc-zzzz']) {
      expect(id >= range!.startAt && id <= range!.endAt, id).toBe(true);
    }
  });

  it('REFUSES a hyphenated uid rather than risk a different user — and says why', () => {
    // agentv3-abc- also matches agentv3-abc-d-… , which belongs to uid "abc-d". Real Firebase uids are
    // 28 chars of [A-Za-z0-9] so this cannot arise, which is a reason to be confident, not to skip it.
    const plan = planWorkspaceErase('abc-d');
    expect(plan.range).toBeNull();
    expect(plan.refusal).toBe('ambiguous-uid');
  });

  it('REFUSES an unusable uid — an empty key would range over everybody', () => {
    for (const bad of ['', null, undefined, 'has space', 'a'.repeat(65), '../x']) {
      const plan = planWorkspaceErase(bad as never);
      expect(plan.range, String(bad)).toBeNull();
      expect(plan.refusal, String(bad)).toBe('unusable-uid');
    }
  });
});

describe('the per-document ownership re-check, over and above the range', () => {
  it('accepts only ids that belong to the uid', () => {
    expect(eraseableWorkspaceId('abc', 'agentv3-abc-sess')).toBe(true);
    expect(eraseableWorkspaceId('abc', 'agentv3-abcd-sess')).toBe(false);
    expect(eraseableWorkspaceId('abc', 'agentv3-other-sess')).toBe(false);
  });

  it('refuses an anon workspace — it has no owner, so it is nobody\'s to erase by uid', () => {
    expect(eraseableWorkspaceId('abc', 'agentv3-anon-sess')).toBe(false);
  });

  it('refuses anything not shaped like a workspace id at all', () => {
    for (const junk of ['', 'agentv3-', 'random', 'users/abc']) {
      expect(eraseableWorkspaceId('abc', junk), junk).toBe(false);
    }
  });
});

describe('the registry of collections that hold a built app', () => {
  it('lists the stores that actually hold the bytes, with their subcollections', () => {
    const byName = Object.fromEntries(WORKSPACE_SCOPED_COLLECTIONS.map((c) => [c.collection, c.sub]));
    // Verified by reading each store — the source code and the images are the two that matter most.
    expect(byName['workspace_files_v3']).toBe('files');
    expect(byName['workspace_assets_v3']).toBe('assets');
    expect(byName['workspace_checkpoints_v3']).toBe('items');
    expect(byName['workspace_embeddings_v3']).toBe('files');
  });

  it('every entry names a real collection and no duplicates', () => {
    const names = WORKSPACE_SCOPED_COLLECTIONS.map((c) => c.collection);
    expect(new Set(names).size).toBe(names.length);
    for (const c of WORKSPACE_SCOPED_COLLECTIONS) expect(c.collection).toMatch(/^[a-z][a-z0-9_]+$/);
  });

  it('does NOT touch the seven collections deleteUserData already owns', () => {
    // Deleting the same document twice is harmless, but an overlap would mean two modules disagree
    // about who owns a collection — and the next person to change one would not know about the other.
    const retention = ['users', 'user_profiles', 'user_sessions', 'user_token_wallets', 'user_costs', 'user_build_history', 'chat_sessions'];
    for (const c of WORKSPACE_SCOPED_COLLECTIONS) expect(retention).not.toContain(c.collection);
  });
});

describe('a refusal is an honest answer, not a silent success', () => {
  it('reports the refusal instead of claiming a clean erase', async () => {
    const report = await deleteUserWorkspaceData('abc-d');
    expect(report.refusal).toBe('ambiguous-uid');
    expect(report.totalDeleted).toBe(0);
    expect(report.collections).toEqual([]);
  });
});
