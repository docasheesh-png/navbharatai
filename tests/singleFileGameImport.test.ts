// A 5.4 MB ONE-FILE GAME LANDS INTACT, AS CODE PLUS FILES (single-file game autopsy, 2026-11-14).
// Every door a user can use is exercised with the generated fixture: the browser filter, the server zip extractor (memory and
// disk), and the import-files body sorter. The fixture is the SHAPE of the real file, not the file.
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IMPORT_LIMITS } from '../src/lib/importRules';
import { keepVerdict } from '../src/lib/browserZipImport';
import { allowedBeforeLifting, liftEmbeddedMedia, liftSummary } from '../src/lib/liftEmbeddedMedia';
import { prepareImportBody, isAssetEntry } from '../src/server/AgentV3/importLanding';
import { extractZipProject } from '../src/server/AgentV3/ProjectImport';
import { extractZipProjectFromDisk } from '../src/server/AgentV3/ProjectImportStream';
import { pastedStorageKeys } from '../src/server/AgentV3/pastedAppFormat';
import { buildGameFixture, fixtureMedia, longBase64Runs, STORAGE_KEYS } from './helpers/singleFileGameFixture';

// A page of the real game's size: the media scaled up to ~5.4 MB.
const big = buildGameFixture(fixtureMedia(8.5));

describe('the fixture is as big as the real game', () => {
  it('is about 5.5 MB, over every old limit', () => {
    expect(big.html.length).toBeGreaterThan(5_000_000);
    expect(big.html.length).toBeLessThan(6_000_000);
    expect(big.html.length).toBeGreaterThan(IMPORT_LIMITS.maxTextFileBytes);
    expect(big.html.length).toBeGreaterThan(5 * 1024 * 1024);
  });
});

describe('browser filter — keepVerdict', () => {
  const state = { files: 0, bytes: 0, assets: 0 };
  it('keeps the big HTML page (its media will be lifted), but still refuses a big ordinary text file', () => {
    expect(keepVerdict({ path: 'game.html', bytes: big.html.length, directory: false }, state)).toEqual({ keep: 'text' });
    expect(keepVerdict({ path: 'src/bundle.js', bytes: big.html.length, directory: false }, state)).toEqual({ keep: false, reason: 'tooLarge' });
  });
  it('refuses an HTML page past the page ceiling', () => {
    expect(allowedBeforeLifting('x.html', IMPORT_LIMITS.maxHtmlSourceBytes)).toBe(true);
    expect(allowedBeforeLifting('x.html', IMPORT_LIMITS.maxHtmlSourceBytes + 1)).toBe(false);
    expect(allowedBeforeLifting('x.js', 1_000_000)).toBe(false);
  });
});

describe('liftEmbeddedMedia over an import', () => {
  const lifted = liftEmbeddedMedia({ 'index.html': big.html, 'README.md': '# hi' });
  it('reduces the page to code and moves the media into assets/media/', () => {
    expect(lifted.files['index.html'].length).toBeLessThan(60_000);
    expect(longBase64Runs(lifted.files['index.html'], 200)).toEqual([]);
    expect(Object.keys(lifted.assets).length).toBe(6);
    expect(Object.keys(lifted.assets).every((p) => p.startsWith('assets/media/'))).toBe(true);
    expect(lifted.files['README.md']).toBe('# hi');
    expect(liftSummary(lifted)).toMatch(/Moved 6 embedded media file\(s\) out of 1 page/);
  });
  it('keeps the saves and returns the same object when there is nothing to lift', () => {
    expect(pastedStorageKeys(lifted.files['index.html'])).toEqual([...STORAGE_KEYS].filter((k) => pastedStorageKeys(big.html).includes(k)));
    const plain = { 'a.html': '<p>' + 'x'.repeat(3000) + '</p>' };
    expect(liftEmbeddedMedia(plain).files).toBe(plain);
  });
});

describe('prepareImportBody — the import-files route sorts before it writes', () => {
  const logo = 'data:image/png;base64,' + Buffer.from(new Uint8Array(3000).fill(7)).toString('base64');
  const prepared = prepareImportBody({ 'index.html': big.html, 'src/logo.png': logo, 'src/app.js': 'var a=1;' });

  it('a data: URI at a binary path is an ASSET, not a text file (the old route wrote it as text)', () => {
    expect(isAssetEntry('src/logo.png', logo)).toBe(true);
    expect(isAssetEntry('src/app.js', 'data:text/plain;base64,AAAA')).toBe(false);
    expect(prepared.assets['src/logo.png']).toBe(logo);
    expect(prepared.text['src/logo.png']).toBeUndefined();
  });
  it('the game page lands as code under the one text cap, with its media beside it', () => {
    expect(prepared.text['index.html'].length).toBeLessThan(IMPORT_LIMITS.maxTextFileBytes);
    expect(Object.keys(prepared.assets).filter((p) => p.startsWith('assets/media/'))).toHaveLength(6);
    expect(prepared.text['src/app.js']).toBe('var a=1;');
    expect(prepared.summary).toMatch(/assets\/media\//);
  });
  it('never throws on garbage', () => {
    expect(() => prepareImportBody(undefined as unknown as Record<string, string>)).not.toThrow();
    expect(prepareImportBody({ 'a.txt': 5 as unknown as string }).text).toEqual({});
  });
});

describe('server zip door — a zip holding the 5.4 MB page keeps it', () => {
  it('in-memory extractor keeps the page as text (it used to drop it as tooLarge)', async () => {
    const zip = new JSZip();
    zip.file('game.html', big.html);
    zip.file('bundle.js', 'x'.repeat(IMPORT_LIMITS.maxTextFileBytes + 10));
    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const r = await extractZipProject(buf);
    expect(Object.keys(r.files)).toContain('game.html');
    expect(r.files['game.html'].length).toBe(big.html.length);
    expect(Object.keys(r.files)).not.toContain('bundle.js');
    expect(r.dropped.tooLarge).toBe(1);
  });
  it('disk extractor does the same', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sfg-'));
    try {
      const zip = new JSZip();
      zip.file('game.html', big.html);
      zip.file('bundle.js', 'x'.repeat(IMPORT_LIMITS.maxTextFileBytes + 10));
      const file = join(dir, 'g.zip');
      writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
      const r = await extractZipProjectFromDisk(file);
      expect(Object.keys(r.files)).toContain('game.html');
      expect(Object.keys(r.files)).not.toContain('bundle.js');
      expect(r.dropped.tooLarge).toBe(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
