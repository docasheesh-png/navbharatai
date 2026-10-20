import { describe, it, expect } from 'vitest';
import {
  planWorkspaceErase, eraseableWorkspaceId, WORKSPACE_SCOPED_COLLECTIONS, deleteUserWorkspaceData,
  subcollectionsToErase,
} from './workspaceDataErase';

/**
 * Erasing someone's built apps is irreversible. These pin the two decisions that, if wrong, delete the
 * wrong person's work — so they are asserted as behaviour, not trusted to a comment.
 */
describe('legacy workspace ids never supply independently verified ownership', () => {
  it.each(['abc', 'abc-d', 'abc123', 'aB3dEfGhIjKlMnOpQrStUvWxYz01'])(
    'refuses all prefix-only attribution for %s, including normal Firebase-shaped ids', (uid) => {
      expect(planWorkspaceErase(uid)).toEqual({ range: null, refusal: 'ownership-unverified' });
    },
  );

  it('refuses a shorter deleting uid even when the foreign uid contains the separator', () => {
    // These two valid owner/session pairs produce IDENTICAL physical workspace ids.
    const foreign = 'agentv3-abc-d-session1';
    expect(foreign).toBe(`agentv3-${'abc'}-${'d-session1'}`);
    expect(foreign).toBe(`agentv3-${'abc-d'}-${'session1'}`);
    expect(planWorkspaceErase('abc').range).toBeNull();
    expect(eraseableWorkspaceId('abc', foreign)).toBe(false);
    expect(eraseableWorkspaceId('abc-d', foreign)).toBe(false);
  });

  it('refuses an unusable uid without selecting any data', () => {
    for (const bad of ['', null, undefined, 'anon', 'has space', 'a'.repeat(65), '../x']) {
      expect(planWorkspaceErase(bad as never), String(bad)).toEqual({ range: null, refusal: 'unusable-uid' });
    }
  });

  it('an apparent own prefix is insufficient to authorize irreversible per-document erasure', () => {
    for (const ws of ['agentv3-abc-sess', 'agentv3-abcd-sess', 'agentv3-other-sess', 'agentv3-anon-sess', '', 'agentv3-', 'random', 'users/abc']) {
      expect(eraseableWorkspaceId('abc', ws), ws).toBe(false);
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
    expect(byName['build_history_v2']).toBe('versions');
  });

  it('every entry names a real collection, and a repeated name is a second subcollection', () => {
    const pairs = WORKSPACE_SCOPED_COLLECTIONS.map((c) => `${c.collection}\0${c.sub ?? ''}`);
    expect(new Set(pairs).size).toBe(pairs.length);
    /**
     * Was: collection names are unique (`new Set(names).size === names.length`).
     * Now: the pair (collection, sub) is unique. `nbai_app_data` is listed twice — `records` and
     * `ops` — because the registry has one `sub` field and Firestore does not cascade. A second row
     * with the same sub, or a bare duplicate, still fails.
     */
    expect(subcollectionsToErase('nbai_app_data')).toEqual(['records', 'ops']);
    expect(subcollectionsToErase('workspace_files_v3')).toEqual(['files']);
    /**
     * A SHAPE check against a typo or an empty string — NOT a naming policy, and the pattern used to
     * read as one. It was `/^[a-z][a-z0-9_]+$/`, which quietly asserted that every collection in this
     * repo is snake_case. Several are not: `buildTraces`, `incrementalCache` and `migrationHistory`
     * are the real, live names in Firestore, alongside `adrDecisions`, `techDebt`, `abuseLedger`,
     * `userPrefs`, `promptAudits`, `teamInvites` and `deviceTokens` elsewhere. Renaming a live
     * collection is a data migration, not a tidy-up, so the test is what gives — the names stay.
     */
    for (const c of WORKSPACE_SCOPED_COLLECTIONS) expect(c.collection).toMatch(/^[a-zA-Z][a-zA-Z0-9_]*$/);
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
    expect(report.refusal).toBe('ownership-unverified');
    expect(report.totalDeleted).toBe(0);
    expect(report.collections).toEqual([]);
  });
});
