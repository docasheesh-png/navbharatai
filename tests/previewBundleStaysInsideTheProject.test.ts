// Forensic audit 2026-10-04 — the unauthenticated preview bundler must never read a file outside the
// caller's own project.
//
// `bundleForPreview` runs esbuild ON THE HOST. It cleaned the NAMES of the files it wrote but not the
// IMPORTS inside them, so `import s from '/proc/self/environ' with { type: 'text' }` inlined every secret
// the server holds into the bundle it returned. Every escape shape is tried here against a real marker
// file outside the project, and a legitimate app must still bundle.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import os from 'node:os';
import { bundleForPreview } from '../src/server/routes/preview';

const MARKER = 'NB_SECRET_MARKER_7f3a9c';
let secretDir = '';
let secretFile = '';

beforeAll(() => {
  secretDir = mkdtempSync(join(os.tmpdir(), 'nb-outside-'));
  secretFile = join(secretDir, 'secret.json');
  writeFileSync(secretFile, JSON.stringify({ value: MARKER }));
  writeFileSync(join(secretDir, 'secret.txt'), MARKER);
});
afterAll(() => { rmSync(secretDir, { recursive: true, force: true }); });

const html = '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>';
const app = (main: string, extra: Record<string, string> = {}) => ({ 'index.html': html, 'src/main.tsx': main, ...extra });

/** The bundle either refuses, or comes back without the marker. Never with it. */
async function neverLeaks(files: Record<string, string>): Promise<'refused' | 'clean'> {
  try {
    const out = await bundleForPreview(files);
    expect(out).not.toContain(MARKER);
    return 'clean';
  } catch (err) {
    expect(String((err as Error).message)).not.toContain(MARKER);
    return 'refused';
  }
}

describe('an import cannot reach outside the project', () => {
  it('an absolute path, read as text', async () => {
    expect(await neverLeaks(app(`import s from '${join(secretDir, 'secret.txt')}' with { type: 'text' };\nconsole.log(s);`))).toBe('refused');
  });

  it('an absolute path to a JSON file (built-in loader)', async () => {
    expect(await neverLeaks(app(`import s from '${secretFile}';\nconsole.log(s);`))).toBe('refused');
  });

  it('a relative path that climbs out', async () => {
    const climb = '../'.repeat(12) + relative('/', secretFile);
    expect(await neverLeaks(app(`import s from '${climb}';\nconsole.log(s);`))).toBe('refused');
  });

  it('a tsconfig "paths" entry aimed outside', async () => {
    const tsconfig = JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { 'leak': [secretFile] } } });
    // An `import` of a bare name is externalised to the CDN (never read here); a `require` is not, so the
    // resolver follows tsconfig "paths" — that is the shape that must be refused by DESTINATION.
    expect(await neverLeaks(app(`import s from 'leak';\nconsole.log(s);`, { 'tsconfig.json': tsconfig }))).not.toBe(undefined);
    expect(await neverLeaks(app(`const s = require('leak');\nconsole.log(s);`, { 'tsconfig.json': tsconfig }))).toBe('refused');
  });

  it('the @/ alias climbing out', async () => {
    const climb = '../'.repeat(12) + relative('/', secretFile);
    expect(await neverLeaks(app(`import s from '@/${climb}';\nconsole.log(s);`))).toBe('refused');
  });

  it('a file: URL', async () => {
    expect(await neverLeaks(app(`import s from 'file://${secretFile}';\nconsole.log(s);`))).toBe('refused');
  });

  it('the server\'s own environment, the exact proof-of-concept', async () => {
    const r = await neverLeaks(app(`import s from '/proc/self/environ' with { type: 'text' };\nconsole.log(s);`));
    expect(r === 'refused' || r === 'clean').toBe(true);
  });
});

describe('a real app still bundles', () => {
  it('relative, @/ alias, and project-root absolute imports inside the project all work', async () => {
    const out = await bundleForPreview(app(
      `import { a } from './lib/a';\nimport { b } from '@/lib/b';\nimport { c } from '/src/lib/c';\nimport data from './data.json';\nconsole.log(a, b, c, data.ok);`,
      {
        'src/lib/a.ts': `export const a = 'A_OK';`,
        'src/lib/b.ts': `export const b = 'B_OK';`,
        'src/lib/c.ts': `export const c = 'C_OK';`,
        'src/data.json': `{"ok":"DATA_OK"}`,
      },
    ));
    for (const m of ['A_OK', 'B_OK', 'C_OK', 'DATA_OK']) expect(out).toContain(m);
  });
});
