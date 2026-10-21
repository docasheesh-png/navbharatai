/**
 * A SHELL WRITE THE PARSER CANNOT NAME IS STILL A WRITE (autopsy 1d3ff0d5, 2026-10-21 — `SAVED_SOURCE_DIVERGES`).
 *
 * A refactor sub-agent rewrote 17 screens in one command:
 *     node -e "const files=[…]; for (const f of files) { let s=fs.readFileSync(f,'utf8'); … fs.writeFileSync(f,s); }"
 * and an earlier `for f in …; do sed -i "…" "$f"; done`. `shellWriteTargets` reads a command's plain syntax and,
 * by its own stated rule, ignores a path built at run time — `f` and `"$f"` name no file. So none of the 17 reached
 * the captured writes; the final save then let the OLDER captured copies win; and the project that was saved, restored
 * into the next session and published was NOT the app that had been previewed. The engine itself said so
 * ("A write was recorded one way and landed another") and nothing acted on it.
 *
 * THE CLASS: precision-over-recall is right for the Green Freeze (a false target refuses a legitimate command) and
 * WRONG for the ledger (a missed target silently loses work; an extra read-back costs nothing). Both used one parser.
 * So the ledger no longer depends on the parser alone: when a command is the kind that can write files the parser
 * cannot name, the sandbox is asked which files changed during it (`find -newer` against a marker), and those are
 * read back through the one door like any other write.
 *
 * PURE: no I/O here. The marker and the listing run at the call site (ToolDispatcher).
 */

/** The marker file whose mtime brackets one command. Outside the workspace, so it is never listed or saved. */
export const SHELL_MARK = '/tmp/.nbai-shell-mark';

/** At most this many changed files are read back after one command. */
export const MAX_RECONCILED = 80;

/** A file larger than this is not read back (lockfiles, bundles): it is never hand-edited source. */
export const MAX_RECONCILED_BYTES = 400_000;

// Syntax that can change files by a path the static parser cannot see: an inline script that writes, an in-place
// edit (often looped over `$f`), `tee`, `xargs`/`find -exec` fan-out, or a redirect to a variable.
const OPAQUE_WRITE =
  /\b(?:node|nodejs|python3?|perl|ruby|deno|bun)\b[^\n]*?(?:\s-[a-zA-Z]*[ecp]\b|<<)|\b(?:sed|perl)\b[^\n|;&]*\s-[a-zA-Z]*i\b|\bsed\s+--in-place\b|\bxargs\b|\s-exec(?:dir)?\b|\btee\b|>>?\s*["']?\$|\bwriteFile(?:Sync)?\b|\bappendFile(?:Sync)?\b|\bwrite_(?:text|bytes)\b/;

/** Can this command write workspace files the static parser would miss? Recall over precision, on purpose. PURE. */
export function shellMayWriteOpaquely(command: string): boolean {
  return OPAQUE_WRITE.test(String(command ?? ''));
}

/** Touch the marker. Run BEFORE the command. */
export function markCommand(): string {
  return `touch ${SHELL_MARK}`;
}

/** The workspace files modified since the marker, source only, newest set capped. Run AFTER the command. */
export function changedFilesCommand(): string {
  return `find . -type f -newer ${SHELL_MARK} -not -path '*/node_modules/*' -not -path '*/.*' -not -path './dist/*' `
    + `-not -path './build/*' -not -path './coverage/*' -not -name 'package-lock.json' -not -name '*.log' `
    + `-size -${Math.floor(MAX_RECONCILED_BYTES / 1000)}k 2>/dev/null | head -${MAX_RECONCILED}`;
}

/** Text a build writes by hand. A binary the command produced is never read back as a string. */
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|css|scss|less|html?|json|md|mdx|svg|txt|vue|svelte|ya?ml|toml|prisma|sql|graphql)$/i;

/** The listing as workspace-relative paths; anything not a plain relative path is dropped. PURE. */
export function parseChangedFiles(stdout: unknown, alreadyRecorded: Iterable<string> = []): string[] {
  const seen = new Set(alreadyRecorded);
  const out: string[] = [];
  for (const line of String(stdout ?? '').split('\n')) {
    const p = line.trim().replace(/^\.\//, '');
    if (!p || p.startsWith('/') || p.startsWith('../') || p.includes('\0') || /[\r\t]/.test(p) || seen.has(p) || !SOURCE_FILE.test(p)) continue;
    seen.add(p);
    out.push(p);
    if (out.length >= MAX_RECONCILED) break;
  }
  return out;
}
