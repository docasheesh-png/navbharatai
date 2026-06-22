import { describe, it, expect } from 'vitest';
import { validateDeployInput, buildDeployBody, type DeployInput } from '../src/lib/deployRequest';

function input(overrides: Partial<DeployInput> = {}): DeployInput {
  return {
    platform: 'vercel',
    token: 'tok_123',
    projectName: 'my-app',
    owner: '',
    repo: '',
    hasFiles: true,
    ...overrides,
  };
}

describe('validateDeployInput', () => {
  it('returns error when there are no files', () => {
    expect(validateDeployInput(input({ hasFiles: false }))).toMatch(/no files/i);
  });

  it('returns error when token is blank', () => {
    expect(validateDeployInput(input({ token: '   ' }))).toMatch(/api token/i);
  });

  it('vercel requires a project name', () => {
    expect(validateDeployInput(input({ platform: 'vercel', projectName: '' }))).toMatch(/project name/i);
  });

  it('github requires owner and repo', () => {
    expect(validateDeployInput(input({ platform: 'github', owner: 'me', repo: '' }))).toMatch(/owner and repo/i);
    expect(validateDeployInput(input({ platform: 'github', owner: '', repo: 'r' }))).toMatch(/owner and repo/i);
  });

  it('cloudflare requires account id and project name', () => {
    expect(validateDeployInput(input({ platform: 'cloudflare', owner: '', projectName: 'p' }))).toMatch(/account id/i);
    expect(validateDeployInput(input({ platform: 'cloudflare', owner: 'acct', projectName: '' }))).toMatch(/account id/i);
  });

  it('returns null for a valid vercel input', () => {
    expect(validateDeployInput(input())).toBeNull();
  });

  it('returns null for a valid github input', () => {
    expect(validateDeployInput(input({ platform: 'github', owner: 'me', repo: 'app' }))).toBeNull();
  });

  it('netlify only needs token + files (no project-name requirement)', () => {
    expect(validateDeployInput(input({ platform: 'netlify', projectName: '' }))).toBeNull();
  });
});

describe('buildDeployBody', () => {
  const files = { 'index.html': '<h1>Hi</h1>' };

  it('vercel body uses name', () => {
    const body = buildDeployBody('vercel', 'tok', files, { projectName: 'site', owner: '', repo: '' });
    expect(body).toMatchObject({ provider: 'vercel', token: 'tok', name: 'site' });
    expect(body.files).toBe(files);
  });

  it('netlify body uses siteId', () => {
    const body = buildDeployBody('netlify', 'tok', files, { projectName: 'siteABC', owner: '', repo: '' });
    expect(body.siteId).toBe('siteABC');
  });

  it('github body uses owner + repo', () => {
    const body = buildDeployBody('github', 'tok', files, { projectName: '', owner: ' me ', repo: ' app ' });
    expect(body.owner).toBe('me');
    expect(body.repo).toBe('app');
  });

  it('cloudflare body uses accountId + name', () => {
    const body = buildDeployBody('cloudflare', 'tok', files, { projectName: 'cfapp', owner: 'acct123', repo: '' });
    expect(body.accountId).toBe('acct123');
    expect(body.name).toBe('cfapp');
  });

  it('always includes provider, token and files', () => {
    const body = buildDeployBody('vercel', 'mytok', files, { projectName: 'x', owner: '', repo: '' });
    expect(body.provider).toBe('vercel');
    expect(body.token).toBe('mytok');
    expect(body.files).toBe(files);
  });
});
