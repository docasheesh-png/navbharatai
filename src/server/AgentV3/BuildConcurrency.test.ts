import { describe, it, expect } from 'vitest';
import {
  perWorkspaceLockEnabled, maxConcurrentBuilds, buildLockKey, countActiveBuildsForUser,
  acquireDecision, buildKeyCandidates, workspaceSessionsMatch, MAX_CONCURRENT_BUILDS_DEFAULT,
} from './BuildConcurrency';

describe('perWorkspaceLockEnabled', () => {
  it('is OFF by default / for unset / falsey values', () => {
    expect(perWorkspaceLockEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(perWorkspaceLockEnabled({ AGENTV3_PER_WORKSPACE_LOCK: 'off' } as NodeJS.ProcessEnv)).toBe(false);
    expect(perWorkspaceLockEnabled({ AGENTV3_PER_WORKSPACE_LOCK: '0' } as NodeJS.ProcessEnv)).toBe(false);
  });
  it('is ON for on/true/1', () => {
    for (const v of ['on', 'true', '1', 'ON', ' True ']) {
      expect(perWorkspaceLockEnabled({ AGENTV3_PER_WORKSPACE_LOCK: v } as NodeJS.ProcessEnv)).toBe(true);
    }
  });
});

describe('maxConcurrentBuilds', () => {
  it('defaults to 3 and honours a valid override', () => {
    expect(maxConcurrentBuilds({} as NodeJS.ProcessEnv)).toBe(MAX_CONCURRENT_BUILDS_DEFAULT);
    expect(maxConcurrentBuilds({ AGENTV3_MAX_CONCURRENT_BUILDS: '5' } as NodeJS.ProcessEnv)).toBe(5);
  });
  it('ignores junk / non-positive and falls back to the default', () => {
    expect(maxConcurrentBuilds({ AGENTV3_MAX_CONCURRENT_BUILDS: '0' } as NodeJS.ProcessEnv)).toBe(3);
    expect(maxConcurrentBuilds({ AGENTV3_MAX_CONCURRENT_BUILDS: '-2' } as NodeJS.ProcessEnv)).toBe(3);
    expect(maxConcurrentBuilds({ AGENTV3_MAX_CONCURRENT_BUILDS: 'x' } as NodeJS.ProcessEnv)).toBe(3);
  });
});

describe('buildLockKey', () => {
  it('per-account (flag OFF) → userId, or anon when null — EXACTLY today\'s key', () => {
    expect(buildLockKey('u1', 'agentv3-u1-s1', false)).toBe('u1');
    expect(buildLockKey(null, 'agentv3-anon-s1', false)).toBe('anon');
  });
  it('per-workspace (flag ON) → the workspaceId', () => {
    expect(buildLockKey('u1', 'agentv3-u1-s1', true)).toBe('agentv3-u1-s1');
  });
  it('per-workspace with NO stable workspaceId → falls back to the account key (never keys on nothing)', () => {
    expect(buildLockKey('u1', null, true)).toBe('u1');
    expect(buildLockKey(null, undefined, true)).toBe('anon');
  });
});

describe('countActiveBuildsForUser', () => {
  const builds = [
    { userId: 'u1', ended: false },
    { userId: 'u1', ended: false },
    { userId: 'u1', ended: true },   // ended → not counted
    { userId: 'u2', ended: false },  // other account → not counted
    { userId: null, ended: false },  // anon bucket
  ];
  it('counts only this account\'s live builds', () => {
    expect(countActiveBuildsForUser(builds, 'u1')).toBe(2);
    expect(countActiveBuildsForUser(builds, 'u2')).toBe(1);
    expect(countActiveBuildsForUser(builds, null)).toBe(1); // the anon one
  });
  it('is 0 for an account with no live builds', () => {
    expect(countActiveBuildsForUser(builds, 'u3')).toBe(0);
    expect(countActiveBuildsForUser([], 'u1')).toBe(0);
  });
});

describe('buildKeyCandidates — Stop/Attach must find the build wherever identity put it', () => {
  // THE bug (admin, 2026-07-06): the build fell to the 'anon' key (verified-identity fallback) while
  // /stop looked up the claimed uid key → miss → Stop dead, Resume 404, the 409 loop forever.
  it("a signed-in caller's candidates end with the shared 'anon' bucket (the dead-Stop fix)", () => {
    expect(buildKeyCandidates('u1', null, false)).toEqual(['u1', 'anon']);
  });

  it('per-workspace: workspace key first, then account, then anon (deduped)', () => {
    expect(buildKeyCandidates('u1', 'agentv3-u1-s1', true)).toEqual(['agentv3-u1-s1', 'u1', 'anon']);
  });

  it('an anonymous caller collapses to just the anon bucket', () => {
    expect(buildKeyCandidates(null, null, false)).toEqual(['anon']);
    expect(buildKeyCandidates(null, null, true)).toEqual(['anon']);
  });

  it('flag OFF ignores the workspaceId for the primary key (today\'s account key first)', () => {
    expect(buildKeyCandidates('u1', 'agentv3-u1-s1', false)).toEqual(['u1', 'anon']);
  });
});

describe('workspaceSessionsMatch — the anon-fallback session matcher', () => {
  it('matches exact ids and the anon-fallback pair for the SAME session (the dead-Resume fix)', () => {
    expect(workspaceSessionsMatch('agentv3-u1-abc123', 'agentv3-u1-abc123')).toBe(true);
    // The build fell to anon (agentv3-anon-<sid>) while the client asks with its uid-based id.
    expect(workspaceSessionsMatch('agentv3-anon-abc123', 'agentv3-u1-abc123')).toBe(true);
    expect(workspaceSessionsMatch('agentv3-u1-abc123', 'agentv3-anon-abc123')).toBe(true);
  });

  it('never crosses sessions or owners', () => {
    expect(workspaceSessionsMatch('agentv3-anon-abc123', 'agentv3-u1-zzz999')).toBe(false);
    expect(workspaceSessionsMatch('agentv3-u1-abc123', 'agentv3-u2-abc123')).toBe(false); // two real uids — no anon side
    expect(workspaceSessionsMatch('agentv3-anon-abc123', 'other-u1-abc123')).toBe(false);
  });

  it('guards degenerate inputs (empty/short session, null)', () => {
    expect(workspaceSessionsMatch('agentv3-anon-', 'agentv3-u1-')).toBe(false);
    expect(workspaceSessionsMatch('agentv3-anon-ab', 'agentv3-u1-ab')).toBe(false); // <6 chars
    expect(workspaceSessionsMatch(null, 'agentv3-u1-abc123')).toBe(false);
    expect(workspaceSessionsMatch('agentv3-u1-abc123', undefined)).toBe(false);
  });
});

describe('acquireDecision', () => {
  it('refuses when the SAME key still has a live build (same-app mutual exclusion / today\'s 409)', () => {
    expect(acquireDecision({ perWorkspace: true, lockHeldByLiveBuild: true, accountActiveCount: 0, cap: 3 }))
      .toEqual({ ok: false, reason: 'same-workspace-busy' });
    // flag OFF: same behaviour (the account key is "busy")
    expect(acquireDecision({ perWorkspace: false, lockHeldByLiveBuild: true, accountActiveCount: 0, cap: 3 }).ok).toBe(false);
  });

  it('allows a free key under the cap (per-workspace: two different apps concurrently)', () => {
    expect(acquireDecision({ perWorkspace: true, lockHeldByLiveBuild: false, accountActiveCount: 2, cap: 3 }))
      .toEqual({ ok: true });
  });

  it('refuses at the account cap (per-workspace) with the count for an honest message', () => {
    expect(acquireDecision({ perWorkspace: true, lockHeldByLiveBuild: false, accountActiveCount: 3, cap: 3 }))
      .toEqual({ ok: false, reason: 'account-cap', active: 3, cap: 3 });
  });

  it('flag OFF NEVER consults the cap (today\'s single-build-per-account semantics unchanged)', () => {
    // Even with a huge count, flag-off only refuses on a live same-key lock.
    expect(acquireDecision({ perWorkspace: false, lockHeldByLiveBuild: false, accountActiveCount: 99, cap: 3 }))
      .toEqual({ ok: true });
  });
});
