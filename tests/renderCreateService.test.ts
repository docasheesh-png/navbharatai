import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  buildListOwnersRequest, parseRenderOwnerId, deriveServiceCommands,
  buildCreateServiceRequest, parseCreatedService, createFailureMessage, createRenderService,
} from '../src/server/AgentV3/renderCreateService';

/**
 * CREATE THE BACKEND SERVICE, INSTEAD OF SENDING THE USER TO BUILD IT BY HAND (admin 2026-09-04).
 *
 * `deployBackendToRender` matched an existing service and, finding none, returned an honest
 * instruction: *"One-time step: in Render → New → Blueprint, pick your repo."* True, and still a wall —
 * the user leaves NavBharatAI, works in someone else's dashboard, and comes back. After the "Put this
 * app in my GitHub" action landed, that hand-off was the ONLY manual step left between an app and a
 * live site. Render's API can create the service, so the wall was ours.
 */
const okRes = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => body,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

describe('deriveServiceCommands — read how the app starts, never invent it', () => {
  it('a build script gives build + start; without one, install + start', () => {
    expect(deriveServiceCommands(JSON.stringify({ scripts: { build: 'vite build', start: 'node server.js' } })))
      .toEqual({ buildCommand: 'npm install && npm run build', startCommand: 'npm start' });
    expect(deriveServiceCommands(JSON.stringify({ scripts: { start: 'node server.js' } })))
      .toEqual({ buildCommand: 'npm install', startCommand: 'npm start' });
  });

  it('🔒 NO start script ⇒ null, and null must stop the creation', () => {
    // A guessed start command produces a service that builds, crashes, and bills the user for a dead
    // site our UI would report as deployed. Refusing is the safer answer.
    expect(deriveServiceCommands(JSON.stringify({ scripts: { build: 'vite build' } }))).toBeNull();
    expect(deriveServiceCommands(JSON.stringify({ scripts: {} }))).toBeNull();
    expect(deriveServiceCommands(JSON.stringify({ scripts: { start: '   ' } }))).toBeNull();
    expect(deriveServiceCommands('{not json')).toBeNull();
    expect(deriveServiceCommands(null)).toBeNull();
  });

  it('a build script is optional — plenty of Node servers need none, and refusing them would be wrong', () => {
    expect(deriveServiceCommands(JSON.stringify({ scripts: { start: 'node index.js' } }))?.buildCommand).toBe('npm install');
  });
});

describe('request builders', () => {
  it('owners is a GET, authorised', () => {
    const r = buildListOwnersRequest('rnd_k');
    expect(r.url).toContain('/v1/owners');
    expect(r.method).toBe('GET');
    expect(r.headers.Authorization).toBe('Bearer rnd_k');
  });

  it('🔒 the create defaults to the FREE plan and auto-deploy — it is the USER\'S account', () => {
    // free: a default that cannot surprise someone with a bill on their own account.
    // autoDeploy: what makes every later NavBharatAI change reach their site without another button.
    const r = buildCreateServiceRequest('k', {
      ownerId: 'own-1', name: 'mitrify', repoUrl: 'https://github.com/a/mitrify', branch: 'main',
      commands: { buildCommand: 'npm install', startCommand: 'npm start' },
    });
    const body = JSON.parse(r.body!);
    expect(r.url).toContain('/v1/services');
    expect(body.serviceDetails.plan).toBe('free');
    expect(body.autoDeploy).toBe('yes');
    expect(body.ownerId).toBe('own-1');
    expect(body.repo).toBe('https://github.com/a/mitrify');
    expect(body.serviceDetails.envSpecificDetails.startCommand).toBe('npm start');
  });

  it('an empty branch falls back to main rather than sending nothing', () => {
    const body = JSON.parse(buildCreateServiceRequest('k', {
      ownerId: 'o', name: 'n', repoUrl: 'https://github.com/a/b', branch: '',
      commands: { buildCommand: 'npm install', startCommand: 'npm start' },
    }).body!);
    expect(body.branch).toBe('main');
  });
});

describe('parsers', () => {
  it('owner id and created service accept both wrapper shapes, and reject junk', () => {
    expect(parseRenderOwnerId({ owner: { id: 'own-1' } })).toBe('own-1');
    expect(parseRenderOwnerId({ id: 'own-2' })).toBe('own-2');
    for (const junk of [null, {}, { owner: {} }, { id: '  ' }, 5]) expect(parseRenderOwnerId(junk)).toBeNull();
    expect(parseCreatedService({ service: { id: 's1', name: 'x', serviceUrl: 'https://x.onrender.com' } }))
      .toEqual({ id: 's1', name: 'x', serviceUrl: 'https://x.onrender.com' });
    for (const junk of [null, {}, { id: '' }, 'nope']) expect(parseCreatedService(junk)).toBeNull();
  });
});

