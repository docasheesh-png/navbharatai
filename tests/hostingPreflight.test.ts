import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  isApiDisabled, classifyResponse, skipped, preflightVerdict, nextAction, runHostingPreflight,
} from '../src/server/AgentV3/hostingPreflight';

/**
 * IS THE APPS PROJECT READY? (NavBharat Cloud, D4.)
 *
 * Switching on hosting is a new GCP project, four APIs, an Artifact Registry repo, six IAM roles and one
 * env var — none of which this codebase can see or set. Without this check the first symptom of a wrong
 * step is a 403 inside a Cloud Build log, on a user's publish, hours later.
 */
const ok = (id = 'x') => classifyResponse({ id, label: 'L', status: 200, body: null, apiName: 'A', role: 'R' });

describe('🔒 isApiDisabled — a 403 is TWO different problems', () => {
  it('recognises a disabled API from the structured reason', () => {
    expect(isApiDisabled(403, { error: { details: [{ reason: 'SERVICE_DISABLED' }] } })).toBe(true);
  });

  it('recognises it from the message Google actually sends', () => {
    expect(isApiDisabled(403, {
      error: { message: 'Cloud Run Admin API has not been used in project 12345 before or it is disabled.' },
    })).toBe(true);
  });

  it('🔒 a PLAIN 403 is a missing ROLE, not a disabled API', () => {
    // Getting this backwards sends the admin to the wrong console screen — which is most of what this
    // module exists to prevent.
    expect(isApiDisabled(403, { error: { message: 'Permission denied on resource project.' } })).toBe(false);
    expect(isApiDisabled(403, {})).toBe(false);
    expect(isApiDisabled(403, null)).toBe(false);
  });

  it('only 403 can mean a disabled API', () => {
    expect(isApiDisabled(404, { error: { details: [{ reason: 'SERVICE_DISABLED' }] } })).toBe(false);
    expect(isApiDisabled(200, { error: { details: [{ reason: 'SERVICE_DISABLED' }] } })).toBe(false);
  });
});

describe('classifyResponse — every failure names its exact remedy', () => {
  const base = { id: 'cloudRun', label: 'Cloud Run', apiName: 'Cloud Run Admin API', role: 'Cloud Run Admin' };

  it('2xx is ok, with nothing to do', () => {
    expect(ok().state).toBe('ok');
    expect(ok().remedy).toBe('');
    expect(classifyResponse({ ...base, status: 204, body: null }).state).toBe('ok');
  });

  it('a disabled API sends the admin to the API screen, naming the API', () => {
    const c = classifyResponse({ ...base, status: 403, body: { error: { details: [{ reason: 'SERVICE_DISABLED' }] } } });
    expect(c.state).toBe('failed');
    expect(c.remedy).toContain('Cloud Run Admin API');
    expect(c.remedy).toMatch(/Enable/i);
    expect(c.remedy).not.toMatch(/IAM|role/i);
  });

  it('a missing role sends them to IAM, naming the role', () => {
    const c = classifyResponse({ ...base, status: 403, body: { error: { message: 'Permission denied.' } } });
    expect(c.state).toBe('failed');
    expect(c.remedy).toContain('Cloud Run Admin');
    expect(c.remedy).toMatch(/IAM/);
    expect(c.remedy).not.toMatch(/Enable APIs/);
  });

  it('a 404 is only a failure where a 404 MEANS something', () => {
    const repo = classifyResponse({
      ...base, id: 'artifactRegistry', status: 404, body: null,
      missingRemedy: 'Create a DOCKER repository named “nbai-apps” in region asia-south1.',
    });
    expect(repo.state).toBe('failed');
    expect(repo.remedy).toContain('nbai-apps');
    // Without a stated meaning, a 404 is not something to assert about the admin's setup.
    expect(classifyResponse({ ...base, status: 404, body: null }).state).toBe('unknown');
  });

  it('🔒 AN UNRECOGNISED ANSWER IS `unknown`, NEVER `failed`', () => {
    // "Something we do not understand" and "your setup is wrong" are different claims, and only one of
    // them is verified.
    for (const status of [0, 429, 500, 503]) {
      const c = classifyResponse({ ...base, status, body: null });
      expect(c.state).toBe('unknown');
      expect(c.detail).toContain(String(status));
    }
  });

  it('a 401 blames the credential, not the admin\'s roles', () => {
    const c = classifyResponse({ ...base, status: 401, body: null });
    expect(c.state).toBe('failed');
    expect(c.remedy).toMatch(/service account/i);
  });
});

