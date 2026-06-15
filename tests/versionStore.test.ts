import { describe, it, expect } from 'vitest';
import { VirtualFileSystem } from '../src/server/project/ProjectModel';
import { ProjectVersionStore } from '../src/server/project/VersionStore';

describe('ProjectVersionStore', () => {
  it('takes snapshots and restores exact state', () => {
    const vfs = VirtualFileSystem.fromRecord({ 'index.html': '<h1>v1</h1>', 'app.js': 'let a=1;' });
    const store = new ProjectVersionStore();
    const s1 = store.takeSnapshot(vfs, 'first');
    expect(store.size).toBe(1);

    // mutate the live VFS
    vfs.write('index.html', '<h1>v2</h1>');
    vfs.delete('app.js');
    vfs.write('new.css', 'body{}');

    const restored = store.restore(s1.id)!;
    expect(restored.readText('index.html')).toBe('<h1>v1</h1>');
    expect(restored.readText('app.js')).toBe('let a=1;');
    expect(restored.has('new.css')).toBe(false);
  });

  it('diffs two snapshots correctly', () => {
    const store = new ProjectVersionStore();
    const a = VirtualFileSystem.fromRecord({ 'a.ts': '1', 'b.ts': '2', 'c.ts': '3' });
    const sa = store.takeSnapshot(a);
    const b = VirtualFileSystem.fromRecord({ 'a.ts': '1', 'b.ts': 'CHANGED', 'd.ts': '4' });
    const sb = store.takeSnapshot(b);

    const diff = store.diff(sa.id, sb.id)!;
    expect(diff.added).toEqual(['d.ts']);
    expect(diff.removed).toEqual(['c.ts']);
    expect(diff.modified).toEqual(['b.ts']);
    expect(diff.unchanged).toEqual(['a.ts']);
  });

  it('bounds history to maxSnapshots, dropping oldest (never truncating content)', () => {
    const store = new ProjectVersionStore(3);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const vfs = VirtualFileSystem.fromRecord({ 'f.ts': `v${i}` });
      ids.push(store.takeSnapshot(vfs, `s${i}`).id);
    }
    expect(store.size).toBe(3);
    expect(store.get(ids[0])).toBeUndefined(); // oldest dropped
    expect(store.restore(ids[4])!.readText('f.ts')).toBe('v4'); // newest intact, full content
  });

  it('lists snapshot metadata without payloads', () => {
    const store = new ProjectVersionStore();
    store.takeSnapshot(VirtualFileSystem.fromRecord({ 'a.ts': '1', 'b.ts': '2' }), 'snap');
    const list = store.list();
    expect(list).toHaveLength(1);
    expect(list[0].fileCount).toBe(2);
    expect(list[0].label).toBe('snap');
    expect((list[0] as any).files).toBeUndefined();
  });
});
