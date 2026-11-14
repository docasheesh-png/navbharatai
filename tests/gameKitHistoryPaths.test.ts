import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { posix } from 'node:path';

describe('game kit history paths', () => {
  it('is valid JavaScript before any historical source is loaded', () => {
    expect(() => execFileSync(process.execPath, ['--check', 'scripts/gameKitHistory.mjs'], { stdio: 'pipe' })).not.toThrow();
  });

  it.each([
    ['C:\\work space\\repo\\src\\server\\lib\\Game3DGenerator.ts', 'C:\\work space\\repo', 'src/server/lib'],
    ['/work space/repo/src/server/lib/Game3DGenerator.ts', '/work space/repo', 'src/server/lib'],
    ['src/server/lib/Game3DGenerator.ts', '/work/repo', 'src/server/lib'],
  ])('normalizes importer %s without corrupting its repository path', (importer, root, expected) => {
    const source = readFileSync('scripts/gameKitHistory.mjs', 'utf8');
    const fragment = source.slice(source.indexOf('const importerPosix ='), source.indexOf('const base = posix.normalize'));
    expect(fragment).toContain('const from =');
    const resolve = new Function('importer', 'ROOT', 'posix', `${fragment}; return from;`);
    expect(resolve(importer, root, posix)).toBe(expected);
  });
});
