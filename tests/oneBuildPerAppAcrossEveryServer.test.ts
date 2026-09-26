/**
 * ONE BUILD PER APP, ACROSS EVERY SERVER — autopsy 2026-09-26 ("4D Future City Drive").
 *
 * Three builds of one app ran at once in one sandbox: the "one build per app" lock lived in a single
 * process's memory, and after a dropped connection the retry reached a Cloud Run instance where that
 * memory was empty. These tests lock the durable lease that every instance shares, the client's
 * "follow it, do not rebuild it" handling.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  leaseIsLive,
  buildLeaseDecision,
  buildLeaseEnabled,
  claimBuildLease,
  heartbeatBuildLease,
  releaseBuildLease,
  readLiveBuildLease,
  requestRemoteStop,
  holdBuildLease,
  BUILD_LEASE_TTL_MS,
  BUILD_LEASE_COLLECTION,
  type BuildLeaseStore,
} from '../src/server/AgentV3/workspaceBuildLease';
import { reconnectOutcome, isHeldElsewhere, FOLLOWING_ELSEWHERE_NOTICE } from '../src/hooks/agentV3StreamError';

/** A Firestore stand-in: one map, transactions applied atomically, optional failure injection. */
function fakeStore(opts: { fail?: boolean } = {}) {
  const docs = new Map<string, Record<string, unknown>>();
  const store: BuildLeaseStore = {
    collection: (name: string) => ({ doc: (id: string) => `${name}/${id}` }),
    async runTransaction(fn) {
      if (opts.fail) throw new Error('firestore unavailable');
      const writes: Array<() => void> = [];
      const result = await fn({
        async get(ref) {
          const d = docs.get(ref as string);
          return { exists: !!d, data: () => (d ? { ...d } : undefined) };
        },
        set(ref, value) { writes.push(() => docs.set(ref as string, { ...value })); },
        update(ref, value) { writes.push(() => docs.set(ref as string, { ...(docs.get(ref as string) ?? {}), ...value })); },
        delete(ref) { writes.push(() => docs.delete(ref as string)); },
      });
      for (const w of writes) w();
      return result;
    },
  };
  return { store, docs, key: (ws: string) => `${BUILD_LEASE_COLLECTION}/${ws}` };
}

const WS = 'agentv3-user1-8383b6bd-6073-4191-afab-1deb0ce1d5c3';

describe('🔒 the decision (pure)', () => {
  const live = { leaseId: 'L1', owner: 'server-A', heartbeatAt: 1_000_000 };

  it('no lease, a lease with no owner, and a corrupt heartbeat are all claimable', () => {
    expect(buildLeaseDecision(null, { owner: 'server-B', nowMs: 1_000_000 })).toBe('claim');
    expect(buildLeaseDecision({ leaseId: 'L1', heartbeatAt: 1_000_000 }, { owner: 'server-B', nowMs: 1_000_000 })).toBe('claim');
    expect(buildLeaseDecision({ ...live, heartbeatAt: Number.NaN }, { owner: 'server-B', nowMs: 1_000_000 })).toBe('claim');
  });

  it('THE BUG: a live lease held by ANOTHER server refuses the second build', () => {
    expect(buildLeaseDecision(live, { owner: 'server-B', nowMs: 1_000_000 + 30_000 })).toBe('held-elsewhere');
  });

  it('the same server may claim — its in-memory lock has already decided', () => {
    expect(buildLeaseDecision(live, { owner: 'server-A', nowMs: 1_000_000 + 30_000 })).toBe('claim');
  });

  it('a dead holder cannot trap the app: past the TTL the lease is claimable', () => {
    expect(leaseIsLive(live, 1_000_000 + BUILD_LEASE_TTL_MS)).toBe(true);
    expect(leaseIsLive(live, 1_000_000 + BUILD_LEASE_TTL_MS + 1)).toBe(false);
    expect(buildLeaseDecision(live, { owner: 'server-B', nowMs: 1_000_000 + BUILD_LEASE_TTL_MS + 1 })).toBe('claim');
  });

  it('on by default; only the word "off" reverts it', () => {
    expect(buildLeaseEnabled({})).toBe(true);
    expect(buildLeaseEnabled({ AGENTV3_WORKSPACE_BUILD_LEASE: ' OFF ' })).toBe(false);
    expect(buildLeaseEnabled({ AGENTV3_WORKSPACE_BUILD_LEASE: 'of' })).toBe(true);
  });
});

