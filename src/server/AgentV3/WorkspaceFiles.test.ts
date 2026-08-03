import { describe, it, expect } from 'vitest';
import { collectWorkspaceFiles, writeWorkspaceFiles, type WorkspaceFileSource, type WorkspaceFileSink, selectImportableFiles} from './WorkspaceFiles';

/** A fake actuator backed by an in-memory path→content map. */
function fakeSource(map: Record<string, string>): WorkspaceFileSource {
  return {
    listFiles: async () => Object.keys(map),
    readFile: async (_ws: string, p: string) => {
      if (!(p in map)) throw new Error(`no such file: ${p}`);
      return map[p];
    },
  };
}

const NUL = String.fromCharCode(0);

describe('collectWorkspaceFiles', () => {
  it('collects source files and excludes node_modules / .git / build output', async () => {
    const src = fakeSource({
      'src/App.tsx': 'export const App = () => null;',
      'package.json': '{"name":"app"}',
      'node_modules/react/index.js': 'module.exports = {};',
      '.git/HEAD': 'ref: refs/heads/main',
      'dist/bundle.js': 'console.log(1)',
      'build/out.js': 'x',
    });
    const { files, skipped } = await collectWorkspaceFiles(src, 'ws-1');
    expect(Object.keys(files).sort()).toEqual(['package.json', 'src/App.tsx']);
    expect(skipped).toEqual(expect.arrayContaining(['node_modules/react/index.js', '.git/HEAD', 'dist/bundle.js', 'build/out.js']));
  });

  it('excludes live .env secrets but keeps .env.example/.sample/.template', async () => {
    const src = fakeSource({
      '.env': 'API_KEY=sk_live_secret',
      '.env.local': 'DB=postgres://u:p@h/db',
      '.env.production': 'X=1',
      '.env.example': 'API_KEY=',
      '.env.sample': 'DB=',
      '.env.template': 'X=',
    });
    const { files } = await collectWorkspaceFiles(src, 'ws-1');
    expect(Object.keys(files).sort()).toEqual(['.env.example', '.env.sample', '.env.template']);
    expect(files['.env']).toBeUndefined();
    expect(files['.env.local']).toBeUndefined();
    expect(files['.env.production']).toBeUndefined();
  });

  it('skips binary files (NUL byte) but keeps text', async () => {
    const src = fakeSource({
      'logo.png': `PNG${NUL}${NUL}binary`,
      'index.html': '<!doctype html><title>ok</title>',
    });
    const { files, skipped } = await collectWorkspaceFiles(src, 'ws-1');
    expect(Object.keys(files)).toEqual(['index.html']);
    expect(skipped).toContain('logo.png');
  });

  it('never fails on an unreadable file — it is skipped, not fatal', async () => {
    const src: WorkspaceFileSource = {
      listFiles: async () => ['a.ts', 'b.ts'],
      readFile: async (_ws, p) => {
        if (p === 'b.ts') throw new Error('gone');
        return 'export const a = 1;';
      },
    };
    const { files, skipped } = await collectWorkspaceFiles(src, 'ws-1');
    expect(Object.keys(files)).toEqual(['a.ts']);
    expect(skipped).toContain('b.ts');
  });

  it('returns the exact map shape the deploy + github-push routes accept', async () => {
    const src = fakeSource({ 'index.html': '<h1>hi</h1>' });
    const { files } = await collectWorkspaceFiles(src, 'ws-1');
    expect(files).toEqual({ 'index.html': '<h1>hi</h1>' });
  });
});

/** A fake sink recording every writeFile into an in-memory map. */
function fakeSink(): WorkspaceFileSink & { written: Record<string, string> } {
  const written: Record<string, string> = {};
  return {
    written,
    writeFile: async (_ws: string, p: string, c: string) => { written[p] = c; },
  };
}

