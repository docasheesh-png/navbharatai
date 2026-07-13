// AgentV3 — deterministic CSS-Module stub generator.
//
// WHY (Kanban build autopsy 2026-07-13): the single biggest struggle in the report was 12+ `*.module.css`
// files that components imported but were never written. The missing-files gate handed ALL of them to an
// LLM repair pass, which ran out of steps (the step-limit-80 exhaustion) — so the app shipped broken (an
// unresolved CSS-module import fails the build for the WHOLE app). But a CSS-module stub is 100%
// DETERMINISTIC: the importing file already tells us every class it uses (`styles.foo`, `styles['bar']`),
// so we can write a valid stylesheet with exactly those classes WITHOUT an LLM call. That unblocks the
// build (the import resolves; `styles.foo` returns a real scoped class instead of a crash) and — crucially
// — frees the bounded repair budget for the genuinely-hard missing files (barrels/components the LLM must
// actually author). An unstyled-but-rendering app beats a crashed one (the one absolute rule), and the
// stub is honestly marked as auto-generated so styling stays the user's/LLM's to fill in.
//
// PURE + deterministic + never throws. Only creates a file that is imported-but-absent, never overwrites.

export interface CssModuleStub {
  /** Project path of the stylesheet to create (e.g. 'src/components/ui/Select.module.css'). */
  path: string;
  /** The generated stylesheet content. */
  content: string;
  /** The class names extracted from the importing file(s), for honest diagnostics. */
  classes: string[];
}

const CODE_FILE_RE = /\.(?:m?[jt]sx?)$/i;
/** `import styles from './X.module.css'` — capture the default binding + the specifier. */
const CSS_DEFAULT_IMPORT_RE = /import\s+(\w+)\s*(?:,\s*\{[^}]*\})?\s+from\s*['"]([^'"]+\.module\.css)['"]/g;

/** Normalize a/b/../c → a/c (no filesystem). */
function normalizeRelPath(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { out.pop(); continue; }
    out.push(part);
  }
  return out.join('/');
}

/** Resolve a relative CSS import from an importer file to a project path. Returns null for non-relative. */
function resolveCssTarget(importer: string, spec: string): string | null {
  if (!spec.startsWith('./') && !spec.startsWith('../')) return null; // only relative CSS-module imports
  const dir = importer.includes('/') ? importer.slice(0, importer.lastIndexOf('/')) : '';
  return normalizeRelPath(`${dir}/${spec}`);
}

/**
 * Extract the class names a file references off a CSS-module binding: `binding.foo`, `binding['bar']`,
 * `binding["baz"]`. Returns a stable, de-duplicated, sorted list. A valid CSS identifier only.
 */
export function extractCssModuleClasses(content: string, binding: string): string[] {
  const classes = new Set<string>();
  const esc = binding.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const dot = new RegExp(`\\b${esc}\\.([A-Za-z_][\\w-]*)`, 'g');
  const bracket = new RegExp(`\\b${esc}\\[\\s*['"]([A-Za-z_][\\w-]*)['"]\\s*\\]`, 'g');
  let m: RegExpExecArray | null;
  while ((m = dot.exec(content))) classes.add(m[1]);
  while ((m = bracket.exec(content))) classes.add(m[1]);
  return [...classes].sort();
}

/** Render a valid CSS-module stylesheet from the referenced class names. */
function renderCssModule(path: string, classes: string[]): string {
  const header = `/* Auto-generated so the build compiles — '${path}'.\n` +
    `   These class hooks were derived from the component's usage; add real styles as needed. */\n`;
  if (classes.length === 0) return `${header}\n/* (no class references were found in the importing file) */\n`;
  // An empty ruleset is valid CSS and makes \`styles.foo\` resolve to a real scoped class (not undefined).
  return `${header}\n${classes.map((c) => `.${c} {\n}`).join('\n\n')}\n`;
}

/**
 * For every `*.module.css` that is IMPORTED by a source file but does NOT exist in the file set, generate a
 * deterministic stub stylesheet containing exactly the classes the importer references. Pure; never throws.
 */
export function generateMissingCssModules(files: Record<string, string>): CssModuleStub[] {
  if (!files || typeof files !== 'object') return [];
  const existing = new Set(Object.keys(files));
  const stubs: CssModuleStub[] = [];
  const seen = new Set<string>();
  for (const [path, content] of Object.entries(files)) {
    if (!CODE_FILE_RE.test(path) || typeof content !== 'string') continue;
    let m: RegExpExecArray | null;
    CSS_DEFAULT_IMPORT_RE.lastIndex = 0;
    while ((m = CSS_DEFAULT_IMPORT_RE.exec(content))) {
      const binding = m[1];
      const target = resolveCssTarget(path, m[2]);
      if (!target || existing.has(target) || seen.has(target)) continue;
      seen.add(target);
      const classes = extractCssModuleClasses(content, binding);
      stubs.push({ path: target, content: renderCssModule(target, classes), classes });
    }
  }
  return stubs;
}
