// Tests for the STREAMING project extractor (admin 2026-08-04: "5 GB, real VS Code jaisa").
//
// The invariant that matters most is PARITY: the disk extractor must reach the SAME decisions as the
// proven buffer extractor on the same archive — same kept files, same assets, same drop accounting —
// because rule 4 forbids a second drifting implementation of the import rules. The suite builds REAL
// zip files (via jszip, written to a temp path) and runs both extractors on them.
//
// The second invariant is the reason the streaming path exists at all: content that is not kept must
// never be inflated. A test plants a large entry and proves the result is identical to the buffer
// path's while the stream path is the one that will meet it on a 5 GB archive.

import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import JSZip from 'jszip';
import { extractZipProject } from './ProjectImport';
import {
  extractZipProjectFromDisk, hasSpaceForUpload, STREAM_MAX_ENTRIES,
} from './ProjectImportStream';

const tmpFiles: string[] = [];
afterAll(() => { for (const f of tmpFiles) { try { fs.unlinkSync(f); } catch { /* gone */ } } });

async function zipToDisk(entries: Record<string, string | Buffer>): Promise<{ filePath: string; buf: Buffer }> {
  const zip = new JSZip();
  for (const [p, c] of Object.entries(entries)) zip.file(p, c);
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  const filePath = path.join(os.tmpdir(), `nbai-test-${Date.now()}-${Math.random().toString(36).slice(2)}.zip`);
  fs.writeFileSync(filePath, buf);
  tmpFiles.push(filePath);
  return { filePath, buf };
}

/** A tiny valid PNG header + padding — enough for the asset path to treat it as image bytes. */
function fakePng(bytes: number): Buffer {
  const b = Buffer.alloc(bytes);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
  return b;
}

describe('PARITY — the disk extractor reaches the same decisions as the proven buffer extractor', () => {
  it('a realistic project: sources kept, node_modules dropped, secrets excluded, assets tiered', async () => {
    const { filePath, buf } = await zipToDisk({
      'package.json': JSON.stringify({ name: 'app', scripts: { dev: 'vite' }, dependencies: { react: '^19' } }),
      'index.html': '<div id="root"></div>',
      'src/App.tsx': "export const App = () => 'hi';",
      'src/lib/util.ts': 'export const u = 1;',
      'src/logo.png': fakePng(2048),
      'node_modules/react/index.js': 'nope',
      'node_modules/react/package.json': '{}',
      '.env': 'SECRET=live-value',
      '.DS_Store': 'junk',
      'video.mp4': Buffer.alloc(4096),
    });
    const fromBuffer = await extractZipProject(buf);
    const fromDisk = await extractZipProjectFromDisk(filePath);

    expect(Object.keys(fromDisk.files).sort()).toEqual(Object.keys(fromBuffer.files).sort());
    expect(fromDisk.files['src/App.tsx']).toBe(fromBuffer.files['src/App.tsx']);
    expect(Object.keys(fromDisk.assets).sort()).toEqual(Object.keys(fromBuffer.assets).sort());
    expect(fromDisk.assets['src/logo.png']).toBe(fromBuffer.assets['src/logo.png']);
    expect(fromDisk.dropped).toEqual(fromBuffer.dropped);
    expect(fromDisk.totalEntries).toBe(fromBuffer.totalEntries);
  });

  it('GitHub-style single root folder is stripped identically', async () => {
    const { filePath, buf } = await zipToDisk({
      'myapp-main/package.json': JSON.stringify({ name: 'app', scripts: { dev: 'vite' } }),
      'myapp-main/src/App.tsx': 'export default 1;',
    });
    const fromBuffer = await extractZipProject(buf);
    const fromDisk = await extractZipProjectFromDisk(filePath);
    expect(fromDisk.strippedRoot).toBe('myapp-main');
    expect(fromDisk.strippedRoot).toBe(fromBuffer.strippedRoot);
    expect(Object.keys(fromDisk.files).sort()).toEqual(Object.keys(fromBuffer.files).sort());
  });

  it('monorepo re-root lands the same nested app', async () => {
    const { filePath, buf } = await zipToDisk({
      'apps/web/package.json': JSON.stringify({ name: 'web', scripts: { dev: 'vite' }, dependencies: { react: '^19' } }),
      'apps/web/src/main.tsx': 'export const m = 1;',
      'docs/readme.md': 'not the app',
    });
    const fromBuffer = await extractZipProject(buf);
    const fromDisk = await extractZipProjectFromDisk(filePath);
    expect(fromDisk.appRoot).toBe('apps/web');
    expect(fromDisk.appRoot).toBe(fromBuffer.appRoot);
    expect(Object.keys(fromDisk.files).sort()).toEqual(Object.keys(fromBuffer.files).sort());
    expect(fromDisk.dropped.outsideAppRoot).toBe(fromBuffer.dropped.outsideAppRoot);
  });

  it('zip-slip / traversal — the disk path is STRICTER: the whole hostile archive is refused', async () => {
    // Found while writing this suite: yauzl validates entry paths at parse time and errors the entire
    // archive on a traversal entry, where the buffer path (jszip) parses it and drops just that entry.
    // A zip carrying a "../" entry is hostile by definition, so refusing all of it is the BETTER
    // behavior — locked here as deliberate, not papered over into fake parity.
    const zip = new JSZip();
    zip.file('good.ts', 'export const ok = 1;');
    zip.file('nested/../../evil.ts', 'export const evil = 1;');
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    const filePath = path.join(os.tmpdir(), `nbai-test-slip-${Date.now()}.zip`);
    fs.writeFileSync(filePath, buf);
    tmpFiles.push(filePath);

    // (jszip normalizes the path on insert, so the BUFFER extractor never even sees a ".." entry from
    // this fixture — its own unsafe-path handling is locked by ProjectImport's existing tests against
    // raw-crafted archives. What matters here: no ".." ever escapes, on either path.)
    const fromBuffer = await extractZipProject(buf);
    expect(Object.keys(fromBuffer.files).every((p) => !p.includes('..'))).toBe(true);

    await expect(extractZipProjectFromDisk(filePath)).rejects.toThrow(/invalid relative path/i);
  });
});