describe('writeWorkspaceFiles (import from GitHub/other into the sandbox)', () => {
  it('writes safe project files into the sandbox', async () => {
    const sink = fakeSink();
    const { written } = await writeWorkspaceFiles(sink, 'ws-1', {
      'src/App.tsx': 'export const App = () => null;',
      'package.json': '{"name":"app"}',
    });
    expect(written.sort()).toEqual(['package.json', 'src/App.tsx']);
    expect(sink.written['src/App.tsx']).toContain('export const App');
  });

  it('rejects path traversal, absolute paths and NUL — never escapes the workspace', async () => {
    const sink = fakeSink();
    const { written, skipped } = await writeWorkspaceFiles(sink, 'ws-1', {
      '../etc/passwd': 'root:x:0:0',
      '/abs/secret': 'x',
      'a/../../b': 'y',
      'ok.txt': 'fine',
    });
    expect(written).toEqual(['ok.txt']);
    expect(skipped).toEqual(expect.arrayContaining(['../etc/passwd', '/abs/secret', 'a/../../b']));
    expect(Object.keys(sink.written)).toEqual(['ok.txt']);
  });

  it('does not import node_modules / .git or live .env secrets', async () => {
    const sink = fakeSink();
    const { written } = await writeWorkspaceFiles(sink, 'ws-1', {
      'node_modules/x/i.js': 'm',
      '.git/config': 'c',
      '.env': 'API_KEY=sk_live',
      '.env.example': 'API_KEY=',
      'index.html': '<h1>ok</h1>',
    });
    expect(written.sort()).toEqual(['.env.example', 'index.html']);
  });

  it('never fails on a write error — that path is skipped, not fatal', async () => {
    const sink: WorkspaceFileSink = {
      writeFile: async (_ws, p) => { if (p === 'bad.ts') throw new Error('disk full'); },
    };
    const { written, skipped } = await writeWorkspaceFiles(sink, 'ws-1', {
      'good.ts': 'export const x = 1;',
      'bad.ts': 'export const y = 2;',
    });
    expect(written).toEqual(['good.ts']);
    expect(skipped).toContain('bad.ts');
  });
});

// PARALLEL LANDING (autopsy buildId d1623410 — a 2460-file import took ~648s to land).
// Every sandbox write is a network round-trip, so writing them one at a time made the agent wait
// 21 minutes before it could start. Writes are now concurrent — but SELECTION must stay byte-exact,
// because the byte/count budgets are consumed in iteration order.
describe('writeWorkspaceFiles — concurrent writes, identical selection', () => {
  const mkSink = (opts?: { failOn?: string }) => {
    let inFlight = 0;
    const peak = { n: 0 };
    const order: string[] = [];
    return {
      peak,
      order,
      sink: {
        writeFile: async (_ws: string, p: string, _c: string) => {
          inFlight++; peak.n = Math.max(peak.n, inFlight);
          await new Promise((r) => setTimeout(r, 5)); // stand in for network latency
          inFlight--;
          if (opts?.failOn === p) throw new Error('write failed');
          order.push(p);
        },
      } as any,
    };
  };

  it('actually writes concurrently (the whole point of the fix)', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 40; i++) files[`src/f${i}.ts`] = 'x';
    const { sink, peak } = mkSink();
    await writeWorkspaceFiles(sink, 'ws', files);
    expect(peak.n).toBeGreaterThan(1); // sequential would peak at exactly 1
  });

  it('writes every accepted file exactly once', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 25; i++) files[`src/f${i}.ts`] = 'x';
    const { sink, order } = mkSink();
    const res = await writeWorkspaceFiles(sink, 'ws', files);
    expect(res.written.sort()).toEqual(Object.keys(files).sort());
    expect(new Set(order).size).toBe(order.length); // no duplicates
  });

  it('a failed write is reported as skipped, never as written', async () => {
    const files = { 'src/a.ts': 'x', 'src/b.ts': 'x', 'src/c.ts': 'x' };
    const { sink } = mkSink({ failOn: 'src/b.ts' });
    const res = await writeWorkspaceFiles(sink, 'ws', files);
    expect(res.written).not.toContain('src/b.ts');
    expect(res.skipped).toContain('src/b.ts');
    expect(res.written.sort()).toEqual(['src/a.ts', 'src/c.ts']);
  });

  it('selection is unchanged: unsafe paths and non-strings are still skipped', () => {
    const { accepted, skipped } = selectImportableFiles({
      'src/ok.ts': 'x',
      '../escape.ts': 'x',
      '/abs.ts': 'x',
      'bad.ts': 123 as unknown as string,
    });
    expect(accepted.map(([p]) => p)).toEqual(['src/ok.ts']);
    expect(skipped).toEqual(expect.arrayContaining(['../escape.ts', '/abs.ts', 'bad.ts']));
  });

  it('selection stays ORDER-DEPENDENT on the byte budget (parallelism must not change who is chosen)', () => {
    // Two runs over the same input must pick the same files, deterministically.
    const files: Record<string, string> = {};
    for (let i = 0; i < 200; i++) files[`src/f${i}.ts`] = 'y'.repeat(1000);
    const a = selectImportableFiles(files).accepted.map(([p]) => p);
    const b = selectImportableFiles(files).accepted.map(([p]) => p);
    expect(a).toEqual(b);
  });
});

