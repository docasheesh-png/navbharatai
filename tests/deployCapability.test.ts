import { describe, it, expect } from 'vitest';
import { deployCapability, sanitizeZipName, unavailableDeployMessage, isV5DeployProvider, V5_DEPLOY_PROVIDERS } from '../src/lib/deployCapability';

/** DevOps panel honesty: only github-push and static-zip are real; everything else is unavailable. */

describe('deployCapability', () => {
  it('maps github to a real push and static to a real zip', () => {
    expect(deployCapability('github')).toBe('github-push');
    expect(deployCapability('static')).toBe('static-zip');
  });
  it('treats every other (un-wired) platform as unavailable — never a faked deploy', () => {
    for (const id of ['firebase', 'vercel', 'netlify', 'cloudflare', 'gcloud', 'docker', 'render', 'railway', 'aws', 'supabase', 'surge', 'digitalocean', 'heroku', 'remote', '']) {
      expect(deployCapability(id)).toBe('unavailable');
    }
  });
});

describe('isV5DeployProvider', () => {
  it('is true for the 4 providers v5 can really build+deploy', () => {
    for (const id of ['firebase', 'vercel', 'netlify', 'cloudflare']) {
      expect(isV5DeployProvider(id)).toBe(true);
    }
    expect([...V5_DEPLOY_PROVIDERS].sort()).toEqual(['cloudflare', 'firebase', 'netlify', 'vercel']);
  });
  it('is false for platforms with no real provider yet (they stay honestly unavailable)', () => {
    for (const id of ['gcloud', 'docker', 'render', 'railway', 'aws', 'supabase', 'surge', 'digitalocean', 'heroku', 'remote', 'github', 'static', '']) {
      expect(isV5DeployProvider(id)).toBe(false);
    }
  });
});

describe('sanitizeZipName', () => {
  it('defaults, lowercases, strips unsafe chars and ensures .zip', () => {
    expect(sanitizeZipName(undefined)).toBe('navbharat-export.zip');
    expect(sanitizeZipName('My App!!')).toBe('my-app.zip');
    expect(sanitizeZipName('build.zip')).toBe('build.zip');
    expect(sanitizeZipName('   ')).toBe('navbharat-export.zip');
    expect(sanitizeZipName('a/b\\c')).toBe('a-b-c.zip');
  });
});

describe('unavailableDeployMessage', () => {
  it('is honest (no fake success) and names the platform + the real path', () => {
    const lines = unavailableDeployMessage('Vercel App');
    expect(lines.join('\n')).toContain("isn't available");
    expect(lines.join('\n')).toContain('Vercel App');
    expect(lines.join('\n')).toMatch(/GitHub/);
    expect(lines.some((l) => /SUCCESSFUL|deployed live/i.test(l))).toBe(false);
  });
});
