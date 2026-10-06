// USER CODE NEVER RUNS AS THE DEFAULT IDENTITY (P0, 2026-10-06).
//
// Every hosted app ran as the apps project's default compute account, and every build did too (Cloud Build's
// default on a 2026 project). Any line of a user's code — a route handler, an npm postinstall script — could
// mint that account's token from the metadata server. These tests drive the real request builders and the
// real host path against a fake Google and lock:
//   • both identities are DEDICATED, validated, of the apps project, never a default, never the same;
//   • without them hosting is OFF — for the admin too (fails closed);
//   • the Cloud Run service carries the runtime identity, the build carries the build identity;
//   • the deploy is pinned to the image DIGEST; an unidentifiable image is never deployed;
//   • the staged source is deleted as soon as the build is over;
//   • censuses: no other code path creates a Cloud Run service or a Cloud Build build.
// What unit tests CANNOT prove — which roles each account really holds in Google — is verified by
// scripts/verifyHostingIsolation.sh and the probe app in infra/hosting-isolation-probe (see the docs).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { globSync } from 'glob';
import {
  appsServiceAccount, appsIdentities, isDefaultServiceAccount, buildServiceAccountResource,
} from '../src/server/AgentV3/appsIdentity';
import { buildServiceSpec } from '../src/server/AgentV3/cloudRunHosting';
import { buildCreateBuildRequest, digestFromTag, imageByDigest } from '../src/server/AgentV3/containerBuild';
import { hostingAvailability, hostAppOnNavBharatCloud } from '../src/server/AgentV3/hostApp';

const root = join(__dirname, '..');
const read = (f: string): string => readFileSync(join(root, f), 'utf8');
const P = 'navbharatai-user-apps';
const RUNTIME = `nbai-app-runtime@${P}.iam.gserviceaccount.com`;
const BUILDER = `nbai-app-builder@${P}.iam.gserviceaccount.com`;
const ENV = { NAVBHARAT_CLOUD: 'on', NAVBHARAT_APPS_PROJECT: P, NAVBHARAT_APPS_RUNTIME_SA: RUNTIME, NAVBHARAT_APPS_BUILD_SA: BUILDER } as unknown as NodeJS.ProcessEnv;
const DIGEST = `sha256:${'c'.repeat(64)}`;
const ok = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response;

describe('the identity rules', () => {
  it('recognises every Google default account', () => {
    expect(isDefaultServiceAccount('219549203609-compute@developer.gserviceaccount.com')).toBe(true);
    expect(isDefaultServiceAccount(`${P}@appspot.gserviceaccount.com`)).toBe(true);
    expect(isDefaultServiceAccount('219549203609@cloudbuild.gserviceaccount.com')).toBe(true);
    expect(isDefaultServiceAccount(RUNTIME)).toBe(false);
  });

  it('🔒 refuses: unset, a default account, another project\'s account, a non-address', () => {
    expect(appsServiceAccount('runtime', P, {} as NodeJS.ProcessEnv).ok).toBe(false);
    expect(appsServiceAccount('runtime', P, { NAVBHARAT_APPS_RUNTIME_SA: '219549203609-compute@developer.gserviceaccount.com' } as NodeJS.ProcessEnv).ok).toBe(false);
    expect(appsServiceAccount('runtime', P, { NAVBHARAT_APPS_RUNTIME_SA: 'nbai-app-runtime@gen-lang-client-0866594388.iam.gserviceaccount.com' } as NodeJS.ProcessEnv).ok).toBe(false);
    expect(appsServiceAccount('build', P, { NAVBHARAT_APPS_BUILD_SA: 'not an email' } as NodeJS.ProcessEnv).ok).toBe(false);
    expect(appsServiceAccount('runtime', P, ENV)).toEqual({ ok: true, email: RUNTIME });
  });

  it('🔒 the runtime and the build may not share an account — a running app must not hold build rights', () => {
    const same = { ...ENV, NAVBHARAT_APPS_BUILD_SA: RUNTIME } as NodeJS.ProcessEnv;
    expect(appsIdentities(P, same).ok).toBe(false);
    expect(appsIdentities(P, ENV)).toEqual({ ok: true, identities: { runtime: RUNTIME, build: BUILDER } });
  });

  it('🔒 FAILS CLOSED: without the identities hosting is off — for the admin too', () => {
    const noIds = { NAVBHARAT_CLOUD: 'on', NAVBHARAT_APPS_PROJECT: P } as unknown as NodeJS.ProcessEnv;
    const a = hostingAvailability({ isAdmin: true, env: noIds });
    expect(a.available).toBe(false);
    expect(a.message).toContain('NAVBHARAT_APPS_RUNTIME_SA');
    expect(hostingAvailability({ isAdmin: true, env: ENV }).available).toBe(true);
  });

  it('🔒 and the host path itself refuses before any Google call', async () => {
    let calls = 0;
    const r = await hostAppOnNavBharatCloud({
      workspaceId: 'ws1', files: { 'server.js': 'x' }, token: 't', existing: null,
      env: { NAVBHARAT_CLOUD: 'on', NAVBHARAT_APPS_PROJECT: P } as unknown as NodeJS.ProcessEnv,
    }, (async () => { calls += 1; return ok({}); }) as unknown as typeof fetch);
    expect(r).toMatchObject({ ok: false, reason: 'unavailable' });
    expect(calls).toBe(0);
  });
});

