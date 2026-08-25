import { describe, it, expect } from 'vitest';
import {
  findMissingImportedAssets, importSpecifiers, assetBasename, missingAssetUserMessage,
} from './missingAssetCheck';

describe('importSpecifiers', () => {
  it('finds the three forms a bundler resolves', () => {
    const src = `
      import logo from './logo.png';
      import '@assets/hero.jpg';
      const x = require('../img/icon.svg');
    `;
    expect(importSpecifiers(src)).toEqual(expect.arrayContaining(['./logo.png', '@assets/hero.jpg', '../img/icon.svg']));
  });

  it('is empty for a file with no imports', () => {
    expect(importSpecifiers('const a = 1;')).toEqual([]);
    expect(importSpecifiers('')).toEqual([]);
  });
});

describe('assetBasename', () => {
  it('strips directories and bundler suffixes', () => {
    expect(assetBasename('@assets/a/b/hero.png?url')).toBe('hero.png');
    expect(assetBasename('./logo.svg#icon')).toBe('logo.svg');
    expect(assetBasename('logo.png')).toBe('logo.png');
  });
});

describe('findMissingImportedAssets — THE REPORTED CASE', () => {
  it('catches the exact failure the admin hit: a screenshot imported but not stored', () => {
    // "Could not load …/attached_assets/772B17C5-….png (imported by client/src/pages/login.tsx)"
    const files = {
      'client/src/pages/login.tsx': `import bg from "@assets/772B17C5-7738-43B8-B5C0-04A7F2A6561B_1773842365564.png";`,
    };
    const missing = findMissingImportedAssets(files, []);
    expect(missing).toHaveLength(1);
    expect(missing[0].importedBy).toBe('client/src/pages/login.tsx');
    expect(missing[0].specifier).toContain('772B17C5');
  });

  it('says nothing when the asset IS stored', () => {
    const files = { 'src/App.tsx': `import logo from './logo.png';` };
    expect(findMissingImportedAssets(files, ['src/logo.png'])).toEqual([]);
  });

  it('says nothing when the asset is a text file in the project', () => {
    // An .svg is editable text and lives in the file map, not the asset store.
    const files = {
      'src/App.tsx': `import icon from './icon.svg';`,
      'src/icon.svg': '<svg/>',
    };
    expect(findMissingImportedAssets(files, [])).toEqual([]);
  });
});

describe('findMissingImportedAssets — precision, because a false block is worse', () => {
  it('matches by FILENAME, so an alias or an odd bundler root never triggers a false block', () => {
    // '@assets/hero.png' does not resolve to 'attached_assets/hero.png' by any path rule here, but the
    // file plainly exists — blocking a ship that would have worked is worse than the bug this prevents.
    const files = { 'src/App.tsx': `import h from '@assets/hero.png';` };
    expect(findMissingImportedAssets(files, ['attached_assets/hero.png'])).toEqual([]);
  });

  it('ignores non-asset imports — a missing module is the compile pre-flight’s job', () => {
    const files = { 'src/App.tsx': `import { x } from './nowhere'; import y from 'react';` };
    expect(findMissingImportedAssets(files, [])).toEqual([]);
  });

  it('does not scan non-source files', () => {
    const files = { 'README.md': `import bg from './ghost.png';` };
    expect(findMissingImportedAssets(files, [])).toEqual([]);
  });

  it('reports one entry per import site, not one per occurrence', () => {
    const files = {
      'a.tsx': `import x from './ghost.png';\nimport y from './ghost.png';`,
      'b.tsx': `import z from './ghost.png';`,
    };
    const missing = findMissingImportedAssets(files, []);
    expect(missing).toHaveLength(2);
    expect(missing.map((m) => m.importedBy).sort()).toEqual(['a.tsx', 'b.tsx']);
  });

  it('survives empty and malformed input', () => {
    expect(findMissingImportedAssets({}, [])).toEqual([]);
    expect(findMissingImportedAssets({ 'a.tsx': null as any }, [])).toEqual([]);
    expect(findMissingImportedAssets(null as any, null as any)).toEqual([]);
  });
});

describe('missingAssetUserMessage', () => {
  const missing = [{ specifier: '@assets/hero.png', importedBy: 'client/src/pages/login.tsx' }];

  it('names the picture AND the screen that uses it', () => {
    const msg = missingAssetUserMessage(missing);
    expect(msg).toContain('hero.png');
    expect(msg).toContain('client/src/pages/login.tsx');
  });

  it('tells the user what to DO — not just what is wrong', () => {
    // "An asset is missing" sends somebody hunting through their own project.
    const msg = missingAssetUserMessage(missing);
    expect(msg).toContain('NavBharatAI');
    expect(msg.toLowerCase()).toContain('large images');
  });

  it('carries no vendor or engine name to a user surface', () => {
    const msg = missingAssetUserMessage(missing).toLowerCase();
    for (const w of ['vite', 'firestore', 'github', 'enoent', 'bundler']) expect(msg).not.toContain(w);
  });

  it('caps the list instead of printing fifty lines', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ specifier: `a${i}.png`, importedBy: `p${i}.tsx` }));
    const msg = missingAssetUserMessage(many);
    expect(msg).toContain('and 4 more');
  });

  it('is empty when nothing is missing', () => {
    expect(missingAssetUserMessage([])).toBe('');
  });
});

describe('the check is wired into the ship (locked)', () => {
  const route = require('node:fs').readFileSync(
    require('node:path').resolve(__dirname, '../routes/mobileSetup.ts'), 'utf8');

  it('runs BEFORE the repo is created, so a doomed push never happens', () => {
    const check = route.indexOf('findMissingImportedAssets(appFiles');
    const ensure = route.indexOf('await ensureRepo(');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(ensure);
  });

  it('runs AFTER the heal, so a repair that removed the import clears the block itself', () => {
    expect(route.indexOf('appFiles = preflight.files;')).toBeLessThan(route.indexOf('findMissingImportedAssets(appFiles'));
  });
});