describe('🔒 the durable lease (transactions)', () => {
  it('the retry on a second server is refused while the first build is alive', async () => {
    const { store } = fakeStore();
    const a = await claimBuildLease(store, { workspaceId: WS, leaseId: 'build-A', owner: 'server-A', userId: 'u', nowMs: 1_000 });
    expect(a).toEqual({ ok: true });
    const b = await claimBuildLease(store, { workspaceId: WS, leaseId: 'build-B', owner: 'server-B', userId: 'u', nowMs: 60_000 });
    expect(b.ok).toBe(false);
  });

  it('a different app is never blocked — one document per workspace', async () => {
    const { store } = fakeStore();
    await claimBuildLease(store, { workspaceId: WS, leaseId: 'build-A', owner: 'server-A', userId: 'u', nowMs: 1_000 });
    const other = await claimBuildLease(store, { workspaceId: `${WS}-other`, leaseId: 'build-X', owner: 'server-B', userId: 'u', nowMs: 2_000 });
    expect(other.ok).toBe(true);
  });

  it('heartbeat keeps it alive, reports a remote Stop, and reports "lost" once another turn owns it', async () => {
    const { store, docs, key } = fakeStore();
    await claimBuildLease(store, { workspaceId: WS, leaseId: 'build-A', owner: 'server-A', userId: 'u', nowMs: 1_000 });
    expect(await heartbeatBuildLease(store, { workspaceId: WS, leaseId: 'build-A', nowMs: 50_000 })).toBe('held');
    expect(docs.get(key(WS))?.heartbeatAt).toBe(50_000);
    // Stop pressed on server B, which does not hold the build.
    expect(await requestRemoteStop(store, { workspaceId: WS, owner: 'server-B', nowMs: 51_000 })).toBe(true);
    expect(await heartbeatBuildLease(store, { workspaceId: WS, leaseId: 'build-A', nowMs: 60_000 })).toBe('stop-requested');
    expect(await heartbeatBuildLease(store, { workspaceId: WS, leaseId: 'someone-else', nowMs: 60_000 })).toBe('lost');
  });

  it('a Stop on the holder itself flags nothing — the local registry stops it', async () => {
    const { store } = fakeStore();
    await claimBuildLease(store, { workspaceId: WS, leaseId: 'build-A', owner: 'server-A', userId: 'u', nowMs: 1_000 });
    expect(await requestRemoteStop(store, { workspaceId: WS, owner: 'server-A', nowMs: 2_000 })).toBe(false);
  });

  it('release frees only its OWN lease — a late release never frees a newer build', async () => {
    const { store, docs, key } = fakeStore();
    await claimBuildLease(store, { workspaceId: WS, leaseId: 'build-A', owner: 'server-A', userId: 'u', nowMs: 1_000 });
    await releaseBuildLease(store, { workspaceId: WS, leaseId: 'stale-turn' });
    expect(docs.has(key(WS))).toBe(true);
    await releaseBuildLease(store, { workspaceId: WS, leaseId: 'build-A' });
    expect(docs.has(key(WS))).toBe(false);
    expect((await claimBuildLease(store, { workspaceId: WS, leaseId: 'build-B', owner: 'server-B', userId: 'u', nowMs: 3_000 })).ok).toBe(true);
  });

  it('readLiveBuildLease answers only for a live lease', async () => {
    const { store } = fakeStore();
    expect(await readLiveBuildLease(store, WS, 1_000)).toBeNull();
    await claimBuildLease(store, { workspaceId: WS, leaseId: 'build-A', owner: 'server-A', userId: 'u', nowMs: 1_000 });
    expect((await readLiveBuildLease(store, WS, 2_000))?.owner).toBe('server-A');
    expect(await readLiveBuildLease(store, WS, 1_000 + BUILD_LEASE_TTL_MS + 1)).toBeNull();
  });

  it('FAILS OPEN: an unreachable store never refuses a build (the in-memory lock still applies)', async () => {
    const { store } = fakeStore({ fail: true });
    expect(await claimBuildLease(store, { workspaceId: WS, leaseId: 'b', owner: 'o', userId: 'u' })).toEqual({ ok: true, degraded: true });
    expect(await claimBuildLease(null, { workspaceId: WS, leaseId: 'b', owner: 'o', userId: 'u' })).toEqual({ ok: true, degraded: true });
    expect(await readLiveBuildLease(store, WS)).toBeNull();
    expect(await requestRemoteStop(store, { workspaceId: WS, owner: 'o' })).toBe(false);
    expect(await heartbeatBuildLease(store, { workspaceId: WS, leaseId: 'b' })).toBe('unknown');
  });
});

