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
