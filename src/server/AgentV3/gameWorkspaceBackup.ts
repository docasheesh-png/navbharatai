/**
 * 🧳 A BYTE-PRESERVING BACKUP OF THE WHOLE PROJECT, AND A RESTORE THAT PROVES ITSELF (Q-3374, admin-approved 2026-11-26).
 *
 * WHY THIS EXISTS. Automatic game repair was suspended (docs/security/game-auto-repair-suspension.md) because its only
 * way back was `collectWorkspaceFiles(...).files` — a best-effort TEXT map that leaves out binaries (the very GLB models a
 * placeholder repair is about), excluded files, oversized files and failed reads. Restoring that map cannot undo a move,
 * an overwrite or a delete of anything it never captured. The suspension named what re-enabling needs: a complete
 * inventory, binary and metadata handling, a restore that is VERIFIED, and failure that is honest. This file is that
 * protocol, for the one narrow repair the admin approved (gamePlaceholderRepair.ts):
 *
 *   • BACKUP — the whole project tree, every byte, as one tar archive OUTSIDE the project (`/tmp/nbai-game-repair/<id>`),
 *     with permissions, symlinks and hard links, plus a MANIFEST: every path's type, mode and symlink target, and the
 *     sha256 of every regular file. It FAILS CLOSED: a special file (socket, device, pipe), a name with a control
 *     character, a tree over the size cap, too little free space, or ANY tar warning (a file that changed or could not be
 *     read while it was archived) ⇒ no backup, and so no repair.
 *   • RESTORE — every non-directory outside the dependency folders is removed, the archive is extracted, directories the
 *     repair created are removed, and the manifest is taken again and compared with the backup's BYTE FOR BYTE. Only an
 *     identical manifest is "restored"; anything else is said as a restore that could not be verified, with what differs.
 *
 * WHAT IS NOT IN THE BACKUP, SAID PLAINLY. Folders named `node_modules` (dependencies, rebuilt from the lockfile, and
 * written by the running dev server) and Vite's own transient `*.timestamp-*.mjs` config files. The repair that uses this
 * backup is given FILE tools only — no shell, no installer, no recipe — so it has no way to change a dependency folder
 * (gamePlaceholderRepair.ts `PLACEHOLDER_REPAIR_TOOLS`); a write it makes under one anyway is reported, never hidden.
 *
 * PURE: command strings and output parsers only. The commands run in the project's own directory (the sandbox's command
 * cwd); they use POSIX sh, GNU find/tar/coreutils, and are exercised against a real directory in the tests.
 */

/** Where backups live — outside every project, so a restore can never extract over its own archive. */
export const GAME_BACKUP_ROOT = '/tmp/nbai-game-repair';
/** A project larger than this (without its dependency folders) is not backed up, so it is not repaired. */
export const GAME_BACKUP_MAX_KB = 400 * 1024;

const OK = 'NBAI_BACKUP_OK:';
const FAIL = 'NBAI_BACKUP_FAIL:';
const RESTORED = 'NBAI_RESTORE_OK:';
const MISMATCH = 'NBAI_RESTORE_MISMATCH:';
const RESTORE_FAIL = 'NBAI_RESTORE_FAIL:';

