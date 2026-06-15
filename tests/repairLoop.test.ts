import { describe, it, expect, vi } from 'vitest';
import { VirtualFileSystem } from '../src/server/project/ProjectModel';
import { ProjectVersionStore } from '../src/server/project/VersionStore';
import { autoRepair } from '../src/server/project/RepairLoop';
import type { FileEdit } from '../src/server/project/EditEngine';

const vfsFrom = (f: Record<string, string>) => VirtualFileSystem.fromRecord(f);

describe('autoRepair', () => {
  it('does nothing when the project already verifies clean', async () => {
    const vfs = vfsFrom({ 'index.html': '<h1>ok</h1>' });
    const generateFixes = vi.fn(async () => [] as FileEdit[]);
    const r = await autoRepair(vfs, { generateFixes });
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(0);
    expect(generateFixes).not.toHaveBeenCalled();
  });

  it('fixes an invalid-JSON error in one pass', async () => {
    const vfs = vfsFrom({ 'index.html': '<h1>x</h1>', 'data.json': '{ broken' });
    const generateFixes = vi.fn(async () => [{ op: 'write', path: 'data.json', content: '{"ok":true}' }] as FileEdit[]);
    const r = await autoRepair(vfs, { generateFixes });
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(1);
    expect(vfs.readText('data.json')).toBe('{"ok":true}');
  });

  it('captures a rollback snapshot before the first repair', async () => {
    const vfs = vfsFrom({ 'index.html': '<h1>x</h1>', 'd.json': 'bad' });
    const versions = new ProjectVersionStore();
    const r = await autoRepair(vfs, {
      versions,
      generateFixes: async () => [{ op: 'write', path: 'd.json', content: '{}' }],
    });
    expect(r.rollbackSnapshotId).toBeTruthy();
    expect(versions.restore(r.rollbackSnapshotId!)!.readText('d.json')).toBe('bad'); // pre-repair state
  });

  it('stops (no infinite loop) when the fixer cannot make progress', async () => {
    const vfs = vfsFrom({ 'a.json': 'still bad' });
    const generateFixes = vi.fn(async () => [{ op: 'write', path: 'noop.txt', content: 'x' }] as FileEdit[]);
    const r = await autoRepair(vfs, { generateFixes, maxAttempts: 5 });
    expect(r.ok).toBe(false);
    expect(r.attempts).toBeLessThanOrEqual(1); // bailed on no-progress
  });

  it('stops when the fixer proposes no edits', async () => {
    const vfs = vfsFrom({ 'a.json': 'bad' });
    const r = await autoRepair(vfs, { generateFixes: async () => [] });
    expect(r.ok).toBe(false);
    expect(r.attempts).toBe(0);
  });
});