describe('🔒 the holder mirrors the in-memory lock', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('releases the lease within a second of the in-memory lock going away — on ANY exit path', async () => {
    vi.useFakeTimers();
    const { store, docs, key } = fakeStore();
    await claimBuildLease(store, { workspaceId: WS, leaseId: 'build-A', owner: 'server-A', userId: 'u', nowMs: Date.now() });
    let held = true;
    holdBuildLease(store, { workspaceId: WS, leaseId: 'build-A', stillHeld: () => held });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(docs.has(key(WS))).toBe(true);
    held = false;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(docs.has(key(WS))).toBe(false);
  });

  it('a Stop pressed on another server reaches the holder once', async () => {
    vi.useFakeTimers();
    const { store } = fakeStore();
    await claimBuildLease(store, { workspaceId: WS, leaseId: 'build-A', owner: 'server-A', userId: 'u', nowMs: Date.now() });
    const onStop = vi.fn();
    const stop = holdBuildLease(store, { workspaceId: WS, leaseId: 'build-A', stillHeld: () => true, onStopRequested: onStop, heartbeatMs: 1_000, watchMs: 500 });
    await requestRemoteStop(store, { workspaceId: WS, owner: 'server-B', nowMs: Date.now() });
    await vi.advanceTimersByTimeAsync(3_500);
    expect(onStop).toHaveBeenCalledTimes(1);
    stop();
  });

  it('a lease another turn now owns is left alone — never released by the old holder', async () => {
    vi.useFakeTimers();
    const { store, docs, key } = fakeStore();
    await claimBuildLease(store, { workspaceId: WS, leaseId: 'build-A', owner: 'server-A', userId: 'u', nowMs: Date.now() });
    holdBuildLease(store, { workspaceId: WS, leaseId: 'build-A', stillHeld: () => true, heartbeatMs: 1_000, watchMs: 500 });
    await claimBuildLease(store, { workspaceId: WS, leaseId: 'build-B', owner: 'server-A', userId: 'u', nowMs: Date.now() });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(docs.get(key(WS))?.leaseId).toBe('build-B');
  });
});

describe('🔒 the client follows the running build instead of starting another', () => {
  it('a 409 "elsewhere" is a live build, not an error and not a finished one', () => {
    expect(reconnectOutcome({ ok: false, status: 409, resultAlreadySeen: false, elsewhere: true })).toBe('elsewhere');
    expect(reconnectOutcome({ ok: false, status: 409, resultAlreadySeen: false })).toBe('error');
    expect(reconnectOutcome({ ok: false, status: 404, resultAlreadySeen: false, elsewhere: true })).toBe('gone-notice');
    expect(isHeldElsewhere(409, { elsewhere: true })).toBe(true);
    expect(isHeldElsewhere(409, { resumable: true })).toBe(false);
    expect(isHeldElsewhere(404, { elsewhere: true })).toBe(false);
  });

  it('the notice names no server, vendor or model', () => {
    expect(FOLLOWING_ELSEWHERE_NOTICE).not.toMatch(/instance|cloud run|glm|kimi|claude|gemini|grok|openai|nemotron/i);
  });
});

