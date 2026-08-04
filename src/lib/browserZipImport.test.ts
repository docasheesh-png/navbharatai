import { describe, it, expect } from 'vitest';
import {
  keepVerdict, countDrop, strippedRootOf, readZipInBrowser,
  BROWSER_MAX_FILE_BYTES, BROWSER_MAX_ASSET_BYTES, BROWSER_MAX_ASSETS, BROWSER_MAX_FILES,
  type ZipEntryInfo,
} from './browserZipImport';
import { SKIP_DIR_RE, BINARY_EXT_RE, safeImportPath, importDropReason } from './importRules';
import type { DropCounts } from './importDropReport';

const fresh = () => ({ files: 0, bytes: 0, assets: 0 });
const entry = (path: string, bytes = 1000, directory = false): ZipEntryInfo => ({ path, bytes, directory });

describe('keepVerdict — decided from the central directory, before anything is decompressed', () => {
  it('keeps ordinary source', () => {
    expect(keepVerdict(entry('src/App.tsx'), fresh())).toEqual({ keep: 'text' });
    expect(keepVerdict(entry('package.json'), fresh())).toEqual({ keep: 'text' });
  });

  it('drops the bulk of a real project zip — node_modules, .git, dist', () => {
    for (const p of ['node_modules/react/index.js', '.git/objects/ab/cdef', 'dist/main.js', 'build/out.js']) {
      expect(keepVerdict(entry(p), fresh())).toEqual({ keep: false, reason: 'dir' });
    }
  });

  it('refuses a 900 MB video WITHOUT decompressing it — the whole point of the design', () => {
    // Only the central directory's declared size is consulted, so the archive is never inflated to
    // discover that this entry is huge. This is what makes a 1 GB import cost megabytes of memory.
    expect(keepVerdict(entry('assets/demo.mp4', 900 * 1024 * 1024), fresh())).toEqual({ keep: false, reason: 'binary' });
  });

  it('keeps a small logo as an asset so the preview is not full of broken images', () => {
    expect(keepVerdict(entry('public/logo.png', 40 * 1024), fresh())).toEqual({ keep: 'asset', mime: 'image/png' });
  });

  it('drops an oversized image rather than blowing the durable-store cap', () => {
    expect(keepVerdict(entry('public/hero.png', BROWSER_MAX_ASSET_BYTES + 1), fresh())).toEqual({ keep: false, reason: 'tooLarge' });
  });

  it('drops an oversized text file', () => {
    expect(keepVerdict(entry('src/huge.ts', BROWSER_MAX_FILE_BYTES + 1), fresh())).toEqual({ keep: false, reason: 'tooLarge' });
  });

  it('never imports live credentials, and never counts that as a loss the user should chase', () => {
    expect(keepVerdict(entry('.env'), fresh())).toEqual({ keep: false, reason: 'secret' });
    expect(keepVerdict(entry('certs/server.key'), fresh())).toEqual({ keep: false, reason: 'secret' });
    // A template is safe and genuinely useful — it must still come in.
    expect(keepVerdict(entry('.env.example'), fresh())).toEqual({ keep: 'text' });
  });

  it('refuses zip-slip paths', () => {
    expect(keepVerdict(entry('../../etc/passwd'), fresh())).toEqual({ keep: false, reason: 'unsafe' });
    expect(keepVerdict(entry('/etc/passwd'), fresh())).toEqual({ keep: false, reason: 'unsafe' });
  });

  it('enforces the running budgets, not just per-file limits', () => {
    expect(keepVerdict(entry('src/a.ts'), { files: BROWSER_MAX_FILES, bytes: 0, assets: 0 })).toEqual({ keep: false, reason: 'overCap' });
    expect(keepVerdict(entry('public/i.png', 1000), { files: 0, bytes: 0, assets: BROWSER_MAX_ASSETS })).toEqual({ keep: false, reason: 'overCap' });
  });

  it('drops directory entries without counting them as user-visible losses', () => {
    expect(keepVerdict(entry('src/', 0, true), fresh())).toEqual({ keep: false, reason: 'dir' });
  });
});

describe('the browser filter uses the SAME rules as the server — no second copy to drift', () => {
  // The rules were MOVED to importRules.ts rather than duplicated. These assert the browser path is
  // genuinely asking the shared module, so a future rule change cannot update one side only.
  it('agrees with the shared skip/binary rules on every category', () => {
    expect(SKIP_DIR_RE.test('node_modules/x.js')).toBe(true);
    expect(BINARY_EXT_RE.test('a/b/clip.mp4')).toBe(true);
    expect(safeImportPath('../x')).toBeNull();
    expect(importDropReason('node_modules/react/index.js')?.reason).toBe('dir');
  });

  it('a path the shared rules keep is a path the browser keeps', () => {
    expect(importDropReason('src/App.tsx')).toBeNull();
    expect(keepVerdict(entry('src/App.tsx'), fresh()).keep).toBe('text');
  });
});

