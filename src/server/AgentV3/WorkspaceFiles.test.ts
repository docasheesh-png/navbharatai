import { describe, it, expect } from 'vitest';
import { collectWorkspaceFiles, writeWorkspaceFiles, type WorkspaceFileSource, type WorkspaceFileSink } from './WorkspaceFiles';

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
