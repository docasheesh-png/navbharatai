import { describe, it, expect } from 'vitest';
import {
  appsProject, appsRegion, serviceNameFor, buildServiceSpec, buildCreateServiceRequest,
  buildUpdateServiceRequest, buildMakePublicRequest, buildGetServiceRequest, parseService,
  hostingFailureMessage, deployAppToCloudRun, servicePath,
  HOSTING_CAPS, PLATFORM_PROJECT, DEFAULT_REGION, RUN_API,
} from '../src/server/AgentV3/cloudRunHosting';

/**
 * NAVBHARAT CLOUD — slice 1 (ROADMAP §11). Hosting a user's app on NavBharatAI's own infrastructure,
 * so the five-step path through GitHub and Render can disappear.
 *
 * Two rules dominate these tests because they are the two that cost real money or real safety if they
 * are ever quietly wrong: user code never runs in the platform's GCP project, and every cost ceiling
 * comes from one place.
 */
const okRes = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => body,
  text: async () => JSON.stringify(body ?? ''),
});

describe('🔒 appsProject — fails closed, and refuses the platform project by name', () => {
  it('unset ⇒ hosting is unavailable and says what to set', () => {
    const r = appsProject({} as NodeJS.ProcessEnv);
    expect(r.projectId).toBeNull();
    expect(r.problem).toBe('not-configured');
    expect(r.message).toContain('NAVBHARAT_APPS_PROJECT');
  });

  it('🔒 THE DECISION THIS PROTECTS: pointing it at the platform project is REFUSED', () => {
    // Not a typo — this is the isolation being removed, and everything else would keep working, which
    // is exactly why it has to fail here rather than be noticed later.
    const r = appsProject({ NAVBHARAT_APPS_PROJECT: PLATFORM_PROJECT } as NodeJS.ProcessEnv);
    expect(r.projectId).toBeNull();
    expect(r.problem).toBe('is-platform-project');
    expect(r.message).toMatch(/separate project/i);
  });

  it('🔒 there is no fallback — an unset project NEVER resolves to the platform one', () => {
    for (const env of [{}, { NAVBHARAT_APPS_PROJECT: '' }, { NAVBHARAT_APPS_PROJECT: '   ' }]) {
      expect(appsProject(env as NodeJS.ProcessEnv).projectId).not.toBe(PLATFORM_PROJECT);
      expect(appsProject(env as NodeJS.ProcessEnv).projectId).toBeNull();
    }
  });

  it('a real, different project resolves cleanly', () => {
    const r = appsProject({ NAVBHARAT_APPS_PROJECT: ' navbharat-apps-prod ' } as NodeJS.ProcessEnv);
    expect(r).toEqual({ projectId: 'navbharat-apps-prod', problem: null, message: '' });
  });

  it('the region defaults to Mumbai for an India-first product, and is tunable', () => {
    expect(appsRegion({} as NodeJS.ProcessEnv)).toBe(DEFAULT_REGION);
    expect(DEFAULT_REGION).toBe('asia-south1');
    expect(appsRegion({ NAVBHARAT_APPS_REGION: 'europe-west1' } as NodeJS.ProcessEnv)).toBe('europe-west1');
  });
});

describe('🔒 HOSTING_CAPS — the cost ceiling lives in exactly one place', () => {
  it('scale-to-zero is the cost model: an idle app runs no instances', () => {
    expect(HOSTING_CAPS.minInstanceCount).toBe(0);
  });

  it('🔒 max instances is small — this is the cap on what one app can spend in an hour', () => {
    expect(HOSTING_CAPS.maxInstanceCount).toBeGreaterThan(0);
    expect(HOSTING_CAPS.maxInstanceCount).toBeLessThanOrEqual(5);
  });

  it('concurrency is high, because fewer instances is both cheaper and faster', () => {
    expect(HOSTING_CAPS.concurrency).toBeGreaterThanOrEqual(40);
  });

  it('a request is bounded — one that has not finished in five minutes is not going to', () => {
    expect(HOSTING_CAPS.timeoutSeconds).toBeLessThanOrEqual(600);
  });

  it('🔒 the spec takes EVERY limit from the caps — no inline number can drift from them', () => {
    const spec = buildServiceSpec({ image: 'img', workspaceId: 'w' }) as any;
    expect(spec.template.scaling.minInstanceCount).toBe(HOSTING_CAPS.minInstanceCount);
    expect(spec.template.scaling.maxInstanceCount).toBe(HOSTING_CAPS.maxInstanceCount);
    expect(spec.template.maxInstanceRequestConcurrency).toBe(HOSTING_CAPS.concurrency);
    expect(spec.template.timeout).toBe(`${HOSTING_CAPS.timeoutSeconds}s`);
    expect(spec.template.containers[0].resources.limits).toEqual({ cpu: HOSTING_CAPS.cpu, memory: HOSTING_CAPS.memory });
  });
});