describe('createFailureMessage — a refusal a retry cannot fix becomes the step that fixes it', () => {
  it('🔒 no GitHub access names the one-time authorisation, with the repo', () => {
    // The single most likely refusal: Render can only build a repo its GitHub app can read, and the
    // raw 403 means nothing to a user.
    for (const status of [403, 404]) {
      const m = createFailureMessage(status, 'no access to repo', 'asheesh/mitrify');
      expect(m).toContain('asheesh/mitrify');
      expect(m).toContain('GitHub');
    }
    expect(createFailureMessage(400, { message: 'repo not found' }, 'a/b')).toContain('GitHub');
  });

  it('a bad key and a plan limit each get their own real answer', () => {
    expect(createFailureMessage(401, '', 'a/b')).toContain('RENDER_API_KEY');
    expect(createFailureMessage(402, '', 'a/b')).toMatch(/free service|upgrade/i);
  });

  it('anything else says nothing was created — never implies a half-made service', () => {
    expect(createFailureMessage(500, '', 'a/b')).toContain('Nothing was created');
  });
});

describe('createRenderService — honest at every branch, never throws', () => {
  const base = {
    apiKey: 'k', name: 'mitrify', repoUrl: 'https://github.com/a/mitrify', repoPath: 'a/mitrify',
    packageJson: JSON.stringify({ scripts: { start: 'node server.js', build: 'vite build' } }),
  };

  it('creates the service and returns it', async () => {
    const res = await createRenderService(base, (async (url: any) => (
      String(url).includes('/owners')
        ? okRes([{ owner: { id: 'own-1' } }])
        : okRes({ service: { id: 'srv-9', name: 'mitrify', serviceUrl: 'https://mitrify.onrender.com' } }, 201)
    )) as any);
    expect(res.ok).toBe(true);
    expect(res.ok && res.service.id).toBe('srv-9');
  });

  it('🔒 no start script ⇒ refuses BEFORE calling anything', async () => {
    let called = false;
    const res = await createRenderService({ ...base, packageJson: '{}' }, (async () => { called = true; return okRes({}); }) as any);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toBe('no-commands');
    expect(called).toBe(false);
  });

  it('🔒 a 2xx we cannot read is NOT a success', async () => {
    // Claiming one would leave the caller pointing a domain at a service whose address we never learned.
    const res = await createRenderService(base, (async (url: any) => (
      String(url).includes('/owners') ? okRes([{ id: 'own-1' }]) : okRes({ unexpected: true }, 201)
    )) as any);
    expect(res.ok).toBe(false);
  });

  it('a refusal carries the real next step, not the raw status', async () => {
    const res = await createRenderService(base, (async (url: any) => (
      String(url).includes('/owners') ? okRes([{ id: 'own-1' }]) : okRes('no repo access', 403)
    )) as any);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.message).toContain('GitHub');
    expect(!res.ok && res.message).toContain('a/mitrify');
  });

  it('never throws — a network failure is a reported reason', async () => {
    const res = await createRenderService(base, (async () => { throw new Error('offline'); }) as any);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.message).toContain('Nothing was created');
  });
});

describe('🔒 the wiring — creation replaces the hand-off, and nothing else', () => {
  const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
  const handler = (() => {
    const at = route.indexOf("app.post('/api/agentv3/deploy-backend'");
    return route.slice(at, route.indexOf('app.post(', at + 40));
  })();

  it('🔒 fires ONLY on no-service, and only with a repo', () => {
    // Creating a service in answer to a bad key or an API error would be guessing with the user's
    // own account, and would bury the message that actually explains the failure.
    expect(handler).toContain("if (!result.ok && result.reason === 'no-service' && repoUrl) {");
  });

  it('the start command comes from the app\'s own package.json', () => {
    expect(handler).toContain("loadWorkspaceFilesByPath(workspaceId, ['package.json'])");
    expect(handler).toContain('packageJson: pkgRaw');
  });

  it('🔒 a REFUSED creation leaves an honest failure, never a silent success', () => {
    expect(handler).toContain("result = { ok: false, reason: 'no-service', message: `${created.message}` };");
  });

  it('a created service is reported as deployed without triggering a second build', () => {
    // Render deploys a newly-created service by itself; triggering again would be a duplicate build
    // on the user's account.
    expect(handler).toContain('result = { ok: true, url: created.service.serviceUrl');
  });
});
