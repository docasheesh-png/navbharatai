import { describe, it, expect } from 'vitest';
import { gunzipSync } from 'zlib';
import { splitUstarPath, tarFromFiles, tarGzFromFiles } from './tarGz';

function headerChecksumValid(block: Buffer): boolean {
  const stored = parseInt(block.subarray(148, 156).toString('ascii').replace(/\0.*$/, '').trim(), 8);
  const copy = Buffer.from(block);
  copy.fill(0x20, 148, 156);
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += copy[i];
  return sum === stored;
}

describe('tarGz', () => {
  it('keeps short paths whole and splits long ones at a slash', () => {
    expect(splitUstarPath('src/index.ts')).toEqual({ prefix: '', name: 'src/index.ts' });
    const long = `${'a'.repeat(90)}/${'b'.repeat(90)}/file.ts`;
    const split = splitUstarPath(long)!;
    expect(split).not.toBeNull();
    expect(`${split.prefix}/${split.name}`).toBe(long);
    expect(Buffer.byteLength(split.name)).toBeLessThanOrEqual(100);
    expect(Buffer.byteLength(split.prefix)).toBeLessThanOrEqual(155);
  });

  it('returns null for a path no legal split can carry', () => {
    expect(splitUstarPath('x'.repeat(200))).toBeNull();
  });

  it('writes a valid ustar entry: name, size, magic, checksum, padding, end blocks', () => {
    const body = 'hello world';
    const tar = tarFromFiles({ 'dir/hello.txt': body });
    const header = tar.subarray(0, 512);
    expect(header.subarray(0, 13).toString('utf8')).toBe('dir/hello.txt');
    expect(parseInt(header.subarray(124, 136).toString('ascii'), 8)).toBe(body.length);
    expect(header.subarray(257, 262).toString('ascii')).toBe('ustar');
    expect(headerChecksumValid(header)).toBe(true);
    expect(tar.subarray(512, 512 + body.length).toString('utf8')).toBe(body);
    // body padded to 512, then two zero end blocks
    expect(tar.length).toBe(512 + 512 + 1024);
    expect(tar.subarray(tar.length - 1024).every((b) => b === 0)).toBe(true);
  });

  it('is deterministic: same files → byte-identical tarball, sorted by path', () => {
    const a = tarFromFiles({ 'b.txt': '2', 'a.txt': '1' });
    const b = tarFromFiles({ 'a.txt': '1', 'b.txt': '2' });
    expect(a.equals(b)).toBe(true);
    expect(a.subarray(0, 5).toString('utf8')).toBe('a.txt');
  });

  it('tarGzFromFiles gunzips back to the exact tar', () => {
    const files = { 'x.js': 'console.log(1)' };
    expect(gunzipSync(tarGzFromFiles(files)).equals(tarFromFiles(files))).toBe(true);
  });
});
