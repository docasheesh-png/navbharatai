/**
 * A temp directory that removes itself (Q-672).
 *
 * WHY THIS EXISTS. 37 test files called `mkdtempSync(join(tmpdir(), 'nbai-…-'))` and never removed the
 * directory, so every full run left ~100 of them in the shared `/tmp`, and a session's disk filled up
 * mid-gate (about 24 GB in 6,688 directories had piled up by 2026-10-05). Each file needed its own
 * `afterAll` + `rmSync`, and each one that forgot it leaked — the class is "cleanup is a separate step
 * somebody has to remember".
 *
 * `makeTempDir(prefix)` makes the directory AND owns its removal: the first import of this module in a
 * test file registers one `afterAll` on that file's root suite, which removes every directory the file
 * made, and one process-wide `exit` hook is the backstop for a worker that ends without running hooks.
 *
 * `tests/noTestLeavesATempDirBehind.test.ts` fails CI on a test that calls `mkdtemp` under the OS temp
 * dir without either this helper or its own removal.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';

const made = new Set<string>();

// One process-wide backstop for a worker that exits without running hooks. Shared through a global so
// the many test files a worker runs (each with its own copy of this module) add ONE listener, not one each.
const SHARED = Symbol.for('nbai.tempDirs.everMade');
type Shared = { dirs: Set<string> };
const g = globalThis as unknown as Record<symbol, Shared | undefined>;
if (!g[SHARED]) {
  const shared: Shared = { dirs: new Set() };
  g[SHARED] = shared;
  process.once('exit', () => {
    for (const dir of shared.dirs) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } }
  });
}
const everMade = g[SHARED]!.dirs;

/** Remove every directory `makeTempDir` made in this module instance. Exported for its own test. */
export function removeTempDirs(): void {
  for (const dir of made) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* already gone or busy — never fail a test over cleanup */ }
    made.delete(dir);
    everMade.delete(dir);
  }
}

/** A fresh `<os temp>/<prefix>XXXXXX` directory, removed after this test file finishes. */
export function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.add(dir);
  everMade.add(dir);
  return dir;
}

// Registered while the importing test file is being collected, so it lands on that file's root suite.
afterAll(removeTempDirs);
