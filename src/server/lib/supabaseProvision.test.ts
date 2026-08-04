import { describe, it, expect } from 'vitest';
import {
  classifyStatus, listOrganizations, createProject, waitUntilReady, fetchProjectCredentials,
  projectNameFor, envForProject, refreshAccessToken, PROJECT_READY_STATUS,
} from './supabaseProvision';

/** A fake fetch that replays queued responses and records the requests it saw. */
function fakeFetch(queue: Array<{ status?: number; json?: unknown; text?: string; throws?: boolean }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = queue.shift() ?? { status: 200, json: {} };
    if (next.throws) throw new Error('network down');
    const status = next.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => next.json,
      text: async () => next.text ?? '',
    } as unknown as Response;
  }) as unknown as typeof globalThis.fetch;
  return { impl, calls };
}

describe('classifyStatus — a normal, user-fixable situation must never read as our bug', () => {
  it('402/403 on CREATE is the free-plan cap, and says exactly what to do', () => {
    // The single most likely real failure: Supabase's free plan allows 2 projects per org. Reporting
    // this as "access denied" would send the user hunting for a permissions problem that isn't there.
    for (const status of [402, 403]) {
      const e = classifyStatus(status, 'limit reached', 'create');
      expect(e.failure).toBe('plan-limit');
      expect(e.message).toContain('free plan allows 2');
      expect(e.message).toMatch(/Delete a project|upgrade/);
    }
  });

  it('403 while READING is a permissions problem, not a plan limit', () => {
    expect(classifyStatus(403, '', 'read').failure).toBe('unauthorized');
  });

  it('401 asks the user to reconnect rather than showing an error', () => {
    const e = classifyStatus(401, '', 'read');
    expect(e.failure).toBe('unauthorized');
    expect(e.message).toContain('connect Supabase again');
  });

  it('429 is "busy, try again", not a failure of the feature', () => {
    expect(classifyStatus(429, '', 'create').failure).toBe('rate-limited');
  });

  it('carries Supabase\'s own words as admin-only detail, capped', () => {
    const e = classifyStatus(500, 'x'.repeat(900), 'create');
    expect(e.detail!.length).toBe(500);
    expect(e.message).not.toContain('xxx'); // the raw body never becomes the user's message
  });
});

describe('listOrganizations', () => {
  it('returns the orgs the grant can create in', async () => {
    const { impl } = fakeFetch([{ json: [{ id: 'org_1', name: 'My Org' }] }]);
    expect(await listOrganizations('tok', impl)).toEqual({ ok: true, orgs: [{ id: 'org_1', name: 'My Org' }] });
  });

  it('treats "no organization" as its own dead end, not as an empty success', async () => {
    const { impl } = fakeFetch([{ json: [] }]);
    const r = await listOrganizations('tok', impl);
    expect(r).toMatchObject({ ok: false, failure: 'org-missing' });
    expect((r as { message: string }).message).toContain('Create one in Supabase');
  });

  it('survives a garbage body instead of throwing', async () => {
    const { impl } = fakeFetch([{ json: { not: 'an array' } }]);
    expect((await listOrganizations('tok', impl) as { failure: string }).failure).toBe('org-missing');
  });

  it('reports a network failure in the user\'s language', async () => {
    const { impl } = fakeFetch([{ throws: true }]);
    const r = await listOrganizations('tok', impl);
    expect((r as { message: string }).message).toContain('could not reach Supabase');
  });

  it('sends the bearer token', async () => {
    const { impl, calls } = fakeFetch([{ json: [{ id: 'o' }] }]);
    await listOrganizations('secret-token', impl);
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer secret-token');
  });
});

