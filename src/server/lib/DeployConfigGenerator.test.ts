import { describe, it, expect } from 'vitest';
import { generateDeployConfig, isDeployTarget } from './DeployConfigGenerator';

describe('generateDeployConfig', () => {
  it('emits the correct single platform file per target', () => {
    expect(Object.keys(generateDeployConfig('render').files)).toEqual(['render.yaml']);
    expect(Object.keys(generateDeployConfig('railway').files)).toEqual(['railway.json']);
    expect(Object.keys(generateDeployConfig('fly').files)).toEqual(['fly.toml']);
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
    for (const t of ['railway', 'render', 'fly'] as const) {
      const c = generateDeployConfig(t);
      expect(c.instructions).toContain('does not auto-deploy');
      expect(c.files[Object.keys(c.files)[0]]).not.toMatch(/TODO|FIXME/);
    }
  });

  it('isDeployTarget guards the input', () => {
    expect(isDeployTarget('railway')).toBe(true);
    expect(isDeployTarget('aws')).toBe(false);
    expect(isDeployTarget(null)).toBe(false);
  });
});
