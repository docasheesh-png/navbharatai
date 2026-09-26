/**
 * ONE BUILD PER WORKSPACE — ACROSS EVERY SERVER INSTANCE (autopsy eed79815, 2026-09-26).
 *
 * The build lock lived in one process's memory. A retry after a dropped connection reached another
 * Cloud Run instance and started a second build in the same workspace, then a third: fourteen minutes
 * of two builds overwriting each other's files and running npm into one node_modules at once. The
 * first build was never aborted — it ran fifty more calls to a green finish — which is what proves the
 * second request never saw it: the in-process reclaim would have aborted it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  leaseClaimDecision, leaseIsLive, leaseRenewalDecision, claimWorkspaceBuild, renewWorkspaceBuild,
  releaseWorkspaceBuild, requestWorkspaceBuildStop, LEASE_STALE_MS, WORKSPACE_BUILD_LEASE_COLLECTION,
  BUILD_RUNNING_ELSEWHERE_MESSAGE, type BuildLeaseStore,
} from '../src/server/AgentV3/workspaceBuildLease';
import { workspaceLeaseEnabled } from '../src/server/routes/agentv3';

const NOW = 1_790_414_872_000;
const WS = 'agentv3-uid1-8383b6bd-6073-4191-afab-1deb0ce1d5c3';

/** An in-memory store with Firestore's transaction shape — enough to exercise the real I/O layer. */
function fakeStore(opts: { fail?: boolean; hang?: boolean } = {}) {
  const docs = new Map<string, Record<string, unknown>>();
  const store: BuildLeaseStore = {
    collection: (name: string) => ({ doc: (id: string) => `${name}/${id}` }),
    runTransaction: async (fn) => {
      if (opts.fail) throw new Error('UNAVAILABLE');
      if (opts.hang) return new Promise(() => {});
      return fn({
        get: async (ref) => ({ exists: docs.has(ref as string), data: () => docs.get(ref as string) }),
        set: (ref, v) => { docs.set(ref as string, v); },
        delete: (ref) => { docs.delete(ref as string); },
      });
    },
  };
  return { store, docs, key: `${WORKSPACE_BUILD_LEASE_COLLECTION}/${WS}` };
}

describe('the claim decision', () => {
  const live = { token: 't1', owner: 'instance-A', heartbeatAt: NOW - 10_000 };

  it('a live lease held by ANOTHER instance is busy — the report\'s exact case', () => {
    expect(leaseClaimDecision(live, { owner: 'instance-B', nowMs: NOW })).toBe('busy');
  });

  it('no lease, a stale one, or an unreadable one can be claimed — a crash never locks the app', () => {
    expect(leaseClaimDecision(null, { owner: 'B', nowMs: NOW })).toBe('claim');
    expect(leaseClaimDecision({ ...live, heartbeatAt: NOW - LEASE_STALE_MS - 1 }, { owner: 'B', nowMs: NOW })).toBe('claim');
    expect(leaseClaimDecision({ ...live, heartbeatAt: 'garbage' as unknown as number }, { owner: 'B', nowMs: NOW })).toBe('claim');
    expect(leaseClaimDecision({ owner: 'A', heartbeatAt: NOW }, { owner: 'B', nowMs: NOW })).toBe('claim');
  });

  it('this instance\'s own leftover never blocks it — its in-memory lock already decided', () => {
    expect(leaseClaimDecision(live, { owner: 'instance-A', nowMs: NOW })).toBe('claim');
  });

  it('liveness is the heartbeat, inclusive of the window edge', () => {
    expect(leaseIsLive({ ...live, heartbeatAt: NOW - LEASE_STALE_MS }, NOW)).toBe(true);
    expect(leaseIsLive({ ...live, heartbeatAt: NOW - LEASE_STALE_MS - 1 }, NOW)).toBe(false);
  });

  it('a renewal sees its own lease, a Stop from elsewhere, or that it lost the workspace', () => {
    expect(leaseRenewalDecision(live, 't1')).toBe('held');
    expect(leaseRenewalDecision({ ...live, stopRequested: true }, 't1')).toBe('stop-requested');
    expect(leaseRenewalDecision({ ...live, token: 't2' }, 't1')).toBe('lost');
    expect(leaseRenewalDecision(null, 't1')).toBe('lost');
  });
});