describe('createProject', () => {
  it('creates in the chosen org and returns the project', async () => {
    const { impl, calls } = fakeFetch([{ json: { id: 'ref123', name: 'App (NavBharatAI)', region: 'ap-south-1' } }]);
    const r = await createProject({ token: 't', orgId: 'org_1', name: 'App (NavBharatAI)', region: 'ap-south-1', dbPass: 'pw' }, impl);
    expect(r).toEqual({ ok: true, project: { id: 'ref123', name: 'App (NavBharatAI)', region: 'ap-south-1' } });
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body).toMatchObject({ organization_id: 'org_1', region: 'ap-south-1' });
  });

  it('refuses to claim success when Supabase returns no project id', async () => {
    const { impl } = fakeFetch([{ json: {} }]);
    const r = await createProject({ token: 't', orgId: 'o', name: 'n', region: 'r', dbPass: 'p' }, impl);
    expect(r).toMatchObject({ ok: false, failure: 'api-error' });
    expect((r as { message: string }).message).toContain('check your Supabase dashboard');
  });

  it('maps the plan cap through to the actionable message', async () => {
    const { impl } = fakeFetch([{ status: 402, text: 'free plan limit' }]);
    expect((await createProject({ token: 't', orgId: 'o', name: 'n', region: 'r', dbPass: 'p' }, impl) as { failure: string }).failure)
      .toBe('plan-limit');
  });
});

describe('waitUntilReady — "created" is NOT "usable", and we never pretend otherwise', () => {
  const clock = (start = 0) => { let t = start; return { now: () => t, advance: (ms: number) => { t += ms; } }; };

  it('resolves only when the project reports ACTIVE_HEALTHY', async () => {
    const { impl } = fakeFetch([
      { json: { status: 'COMING_UP' } },
      { json: { status: PROJECT_READY_STATUS } },
    ]);
    const c = clock();
    const r = await waitUntilReady('t', 'ref', {
      intervalMs: 10, timeoutMs: 10_000, now: c.now, sleep: async (ms) => { c.advance(ms); },
    }, impl);
    expect(r).toEqual({ ok: true });
  });

  it('reports a TIMEOUT rather than success when it never comes up', async () => {
    // This is the exact lie class the DB autopsy caught: announcing success while nothing is ready.
    const { impl } = fakeFetch(Array.from({ length: 50 }, () => ({ json: { status: 'COMING_UP' } })));
    const c = clock();
    const r = await waitUntilReady('t', 'ref', {
      intervalMs: 100, timeoutMs: 500, now: c.now, sleep: async (ms) => { c.advance(ms); },
    }, impl);
    expect(r).toMatchObject({ ok: false, failure: 'timeout' });
    expect((r as { message: string }).message).toContain('still starting up');
  });

  it('keeps polling through a transient network blip instead of giving up', async () => {
    const { impl } = fakeFetch([
      { throws: true },
      { json: { status: PROJECT_READY_STATUS } },
    ]);
    const c = clock();
    const r = await waitUntilReady('t', 'ref', {
      intervalMs: 10, timeoutMs: 10_000, now: c.now, sleep: async (ms) => { c.advance(ms); },
    }, impl);
    expect(r).toEqual({ ok: true });
  });

  it('fails FAST on 401 — waiting cannot fix authorisation', async () => {
    const { impl, calls } = fakeFetch([{ status: 401, text: '' }]);
    const c = clock();
    const r = await waitUntilReady('t', 'ref', {
      intervalMs: 10, timeoutMs: 60_000, now: c.now, sleep: async (ms) => { c.advance(ms); },
    }, impl);
    expect(r).toMatchObject({ ok: false, failure: 'unauthorized' });
    expect(calls.length).toBe(1); // did not burn the whole budget
  });
});

describe('fetchProjectCredentials — the app gets the PUBLIC key, and only that', () => {
  it('returns the project URL and the anon key', async () => {
    const { impl } = fakeFetch([{ json: [
      { name: 'anon', api_key: 'anon-key-abc' },
      { name: 'service_role', api_key: 'SERVICE-ROLE-SECRET' },
    ] }]);
    const r = await fetchProjectCredentials('t', 'ref123', impl);
    expect(r).toEqual({ ok: true, credentials: {
      projectRef: 'ref123', url: 'https://ref123.supabase.co', anonKey: 'anon-key-abc',
    } });
    // The service-role key bypasses row-level security and must never reach a client app.
    expect(JSON.stringify(r)).not.toContain('SERVICE-ROLE-SECRET');
  });

  it('does not claim success when the anon key is not there yet', async () => {
    const { impl } = fakeFetch([{ json: [{ name: 'service_role', api_key: 'x' }] }]);
    const r = await fetchProjectCredentials('t', 'ref', impl);
    expect(r).toMatchObject({ ok: false });
    expect((r as { message: string }).message).toContain('tap Refresh');
  });
});

