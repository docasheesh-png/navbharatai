import { describe, it, expect } from 'vitest';
import path from 'path';
import { FileSanitizer } from '../src/server/AppMakerLab/FileSanitizer';

const ROOT = '/workspace/project';

describe('FileSanitizer.resolveSafePath', () => {
  it('resolves a safe relative path within the root', () => {
    const result = FileSanitizer.resolveSafePath(ROOT, 'src/App.tsx');
    expect(result).toBe(path.resolve(ROOT, 'src/App.tsx'));
  });

  it('resolves a nested safe path', () => {
    const result = FileSanitizer.resolveSafePath(ROOT, 'src/components/Button.tsx');
    expect(result).toBe(path.resolve(ROOT, 'src/components/Button.tsx'));
  });

  it('resolves the root itself when given "."', () => {
    const result = FileSanitizer.resolveSafePath(ROOT, '.');
    expect(result).toBe(path.resolve(ROOT));
  });

  it('throws on classic path traversal (../..)', () => {
    expect(() => FileSanitizer.resolveSafePath(ROOT, '../../etc/passwd')).toThrow();
  });

  it('throws on traversal that stays outside root', () => {
    expect(() => FileSanitizer.resolveSafePath(ROOT, '../sibling/secret.txt')).toThrow();
  });

  it('throws on absolute path outside root', () => {
    expect(() => FileSanitizer.resolveSafePath(ROOT, '/tmp/evil')).toThrow();
  });

  it('error message mentions the unsafe path', () => {
    expect(() => FileSanitizer.resolveSafePath(ROOT, '../../etc/passwd')).toThrow('../../etc/passwd');
  });
});

describe('FileSanitizer.sanitizeFileName', () => {
  it('preserves safe alphanumeric + dot + dash + underscore', () => {
    expect(FileSanitizer.sanitizeFileName('App.tsx')).toBe('App.tsx');
    expect(FileSanitizer.sanitizeFileName('my-file_v2.ts')).toBe('my-file_v2.ts');
  });

  it('replaces spaces with underscores', () => {
    expect(FileSanitizer.sanitizeFileName('my file.ts')).toBe('my_file.ts');
  });

  it('replaces slashes with underscores (dots and dashes are preserved)', () => {
    // regex: [^a-zA-Z0-9.\-_] → dots and dashes kept, slashes replaced
    expect(FileSanitizer.sanitizeFileName('../evil/path')).toBe('.._evil_path');
  });
});

describe('FileSanitizer.validateExtension', () => {
  it('returns true for an allowed extension', () => {
    expect(FileSanitizer.validateExtension('App.tsx', ['.tsx', '.ts'])).toBe(true);
  });

  it('returns false for a disallowed extension', () => {
    expect(FileSanitizer.validateExtension('evil.sh', ['.tsx', '.ts'])).toBe(false);
  });

  it('returns false when the allowed list is empty', () => {
    expect(FileSanitizer.validateExtension('App.tsx', [])).toBe(false);
  });

  it('handles files with no extension', () => {
    expect(FileSanitizer.validateExtension('Makefile', ['.ts'])).toBe(false);
  });
});
