/**
 * WRITE-TIME IMPORT CHECK — catch a broken import while the agent is still holding the file.
 *
 * ADMIN REPORT 2026-08-11 (a user's Android build, repo "ball"):
 *
 *   src/components/Login.test.tsx#L2
 *   Module '"./Login"' has no exported member …
 *
 * WHY THE EXISTING MACHINERY DID NOT SAVE IT. All three parts were already there and all three fired
 * too late or too narrowly:
 *   • `ImportExportAnalysis` DETECTS this and correctly ends the build NOT READY — but detecting is not
 *     fixing, and the app still went out.
 *   • `ImportExportReconcile` deterministically FIXES it — but only a named/default KIND mismatch. A
 *     name that is not exported in ANY form is refused on purpose, because "fixing" it would mean
 *     inventing an export.
 *   • Both run at the END. `ImportExportReconcile`'s own header names the reason that fails: "in an
 *     edit turn the agent's intent was elsewhere and these files are never revisited."
 *
 * So this closes the loop at the only moment it is cheap: the write itself. The agent has just authored
 * the file, its intent is exactly here, and a note in the tool result gets fixed in the same turn
 * instead of becoming a red GitHub run the user has to report.
 *
 * 🔒 IT NEVER BLOCKS A WRITE. A wrong guess must not be able to stop work — this only appends an honest
 * note. And it uses the AST analyzer rather than a regex over the target: the workspace memory's export
 * list misses `export { a, b }` and re-exports, so checking against it would send the agent to "fix"
 * code that was already correct — worse than saying nothing.
 *
 * ⚠️ TEST FILES ONLY, deliberately. This is where the bug class actually lives (the repo's own autopsies:
 * "v5.0 repeatedly generates TEST files … that import a component with the WRONG import kind"), and it
 * bounds the cost: the check reads the handful of modules the file imports, and doing that on EVERY
 * write of a large build would be real I/O for a problem that does not live there.
 */

import { analyzeImportExports } from './ImportExportAnalysis';

const TEST_FILE = /(\.(test|spec)\.[tj]sx?)$/;
const CODE_EXT = ['.ts', '.tsx', '.js', '.jsx'];
/** A file importing more than this is not the shape this guard is for; skip rather than read them all. */
const MAX_TARGETS = 12;

/** Only test files — see the scope note in the header. */
export function shouldCheckImports(path: string): boolean {
  return TEST_FILE.test(path);
}

/** Relative import specifiers in a source file. Packages are irrelevant here — they are not ours to check. */
export function relativeSpecifiers(content: string): string[] {
  const out = new Set<string>();
  for (const m of String(content ?? '').matchAll(/(?:^|\n)\s*import[\s\S]{0,300}?from\s*['"](\.[^'"]*)['"]/g)) out.add(m[1]);
  return [...out];
}

/** Candidate on-disk paths a specifier could resolve to, in the order a bundler would try them. */
export function candidatePaths(importer: string, spec: string): string[] {
  const dir = importer.split('/').slice(0, -1);
  const stack = [...dir];
  for (const part of spec.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  const base = stack.join('/');
  return [base, ...CODE_EXT.map((e) => base + e), ...CODE_EXT.map((e) => `${base}/index${e}`)];
}

export interface ImportCheckDeps {
  /** Reads a workspace file; rejects when it does not exist. */
  readFile: (path: string) => Promise<string>;
}

/**
 * The note to append to the write's tool result — or '' when everything resolves.
 *
 * Returns plain instructions rather than a diagnostic dump: the agent acts on "export it, or import the
 * name that exists", not on a report. Any failure at all yields '' — a guard that breaks a build to
 * complain about an import would be worse than the import.
 */
export async function importCheckNote(
  path: string,
  content: string,
  deps: ImportCheckDeps,
): Promise<string> {
  try {
    if (!shouldCheckImports(path)) return '';
    const specs = relativeSpecifiers(content);
    if (specs.length === 0 || specs.length > MAX_TARGETS) return '';

    // Read only what this file imports. A missing target is NOT reported here — an import of a file
    // that does not exist yet is normal mid-build, and the readiness gate owns that case.
    const files: Record<string, string> = { [path]: content };
    for (const spec of specs) {
      for (const cand of candidatePaths(path, spec)) {
        if (files[cand] !== undefined) break;
        try {
          files[cand] = await deps.readFile(cand);
          break;
        } catch { /* try the next extension */ }
      }
    }
    if (Object.keys(files).length < 2) return '';

    const report = await analyzeImportExports(files);
    const mine = report.mismatches.filter((m) => m.file === path);
    if (mine.length === 0) return '';

    const lines = mine.slice(0, 6).map((m) =>
      m.kind === 'default-import-missing'
        ? `- line ${m.line}: "${m.from}" has no default export, but this file imports one. Use a named import, or add a default export to "${m.from}".`
        : `- line ${m.line}: "${m.from}" does not export "${m.imported}". Import a name it really exports, or export "${m.imported}" from "${m.from}".`,
    );
    return `\n\nBROKEN IMPORT in ${path} — this WILL fail the build (\`tsc\` reads test files too):\n${lines.join('\n')}\nFix it now, while you are on this file.`;
  } catch {
    return '';   // never let the guard itself affect a write
  }
}
