import { describe, it, expect } from 'vitest';
import { parseGitHubRepo, resolveStorageTarget, WORK_BRANCH, type ResolveStorageTargetInput } from './GitStorageTarget';

describe('parseGitHubRepo', () => {
  it('parses a plain owner/repo URL', () => {
    expect(parseGitHubRepo('https://github.com/aashish/mitrify')).toEqual({ owner: 'aashish', repo: 'mitrify' });
  });
  it('strips a trailing .git and a trailing slash', () => {
    expect(parseGitHubRepo('https://github.com/aashish/mitrify.git')).toEqual({ owner: 'aashish', repo: 'mitrify' });
    expect(parseGitHubRepo('https://github.com/aashish/mitrify/')).toEqual({ owner: 'aashish', repo: 'mitrify' });
  });
  it('rejects non-github hosts, wrong scheme, ports, and non-two-segment paths', () => {
    expect(parseGitHubRepo('https://gitlab.com/a/b')).toBeNull();
    expect(parseGitHubRepo('http://github.com/a/b')).toBeNull();
    expect(parseGitHubRepo('https://github.com:22/a/b')).toBeNull();
    expect(parseGitHubRepo('https://github.com/onlyowner')).toBeNull();
    expect(parseGitHubRepo('https://github.com/a/b/c')).toBeNull();
  });
  it('rejects empty / non-string / malformed input and traversal segments', () => {
    expect(parseGitHubRepo('')).toBeNull();
    expect(parseGitHubRepo(null)).toBeNull();
    expect(parseGitHubRepo(undefined)).toBeNull();
    expect(parseGitHubRepo('not a url')).toBeNull();
    expect(parseGitHubRepo('https://github.com/../b')).toBeNull();
  });
});

describe('resolveStorageTarget', () => {
  const base: ResolveStorageTargetInput = {
    importUrl: 'https://github.com/aashish/mitrify',
    userLogin: 'aashish',
    hasWriteAccess: true,
    baseBranch: 'main',
    mirrorRepoName: 'app-uid1-sess1',
    ownRepoEnabled: true,
  };

  it('the happy path — own repo, signed in, write access, flag on → own-repo working branch', () => {
    const t = resolveStorageTarget(base);
    expect(t).toEqual({
      mode: 'own-repo', owner: 'aashish', repo: 'mitrify', workBranch: WORK_BRANCH, baseBranch: 'main',
    });
  });

  it('matches ownership case-insensitively and defaults an empty base branch to main', () => {
    const t = resolveStorageTarget({ ...base, userLogin: 'AAshish', baseBranch: '' });
    expect(t.mode).toBe('own-repo');
    if (t.mode === 'own-repo') expect(t.baseBranch).toBe('main');
  });

  it('falls back to the mirror when the flag is OFF (default-safe)', () => {
    expect(resolveStorageTarget({ ...base, ownRepoEnabled: false })).toEqual({ mode: 'mirror', repoName: 'app-uid1-sess1' });
  });

  it('falls back to the mirror without write access', () => {
    expect(resolveStorageTarget({ ...base, hasWriteAccess: false }).mode).toBe('mirror');
  });

  it("falls back to the mirror when the imported repo is NOT the user's own (owner !== login)", () => {
    // Someone else's repo — even with (mistaken) write access, we never target it in slice 1.
    expect(resolveStorageTarget({ ...base, importUrl: 'https://github.com/someoneelse/mitrify' }).mode).toBe('mirror');
  });

  it('falls back to the mirror when not signed in with GitHub (no login) or no import URL', () => {
    expect(resolveStorageTarget({ ...base, userLogin: null }).mode).toBe('mirror');
    expect(resolveStorageTarget({ ...base, userLogin: '' }).mode).toBe('mirror');
    expect(resolveStorageTarget({ ...base, importUrl: null }).mode).toBe('mirror');
    expect(resolveStorageTarget({ ...base, importUrl: 'not-a-github-url' }).mode).toBe('mirror');
  });

  it('the mirror fallback always carries the exact fallback repo name', () => {
    const t = resolveStorageTarget({ ...base, ownRepoEnabled: false });
    if (t.mode === 'mirror') expect(t.repoName).toBe('app-uid1-sess1');
  });
});