describe('serviceNameFor — deterministic, valid, and readable', () => {
  const VALID = /^[a-z]([-a-z0-9]*[a-z0-9])?$/;

  it('🔒 the SAME workspace always yields the SAME name — a redeploy updates, never sprawls', () => {
    expect(serviceNameFor('agentv3-uid-sid', 'mitrify')).toBe(serviceNameFor('agentv3-uid-sid', 'mitrify'));
  });

  it('different workspaces never collide, even with the same app name', () => {
    expect(serviceNameFor('ws-a', 'shop')).not.toBe(serviceNameFor('ws-b', 'shop'));
  });

  it('🔒 always a valid Cloud Run name — starts with a letter, no trailing hyphen, ≤63 chars', () => {
    for (const [ws, app] of [
      ['agentv3-abc-123', 'mitrify'],
      ['ws', '123-numbers-first'],
      ['ws', '!!!'],
      ['ws', ''],
      ['ws', null],
      ['ws', 'A Very Long Application Name That Goes On And On And On Beyond Every Limit'],
      ['ws', '---'],
      ['', ''],
    ] as Array<[string, string | null]>) {
      const n = serviceNameFor(ws, app);
      expect(n, `${ws}/${app}`).toMatch(VALID);
      expect(n.length, `${ws}/${app}`).toBeLessThanOrEqual(63);
    }
  });

  it('keeps the app name readable when it can', () => {
    expect(serviceNameFor('ws', 'mitrify')).toMatch(/^mitrify-/);
  });
});

describe('request builders', () => {
  it('create posts to the collection with the service id, and carries the token', () => {
    const r = buildCreateServiceRequest('tok', 'p', 'asia-south1', 'svc', { a: 1 });
    expect(r.url).toBe(`${RUN_API}/projects/p/locations/asia-south1/services?serviceId=svc`);
    expect(r.method).toBe('POST');
    expect(r.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(r.body!)).toEqual({ a: 1 });
  });

  it('🔒 the update sends the WHOLE spec with no updateMask — a masked update could leave the old cost ceiling standing', () => {
    const r = buildUpdateServiceRequest('tok', 'p', 'r', 'svc', { a: 1 });
    expect(r.method).toBe('PATCH');
    expect(r.url).toContain(servicePath('p', 'r', 'svc'));
    expect(r.url).not.toContain('updateMask');
  });

  it('public access is its own explicit call — never a side effect of the create', () => {
    const r = buildMakePublicRequest('tok', 'p', 'r', 'svc');
    expect(r.url).toContain(':setIamPolicy');
    expect(JSON.parse(r.body!).policy.bindings[0]).toEqual({ role: 'roles/run.invoker', members: ['allUsers'] });
    // The create must NOT smuggle it in.
    expect(JSON.stringify(buildServiceSpec({ image: 'i', workspaceId: 'w' }))).not.toContain('allUsers');
  });

  it('get reads the service back', () => {
    const r = buildGetServiceRequest('tok', 'p', 'r', 'svc');
    expect(r.method).toBe('GET');
    expect(r.url).toBe(`${RUN_API}/${servicePath('p', 'r', 'svc')}`);
  });

  it('env vars reach the container, and an app that needs none sends none', () => {
    const withEnv = buildServiceSpec({ image: 'i', workspaceId: 'w', envVars: [{ key: 'DATABASE_URL', value: 'postgres://x' }] }) as any;
    expect(withEnv.template.containers[0].env).toEqual([{ name: 'DATABASE_URL', value: 'postgres://x' }]);
    expect((buildServiceSpec({ image: 'i', workspaceId: 'w' }) as any).template.containers[0].env).toBeUndefined();
  });
});

