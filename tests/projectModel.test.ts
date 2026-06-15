import { describe, it, expect } from 'vitest';
import { VirtualFileSystem, normalizePath, looksBinary } from '../src/server/project/ProjectModel';

describe('normalizePath', () => {
  it('strips leading slashes and ./, collapses ..', () => {
    expect(normalizePath('/src/index.ts')).toBe('src/index.ts');
    expect(normalizePath('./a/b')).toBe('a/b');
    expect(normalizePath('a/../b/c')).toBe('b/c');
    expect(normalizePath('a\\b\\c')).toBe('a/b/c');
    expect(normalizePath('')).toBe('');
  });

  it('prevents path traversal escaping the root', () => {
    expect(normalizePath('../../etc/passwd')).toBe('etc/passwd');
  });
});

describe('looksBinary', () => {
  it('detects data URLs, binary extensions and NUL bytes', () => {
    expect(looksBinary('a.png', '')).toBe(true);
    expect(looksBinary('x.txt', 'data:image/png;base64,AAAA')).toBe(true);
    expect(looksBinary('x.txt', 'hello\u0000world')).toBe(true);
    expect(looksBinary('index.ts', 'const a = 1;')).toBe(false);
  });
});

describe('VirtualFileSystem', () => {
  it('writes, reads and counts files with no size caps', () => {
    const vfs = new VirtualFileSystem();
    const big = 'x'.repeat(200_000); // way over the old 60KB cap — must be kept
    vfs.write('src/big.ts', big);
    vfs.write('/index.html', '<h1>hi</h1>');
    expect(vfs.count).toBe(2);
    expect(vfs.readText('src/big.ts')!.length).toBe(200_000);
    expect(vfs.has('index.html')).toBe(true);
    expect(vfs.read('index.html')!.encoding).toBe('utf8');
  });

  it('round-trips legacy Record both ways', () => {
    const record = { 'index.html': '<html></html>', 'src/a.ts': 'export const a = 1;' };
    const vfs = VirtualFileSystem.fromRecord(record);
    expect(vfs.count).toBe(2);
    expect(vfs.toRecord()).toEqual(record);
  });

  it('handles binary content via base64 and decodes back', () => {
    const vfs = new VirtualFileSystem();
    const b64 = Buffer.from('PNGDATA').toString('base64');
    vfs.write('img/logo.png', b64, 'base64');
    const f = vfs.read('img/logo.png')!;
    expect(f.encoding).toBe('base64');
    expect(vfs.readText('img/logo.png')).toBe('PNGDATA');
  });

  it('renames and deletes', () => {
    const vfs = new VirtualFileSystem();
    vfs.write('a.ts', '1');
    expect(vfs.rename('a.ts', 'b.ts')).toBe(true);
    expect(vfs.has('a.ts')).toBe(false);
    expect(vfs.readText('b.ts')).toBe('1');
    expect(vfs.delete('b.ts')).toBe(true);
    expect(vfs.count).toBe(0);
  });

  it('builds a nested file tree', () => {
    const vfs = VirtualFileSystem.fromRecord({
      'src/index.ts': 'a', 'src/lib/util.ts': 'b', 'README.md': 'c',
    });
    const tree = vfs.tree();
    const top = (tree.children || []).map(c => `${c.type}:${c.name}`).sort();
    expect(top).toEqual(['dir:src', 'file:README.md']);
    const src = tree.children!.find(c => c.name === 'src')!;
    expect((src.children || []).map(c => c.name).sort()).toEqual(['index.ts', 'lib']);
  });

  it('tracks total bytes', () => {
    const vfs = new VirtualFileSystem();
    vfs.write('a.ts', 'abc');
    vfs.write('b.ts', 'de');
    expect(vfs.totalBytes).toBe(5);
  });
});
