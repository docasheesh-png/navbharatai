import { describe, it, expect } from 'vitest';
import path from 'path';
import { FileSanitizer } from './FileSanitizer';
import { ValidationError } from './errors/AppMakerErrors';

describe('FileSanitizer', () => {
  describe('resolveSafePath', () => {
    const root = '/workspace/project';

    it('resolves a valid relative path inside the root', () => {
      const resolved = FileSanitizer.resolveSafePath(root, 'src/index.ts');
      expect(resolved).toBe(path.resolve(root, 'src/index.ts'));
    });

    it('resolves the root itself', () => {
      const resolved = FileSanitizer.resolveSafePath(root, '.');
      expect(resolved).toBe(path.resolve(root));
    });

    it('throws ValidationError for "../" traversal', () => {
      expect(() => FileSanitizer.resolveSafePath(root, '../../etc/passwd')).toThrow(ValidationError);
    });

    it('throws ValidationError for an absolute path outside the root', () => {
      expect(() => FileSanitizer.resolveSafePath(root, '/etc/passwd')).toThrow(ValidationError);
    });

    it('throws for a sibling directory that shares a name prefix with root', () => {
      // "/workspace/project-evil" starts with "/workspace/project" as a string,
      // but is NOT inside it as a path — must still be rejected.
      expect(() => FileSanitizer.resolveSafePath(root, '../project-evil/file.ts')).toThrow(ValidationError);
    });
  });

  describe('sanitizeFileName', () => {
    it('replaces spaces and slashes with underscores', () => {
      expect(FileSanitizer.sanitizeFileName('my file/name.txt')).toBe('my_file_name.txt');
    });

    it('preserves dots, hyphens, and alphanumeric characters', () => {
      expect(FileSanitizer.sanitizeFileName('My-File_v2.test.ts')).toBe('My-File_v2.test.ts');
    });

    it('replaces null bytes and other special characters', () => {
      expect(FileSanitizer.sanitizeFileName('evil\0name.ts')).toBe('evil_name.ts');
    });
  });

  describe('validateExtension', () => {
    it('returns true when the extension is in allowedExtensions', () => {
      expect(FileSanitizer.validateExtension('index.ts', ['.ts', '.tsx'])).toBe(true);
    });

    it('returns false when the extension is not allowed', () => {
      expect(FileSanitizer.validateExtension('index.exe', ['.ts', '.tsx'])).toBe(false);
    });

    it('returns false for a file with no extension', () => {
      expect(FileSanitizer.validateExtension('README', ['.ts', '.tsx'])).toBe(false);
    });
  });
});
