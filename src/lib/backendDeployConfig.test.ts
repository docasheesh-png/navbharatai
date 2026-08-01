import { describe, it, expect } from 'vitest';
import { backendDeployConfig, sanitizeServiceName, BACKEND_HOSTS, type BackendHost } from './backendDeployConfig';

describe('backendDeployConfig — real, host-specific config for a SEPARATE backend (BYO account/token)', () => {
  it('offers exactly the three supported hosts', () => {
    expect([...BACKEND_HOSTS]).toEqual(['cloud-run', 'render', 'railway']);
  });

  it('Cloud Run → a real Dockerfile that reads $PORT and runs the start command (exec form)', () => {
    const p = backendDeployConfig('cloud-run', { name: 'My API', startCommand: 'node server.js', nodeMajor: 20 });
    expect(p.files['Dockerfile']).toContain('FROM node:20-slim');
    expect(p.files['Dockerfile']).toContain('CMD ["node","server.js"]'); // exec form
    expect(p.files['Dockerfile']).toContain('PORT');
    expect(p.files['.dockerignore']).toContain('node_modules');
    expect(p.tokenEnv).toBe('GCP_SERVICE_ACCOUNT_KEY');
  });

  it('Cloud Run includes the build step only when the app has one', () => {
    expect(backendDeployConfig('cloud-run', { buildCommand: 'npm run build' }).files['Dockerfile']).toContain('RUN npm run build');
    expect(backendDeployConfig('cloud-run', {}).files['Dockerfile']).not.toContain('RUN npm run build');
  });

  it('Render → a render.yaml web service with the build + start commands', () => {
    const p = backendDeployConfig('render', { name: 'api', startCommand: 'npm start', buildCommand: 'npm run build', nodeMajor: 18 });
    expect(p.files['render.yaml']).toContain('type: web');
    expect(p.files['render.yaml']).toContain('startCommand: npm start');
    expect(p.files['render.yaml']).toContain('npm ci && npm run build');
    expect(p.files['render.yaml']).toContain('value: "18"');
    expect(p.tokenEnv).toBe('RENDER_API_KEY');
  });

  it('Railway → a valid railway.json with the start command', () => {
    const p = backendDeployConfig('railway', { startCommand: 'node dist/index.js' });
    const parsed = JSON.parse(p.files['railway.json']);
    expect(parsed.deploy.startCommand).toBe('node dist/index.js');
    expect(parsed.build.builder).toBe('NIXPACKS');
    expect(p.tokenEnv).toBe('RAILWAY_TOKEN');
  });

  it('every host is BYO-account: the steps deploy to the USER’s own account, never NavBharatAI', () => {
    for (const host of BACKEND_HOSTS) {
      const p = backendDeployConfig(host as BackendHost, { name: 'x' });
      const joined = p.steps.join(' ').toLowerCase();
      expect(joined).toContain('your'); // "YOUR account"
      expect(joined).toContain('github'); // push-to-GitHub path
      expect(p.portNote.toLowerCase()).toContain('process.env.port');
      expect(Object.keys(p.files).length).toBeGreaterThan(0);
    }
  });

  it('defaults are sane when app info is omitted (npm start, node 20)', () => {
    const p = backendDeployConfig('cloud-run');
    expect(p.files['Dockerfile']).toContain('FROM node:20-slim');
    expect(p.files['Dockerfile']).toContain('CMD ["npm","start"]');
  });

  it('sanitizeServiceName makes a safe host service name', () => {
    expect(sanitizeServiceName('My Cool App!!')).toBe('my-cool-app');
    expect(sanitizeServiceName('  ')).toBe('backend');
    expect(sanitizeServiceName(undefined)).toBe('backend');
    expect(sanitizeServiceName('__weird__--name__')).toBe('weird-name');
  });
});