describe('the lease through a transactional store', () => {
  it('the second instance is refused while the first builds, and admitted once it releases', async () => {
    const { store } = fakeStore();
    const first = await claimWorkspaceBuild(store, { workspaceId: WS, token: 't1', owner: 'A', nowMs: NOW });
    expect(first).toEqual({ ok: true, verified: true });
    const second = await claimWorkspaceBuild(store, { workspaceId: WS, token: 't2', owner: 'B', nowMs: NOW + 1_000 });
    expect(second.ok).toBe(false);
    await releaseWorkspaceBuild(store, { workspaceId: WS, token: 't1' });
    expect((await claimWorkspaceBuild(store, { workspaceId: WS, token: 't2', owner: 'B', nowMs: NOW + 2_000 })).ok).toBe(true);
  });

  it('a heartbeat keeps a long build\'s claim alive past the stale window', async () => {
    const { store } = fakeStore();
    await claimWorkspaceBuild(store, { workspaceId: WS, token: 't1', owner: 'A', nowMs: NOW });
    expect(await renewWorkspaceBuild(store, { workspaceId: WS, token: 't1', nowMs: NOW + 80_000 })).toBe('held');
    expect((await claimWorkspaceBuild(store, { workspaceId: WS, token: 't2', owner: 'B', nowMs: NOW + 160_000 })).ok).toBe(false);
  });

  it('a Stop pressed on another instance reaches the holder on its next beat', async () => {
    const { store } = fakeStore();
    await claimWorkspaceBuild(store, { workspaceId: WS, token: 't1', owner: 'A', nowMs: NOW });
    expect(await requestWorkspaceBuildStop(store, { workspaceId: WS, nowMs: NOW + 5_000 })).toBe(true);
    expect(await renewWorkspaceBuild(store, { workspaceId: WS, token: 't1', nowMs: NOW + 20_000 })).toBe('stop-requested');
  });

  it('a Stop for a workspace with no live build flags nothing', async () => {
    const { store } = fakeStore();
    expect(await requestWorkspaceBuildStop(store, { workspaceId: WS, nowMs: NOW })).toBe(false);
  });

  it('a release never deletes a lease that is no longer ours', async () => {
    const { store, docs, key } = fakeStore();
    await claimWorkspaceBuild(store, { workspaceId: WS, token: 't2', owner: 'B', nowMs: NOW });
    await releaseWorkspaceBuild(store, { workspaceId: WS, token: 't1' });
    expect(docs.get(key)?.token).toBe('t2');
  });

  it('FAILS OPEN — an unreachable or hanging store lets the build start, marked unverified', async () => {
    expect(await claimWorkspaceBuild(fakeStore({ fail: true }).store, { workspaceId: WS, token: 't', owner: 'A' })).toEqual({ ok: true, verified: false });
    expect(await claimWorkspaceBuild(fakeStore({ hang: true }).store, { workspaceId: WS, token: 't', owner: 'A' })).toEqual({ ok: true, verified: false });
    expect(await claimWorkspaceBuild(null, { workspaceId: WS, token: 't', owner: 'A' })).toEqual({ ok: true, verified: false });
    expect(await renewWorkspaceBuild(fakeStore({ fail: true }).store, { workspaceId: WS, token: 't' })).toBe('unknown');
  }, 15_000);
});

describe('the switch and the words', () => {
  it('is on unless the word is off', () => {
    expect(workspaceLeaseEnabled({})).toBe(true);
    expect(workspaceLeaseEnabled({ AGENTV3_WORKSPACE_LEASE: 'garbage' })).toBe(true);
    expect(workspaceLeaseEnabled({ AGENTV3_WORKSPACE_LEASE: ' OFF ' })).toBe(false);
  });

  it('the refusal says the build is safe and how to get through — and names no vendor', () => {
    expect(BUILD_RUNNING_ELSEWHERE_MESSAGE).toMatch(/still running/);
    expect(BUILD_RUNNING_ELSEWHERE_MESSAGE).toMatch(/Stop/);
    expect(BUILD_RUNNING_ELSEWHERE_MESSAGE).not.toMatch(/firestore|cloud run|instance|kimi|glm|claude/i);
  });
});

describe('🔒 the wiring', () => {
  // tsc and vitest cannot see that a claim is made after the stream opened, or that an exit forgot to
  // release — that is how an in-memory lock came to be trusted across instances.
  const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
  const hook = readFileSync(join(__dirname, '..', 'src/hooks/useAgentV3Build.ts'), 'utf8');

  it('the claim happens BEFORE the stream opens, so a refusal is a clean 409', () => {
    const claimAt = route.indexOf('await claimWorkspaceBuild(buildLeaseStore,');
    const flushAt = route.indexOf("// NDJSON stream (mirrors the Engineer route's streaming contract).");
    expect(claimAt).toBeGreaterThan(0);
    expect(flushAt).toBeGreaterThan(claimAt);
    expect(route).toMatch(/res\.status\(409\)\.json\(\{ error: BUILD_RUNNING_ELSEWHERE_MESSAGE, code: BUILD_RUNNING_ELSEWHERE_CODE, resumable: false \}\)/);
  });

  it('the build\'s own finally and the deadline finalizer release the lease', () => {
    expect(route).toMatch(/activeBuilds\.delete\(buildKey\);\n {6}\/\/ The workspace is free on every instance the moment this build ends \(autopsy eed79815\)\.\n {6}releaseBuildLease\(\);/);
    expect(route).toMatch(/activeBuilds\.delete\(buildKey\);\n {6}releaseBuildLease\(\);\n {6}if \(runningBuilds\.get\(buildKey\) === rb\) runningBuilds\.delete\(buildKey\);\n {6}endBuild\(rb\);\n {4}\};/);
    expect(route).toContain('buildLeaseRb = rb;');
  });

  it('Stop reaches a build on another instance, only for a workspace the verified caller owns', () => {
    expect(route).toMatch(/workspaceOwnershipOk\(verifiedStopUid, null, stopWorkspaceId\)\) \{\n\s+wasRunning = await requestWorkspaceBuildStop\(/);
  });

  it('the client offers Stop on that refusal instead of a dead end', () => {
    expect(hook).toMatch(/res\.status === 409 && body\.code === 'BUILD_RUNNING_ELSEWHERE'\) \{\n\s+\/\/[^\n]*\n[^\n]*\n[^\n]*\n\s+setServerBuildRunning\(true\);/);
  });

  it('the in-process reclaim is liveness-based, not age-based', () => {
    expect(route).toContain('shouldReclaimBuildLock(existing, Date.now(), STALE_BUILD_SILENCE_MS, hardMaxMs)');
  });
});