describe('🔒 reversion guards — the wiring tsc and vitest cannot see', () => {
  const route = readFileSync(resolve(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
  const hook = readFileSync(resolve(__dirname, '../src/hooks/useAgentV3Build.ts'), 'utf8');

  it('a turn claims the durable lease right after taking the in-memory lock, and refuses with `elsewhere`', () => {
    const add = route.indexOf('activeBuilds.add(buildKey);');
    const claim = route.indexOf('claimBuildLease(leaseStore');
    expect(add).toBeGreaterThan(0);
    expect(claim).toBeGreaterThan(add);
    expect(claim - add).toBeLessThan(1500);
    expect(route.slice(claim, claim + 600)).toMatch(/elsewhere: true/);
    expect(route).toMatch(/stillHeld: \(\) => activeBuilds\.has\(buildKey\) && buildLeaseHolders\.get\(buildKey\) === leaseId/);
  });

  it('/status, /attach and /stop all consult the shared lease', () => {
    expect(route).toMatch(/buildRunningElsewhere,\n/);
    expect(route).toMatch(/res\.status\(409\)\.json\(\{ error: BUILD_HELD_ELSEWHERE_MESSAGE, elsewhere: true \}\)/);
    expect(route).toMatch(/remote = await requestRemoteStop\(/);
  });

  it('THE PATH THAT BUILT THE APP TWICE: the drop probe sends its token and follows a build that moved', () => {
    const probe = hook.indexOf('const probe = await fetch(`/api/agentv3/status');
    expect(probe).toBeGreaterThan(0);
    expect(hook.slice(probe, probe + 200)).toMatch(/headers: await authJsonHeaders\(\)/);
    expect(hook.slice(probe, probe + 1400)).toMatch(/buildRunningElsewhere === true/);
  });

  it('the stall watchdog follows a build that moved instead of auto-continuing a second one', () => {
    const wd = hook.indexOf('const alive = workspaceIdRef.current ? j?.buildRunningHere === true : j?.buildRunning === true;\n          // Alive on ANOTHER server');
    expect(wd).toBeGreaterThan(0);
    expect(hook.slice(wd, wd + 700).indexOf('buildRunningElsewhere')).toBeLessThan(hook.slice(wd, wd + 1400).indexOf('stallWatchdogAction('));
  });

  it('a screen following a build elsewhere offers Stop, and loses it when the build ends', () => {
    const panel = readFileSync(resolve(__dirname, '../src/components/agentv3/AgentV3Panel.tsx'), 'utf8');
    // Every place that starts following also raises the flag — a notice without it has no Stop.
    const notices = hook.split('text: FOLLOWING_ELSEWHERE_NOTICE').length - 1;
    const raised = hook.split('setFollowingElsewhere(true)').length - 1;
    expect(notices).toBe(4);
    expect(raised).toBe(notices);
    // The status poll is the truth, and a delivered result ends it.
    expect(hook).toMatch(/setFollowingElsewhere\(j\.buildRunningElsewhere && !sawResultRef\.current\)/);
    expect(hook).toMatch(/type === 'result'\)\) setFollowingElsewhere\(false\)/);
    // Stop clears it, and the panel renders a real Stop button wired to stop() on that flag.
    const stopAt = hook.indexOf('const stop = useCallback(');
    expect(hook.slice(stopAt, stopAt + 400)).toContain('setFollowingElsewhere(false)');
    const branch = panel.indexOf(') : followingElsewhere ? (');
    expect(branch).toBeGreaterThan(0);
    expect(panel.slice(branch, branch + 700)).toMatch(/onClick=\{stop\}[\s\S]*Stop/);
  });
});
