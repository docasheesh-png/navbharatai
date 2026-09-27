// THE ONE LIST OF DIRECTORIES THAT ARE NEVER THE USER'S SOURCE (autopsy e1c21ad8, 2026-09-27).
//
// 🔴 THE DEFECT. A free build turned an imported FastAPI backend into a React + FastAPI app and, to
// test it, ran `python3 -m venv venv` inside `backend/`. Every copy of "directories that are not source"
// in this repo knew `.venv` and none knew `venv` — the name Python's own tutorial uses. So ~1,900 files
// of installed Python packages became project files:
//   • the durable save stored them (the report's snapshot check counted 1,930 files on both sides);
//   • the version save timed out on them (RESTORE_POINT "not confirmed within 5s");
//   • the test detector found a library's own `test_*.py` in site-packages and reported that the
//     project HAS a pytest suite, then that pytest "does not exist in the sandbox";
//   • the readiness scan reported "96 fake/incomplete code issue(s) in 24 file(s) this build did not
//     touch" — placeholders and not-implemented stubs inside third-party libraries;
//   • `git add -A` committed them to the user's own GitHub repository.
//
// 🔑 THE CLASS. The list existed TEN times — three actuators, the nested-repo probe, the git ignore
// patterns, the source archive, two tool excludes, project context and the client's live sync — and
// they had drifted: `sourceArchive.ts` knew `venv/`, the actuators did not; the actuators knew
// `test-results`, git did not. Adding `venv` to one copy would have been the instance, not the class.
// Every server-side copy now reads this module.
//
// TWO TIERS, deliberately:
//   • NEVER_SOURCE_DIRS — installed packages, VCS internals, interpreter caches and our own checkpoint
//     directory. Nobody writes source code in these, so the DURABLE STORE may refuse them outright and
//     drop any it already holds (see `toDurableFileKey`).
//   • BUILD_OUTPUT_DIRS — `dist`, `build`, `out`, … Generated in practice, but a real project CAN keep
//     hand-written files under a folder called `build` (a build script, say). They are pruned from
//     LISTINGS, as they always were, but never deleted from a project already stored.
//
// `site-packages` is here as well as `venv` because a virtualenv can be called anything (`env`,
// `.env-py`, `myenv`), but its installed packages always live under `lib/pythonX.Y/site-packages/`.
// Naming the directory that holds the bulk catches every venv name without guessing at them.
//
// PURE. No I/O, no SDK imports — the nested-repo probe and the durable store import it.

/** Directories nobody writes source in. Safe to refuse at the durable store. */
export const NEVER_SOURCE_DIRS: readonly string[] = [
  'node_modules', '.git', '.e-checkpoints',
  // Python: virtualenvs (any name — see site-packages), bytecode and tool caches.
  '__pycache__', '.venv', 'venv', 'site-packages', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox',
];

/** Build and test OUTPUT. Pruned from listings; never removed from a stored project. */
export const BUILD_OUTPUT_DIRS: readonly string[] = [
  'dist', '.next', 'build', '.cache', 'coverage', 'out',
  // Test-runner output (autopsy "Lekhan Sahyak", 2026-09-27).
  'test-results', 'playwright-report',
];

/** Everything a workspace LISTING skips. */
export const LIST_PRUNE_DIRS: readonly string[] = [...NEVER_SOURCE_DIRS, ...BUILD_OUTPUT_DIRS];

const NEVER_SOURCE = new Set(NEVER_SOURCE_DIRS);
const LIST_PRUNE = new Set(LIST_PRUNE_DIRS);

function dirSegments(relPath: string): string[] {
  const segs = String(relPath ?? '').replace(/\\/g, '/').split('/').filter(Boolean);
  // The LAST segment is the file itself; a file that happens to be called `venv` is not a directory.
  return segs.slice(0, -1);
}

/** Does this path sit inside a directory nobody writes source in? PURE. */
export function isNeverSourcePath(relPath: string): boolean {
  return dirSegments(relPath).some((seg) => NEVER_SOURCE.has(seg));
}

/**
 * Does a workspace listing skip this path? PURE.
 *
 * Every segment is tested, the last one included, because that is what the sandbox listing itself does:
 * `find … -name build -prune` prunes a FILE called `build` as well as a directory. The client-side filter
 * must agree with the command, or the two listings of one workspace differ.
 */
export function isListPrunedPath(relPath: string): boolean {
  return String(relPath ?? '').replace(/\\/g, '/').split('/').some((seg) => LIST_PRUNE.has(seg));
}
