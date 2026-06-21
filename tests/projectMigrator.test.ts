import { describe, it, expect } from 'vitest';
import { migrateLegacyFiles, migrateLegacyLastApp, migrateLegacySession } from '../src/server/project/ProjectMigrator';

describe('migrateLegacyFiles', () => {
  it('creates a VFS from a record of files', () => {
    const { vfs } = migrateLegacyFiles({ 'index.html': '<h1>Hello</h1>' });
    expect(vfs.readText('index.html')).toBe('<h1>Hello</h1>');
  });

  it('creates an empty VFS for null input', () => {
    const { vfs } = migrateLegacyFiles(null);
    expect(vfs.count).toBe(0);
  });

  it('takes a version snapshot when files are present', () => {
    const { versions } = migrateLegacyFiles({ 'index.html': '<h1>Hi</h1>' });
    expect(versions.list().length).toBeGreaterThan(0);
  });

  it('does not take snapshot for empty files', () => {
    const { versions } = migrateLegacyFiles({});
    expect(versions.list()).toHaveLength(0);
  });
});

describe('migrateLegacyLastApp', () => {
  it('migrates an HTML string into index.html', () => {
    const { vfs } = migrateLegacyLastApp('<html></html>');
    expect(vfs.readText('index.html')).toBe('<html></html>');
  });

  it('creates empty VFS for null lastApp', () => {
    const { vfs } = migrateLegacyLastApp(null);
    expect(vfs.count).toBe(0);
  });
});

describe('migrateLegacySession', () => {
  it('uses files object when present', () => {
    const { vfs } = migrateLegacySession({ files: { 'app.tsx': 'export default () => null' } });
    expect(vfs.readText('app.tsx')).toBeDefined();
  });

  it('falls back to lastApp when files is empty', () => {
    const { vfs } = migrateLegacySession({ files: {}, lastApp: '<h1>App</h1>' });
    expect(vfs.readText('index.html')).toBe('<h1>App</h1>');
  });

  it('handles session with no files and no lastApp', () => {
    const { vfs } = migrateLegacySession({});
    expect(vfs.count).toBe(0);
  });
});
