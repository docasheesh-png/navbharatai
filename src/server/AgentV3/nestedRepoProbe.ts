/**
 * 🔴 A SECOND REPOSITORY INSIDE THE USER'S PROJECT LOOKS EXACTLY LIKE AN ORDINARY FOLDER.
 *
 * ## The open root cause this closes (autopsy `c5fd6ad1` + `bff0bf23`, recorded 2026-09-21)
 *
 * A sub-agent ran `git clone … workspace/mitrify` inside a workspace that already held the user's
 * 175-file project, producing **a complete second copy of their own app, inside their app**. The
 * consequences were all false-by-construction findings against files that belong to a different
 * project: `INTEGRITY_DUPLICATE_ENTRY` (two files mounting a React root — of course, two projects),
 * `INTEGRITY_DUPLICATE_STYLESHEET`, `INTEGRITY_FOCUS_CONFLICT`. **The integrity heal then spent ~3.5
 * minutes and 10 model calls editing the copy the engine had itself created**, on a turn where the
 * user had said only *"preview nahi chala"*.
 *
 * `gitCloneGuard.ts` closed the door — no new clone lands inside a populated workspace. Its docblock
 * then records, in as many words, why the tidier fix was **not available**:
 *
 *   > *"`IGNORED_LIST_DIRS` in `E2BActuator` prunes `.git` inside the sandbox, so `listFiles` never
 *   > returns a single `.git` path and `collectWorkspaceFiles` therefore cannot tell a nested
 *   > repository from an ordinary subdirectory. The one signal that would identify it is destroyed
 *   > before the collector runs. … Whoever re-opens this needs a dedicated nested-repo probe
 *   > (`find . -name .git -not -path ./.git`), not a change to the collector's skip list."*
 *
 * This module is that probe, built to that instruction. **The skip list is untouched** — widening it
 * would put every `.git` blob back on the wire and undo the 226-second fix `buildListFilesCommand`
 * exists for (report a876b7bb). One extra `find`, pruned the same way, answering one question.
 *
 * ## 🔒 WHAT IT IS ALLOWED TO DO, AND WHAT IT IS NOT
 *
 * It finds and it REPORTS. **It never deletes, never excludes a file from the durable copy, and never
 * edits anything.** `PROGRESS.md` rejects the deleting alternatives by name: a nested `package.json`
 * is how every monorepo is laid out, and *"a subtree that duplicates the root"* is a heuristic that
 * would throw away a user's real files. A nested repository can be perfectly legitimate — a vendored
 * dependency, a submodule checkout, an example app — and this module cannot tell that from our own
 * mistake. So it makes the fact KNOWN; what reads it must stay on the safe side of that line.
 *
 * Its one consumer today is `analyzeProjectIntegrity`, which uses it to judge each project on its
 * own. That is correct in general and not a patch for this bug: two independent repositories
 * legitimately each have a root mount, their own global stylesheet and their own
 * `src/components/Button.tsx`. **Pairing files across a repository boundary is a false finding by
 * construction**, whoever put the second repository there.
 *
 * PURE: a command builder and a parser. No I/O, no clock, never throws.
 */

/**
 * Directories never searched — a dependency tree routinely vendors its own `.git`, and a nested
 * repository inside `node_modules` is the package manager's business, not the user's project.
 *
 * ⚠️ **`.git` IS DELIBERATELY ABSENT, and that is the whole point of this module.** This list is
 * `E2BActuator`'s `IGNORED_LIST_DIRS` minus the one entry that destroys the signal. It is written out
 * rather than imported because that constant lives beside the e2b SDK and this file must stay pure —
 * `tests/theNestedRepoLooksLikeAFolder.test.ts` asserts the relationship against the exported
 * `isIgnoredListPath`, so the two cannot drift without CI saying so.
 */
export const NESTED_REPO_PRUNE_DIRS: readonly string[] = [
  'node_modules', 'dist', '.next', 'build',
  '__pycache__', '.venv', '.cache', 'coverage', 'out', '.e-checkpoints',
];

/** How deep to look. Matches `buildListFilesCommand`, so the probe and the file list see one tree. */
export const NESTED_REPO_MAX_DEPTH = 10;

/**
 * The shell command. Prunes the same noise the file listing prunes, then prints every `.git`
 * DIRECTORY it finds — the workspace's own included, which the parser drops.
 *
 * ⚠️ **The root's own `.git` is excluded in the PARSER, not with `find`'s `-not -path`**, and that is
 * deliberate. The recorded cure spells it `find . -name .git -not -path ./.git`, which only works
 * when the root is literally `.`; interpolating a real absolute root into a `-path` pattern makes the
 * answer depend on trailing slashes and shell quoting. The parser already holds the root, so it can
 * answer exactly, and the decision is unit-testable instead of living in a string.
 *
 * ⚠️ `-prune` after the match stops `find` descending INTO the repository it just found: a nested
 * repo's own submodules are that repo's business, and one entry per repository is what a caller can
 * act on.
 */
