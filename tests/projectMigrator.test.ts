import { describe, it, expect } from 'vitest';
import { migrateLegacyFiles, migrateLegacyLastApp, migrateLegacySession } from '../src/server/project/ProjectMigrator';

describe('ProjectMigrator', () => {
  it('migrates a legacy 3-file workspace into VFS + initial snapshot', () => {
    const { vfs, versions } = migrateLegacyFiles({
      'index.html': '<h1>hi</h1>', 'style.css': 'body{}', 'script.js': 'let a=1;',
    });
    expect(vfs.count).toBe(3);
    expect(vfs.readText('script.js')).toBe('let a=1;');
    expect(versions.size).toBe(1); // initial snapshot captured
  });

  it('keeps large files that the old 60KB cap would have dropped', () => {
    const big = 'x'.repeat(200_000);
    const { vfs } = migrateLegacyFiles({ 'big.js': big });
    expect(vfs.readText('big.js')!.length).toBe(200_000);
  });

  it('migrates a legacy lastApp HTML string', () => {
    const { vfs } = migrateLegacyLastApp('<html><body>app</body></html>');
    expect(vfs.has('index.html')).toBe(true);
    expect(vfs.readText('index.html')).toContain('app');
  });

  it('handles empty/missing legacy data without error (no snapshot)', () => {
    const { vfs, versions } = migrateLegacyFiles(null);
    expect(vfs.count).toBe(0);
    expect(versions.size).toBe(0);
    expect(migrateLegacyLastApp(undefined).vfs.count).toBe(0);
  });

  it('migrateLegacySession prefers files, falls back to lastApp', () => {
    expect(migrateLegacySession({ files: { 'a.ts': '1' } }).vfs.has('a.ts')).toBe(true);
    expect(migrateLegacySession({ lastApp: '<p>x</p>' }).vfs.has('index.html')).toBe(true);
    expect(migrateLegacySession({}).vfs.count).toBe(0);
  });
});