/** A backup id: letters, digits, dash, underscore only — it is placed in a shell command. */
export function safeBackupId(id: string): string {
  const clean = String(id ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  return clean || 'backup';
}

const dirOf = (id: string): string => `${GAME_BACKUP_ROOT}/${safeBackupId(id)}`;

// The two things never in the backup, as a find prune and as tar excludes (unanchored: any depth).
const PRUNE = `\\( -name node_modules -o -name '*.timestamp-*.mjs' \\) -prune -o`;
const TAR_EXCLUDES = `--exclude=node_modules --exclude='*.timestamp-*.mjs'`;

// The manifest: every path's type, mode and link target, then the sha256 of every regular file — sorted bytewise.
const MANIFEST_FN = [
  `nb_manifest() {`,
  `  find . -mindepth 1 ${PRUNE} -printf '%y %m %p -> %l\\n' | LC_ALL=C sort`,
  `  find . -mindepth 1 ${PRUNE} -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum`,
  `}`,
  `nb_dirs() { find . -mindepth 1 ${PRUNE} -type d -print | LC_ALL=C sort; }`,
].join('\n');

/** The backup command. Prints one line: `NBAI_BACKUP_OK:<manifest sha256>:<lines>` or `NBAI_BACKUP_FAIL:<why>`. PURE. */
export function gameBackupCommand(id: string, maxKb: number = GAME_BACKUP_MAX_KB): string {
  const b = dirOf(id);
  const cap = Math.max(1, Math.floor(Number(maxKb) || GAME_BACKUP_MAX_KB));
  return [
    `set -u`,
    `B='${b}'`,
    `nb_fail() { echo "${FAIL}$1"; exit 0; }`,
    MANIFEST_FN,
    `case "$(pwd -P)" in /|${GAME_BACKUP_ROOT}|${GAME_BACKUP_ROOT}/*) nb_fail cwd;; esac`,
    `case "$B/" in "$(pwd -P)"/*) nb_fail inside-project;; esac`,
    `rm -rf -- "$B" && mkdir -p -- "$B" || nb_fail mkdir`,
    // Fail closed on anything tar or the manifest cannot carry exactly.
    `odd=$(find . -mindepth 1 ${PRUNE} \\( \\( ! -type f ! -type d ! -type l \\) -o -name '*[[:cntrl:]]*' \\) -print | head -n 1)`,
    `[ -z "$odd" ] || nb_fail "special-file:$(printf %s "$odd" | tr -cd '[:print:]' | head -c 120)"`,
    `kb=$(du -sk ${TAR_EXCLUDES} . 2>/dev/null | cut -f1)`,
    `[ -n "$kb" ] || nb_fail size-unknown`,
    `[ "$kb" -le ${cap} ] || nb_fail "too-large:\${kb}KB"`,
    `free=$(df -Pk "$B" | awk 'NR==2{print $4}')`,
    `[ -n "$free" ] && [ "$free" -gt $((kb * 2 + 10240)) ] || nb_fail "no-space:\${free:-?}KB"`,
    `tar --numeric-owner ${TAR_EXCLUDES} -cpf "$B/tree.tar" . 2>"$B/tar.err" || nb_fail "tar:$(head -c 160 "$B/tar.err" | tr -cd '[:print:]')"`,
    `[ ! -s "$B/tar.err" ] || nb_fail "tar-warning:$(head -c 160 "$B/tar.err" | tr -cd '[:print:]')"`,
    `nb_manifest > "$B/manifest" || nb_fail manifest`,
    `nb_dirs > "$B/dirs" || nb_fail dirs`,
    `echo "${OK}$(sha256sum < "$B/manifest" | cut -c1-64):$(wc -l < "$B/manifest" | tr -d ' ')"`,
  ].join('\n');
}

/**
 * The restore command. Prints one line: `NBAI_RESTORE_OK:<manifest sha256>`, `NBAI_RESTORE_MISMATCH:<what differs>` or
 * `NBAI_RESTORE_FAIL:<why>`. The backup is left in place either way (the caller removes it only after a verified
 * restore or a kept repair). PURE.
 */
export function gameRestoreCommand(id: string): string {
  const b = dirOf(id);
  return [
    `set -u`,
    `B='${b}'`,
    `nb_fail() { echo "${RESTORE_FAIL}$1"; exit 0; }`,
    MANIFEST_FN,
    `[ -f "$B/tree.tar" ] && [ -f "$B/manifest" ] && [ -f "$B/dirs" ] || nb_fail missing-backup`,
    `case "$B/" in "$(pwd -P)"/*) nb_fail inside-project;; esac`,
    // Every non-directory outside the dependency folders goes; the archive then puts back exactly what was there.
    `find . -mindepth 1 ${PRUNE} ! -type d -print0 | xargs -0 -r rm -f -- || nb_fail remove`,
    `tar --numeric-owner -xpf "$B/tree.tar" 2>"$B/untar.err" || nb_fail "untar:$(head -c 160 "$B/untar.err" | tr -cd '[:print:]')"`,
    // Directories the repair created (deepest first); one that still holds a dependency folder is left and shows below.
    `nb_dirs | LC_ALL=C comm -13 "$B/dirs" - | LC_ALL=C sort -r | while IFS= read -r d; do rmdir -- "$d" 2>/dev/null || true; done`,
    `nb_manifest > "$B/after" || nb_fail manifest`,
    `if cmp -s "$B/manifest" "$B/after"; then echo "${RESTORED}$(sha256sum < "$B/after" | cut -c1-64)"; else echo "${MISMATCH}$(LC_ALL=C comm -3 "$B/manifest" "$B/after" | head -n 4 | tr '\\n\\t' '  ' | tr -cd '[:print:]' | head -c 300)"; fi`,
  ].join('\n');
}

/** Remove a backup. PURE. */
export function gameBackupCleanupCommand(id: string): string {
  return `rm -rf -- '${dirOf(id)}'`;
}

export type BackupResult = { ok: true; digest: string; entries: number } | { ok: false; reason: string };
export type RestoreResult = { ok: true; digest: string } | { ok: false; verified: false; reason: string };

const lastLine = (stdout: unknown, marker: string): string | null => {
  const lines = String(stdout ?? '').split('\n').map((l) => l.trim()).filter((l) => l.startsWith(marker));
  return lines.length ? lines[lines.length - 1].slice(marker.length) : null;
};

/** The backup command's answer. No marker at all is a failure, never a success. PURE. */
export function parseGameBackup(stdout: unknown): BackupResult {
  const ok = lastLine(stdout, OK);
  if (ok !== null) {
    const m = /^([a-f0-9]{64}):(\d+)$/.exec(ok);
    if (m) return { ok: true, digest: m[1], entries: Number(m[2]) };
    return { ok: false, reason: 'the backup answered without a readable manifest' };
  }
  const fail = lastLine(stdout, FAIL);
  return { ok: false, reason: fail !== null ? `backup refused (${fail.slice(0, 200) || 'no reason'})` : 'the backup did not answer' };
}

/**
 * The restore command's answer. Only a manifest identical to the backup's is "restored"; `expectDigest` (the backup's)
 * is checked too, so an answer about some other tree can never pass. PURE.
 */
export function parseGameRestore(stdout: unknown, expectDigest: string): RestoreResult {
  const ok = lastLine(stdout, RESTORED);
  if (ok !== null) {
    return ok === expectDigest ? { ok: true, digest: ok } : { ok: false, verified: false, reason: 'the restored tree does not match the backup\'s fingerprint' };
  }
  const mismatch = lastLine(stdout, MISMATCH);
  if (mismatch !== null) return { ok: false, verified: false, reason: `the restored tree differs from the backup: ${mismatch.slice(0, 300) || 'unknown difference'}` };
  const fail = lastLine(stdout, RESTORE_FAIL);
  return { ok: false, verified: false, reason: fail !== null ? `the restore could not run (${fail.slice(0, 200)})` : 'the restore did not answer' };
}

/** A path inside a dependency folder — the one place the backup does not cover. PURE. */
export function isOutsideBackup(path: string): boolean {
  const p = String(path ?? '').replace(/\\/g, '/');
  return /(^|\/)node_modules(\/|$)/.test(p) || /\.timestamp-[^/]*\.mjs$/.test(p);
}