// BULK LANDING (self-import autopsy 2026-08-03) — one archive + one extract instead of one round trip
// per file. The load-bearing requirement is NOT speed, it is that a faster landing can never be a
// PARTIAL one: every failure path must fall back to per-file writes and still land every file.
describe('writeWorkspaceFiles — bulk landing falls back rather than ever losing a file', () => {
  const bigProject = (n: number): Record<string, string> =>
    Object.fromEntries(Array.from({ length: n }, (_, i) => [`src/f${i}.ts`, `export const v${i} = ${i};`]));

  /** A sink that records what it was asked to do. */
  function makeSink(over: Partial<{ extractExit: number; readBack: (p: string) => string | null; failBinary: boolean; extractedCount: number }> = {}) {
    const perFile: string[] = [];
    const commands: string[] = [];
    let binaryUploads = 0;
    let lastArchiveCount = 0;
    const sink = {
      writeFile: async (_w: string, p: string) => { perFile.push(p); },
      writeBinaryFile: async (_w: string, _p: string, b64: string) => {
        binaryUploads++;
        if (over.failBinary) throw new Error('upload failed');
        // Count what the archive really holds, so the fake extract reports the truth by default.
        const { gunzipSync } = await import('zlib');
        const tar = gunzipSync(Buffer.from(b64, 'base64'));
        let n = 0;
        for (let off = 0; off + 512 <= tar.length; ) {
          const name = tar.toString('ascii', off, off + 100).replace(/\0.*$/, '');
          if (!name) break;
          const size = parseInt(tar.toString('ascii', off + 124, off + 135).trim(), 8) || 0;
          n++;
          off += 512 + Math.ceil(size / 512) * 512;
        }
        lastArchiveCount = n;
      },
      runCommand: async (_w: string, c: string) => {
        commands.push(c);
        // Mimic the real command: it echoes how many entries tar actually extracted.
        const n = over.extractedCount !== undefined ? over.extractedCount : lastArchiveCount;
        return { exitCode: over.extractExit ?? 0, stdout: `NBAI_EXTRACTED:${n}\n`, stderr: '' };
      },
      readFile: async (_w: string, p: string) => {
        const v = over.readBack ? over.readBack(p) : `export const v${p.match(/f(\d+)/)?.[1]} = ${p.match(/f(\d+)/)?.[1]};`;
        if (v === null) throw new Error('missing');
        return v;
      },
    };
    return { sink, perFile, commands, get binaryUploads() { return binaryUploads; } };
  }

  it('lands a big import in TWO round trips — no per-file writes at all', async () => {
    const files = bigProject(200);
    const h = makeSink();
    const res = await writeWorkspaceFiles(h.sink, 'ws', files);
    expect(res.written).toHaveLength(200);
    expect(h.binaryUploads).toBe(1);                       // one archive
    expect(h.commands[0]).toContain('tar -xzvf');          // one extract, verbose so it can be COUNTED
    expect(h.perFile).toHaveLength(0);                     // ZERO per-file round trips
  });

  it('keeps the per-file path for a SMALL import (the two extra calls would not pay back)', async () => {
    const h = makeSink();
    const res = await writeWorkspaceFiles(h.sink, 'ws', bigProject(5));
    expect(res.written).toHaveLength(5);
    expect(h.binaryUploads).toBe(0);
    expect(h.perFile).toHaveLength(5);
  });

  it('FALLS BACK to per-file when tar exits non-zero — every file still lands', async () => {
    const files = bigProject(60);
    const h = makeSink({ extractExit: 2 });
    const res = await writeWorkspaceFiles(h.sink, 'ws', files);
    expect(res.written).toHaveLength(60);                  // nothing lost
    expect(h.perFile).toHaveLength(60);                    // proven by the slow path
    expect(h.commands.some((c) => c.startsWith('rm -f'))).toBe(true); // archive cleaned up
  });

  it('FALLS BACK when the verification read-back does not match (extract hit the wrong place)', async () => {
    const files = bigProject(60);
    const h = makeSink({ readBack: () => 'WRONG CONTENT' });
    const res = await writeWorkspaceFiles(h.sink, 'ws', files);
    expect(res.written).toHaveLength(60);
    expect(h.perFile).toHaveLength(60);                    // did not trust an unproven extraction
  });

  it('FALLS BACK when the archive upload itself throws', async () => {
    const files = bigProject(60);
    const h = makeSink({ failBinary: true });
    const res = await writeWorkspaceFiles(h.sink, 'ws', files);
    expect(res.written).toHaveLength(60);
    expect(h.perFile).toHaveLength(60);
  });

  it('uses the per-file path when the sink cannot do bulk at all (no writeBinaryFile/runCommand)', async () => {
    const written: string[] = [];
    const plain = { writeFile: async (_w: string, p: string) => { written.push(p); } };
    const res = await writeWorkspaceFiles(plain, 'ws', bigProject(100));
    expect(res.written).toHaveLength(100);
    expect(written).toHaveLength(100);
  });

  it('writes archive-unrepresentable paths individually so nothing is skipped', async () => {
    const files = { ...bigProject(60), 'src/日本語.ts': 'export const jp = 1;' };
    const h = makeSink();
    const res = await writeWorkspaceFiles(h.sink, 'ws', files);
    expect(res.written).toHaveLength(61);                  // all 61 landed
    expect(h.perFile).toEqual(['src/日本語.ts']);           // exactly the one tar can't carry
  });

  it('respects the AGENTV3_BULK_LAND=off kill switch', async () => {
    const prev = process.env.AGENTV3_BULK_LAND;
    process.env.AGENTV3_BULK_LAND = 'off';
    try {
      const h = makeSink();
      const res = await writeWorkspaceFiles(h.sink, 'ws', bigProject(100));
      expect(res.written).toHaveLength(100);
      expect(h.binaryUploads).toBe(0);
      expect(h.perFile).toHaveLength(100);
    } finally {
      if (prev === undefined) delete process.env.AGENTV3_BULK_LAND; else process.env.AGENTV3_BULK_LAND = prev;
    }
  });
});

