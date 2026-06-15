/**
 * Phase 4 — Surgical file-level edit engine.
 *
 * The old AppEngine regenerated whole files on every edit (clobbering unrelated
 * user changes) with no rollback. This engine applies STRUCTURED, per-file edit
 * operations to a VirtualFileSystem and ALWAYS takes a version snapshot first, so
 * any edit is reversible and user work is never silently lost.
 *
 * Supported ops: write (create/replace one file), delete, rename, and patch
 * (literal find→replace within a single file, with an occurrence guard).
 * Pure + dependency-light → fully unit-testable.
 */
import { VirtualFileSystem } from './ProjectModel';
import { ProjectVersionStore } from './VersionStore';

export type FileEdit =
  | { op: 'write'; path: string; content: string }
  | { op: 'delete'; path: string }
  | { op: 'rename'; path: string; to: string }
  | { op: 'patch'; path: string; find: string; replace: string; /** default 1; 'all' = every match */ count?: number | 'all' };

export interface EditOpResult {
  op: FileEdit['op'];
  path: string;
  ok: boolean;
  error?: string;
}

export interface ApplyEditsResult {
  applied: number;
  failed: number;
  results: EditOpResult[];
  /** Snapshot id captured BEFORE applying (for rollback), if a store was given. */
  snapshotId?: string;
}

function applyOne(vfs: VirtualFileSystem, edit: FileEdit): EditOpResult {
  try {
    switch (edit.op) {
      case 'write':
        vfs.write(edit.path, edit.content);
        return { op: 'write', path: edit.path, ok: true };
      case 'delete': {
        const ok = vfs.delete(edit.path);
        return { op: 'delete', path: edit.path, ok, error: ok ? undefined : 'file not found' };
      }
      case 'rename': {
        const ok = vfs.rename(edit.path, edit.to);
        return { op: 'rename', path: edit.path, ok, error: ok ? undefined : 'source not found' };
      }
      case 'patch': {
        const current = vfs.readText(edit.path);
        if (current == null) return { op: 'patch', path: edit.path, ok: false, error: 'file not found' };
        if (!current.includes(edit.find)) return { op: 'patch', path: edit.path, ok: false, error: 'find string not present' };
        let updated: string;
        if (edit.count === 'all') {
          updated = current.split(edit.find).join(edit.replace);
        } else {
          const n = typeof edit.count === 'number' && edit.count > 0 ? edit.count : 1;
          updated = current;
          for (let i = 0; i < n; i++) {
            const idx = updated.indexOf(edit.find);
            if (idx < 0) break;
            updated = updated.slice(0, idx) + edit.replace + updated.slice(idx + edit.find.length);
          }
        }
        vfs.write(edit.path, updated);
        return { op: 'patch', path: edit.path, ok: true };
      }
    }
  } catch (e: any) {
    return { op: edit.op, path: (edit as any).path, ok: false, error: e?.message || 'edit failed' };
  }
}

/**
 * Apply a batch of edits to the VFS. If `versions` is provided, a snapshot is
 * captured first (rollback via `versions.restore(snapshotId)`).
 */
export function applyEdits(
  vfs: VirtualFileSystem,
  edits: FileEdit[],
  versions?: ProjectVersionStore,
  snapshotLabel = 'before edit',
): ApplyEditsResult {
  const snapshotId = versions ? versions.takeSnapshot(vfs, snapshotLabel).id : undefined;
  const results: EditOpResult[] = [];
  for (const edit of edits) results.push(applyOne(vfs, edit));
  const applied = results.filter(r => r.ok).length;
  return { applied, failed: results.length - applied, results, snapshotId };
}