describe('the requests Google receives', () => {
  it('the Cloud Run service runs as the runtime identity', () => {
    const spec = buildServiceSpec({ image: 'img', workspaceId: 'ws1', serviceAccount: RUNTIME }) as { template: { serviceAccount?: string } };
    expect(spec.template.serviceAccount).toBe(RUNTIME);
  });

  it('the build runs as the build identity, with Cloud Logging only (required for a chosen account)', () => {
    const req = buildCreateBuildRequest('t', P, 'asia-south1', {
      bucket: 'b', object: 'o', image: 'i', serviceAccount: buildServiceAccountResource(P, BUILDER),
    });
    const body = JSON.parse(String(req.body));
    expect(body.serviceAccount).toBe(`projects/${P}/serviceAccounts/${BUILDER}`);
    expect(body.options).toEqual({ logging: 'CLOUD_LOGGING_ONLY' });
  });

  it('a digest is read only from a real tag resource', () => {
    expect(digestFromTag({ version: `projects/p/locations/l/repositories/r/packages/s/versions/${DIGEST}` })).toBe(DIGEST);
    expect(digestFromTag({ version: 'versions/latest' })).toBeNull();
    expect(digestFromTag(null)).toBeNull();
    expect(imageByDigest(P, 'asia-south1', 'svc', DIGEST)).toBe(`asia-south1-docker.pkg.dev/${P}/nbai-apps/svc@${DIGEST}`);
  });
});

describe('end to end against a fake Google', () => {
  function cloud(opts: { tagStatus?: number } = {}) {
    const seen = { buildBody: null as any, serviceBody: null as any, deleted: [] as string[], runCalls: 0 };
    const impl = (async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      if (u.includes('uploadType=media')) return ok({});
      if (u.includes('storage/v1/b/') && method === 'DELETE') { seen.deleted.push(u); return ok({}); }
      if (u.includes('artifactregistry.googleapis.com')) return ok({ version: `x/versions/${DIGEST}` }, opts.tagStatus ?? 200);
      if (u.includes('cloudbuild.googleapis.com') && method === 'POST') { seen.buildBody = JSON.parse(String(init?.body)); return ok({ metadata: { build: { id: 'b1', status: 'SUCCESS' } } }); }
      if (u.includes('cloudbuild.googleapis.com')) return ok({ id: 'b1', status: 'SUCCESS' });
      if (u.includes('run.googleapis.com')) {
        seen.runCalls += 1;
        if (u.includes(':setIamPolicy')) return ok({});
        if (method === 'POST') { seen.serviceBody = JSON.parse(String(init?.body)); return ok({ name: 'op' }); }
        return ok({ name: 'svc', uri: 'https://svc.a.run.app', conditions: [{ type: 'Ready', state: 'CONDITION_SUCCEEDED' }] });
      }
      return ok({});
    }) as unknown as typeof fetch;
    return { impl, seen };
  }
  const input = { workspaceId: 'ws1', appName: 'shop', files: { 'package.json': '{"scripts":{"start":"node server.js"}}', 'server.js': 'x' }, token: 't', existing: null, env: ENV, pollMs: 1, maxWaitMs: 500 };

  it('🔒 the build carries the builder, the service carries the runtime account and the DIGEST, and the source is deleted', async () => {
    const c = cloud();
    const r = await hostAppOnNavBharatCloud(input, c.impl, async () => {});
    expect(r.ok).toBe(true);
    expect(c.seen.buildBody.serviceAccount).toBe(`projects/${P}/serviceAccounts/${BUILDER}`);
    expect(c.seen.serviceBody.template.serviceAccount).toBe(RUNTIME);
    expect(c.seen.serviceBody.template.containers[0].image).toContain(`@${DIGEST}`);
    expect(c.seen.serviceBody.template.containers[0].image).not.toMatch(/:[0-9]{8,}/);
    expect(c.seen.deleted.length).toBe(1);
  });

  it('🔒 an image that cannot be identified by digest is NEVER deployed', async () => {
    const c = cloud({ tagStatus: 404 });
    const r = await hostAppOnNavBharatCloud(input, c.impl, async () => {});
    expect(r).toMatchObject({ ok: false, reason: 'build-failed' });
    expect(c.seen.runCalls).toBe(0);
  });
});

describe('censuses — no second door', () => {
  const serverFiles = globSync('src/server/**/*.ts', { cwd: root }).filter((f) => !/\.test\.ts$/.test(f)).concat('server.ts');

  it('🔒 only cloudRunHosting.ts builds a Cloud Run service template', () => {
    const offenders = serverFiles.filter((f) => f !== 'src/server/AgentV3/cloudRunHosting.ts' && /maxInstanceRequestConcurrency|template:\s*\{\s*(?:\/\/[^\n]*\n\s*)*containers/.test(read(f)));
    expect(offenders).toEqual([]);
    expect(read('src/server/AgentV3/cloudRunHosting.ts')).toContain('serviceAccount: input.serviceAccount,');
  });

  it('🔒 only containerBuild.ts creates a Cloud Build build for user code', () => {
    const offenders = serverFiles.filter((f) => f !== 'src/server/AgentV3/containerBuild.ts' && /locations\/\$\{[^}]+\}\/builds`/.test(read(f)) && /method:\s*'POST'/.test(read(f)));
    expect(offenders).toEqual([]);
    expect(read('src/server/AgentV3/containerBuild.ts')).toContain('serviceAccount: input.serviceAccount,');
  });
});
