// A SERVER APP HAS ONE LIFECYCLE (2026-10-06 — the hosting-foundation work, adapted from an external spec).
//
// What was broken, and what each block below locks:
//   1. Pressing Host/Publish on a BANNED (or held) app rebuilt it and wrote `active` over the ban.
//   2. A ban, an admin unpublish and both plan pauses removed the static channel and left the app's SERVER
//      answering — and the debt pause removed nothing at all.
//   3. A rename made the next deploy create a SECOND Cloud Run service; the old one stayed public, untracked.
//   4. Two presses started two Cloud Builds; a deploy that died left no trace; there was no history.
//   5. The plan's server-app cap lived only on an uncalled route, so the real Publish never enforced it.
// The tests drive the real functions against fakes — behaviour, not source text — plus three censuses that
// fail when a NEW path skips the shared function.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { globSync } from 'glob';
import {
  HOSTED_DEPLOY_STATES, HOSTED_DEPLOY_TRANSITIONS, canTransitionDeploy, nextDeployState, newDeployAttempt,
  effectiveDeployState, decideDeployClaim, deployEventLine, InvalidDeployTransition, DEPLOY_LEASE_STALE_MS,
  type DeployStore, type HostedDeployAttempt, type DeployLease,
} from '../src/server/AgentV3/hostedDeployments';
import { runServerPublish, hostFailureStatus, type ServerPublishDeps } from '../src/server/AgentV3/serverPublish';
import {
  hostedRepublishRefusal, removeHostedServers, takeAppOffline, recordHasHostedServer,
} from '../src/server/AgentV3/hostedAppLifecycle';
import {
  hostedServiceName, serviceNameFor, workspaceServiceTag, removeWorkspaceServers, deployAppToCloudRun,
} from '../src/server/AgentV3/cloudRunHosting';
import { hostAppOnNavBharatCloud, type HostAppOutcome } from '../src/server/AgentV3/hostApp';

const root = join(__dirname, '..');
const read = (f: string): string => readFileSync(join(root, f), 'utf8');
const WS = 'ws_owner1_abc';

// ── An in-memory deploy store with a REAL lease: what the Firestore transaction guarantees, in memory. ──
function memoryStore() {
  const leases = new Map<string, DeployLease>();
  const attempts = new Map<string, HostedDeployAttempt>();
  let seq = 0;
  const store: DeployStore = {
    async claim(workspaceId, userId, now) {
      const existing = leases.get(workspaceId) ?? null;
      if (decideDeployClaim(existing, now) === 'busy' && existing) {
        return { claimed: false, running: { deploymentId: existing.deploymentId, startedAt: existing.startedAt } };
      }
      const attempt = newDeployAttempt({ workspaceId, userId, now, deploymentId: `dep_${++seq}` });
      leases.set(workspaceId, { deploymentId: attempt.deploymentId, owner: 'test', startedAt: now });
      attempts.set(attempt.deploymentId, attempt);
      return { claimed: true, attempt };
    },
    async save(a) { attempts.set(a.deploymentId, a); },
    async release(workspaceId, deploymentId) {
      if (leases.get(workspaceId)?.deploymentId === deploymentId) leases.delete(workspaceId);
    },
  };
  return { store, leases, attempts };
}

function deps(over: Partial<ServerPublishDeps> = {}, hostImpl?: ServerPublishDeps['host']) {
  const mem = memoryStore();
  const calls = { host: 0, record: 0, order: [] as string[], detail: [] as string[] };
  const d: ServerPublishDeps = {
    serverCap: async () => ({ available: true, message: '' }),
    store: mem.store,
    existing: async () => null,
    vault: async () => ({}),
    token: async () => 'tok',
    host: hostImpl ?? (async (o) => {
      calls.host += 1;
      await o.onPhase('building');
      await o.onPhase('deploying');
      return { ok: true, url: 'https://app-x.run.app', service: 'app-x', ready: true, buildId: 'b1', envNote: '' };
    }),
    record: async () => { calls.record += 1; calls.order.push('record'); },
    now: () => 1_000,
    logDetail: (l) => { calls.detail.push(l); },
    ...over,
  };
  return { d, mem, calls };
}
const input = { workspaceId: WS, ownerUid: 'owner1', isAdmin: false, appName: 'Shop', files: { 'server.js': 'x' } };

