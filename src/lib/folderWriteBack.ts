// "SAVE TO FOLDER" — the write-back half of Open Folder (queue Q-160, admin 2026-10-05: "apki salah ke anusar").
//
// Open Folder read a project straight from the user's disk, and every change after that lived only in
// NavBharatAI. Writing back is the half that was deliberately left for its own design, because a write to the
// user's real disk cannot be undone from our side. The admin chose the cautious form, and its rules are the
// whole point of this file:
//   • ONLY ON A PRESS, never automatically — a bad build must never overwrite good local files on its own;
//   • ONLY WHAT CHANGED since the folder was read, plus new files — nothing is ever DELETED from the disk;
//   • NEVER OVER A NEWER FILE: a file that changed on disk after it was read (edited in another editor) is
//     skipped and named, not overwritten;
//   • ONLY THE PROJECT THAT CAME FROM THAT FOLDER: if the open project shares too little with what was read,
//     nothing is written — another project must never land in this folder;
//   • never into a build, dependency or VCS folder, and never outside the folder (no `..`, no absolute path).
//
// The pure planner decides; the thin writer below touches the File System Access API (Chrome/Edge desktop).

import { SKIP_DIR_RE } from './importRules';

/** A folder the user opened, and what it held when it was read. */
export interface LinkedFolder {
  handle: FileSystemDirectoryHandle;
  name: string;
  /** The text of every source file as read (the baseline "changed" is measured against). */
  original: Record<string, string>;
  /** Each read file's `lastModified` on disk at read time. */
  stamps: Record<string, number>;
}

let linked: LinkedFolder | null = null;
const listeners = new Set<() => void>();

/** Remember the folder a project was just opened from. Replaces any earlier one. */
export function linkFolder(folder: LinkedFolder | null): void {
  linked = folder;
  for (const fn of listeners) fn();
}

export function linkedFolder(): LinkedFolder | null {
  return linked;
}

export function onLinkedFolderChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Below this share of the folder's files still present, the open project is not the one from that folder. */
export const MIN_SHARED_FRACTION = 0.5;

export interface WriteBackPlan {
  /** Files to write: changed since the read, or new. */
  write: Array<{ path: string; content: string; existedAtRead: boolean }>;
  /** Files in the folder that the project no longer has — named, never deleted from the disk. */
  notDeleted: string[];
  /** Set when nothing may be written at all, with the reason the user is shown. */
  refused?: string;
}

/** Is this a path we may write inside the folder? PURE. */
export function safeFolderPath(path: string): boolean {
  if (!path || path.startsWith('/') || path.startsWith('\\') || /^[a-zA-Z]:/.test(path)) return false;
  const parts = path.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..')) return false;
  if (path.startsWith('__pending__')) return false;
  return !SKIP_DIR_RE.test(path);
}

/** What a press would write. PURE. */
export function planWriteBack(current: Record<string, string>, original: Record<string, string>): WriteBackPlan {
  const origPaths = Object.keys(original);
  if (origPaths.length > 0) {
    const shared = origPaths.filter((p) => p in current).length;
    if (shared / origPaths.length < MIN_SHARED_FRACTION) {
      return {
        write: [],
        notDeleted: [],
        refused: `The project open now shares only ${shared} of the ${origPaths.length} files read from that folder, so it does not look like the same project. Nothing was written.`,
      };
    }
  }
  const write: WriteBackPlan['write'] = [];
  for (const [path, content] of Object.entries(current)) {
    if (typeof content !== 'string' || content.startsWith('data:') || !safeFolderPath(path)) continue;
    const existedAtRead = path in original;
    if (existedAtRead && original[path] === content) continue;
    write.push({ path, content, existedAtRead });
  }
  const notDeleted = origPaths.filter((p) => !(p in current)).sort();
  write.sort((a, b) => a.path.localeCompare(b.path));
  return { write, notDeleted };
}

export interface WriteBackResult {
  written: string[];
  /** Changed on disk since it was read — left as it is on disk. */
  conflicts: string[];
  failed: string[];
  notDeleted: string[];
  refused?: string;
}

/** The one sentence the button shows after a press. PURE. */
export function writeBackSummary(r: WriteBackResult, folderName: string): string {
  if (r.refused) return r.refused;
  const parts: string[] = [];
  parts.push(r.written.length > 0 ? `Saved ${r.written.length} file(s) to "${folderName}".` : `Nothing new to save to "${folderName}".`);
  if (r.conflicts.length > 0) parts.push(`Not overwritten, because they changed on your disk after the folder was opened: ${r.conflicts.slice(0, 5).join(', ')}${r.conflicts.length > 5 ? ` and ${r.conflicts.length - 5} more` : ''}.`);
  if (r.failed.length > 0) parts.push(`Could not write: ${r.failed.slice(0, 5).join(', ')}${r.failed.length > 5 ? ` and ${r.failed.length - 5} more` : ''}.`);
  if (r.notDeleted.length > 0) parts.push(`${r.notDeleted.length} file(s) removed here were left on your disk — nothing is deleted from your folder.`);
  return parts.join(' ');
}

type DirHandle = FileSystemDirectoryHandle & {
  requestPermission?(o: { mode: 'readwrite' }): Promise<PermissionState>;
};

async function fileHandleAt(root: FileSystemDirectoryHandle, path: string, create: boolean): Promise<FileSystemFileHandle | null> {
  const parts = path.split('/');
  let dir = root;
  for (const part of parts.slice(0, -1)) {
    try { dir = await dir.getDirectoryHandle(part, { create }); } catch { return null; }
  }
  try { return await dir.getFileHandle(parts[parts.length - 1], { create }); } catch { return null; }
}

/**
 * Write the plan into the linked folder. Asks the browser for write permission first (the press is the user
 * gesture it needs). After a successful write the baseline moves, so the next press writes only newer changes.
 */
export async function writeBackToFolder(folder: LinkedFolder, current: Record<string, string>): Promise<WriteBackResult> {
  const plan = planWriteBack(current, folder.original);
  const result: WriteBackResult = { written: [], conflicts: [], failed: [], notDeleted: plan.notDeleted, refused: plan.refused };
  if (plan.refused || plan.write.length === 0) return result;

  const handle = folder.handle as DirHandle;
  if (typeof handle.requestPermission === 'function') {
    const perm = await handle.requestPermission({ mode: 'readwrite' }).catch(() => 'denied' as PermissionState);
    if (perm !== 'granted') return { ...result, refused: 'The browser did not allow writing to that folder. Nothing was written.' };
  }

  for (const item of plan.write) {
    // Newer on disk than when it was read (or created there since) ⇒ the user's own edit wins; say so.
    const onDisk = await fileHandleAt(handle, item.path, false);
    if (onDisk) {
      const file = await onDisk.getFile().catch(() => null);
      const readStamp = folder.stamps[item.path];
      if (!item.existedAtRead || (file && readStamp !== undefined && file.lastModified !== readStamp)) {
        result.conflicts.push(item.path);
        continue;
      }
    }
    const target = onDisk ?? await fileHandleAt(handle, item.path, true);
    if (!target) { result.failed.push(item.path); continue; }
    try {
      const w = await (target as FileSystemFileHandle & { createWritable(): Promise<{ write(d: string): Promise<void>; close(): Promise<void> }> }).createWritable();
      await w.write(item.content);
      await w.close();
      const after = await target.getFile().catch(() => null);
      folder.original[item.path] = item.content;
      if (after) folder.stamps[item.path] = after.lastModified;
      result.written.push(item.path);
    } catch {
      result.failed.push(item.path);
    }
  }
  return result;
}