describe('what the streaming path exists FOR — big content, bounded memory', () => {
  it('a big text entry is dropped from the plan WITHOUT being read (declared-size gate)', async () => {
    // 8 MB of text — over the lockfile ceiling, so the plan must skip it up front. The observable
    // contract: it lands in dropped.tooLarge and never in files; the buffer path agrees.
    const big = 'x'.repeat(8 * 1024 * 1024);
    const { filePath, buf } = await zipToDisk({
      'package.json': JSON.stringify({ name: 'app', scripts: { dev: 'vite' } }),
      'huge-generated.ts': big,
      'src/App.tsx': 'export default 1;',
    });
    const fromDisk = await extractZipProjectFromDisk(filePath);
    const fromBuffer = await extractZipProject(buf);
    expect(fromDisk.files['huge-generated.ts']).toBeUndefined();
    expect(fromDisk.dropped.tooLarge).toBe(1);
    expect(fromDisk.dropped).toEqual(fromBuffer.dropped);
  });

  it('an oversized lockfile still reaches the sandbox tier, like the buffer path', async () => {
    const lock = JSON.stringify({ lockfileVersion: 3, packages: { x: 'y'.repeat(1_200_000) } });
    const { filePath, buf } = await zipToDisk({
      'package.json': JSON.stringify({ name: 'app', scripts: { dev: 'vite' } }),
      'package-lock.json': lock,
      'src/App.tsx': 'export default 1;',
    });
    const fromDisk = await extractZipProjectFromDisk(filePath);
    const fromBuffer = await extractZipProject(buf);
    expect(fromDisk.sandboxOnly['package-lock.json']).toBe(lock);
    expect(Object.keys(fromDisk.sandboxOnly)).toEqual(Object.keys(fromBuffer.sandboxOnly));
  });

  it('the DELIBERATE divergence: an archive DECLARING a huge uncompressed total still imports here', async () => {
    // The buffer path refuses any archive declaring >300 MB uncompressed (memory guard). Streaming
    // never inflates what it does not keep, so the same declaration must NOT refuse the import — this
    // is exactly why a 5 GB real-world zip works. Verified with compressible large entries that the
    // plan skips by declared size.
    const entries: Record<string, string> = {
      'package.json': JSON.stringify({ name: 'app', scripts: { dev: 'vite' } }),
      'src/App.tsx': 'export default 1;',
    };
    for (let i = 0; i < 40; i++) entries[`data/blob-${i}.ts`] = 'z'.repeat(9 * 1024 * 1024); // declares ~360 MB
    const { filePath, buf } = await zipToDisk(entries);

    await expect(extractZipProject(buf)).rejects.toThrow(/too much content/i); // buffer path: refused
    const fromDisk = await extractZipProjectFromDisk(filePath);              // stream path: imports
    expect(fromDisk.files['src/App.tsx']).toBe('export default 1;');
    expect(fromDisk.dropped.tooLarge).toBe(40); // every blob skipped by declared size, never inflated
  }, 60_000);
});

describe('the disk preflight (why a 5 GB upload fails in one second, not at 90%)', () => {
  it('accepts when there is room, refuses when there is not', () => {
    const GB = 1024 ** 3;
    expect(hasSpaceForUpload(10 * GB, 5 * GB)).toBe(true);
    expect(hasSpaceForUpload(5 * GB, 5 * GB)).toBe(false);       // no headroom → refuse
    expect(hasSpaceForUpload(5.6 * GB, 5 * GB)).toBe(true);      // headroom present
  });

  it('unknown free space never blocks — refusing everything would be the worse failure', () => {
    expect(hasSpaceForUpload(null, 5 * 1024 ** 3)).toBe(true);
  });

  it('junk sizes never throw', () => {
    expect(hasSpaceForUpload(1024, Number.NaN)).toBe(true);
    expect(hasSpaceForUpload(1024, -5)).toBe(true);
  });
});

describe('bomb guards stay real in the streaming path', () => {
  it('the entry-count ceiling exists and is far above any real project', () => {
    expect(STREAM_MAX_ENTRIES).toBeGreaterThanOrEqual(1_000_000);
  });
});
