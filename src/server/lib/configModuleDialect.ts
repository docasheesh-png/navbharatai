// A CONFIG FILE MUST SPEAK THE DIALECT ITS PROJECT DECLARES — or Node refuses to load it.
//
// ── THE FAILURE THIS EXISTS FOR (APK build report, 12thmentors, 2026-09-19) ──────────────────────
//
// A user's app died on the GitHub runner in 46 seconds, before a single module was transformed:
//
//   [Failed to load PostCSS config: [ReferenceError] module is not defined in ES module scope
//    This file is being treated as an ES module because it has a '.js' file extension and
//    package.json contains "type": "module". To treat it as a CommonJS script, rename it to '.cjs'.]
//
// The app had `postcss.config.js` written in CommonJS (`module.exports = …`) and a `package.json`
// declaring `"type": "module"`. Both halves are ordinary and correct on their own; TOGETHER they are
// fatal, and nothing in the pipeline was looking at the pair.
//
// 🔴 WHY NO EXISTING CHECK COULD HAVE CAUGHT IT, and this is the whole reason for a new module.
// `mobileShipPreflight` runs three checks — esbuild SYNTAX, unresolved local imports, missing npm
// packages — and this file passes all three cleanly. `module.exports = {}` is perfectly valid
// JavaScript, so the parser is happy; it imports nothing, so the resolver is happy; it declares no
// package, so the reconciler is happy. **The failure is not in the file. It is in the RELATIONSHIP
// between the file's extension, its contents, and one field in package.json** — and a checker that
// only ever looks at one file at a time is structurally incapable of seeing a relationship.
//
// ⚠️ AND IT ONLY BITES AT *LOAD* TIME, WHICH IS WHY IT REACHES THE RUNNER. Vite loads the PostCSS
// config with a real `import()` before it transforms anything, so the app "compiles fine" everywhere
// we test it and dies on the one machine that actually runs the build.
//
// ── WHY THE FIX REWRITES ONE SHAPE AND RENAMES NOTHING ───────────────────────────────────────────
//
// Node's own suggestion is to rename the file to `.cjs`, and that is the more general fix — but it
// cannot be applied here, and the reason is worth recording rather than re-derived. The heal's output
// reaches the user's workspace through `mergeWorkspaceFiles(workspaceId, changed)`, which is
// ADDITIVE: it has no way to express a deletion. A rename would therefore leave the broken
// `postcss.config.js` sitting beside the new `postcss.config.cjs` in the user's own app — and
// postcss-load-config prefers `.js` — so the GitHub build would pass while the user's preview stayed
// broken. That is fixing one problem by creating another, which the fourth absolute rule forbids.
//
// So the fix converts IN PLACE, and only for the one shape where the two dialects are provably
// identical: a file that is nothing but a comment header and `module.exports = <object literal>`.
// For that shape `export default <the same literal>` is the same value by the same name, and there is
// nothing to get wrong. Anything else — a config that calls `require()`, computes its value, or
// assigns `module.exports.foo` — is REPORTED and left exactly as written, because a rewrite there
// would be a guess about code this module did not write.
//
// 🔒 SCOPED TO ROOT CONFIG FILES, DELIBERATELY. A `.js` file inside `src/` is loaded by the BUNDLER,
// which handles CommonJS interop in its own graph and never consults `"type"` — converting one would
// be a change with no failure behind it. Only files Node loads DIRECTLY, by convention, at the
// project root are affected, and those are exactly the `*.config.js` / `.*rc.js` names below.
//
// PURE: files in, files out. No clock, no filesystem, no network — every rule here is unit-testable.

/** The project's declared module system. `unknown` when package.json is missing or unreadable. */
export type ProjectModuleType = 'module' | 'commonjs' | 'unknown';

/**
 * What `package.json` says this project is.
 *
 * Node's own default is CommonJS when the field is absent, and that default is reported as
 * `'commonjs'` rather than `'unknown'` because it is a real, load-bearing answer — an ESM-only config
 * in such a project fails just as hard, in the opposite direction. `'unknown'` is reserved for "we
 * could not read package.json at all", where the honest move is to change nothing.
 */
