import { describe, it, expect } from 'vitest';
import { containsSymbol, scopeFilesForSymbol } from './codemodScope';
import { renameSymbol } from './CodemodeExecutor';

describe('containsSymbol', () => {
  it('matches a whole identifier token but not a substring of a larger identifier', () => {
    expect(containsSymbol('const x = User.name;', 'User')).toBe(true);
    expect(containsSymbol('import { UserProfile } from "./u";', 'User')).toBe(false); // not a substring match
    expect(containsSymbol('foo.User = 1;', 'User')).toBe(true); // property access is still a token
    expect(containsSymbol('', 'User')).toBe(false);
    expect(containsSymbol('anything', '')).toBe(false);
  });

  it('is safe with regex-special symbol characters and never throws', () => {
    expect(() => containsSymbol('a.b', '.')).not.toThrow();
    // @ts-expect-error — malformed input must not throw
    expect(() => containsSymbol(null, 'x')).not.toThrow();
  });
});

describe('scopeFilesForSymbol', () => {
  it('returns exactly the files that reference the symbol (a superset gate, no cap)', () => {
    const files = [
      { path: 'a.ts', content: 'export const User = 1;' },
      { path: 'b.ts', content: 'import { User } from "./a";' },
      { path: 'c.ts', content: 'const UserProfile = 2;' }, // does not reference `User` as a token
      { path: 'd.ts', content: 'nothing here' },
    ];
    expect(scopeFilesForSymbol(files, 'User').map((f) => f.path)).toEqual(['a.ts', 'b.ts']);
  });

  it('never throws on malformed input', () => {
    // @ts-expect-error — malformed input must not throw
    expect(() => scopeFilesForSymbol(null, 'x')).not.toThrow();
  });
});

describe('T3 headline regression — a repo-wide rename is COMPLETE past 50 files', () => {
  it('scopes and renames ALL 55 files that use the symbol (the old 50-cap dropped 5)', async () => {
    // 55 files use `oldFn`, plus 10 that do not — 65 total, well past the old 50 cap.
    const users = Array.from({ length: 55 }, (_, i) => ({ path: `use${i}.ts`, content: `import { oldFn } from './lib';\nexport const r${i} = oldFn(${i % 2});` }));
    const others = Array.from({ length: 10 }, (_, i) => ({ path: `other${i}.ts`, content: `export const z${i} = ${i};` }));
    const all = [{ path: 'lib.ts', content: 'export function oldFn(x: number) { return x + 1; }' }, ...users, ...others];

    // Scope first (the new pre-filter), then run the real AST codemod on the shortlist.
    const scoped = scopeFilesForSymbol(all, 'oldFn');
    expect(scoped.length).toBe(56); // lib.ts + 55 users, none of the 10 others

    const result = await renameSymbol(scoped, 'oldFn', 'newFn');
    expect(result.ok).toBe(true);
    // Every file that referenced oldFn is changed and now free of the old name.
    for (const { after } of result.changes) {
      expect(after).not.toMatch(/(?<![\w$])oldFn(?![\w$])/);
    }
    expect(result.changes.length).toBeGreaterThanOrEqual(56); // all relevant files, not capped at 50
  });
});
