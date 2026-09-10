import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  packWorkspaceArchive, readArchive, safeArchivePath, splitTarName, isExcludedFromArchive,
  ARCHIVE_EXCLUDES, ARCHIVE_MTIME,
} from '../src/server/AgentV3/sourceArchive';

/**
 * The user's app packed for Cloud Build (ROADMAP §11, slice 1b).
 *
 * Cloud Build reads source from a Cloud Storage object that must be a gzipped tarball, and the project
 * carries three ZIP libraries and no tar one. Rather than assume a zip would be accepted — an
 * assumption that would fail in production and nowhere else — this writes real ustar bytes, and these
 * tests read them back with the SYSTEM tar as well as with our own reader, because a format only our
 * own code can read proves nothing about what Google will accept.
 */
describe('safeArchivePath — an archive entry is never a path-traversal write', () => {
  it('keeps ordinary relative paths, normalising the leading ./', () => {
    expect(safeArchivePath('src/App.tsx')).toBe('src/App.tsx');
    expect(safeArchivePath('./package.json')).toBe('package.json');
    expect(safeArchivePath('a\\b.txt')).toBe('a/b.txt');
  });

  it('🔒 refuses absolute paths, traversal and NULs', () => {
    for (const p of ['/etc/passwd', '../../etc/passwd', 'a/../../b', 'a/./b', '', '   ', 'a\0b']) {
      expect(safeArchivePath(p), p).toBe('');
    }
  });
});

describe('splitTarName — long paths use ustar\'s prefix field, or are refused outright', () => {
  it('a short name needs no prefix', () => {
    expect(splitTarName('src/App.tsx')).toEqual({ name: 'src/App.tsx', prefix: '' });
  });

  it('a long path splits at a directory boundary', () => {
    const p = `${'d'.repeat(90)}/${'e'.repeat(80)}/file.ts`;
    const s = splitTarName(p)!;
    expect(s).not.toBeNull();
    expect(`${s.prefix}/${s.name}`).toBe(p);
    expect(Buffer.byteLength(s.name)).toBeLessThanOrEqual(100);
    expect(Buffer.byteLength(s.prefix)).toBeLessThanOrEqual(155);
  });

  it('🔒 a name that cannot be represented is null — never silently truncated', () => {
    // A truncated name is a file the build cannot find, reported as a missing import nobody can trace.
    expect(splitTarName(`${'x'.repeat(140)}.ts`)).toBeNull();
  });
});

describe('excludes — what must never reach the builder', () => {
  it('🔒 node_modules is excluded, because buildpacks install for the RIGHT platform', () => {
    // Shipping a local copy uploads hundreds of megabytes to produce a worse image: the wrong
    // platform's native binaries.
    expect(isExcludedFromArchive('node_modules/react/index.js')).toBe(true);
    expect(isExcludedFromArchive('client/node_modules/x.js')).toBe(true);
    expect(ARCHIVE_EXCLUDES).toContain('node_modules/');
  });

  it('build output and VCS noise are excluded; real source never is', () => {
    for (const p of ['dist/app.js', '.git/config', 'coverage/x', '__pycache__/a.pyc', '.next/y']) {
      expect(isExcludedFromArchive(p), p).toBe(true);
    }
    for (const p of ['src/App.tsx', 'package.json', 'server/index.js', 'app.py', 'src/dist-helper.ts']) {
      expect(isExcludedFromArchive(p), p).toBe(false);
    }
  });
});

describe('packWorkspaceArchive', () => {
  const files = {
    'package.json': '{"name":"mitrify","scripts":{"start":"node server.js"}}',
    'server.js': 'require("express")();\n',
    'src/App.tsx': 'export default function App(){return <div>hi</div>}\n',
    'node_modules/react/index.js': 'IGNORED',
    'dist/bundle.js': 'IGNORED',
  };

  it('packs the real source and reports what it left out', () => {
    const r = packWorkspaceArchive(files);
    expect(r.packed).toEqual(['package.json', 'server.js', 'src/App.tsx']);
    expect(r.excluded).toBe(2);
    expect(r.skipped).toEqual([]);
  });

  it('round-trips every file byte-for-byte', () => {
    const r = packWorkspaceArchive(files);
    const back = readArchive(r.data);
    for (const p of r.packed) expect(back[p], p).toBe((files as Record<string, string>)[p]);
    expect(Object.keys(back).sort()).toEqual(r.packed);
  });

  it('🔒 THE REAL TEST: the SYSTEM tar can read it — our own reader agreeing proves nothing about Google', () => {
    const r = packWorkspaceArchive(files);
    const dir = mkdtempSync(join(tmpdir(), 'nbai-tar-'));
    try {
      const archive = join(dir, 'src.tar.gz');
      writeFileSync(archive, r.data);
      // -t lists, and tar exits non-zero on a malformed archive, so this asserts validity as well.
      const listed = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' })
        .split('\n').map((s) => s.trim()).filter(Boolean).sort();
      expect(listed).toEqual(r.packed.slice().sort());
      execFileSync('tar', ['-xzf', archive, '-C', dir]);
      expect(readFileSync(join(dir, 'src/App.tsx'), 'utf8')).toBe(files['src/App.tsx']);
      expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe(files['package.json']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('handles content whose length is not a multiple of the block size, and empty files', () => {
    const odd = { 'a.txt': 'x'.repeat(513), 'b.txt': '', 'c.txt': 'y'.repeat(512) };
    const back = readArchive(packWorkspaceArchive(odd).data);
    expect(back).toEqual(odd);
  });

  it('unicode content survives, and its byte length is what is written', () => {
    const u = { 'hi.txt': 'नमस्ते दुनिया — ₹1,250\n' };
    expect(readArchive(packWorkspaceArchive(u).data)['hi.txt']).toBe(u['hi.txt']);
  });

  it('🔒 an unpackable file is REPORTED, never dropped in silence', () => {
    const bad = {
      'ok.txt': 'fine',
      '../escape.txt': 'nope',
      [`${'x'.repeat(140)}.ts`]: 'nope',
    } as Record<string, string>;
    const r = packWorkspaceArchive(bad);
    expect(r.packed).toEqual(['ok.txt']);
    expect(r.skipped.map((s) => s.reason).sort()).toEqual(['name-too-long', 'unsafe-path']);
  });

  it('🔒 deterministic — the same source produces the same bytes', () => {
    // Fixed timestamps, sorted entries: a rebuild of unchanged code is recognisably unchanged.
    expect(ARCHIVE_MTIME).toBe(0);
    expect(packWorkspaceArchive(files).data.equals(packWorkspaceArchive(files).data)).toBe(true);
    // Key order in the input must not change the output either.
    const reordered = Object.fromEntries(Object.entries(files).reverse());
    expect(packWorkspaceArchive(reordered).data.equals(packWorkspaceArchive(files).data)).toBe(true);
  });

  it('an empty workspace still produces a valid (empty) archive rather than throwing', () => {
    const r = packWorkspaceArchive({});
    expect(r.packed).toEqual([]);
    expect(readArchive(r.data)).toEqual({});
  });
});
