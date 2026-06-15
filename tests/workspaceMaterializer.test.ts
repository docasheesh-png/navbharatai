import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { VirtualFileSystem } from '../src/server/project/ProjectModel';
import { materializeWorkspace, cleanupWorkspace } from '../src/server/runtime/WorkspaceMaterializer';

let lastDir = '';
afterEach(() => { if (lastDir) { cleanupWorkspace(lastDir); lastDir = ''; } });

describe('materializeWorkspace', () => {
  it('writes a multi-file project (with nested dirs) to disk', () => {
    const vfs = VirtualFileSystem.fromRecord({
      'package.json': '{"name":"x"}',
      'src/index.ts': 'export const a = 1;',
      'src/lib/util.ts': 'export const b = 2;',
    });
    const { dir, fileCount } = materializeWorkspace(vfs);
    lastDir = dir;
    expect(fileCount).toBe(3);
    expect(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).toBe('{"name":"x"}');
    expect(fs.readFileSync(path.join(dir, 'src/lib/util.ts'), 'utf8')).toBe('export const b = 2;');
  });

  it('decodes base64 binary files', () => {
    const vfs = new VirtualFileSystem();
    vfs.write('img/logo.png', Buffer.from('PNGDATA').toString('base64'), 'base64');
    const { dir } = materializeWorkspace(vfs);
    lastDir = dir;
    expect(fs.readFileSync(path.join(dir, 'img/logo.png')).toString()).toBe('PNGDATA');
  });

  it('confines writes to the workspace root (no path traversal)', () => {
    // VFS normalizes '../' away on write, so the stored path is already safe;
    // verify the materialized file stays under the root.
    const vfs = new VirtualFileSystem();
    vfs.write('../escape.txt', 'nope');
    const { dir } = materializeWorkspace(vfs);
    lastDir = dir;
    expect(fs.existsSync(path.join(dir, 'escape.txt'))).toBe(true);
    expect(fs.existsSync(path.resolve(dir, '..', 'escape.txt'))).toBe(false);
  });

  it('cleanupWorkspace removes the dir', () => {
    const { dir } = materializeWorkspace(VirtualFileSystem.fromRecord({ 'a.txt': '1' }));
    expect(fs.existsSync(dir)).toBe(true);
    cleanupWorkspace(dir);
    expect(fs.existsSync(dir)).toBe(false);
  });
});
