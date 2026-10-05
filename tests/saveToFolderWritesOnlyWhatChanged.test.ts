/**
 * Q-160 (admin 2026-10-05, the cautious option): a project opened from a folder can be written back — on a
 * press, only what changed, never a delete, never over a file edited on disk since it was read, never into a
 * folder that held a different project, never outside it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { planWriteBack, safeFolderPath, writeBackToFolder, writeBackSummary, linkFolder, linkedFolder, type LinkedFolder } from '../src/lib/folderWriteBack';

/** A tiny in-memory File System Access directory. */
function fakeDir(initial: Record<string, { text: string; at: number }>) {
  const disk = new Map(Object.entries(initial));
  let clock = 1_000;
  let permission: PermissionState = 'granted';
  const fileHandle = (path: string) => ({
    kind: 'file',
    getFile: async () => { const f = disk.get(path); if (!f) throw new Error('gone'); return { lastModified: f.at, text: async () => f.text }; },
    createWritable: async () => { let buf = ''; return { write: async (d: string) => { buf += d; }, close: async () => { disk.set(path, { text: buf, at: ++clock }); } }; },
  });
  const dir = (prefix: string): unknown => ({
    kind: 'directory',
    getDirectoryHandle: async (name: string, o?: { create?: boolean }) => {
      const p = prefix ? `${prefix}/${name}` : name;
      if (!o?.create && ![...disk.keys()].some((k) => k.startsWith(`${p}/`))) throw new Error('NotFound');
      return dir(p);
    },
    getFileHandle: async (name: string, o?: { create?: boolean }) => {
      const p = prefix ? `${prefix}/${name}` : name;
      if (!disk.has(p) && !o?.create) throw new Error('NotFound');
      return fileHandle(p);
    },
    requestPermission: async () => permission,
  });
  return { disk, handle: dir('') as FileSystemDirectoryHandle, deny: () => { permission = 'denied'; }, touch: (p: string, text: string) => disk.set(p, { text, at: ++clock }) };
}

const ORIGINAL = { 'package.json': '{}', 'src/App.tsx': 'v1', 'src/util.ts': 'u1', 'README.md': '# app' };
function opened() {
  const fs = fakeDir(Object.fromEntries(Object.entries(ORIGINAL).map(([p, t], i) => [p, { text: t, at: 100 + i }])));
  const folder: LinkedFolder = { handle: fs.handle, name: 'my-app', original: { ...ORIGINAL }, stamps: { 'package.json': 100, 'src/App.tsx': 101, 'src/util.ts': 102, 'README.md': 103 } };
  return { fs, folder };
}

describe('what a press would write', () => {
  it('only changed and new files; a removed file is named, never deleted; assets and build folders are never written', () => {
    const { 'README.md': _gone, ...rest } = ORIGINAL;
    void _gone;
    const plan = planWriteBack({ ...rest, 'src/App.tsx': 'v2', 'src/new.ts': 'n', 'node_modules/x/index.js': 'x', 'logo.png': 'data:image/png;base64,AA' }, ORIGINAL);
    expect(plan.write.map((w) => w.path)).toEqual(['src/App.tsx', 'src/new.ts']);
    expect(plan.notDeleted).toEqual(['README.md']);
  });

  it('a different project is refused outright', () => {
    const plan = planWriteBack({ 'index.html': '<p>other</p>', 'main.js': '1' }, ORIGINAL);
    expect(plan.refused).toMatch(/does not look like the same project. Nothing was written/);
    expect(plan.write).toEqual([]);
  });

  it('no path can leave the folder', () => {
    for (const bad of ['../x', '/etc/passwd', 'C:/x', 'a//b', './a', 'src/../../x', '.git/config', 'dist/app.js', '__pending__a']) expect(safeFolderPath(bad), bad).toBe(false);
    expect(safeFolderPath('src/components/A.tsx')).toBe(true);
  });
});

describe('writing for real (a fake disk)', () => {
  it('writes the change and the new file, and the next press writes only newer changes', async () => {
    const { fs, folder } = opened();
    const now = { ...ORIGINAL, 'src/App.tsx': 'v2', 'src/new/deep.ts': 'n' };
    const r = await writeBackToFolder(folder, now);
    expect(r.written).toEqual(['src/App.tsx', 'src/new/deep.ts']);
    expect(fs.disk.get('src/App.tsx')!.text).toBe('v2');
    expect(fs.disk.get('src/new/deep.ts')!.text).toBe('n');
    expect((await writeBackToFolder(folder, now)).written).toEqual([]);
  });

  it('a file edited on disk after the folder was opened is not overwritten, and is named', async () => {
    const { fs, folder } = opened();
    fs.touch('src/App.tsx', 'edited in another editor');
    const r = await writeBackToFolder(folder, { ...ORIGINAL, 'src/App.tsx': 'v2', 'src/util.ts': 'u2' });
    expect(r.conflicts).toEqual(['src/App.tsx']);
    expect(r.written).toEqual(['src/util.ts']);
    expect(fs.disk.get('src/App.tsx')!.text).toBe('edited in another editor');
    expect(writeBackSummary(r, 'my-app')).toMatch(/Not overwritten, because they changed on your disk after the folder was opened: src\/App.tsx/);
  });

  it('a new file that appeared on disk meanwhile is not overwritten either', async () => {
    const { fs, folder } = opened();
    fs.touch('src/new.ts', 'made on disk');
    const r = await writeBackToFolder(folder, { ...ORIGINAL, 'src/new.ts': 'made here' });
    expect(r.conflicts).toEqual(['src/new.ts']);
    expect(fs.disk.get('src/new.ts')!.text).toBe('made on disk');
  });

  it('no write permission ⇒ nothing written, said plainly', async () => {
    const { fs, folder } = opened();
    fs.deny();
    const r = await writeBackToFolder(folder, { ...ORIGINAL, 'src/App.tsx': 'v2' });
    expect(r.written).toEqual([]);
    expect(r.refused).toMatch(/did not allow writing/);
    expect(fs.disk.get('src/App.tsx')!.text).toBe('v1');
  });
});

describe('wiring', () => {
  it('Open Folder links the folder; the Files panel carries the button', () => {
    expect(readFileSync('src/lib/masterZipImport.ts', 'utf8')).toContain('linkFolder({ handle: root, name: folderName, original: { ...read.files }, stamps: { ...read.stamps } })');
    expect(readFileSync('src/lib/folderImport.ts', 'utf8')).toContain('stamps[path] = file.lastModified;');
    expect(readFileSync('src/components/panels/FilesPanel.tsx', 'utf8')).toContain('<SaveToFolderButton files={files} />');
    linkFolder(null);
    expect(linkedFolder()).toBeNull();
  });
});
