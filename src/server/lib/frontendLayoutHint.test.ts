import { describe, it, expect } from 'vitest';
import { frontendLayoutHint } from './frontendLayoutHint';

describe('frontendLayoutHint', () => {
  it('names the client/src root for a fullstack app (the real report case)', () => {
    const hint = frontendLayoutHint([
      'client/src/App.tsx',
      'client/src/index.css',
      'client/src/components/TodoList.tsx',
      'server/index.ts',
      'package.json',
    ]);
    expect(hint).toBeTruthy();
    expect(hint).toContain('client/src');
    expect(hint).toMatch(/NOT a top-level `src\/`/);
    expect(hint).toContain('server'); // notes the backend dir
  });

  it('returns null for an ordinary top-level src app (nothing to clarify)', () => {
    expect(frontendLayoutHint(['src/App.tsx', 'src/main.tsx', 'index.html', 'package.json'])).toBeNull();
  });

  it('handles other nested roots (frontend/src, apps/web/src)', () => {
    expect(frontendLayoutHint(['frontend/src/App.tsx'])).toContain('frontend/src');
    expect(frontendLayoutHint(['apps/web/src/main.tsx'])).toContain('apps/web/src');
  });

  it('ignores node_modules / dist and needs a real code file to detect a root', () => {
    expect(frontendLayoutHint(['node_modules/x/src/a.js', 'dist/src/b.js', 'README.md'])).toBeNull();
  });

  it('picks the root with the most frontend files when several exist', () => {
    const hint = frontendLayoutHint([
      'client/src/A.tsx', 'client/src/B.tsx', 'client/src/C.tsx',
      'packages/ui/src/D.tsx',
    ]);
    expect(hint).toContain('client/src');
  });

  it('is pure and safe on empty / junk input', () => {
    expect(frontendLayoutHint([])).toBeNull();
    expect(frontendLayoutHint(null as never)).toBeNull();
    expect(() => frontendLayoutHint(['', undefined as never, 'x'])).not.toThrow();
  });
});
