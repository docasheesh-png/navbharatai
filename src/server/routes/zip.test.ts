import { describe, it, expect } from 'vitest';
import { isTraversalPath } from './zip';

// SEC Phase 5 — the /api/extract-zip route must reject a path that escapes the extraction root at the
// SOURCE, so a hostile traversal path never reaches the client (defense-in-depth over downstream sinks).
describe('isTraversalPath — zip entry paths that escape the extraction root', () => {
  it('flags parent-dir traversal (the classic ../../etc/passwd)', () => {
    expect(isTraversalPath('../../etc/passwd')).toBe(true);
    expect(isTraversalPath('a/b/../../../secret')).toBe(true);
    expect(isTraversalPath('..\\..\\windows\\system32')).toBe(true); // backslash form normalised
  });
  it('flags absolute and drive paths', () => {
    expect(isTraversalPath('/etc/passwd')).toBe(true);
    expect(isTraversalPath('C:/Windows/System32')).toBe(true);
    expect(isTraversalPath('C:\\Windows')).toBe(true);
  });
  it('allows normal in-tree paths (never blocks a legit import)', () => {
    expect(isTraversalPath('src/App.tsx')).toBe(false);
    expect(isTraversalPath('package.json')).toBe(false);
    expect(isTraversalPath('a/b/c.ts')).toBe(false);
    // a filename that merely CONTAINS dots is fine — only a whole '..' segment is traversal:
    expect(isTraversalPath('src/..hidden/x.ts')).toBe(false);
    expect(isTraversalPath('src/file..name.ts')).toBe(false);
  });
});
