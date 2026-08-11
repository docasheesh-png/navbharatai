import { describe, it, expect } from 'vitest';
import { shouldDescend, joinPath, isFolderImportSupported, readFolderInBrowser } from './folderImport';

describe('shouldDescend — reject the huge folders ONCE, not 200,000 times', () => {
  it('never walks into dependency, build or tool-state folders', () => {
    for (const d of ['node_modules', '.git', 'dist', 'build', '.next', 'vendor', 'Pods', '.venv',
                     '.local', '.claude', '.cursor']) {
      expect(shouldDescend(d)).toBe(false);
      expect(shouldDescend(`packages/web/${d}`)).toBe(false);
    }
  });

  it('walks into the folders a project actually lives in', () => {
    for (const d of ['src', 'src/components', 'public', 'server', 'apps/web']) {
      expect(shouldDescend(d)).toBe(true);
    }
  });

  it('does not reject a folder that merely CONTAINS a skip name', () => {
    // "distribution" and "buildings" are ordinary names; only the exact segment is a skip.
    expect(shouldDescend('src/distribution')).toBe(true);
    expect(shouldDescend('src/buildings')).toBe(true);
  });
});

describe('joinPath', () => {
  it('builds project-relative paths without a leading slash', () => {
    expect(joinPath('', 'package.json')).toBe('package.json');
    expect(joinPath('src', 'App.tsx')).toBe('src/App.tsx');
    expect(joinPath('src/components', 'Button.tsx')).toBe('src/components/Button.tsx');
  });
});

describe('isFolderImportSupported', () => {
  it('is false where the API does not exist, so the UI never offers a button that throws', () => {
    // jsdom/node have no showDirectoryPicker — exactly the situation a Firefox or mobile user is in.
    expect(isFolderImportSupported()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// The walk itself, over a fake directory tree. The pure helpers above cannot catch a traversal that
// descends into node_modules anyway, or one that mislabels assets — only running it can.
type FakeEntry = FakeDir | FakeFile;
interface FakeDir { kind: 'directory'; name: string; children: FakeEntry[] }
interface FakeFile { kind: 'file'; name: string; content: string; bytes?: number }

function dir(name: string, children: FakeEntry[]): FakeDir { return { kind: 'directory', name, children }; }
function file(name: string, content: string, bytes?: number): FakeFile { return { kind: 'file', name, content, bytes }; }

/** Minimal stand-in for FileSystemDirectoryHandle — only what readFolderInBrowser actually uses. */
function asHandle(d: FakeDir, visited: string[]): any {
  return {
    kind: 'directory',
    name: d.name,
    async *entries() {
      visited.push(d.name);
      for (const c of d.children) {
        if (c.kind === 'directory') yield [c.name, asHandle(c, visited)];
        else yield [c.name, {
          kind: 'file',
          name: c.name,
          // A plain object, NOT a Blob: `Blob.size` is a read-only getter, so Object.assign-ing a size
          // onto one throws — which the walk would then (correctly) count as an unreadable file, and the
          // test would be measuring its own harness instead of the traversal.
          async getFile() {
            return {
              name: c.name,
              size: c.bytes ?? c.content.length,
              text: async () => c.content,
              arrayBuffer: async () => new TextEncoder().encode(c.content).buffer,
            } as unknown as File;
          },
        }];
      }
    },
  };
}

describe('readFolderInBrowser — the real traversal', () => {
  const project = dir('my-app', [
    file('package.json', '{"name":"demo"}'),
    file('.env', 'SECRET=live'),
    file('.env.example', 'SECRET='),
    dir('src', [
      file('App.tsx', 'export default function App(){return null}'),
      dir('components', [file('Button.tsx', 'export const Button = () => null')]),
    ]),
    dir('node_modules', [dir('react', [file('index.js', 'x'.repeat(50_000))])]),
    dir('.git', [file('HEAD', 'ref: refs/heads/main')]),
    dir('public', [file('demo.mp4', 'video-bytes', 5_000_000)]),
  ]);

  it('imports the source and skips what a project does not need', async () => {
    const visited: string[] = [];
    const r = await readFolderInBrowser(asHandle(project, visited));

    expect(Object.keys(r.files).sort()).toEqual([
      '.env.example', 'package.json', 'src/App.tsx', 'src/components/Button.tsx',
    ]);
    expect(r.files['.env']).toBeUndefined();       // live secret never leaves the machine
    expect(r.files['src/App.tsx']).toContain('export default function App');
  });

  it('NEVER descends into node_modules or .git — the difference between seconds and minutes', () => {
    // This is the assertion that matters most: walking node_modules to reject its contents one by one
    // would take minutes on a real project, for a verdict already known from the folder name.
    const visited: string[] = [];
    return readFolderInBrowser(asHandle(project, visited)).then(() => {
      expect(visited).toContain('src');
      expect(visited).toContain('components');
      expect(visited).not.toContain('node_modules');
      expect(visited).not.toContain('react');
      expect(visited).not.toContain('.git');
    });
  });

  it('drops a large media file and counts it honestly', async () => {
    const r = await readFolderInBrowser(asHandle(project, []));
    expect(r.dropped.binary).toBeGreaterThan(0);   // the mp4
    expect(r.dropped.secret).toBe(1);              // the .env
    expect(r.dropped.dir).toBe(2);                 // node_modules + .git, one count each
  });

  it('reports what actually crosses the network, not the folder size', async () => {
    const r = await readFolderInBrowser(asHandle(project, []));
    // The tree holds a 5 MB video and a 50 KB dependency file; the source is a few hundred bytes.
    expect(r.keptBytes).toBeLessThan(10_000);
  });

  it('a file the OS refuses to hand over never aborts the whole import', async () => {
    const broken: any = {
      kind: 'directory', name: 'p',
      async *entries() {
        yield ['locked.ts', { kind: 'file', name: 'locked.ts', getFile: async () => { throw new Error('EACCES'); } }];
        yield ['ok.ts', { kind: 'file', name: 'ok.ts', getFile: async () => ({
          name: 'ok.ts', size: 9, text: async () => 'const a=1', arrayBuffer: async () => new ArrayBuffer(9),
        }) }];
      },
    };
    const r = await readFolderInBrowser(broken);
    expect(Object.keys(r.files)).toEqual(['ok.ts']);   // the readable file still lands
    expect(r.dropped.overCap).toBe(1);                 // and the unreadable one is counted, not hidden
  });
});