export function projectModuleType(files: Record<string, string>): ProjectModuleType {
  const raw = files['package.json'];
  if (typeof raw !== 'string') return 'unknown';
  try {
    const pkg = JSON.parse(raw) as { type?: unknown };
    if (!pkg || typeof pkg !== 'object') return 'unknown';
    return pkg.type === 'module' ? 'module' : 'commonjs';
  } catch {
    // An unparseable package.json is the syntax check's finding, not ours — and guessing a dialect
    // from a file we could not read is exactly how a "fix" invents a second failure.
    return 'unknown';
  }
}

/**
 * Root config files Node loads by itself — the only place `"type"` decides whether a file parses.
 *
 * `*.config.js` covers postcss / tailwind / vite / babel / jest / playwright and anything later
 * adopting the same convention, so this does not need a list of tools to stay current. The `.*rc.js`
 * arm is the older convention (`.eslintrc.js`, `.prettierrc.js`) that does not carry `.config`.
 */
const ROOT_CONFIG = /^(?:[A-Za-z0-9_.-]+\.config\.js|\.[A-Za-z0-9_-]+rc\.js)$/;

/** ESM markers: a top-level `import`/`export` statement. */
const ESM_SYNTAX = /^\s*(?:import\s[\s\S]*?from\s|import\s*['"]|export\s+(?:default|const|let|var|function|class|\{|\*))/m;
/** CommonJS markers: the two things that do not exist in an ES module scope. */
const CJS_SYNTAX = /(?:^|[^.\w])(?:module\s*\.\s*exports|exports\s*\.\s*[A-Za-z_$]|require\s*\()/;

/** Which dialect a file is written in, or null when it says nothing either way. */
export function fileDialect(content: string): 'esm' | 'cjs' | null {
  const esm = ESM_SYNTAX.test(content);
  const cjs = CJS_SYNTAX.test(content);
  // BOTH is not a coin toss — it is a file this module does not understand, and the honest answer is
  // to leave it alone. A config mixing the two is already broken in a way no conversion can repair.
  if (esm === cjs) return null;
  return esm ? 'esm' : 'cjs';
}

export interface DialectMismatch {
  /** The config file. */
  path: string;
  /** The dialect its contents are written in. */
  dialect: 'esm' | 'cjs';
  /** True when the file is the plain-object shape this module can convert safely. */
  fixable: boolean;
  /** Plain-language, for the preflight report and for the user. */
  message: string;
}

/**
 * Split a file into its leading comment header and the rest.
 *
 * The header matters: `tailwind.config.js` carries `/** @type {import('tailwindcss').Config} *\/`,
 * which is what gives an editor autocompletion inside the object. A conversion that dropped it would
 * be a silent downgrade of the user's app, so it is carried across unchanged.
 */
function splitLeadingComments(content: string): { header: string; rest: string } {
  let i = 0;
  for (;;) {
    const next = content.slice(i);
    const ws = next.match(/^\s+/);
    if (ws) { i += ws[0].length; continue; }
    if (next.startsWith('//')) { i += next.indexOf('\n') === -1 ? next.length : next.indexOf('\n') + 1; continue; }
    if (next.startsWith('/*')) {
      const end = next.indexOf('*/');
      if (end === -1) break; // an unterminated comment is not a file to rewrite
      i += end + 2;
      continue;
    }
    break;
  }
  return { header: content.slice(0, i), rest: content.slice(i) };
}

/**
 * The object literal a plain single-assignment config exports, or null when it is anything else.
 *
 * "Anything else" is the important half: a `require()` anywhere, a second statement, a computed value
 * or a named-property assignment all return null, and the caller then reports without touching. The
 * value must START as a literal (`{` or `[`) because that is what makes the two dialects equivalent —
 * an identifier or a call would carry a binding this conversion cannot see.
 */
function soleExportedLiteral(content: string, dialect: 'esm' | 'cjs'): string | null {
  if (/require\s*\(/.test(content)) return null;
  const { rest } = splitLeadingComments(content);
  const m = dialect === 'cjs'
    ? rest.match(/^module\s*\.\s*exports\s*=\s*([\s\S]*?);?\s*$/)
    : rest.match(/^export\s+default\s+([\s\S]*?);?\s*$/);
  if (!m) return null;
  const value = m[1].trim();
  if (!/^[{[]/.test(value)) return null;
  // A second statement after the literal would have been swallowed by the lazy match above, so the
  // value is re-checked for the markers that prove it is not a lone literal.
  if (dialect === 'cjs' && /module\s*\.\s*exports|exports\s*\./.test(value)) return null;
  if (dialect === 'esm' && /^\s*(?:import|export)\s/m.test(value)) return null;
  return value;
}

/**
 * Every root config whose dialect contradicts the project's declared module type.
 *
 * Returns an empty list for an unknown project type, for a config that says nothing either way, and
 * for one already carrying an unambiguous `.cjs` / `.mjs` extension — none of those can fail this way.
 */
export function detectDialectMismatches(files: Record<string, string>): DialectMismatch[] {
  const projectType = projectModuleType(files);
  if (projectType === 'unknown') return [];

  const out: DialectMismatch[] = [];
  for (const path of Object.keys(files).sort()) {
    if (!ROOT_CONFIG.test(path)) continue;
    const content = files[path];
    if (typeof content !== 'string') continue;

    const dialect = fileDialect(content);
    if (!dialect) continue;
    if (projectType === 'module' ? dialect !== 'cjs' : dialect !== 'esm') continue;

    const fixable = soleExportedLiteral(content, dialect) !== null;
    const wanted = projectType === 'module' ? 'export default' : 'module.exports';
    const found = dialect === 'cjs' ? 'module.exports / require' : 'import / export';
    const because = projectType === 'module'
      ? 'package.json sets "type": "module", so Node loads it as an ES module'
      : 'package.json does not set "type": "module", so Node loads it as CommonJS';
    out.push({
      path,
      dialect,
      fixable,
      message:
        `${path} is written with ${found}, but ${because} — the build stops before it starts `
        + `("module is not defined in ES module scope"). It needs to use ${wanted}`
        + (fixable ? '.' : `, and its contents are too involved to convert automatically.`),
    });
  }
  return out;
}

export interface DialectFixResult {
  files: Record<string, string>;
  /** Only what changed — what the ship pipeline merges back into the user's workspace. */
  changed: Record<string, string>;
  notes: string[];
}

/**
 * Convert every FIXABLE mismatch in place. The file keeps its name; only the export form changes.
 *
 * A mismatch this module cannot convert safely is left exactly as written — it still appears in
 * `detectDialectMismatches`, so the preflight reports it and the AI repair pass sees it, which is the
 * honest outcome for code with a shape nobody here understood.
 */
export function applyDialectFix(input: Record<string, string>): DialectFixResult {
  const files = { ...input };
  const changed: Record<string, string> = {};

  for (const m of detectDialectMismatches(input)) {
    if (!m.fixable) continue;
    const content = files[m.path];
    const literal = soleExportedLiteral(content, m.dialect);
    if (literal === null) continue;
    const { header } = splitLeadingComments(content);
    const next = m.dialect === 'cjs'
      ? `${header}export default ${literal};\n`
      : `${header}module.exports = ${literal};\n`;
    if (next === content) continue;
    files[m.path] = next;
    changed[m.path] = next;
  }

  const n = Object.keys(changed).length;
  const notes = n > 0
    ? [`Corrected ${n} setup file${n === 1 ? '' : 's'} (${Object.keys(changed).join(', ')}) so your app's build can load ${n === 1 ? 'it' : 'them'}.`]
    : [];
  return { files, changed, notes };
}

/**
 * The dialect a config file should be WRITTEN in for this project — for the code that generates one.
 *
 * 🔴 THIS IS THE UPSTREAM HALF, AND IT IS THE HALF THAT ACTUALLY CAUSED THE REPORTED FAILURE.
 * `tailwindSetupHeal` completes a broken Tailwind setup by writing `postcss.config.js` and
 * `tailwind.config.js`, and it hardcoded `module.exports` — while `Scaffold.ts`, which creates the
 * project in the first place, writes `"type": "module"` and `export default`. So the heal's own
 * output was the incompatible pair, on every ESM project it ever fired for. The detector above is the
 * net; this is the fix that stops anything falling into it.
 *
 * An unknown project type answers `'cjs'`, matching Node's own default for a project that declares
 * nothing — the same assumption Node makes when it loads the file.
 */
export function configDialectFor(files: Record<string, string>): 'esm' | 'cjs' {
  return projectModuleType(files) === 'module' ? 'esm' : 'cjs';
}

/** Render a plain config object literal in the given dialect. The one place the two forms are spelled. */
export function configModuleSource(dialect: 'esm' | 'cjs', body: string): string {
  return dialect === 'esm' ? `export default ${body};\n` : `module.exports = ${body};\n`;
}