describe('the deploy state machine', () => {
  it('every state has a transition row, and the terminal states have none', () => {
    for (const s of HOSTED_DEPLOY_STATES) expect(HOSTED_DEPLOY_TRANSITIONS[s]).toBeDefined();
    expect(HOSTED_DEPLOY_TRANSITIONS.live).toEqual([]);
    expect(HOSTED_DEPLOY_TRANSITIONS.failed).toEqual([]);
    expect(HOSTED_DEPLOY_TRANSITIONS.abandoned).toEqual([]);
  });

  it('walks the happy path and records every step', () => {
    let a = newDeployAttempt({ workspaceId: WS, userId: 'u', now: 1 });
    a = nextDeployState(a, 'building', 2);
    a = nextDeployState(a, 'deploying', 3);
    a = nextDeployState(a, 'live', 4, { url: 'https://x', ready: true });
    expect(a.events.map((e) => e.state)).toEqual(['queued', 'building', 'deploying', 'live']);
    expect(a.updatedAt).toBe(4);
  });

  it('🔒 refuses an illegal move by throwing — never silently rewrites the state', () => {
    const queued = newDeployAttempt({ workspaceId: WS, userId: 'u', now: 1 });
    expect(() => nextDeployState(queued, 'live', 2)).toThrow(InvalidDeployTransition);
    const live = nextDeployState(nextDeployState(nextDeployState(queued, 'building', 2), 'deploying', 3), 'live', 4);
    expect(() => nextDeployState(live, 'building', 5)).toThrow(InvalidDeployTransition);
    expect(canTransitionDeploy('failed', 'live')).toBe(false);
  });

  it('a running attempt past the stale line reads as abandoned; a finished one never changes', () => {
    const a = newDeployAttempt({ workspaceId: WS, userId: 'u', now: 0 });
    expect(effectiveDeployState(a, DEPLOY_LEASE_STALE_MS - 1)).toBe('queued');
    expect(effectiveDeployState(a, DEPLOY_LEASE_STALE_MS + 1)).toBe('abandoned');
    const failed = nextDeployState(a, 'failed', 1);
    expect(effectiveDeployState(failed, 10 * DEPLOY_LEASE_STALE_MS)).toBe('failed');
  });

  it('the lease: no lease or a stale one may be claimed; a fresh one is busy', () => {
    expect(decideDeployClaim(null, 5)).toBe('claim');
    expect(decideDeployClaim({ deploymentId: 'd', owner: 'o', startedAt: 0 }, 10)).toBe('busy');
    expect(decideDeployClaim({ deploymentId: 'd', owner: 'o', startedAt: 0 }, DEPLOY_LEASE_STALE_MS + 1)).toBe('claim');
  });

  it('🔒 the event line carries ids, a state and a category — never the message', () => {
    const a = { ...newDeployAttempt({ workspaceId: WS, userId: 'u', now: 1 }), message: 'token sk-live-SECRET', category: 'build-failed' as const };
    const line = deployEventLine(a);
    expect(line).toContain('"deploymentId"');
    expect(line).toContain('DEPLOY_QUEUED');
    expect(line).not.toContain('SECRET');
  });
});