describe('naming + env wiring', () => {
  it('names the project so the user recognises it in their own dashboard months later', () => {
    expect(projectNameFor('Mitrify')).toBe('Mitrify (NavBharatAI)');
    expect(projectNameFor('  ')).toBe('NavBharatAI app');
    expect(projectNameFor(null)).toBe('NavBharatAI app');
  });

  it('strips characters Supabase would reject and caps the length', () => {
    expect(projectNameFor('My<App>/v2!')).toBe('MyAppv2 (NavBharatAI)');
    expect(projectNameFor('x'.repeat(80)).length).toBeLessThanOrEqual(40 + ' (NavBharatAI)'.length);
  });

  it('emits the SAME env names the existing scaffolder already writes (no second convention)', () => {
    expect(envForProject({ projectRef: 'r', url: 'https://r.supabase.co', anonKey: 'k' })).toEqual({
      VITE_SUPABASE_URL: 'https://r.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'k',
    });
  });
});

// Phase 1.2 — without refresh, a user who connects once meets "please connect again" on their SECOND
// app, which quietly undoes the whole point of Phase 1.
describe('refreshAccessToken — a one-time setup must stay one-time', () => {
  const base = { refreshToken: 'old-refresh', clientId: 'cid', clientSecret: 'csec', nowMs: 1_000_000 };

  it('returns a fresh access token with an absolute expiry', async () => {
    const { impl, calls } = fakeFetch([{ json: { access_token: 'new-access', expires_in: 3600 } }]);
    const r = await refreshAccessToken(base, impl);
    expect(r).toEqual({ ok: true, tokens: {
      accessToken: 'new-access', refreshToken: 'old-refresh', expiresAtMs: 1_000_000 + 3_600_000,
    } });
    const sent = new URLSearchParams(String(calls[0].init?.body));
    expect(sent.get('grant_type')).toBe('refresh_token');
    expect(sent.get('refresh_token')).toBe('old-refresh');
  });

  it('STORES a rotated refresh token — dropping it silently breaks the connection an hour later', async () => {
    const { impl } = fakeFetch([{ json: { access_token: 'a', refresh_token: 'rotated', expires_in: 60 } }]);
    const r = await refreshAccessToken(base, impl);
    expect((r as { tokens: { refreshToken: string } }).tokens.refreshToken).toBe('rotated');
  });

  it('keeps the OLD refresh token when the response omits one (it stays valid)', async () => {
    const { impl } = fakeFetch([{ json: { access_token: 'a', expires_in: 60 } }]);
    expect((await refreshAccessToken(base, impl) as { tokens: { refreshToken: string } }).tokens.refreshToken)
      .toBe('old-refresh');
  });

  it('400 means the grant is GONE — say reconnect, because nothing else fixes it', async () => {
    const { impl } = fakeFetch([{ status: 400, text: 'invalid_grant' }]);
    const r = await refreshAccessToken(base, impl);
    expect(r).toMatchObject({ ok: false, failure: 'unauthorized' });
    expect((r as { message: string }).message).toContain('connect Supabase again');
  });

  it('a 5xx or throttle is TRANSIENT — never drags the user back through consent', async () => {
    for (const status of [500, 502, 429]) {
      const { impl } = fakeFetch([{ status, text: 'oops' }]);
      const r = await refreshAccessToken(base, impl);
      expect((r as { failure: string }).failure).not.toBe('unauthorized');
    }
  });

  it('a network failure is transient too, and says so in the user\'s language', async () => {
    const { impl } = fakeFetch([{ throws: true }]);
    const r = await refreshAccessToken(base, impl);
    expect((r as { failure: string }).failure).toBe('api-error');
    expect((r as { message: string }).message).toContain('could not reach Supabase');
  });

  it('refuses to claim success when no access token comes back', async () => {
    const { impl } = fakeFetch([{ json: { expires_in: 3600 } }]);
    expect((await refreshAccessToken(base, impl)).ok).toBe(false);
  });
});