// DATA-LOSS AUTOPSY (admin build report 2026-08-03): a live import ended with the sandbox holding
// 2034 of 2543 files — a 20% SHORT landing. Whatever caused it, the verification I shipped could not
// have caught it: a 5-file sample passes easily when 80% of files are present. The count check below
// is the fix, and these tests are its proof.
describe('writeWorkspaceFiles — a SHORT extraction can never pass verification', () => {
  const project = (n: number): Record<string, string> =>
    Object.fromEntries(Array.from({ length: n }, (_, i) => [`src/f${i}.ts`, `export const v${i} = ${i};`]));

  function sinkReporting(extractedCount: number) {
    const perFile: string[] = [];
    const sink = {
      writeFile: async (_w: string, p: string) => { perFile.push(p); },
      writeBinaryFile: async () => {},
      runCommand: async () => ({ exitCode: 0, stdout: `NBAI_EXTRACTED:${extractedCount}\n`, stderr: '' }),
      readFile: async (_w: string, p: string) => `export const v${p.match(/f(\d+)/)?.[1]} = ${p.match(/f(\d+)/)?.[1]};`,
    };
    return { sink, perFile };
  }

  it('falls back when tar reports FEWER files than we archived (the exact 2034-of-2543 shape)', async () => {
    const files = project(100);
    const h = sinkReporting(80); // 20% short — a sample check would have sailed straight past this
    const res = await writeWorkspaceFiles(h.sink, 'ws', files);
    expect(res.written).toHaveLength(100);   // nothing lost — the slow path landed everything
    expect(h.perFile).toHaveLength(100);
    expect(res.landedVia).toBe('per-file');  // and the report says so honestly
  });

  it('falls back when the count cannot be read at all (never trusts an unparseable result)', async () => {
    const h = sinkReporting(NaN as unknown as number);
    const res = await writeWorkspaceFiles({ ...h.sink, runCommand: async () => ({ exitCode: 0, stdout: 'no marker here', stderr: '' }) }, 'ws', project(100));
    expect(res.written).toHaveLength(100);
    expect(res.landedVia).toBe('per-file');
  });

  it('accepts only an EXACT count match, and records how many were verified', async () => {
    const h = sinkReporting(100);
    const res = await writeWorkspaceFiles(h.sink, 'ws', project(100));
    expect(res.written).toHaveLength(100);
    expect(h.perFile).toHaveLength(0);
    expect(res.landedVia).toBe('bulk');
    expect(res.bulkVerifiedCount).toBe(100);
  });

  it('reports bulk+per-file when tar could not carry some paths (telemetry stays truthful)', async () => {
    const files = { ...project(100), 'src/日本語.ts': 'export const jp = 1;' };
    const h = sinkReporting(100); // the 100 ASCII paths; the unicode one goes per-file
    const res = await writeWorkspaceFiles(h.sink, 'ws', files);
    expect(res.written).toHaveLength(101);
    expect(res.landedVia).toBe('bulk+per-file');
    expect(h.perFile).toEqual(['src/日本語.ts']);
  });
});