describe('one server publish', () => {
  it('goes live, records BEFORE answering, walks every state and releases the lease', async () => {
    const { d, mem, calls } = deps();
    const out = await runServerPublish(input, d);
    expect(out).toMatchObject({ status: 200, live: true });
    expect(out.body).toMatchObject({ ok: true, url: 'https://app-x.run.app', deploymentId: 'dep_1' });
    expect(calls.record).toBe(1);
    const attempt = mem.attempts.get('dep_1')!;
    expect(attempt.events.map((e) => e.state)).toEqual(['queued', 'building', 'deploying', 'live']);
    expect(attempt.service).toBe('app-x');
    expect(mem.leases.size).toBe(0);
  });

  it('🔒 two presses at once start ONE build; the second gets the running deploy\'s id', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let builds = 0;
    const { d } = deps({}, async (o) => {
      builds += 1;
      await o.onPhase('building');
      await gate;
      await o.onPhase('deploying');
      return { ok: true, url: 'https://u', service: 's', ready: true, buildId: 'b', envNote: '' };
    });
    const first = runServerPublish(input, d);
    await new Promise((r) => setTimeout(r, 0));
    const second = await runServerPublish(input, d);
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ code: 'deploy-in-progress', deploymentId: 'dep_1' });
    release();
    expect((await first).status).toBe(200);
    expect(builds).toBe(1);
    // …and once it has finished, the next press is a new deploy.
    expect((await runServerPublish(input, d)).status).toBe(200);
  });

  it('🔒 the plan\'s server cap refuses BEFORE a lease or a build', async () => {
    const { d, mem, calls } = deps({ serverCap: async () => ({ available: false, message: 'limit of 10' }) });
    const out = await runServerPublish(input, d);
    expect(out.status).toBe(403);
    expect(out.body).toMatchObject({ code: 'server_app_limit' });
    expect(calls.host).toBe(0);
    expect(mem.attempts.size).toBe(0);
  });

  it('a failed build is recorded as failed with its category; the provider\'s words never reach the body', async () => {
    const { d, mem, calls } = deps({}, async (o) => {
      await o.onPhase('building');
      return { ok: false, reason: 'build-failed', message: 'Your app did not build.', detail: 'npm ERR! token=ghp_SECRETVALUE' } as HostAppOutcome;
    });
    const out = await runServerPublish(input, d);
    expect(out.status).toBe(502);
    expect(JSON.stringify(out.body)).not.toContain('ghp_SECRETVALUE');
    expect(calls.detail.join('\n')).toContain('ghp_SECRETVALUE'); // admin log only
    const a = mem.attempts.get('dep_1')!;
    expect(a.state).toBe('failed');
    expect(a.category).toBe('build-failed');
    expect(JSON.stringify(a)).not.toContain('ghp_SECRETVALUE');
    expect(mem.leases.size).toBe(0);
  });

  it('a host that throws still ends as failed, answers honestly and frees the app for the next try', async () => {
    const { d, mem } = deps({}, async () => { throw new Error('boom'); });
    const out = await runServerPublish(input, d);
    expect(out.status).toBe(502);
    expect(mem.attempts.get('dep_1')!.category).toBe('internal');
    expect(mem.leases.size).toBe(0);
  });

  it('no Google token: failed as unavailable, nothing built', async () => {
    const { d, calls } = deps({ token: async () => null });
    expect((await runServerPublish(input, d)).status).toBe(503);
    expect(calls.host).toBe(0);
  });

  it('every failure reason maps to ONE status', () => {
    expect(hostFailureStatus('blocked')).toBe(403);
    expect(hostFailureStatus('unavailable')).toBe(503);
    expect(hostFailureStatus('too-large')).toBe(422);
    expect(hostFailureStatus('build-failed')).toBe(502);
  });
});

describe('a banned or held app is never re-hosted', () => {
  it('the refusal', () => {
    expect(hostedRepublishRefusal({ status: 'taken_down' })).toContain('taken down');
    expect(hostedRepublishRefusal({ status: 'held' })).toContain('held for review');
    expect(hostedRepublishRefusal({ status: 'unpublished' })).toBeNull();
    expect(hostedRepublishRefusal({ status: 'plan_paused' })).toBeNull();
    expect(hostedRepublishRefusal(null)).toBeNull();
  });

  it('🔒 hostAppOnNavBharatCloud refuses a banned app BEFORE it packs, builds or calls Google', async () => {
    let fetched = 0;
    const out = await hostAppOnNavBharatCloud({
      workspaceId: WS, files: { 'server.js': 'x' }, token: 't', existing: { status: 'taken_down' },
      env: { NAVBHARAT_APPS_PROJECT: 'navbharatai-user-apps' } as NodeJS.ProcessEnv,
    }, (async () => { fetched += 1; return new Response('{}'); }) as unknown as typeof fetch);
    expect(out).toMatchObject({ ok: false, reason: 'blocked' });
    expect(fetched).toBe(0);
  });
});

describe('a redeploy updates the SAME service, even after a rename', () => {
  const recorded = serviceNameFor(WS, 'Old Name');

  it('reuses the recorded service when it carries this workspace\'s tag', () => {
    expect(hostedServiceName(WS, 'New Name', recorded)).toBe(recorded);
    expect(hostedServiceName(WS, 'New Name', null)).toBe(serviceNameFor(WS, 'New Name'));
  });

  it('🔒 never trusts a record that names somebody else\'s service, or a malformed one', () => {
    const foreign = serviceNameFor('ws_someone_else', 'Shop');
    expect(hostedServiceName(WS, 'Shop', foreign)).toBe(serviceNameFor(WS, 'Shop'));
    expect(hostedServiceName(WS, 'Shop', `x/../${workspaceServiceTag(WS)}`)).toBe(serviceNameFor(WS, 'Shop'));
  });

  it('the Cloud Run create call targets the recorded name', async () => {
    const urls: string[] = [];
    const fake = (async (url: string) => { urls.push(String(url)); return new Response('{}', { status: 500 }); }) as unknown as typeof fetch;
    await deployAppToCloudRun({ token: 't', projectId: 'p', region: 'r', workspaceId: WS, appName: 'New Name', existingService: recorded, image: 'img' }, fake);
    expect(urls[0]).toContain(`serviceId=${recorded}`);
  });
});

