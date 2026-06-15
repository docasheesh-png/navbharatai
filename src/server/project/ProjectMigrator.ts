/**
 * Phase 2 — Migration from legacy workspace shapes into the new Project model.
 *
 * Old apps were stored as a flat `{ 'index.html': ..., 'style.css': ..., 'script.js': ... }`
 * (the 3-file limit) or as a `lastApp` HTML string. This module lifts any of those
 * legacy shapes into a typed `VirtualFileSystem` (no caps, binary-safe) plus an
 * initial version snapshot — without losing anything. Additive + pure.
 */
import { VirtualFileSystem } from './ProjectModel';
import { ProjectVersionStore } from './VersionStore';

export interface MigratedProject {
  vfs: VirtualFileSystem;
  versions: ProjectVersionStore;
}

/** Build a fresh Project (VFS + version history with an initial snapshot). */
export function migrateLegacyFiles(
  files: Record<string, string> | null | undefined,
  label = 'imported',
): MigratedProject {
  const vfs = VirtualFileSystem.fromRecord(files);
  const versions = new ProjectVersionStore();
  if (vfs.count > 0) versions.takeSnapshot(vfs, label);
  return { vfs, versions };
}

/**
 * Lift a legacy `lastApp` single-HTML string into a Project. If the HTML inlines
 * <style>/<script>, they are kept inside index.html (faithful migration — the
 * generator can split them later); nothing is dropped.
 */
export function migrateLegacyLastApp(lastApp: string | null | undefined): MigratedProject {
  const html = typeof lastApp === 'string' ? lastApp : '';
  return migrateLegacyFiles(html ? { 'index.html': html } : {}, 'restored last app');
}

/** Convenience: pick whichever legacy field is present on a stored session. */
export function migrateLegacySession(session: any): MigratedProject {
  if (session && session.files && typeof session.files === 'object' && Object.keys(session.files).length > 0) {
    return migrateLegacyFiles(session.files, session.title || 'imported');
  }
  return migrateLegacyLastApp(session?.lastApp);
}
