import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { minVersion, satisfies } = require('semver');
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const e2bRequire = createRequire(require.resolve('e2b'));

// GHSA-xjj6-f33q-929c: both the shared dependency and e2b's separately named optional
// alias need a fix. Updating npm packages does NOT update Node's bundled global fetch.
// https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c
describe('all installed and locked undici copies include the content-encoding DoS fix', () => {
  it('keeps the direct dependency and shared override on the patched 7.x floor', () => {
    expect(satisfies(minVersion(manifest.dependencies.undici), '>=7.30.1 <8')).toBe(true);
    expect(manifest.overrides.undici).toBe(manifest.dependencies.undici);
    expect(lock.packages[''].dependencies.undici).toBe(manifest.dependencies.undici);
  });

  it('overrides e2b’s optional alias without changing its major version', () => {
    const alias = manifest.overrides.e2b?.undici8;
    expect(alias).toMatch(/^npm:undici@/);
    expect(satisfies(minVersion(alias.replace('npm:undici@', '')), '>=8.12.2 <9')).toBe(true);
    expect(lock.packages['node_modules/undici8'].name).toBe('undici');
    expect(lock.packages['node_modules/undici8'].optional).toBe(true);
  });

  it('contains no vulnerable direct, nested, or aliased copies in the lockfile', () => {
    const copies = Object.entries(lock.packages).filter(([path, entry]: [string, any]) =>
      /(?:^|\/)node_modules\/undici$/.test(path) || entry.name === 'undici');
    expect(copies.map(([path]) => path)).toEqual(expect.arrayContaining([
      'node_modules/undici', 'node_modules/undici8',
    ]));
    for (const [path, entry] of copies as [string, { version: string }][]) {
      expect(satisfies(entry.version, '>=7.30.1 <8 || >=8.12.2 <9'), path).toBe(true);
    }
  });

  it('actually resolves the patched shared and optional packages at runtime', () => {
    for (const resolver of [require, e2bRequire]) {
      const installed = resolver('undici/package.json');
      expect(satisfies(installed.version, '>=7.30.1 <8')).toBe(true);
      expect(installed.version).toBe(lock.packages['node_modules/undici'].version);
    }
    // npm can legitimately omit optional dependencies (including on older Node releases).
    // If installed, the alias e2b resolves must match the patched lock entry, not a hidden old copy.
    let aliasPath: string;
    try { aliasPath = e2bRequire.resolve('undici8/package.json'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') return;
      throw error;
    }
    const installedAlias = JSON.parse(readFileSync(aliasPath, 'utf8'));
    expect(satisfies(installedAlias.version, '>=8.12.2 <9')).toBe(true);
    expect(installedAlias.version).toBe(lock.packages['node_modules/undici8'].version);
  });
});