export function buildNestedRepoCommand(root: string, maxDepth = NESTED_REPO_MAX_DEPTH): string {
  const names = NESTED_REPO_PRUNE_DIRS.map((d) => `-name '${d}'`).join(' -o ');
  return `find '${root}' -maxdepth ${maxDepth} \\( ${names} \\) -prune -o -type d -name '.git' -prune -print 2>/dev/null`;
}

/** Strip a trailing slash so `/a/b` and `/a/b/` describe the same root. */
function normalizeRoot(root: string): string {
  const r = String(root || '').trim();
  return r.length > 1 && r.endsWith('/') ? r.slice(0, -1) : r;
}

/**
 * Turn the probe's output into the workspace-relative ROOT of every nested repository.
 *
 * `/home/user/workspace/workspace/mitrify/.git` → `workspace/mitrify`. The workspace's own `.git`
 * yields nothing, because the project is not nested inside itself.
 *
 * Tolerant by design, like `parseListFilesOutput`: a blank line, CRLF, a duplicate, or a path from
 * some other root is ignored rather than turned into a wrong answer. Returns sorted, unique roots.
 */
export function parseNestedRepoRoots(stdout: string, root: string): string[] {
  const base = normalizeRoot(root);
  const prefix = `${base}/`;
  const out = new Set<string>();
  for (const raw of String(stdout || '').split('\n')) {
    const line = raw.trim().replace(/\/+$/, '');
    if (!line || !line.startsWith(prefix)) continue;
    const rel = line.slice(prefix.length);
    if (rel === '.git') continue;                 // the workspace's OWN repository
    if (!rel.endsWith('/.git')) continue;         // not a repository marker
    const dir = rel.slice(0, -'/.git'.length);
    if (dir) out.add(dir);
  }
  return [...out].sort();
}

/**
 * Does this workspace-relative path live inside one of the nested repositories?
 *
 * ⚠️ **Segment-exact, never `startsWith`.** A repository at `app` must not swallow `application/` —
 * the prefix bug this repo has paid for in path handling before. The root itself is not "inside"
 * anything; only what is under it.
 */
export function isInsideNestedRepo(path: string, roots: readonly string[]): boolean {
  const p = String(path || '');
  return roots.some((r) => r && p.startsWith(`${r}/`));
}

/**
 * Which project owns this file — `''` for the user's own project, or the nested repository's root.
 *
 * ⚠️ **The DEEPEST matching root wins.** A repository inside a repository (a submodule checkout that
 * was itself cloned into) would otherwise be filed under its grandparent, and its files would be
 * paired with a sibling project's after all.
 */
export function projectOf(path: string, roots: readonly string[]): string {
  let best = '';
  for (const r of roots) {
    if (r && String(path || '').startsWith(`${r}/`) && r.length > best.length) best = r;
  }
  return best;
}

/**
 * Split a file map into one map per project. The user's own project is always first, even when it
 * is empty — a caller that indexes `[0]` must not silently get a nested repo's files.
 */
export function splitByProject(
  files: Record<string, string>,
  roots: readonly string[],
): Array<{ root: string; files: Record<string, string> }> {
  if (!roots || roots.length === 0) return [{ root: '', files }];
  const groups = new Map<string, Record<string, string>>([['', {}]]);
  for (const r of roots) if (r) groups.set(r, {});
  for (const [path, content] of Object.entries(files || {})) {
    const owner = projectOf(path, roots);
    const bucket = groups.get(owner) ?? groups.get('')!;
    bucket[path] = content;
  }
  return [...groups.entries()].map(([root, f]) => ({ root, files: f }));
}

/** The admin-only line. Never user-facing: a second repository is our diagnosis, not their problem. */
export function nestedRepoNote(roots: readonly string[], fileCounts: Record<string, number>): string {
  const parts = roots.map((r) => `${r} (${fileCounts[r] ?? 0} file(s))`);
  return `A separate git repository sits inside this workspace: ${parts.join(', ')}. `
    + 'Its files are judged as their own project, so a second React root or a second global '
    + 'stylesheet is not reported as a duplicate of the user\'s. Nothing was removed — a nested '
    + 'repository can be a submodule, a vendored dependency or an example app.';
}
