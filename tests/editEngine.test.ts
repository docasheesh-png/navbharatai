import { describe, it, expect } from 'vitest';
import { VirtualFileSystem } from '../src/server/project/ProjectModel';
import { ProjectVersionStore } from '../src/server/project/VersionStore';
import { applyEdits } from '../src/server/project/EditEngine';

const vfsFrom = (f: Record<string, string>) => VirtualFileSystem.fromRecord(f);

describe('EditEngine.applyEdits', () => {
  it('applies write/delete/rename without touching unrelated files', () => {
    const vfs = vfsFrom({ 'a.ts': 'A', 'b.ts': 'B', 'c.ts': 'C' });
    const r = applyEdits(vfs, [
      { op: 'write', path: 'a.ts', content: 'A2' },
      { op: 'delete', path: 'b.ts' },
      { op: 'rename', path: 'c.ts', to: 'd.ts' },
    ]);
    expect(r.applied).toBe(3);
    expect(r.failed).toBe(0);
    expect(vfs.readText('a.ts')).toBe('A2');
    expect(vfs.has('b.ts')).toBe(false);
    expect(vfs.readText('d.ts')).toBe('C'); // unrelated content preserved
  });

  it('patches a single occurrence by default, or all when requested', () => {
    const vfs = vfsFrom({ 'x.ts': 'foo foo foo' });
    applyEdits(vfs, [{ op: 'patch', path: 'x.ts', find: 'foo', replace: 'bar' }]);
    expect(vfs.readText('x.ts')).toBe('bar foo foo');
    applyEdits(vfs, [{ op: 'patch', path: 'x.ts', find: 'foo', replace: 'baz', count: 'all' }]);
    expect(vfs.readText('x.ts')).toBe('bar baz baz');
  });

  it('reports per-op failures without aborting the batch', () => {
    const vfs = vfsFrom({ 'a.ts': 'A' });
    const r = applyEdits(vfs, [
      { op: 'write', path: 'new.ts', content: 'N' },
      { op: 'delete', path: 'missing.ts' },
      { op: 'patch', path: 'a.ts', find: 'NOPE', replace: 'x' },
    ]);
    expect(r.applied).toBe(1);
    expect(r.failed).toBe(2);
    expect(r.results.find(x => x.path === 'missing.ts')!.error).toMatch(/not found/);
    expect(vfs.has('new.ts')).toBe(true); // the good op still applied
  });

  it('snapshots before editing so changes are reversible (rollback)', () => {
    const vfs = vfsFrom({ 'app.ts': 'v1', 'keep.ts': 'K' });
    const versions = new ProjectVersionStore();
    const r = applyEdits(vfs, [
      { op: 'write', path: 'app.ts', content: 'v2-broken' },
      { op: 'delete', path: 'keep.ts' },
    ], versions);
    expect(r.snapshotId).toBeTruthy();
    expect(vfs.readText('app.ts')).toBe('v2-broken');
    // rollback to pre-edit state
    const restored = versions.restore(r.snapshotId!)!;
    expect(restored.readText('app.ts')).toBe('v1');
    expect(restored.readText('keep.ts')).toBe('K');
  });
});
