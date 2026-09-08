import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  navBharatCloudEnabled, navBharatCloudPublic, hostingAvailability, hostAppOnNavBharatCloud,
} from '../src/server/AgentV3/hostApp';
import { PLATFORM_PROJECT } from '../src/server/AgentV3/cloudRunHosting';

/**
 * The whole path, from the durable store to a live URL (ROADMAP §11, slice 1c).
 *
 * The refusals are what these tests are mostly about. Every step of this path can half-succeed in a
 * way that yields a URL for something that is not the user's app — a file left out of the archive, a
 * build that timed out while an older image still sits in the registry, a service created but not
 * reachable. Each of those has shipped as a lie in this deploy path before, under a different name.
 */
const okRes = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => body,
  text: async () => JSON.stringify(body ?? ''),
});
const noSleep = async () => {};

const ON = { NAVBHARAT_CLOUD: 'on', NAVBHARAT_APPS_PROJECT: 'apps-prod' } as unknown as NodeJS.ProcessEnv;

/** A fake Google that builds and deploys successfully — each test breaks one step of it. */
function happyCloud(over: { build?: string; deployStatus?: number; iamStatus?: number; service?: unknown } = {}) {
  return (async (url: any, init: any) => {
    const u = String(url);
    if (u.includes('uploadType=media')) return okRes({});
    if (u.includes('cloudbuild.googleapis.com') && init?.method === 'POST') {
      return okRes({ metadata: { build: { id: 'b1', status: over.build ?? 'SUCCESS' } } });
    }
    if (u.includes('cloudbuild.googleapis.com')) return okRes({ id: 'b1', status: over.build ?? 'SUCCESS' });
    if (u.includes(':setIamPolicy')) return okRes({}, over.iamStatus ?? 200);
    if (init?.method === 'POST' || init?.method === 'PATCH') return okRes({ name: 'op' }, over.deployStatus ?? 200);
    return okRes(over.service ?? { name: 'svc', uri: 'https://mitrify-ab12.a.run.app', conditions: [{ type: 'Ready', state: 'CONDITION_SUCCEEDED' }] });
  }) as any;
}

