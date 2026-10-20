import { describe, expect, it, vi } from 'vitest';
import { serverRollbackStatus, rollbackServer, type RollbackDeps } from '../src/server/AgentV3/serverRollback';
import { serviceNameFor } from '../src/server/AgentV3/cloudRunHosting';
import { newDeployAttempt } from '../src/server/AgentV3/hostedDeployments';

const ws = 'ws_owner_a';
const service = serviceNameFor(ws, 'app');
const name = `projects/apps-prod/locations/asia-south1/services/${service}`;
const runtime = 'nbai-runtime@apps-prod.iam.gserviceaccount.com';
const rec = { workspaceId: ws, userId: 'owner', service, providerId: 'navbharat-cloud', url: 'https://app.example', fileCount: 2, updatedAt: 1, status: 'active' as const };
function setup() {
  let current = `${service}-00003`;
  const revisions = [3, 2, 1].map((n) => ({ name: `${name}/revisions/${service}-0000${n}`, createTime: `2026-10-${10 + n}T00:00:00Z`, serviceAccount: n === 1 ? 'old-privileged-identity' : runtime, conditions: [{ type: 'Ready', state: 'CONDITION_SUCCEEDED' }] }));
  const save = vi.fn(); const release = vi.fn();
  const fetch = vi.fn(async (url: any, options: any) => {
    if (options?.method === 'PATCH') current = JSON.parse(options.body).traffic[0].revision;
    return new Response(JSON.stringify(String(url).includes('/revisions?') ? { revisions } : {
      name, etag: 'etag-1', reconciling: false, trafficStatuses: [{ percent: 100, revision: current }],
    }), { status: 200 });
  });
  const deps: RollbackDeps = {
    env: { NAVBHARAT_APPS_PROJECT: 'apps-prod', NAVBHARAT_APPS_RUNTIME_SA: runtime, NAVBHARAT_APPS_BUILD_SA: 'nbai-builder@apps-prod.iam.gserviceaccount.com' },
    fetch: fetch as any, token: async () => 'private-token', now: () => 1000, sleep: async () => {},
    store: { claim: async (workspaceId, userId, now, operation) => ({ claimed: true, attempt: newDeployAttempt({ workspaceId, userId, now, operation }) }), save, release },
  };
  return { deps, fetch, save, release };
}

describe('server publish history and rollback', () => {
  it('returns eligible revisions in the existing picker shape without exposing secrets or old identities', async () => {
    const { deps } = setup();
    const result = await serverRollbackStatus(ws, 'owner', rec, deps);
    expect(result.available).toBe(true);
    expect(result.choices).toHaveLength(2);
    expect(result.choices![0]).toMatchObject({ live: true });
    expect(JSON.stringify(result)).not.toContain('old-privileged');
    expect(JSON.stringify(result)).not.toContain(runtime);
  });
  it('switches only to a listed eligible revision, uses etag, confirms traffic, and releases the publish lease', async () => {
    const { deps, fetch, save, release } = setup();
    const target = `${name}/revisions/${service}-00002`;
    const result = await rollbackServer(ws, 'owner', rec, target, deps);
    expect(result).toMatchObject({ status: 200, body: { ok: true } });
    const patch = fetch.mock.calls.find(([, o]) => o?.method === 'PATCH')!;
    expect(JSON.parse(patch[1].body)).toMatchObject({ etag: 'etag-1', traffic: [{ revision: `${service}-00002`, percent: 100 }] });
    expect(save.mock.calls.at(-1)?.[0]).toMatchObject({ operation: 'rollback', state: 'live', ready: true });
    expect(release).toHaveBeenCalledTimes(1);
  });
  it('refuses foreign resources, a current version, and a revision with an old privileged identity', async () => {
    for (const target of ['projects/foreign/revisions/bad', `${name}/revisions/${service}-00003`, `${name}/revisions/${service}-00001`]) {
      const { deps, fetch } = setup();
      expect((await rollbackServer(ws, 'owner', rec, target, deps)).status).toBe(409);
      expect(fetch.mock.calls.some(([, o]) => o?.method === 'PATCH')).toBe(false);
    }
  });
  it('cannot mutate another owner or an app under review, and refuses concurrent publishing', async () => {
    const { deps, fetch } = setup();
    expect(await serverRollbackStatus(ws, 'intruder', rec, deps)).toMatchObject({ available: false, reason: 'forbidden', choices: null });
    expect((await rollbackServer(ws, 'intruder', rec, '', deps)).status).toBe(403);
    expect((await rollbackServer(ws, 'owner', { ...rec, status: 'held' }, '', deps)).status).toBe(403);
    deps.store.claim = async () => ({ claimed: false, running: { deploymentId: 'busy', startedAt: 1 } });
    expect((await rollbackServer(ws, 'owner', rec, '', deps)).status).toBe(409);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('reports an uncertain update honestly and never invents unchanged traffic', async () => {
    const { deps, release } = setup();
    const real = deps.fetch;
    deps.fetch = async (url, options) => { if (options?.method === 'PATCH') throw new Error('ack lost after commit'); return real(url, options); };
    const result = await rollbackServer(ws, 'owner', rec, '', deps);
    expect(result.status).toBe(503);
    expect(result.body.error).toContain('could not be confirmed');
    expect(result.body.error).not.toContain('unchanged');
    expect(release).not.toHaveBeenCalled(); // an uncertain cloud operation still owns the lease
  });
});
