import { describe, it, expect } from 'vitest';
import { generateDeployConfig, isDeployTarget } from './DeployConfigGenerator';

describe('generateDeployConfig', () => {
  it('emits the correct single platform file per target', () => {
    expect(Object.keys(generateDeployConfig('render').files)).toEqual(['render.yaml']);
    expect(Object.keys(generateDeployConfig('railway').files)).toEqual(['railway.json']);
    expect(Object.keys(generateDeployConfig('fly').files)).toEqual(['fly.toml']);
    expect(Object.keys(generateDeployConfig('aws').files)).toEqual(['apprunner.yaml']);
    expect(Object.keys(generateDeployConfig('azure').files)).toEqual(['azure.yaml']);
  });

  it('apprunner.yaml is a real App Runner config: version, node runtime, build+run commands, routed port', () => {
    const y = generateDeployConfig('aws').files['apprunner.yaml'];
    expect(y).toContain('version: 1.0');
    expect(y).toContain('runtime: nodejs18');
    expect(y).toContain('command: npm run start');
    expect(y).toContain('port: 8080');       // run.network.port — App Runner routes here
  });

  it('azure.yaml is a real azd manifest: named service, js language, container-app host', () => {
    const y = generateDeployConfig('azure').files['azure.yaml'];
    expect(y).toContain('name: app');
    expect(y).toContain('language: js');
    expect(y).toContain('host: containerapp');
    expect(y).toContain('azd up'); // the honest deploy command in the header comment
  });

  it('render.yaml is a real web-service blueprint binding to $PORT with a health check', () => {
    const y = generateDeployConfig('render').files['render.yaml'];
    expect(y).toContain('type: web');
    expect(y).toContain('startCommand: npm run start');
    expect(y).toContain('healthCheckPath: /health');
    expect(y).toContain('process.env.PORT');
  });

  it('railway.json is valid JSON with build + healthcheck + restart policy', () => {
    const j = generateDeployConfig('railway').files['railway.json'];
    const parsed = JSON.parse(j); // must be valid JSON
    expect(parsed.deploy.healthcheckPath).toBe('/health');
    expect(parsed.deploy.restartPolicyType).toBe('ON_FAILURE');
    expect(parsed.build.builder).toBe('NIXPACKS');
  });

  it('fly.toml has an http_service on an internal port with a health check', () => {
    const f = generateDeployConfig('fly').files['fly.toml'];
    expect(f).toContain('[http_service]');
    expect(f).toContain('internal_port');
    expect(f).toContain('force_https = true');
    expect(f).toContain('path = "/health"');
  });

  it('is honest — generates config, states it does not auto-deploy, no stubs', () => {
    for (const t of ['railway', 'render', 'fly', 'aws', 'azure'] as const) {
      const c = generateDeployConfig(t);
      expect(c.instructions).toContain('does not auto-deploy');
      expect(c.files[Object.keys(c.files)[0]]).not.toMatch(/TODO|FIXME/);
    }
  });

  it('isDeployTarget guards the input (now includes aws + azure)', () => {
    expect(isDeployTarget('railway')).toBe(true);
    expect(isDeployTarget('aws')).toBe(true);
    expect(isDeployTarget('azure')).toBe(true);
    expect(isDeployTarget('gcp')).toBe(false);
    expect(isDeployTarget(null)).toBe(false);
  });
});
