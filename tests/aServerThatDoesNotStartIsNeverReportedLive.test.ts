// A SERVER THAT DOES NOT START IS NEVER REPORTED LIVE (2026-10-07).
//
// Two defects in the one function that turns a built image into a public URL (deployAppToCloudRun):
//
//  1. READINESS WAS READ FROM THE WRONG FIELD. The engine calls Cloud Run Admin API **v2**, where a Service's
//     readiness is `terminalCondition` and `conditions` holds only the sub-resources (RoutesReady,
//     ConfigurationsReady) — Google's discovery document says so in as many words. `parseService` looked for
//     `type: 'Ready'` inside `conditions`, so against the real API `ready` could never be true.
//  2. NOBODY WAITED FOR THE SERVICE TO SETTLE. The service was read once, right after the create was
//     accepted, made public, and reported as deployed whatever it said. A container that crashes on start
//     (the commonest server bug: not listening on $PORT) was therefore recorded LIVE, told to the user as
//     "may take another moment", and — on a first deploy — left as a public, unrecorded service.
//
// The fixtures below use the v2 Service shape exactly as the discovery document defines it.

import { describe, it, expect } from 'vitest';
import { parseService, deployAppToCloudRun, SERVICE_READY_WAIT_MS } from '../src/server/AgentV3/cloudRunHosting';
import { BUILD_TIMEOUT_SECONDS } from '../src/server/AgentV3/containerBuild';
import { DEPLOY_LEASE_STALE_MS } from '../src/server/AgentV3/hostedDeployments';
import { hostAppOnNavBharatCloud } from '../src/server/AgentV3/hostApp';

const URI = 'https://shop-abc-el.a.run.app';
const v2 = (o: { reconciling?: boolean; state?: string; message?: string; generation?: string; observedGeneration?: string; uri?: string }) => ({
  name: 'projects/p/locations/asia-south1/services/shop-abc',
  uri: o.uri ?? URI,
  generation: o.generation ?? '1',
  observedGeneration: o.observedGeneration ?? '1',
  reconciling: o.reconciling ?? false,
  terminalCondition: { type: 'Ready', state: o.state ?? 'CONDITION_SUCCEEDED', ...(o.message ? { message: o.message } : {}) },
  conditions: [
    { type: 'RoutesReady', state: 'CONDITION_SUCCEEDED' },
    { type: 'ConfigurationsReady', state: o.state ?? 'CONDITION_SUCCEEDED' },
  ],
});
const res = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response;
const CRASH = 'The user-provided container failed to start and listen on the port defined provided by the PORT=8080 environment variable.';