describe('🔒 parseService — "ready" is earned, never assumed', () => {
  it('a service reporting Ready is ready', () => {
    const p = parseService({ name: 'x', uri: 'https://a.run.app', conditions: [{ type: 'Ready', state: 'CONDITION_SUCCEEDED' }] });
    expect(p).toEqual({ name: 'x', uri: 'https://a.run.app', ready: true });
  });

  it('🔒 a created-but-not-serving service is NOT ready — Cloud Run answers long before it serves', () => {
    // Reporting this as live would hand the user a URL that refuses connections: the same lie this
    // deploy path already had to unlearn for domains and for Render.
    expect(parseService({ name: 'x', uri: 'https://a.run.app' })?.ready).toBe(false);
    expect(parseService({ name: 'x', uri: 'u', conditions: [{ type: 'Ready', state: 'CONDITION_PENDING' }] })?.ready).toBe(false);
  });

  it('junk is null, and a trailing slash never survives into the URL', () => {
    for (const junk of [null, {}, 'nope', { name: '  ' }]) expect(parseService(junk)).toBeNull();
    expect(parseService({ name: 'x', uri: 'https://a.run.app/' })?.uri).toBe('https://a.run.app');
  });
});

describe('hostingFailureMessage — names the missing admin step, not the status code', () => {
  it('🔒 a permission error names the exact roles, because this is the likeliest real failure', () => {
    for (const s of [401, 403]) {
      const m = hostingFailureMessage(s, 'navbharat-apps-prod');
      expect(m).toContain('navbharat-apps-prod');
      expect(m).toMatch(/Cloud Run Admin/);
    }
  });

  it('a missing project points at the project id and the API', () => {
    expect(hostingFailureMessage(404, 'p')).toMatch(/not found|not enabled/i);
  });

  it('every message says nothing was lost, and never blames the user', () => {
    for (const s of [400, 429, 500]) {
      expect(hostingFailureMessage(s, 'p')).toMatch(/nothing was (lost|deployed)|try again/i);
    }
  });
});

describe('deployAppToCloudRun — honest at every branch, never throws', () => {
  const base = { token: 't', projectId: 'apps-prod', region: 'asia-south1', workspaceId: 'ws-1', appName: 'mitrify', image: 'img:1' };
  const served = { name: 'svc', uri: 'https://mitrify-abc.a.run.app', conditions: [{ type: 'Ready', state: 'CONDITION_SUCCEEDED' }] };

  it('creates, opens to the public, and returns the URL', async () => {
    const calls: string[] = [];
    const res = await deployAppToCloudRun(base, (async (url: any, init: any) => {
      calls.push(`${init?.method ?? 'GET'} ${String(url)}`);
      if (String(url).includes(':setIamPolicy')) return okRes({});
      if (init?.method === 'POST') return okRes({ name: 'op' });
      return okRes(served);
    }) as any);
    expect(res.ok).toBe(true);
    expect(res.ok && res.url).toBe('https://mitrify-abc.a.run.app');
    expect(res.ok && res.ready).toBe(true);
    // Public access comes AFTER the service exists — the order is not incidental.
    expect(calls.findIndex((c) => c.includes(':setIamPolicy'))).toBeGreaterThan(0);
  });

  it('🔒 an existing service is UPDATED, not duplicated', async () => {
    let patched = false;
    const res = await deployAppToCloudRun(base, (async (url: any, init: any) => {
      if (String(url).includes('?serviceId=')) return okRes({ error: 'exists' }, 409);
      if (init?.method === 'PATCH') { patched = true; return okRes({ name: 'op' }); }
      if (String(url).includes(':setIamPolicy')) return okRes({});
      return okRes(served);
    }) as any);
    expect(patched).toBe(true);
    expect(res.ok).toBe(true);
  });

  it('🔒 a service nobody can open is NOT reported as deployed', async () => {
    const res = await deployAppToCloudRun(base, (async (url: any) => (
      String(url).includes(':setIamPolicy') ? okRes({}, 403) : okRes(served)
    )) as any);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.message).toMatch(/would not work/i);
  });

  it('🔒 no URL is a refusal — a domain must never be pointed at an empty address', async () => {
    const res = await deployAppToCloudRun(base, (async (url: any, init: any) => {
      if (String(url).includes(':setIamPolicy')) return okRes({});
      if (init?.method === 'POST') return okRes({ name: 'op' });
      return okRes({ name: 'svc' });          // no uri
    }) as any);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toBe('no-url');
  });

  it('a refused deploy carries the real next step', async () => {
    const res = await deployAppToCloudRun(base, (async () => okRes({}, 403)) as any);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.message).toMatch(/Cloud Run Admin/);
  });

  it('never throws — a network failure is a reported reason', async () => {
    const res = await deployAppToCloudRun(base, (async () => { throw new Error('offline'); }) as any);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.message).toMatch(/Nothing was changed/i);
  });
});
