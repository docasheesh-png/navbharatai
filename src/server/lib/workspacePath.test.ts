import { describe, it, expect } from 'vitest';
import { toWorkspaceRelPath, toDurableFileKey, normalizeFileMapKeys, SANDBOX_WORKSPACE_ROOT } from './workspacePath';

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

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// THE PHANTOM FILE (admin report 2026-08-16, build 5b4f9b63).
//
// The fix above was applied to the four ACTUATORS and stopped there. The durable WorkspaceFileStore is
// the OTHER door into a project's file map and normalized nothing, so one absolute key —
// `/home/user/workspace/src/main.tsx` — became a file the analyzers believed in and the sandbox never
// had. The build reported "2 files each mount a React root" and «"./index.css" imported by 3 modules»
// on a project containing exactly one of each, spent ~8 of its 30 minutes hunting a file `find` could
// not see, and finished by telling the user it had removed a duplicate entry point that never existed.
describe('toDurableFileKey', () => {
  it('collapses the absolute in-workspace path that created the phantom', () => {
    expect(toDurableFileKey('/home/user/workspace/src/main.tsx')).toBe('src/main.tsx');
    expect(toDurableFileKey('/home/user/workspace/client/src/main.tsx')).toBe('client/src/main.tsx');
  });

  it('leaves an ordinary relative path exactly as it was', () => {
    expect(toDurableFileKey('client/src/main.tsx')).toBe('client/src/main.tsx');
    expect(toDurableFileKey('package.json')).toBe('package.json');
  });

  it('returns null instead of throwing when nothing usable remains (the store never throws)', () => {
    expect(toDurableFileKey('')).toBeNull();
    expect(toDurableFileKey('..')).toBeNull();
    expect(toDurableFileKey(SANDBOX_WORKSPACE_ROOT)).toBeNull();
  });

  it('does not mis-strip a directory that merely shares the root as a prefix', () => {
    expect(toDurableFileKey('/home/user/workspace-backup/a.ts')).toBe('home/user/workspace-backup/a.ts');
  });
});

describe('normalizeFileMapKeys', () => {
  it('makes the reported duplicate entry point disappear — one file, not two', () => {
    const stored = {
      'client/src/main.tsx': 'createRoot(document.getElementById("root")!).render(<App />);',
      '/home/user/workspace/client/src/main.tsx': 'createRoot(document.getElementById("root")!).render(<App />);',
    };
    const out = normalizeFileMapKeys(stored);
    expect(Object.keys(out.files)).toEqual(['client/src/main.tsx']);
    expect(out.collapsed).toBe(1);
  });

  it('counts the collapse whichever spelling arrived first', () => {
    const absoluteFirst = normalizeFileMapKeys({
      '/home/user/workspace/src/a.ts': 'x',
      'src/a.ts': 'x',
    });
    expect(Object.keys(absoluteFirst.files)).toEqual(['src/a.ts']);
    expect(absoluteFirst.collapsed).toBe(1);
  });

  it('reports an unusable key as dropped rather than storing it under a broken name', () => {
    const out = normalizeFileMapKeys({ '': 'x', '..': 'y', 'src/ok.ts': 'z' });
    expect(Object.keys(out.files)).toEqual(['src/ok.ts']);
    expect(out.dropped).toBe(2);
  });

  it('is a no-op on a clean map — a normal project is untouched and reports nothing', () => {
    const clean = { 'src/App.tsx': 'a', 'src/main.tsx': 'b', 'package.json': 'c' };
    const out = normalizeFileMapKeys(clean);
    expect(out.files).toEqual(clean);
    expect(out.collapsed).toBe(0);
    expect(out.dropped).toBe(0);
  });

  it('is idempotent — normalizing an already-normal map changes nothing', () => {
    const once = normalizeFileMapKeys({ '/home/user/workspace/src/a.ts': 'x' });
    const twice = normalizeFileMapKeys(once.files);
    expect(twice.files).toEqual(once.files);
    expect(twice.collapsed).toBe(0);
  });
});
