import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { interopDefault } from '../src/server/lib/interopDefault';

/**
 * #3501 (2026-10-04): `zip-stream` 7 is ESM-only, so a CommonJS `require('zip-stream')` returns the module
 * namespace (`{ __esModule, default }`) instead of the class, and `/api/download-zip` died with
 * "m is not a constructor" while tsc and the suite stayed green. The route now resolves the export through
 * `interopDefault`, which is shape-agnostic — so this file passes against zip-stream 6 (a function) AND 7
 * (a namespace), and the round-trip below is the proof that a download really produces a readable archive
 * on whichever version is installed.
 */
const require = createRequire(import.meta.url);
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('interopDefault — the one rule for a require() that may return an ESM namespace', () => {
  it('unwraps a namespace, passes a class or function through, and never invents a value', () => {
    class K {}
    const fn = () => 1;
    expect(interopDefault<typeof K>({ __esModule: true, default: K })).toBe(K);
    expect(interopDefault<typeof fn>(fn)).toBe(fn);
    expect(interopDefault<typeof K>(K)).toBe(K);
    const bare = { default: undefined, other: 1 };
    expect(interopDefault<typeof bare>(bare)).toBe(bare);
    expect(interopDefault<null>(null)).toBe(null);
  });
});

describe('the ZIP download builds a readable archive on the installed zip-stream', () => {
  it('require → interopDefault → new ZipStream → entries → yauzl reads them back', async () => {
    const ZipStream = interopDefault<new (opts: { level: number }) => any>(require('zip-stream'));
    expect(typeof ZipStream).toBe('function');
    const archive = new ZipStream({ level: 6 });
    const chunks: Buffer[] = [];
    const done = new Promise<Buffer>((resolve, reject) => {
      archive.on('data', (c: Buffer) => chunks.push(c));
      archive.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', reject);
    });
    for (const [name, content] of [['src/App.tsx', 'export default 1;'], ['README.md', '# app']] as const) {
      await new Promise<void>((resolve, reject) => archive.entry(content, { name }, (err: unknown) => (err ? reject(err) : resolve())));
    }
    archive.finish();
    const zip = await done;
    expect(zip.subarray(0, 2).toString()).toBe('PK');

    const yauzl = interopDefault<any>(require('yauzl'));
    const names = await new Promise<string[]>((resolve, reject) => {
      yauzl.fromBuffer(zip, { lazyEntries: true }, (err: Error | null, zf: any) => {
        if (err || !zf) return reject(err ?? new Error('no zipfile'));
        const out: string[] = [];
        zf.on('entry', (e: any) => { out.push(e.fileName); zf.readEntry(); });
        zf.on('end', () => resolve(out));
        zf.on('error', reject);
        zf.readEntry();
      });
    });
    expect(names.sort()).toEqual(['README.md', 'src/App.tsx']);
  });
});

describe('source guard — the route cannot go back to a bare require', () => {
  it('routes/zip.ts resolves zip-stream through interopDefault', () => {
    const src = read('src/server/routes/zip.ts');
    expect(src).toMatch(/interopDefault<.*>\(require\('zip-stream'\)\)/);
    expect(src).not.toMatch(/=\s*require\('zip-stream'\);/);
  });
  it('firebaseAdminModule uses the same helper rather than a private copy of the rule', () => {
    const src = read('src/server/lib/firebaseAdminModule.ts');
    expect(src).toContain("import { interopDefault } from './interopDefault';");
    expect(src).not.toMatch(/mod\.default \?\? mod/);
  });
});