describe('taking an app offline takes its SERVERS offline', () => {
  const tag = workspaceServiceTag(WS);
  const mine = [`shop-${tag}`, `old-name-${tag}`];

  function cloud(opts: { deleteStatus?: number; listOk?: boolean } = {}) {
    const deleted: string[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      const u = String(url);
      if ((init?.method ?? 'GET') === 'GET') {
        if (opts.listOk === false) return new Response('', { status: 500 });
        return new Response(JSON.stringify({ services: [...mine, 'other-app-zzzzzzzz'].map((n) => ({ name: `projects/p/locations/r/services/${n}` })) }));
      }
      deleted.push(u.split('/').pop()!);
      return new Response('{}', { status: opts.deleteStatus ?? 200 });
    }) as unknown as typeof fetch;
    return { fake, deleted };
  }

  it('deletes every service carrying the tag (the rename leftover included), and nothing else', async () => {
    const c = cloud();
    const r = await removeWorkspaceServers({ token: 't', projectId: 'p', region: 'r', workspaceId: WS, recordedService: mine[0] }, c.fake);
    expect(r.ok).toBe(true);
    expect(c.deleted.sort()).toEqual([...mine].sort());
  });

  it('a refused delete or a cut-short listing is NOT ok', async () => {
    expect((await removeWorkspaceServers({ token: 't', projectId: 'p', region: 'r', workspaceId: WS }, cloud({ deleteStatus: 403 }).fake)).ok).toBe(false);
    expect((await removeWorkspaceServers({ token: 't', projectId: 'p', region: 'r', workspaceId: WS }, cloud({ listOk: false }).fake)).ok).toBe(false);
  });

  it('an app that never had a server here costs no Google call', async () => {
    let asked = 0;
    const r = await removeHostedServers(WS, { providerId: 'firebase' }, { token: async () => { asked += 1; return 't'; } });
    expect(r).toEqual({ attempted: false, ok: true });
    expect(asked).toBe(0);
    expect(recordHasHostedServer({ providerId: 'navbharat-cloud' })).toBe(true);
  });

  it('🔒 the order: channel, then servers, then the status — and a surviving server marks NOTHING', async () => {
    const order: string[] = [];
    const base = {
      deleteChannel: async () => { order.push('channel'); },
      get: async () => ({ workspaceId: WS, userId: 'u', url: 'x', fileCount: 1, updatedAt: 1, providerId: 'navbharat-cloud', service: mine[0] }),
      setStatus: async () => { order.push('status'); return true; },
      token: async () => 't',
      env: { NAVBHARAT_APPS_PROJECT: 'navbharatai-user-apps' } as NodeJS.ProcessEnv,
    };
    const ok = cloud();
    expect(await takeAppOffline(WS, 'taken_down', { ...base, remove: (o) => { order.push('servers'); return removeWorkspaceServers(o, ok.fake); } })).toBe(true);
    expect(order).toEqual(['channel', 'servers', 'status']);

    order.length = 0;
    const refused = cloud({ deleteStatus: 403 });
    await expect(takeAppOffline(WS, 'taken_down', { ...base, remove: (o) => removeWorkspaceServers(o, refused.fake) })).rejects.toThrow(/could not be confirmed removed/);
    expect(order).toEqual(['channel']); // the status was never written
  });
});

describe('censuses — a NEW path cannot skip the shared functions', () => {
  const serverFiles = globSync('src/server/**/*.ts', { cwd: root }).filter((f) => !/\.test\.ts$/.test(f)).concat('server.ts');

  it('🔒 nothing writes taken_down or plan_paused except through takeAppOffline', () => {
    const offenders = serverFiles.filter((f) => /\.setStatus\([^,()]+,\s*'(taken_down|plan_paused)'/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('🔒 the only direct "unpublished" writers are the two that already removed everything, named', () => {
    const writers = serverFiles.filter((f) => /\.setStatus\([^,()]+,\s*'unpublished'/.test(read(f))).sort();
    // agentv3.ts: the OWNER's unpublish — removeHostedServers runs first. admin.ts: the restore of a banned
    // app, which is offline already (the ban took it down through takeAppOffline).
    expect(writers).toEqual(['src/server/routes/admin.ts', 'src/server/routes/agentv3.ts']);
    expect(read('src/server/routes/agentv3.ts')).toContain('await removeHostedServers(workspaceId, rec);');
  });

  it('🔒 hosting has ONE caller, and the duplicate route is gone', () => {
    const callers = serverFiles.filter((f) => /\bhostAppOnNavBharatCloud\(/.test(read(f)) && !f.endsWith('hostApp.ts'));
    expect(callers).toEqual(['src/server/routes/agentv3.ts']);
    expect(read('src/server/routes/agentv3.ts')).not.toContain("'/api/agentv3/host-app'");
  });
});
