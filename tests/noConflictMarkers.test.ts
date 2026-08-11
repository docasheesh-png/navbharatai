/**
 * NO MERGE-CONFLICT MARKER MAY REACH `main`.
 *
 * WHY THIS EXISTS (a real failure, 2026-08-11). A `git merge origin/main` left unresolved markers in
 * `scripts/bundleBudget.mjs`. Every typecheck passed — `tsc` never parses that script — so the only
 * signal was CI reporting:
 *
 *     FAIL tests/bundleBudget.test.ts
 *     Error: Merge conflict marker encountered.  ❯ getRollupError …/parseAst.js
 *
 * which names the TEST that imported the broken file, not the broken file. The fault was found by
 * grepping, not by reading the failure. That is the bug class this closes: a conflict marker anywhere
 * in the repo now fails with the exact path, before it depends on some unrelated suite importing it.
 *
 * ANCHORED ON PURPOSE. Git writes its markers at column 0. Five tracked files legitimately mention
 * marker text — the app's own conflict RESOLVER (`merge3.ts`, `MergeEditor.tsx`) and its tests — but
 * always indented, inside a string or a regex. Anchoring to line-start therefore needs no allowlist,
 * and an allowlist is what would eventually let a real marker through in a file someone had exempted.
 *
 * `=======` is deliberately NOT checked: it is a legitimate Markdown heading underline and a common
 * comment banner. The opening and closing markers are unambiguous and always both present.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';

/** Built by concatenation so this file cannot match its own guard. */
const OPEN = '<'.repeat(7);
const CLOSE = '>'.repeat(7);

describe('the repository contains no unresolved merge conflicts', () => {
  it('🔒 no tracked file has a conflict marker at the start of a line', () => {
    let hits = '';
    try {
      // `git grep` searches tracked files only, so build output and node_modules are already excluded.
      hits = execFileSync('git', ['grep', '-nE', `^(${OPEN}|${CLOSE})`, '--', '.'], {
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
      });
    } catch (err) {
      // git grep exits 1 when there are NO matches — the state we want. Any other failure is real.
      const e = err as { status?: number; stderr?: string };
      if (e.status !== 1) throw new Error(`git grep failed: ${e.stderr || String(err)}`);
    }

    // The message carries the file:line, which is what the original failure did not.
    expect(hits.trim(), `Unresolved merge conflict markers:\n${hits}`).toBe('');
  });
});
