import { describe, it, expect } from 'vitest';
import { gitPanelBackendHost, isBackendDeployHost, parseBackendAppInfo, buildBackendConfigInjection } from './backendDeployWiring';

describe('backendDeployWiring — glue between the deploy panel and the config generator', () => {
  it('maps the panel platform ids to backend hosts (and rejects non-backend ids)', () => {
    expect(gitPanelBackendHost('gcloud')).toBe('cloud-run');
    expect(gitPanelBackendHost('render')).toBe('render');
    expect(gitPanelBackendHost('railway')).toBe('railway');
    expect(gitPanelBackendHost('github')).toBeNull();
    expect(gitPanelBackendHost('vercel')).toBeNull();
    expect(isBackendDeployHost('render')).toBe(true);
    expect(isBackendDeployHost('static')).toBe(false);
  });

  it('parses backend app info from package.json (name, start/build, node)', () => {
    const files = {
      'package.json': JSON.stringify({
        name: 'my-api', scripts: { start: 'node server.js', build: 'tsc' }, engines: { node: '>=18' },
      }),
    };
    const info = parseBackendAppInfo(files);
    expect(info.name).toBe('my-api');
    expect(info.startCommand).toBe('npm start');
    expect(info.buildCommand).toBe('npm run build');
    expect(info.nodeMajor).toBe(18);
  });

  it('parseBackendAppInfo is safe on missing/broken package.json', () => {
    expect(parseBackendAppInfo({})).toEqual({});
    expect(parseBackendAppInfo({ 'package.json': '{ not json' })).toEqual({});
    expect(parseBackendAppInfo({ 'package.json': '{}' })).toEqual({});
  });

  it('buildBackendConfigInjection adds the real config files WITHOUT touching existing files', () => {
    const files = { 'server.js': 'x', 'package.json': '{"name":"api","scripts":{"start":"node server.js"}}' };
    const inj = buildBackendConfigInjection('gcloud', files)!;
    expect(inj).not.toBeNull();
    // existing files preserved
    expect(inj.nextFiles['server.js']).toBe('x');
    expect(inj.nextFiles['package.json']).toBe(files['package.json']);
    // real config added
    expect(inj.nextFiles['Dockerfile']).toContain('FROM node:');
    expect(inj.nextFiles['.dockerignore']).toBeDefined();
    expect(inj.plan.tokenEnv).toBe('GCP_SERVICE_ACCOUNT_KEY');
  });

  it('the injection logs are HONEST — deploy-ready, BYO account, never a fake deploy', () => {
    const inj = buildBackendConfigInjection('render', { 'package.json': '{"name":"api"}' })!;
    const joined = inj.logLines.join('\n').toLowerCase();
    expect(joined).toContain('deploy-ready');
    expect(joined).toContain("don't fake");
    expect(joined).toContain('your render account');
    expect(joined).not.toContain('deployed successfully'); // never claims a deploy happened
  });

  it('returns null for a non-backend platform (frontend deploy flow is untouched)', () => {
    expect(buildBackendConfigInjection('vercel', {})).toBeNull();
    expect(buildBackendConfigInjection('github', {})).toBeNull();
  });
});

describe('backendDeployWiring — BYO-token setup is surfaced (slice 3 groundwork for real deploy)', () => {
  it('the injection tells the user exactly which token to set and where (Settings → Secrets)', () => {
    const inj = buildBackendConfigInjection('render', { 'package.json': '{"name":"api"}' })!;
    const joined = inj.logLines.join('\n');
    expect(joined).toContain('RENDER_API_KEY');           // the exact BYO token env
    expect(joined).toContain('Settings → Secrets & API Keys'); // where to put it in NavBharatAI
    expect(inj.plan.tokenEnv).toBe('RENDER_API_KEY');
  });
  it('each host names its own token', () => {
    expect(buildBackendConfigInjection('gcloud', {})!.logLines.join(' ')).toContain('GCP_SERVICE_ACCOUNT_KEY');
    expect(buildBackendConfigInjection('railway', {})!.logLines.join(' ')).toContain('RAILWAY_TOKEN');
  });
});

/**
 * THE HALF THAT EXISTED AND COULD NOT BE REACHED (verified 2026-08-07).
 *
 * `renderDeploy.ts` really deploys a backend, `POST /api/agentv3/deploy-backend` really exposes it, and
 * the admin really set RENDER_API_KEY in Cloud Run on 2026-08-02. But a repo-wide grep for
 * 'deploy-backend' found the route definition and NO CALLER — so every user was told "config added, now
 * go deploy it yourself" while the button that could do it for them did not exist. The injection text
 * even promised it was "coming next", after it had shipped.
 *
 * A real capability with no way to reach it is the same rule-2 failure as a button that does nothing.
 */
import { canOfferManagedDeploy, managedDeployRequest, managedDeployOutcome } from './backendDeployWiring';