describe('strippedRootOf', () => {
  it('strips the single wrapper folder a right-click zip always has', () => {
    expect(strippedRootOf(['my-app/src/App.tsx', 'my-app/package.json'])).toBe('my-app');
  });

  it('strips nothing when the archive has several top-level folders', () => {
    expect(strippedRootOf(['src/App.tsx', 'package.json'])).toBeNull();
    expect(strippedRootOf(['a/x.ts', 'b/y.ts'])).toBeNull();
  });

  it('strips nothing when a file sits at the archive root', () => {
    expect(strippedRootOf(['package.json', 'my-app/src/App.tsx'])).toBeNull();
  });

  it('is safe on an empty archive', () => {
    expect(strippedRootOf([])).toBeNull();
  });
});

describe('countDrop', () => {
  it('accumulates into the shape the honest summary already reads', () => {
    const d: DropCounts = {};
    countDrop(d, 'binary');
    countDrop(d, 'binary');
    countDrop(d, 'tooLarge');
    expect(d).toEqual({ binary: 2, tooLarge: 1 });
  });
});

describe('the 1 GB / 4,000-file case this exists for', () => {
  it('a media-heavy project uploads its source and leaves the gigabyte behind', () => {
    // 3,600 media files + 400 source files, the shape the admin described.
    const state = fresh();
    const dropped: DropCounts = {};
    let kept = 0;
    for (let i = 0; i < 3_600; i++) {
      const v = keepVerdict(entry(`assets/img${i}.mp4`, 260 * 1024), state);
      expect(v.keep).toBe(false);
      if (v.keep === false) countDrop(dropped, v.reason);
    }
    for (let i = 0; i < 400; i++) {
      const v = keepVerdict(entry(`src/mod${i}.ts`, 4 * 1024), state);
      expect(v.keep).toBe('text');
      state.files += 1; state.bytes += 4 * 1024; kept += 1;
    }
    expect(kept).toBe(400);
    expect(dropped.binary).toBe(3_600);
    // The decisive number: what actually crosses the network.
    expect(state.bytes).toBeLessThan(2 * 1024 * 1024);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// INTEGRATION — the reader against a REAL archive it builds itself.
//
// Everything above tests the pure DECISIONS. This tests that the reader actually works: that zip.js is
// wired correctly, the wrapper folder is stripped, text vs asset writers are chosen per entry, and the
// bytes that survive are genuinely tiny. A suite that only checked the decisions would have passed
// happily while `getData` was called on the wrong writer — the exact class of gap that has burned this
// project before.
describe('readZipInBrowser — real archive, built and read in-process', () => {
  async function buildArchive(): Promise<Blob> {
    const { ZipWriter, BlobWriter, TextReader, Uint8ArrayReader } = await import('@zip.js/zip.js');
    const zw = new ZipWriter(new BlobWriter('application/zip'));
    // Everything is nested under one wrapper folder, exactly like a right-click "Compress" zip.
    await zw.add('my-app/src/App.tsx', new TextReader('export default function App(){return null}'));
    await zw.add('my-app/package.json', new TextReader('{"name":"demo"}'));
    await zw.add('my-app/.env', new TextReader('SECRET=live'));          // must NEVER be imported
    await zw.add('my-app/.env.example', new TextReader('SECRET='));      // template must be kept
    await zw.add('my-app/node_modules/react/index.js', new TextReader('x'.repeat(20_000)));
    await zw.add('my-app/public/logo.png', new Uint8ArrayReader(new Uint8Array(4_000)));      // small → asset
    await zw.add('my-app/public/demo.mp4', new Uint8ArrayReader(new Uint8Array(1_500_000))); // media → dropped
    return zw.close();
  }

  it('imports the source, refuses the bulk, and strips the wrapper folder', async () => {
    const r = await readZipInBrowser(await buildArchive());

    // Wrapper stripped — paths land as the app expects them, not nested under "my-app/".
    expect(Object.keys(r.files).sort()).toEqual(['.env.example', 'package.json', 'src/App.tsx']);
    expect(r.files['src/App.tsx']).toContain('export default function App');

    // The live secret is never imported; its template is.
    expect(r.files['.env']).toBeUndefined();
    expect(r.files['.env.example']).toBeDefined();

    // A small image is rescued as a data URI so the preview is not full of broken pictures.
    expect(Object.keys(r.assets)).toEqual(['public/logo.png']);
    expect(r.assets['public/logo.png']).toMatch(/^data:image\/png;base64,/);

    // The bulk never becomes upload bytes.
    expect(Object.keys(r.files).join()).not.toMatch(/node_modules/);
    expect(r.dropped.dir).toBeGreaterThan(0);
    expect(r.dropped.binary).toBeGreaterThan(0);
    expect(r.dropped.secret).toBe(1);
  });

  it('turns a mostly-media archive into a tiny upload — the entire point', async () => {
    const r = await readZipInBrowser(await buildArchive());
    // The archive carries ~1.5 MB of video and 20 KB of node_modules; what crosses the network is the
    // source plus one small logo.
    expect(r.keptBytes).toBeLessThan(64 * 1024);
    expect(r.totalEntries).toBeGreaterThan(0);
  });

  it('reports a password-protected archive honestly instead of failing blankly', async () => {
    const { ZipWriter, BlobWriter, TextReader } = await import('@zip.js/zip.js');
    const zw = new ZipWriter(new BlobWriter('application/zip'), { password: 'hunter2' });
    await zw.add('src/App.tsx', new TextReader('x'));
    const blob = await zw.close();
    await expect(readZipInBrowser(blob)).rejects.toThrow(/password-protected|could not be read/i);
  });
});
