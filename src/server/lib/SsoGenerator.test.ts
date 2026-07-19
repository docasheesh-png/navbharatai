import { describe, it, expect } from 'vitest';
import { generateSsoIntegration } from './SsoGenerator';

describe('generateSsoIntegration', () => {
  it('emits an OIDC lib + routes + a blank .env.example, and declares its deps + env keys', () => {
    const out = generateSsoIntegration();
    expect(Object.keys(out.files).sort()).toEqual(['.env.example', 'server/lib/sso.ts', 'server/routes/sso.routes.ts']);
    expect(out.envKeys).toEqual(['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_REDIRECT_URI']);
    expect(out.dependencies.map((d) => d.name).sort()).toEqual(['express-session', 'openid-client']);
  });

  it('discovers the provider from the issuer and uses the authorization-code flow', () => {
    const lib = generateSsoIntegration().files['server/lib/sso.ts'];
    expect(lib).toContain('Issuer.discover(process.env.OIDC_ISSUER');
    expect(lib).toContain("response_types: ['code']");
  });

  it('verifies state + nonce on the callback (CSRF + replay protection)', () => {
    const routes = generateSsoIntegration().files['server/routes/sso.routes.ts'];
    expect(routes).toContain('generators.state()');
    expect(routes).toContain('generators.nonce()');
    expect(routes).toContain('state: saved.state');
    expect(routes).toContain('nonce: saved.nonce');
    expect(routes).toContain("scope: 'openid email profile'");
  });

  it('the .env.example is blank (never leaks a secret)', () => {
    const env = generateSsoIntegration().files['.env.example'];
    expect(env).toContain('OIDC_CLIENT_SECRET=\n');
    expect(env).not.toMatch(/OIDC_CLIENT_SECRET=.+/);
  });
});