describe('🔒 preflightVerdict — only ALL-OK is "ready"', () => {
  it('every check ok ⇒ ready', () => {
    expect(preflightVerdict([ok('a'), ok('b')])).toBe('ready');
  });

  it('any failure ⇒ blocked', () => {
    const bad = classifyResponse({ id: 'a', label: 'L', status: 403, body: null, apiName: 'A', role: 'R' });
    expect(preflightVerdict([ok(), bad])).toBe('blocked');
  });

  it('🔒 a SKIPPED or UNKNOWN check can never read as ready', () => {
    // "We did not check" must not render as "you are good to go" — this module's own failure mode,
    // applied to its own summary.
    expect(preflightVerdict([ok(), skipped('b', 'B', 'not run')])).toBe('incomplete');
    expect(preflightVerdict([ok(), classifyResponse({ id: 'b', label: 'B', status: 500, body: null, apiName: 'A', role: 'R' })]))
      .toBe('incomplete');
  });

  it('no checks at all is never ready', () => {
    expect(preflightVerdict([])).toBe('incomplete');
  });

  it('nextAction is the FIRST thing to fix, and empty when all is well', () => {
    const bad = classifyResponse({ id: 'a', label: 'L', status: 403, body: null, apiName: 'A', role: 'FirstRole' });
    expect(nextAction([ok(), bad])).toContain('FirstRole');
    expect(nextAction([ok('a'), ok('b')])).toBe('');
  });
});

describe('runHostingPreflight', () => {
  const never = (async () => { throw new Error('should not be called'); }) as unknown as typeof fetch;
  const answering = (status: number, body: unknown = null) =>
    (async () => ({ status, json: async () => body })) as unknown as typeof fetch;

  it('🔒 with NO project it asks Google nothing, and reports every check as SKIPPED', () => {
    // Not "ok". Certifying checks that never ran is exactly the lie this module exists to prevent.
    return runHostingPreflight({ token: 't', env: {} as any, fetchImpl: never }).then((r) => {
      // `blocked`, not `incomplete`: a real FAILURE outranks the skips it caused. There is a definite
      // wrong thing to fix, and saying only "incomplete" would understate it.
      expect(r.verdict).toBe('blocked');
      expect(r.checks[0].state).toBe('failed');
      expect(r.checks.slice(1).every((c) => c.state === 'skipped')).toBe(true);
      expect(r.nextAction).toContain('NAVBHARAT_APPS_PROJECT');
    });
  });

  it('🔒 pointing it at the PLATFORM project is caught, with the right remedy', async () => {
    const r = await runHostingPreflight({
      token: 't', env: { NAVBHARAT_APPS_PROJECT: 'gen-lang-client-0866594388' } as any, fetchImpl: never,
    });
    expect(r.verdict).toBe('blocked');
    expect(r.nextAction).toMatch(/SEPARATE/);
  });

  it('🔒 a report never lists the same check twice, even with no credential', async () => {
    const r = await runHostingPreflight({
      token: null, env: { NAVBHARAT_APPS_PROJECT: 'apps-1' } as any, fetchImpl: never,
    });
    expect(new Set(r.checks.map((c) => c.id)).size).toBe(r.checks.length);
    expect(r.checks.find((c) => c.id === 'credentials')!.state).toBe('failed');
  });

  it('a fully working project reports ready', async () => {
    const r = await runHostingPreflight({
      token: 't', env: { NAVBHARAT_APPS_PROJECT: 'apps-1' } as any, fetchImpl: answering(200, {}),
    });
    expect(r.verdict).toBe('ready');
    expect(r.projectId).toBe('apps-1');
    expect(r.nextAction).toBe('');
  });

  it('🔒 every missing step is reported in ONE pass — not one deploy at a time', async () => {
    // The admin should leave the console having fixed everything, not return four times.
    const r = await runHostingPreflight({
      token: 't', env: { NAVBHARAT_APPS_PROJECT: 'apps-1' } as any,
      fetchImpl: answering(403, { error: { details: [{ reason: 'SERVICE_DISABLED' }] } }),
    });
    expect(r.verdict).toBe('blocked');
    expect(r.checks.filter((c) => c.state === 'failed').length).toBe(4);
  });

  it('the region and repo name in the remedy are the ones the engine really uses', async () => {
    const r = await runHostingPreflight({
      token: 't', env: { NAVBHARAT_APPS_PROJECT: 'apps-1' } as any, fetchImpl: answering(404),
    });
    const repo = r.checks.find((c) => c.id === 'artifactRegistry')!;
    expect(repo.remedy).toContain('nbai-apps');
    expect(repo.remedy).toContain('asia-south1');
    expect(r.region).toBe('asia-south1');
  });

  it('a network failure is unknown, not a verdict on the admin\'s setup', async () => {
    const dead = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    const r = await runHostingPreflight({ token: 't', env: { NAVBHARAT_APPS_PROJECT: 'apps-1' } as any, fetchImpl: dead });
    expect(r.verdict).toBe('incomplete');
    expect(r.checks.filter((c) => c.state === 'failed').length).toBe(0);
  });
});

describe('🔒 the route', () => {
  const admin = readFileSync(join(__dirname, '..', 'src', 'server', 'routes', 'admin.ts'), 'utf8');

  it('is admin-gated, like every other hosting route', () => {
    expect(admin).toContain("app.get('/api/admin/hosting/preflight', verifyAdminToken");
  });

  it('🔒 a thrown error is reported AS a check, never as a 500', () => {
    // A checker that 500s tells the admin nothing about their setup.
    const at = admin.indexOf("'/api/admin/hosting/preflight'");
    expect(admin.slice(at, at + 1400)).toContain("verdict: 'incomplete'");
  });
});
