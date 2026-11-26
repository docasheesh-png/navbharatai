/**
 * Q-3374 — the placeholder repair's way back is byte-exact and proves itself (gameWorkspaceBackup.ts).
 *
 * The suspension (docs/security/game-auto-repair-suspension.md) named the class: a "snapshot" that was a best-effort text
 * map could not undo a move, an overwrite or a delete of a binary, an excluded or an unread file. These tests run the REAL
 * backup and restore commands against a real directory: every scenario the suspension listed (binary move, binary
 * delete, a file the text map never saw, a changed mode, a swapped symlink, a created directory) comes back byte for
 * byte, and anything the protocol cannot carry exactly makes the backup REFUSE (so no repair runs).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  gameBackupCommand, gameRestoreCommand, gameBackupCleanupCommand, parseGameBackup, parseGameRestore, isOutsideBackup, safeBackupId,
} from '../src/server/AgentV3/gameWorkspaceBackup';

const dirs: string[] = [];
const ids: string[] = [];
const sh = (cwd: string, cmd: string): string => execFileSync('sh', ['-c', cmd], { cwd, encoding: 'utf8' });
const project = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'nb-game-backup-'));
  dirs.push(d);
  mkdirSync(join(d, 'src/game'), { recursive: true });
  mkdirSync(join(d, 'public/game-assets'), { recursive: true });
  mkdirSync(join(d, 'node_modules/three'), { recursive: true });
  writeFileSync(join(d, 'src/game/world.ts'), 'export const world = 1;\n');
  writeFileSync(join(d, 'public/game-assets/car.glb'), Buffer.from([0, 255, 1, 9, 0x67, 0x6c, 0x54, 0x46]));
  writeFileSync(join(d, 'public/hidden-large.bin'), Buffer.alloc(300_000, 7)); // a file a text snapshot never carries
  writeFileSync(join(d, 'node_modules/three/index.js'), 'dep');
  symlinkSync('src/game/world.ts', join(d, 'world-link'));
  chmodSync(join(d, 'src/game/world.ts'), 0o755);
  return d;
};
const id = (name: string): string => { const v = `test-${process.pid}-${name}`; ids.push(v); return v; };
const fingerprint = (d: string): string => sh(d, `find . -name node_modules -prune -o -printf '%y %m %p %l\\n' | LC_ALL=C sort; find . -name node_modules -prune -o -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum`);

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  for (const i of ids) { try { execFileSync('sh', ['-c', gameBackupCleanupCommand(i)]); } catch { /* best-effort */ } }
});

describe('the backup and the restore, run for real', () => {
  it('puts back every byte after a binary move, a binary delete, an overwrite, a mode change, a swapped link and new folders', () => {
    const d = project();
    const before = fingerprint(d);
    const backup = parseGameBackup(sh(d, gameBackupCommand(id('full'))));
    expect(backup.ok).toBe(true);
    if (!backup.ok) return;
    // What a repair could do that the old text snapshot could not undo.
    writeFileSync(join(d, 'public/game-assets/moved.glb'), readFileSync(join(d, 'public/game-assets/car.glb')));
    unlinkSync(join(d, 'public/game-assets/car.glb'));
    unlinkSync(join(d, 'public/hidden-large.bin'));
    writeFileSync(join(d, 'src/game/world.ts'), 'export const world = 2; // repaired\n');
    chmodSync(join(d, 'src/game/world.ts'), 0o644);
    unlinkSync(join(d, 'world-link'));
    symlinkSync('nowhere', join(d, 'world-link'));
    mkdirSync(join(d, 'src/game/new/deeper'), { recursive: true });
    writeFileSync(join(d, 'src/game/new/deeper/added.ts'), 'x');
    writeFileSync(join(d, 'node_modules/three/index.js'), 'dep-changed-by-the-dev-server');
    expect(fingerprint(d)).not.toBe(before);

    const restored = parseGameRestore(sh(d, gameRestoreCommand(id('full'))), backup.digest);
    expect(restored).toEqual({ ok: true, digest: backup.digest });
    expect(fingerprint(d)).toBe(before);
    expect([...readFileSync(join(d, 'public/game-assets/car.glb'))]).toEqual([0, 255, 1, 9, 0x67, 0x6c, 0x54, 0x46]);
    expect(existsSync(join(d, 'public/game-assets/moved.glb'))).toBe(false);
    expect(existsSync(join(d, 'src/game/new'))).toBe(false);
    expect(readlinkSync(join(d, 'world-link'))).toBe('src/game/world.ts');
    expect(lstatSync(join(d, 'src/game/world.ts')).mode & 0o777).toBe(0o755);
    // The dependency folder is not the backup's and is never touched by a restore.
    expect(readFileSync(join(d, 'node_modules/three/index.js'), 'utf8')).toBe('dep-changed-by-the-dev-server');
  });

  it('a restore that cannot match the backup says so — it is never called restored', () => {
    const d = project();
    const backup = parseGameBackup(sh(d, gameBackupCommand(id('wrong'))));
    if (!backup.ok) throw new Error('backup');
    const out = sh(d, gameRestoreCommand(id('wrong')));
    expect(parseGameRestore(out, backup.digest).ok).toBe(true);
    // The same answer checked against another tree's fingerprint does not pass.
    expect(parseGameRestore(out, 'f'.repeat(64))).toMatchObject({ ok: false, verified: false });
    expect(parseGameRestore('', backup.digest)).toMatchObject({ ok: false, reason: 'the restore did not answer' });
    expect(parseGameRestore('NBAI_RESTORE_MISMATCH:f 644 ./x', backup.digest)).toMatchObject({ ok: false, verified: false });
    expect(parseGameRestore(sh(d, gameRestoreCommand(id('never-made'))), backup.digest)).toMatchObject({ ok: false, reason: expect.stringContaining('missing-backup') });
  });

  it('fails closed: a special file, a control character in a name, or a tree over the cap means no backup', () => {
    const fifo = project();
    sh(fifo, 'mkfifo src/pipe');
    expect(parseGameBackup(sh(fifo, gameBackupCommand(id('fifo'))))).toMatchObject({ ok: false, reason: expect.stringContaining('special-file') });
    const ctl = project();
    writeFileSync(join(ctl, 'src/bad\nname.ts'), 'x');
    expect(parseGameBackup(sh(ctl, gameBackupCommand(id('ctl'))))).toMatchObject({ ok: false, reason: expect.stringContaining('special-file') });
    const big = project();
    expect(parseGameBackup(sh(big, gameBackupCommand(id('big'), 1)))).toMatchObject({ ok: false, reason: expect.stringContaining('too-large') });
  });

  it('no marker is never a success; ids cannot reach the shell', () => {
    expect(parseGameBackup('')).toEqual({ ok: false, reason: 'the backup did not answer' });
    expect(parseGameBackup('NBAI_BACKUP_OK:nothex:3').ok).toBe(false);
    expect(safeBackupId("x'; rm -rf / #")).toBe('xrm-rf');
    expect(gameBackupCommand("a'b")).toContain("B='/tmp/nbai-game-repair/ab'");
    expect(isOutsideBackup('node_modules/three/x.js')).toBe(true);
    expect(isOutsideBackup('apps/web/node_modules/a')).toBe(true);
    expect(isOutsideBackup('vite.config.ts.timestamp-123.mjs')).toBe(true);
    expect(isOutsideBackup('src/game/world.ts')).toBe(false);
  });
});
