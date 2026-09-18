import { describe, it, expect } from 'vitest';
import { readFileSync, lstatSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * 🔴 `node_modules` IS NEVER A TRACKED FILE (2026-09-18).
 *
 * A session working in a git worktree symlinked `node_modules` at the main clone's install, then
 * committed with `git add -A`. `.gitignore` said `node_modules/` — and the trailing slash matches a
 * DIRECTORY only, so the SYMLINK was not ignored and rode into `main` (8210e4be, via #3079). Every
 * session that then merged `main` had its real install replaced by a symlink pointing at itself:
 * `ls node_modules` → "Too many levels of symbolic links", `npx vitest` → "package not found", the
 * whole verification gate printing nothing. CI survived only because `npm ci` deletes `node_modules`
 * before installing.
 *
 * Two locks, because the pattern was the root and the tracked entry was the symptom:
 *   1. the ignore line is `node_modules` with NO trailing slash — it then matches a directory, a file
 *      and a symlink alike (proven in a scratch repo before this was written);
 *   2. the index holds nothing under `node_modules`, whatever the ignore file says.
 */
const root = process.cwd();

describe('node_modules is ignored whatever it is, and tracked never', () => {
  it('.gitignore ignores `node_modules` by name, not only as a directory', () => {
    const lines = readFileSync(join(root, '.gitignore'), 'utf8').split('\n').map((l) => l.trim());
    expect(lines).toContain('node_modules');
    expect(lines).not.toContain('node_modules/');
  });

  it('git tracks nothing under node_modules', () => {
    const r = spawnSync('git', ['ls-files', '--', 'node_modules'], { cwd: root, encoding: 'utf8' });
    // No git (an exported tarball) is not a failure of THIS rule; a tracked entry is.
    if (r.status !== 0) return;
    expect(r.stdout.trim(), 'a tracked node_modules entry would replace every other clone\'s install on merge').toBe('');
  });

  it('the local node_modules, when present, is a real directory — never a symlink to itself', () => {
    const p = join(root, 'node_modules');
    if (!existsSync(p) && !isSymlink(p)) return; // not installed here: nothing to judge
    expect(isSymlink(p)).toBe(false);
  });
});

function isSymlink(p: string): boolean {
  try { return lstatSync(p).isSymbolicLink(); } catch { return false; }
}
