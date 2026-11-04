// A RECIPE'S OWN INSTALL LEAVES THE TREE "CURRENT" (autopsy 61279465, 2026-11-04 — the 3D train simulator).
//
// WRITE_TIME_TYPECHECK: "4 TypeScript write(s) skipped … 3 because package.json had changed since the last
// install". The last install WAS the 3D recipe's: `npm install three && npm install -D @types/three`. The second
// rewrites package.json but adds its entry under node_modules/@types, so node_modules' own mtime stays older and
// MANIFEST_CURRENT (`package.json -nt node_modules`) judged an installed tree stale. Measured here with a stand-in
// npm that does exactly that, in a real shell.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, chmodSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempDir } from './helpers/tempDir';
import { recipeInstallCommand, MANIFEST_CURRENT } from '../src/server/AgentV3/tscCommand';

function project(): { dir: string; bin: string } {
  const dir = makeTempDir('nbai-recipe-install-');
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  mkdirSync(join(dir, 'node_modules', '@types'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), '{"name":"p","dependencies":{}}');
  const old = new Date(Date.now() - 60_000);
  utimesSync(join(dir, 'package.json'), old, old);
  utimesSync(join(dir, 'node_modules'), old, old);
  // npm's real effect for `-D @types/three` on a tree that already has node_modules/@types: package.json is
  // rewritten, and the new package lands one level down.
  writeFileSync(join(bin, 'npm'), '#!/bin/sh\nsleep 1\necho \'{"name":"p","devDependencies":{"@types/three":"^0.180.0"}}\' > package.json\nmkdir -p node_modules/@types/three\n');
  chmodSync(join(bin, 'npm'), 0o755);
  return { dir, bin };
}
const sh = (cmd: string, dir: string, bin: string) => execFileSync('bash', ['-c', cmd], { cwd: dir, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8' });

describe('after the recipe installs, the write-time typecheck sees a current tree', () => {
  it('the stamp is in the command, after a SUCCESSFUL install only', () => {
    expect(recipeInstallCommand([{ name: '@types/three', version: '^0.180.0', dev: true }])).toMatch(/npm install --no-audit --no-fund -D @types\/three@\^0\.180\.0 && touch node_modules; _nbs=\$\?/);
  });
  it('in a real shell: installed → MANIFEST_CURRENT holds (it failed before the stamp)', () => {
    const { dir, bin } = project();
    sh(recipeInstallCommand([{ name: '@types/three', version: '^0.180.0', dev: true }]), dir, bin);
    expect(sh(`if ${MANIFEST_CURRENT}; then echo current; else echo stale; fi`, dir, bin).trim()).toBe('current');
  });
  it('the same install WITHOUT the stamp leaves the tree stale — the reported state', () => {
    const { dir, bin } = project();
    sh(recipeInstallCommand([{ name: '@types/three', version: '^0.180.0', dev: true }]).replace(' && touch node_modules', ''), dir, bin);
    expect(sh(`if ${MANIFEST_CURRENT}; then echo current; else echo stale; fi`, dir, bin).trim()).toBe('stale');
  });
});