/** A fake Cloud Run whose GETs walk through `states`, then stay on the last one. */
function cloud(states: unknown[], opts: { exists?: boolean } = {}) {
  const calls: string[] = [];
  let gets = 0;
  const impl = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${u}`);
    if (u.includes('?serviceId=')) return opts.exists ? res({ error: 'exists' }, 409) : res({ name: 'op' });
    if (method === 'PATCH') return res({ name: 'op' });
    if (u.includes(':setIamPolicy')) return res({});
    if (method === 'DELETE') return res({});
    const s = states[Math.min(gets, states.length - 1)];
    gets += 1;
    return res(s);
  }) as unknown as typeof fetch;
  return { impl, calls, gets: () => gets };
}
const base = { token: 't', projectId: 'p', region: 'asia-south1', workspaceId: 'ws1', appName: 'shop', serviceAccount: 'rt@p.iam.gserviceaccount.com', image: 'img@sha256:abc' };
const noSleep = async () => {};

describe('parseService reads the v2 Service as Google defines it', () => {
  it('🔒 a settled, succeeded service is READY — read from terminalCondition, not from the sub-conditions', () => {
    expect(parseService(v2({}))).toMatchObject({ ready: true, settled: true, failed: false, uri: URI });
  });

  it('a reconciling service is neither ready nor failed — it is not settled', () => {
    expect(parseService(v2({ reconciling: true, state: 'CONDITION_RECONCILING', observedGeneration: '0' })))
      .toMatchObject({ ready: false, settled: false, failed: false });
  });

  it('🔒 a settled FAILED service is failed, with Google\'s own reason kept for the admin', () => {
    expect(parseService(v2({ state: 'CONDITION_FAILED', message: CRASH, observedGeneration: '0' })))
      .toMatchObject({ ready: false, settled: true, failed: true, failureDetail: CRASH });
  });

  it('🔒 an update whose generation never became the serving one is failed, even if the old revision still serves', () => {
    expect(parseService(v2({ generation: '3', observedGeneration: '2', state: 'CONDITION_SUCCEEDED' })))
      .toMatchObject({ ready: false, failed: true });
  });
});

describe('deployAppToCloudRun waits for the service to settle', () => {
  it('🔒 a container that never starts is NOT deployed, is never made public, and a NEW service is removed', async () => {
    const c = cloud([v2({ reconciling: true, state: 'CONDITION_RECONCILING', observedGeneration: '0' }), v2({ state: 'CONDITION_FAILED', message: CRASH, observedGeneration: '0' })]);
    const r = await deployAppToCloudRun(base, c.impl, noSleep);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe('start-failed');
    expect(!r.ok && r.detail).toBe(CRASH);
    expect(c.calls.some((x) => x.includes(':setIamPolicy'))).toBe(false);
    expect(c.calls.some((x) => /^DELETE .*\/services\/shop-[a-z0-9]+$/.test(x))).toBe(true);
  });

  it('🔒 a failed UPDATE leaves the live service alone — the version already serving keeps serving', async () => {
    const c = cloud([v2({ generation: '2', observedGeneration: '1', reconciling: true }), v2({ generation: '2', observedGeneration: '1', state: 'CONDITION_FAILED', message: CRASH })], { exists: true });
    const r = await deployAppToCloudRun(base, c.impl, noSleep);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toMatch(/already live keeps serving/i);
    expect(c.calls.some((x) => x.startsWith('DELETE '))).toBe(false);
  });

  it('a service that settles READY is opened to the public only AFTER it serves, and reported ready', async () => {
    const c = cloud([v2({ reconciling: true, state: 'CONDITION_RECONCILING', observedGeneration: '0' }), v2({})]);
    const r = await deployAppToCloudRun(base, c.impl, noSleep);
    expect(r).toMatchObject({ ok: true, url: URI, ready: true });
    const lastGet = c.calls.map((x, i) => (x.startsWith('GET ') ? i : -1)).filter((i) => i >= 0)[1];
    expect(c.calls.findIndex((x) => x.includes(':setIamPolicy'))).toBeGreaterThan(lastGet);
  });

  it('the wait is BOUNDED: a service still reconciling at the deadline is reported honestly as not yet ready', async () => {
    const c = cloud([v2({ reconciling: true, state: 'CONDITION_RECONCILING', observedGeneration: '0' })]);
    const r = await deployAppToCloudRun({ ...base, readyWaitMs: 20_000, readyPollMs: 5_000 }, c.impl, noSleep);
    expect(r).toMatchObject({ ok: true, ready: false });
    expect(c.gets()).toBe(4);
  });
});

describe('end to end through the host path', () => {
  const ENV = {
    NAVBHARAT_CLOUD: 'on', NAVBHARAT_APPS_PROJECT: 'navbharatai-user-apps',
    NAVBHARAT_APPS_RUNTIME_SA: 'nbai-app-runtime@navbharatai-user-apps.iam.gserviceaccount.com',
    NAVBHARAT_APPS_BUILD_SA: 'nbai-app-builder@navbharatai-user-apps.iam.gserviceaccount.com',
  } as unknown as NodeJS.ProcessEnv;
  const DIGEST = `sha256:${'d'.repeat(64)}`;

  it('🔒 a server that crashes on start fails the publish, and the user is told why without a vendor name', async () => {
    const run = cloud([v2({ state: 'CONDITION_FAILED', message: CRASH, observedGeneration: '0' })]);
    const impl = (async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('uploadType=media')) return res({});
      if (u.includes('storage/v1/b/') && init?.method === 'DELETE') return res({});
      if (u.includes('artifactregistry.googleapis.com')) return res({ version: `x/versions/${DIGEST}` });
      if (u.includes('cloudbuild.googleapis.com') && init?.method === 'POST') return res({ metadata: { build: { id: 'b1', status: 'SUCCESS' } } });
      if (u.includes('cloudbuild.googleapis.com')) return res({ id: 'b1', status: 'SUCCESS' });
      return run.impl(url, init);
    }) as unknown as typeof fetch;
    const r = await hostAppOnNavBharatCloud({
      workspaceId: 'ws1', appName: 'shop', files: { 'package.json': '{"scripts":{"start":"node server.js"}}', 'server.js': 'x' },
      token: 't', existing: null, env: ENV, pollMs: 1, maxWaitMs: 500,
    }, impl, noSleep);
    expect(r).toMatchObject({ ok: false, reason: 'deploy-failed' });
    expect(!r.ok && r.detail).toBe(CRASH);
    expect(!r.ok && r.message).toMatch(/PORT/);
    expect(!r.ok && r.message).not.toMatch(/Cloud Run|Google|GCP/);
  });
});

describe('the wait fits inside the deploy lease', () => {
  it('🔒 a deploy that waits its full build AND readiness budget still holds its lease — no second deploy can start', () => {
    // If a wait ever outgrew the lease, a second press would see the lease as stale and start a parallel
    // build of the same app while the first was still settling.
    expect(BUILD_TIMEOUT_SECONDS * 1000 + SERVICE_READY_WAIT_MS + 60_000).toBeLessThan(DEPLOY_LEASE_STALE_MS);
  });
});
