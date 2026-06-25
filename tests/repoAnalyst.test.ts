import { describe, it, expect } from 'vitest';
import { parseRepoRef } from '../src/server/repoAnalyst/githubFetch';
import { buildRepoContext, findRepoRef } from '../src/server/repoAnalyst/analyst';
import { parseGeneratedFiles } from '../src/server/repoAnalyst/generate';
import type { RepoSnapshot } from '../src/server/repoAnalyst/githubFetch';

describe('parseRepoRef', () => {
  it('parses a full https github URL', () => {
    expect(parseRepoRef('https://github.com/facebook/react')).toEqual({ owner: 'facebook', repo: 'react' });
  });
  it('parses a URL with .git suffix', () => {
    expect(parseRepoRef('https://github.com/vuejs/core.git')).toEqual({ owner: 'vuejs', repo: 'core' });
  });
  it('parses a URL embedded in a sentence', () => {
    expect(parseRepoRef('please analyse https://github.com/torvalds/linux for me'))
      .toEqual({ owner: 'torvalds', repo: 'linux' });
  });
  it('parses a URL with a branch/path suffix to the repo only', () => {
    expect(parseRepoRef('https://github.com/expressjs/express/tree/master/lib'))
      .toEqual({ owner: 'expressjs', repo: 'express' });
  });
  it('parses bare owner/repo', () => {
    expect(parseRepoRef('analyse microsoft/vscode')).toEqual({ owner: 'microsoft', repo: 'vscode' });
  });
  it('parses www. prefix without scheme', () => {
    expect(parseRepoRef('www.github.com/nodejs/node')).toEqual({ owner: 'nodejs', repo: 'node' });
  });
  it('returns null when there is no repo reference', () => {
    expect(parseRepoRef('how does this tool work?')).toBeNull();
    expect(parseRepoRef('')).toBeNull();
    expect(parseRepoRef('just some text with no slash')).toBeNull();
  });
  it('does not mistake a multi-segment path for a repo', () => {
    // a/b/c has extra path segments → not a bare repo ref
    expect(parseRepoRef('the file lives at src/server/index')).toBeNull();
  });
});

describe('findRepoRef', () => {
  it('finds a repo in the current message first', () => {
    expect(findRepoRef('analyse owner/repo', [])).toEqual({ owner: 'owner', repo: 'repo' });
  });
  it('falls back to the most recent user message in history', () => {
    const history = [
      { role: 'user' as const, content: 'look at github.com/a/b' },
      { role: 'assistant' as const, content: 'sure, here is the analysis...' },
    ];
    expect(findRepoRef('what about the security?', history)).toEqual({ owner: 'a', repo: 'b' });
  });
  it('returns null when neither message nor history has a repo', () => {
    expect(findRepoRef('hello', [{ role: 'user', content: 'hi there' }])).toBeNull();
  });
});

describe('buildRepoContext', () => {
  const snap: RepoSnapshot = {
    ref: { owner: 'acme', repo: 'widget' },
    url: 'https://github.com/acme/widget',
    description: 'A widget library',
    defaultBranch: 'main',
    stars: 42,
    forks: 7,
    openIssues: 3,
    license: 'MIT',
    primaryLanguage: 'TypeScript',
    languages: ['TypeScript', 'CSS'],
    topics: ['ui', 'widgets'],
    pushedAt: '2026-01-01T00:00:00Z',
    archived: false,
    readme: '# Widget\nDoes widget things.',
    tree: ['src/index.ts', 'package.json', 'README.md'],
    treeTruncated: false,
    keyFiles: [{ path: 'package.json', content: '{"name":"widget"}' }],
    notes: [],
  };

  it('includes repo identity, license and language', () => {
    const ctx = buildRepoContext(snap);
    expect(ctx).toContain('acme/widget');
    expect(ctx).toContain('License: MIT');
    expect(ctx).toContain('TypeScript');
  });
  it('includes the file tree, readme and key file contents', () => {
    const ctx = buildRepoContext(snap);
    expect(ctx).toContain('src/index.ts');
    expect(ctx).toContain('Does widget things.');
    expect(ctx).toContain('{"name":"widget"}');
  });
  it('flags missing license honestly when none detected', () => {
    const ctx = buildRepoContext({ ...snap, license: null });
    expect(ctx.toLowerCase()).toContain('none detected');
  });
});

describe('parseGeneratedFiles', () => {
  it('parses a summary and multiple files', () => {
    const out = parseGeneratedFiles([
      "Here are improvements for your fork.",
      "Two files added.",
      "=== FILE: README.md ===",
      "# Project",
      "Docs here.",
      "=== END FILE ===",
      "=== FILE: .github/workflows/ci.yml ===",
      "name: CI",
      "on: [push]",
      "=== END FILE ===",
    ].join('\n'));
    expect(out.summary).toContain('improvements');
    expect(out.files).toHaveLength(2);
    expect(out.files[0].path).toBe('README.md');
    expect(out.files[0].content).toContain('# Project');
    expect(out.files[1].path).toBe('.github/workflows/ci.yml');
    expect(out.files[1].content).toContain('name: CI');
  });

  it('sanitizes unsafe/absolute/traversal paths to safe relative ones', () => {
    const out = parseGeneratedFiles('=== FILE: /etc/../../secret.txt ===\nhello\n=== END FILE ===');
    expect(out.files).toHaveLength(1);
    expect(out.files[0].path).not.toContain('..');
    expect(out.files[0].path.startsWith('/')).toBe(false);
    expect(out.files[0].path).toBe('etc/secret.txt');
  });

  it('unwraps a single surrounding code fence', () => {
    const out = parseGeneratedFiles('=== FILE: a.js ===\n```js\nconst a = 1;\n```\n=== END FILE ===');
    expect(out.files[0].content.trim()).toBe('const a = 1;');
  });

  it('returns no files when there are no file blocks', () => {
    const out = parseGeneratedFiles('Just some prose with no file blocks.');
    expect(out.files).toHaveLength(0);
    expect(out.summary).toContain('prose');
  });
});
