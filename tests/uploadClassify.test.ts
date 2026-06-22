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
  it('returns too-large above 500 MB', () => {
    expect(classifyZipSize(501 * MB)).toBe('too-large');
  });
  it('returns github between 50 and 500 MB', () => {
    expect(classifyZipSize(100 * MB)).toBe('github');
    expect(classifyZipSize(51 * MB)).toBe('github');
  });
  it('returns ok at or below 50 MB', () => {
    expect(classifyZipSize(50 * MB)).toBe('ok');
    expect(classifyZipSize(1 * MB)).toBe('ok');
    expect(classifyZipSize(0)).toBe('ok');
  });
  it('boundary: exactly 500 MB is github, just above is too-large', () => {
    expect(classifyZipSize(500 * MB)).toBe('github');
    expect(classifyZipSize(500 * MB + 1)).toBe('too-large');
  });
});
