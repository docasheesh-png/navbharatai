/**
 * Phase 3 — Workspace materializer (server-container / Cloud Run runtime core).
 *
 * Writes a project's Virtual File System to a real directory on disk so the
 * existing WorkspaceLauncher (detect package manager / start command) and
 * SandboxManager (spawn dev server) can run it as a real Node/Vite/Next app.
 * This is the missing piece that turns the typed VFS into a runnable workspace.
 *
 * Path-traversal safe (paths are normalized + confined under the root), binary
 * files are decoded from base64, nested directories are created as needed.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { VirtualFileSystem, normalizePath } from '../project/ProjectModel';

export interface MaterializedWorkspace {
  /** Absolute path of the workspace root on disk. */
  dir: string;
  fileCount: number;
}

/** Resolve a VFS path safely under `root` (rejects escapes). */
function safeJoin(root: string, vfsPath: string): string {
  const norm = normalizePath(vfsPath);
  const abs = path.resolve(root, norm);
  const rootResolved = path.resolve(root);
  if (abs !== rootResolved && !abs.startsWith(rootResolved + path.sep)) {
    throw new Error(`Refusing to write outside workspace root: ${vfsPath}`);
  }
  return abs;
}

/**
 * Write the VFS into `targetDir` (created if missing). Returns the dir + count.
 * If `targetDir` is omitted, a unique temp dir under the OS tmp is created.
 */
export function materializeWorkspace(vfs: VirtualFileSystem, targetDir?: string): MaterializedWorkspace {
  const dir = targetDir
    ? path.resolve(targetDir)
    : fs.mkdtempSync(path.join(os.tmpdir(), 'nb-ws-'));
  fs.mkdirSync(dir, { recursive: true });

  let count = 0;
  // BUG H1 FIX: Wrap file writes in try-catch and clean up partial directory on failure
  try {
    for (const file of vfs.list()) {
      const dest = safeJoin(dir, file.path);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (file.encoding === 'base64') {
        fs.writeFileSync(dest, Buffer.from(file.content, 'base64'));
      } else {
        fs.writeFileSync(dest, file.content, 'utf8');
      }
      count++;
    }
  } catch (err) {
    cleanupWorkspace(dir);
    throw err;
  }
  return { dir, fileCount: count };
}

/** Best-effort recursive cleanup of a materialized workspace dir. */
export function cleanupWorkspace(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
