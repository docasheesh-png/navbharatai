import { describe, it, expect } from 'vitest';
import { toWorkspaceRelPath } from './workspacePath';

const E2B_ROOT = '/home/user/workspace';
const DOCKER_ROOT = '/workspace';

describe('toWorkspaceRelPath — the doubled-path root-cause fix', () => {
  it('keeps a plain relative path unchanged', () => {
    expect(toWorkspaceRelPath('src/App.tsx', E2B_ROOT)).toBe('src/App.tsx');
    expect(toWorkspaceRelPath('package.json', E2B_ROOT)).toBe('package.json');
  });

  it('strips an absolute in-workspace path to relative (THE diagnostics failure case)', () => {
    // Before the fix this produced /home/user/workspace/home/user/workspace/src/types/note.ts
    expect(toWorkspaceRelPath('/home/user/workspace/src/types/note.ts', E2B_ROOT)).toBe('src/types/note.ts');
    expect(toWorkspaceRelPath('/home/user/workspace/vite.config.ts', E2B_ROOT)).toBe('vite.config.ts');
    expect(toWorkspaceRelPath('/workspace/src/App.tsx', DOCKER_ROOT)).toBe('src/App.tsx');
  });

  it('does NOT mis-strip a sibling directory that merely shares the root as a prefix', () => {
    // "/home/user/workspace-other" must not be treated as inside "/home/user/workspace".
    expect(toWorkspaceRelPath('/home/user/workspace-other/file.ts', E2B_ROOT)).toBe('home/user/workspace-other/file.ts');
  });

  it('never lets traversal escape the root', () => {
    expect(toWorkspaceRelPath('../../etc/passwd', E2B_ROOT)).toBe('etc/passwd');
    expect(toWorkspaceRelPath('src/../../secret.txt', E2B_ROOT)).toBe('src/secret.txt');
    expect(toWorkspaceRelPath('/home/user/workspace/../outside.txt', E2B_ROOT)).toBe('outside.txt');
  });

  it('normalizes windows separators and leading slashes', () => {
    expect(toWorkspaceRelPath('src\\components\\App.tsx', E2B_ROOT)).toBe('src/components/App.tsx');
    expect(toWorkspaceRelPath('/src/App.tsx', E2B_ROOT)).toBe('src/App.tsx');
  });

  it('throws when nothing usable remains (empty, dot-only, or exactly the root)', () => {
    expect(() => toWorkspaceRelPath('', E2B_ROOT)).toThrow(/Unsafe workspace path/);
    expect(() => toWorkspaceRelPath('.', E2B_ROOT)).toThrow(/Unsafe workspace path/);
    expect(() => toWorkspaceRelPath('..', E2B_ROOT)).toThrow(/Unsafe workspace path/);
    expect(() => toWorkspaceRelPath('/home/user/workspace', E2B_ROOT)).toThrow(/Unsafe workspace path/);
    expect(() => toWorkspaceRelPath('/home/user/workspace/', E2B_ROOT)).toThrow(/Unsafe workspace path/);
  });

  it('tolerates a root passed with a trailing slash', () => {
    expect(toWorkspaceRelPath('/home/user/workspace/src/a.ts', '/home/user/workspace/')).toBe('src/a.ts');
  });
});