describe('🔒 the two flags — inert by default, admin-only after that', () => {
  it('the master switch is OFF unless explicitly set', () => {
    expect(navBharatCloudEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(navBharatCloudEnabled({ NAVBHARAT_CLOUD: 'off' } as NodeJS.ProcessEnv)).toBe(false);
    expect(navBharatCloudEnabled({ NAVBHARAT_CLOUD: 'on' } as NodeJS.ProcessEnv)).toBe(true);
  });

  it('hosting stays admin-only until a SECOND flag opens it', () => {
    expect(navBharatCloudPublic({} as NodeJS.ProcessEnv)).toBe(false);
    expect(navBharatCloudPublic({ NAVBHARAT_CLOUD_PUBLIC: 'on' } as NodeJS.ProcessEnv)).toBe(true);
  });

  it('a non-admin is refused while the feature is still being tested', () => {
    expect(hostingAvailability({ isAdmin: false, env: ON }).available).toBe(false);
    expect(hostingAvailability({ isAdmin: true, env: ON }).available).toBe(true);
    expect(hostingAvailability({ isAdmin: false, env: { ...ON, NAVBHARAT_CLOUD_PUBLIC: 'on' } as NodeJS.ProcessEnv }).available).toBe(true);
  });

  it('🔒 an OFF feature does not leak that the project is misconfigured — the flag is checked first', () => {
    const a = hostingAvailability({ isAdmin: true, env: {} as NodeJS.ProcessEnv });
    expect(a.available).toBe(false);
    expect(a.message).toMatch(/not switched on/i);
    expect(a.message).not.toMatch(/NAVBHARAT_APPS_PROJECT/);
  });

  it('🔒 D4 holds all the way up here: the platform project is refused even for an admin', () => {
    const a = hostingAvailability({
      isAdmin: true,
      env: { NAVBHARAT_CLOUD: 'on', NAVBHARAT_APPS_PROJECT: PLATFORM_PROJECT } as unknown as NodeJS.ProcessEnv,
    });
    expect(a.available).toBe(false);
    expect(a.message).toMatch(/separate project/i);
  });

  it('an admin with the flag on but no project configured is told which setting is missing', () => {
    const a = hostingAvailability({ isAdmin: true, env: { NAVBHARAT_CLOUD: 'on' } as NodeJS.ProcessEnv });
    expect(a.available).toBe(false);
    expect(a.message).toContain('NAVBHARAT_APPS_PROJECT');
  });
});

describe('🔒 the route — POST /api/agentv3/host-app', () => {
  const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
  const handler = (() => {
    const at = route.indexOf("app.post('/api/agentv3/host-app'");
    return at === -1 ? '' : route.slice(at, route.indexOf('app.post(', at + 40));
  })();

  it('exists, and checks ownership before it touches anything', () => {
    expect(handler).not.toBe('');
    expect(handler).toContain('assertWorkspaceOwner(req, workspaceId)');
    const ownAt = handler.indexOf('assertWorkspaceOwner');
    expect(handler.indexOf('hostingAvailability')).toBeGreaterThan(ownAt);
    expect(handler.indexOf('hostAppOnNavBharatCloud')).toBeGreaterThan(ownAt);
  });

  it('🔒 admin access is decided by the VERIFIED identity, never a body-supplied email', () => {
    expect(handler).toContain('await resolveReadIdentity(req)');
    expect(handler).toContain('isAdmin: isReportAdmin(email)');
    expect(handler).not.toMatch(/isReportAdmin\(req\.body/);
  });

  it('🔒 the gate runs BEFORE any file is read or any token is minted — an off feature costs nothing', () => {
    const gateAt = handler.indexOf('hostingAvailability(');
    expect(gateAt).toBeGreaterThan(-1);
    expect(handler.indexOf('loadWorkspaceFiles')).toBeGreaterThan(gateAt);
    expect(handler.indexOf('new GoogleAuth')).toBeGreaterThan(gateAt);
  });

  it('🔒 the provider\'s own words never reach the response — white-label law', () => {
    expect(handler).toContain('console.error(`[host-app]');
    // The body carries OUR message, never the detail.
    expect(handler).not.toMatch(/json\(\{[^}]*detail: result\.detail/);
  });

  it('secrets are loaded SCOPED to this app, so hosting inherits the build path\'s least privilege', () => {
    expect(handler).toContain('loadUserVaultSecrets(userId, workspaceId)');
  });

  it('each refusal gets a status that matches its reason', () => {
    expect(handler).toContain("result.reason === 'unavailable' ? 503");
    expect(handler).toContain("result.reason === 'no-source' || result.reason === 'unpackable' ? 422");
  });
});

describe('hostAppOnNavBharatCloud — a URL only when there is genuinely one to report', () => {
  const files = {
    'package.json': '{"name":"mitrify","scripts":{"start":"node server.js"}}',
    'server.js': 'const db = process.env.DATABASE_URL;\n',
  };
  const base = { workspaceId: 'ws-1', appName: 'mitrify', files, token: 't', env: ON, now: 1757270000000, pollMs: 1, maxWaitMs: 500 };

  it('packs, builds, deploys and reports the live URL', async () => {
    const r = await hostAppOnNavBharatCloud(base, happyCloud(), noSleep);
    expect(r.ok).toBe(true);
    expect(r.ok && r.url).toBe('https://mitrify-ab12.a.run.app');
    expect(r.ok && r.ready).toBe(true);
    expect(r.ok && r.buildId).toBe('b1');
  });

  it('🔒 the deployed app receives only what its code reads — the vault is not emptied into it', async () => {
    let sentEnv: any[] = [];
    const r = await hostAppOnNavBharatCloud(
      { ...base, vaultSecrets: { DATABASE_URL: 'postgres://real.host/db', RENDER_API_KEY: 'rnd_secret', UNUSED: 'x' } },
      (async (url: any, init: any) => {
        const u = String(url);
        if (u.includes('run.googleapis.com') && init?.method === 'POST' && !u.includes(':setIamPolicy')) {
          sentEnv = JSON.parse(String(init.body)).template.containers[0].env ?? [];
        }
        return happyCloud()(url, init);
      }) as any,
      noSleep,
    );
    expect(r.ok).toBe(true);
    // DATABASE_URL is read by server.js; the deploy key and the unused secret are not sent at all.
    expect(sentEnv.map((e) => e.name)).toEqual(['DATABASE_URL']);
  });

  it('🔒 an app with no files is refused, not deployed as an empty site', async () => {
    const r = await hostAppOnNavBharatCloud({ ...base, files: {} }, happyCloud(), noSleep);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe('no-source');
  });

  it('🔒 THE PARTIAL-ARCHIVE REFUSAL: a file that cannot be packaged stops the deploy and is NAMED', async () => {
    // Shipping without it produces an import error against a file that plainly exists in the editor —
    // one of the least debuggable failures we could hand somebody.
    let built = false;
    const r = await hostAppOnNavBharatCloud(
      { ...base, files: { ...files, '../escape.js': 'x' } },
      (async (url: any, init: any) => {
        if (String(url).includes('cloudbuild')) built = true;
        return happyCloud()(url, init);
      }) as any,
      noSleep,
    );
    expect(built).toBe(false);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe('unpackable');
    expect(!r.ok && r.message).toContain('escape.js');
  });

  it('🔒 a failed build never becomes a deploy — the previous image must not be served as the new one', async () => {
    let deployed = false;
    const r = await hostAppOnNavBharatCloud(base, (async (url: any, init: any) => {
      if (String(url).includes('run.googleapis.com')) deployed = true;
      return happyCloud({ build: 'FAILURE' })(url, init);
    }) as any, noSleep);
    expect(deployed).toBe(false);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe('build-failed');
  });

  it('a refused deploy is reported as such, with the real next step', async () => {
    const r = await hostAppOnNavBharatCloud(base, happyCloud({ deployStatus: 403 }), noSleep);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe('deploy-failed');
    expect(!r.ok && r.message).toMatch(/Cloud Run Admin/);
  });

  it('🔒 a service nobody can open is not a successful host', async () => {
    const r = await hostAppOnNavBharatCloud(base, happyCloud({ iamStatus: 403 }), noSleep);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe('deploy-failed');
  });

  it('🔒 a service that is not serving yet reports ready:false rather than claiming it is live', async () => {
    const r = await hostAppOnNavBharatCloud(base, happyCloud({ service: { name: 'svc', uri: 'https://x.a.run.app' } }), noSleep);
    expect(r.ok).toBe(true);
    expect(r.ok && r.ready).toBe(false);
  });

  it('hosting that is not configured refuses before touching Google at all', async () => {
    let called = false;
    const r = await hostAppOnNavBharatCloud(
      { ...base, env: { NAVBHARAT_CLOUD: 'on' } as NodeJS.ProcessEnv },
      (async () => { called = true; return okRes({}); }) as any,
      noSleep,
    );
    expect(called).toBe(false);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe('unavailable');
  });

  it('never throws — a network failure is a reported reason', async () => {
    const r = await hostAppOnNavBharatCloud(base, (async () => { throw new Error('offline'); }) as any, noSleep);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toMatch(/Nothing was changed/i);
  });
});
