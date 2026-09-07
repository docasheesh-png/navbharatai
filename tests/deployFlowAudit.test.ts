import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  planBackendEnv, backendEnvNote, referencedEnvNames, hasReadableCode, isPlatformControlKey, PLATFORM_CONTROL_ENV_KEYS,
} from '../src/server/AgentV3/backendEnvVars';
import { managedDeployOutcome } from '../src/lib/backendDeployWiring';

/**
 * THE DEPLOY-FLOW AUDIT, 0 → live (admin 2026-09-07: "ek bar wapas se pure deploy flow ka audit karo,
 * ek dam 0 se"). Four P0 defects, each found by reading the path end to end rather than from a report:
 *
 *   1. the split-app publish looked its backend up by a name no service ever has (`workspaceId`);
 *   2. EVERY vault key — the deploy key included — was forwarded into the deployed app's environment;
 *   3. a successful deploy pointed the user's domain at the backend even for a split app;
 *   4. every deploy failure was a 409, which the client reads as "connect your repo in Render".
 */
const src = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('🔴 2 — the deployed app receives only what its code reads, and never a deploy key', () => {
  const code = { 'server.js': 'connect(process.env.DATABASE_URL); pay(process.env.STRIPE_SECRET_KEY);' };

  it('🔒 THE LEAK: RENDER_API_KEY is never sent, even when the code reads it', () => {
    const plan = planBackendEnv(
      { RENDER_API_KEY: 'rnd_secret', STRIPE_SECRET_KEY: 'sk_live' },
      { 'server.js': 'process.env.RENDER_API_KEY; process.env.STRIPE_SECRET_KEY;' },
    );
    expect(plan.envVars.map((e) => e.key)).toEqual(['STRIPE_SECRET_KEY']);
    expect(plan.platformControl).toEqual(['RENDER_API_KEY']);
  });

  it('every deploy-provider token is a platform-control key, and the list matches the deploy config', () => {
    const cfg = src('src/lib/backendDeployConfig.ts');
    for (const name of ['RENDER_API_KEY', 'RAILWAY_TOKEN', 'GCP_SERVICE_ACCOUNT_KEY']) {
      expect(cfg, name).toContain(`tokenEnv: '${name}'`);
      expect(isPlatformControlKey(name), name).toBe(true);
    }
    expect(PLATFORM_CONTROL_ENV_KEYS.length).toBeGreaterThanOrEqual(8);
    expect(isPlatformControlKey('stripe_secret_key')).toBe(false);
  });

  it('🔒 a key nothing in the code reads is withheld and named — an app gets what it uses, not the whole vault', () => {
    const plan = planBackendEnv({ STRIPE_SECRET_KEY: 'sk', GITHUB_TOKEN: 'gh', DATABASE_URL: 'postgres://u:p@db.host/x' }, code);
    expect(plan.envVars.map((e) => e.key)).toEqual(['DATABASE_URL', 'STRIPE_SECRET_KEY']);
    expect(plan.unreferenced).toEqual(['GITHUB_TOKEN']);
  });

  it('Python reads count too — os.environ[...], .get(...) and os.getenv(...)', () => {
    const py = {
      'app.py': 'import os\nDB = os.environ["DATABASE_URL"]\nK = os.environ.get("STRIPE_KEY")\nS = os.getenv("SENTRY_DSN")',
    };
    expect(referencedEnvNames(py)).toEqual(['DATABASE_URL', 'SENTRY_DSN', 'STRIPE_KEY']);
    const plan = planBackendEnv({ STRIPE_KEY: 'x', OTHER: 'y' }, py);
    expect(plan.envVars.map((e) => e.key)).toEqual(['STRIPE_KEY']);
    expect(plan.unreferenced).toEqual(['OTHER']);
  });

  it('🔒 unreadable code sends NOTHING and SAYS so — never everything, never silently nothing', () => {
    expect(hasReadableCode({})).toBe(false);
    expect(hasReadableCode({ 'README.md': 'x' })).toBe(false);
    expect(hasReadableCode({ 'server.js': 'x' })).toBe(true);
    const plan = planBackendEnv({ STRIPE_SECRET_KEY: 'sk' }, {});
    expect(plan.envVars).toEqual([]);
    expect(plan.codeUnreadable).toBe(true);
    expect(plan.unreferenced).toEqual(['STRIPE_SECRET_KEY']);
    expect(backendEnvNote(plan)).toMatch(/could not read your app's code/i);
    expect(backendEnvNote(plan)).not.toMatch(/will fail/i);
  });

  it('the ordinary case is unchanged: real keys the code reads travel, sandbox addresses are withheld', () => {
    const plan = planBackendEnv({ DATABASE_URL: 'postgres://u:p@localhost:5432/app', STRIPE_SECRET_KEY: 'sk' }, code);
    expect(plan.envVars).toEqual([{ key: 'STRIPE_SECRET_KEY', value: 'sk' }]);
    expect(plan.sandboxOnly).toEqual(['DATABASE_URL']);
    expect(plan.missing).toEqual(['DATABASE_URL']);
    expect(plan.codeUnreadable).toBe(false);
  });
});

describe('🔴 4 — one status per reason, and the client answers the reason it was given', () => {
  it('🔒 a refused creation gets its own kind, with the server\'s real step and NO Blueprint walkthrough', () => {
    const o = managedDeployOutcome(422, { ok: false, reason: 'create-refused', message: 'No start script in package.json.' });
    expect(o.kind).toBe('create-refused');
    expect(o.lines.join(' ')).toContain('No start script');
    expect(o.lines.join(' ')).not.toMatch(/Blueprint/);
  });

  it('🔒 an API error is a failure even if an older server sent it as 409', () => {
    const o = managedDeployOutcome(409, { ok: false, reason: 'api-error', error: 'Render API returned 401 while listing services.' });
    expect(o.kind).toBe('failed');
    expect(o.lines.join(' ')).not.toMatch(/Blueprint|repo connected/);
  });

  it('a genuine no-service still gets the connect walkthrough', () => {
    expect(managedDeployOutcome(409, { ok: false, reason: 'no-service', error: 'x' }).kind).toBe('needs-connect');
  });

  it('the route maps every reason to its own status', () => {
    const route = src('src/server/routes/agentv3.ts');
    const at = route.indexOf("app.post('/api/agentv3/deploy-backend'");
    const handler = route.slice(at, route.indexOf('app.post(', at + 40));
    expect(handler).toContain("result.reason === 'no-service' ? 409");
    expect(handler).toContain("result.reason === 'not-configured' ? 503");
    expect(handler).toContain("result.reason === 'create-refused' ? 422");
    expect(handler).not.toContain('res.status(result.ok ? 200 : 409)');
  });
});

describe('🔴 1 & 3 — the wiring in the routes', () => {
  const route = src('src/server/routes/agentv3.ts');
  const deploy = (() => {
    const at = route.indexOf("app.post('/api/agentv3/deploy-backend'");
    return route.slice(at, route.indexOf('app.post(', at + 40));
  })();
  const publish = (() => {
    const at = route.indexOf("app.post('/api/agentv3/publish'");
    return route.slice(at, route.indexOf("app.get('/api/agentv3/deploy-providers'", at));
  })();

  it('🔒 1: the split publish looks the backend up by REPOSITORY from the durable record — never by workspaceId', () => {
    expect(publish).toContain('const splitRepo = resolveDeployRepo(undefined, durableRepoRec);');
    expect(publish).toContain('apiKey: key.key, repoUrl: splitRepo?.repoUrl, appName: durableRepoRec?.repoName || undefined,');
    expect(publish).not.toContain('appName: workspaceId');
    // The durable record is read ONCE and serves both the lookup and the refusal wording.
    expect(publish.split('getConversationStore().get(workspaceId)').length - 1).toBe(1);
  });

  it('🔒 3: the domain follows the backend ONLY for an app shipped whole', () => {
    const gate = deploy.indexOf("if (domain && wiring.strategy === 'split') {");
    const attach = deploy.indexOf('attachRenderCustomDomain({', gate);
    expect(gate).toBeGreaterThan(-1);
    expect(attach).toBeGreaterThan(gate);   // the split branch answers BEFORE any DNS write
    expect(deploy).toContain('stays on your website');
  });

  it('the files are read once and the same wiring verdict serves env, creation and the domain', () => {
    expect(deploy).toContain('const appFiles = await loadWorkspaceFiles(workspaceId)');
    expect(deploy).toContain('const wiring = analyzeApiWiring(appFiles);');
    expect(deploy).toContain('buildEnvForWhole(wiring)');
    expect(deploy.split('loadWorkspaceFiles(workspaceId)').length - 1).toBe(1);
  });
});