describe('canOfferManagedDeploy — only where an engine really exists', () => {
  it('offers Render, because Render is the one with a real server-side deploy engine', () => {
    expect(canOfferManagedDeploy('render')).toBe(true);
  });

  it('does NOT offer Cloud Run or Railway — they have config generators, not engines', () => {
    // A button we cannot honour would be worse than the honest steps those hosts get today.
    expect(canOfferManagedDeploy('gcloud')).toBe(false);
    expect(canOfferManagedDeploy('railway')).toBe(false);
    expect(canOfferManagedDeploy('vercel')).toBe(false);
  });
});

describe('managedDeployRequest — refuses to send a call the user could not act on', () => {
  const files = { 'package.json': '{"name":"my-api"}' };

  it('builds the repo URL Render matches services by, and carries the app name', () => {
    const r = managedDeployRequest('render', { repoPath: 'docasheesh-png/my-api', files, workspaceId: 'ws1' })!;
    expect(r.repoUrl).toBe('https://github.com/docasheesh-png/my-api');
    expect(r.appName).toBe('my-api');
    expect(r.platform).toBe('render');
    expect(r.workspaceId).toBe('ws1');
  });

  it('a malformed repo path yields NULL, not a call that comes back unactionable', () => {
    // "No matching service" for a repo we never sent correctly is a dead end for the user.
    for (const bad of ['', 'no-slash', '/leading', 'trailing/', 'a/b/c', 'own er/repo']) {
      expect(managedDeployRequest('render', { repoPath: bad, files, workspaceId: 'ws1' })).toBeNull();
    }
  });

  it('a missing workspaceId yields NULL — the route rejects it anyway, so do not ask', () => {
    expect(managedDeployRequest('render', { repoPath: 'a/b', files, workspaceId: '' })).toBeNull();
  });

  it('a host with no engine yields NULL however good the inputs are', () => {
    expect(managedDeployRequest('railway', { repoPath: 'a/b', files, workspaceId: 'ws1' })).toBeNull();
  });

  it('omits appName rather than inventing one when package.json has no name', () => {
    const r = managedDeployRequest('render', { repoPath: 'a/b', files: {}, workspaceId: 'ws1' })!;
    expect(r.appName).toBeUndefined();
  });
});

describe('managedDeployOutcome — four outcomes, four different next actions', () => {
  it('a real deploy reports the real URL and says the build is still running', () => {
    const o = managedDeployOutcome(200, { ok: true, url: 'https://my-api.onrender.com', serviceName: 'my-api' });
    expect(o.kind).toBe('deployed');
    expect(o.lines.join(' ')).toContain('https://my-api.onrender.com');
    // "Triggered" is the truth; the URL is not live until Render finishes building.
    expect(o.lines.join(' ').toLowerCase()).toContain('building it now');
  });

  it('a missing server key is NOT presented as the user\'s mistake', () => {
    const o = managedDeployOutcome(503, { ok: false, reason: 'not-configured', error: 'Set RENDER_API_KEY …' });
    expect(o.kind).toBe('not-configured');
    expect(o.lines.join(' ')).toContain('Set RENDER_API_KEY');
  });

  it('an unconnected repo gets the ONE step only the user can do — passed through verbatim', () => {
    const msg = 'No matching Render service found yet. One-time step: in Render → New → Blueprint, pick your repo';
    const o = managedDeployOutcome(409, { ok: false, reason: 'no-service', error: msg });
    expect(o.kind).toBe('needs-connect');
    expect(o.lines.join(' ')).toContain('New → Blueprint');
  });

  it('a failure says it failed — never a silent no-op and never a fake success', () => {
    const o = managedDeployOutcome(502, { ok: false, reason: 'api-error', error: 'Render API returned 401' });
    expect(o.kind).toBe('failed');
    expect(o.lines.join(' ')).toContain('Render API returned 401');
  });

  it('an empty or unparseable body still produces an honest line, never a claim of success', () => {
    for (const o of [managedDeployOutcome(500, null), managedDeployOutcome(200, { ok: true })]) {
      expect(o.kind).not.toBe('deployed');
      expect(o.lines.join(' ').toLowerCase()).not.toContain('deploy triggered');
    }
  });
});

describe('The injection text no longer promises a feature that already shipped', () => {
  it('Render is told NavBharatAI can trigger it — because it can', () => {
    const inj = buildBackendConfigInjection('render', { 'package.json': '{"name":"api"}' })!;
    const joined = inj.logLines.join('\n');
    expect(joined).toContain('NavBharatAI can trigger the deploy for you');
    expect(joined).not.toContain('coming next');
  });

  it('a host with no engine is still told the truth — YOU deploy it', () => {
    const inj = buildBackendConfigInjection('railway', { 'package.json': '{"name":"api"}' })!;
    const joined = inj.logLines.join('\n');
    expect(joined).toContain('cannot trigger');
    expect(joined).not.toContain('NavBharatAI can trigger the deploy for you');
  });
});
