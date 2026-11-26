/**
 * THE ANDROID BUILD API — tenant isolation, validation and honesty at the HTTP boundary (2026-11-25).
 *
 * The real route handlers, with the identity, the store and the build machine stubbed. What these lock:
 * user A can never see, download, stop or sign with anything of user B's; a malformed id is answered as
 * "not found"; nothing the browser sends picks a provider, path or key it is not entitled to; and the
 * configuration names an admin needs are never sent to the browser.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { captureRoutes, mockRes } from './helpers/routeTestUtils';
import { NativeBuildFirestore } from './helpers/nativeBuildFirestore';

const who = { uid: 'user-a' as string | null };
vi.mock('../src/server/lib/authMiddleware', () => ({
  verifyFirebaseIdentity: async () => (who.uid ? { uid: who.uid, email: null, emailVerified: false } : null),
}));
const started: unknown[] = [];
const verify = { result: { ok: true, certSha256: Array.from({ length: 32 }, () => 'E5').join(':') } as any };
vi.mock('../src/server/lib/mobileBuild/nativeBuildRunner', async (orig) => {
  const real = await orig<typeof import('../src/server/lib/mobileBuild/nativeBuildRunner')>();
  return {
    ...real,
    startNativeBuildSweeper: () => {},
    advanceNativeBuild: async (id: string) => (await import('../src/server/lib/mobileBuild/nativeBuildStore')).getJob(id),
    startNativeBuild: async (input: unknown) => { started.push(input); return { ok: false, status: 503, body: { error: 'stubbed', code: 'stub' } }; },
    verifyKeystoreInSandbox: async () => verify.result,
    defaultRunnerDeps: { ...real.defaultRunnerDeps, artifacts: { stream: () => { const { Readable } = require('node:stream'); return Readable.from([Buffer.from('APKBYTES')]); }, put: async () => ({ sizeBytes: 0, md5Ok: true }), remove: async () => {} } },
  };
});

import * as store from '../src/server/lib/mobileBuild/nativeBuildStore';
import { registerMobileBuildRoutes, isValidAppId, resolveAppId } from '../src/server/routes/mobileBuilds';
import type { NativeBuildJob } from '../src/server/lib/mobileBuild/types';

const ENV = { MOBILE_NATIVE_BUILD_ENABLED: 'on', E2B_API_KEY: 'k', MOBILE_NATIVE_BUILD_TEMPLATE: 'tpl', MOBILE_BUILD_ARTIFACT_BUCKET: 'bucket-x', SECRET_ENCRYPTION_KEY: 'unit-test-key-0123456789abcdef!!' };
const routes = captureRoutes(registerMobileBuildRoutes);
const call = async (key: string, req: Record<string, unknown> = {}) => {
  const res = mockRes() as any;
  const handler = routes.get(key);
  if (!handler) throw new Error(`no route ${key}`);
  await handler({ headers: {}, query: {}, params: {}, body: {}, ...req }, res);
  return res;
};

function job(over: Partial<NativeBuildJob> = {}): NativeBuildJob {
  return {
    id: 'nb_' + 'a'.repeat(32), userId: 'user-b', workspaceId: 'w', sessionId: 's', provider: 'native_cloud', kind: 'apk',
    appName: 'B App', appId: 'com.b.app', versionCode: 1, state: 'completed', step: null, stepIndex: null, stepCount: null,
    createdAt: '2026-11-25T00:00:00Z', startedAt: null, finishedAt: null, heartbeatAt: null, cancelRequested: false, attempt: 1,
    errorCode: null, errorMessage: null, failedStep: null, buildSandboxId: 'sbx-b', signSandboxId: null, toolchain: 'tpl', signingKeyId: null,
    artifact: { objectPath: 'mobile-builds/x/nb/b.apk', fileName: 'b-debug.apk', sizeBytes: 8, sha256: 'h', expiresAt: '2099-01-01T00:00:00Z',
      inspection: { applicationId: 'com.b.app', versionCode: 1, versionName: '1', minSdk: 23, targetSdk: 35, abis: [], certSha256: null, signingType: 'debug' } },
    billingRef: null, billingExempt: false, logTail: ['secret-ish log line of B'], leaseUntil: null, outputPath: 'p', ...over,
  };
}

let db: NativeBuildFirestore;
beforeEach(async () => {
  Object.assign(process.env, ENV);
  db = new NativeBuildFirestore();
  store.setNativeBuildDbForTests(db as any);
  who.uid = 'user-a';
  started.length = 0;
  await db.collection(store.BUILDS).doc(job().id).set(job() as any);
});

describe('identity first', () => {
  it('every route refuses a caller who is not signed in', async () => {
    who.uid = null;
    for (const key of routes.keys()) {
      const res = await call(key, { params: { buildId: job().id }, query: { appId: 'com.b.app' } });
      expect(res.statusCode, key).toBe(401);
    }
  });
});

describe('tenant isolation', () => {
  const B = job().id;
  it('user A cannot read, log, stop or download user B\'s build — answered exactly like a missing one', async () => {
    for (const key of ['GET /api/mobile-builds/:buildId', 'GET /api/mobile-builds/:buildId/logs', 'POST /api/mobile-builds/:buildId/cancel', 'GET /api/mobile-builds/:buildId/download']) {
      const res = await call(key, { params: { buildId: B } });
      expect(res.statusCode, key).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain('secret-ish');
    }
    expect((await store.getJob(B))?.cancelRequested).toBe(false);
  });

  it('the owner can, and the view carries no sandbox id, storage path or log', async () => {
    who.uid = 'user-b';
    const res = await call('GET /api/mobile-builds/:buildId', { params: { buildId: B } });
    expect(res.statusCode).toBe(200);
    const body = JSON.stringify(res.body);
    for (const hidden of ['sbx-b', 'mobile-builds/x', 'secret-ish', 'user-b']) expect(body).not.toContain(hidden);
  });

  it('history lists only the caller\'s own builds', async () => {
    const mine = await call('GET /api/mobile-builds/history');
    expect(mine.body.builds).toEqual([]);
    who.uid = 'user-b';
    expect((await call('GET /api/mobile-builds/history')).body.builds).toHaveLength(1);
  });

  it('user A cannot read or delete user B\'s upload key', async () => {
    await store.saveKey('user-b', 'com.b.app', { keystore: Buffer.from('K'), storePassword: 'p', keyPassword: 'p', alias: 'upload', certSha256: 'C', source: 'imported' }, { replace: false });
    expect((await call('GET /api/mobile-builds/signing-key', { query: { appId: 'com.b.app' } })).body).toEqual({ key: null });
    expect((await call('DELETE /api/mobile-builds/signing-key', { query: { appId: 'com.b.app' } })).statusCode).toBe(404);
    expect(await store.getKeyRecord('user-b', 'com.b.app')).not.toBeNull();
  });
});

describe('validation', () => {
  it('a malformed or path-like build id is "not found"', async () => {
    for (const bad of ['../../etc/passwd', 'nb_123', 'NB_' + 'a'.repeat(32), '', 'signing-key']) {
      expect((await call('GET /api/mobile-builds/:buildId', { params: { buildId: bad } })).statusCode).toBe(404);
    }
  });

  it('start: only the native provider, only apk/aab, only a real request id and app — nothing starts otherwise', async () => {
    const base = { provider: 'native_cloud', kind: 'apk', sessionId: 'sess1', idempotencyKey: 'abcdefghijklmnop1234', appName: 'A' };
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ ...base, provider: 'github_actions' }, 'use-github-flow'],
      [{ ...base, provider: 'cloud_run_job_x' }, 'bad-provider'],
      [{ ...base, kind: 'ipa' }, 'bad-kind'],
      [{ ...base, idempotencyKey: 'short' }, 'bad-request-id'],
      [{ ...base, sessionId: '../other' }, 'bad-app'],
      [{ ...base, appId: 'not a package' }, 'bad-app-id'],
    ];
    for (const [body, code] of cases) {
      const res = await call('POST /api/mobile-builds', { body });
      expect(res.statusCode, code).toBe(400);
      expect(res.body.code).toBe(code);
    }
    expect(started).toHaveLength(0);
    // A valid request reaches the runner with the SERVER's owner, never one from the body.
    await call('POST /api/mobile-builds', { body: { ...base, userId: 'user-b' } });
    expect((started[0] as { identity: { uid: string } }).identity.uid).toBe('user-a');
  });

  it('application ids follow Play\'s rules', () => {
    expect(isValidAppId('com.tea.timer')).toBe(true);
    for (const bad of ['tea', 'com..x', '1com.x', 'com.x;rm', 'com.' + 'x'.repeat(100)]) expect(isValidAppId(bad)).toBe(false);
    expect(resolveAppId(undefined, 'My Cool App')).toMatch(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/i);
    expect(resolveAppId('bad id', 'x')).toBeNull();
  });
});

describe('upload keys', () => {
  const ks = Buffer.from('a real keystore would go here').toString('base64');
  it('import needs explicit consent, a valid alias and a password — and is verified before anything is saved', async () => {
    const base = { appId: 'com.a.app', keystoreBase64: ks, alias: 'upload', storePassword: 'pw', consent: true };
    expect((await call('POST /api/mobile-builds/signing-key/import', { body: { ...base, consent: false } })).body.code).toBe('consent-required');
    expect((await call('POST /api/mobile-builds/signing-key/import', { body: { ...base, alias: 'a;rm' } })).body.code).toBe('bad-alias');
    expect((await call('POST /api/mobile-builds/signing-key/import', { body: { ...base, storePassword: '' } })).body.code).toBe('bad-password');
    verify.result = { ok: false, code: 'KEYSTORE_PASSWORD', detail: 'The keystore could not be opened with that password' };
    const refused = await call('POST /api/mobile-builds/signing-key/import', { body: base });
    expect(refused.statusCode).toBe(422);
    expect(await store.getKeyRecord('user-a', 'com.a.app')).toBeNull();
    verify.result = { ok: true, certSha256: 'F0' };
    const ok = await call('POST /api/mobile-builds/signing-key/import', { body: base });
    expect(ok.statusCode).toBe(200);
    expect(ok.body.key).toMatchObject({ appId: 'com.a.app', alias: 'upload', source: 'imported', certSha256: 'F0' });
    expect(JSON.stringify(ok.body)).not.toContain('pw');
    // A second import is refused unless replacing is explicit.
    expect((await call('POST /api/mobile-builds/signing-key/import', { body: base })).body.code).toBe('key-exists');
  });

  it('a NEW key is only created for an app the user confirms was never published, and is handed back once', async () => {
    const base = { appId: 'com.new.app', appName: 'New', consent: true };
    expect((await call('POST /api/mobile-builds/signing-key/generate', { body: base })).body.code).toBe('confirm-never-published');
    const ok = await call('POST /api/mobile-builds/signing-key/generate', { body: { ...base, confirmNeverPublished: true } });
    expect(ok.statusCode).toBe(200);
    expect(ok.body.backup.base64.length).toBeGreaterThan(100);
    expect(ok.body.key.certSha256).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    expect((await call('POST /api/mobile-builds/signing-key/generate', { body: { ...base, confirmNeverPublished: true } })).body.code).toBe('key-exists');
  });
});

describe('download', () => {
  it('streams the owner\'s file with its checksum and filename; the download itself charges nothing', async () => {
    who.uid = 'user-b';
    const { Writable } = await import('node:stream');
    const chunks: Buffer[] = [];
    const headers: Record<string, string> = {};
    const res: any = new Writable({ write(c, _e, cb) { chunks.push(Buffer.from(c)); cb(); } });
    res.setHeader = (k: string, v: string) => { headers[k] = v; };
    res.status = () => res;
    res.json = () => res;
    const done = new Promise((r) => res.on('finish', r));
    await routes.get('GET /api/mobile-builds/:buildId/download')!({ headers: {}, query: {}, params: { buildId: job().id }, body: {} }, res);
    await done;
    expect(Buffer.concat(chunks).toString()).toBe('APKBYTES');
    expect(headers['Content-Disposition']).toBe('attachment; filename="b-debug.apk"');
    expect(headers['X-Checksum-SHA256']).toBe('h');
    expect(headers['Cache-Control']).toBe('private, no-store');
    expect(headers['x-navbharatai-charge-applied']).toBe('false');
  });

  it('an expired build is gone, honestly', async () => {
    await db.collection(store.BUILDS).doc(job().id).set(job({ artifact: { ...job().artifact!, expiresAt: '2000-01-01T00:00:00Z' } }) as any);
    who.uid = 'user-b';
    const res = await call('GET /api/mobile-builds/:buildId/download', { params: { buildId: job().id } });
    expect(res.statusCode).toBe(410);
    expect((await store.getJob(job().id))?.state).toBe('expired');
  });

  it('a build with no file yet has nothing to download', async () => {
    await db.collection(store.BUILDS).doc(job().id).set(job({ state: 'building', artifact: null }) as any);
    who.uid = 'user-b';
    expect((await call('GET /api/mobile-builds/:buildId/download', { params: { buildId: job().id } })).statusCode).toBe(409);
  });
});

describe('capabilities', () => {
  it('lists exactly the two providers and never sends configuration names to the browser', async () => {
    process.env.MOBILE_NATIVE_BUILD_ENABLED = 'off';
    const res = await call('GET /api/mobile-builds/capabilities');
    expect(res.body.providers.map((p: { id: string }) => p.id)).toEqual(['native_cloud', 'github_actions']);
    expect(JSON.stringify(res.body)).not.toContain('MOBILE_NATIVE_BUILD_ENABLED');
    expect(res.body.providers[0].available).toBe(false);
  });
});
