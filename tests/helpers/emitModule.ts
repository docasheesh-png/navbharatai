/**
 * MATERIALISE AN EMITTED MODULE SO A TEST CAN EXECUTE IT — in one place, outside the source tree.
 *
 * WHY THIS EXISTS. 57 `*Generator.test.ts` files each did the same four lines by hand:
 *
 *     const artifact = join(here, `._thing_emitted_${process.pid}.ts`);
 *     writeFileSync(artifact, THING_SOURCE);
 *     afterAll(() => { try { unlinkSync(artifact); } catch {} });
 *
 * and `here` was the REAL `src/server/lib/` directory. That is the bug: for the seconds the file
 * exists, `src/server/lib` contains a `.ts` file that is not source code, and any test that walks the
 * source tree can list it and then fail reading it because a sibling test already deleted it. That is
 * not hypothetical — it broke `tests/envFlag.test.ts` during the 2026-08-09 audit, and the workaround
 * there (skip anything matching `/\._/`) treated the symptom.
 *
 * WHY NOT `/tmp`. These artifacts are TypeScript, and the test executes them via a dynamic import —
 * vite-node has to transform them, which it only does for files inside the project root. Writing to
 * the OS temp dir would move the file outside that root and the import would fail on the first `:`
 * type annotation. So the artifacts stay in the project, just not in a directory anyone scans.
 *
 * WHERE THEY GO. `<repo>/.emitted-test-modules/` — one directory, gitignored, outside `src/`, and
 * created on demand. The pid keeps parallel vitest workers from colliding; the name keeps a failed
 * run's leftovers identifiable.
 */

import { mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';

/** One directory for every emitted artifact — deliberately outside `src/`, so no source walk sees it. */
export const EMITTED_DIR = resolve(process.cwd(), '.emitted-test-modules');

export interface EmittedModule {
  /** Absolute path of the written file. */
  path: string;
  /** `import()`-able URL for the file. */
  href: string;
  /** Remove it. Safe to call twice; a already-deleted file is not an error. */
  cleanup: () => void;
}

/**
 * Write `source` as a TypeScript module the caller can `import()`, and hand back its location plus a
 * cleanup function. The caller passes a short, unique `name` (usually the generator's) — it only has
 * to be distinct within one test run.
 *
 * The pid suffix is what makes this safe under vitest's parallel workers: two workers materialising
 * the same generator would otherwise write and delete the same path underneath each other.
 */
export function emitModule(name: string, source: string): EmittedModule {
  mkdirSync(EMITTED_DIR, { recursive: true });
  const safe = name.replace(/[^A-Za-z0-9_-]/g, '') || 'module';
  const path = join(EMITTED_DIR, `${safe}_${process.pid}.ts`);
  writeFileSync(path, source);
  return {
    path,
    href: pathToFileURL(path).href,
    cleanup: () => { try { unlinkSync(path); } catch { /* already gone — nothing to undo */ } },
  };
}
