import { describe, it, expect } from 'vitest';
import { FileSanitizer } from '../src/server/AppMakerLab/FileSanitizer';

describe('FileSanitizer.resolveSafePath', () => {
  it('resolves a valid relative path inside the workspace', () => {
    const resolved = FileSanitizer.resolveSafePath('/workspace', 'src/App.tsx');
    expect(resolved).toContain('/workspace/src/App.tsx');
  });

  it('throws on path traversal attempt', () => {
    expect(() => FileSanitizer.resolveSafePath('/workspace', '../../etc/passwd')).toThrow();
  });

  it('resolves path to workspace root itself', () => {
    const resolved = FileSanitizer.resolveSafePath('/workspace', '.');
    expect(resolved).toBe('/workspace');
  });
});

describe('FileSanitizer.sanitizeFileName', () => {
  it('replaces spaces with underscores', () => {
    expect(FileSanitizer.sanitizeFileName('my file.ts')).toBe('my_file.ts');
  });

  it('preserves dots, hyphens, underscores', () => {
    expect(FileSanitizer.sanitizeFileName('my-file_v2.ts')).toBe('my-file_v2.ts');
  });

  it('replaces special characters', () => {
    expect(FileSanitizer.sanitizeFileName('file@#$.ts')).toBe('file___.ts');
  });
});

describe('FileSanitizer.validateExtension', () => {
  it('returns true for allowed extension', () => {
    expect(FileSanitizer.validateExtension('App.tsx', ['.tsx', '.ts'])).toBe(true);
  });

  it('returns false for disallowed extension', () => {
    expect(FileSanitizer.validateExtension('App.php', ['.tsx', '.ts'])).toBe(false);
  });
});
