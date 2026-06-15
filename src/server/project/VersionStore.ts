/**
 * Phase 2 — Project version history (snapshot / diff / rollback).
 *
 * Real, git-like checkpoints for a project's Virtual File System. Each snapshot
 * captures the full file set (path + content + encoding) so any prior state can
 * be restored exactly — replacing the old in-memory undo-stack that lost history
 * on reload. Snapshots are plain-serializable for persistence (Phase 2 storage).
 *
 * History is bounded by `maxSnapshots` (default 50) — when exceeded, the OLDEST
 * snapshots are dropped (never silently truncating file *content*, unlike the old
 * lossy workspace slimming).
 */
import { VirtualFileSystem, type FileEncoding } from './ProjectModel';

export interface SnapshotFile {
  content: string;
  encoding: FileEncoding;
}

export interface Snapshot {
  id: string;
  label: string;
  createdAt: string;
  files: Record<string, SnapshotFile>;
}

export interface DiffResult {
  added: string[];
  removed: string[];
  modified: string[];
  unchanged: string[];
}

let counter = 0;
function newId(): string {
  counter = (counter + 1) % 1_000_000;
  return `snap_${Date.now().toString(36)}_${counter.toString(36)}`;
}

export class ProjectVersionStore {
  private snapshots: Snapshot[] = [];
  constructor(private maxSnapshots = 50) {}

  get size(): number {
    return this.snapshots.length;
  }

  /** Capture the current VFS state as an immutable snapshot. */
  takeSnapshot(vfs: VirtualFileSystem, label = ''): Snapshot {
    const files: Record<string, SnapshotFile> = {};
    for (const f of vfs.list()) {
      files[f.path] = { content: f.content, encoding: f.encoding };
    }
    const snap: Snapshot = {
      id: newId(),
      label: label || `snapshot ${this.snapshots.length + 1}`,
      createdAt: new Date().toISOString(),
      files,
    };
    this.snapshots.push(snap);
    // Drop oldest beyond the cap (history length bound — never truncates content).
    while (this.snapshots.length > this.maxSnapshots) this.snapshots.shift();
    return snap;
  }

  /** Snapshot metadata (newest last), without file payloads. */
  list(): Array<Omit<Snapshot, 'files'> & { fileCount: number }> {
    return this.snapshots.map(s => ({
      id: s.id, label: s.label, createdAt: s.createdAt, fileCount: Object.keys(s.files).length,
    }));
  }

  get(id: string): Snapshot | undefined {
    return this.snapshots.find(s => s.id === id);
  }

  /** Rebuild a VirtualFileSystem from a snapshot (rollback/restore). */
  restore(id: string): VirtualFileSystem | undefined {
    const snap = this.get(id);
    if (!snap) return undefined;
    const vfs = new VirtualFileSystem();
    for (const [path, f] of Object.entries(snap.files)) {
      vfs.write(path, f.content, f.encoding);
    }
    return vfs;
  }

  /** Compare two snapshots (or a snapshot against a live VFS via toSnapshotFiles). */
  diff(fromId: string, toId: string): DiffResult | undefined {
    const a = this.get(fromId);
    const b = this.get(toId);
    if (!a || !b) return undefined;
    return ProjectVersionStore.diffFiles(a.files, b.files);
  }

  static diffFiles(a: Record<string, SnapshotFile>, b: Record<string, SnapshotFile>): DiffResult {
    const res: DiffResult = { added: [], removed: [], modified: [], unchanged: [] };
    const all = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const path of [...all].sort()) {
      const inA = path in a;
      const inB = path in b;
      if (inA && !inB) res.removed.push(path);
      else if (!inA && inB) res.added.push(path);
      else if (a[path].content !== b[path].content) res.modified.push(path);
      else res.unchanged.push(path);
    }
    return res;
  }
}
