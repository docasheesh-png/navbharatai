import { describe, it, expect } from 'vitest';
import { isZipFile, isTextFile, classifyZipSize } from '../src/lib/uploadClassify';

const MB = 1024 * 1024;

describe('isZipFile', () => {
  it('detects .zip by extension (case-insensitive)', () => {
    expect(isZipFile('project.zip')).toBe(true);
    expect(isZipFile('PROJECT.ZIP')).toBe(true);
  });
  it('detects zip by MIME type', () => {
    expect(isZipFile('archive', 'application/zip')).toBe(true);
    expect(isZipFile('archive', 'application/x-zip-compressed')).toBe(true);
  });
  it('returns false for non-zip files', () => {
    expect(isZipFile('index.html')).toBe(false);
    expect(isZipFile('photo.png', 'image/png')).toBe(false);
  });
});

describe('isTextFile', () => {
  it('detects common text/code extensions', () => {
    for (const name of ['a.html', 'b.css', 'c.ts', 'd.tsx', 'e.json', 'f.md', 'g.vue', 'h.py', 'i.svelte']) {
      expect(isTextFile(name)).toBe(true);
    }
  });
  it('is case-insensitive', () => {
    expect(isTextFile('Component.TSX')).toBe(true);
  });
  it('returns false for binary extensions', () => {
    expect(isTextFile('photo.png')).toBe(false);
    expect(isTextFile('font.woff2')).toBe(false);
    expect(isTextFile('archive.zip')).toBe(false);
  });
});

describe('classifyZipSize', () => {
  // The old 50/500 MB buckets were fiction (2026-08-04 audit): "ok" waved files into a transport the
  // platform kills at ~32 MB, and "github" was an excuse. One honest gate now: the server's real 5 GB.
  it('returns ok all the way to the real 5 GB ceiling', () => {
    expect(classifyZipSize(50 * MB)).toBe('ok');
    expect(classifyZipSize(100 * MB)).toBe('ok');
    expect(classifyZipSize(500 * MB)).toBe('ok');
    expect(classifyZipSize(4 * 1024 * MB)).toBe('ok');
    expect(classifyZipSize(5 * 1024 * MB)).toBe('ok');
  });
  it('returns too-large only past 5 GB', () => {
    expect(classifyZipSize(5 * 1024 * MB + 1)).toBe('too-large');
  });
});
