import { describe, it, expect } from 'vitest';
import { gunzipSync } from 'zlib';
import { execSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildTarGz, ustarNameSplit, tarHeader, shouldBulkLand, bulkLandEnabled } from './BulkLanding';

// ROOT CAUSE (self-import autopsy 2026-08-03): landing a 2573-file repo took 109s vs 49s for 316 —
// every file was its own sandbox round trip, so cost was LINEAR in file count. Bulk landing sends ONE
// tar.gz and expands it in the sandbox: O(1) round trips. These tests prove the archive we hand-build
// is a REAL tar that the real `tar` binary extracts byte-exact — the assumption everything rests on.
describe('ustarNameSplit — what the archive format can carry', () => {
  it('keeps a short path in the name field', () => {
    expect(ustarNameSplit('src/App.tsx')).toEqual({ name: 'src/App.tsx', prefix: '' });
  });

  it('splits a long path across prefix + name at a slash', () => {
    const long = 'src/' + 'a/'.repeat(45) + 'Component.tsx'; // > 100 chars
    const split = ustarNameSplit(long)!;
    expect(split).not.toBeNull();
    expect(split.name.length).toBeLessThanOrEqual(100);
    expect(split.prefix.length).toBeLessThanOrEqual(155);
    expect(`${split.prefix}/${split.name}`).toBe(long); // rejoins EXACTLY
  });

  it('REFUSES anything unsafe or unrepresentable (caller falls back per-file, never drops it)', () => {
    expect(ustarNameSplit('../escape.ts')).toBeNull();      // path traversal
    expect(ustarNameSplit('/abs/path.ts')).toBeNull();      // absolute
    expect(ustarNameSplit('a/../../b.ts')).toBeNull();      // traversal mid-path
    expect(ustarNameSplit('emoji-日本語.ts')).toBeNull();    // non-ASCII (ustar counts bytes)
    expect(ustarNameSplit('x'.repeat(300))).toBeNull();     // too long for prefix+name
    expect(ustarNameSplit('')).toBeNull();
  });

  it('normalises a leading ./', () => {
    expect(ustarNameSplit('./src/a.ts')).toEqual({ name: 'src/a.ts', prefix: '' });
  });
});

describe('tarHeader — a valid 512-byte ustar header', () => {
  it('is exactly one block, ustar-magic, with a correct checksum', () => {
    const h = tarHeader('a.txt', '', 5);
    expect(h).toHaveLength(512);
    expect(h.toString('ascii', 257, 262)).toBe('ustar');
    expect(h.toString('ascii', 156, 157)).toBe('0'); // regular file
    // Checksum must equal the sum of all bytes with the checksum field read as spaces.
    const stored = parseInt(h.toString('ascii', 148, 154).trim(), 8);
    const copy = Buffer.from(h);
    copy.write('        ', 148, 8, 'ascii');
    let sum = 0;
    for (const b of copy) sum += b;
    expect(stored).toBe(sum);
  });

  it('is deterministic — the same input yields identical bytes (no spurious diffs)', () => {
    expect(tarHeader('a.txt', '', 5).equals(tarHeader('a.txt', '', 5))).toBe(true);
  });
});

describe('buildTarGz', () => {
  it('gzips a real tar and ends with the two zero blocks', () => {
    const { gz, included } = buildTarGz({ 'a.txt': 'hello' });
    expect(included).toEqual(['a.txt']);
    const tar = gunzipSync(gz);
    expect(tar.length % 512).toBe(0);
    const tail = tar.subarray(tar.length - 1024);
    expect(tail.every((b) => b === 0)).toBe(true);
  });

  it('reports unrepresentable paths as EXCLUDED instead of dropping them silently', () => {
    const { included, excluded } = buildTarGz({ 'ok.ts': 'x', 'emoji-日本語.ts': 'y', '../bad.ts': 'z' });
    expect(included).toEqual(['ok.ts']);
    expect(excluded.sort()).toEqual(['../bad.ts', 'emoji-日本語.ts']);
  });

  it('skips non-string content without throwing', () => {
    const { included, excluded } = buildTarGz({ 'a.ts': 'x', 'b.ts': undefined as unknown as string });
    expect(included).toEqual(['a.ts']);
    expect(excluded).toEqual(['b.ts']);
  });

  it('handles an empty file (zero-length data block)', () => {
    const { gz, included } = buildTarGz({ 'empty.ts': '' });
    expect(included).toEqual(['empty.ts']);
    expect(gunzipSync(gz).length % 512).toBe(0);
  });
});

// THE load-bearing test: the real `tar` binary must extract what we built, byte-exact. If this ever
// fails, the fast path is wrong at the format level and the fallback is the only thing saving imports.
describe('buildTarGz — round-trips through the REAL tar binary', () => {
  it('extracts every included file with identical content', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nbai-tar-'));
    try {
      const files: Record<string, string> = {
        'package.json': '{"name":"x"}',
        'src/App.tsx': 'export default function App(){ return null; }\n',
        ['src/' + 'deep/'.repeat(20) + 'Nested.tsx']: 'export const N = 1;', // exercises prefix split
        'a/b/c/d.txt': 'hello\nworld\n',
        'empty.ts': '',
        'unicode-content.ts': "export const s = '日本語 — em dash';\n", // ASCII path, UTF-8 CONTENT
      };
      const { gz, included, excluded } = buildTarGz(files);
      expect(excluded).toEqual([]);
      writeFileSync(join(dir, 'b.tar.gz'), gz);
      execSync(`tar -xzf b.tar.gz --overwrite`, { cwd: dir });
      for (const p of included) {
        expect(existsSync(join(dir, p))).toBe(true);
        expect(readFileSync(join(dir, p), 'utf8')).toBe(files[p]);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('bulk-landing gates', () => {
  it('only pays the two extra round trips for imports big enough to benefit', () => {
    expect(shouldBulkLand(1)).toBe(false);
    expect(shouldBulkLand(39)).toBe(false);
    expect(shouldBulkLand(40)).toBe(true);
    expect(shouldBulkLand(2540)).toBe(true);
  });

  it('has an env kill switch that forces the proven per-file path', () => {
    const prev = process.env.AGENTV3_BULK_LAND;
    try {
      expect(bulkLandEnabled()).toBe(true);
      process.env.AGENTV3_BULK_LAND = 'off';
      expect(bulkLandEnabled()).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.AGENTV3_BULK_LAND; else process.env.AGENTV3_BULK_LAND = prev;
    }
  });
});
