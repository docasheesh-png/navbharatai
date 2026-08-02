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
    expect(joined).toContain('Settings → Secrets & Keys'); // where to put it in NavBharatAI
    expect(inj.plan.tokenEnv).toBe('RENDER_API_KEY');
  });
  it('each host names its own token', () => {
    expect(buildBackendConfigInjection('gcloud', {})!.logLines.join(' ')).toContain('GCP_SERVICE_ACCOUNT_KEY');
    expect(buildBackendConfigInjection('railway', {})!.logLines.join(' ')).toContain('RAILWAY_TOKEN');
  });
});
