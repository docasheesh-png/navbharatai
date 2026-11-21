// AgentV3 — a document the user brought into the workspace is not the app, and must not be judged as it.
//
// 🔴 AUTOPSY 4d538ca3 (2026-10-01, a Bengali personal-AI-assistant app, Weak tier, "continue" turn).
// The user had put `Rabni_Roy_AI_Studio_ALL_IN_ONE-7.html` into the workspace from Code Studio — a
// self-contained page they had made elsewhere, kept as a reference. The app is Vite + React; that page
// is at the project root, imported by nothing, named in no Vite input, and absent from `dist/`. The
// model ran `evaluate` and was told the project scored **0/100**: 34 `unsafe-html-sink` findings, every
// one of them inside that page. Its own words: *"the score is 0/100 because of that unrelated file …
// I'll remove it to clean up the workspace."* — and it ran `rm` on the user's file. The prompt had
// said, in as many words, *"do not remove any existing working features"*.
//
// 🔑 THE CLASS: the readiness score, the security scan and every source analyser read EVERY file in the
// tree, so a file that is not part of what the app ships is scored as if it were. A user's reference
// page, a downloaded template, an exported design — each one can fail a working app, and the model's
// most direct way to a passing score is to delete the user's file.
//
// THE RULE, deliberately narrow (a false "outside" would hide a real finding in the app):
//   • only an HTML document can be judged outside — the measured case, and the one file type a bundled
//     project routinely carries that its bundle does not ship;
//   • only in a project with a BUNDLER (its package.json names one). A static site serves every HTML
//     file it holds, so there every page is the app;
//   • never the entry (`index.html` at the root), never anything under `public/` (copied into the build
//     as-is), and never a page whose name a bundler config mentions (a multi-page Vite input).
//
// Unknown means INSIDE: no package.json, an unreadable one, no bundler named → every file is judged,
// exactly as before. PURE — no I/O.

const BUNDLER_DEPENDENCY = /^(vite|react-scripts|next|nuxt|astro|parcel|webpack|@sveltejs\/kit|@remix-run\/dev|@angular\/core|vue-cli-service|@vue\/cli-service|gatsby|expo|rollup|esbuild|@rsbuild\/core|@rspack\/core)$/;
const HTML_DOCUMENT = /\.html?$/i;
const BUNDLER_CONFIG = /(^|\/)(vite|vitest|webpack|rollup|astro|next|nuxt|svelte|remix|rsbuild|rspack|parcel)\.config\.[cm]?[jt]s$/i;

/** Does this package.json name a bundler (so the build output is a bundle, not the raw tree)? */
export function projectHasBundler(packageJson: string | null | undefined): boolean {
  if (!packageJson) return false;
  let pkg: unknown;
  try { pkg = JSON.parse(packageJson); } catch { return false; }
  if (!pkg || typeof pkg !== 'object') return false;
  const p = pkg as Record<string, unknown>;
  for (const field of ['dependencies', 'devDependencies']) {
    const deps = p[field];
    if (deps && typeof deps === 'object' && Object.keys(deps as object).some((d) => BUNDLER_DEPENDENCY.test(d))) return true;
  }
  return false;
}

function normalize(path: string): string {
  return String(path ?? '').replace(/\\/g, '/').replace(/^(?:\.\/)+/, '').replace(/^\/+/, '');
}

function baseName(path: string): string {
  const p = normalize(path);
  return p.slice(p.lastIndexOf('/') + 1);
}

/**
 * The files in `files` that the app does not ship and so must not be scored as the app.
 *
 * @param files          workspace-relative paths (any order)
 * @param packageJson    the project's package.json text, or null when there is none
 * @param configSources  the text of the project's bundler config files (any order; others ignored)
 */
export function filesOutsideTheApp(
  files: readonly string[],
  packageJson: string | null | undefined,
  configSources: readonly { path: string; content: string }[] = [],
): Set<string> {
  const out = new Set<string>();
  if (!projectHasBundler(packageJson)) return out;
  const configText = configSources
    .filter((s) => BUNDLER_CONFIG.test(normalize(s.path)))
    .map((s) => s.content)
    .join('\n');
  for (const raw of files) {
    const path = normalize(raw);
    if (!HTML_DOCUMENT.test(path)) continue;
    if (path === 'index.html') continue;
    if (path.startsWith('public/') || path.includes('/public/')) continue;
    if (/(^|\/)(node_modules|dist|build|\.next|\.nuxt|coverage)\//.test(path)) continue;
    const name = baseName(path);
    if (configText && configText.includes(name)) continue;
    out.add(raw);
  }
  return out;
}

/**
 * A membership test that tolerates the two spellings a path arrives in (`./a.html`, `a.html`, an
 * absolute sandbox path is not expected here). Findings carry the graph's key, listings carry the
 * sandbox's; both normalise to the same string.
 */
export function outsideAppMatcher(outside: ReadonlySet<string>): (path: string) => boolean {
  if (outside.size === 0) return () => false;
  const keys = new Set([...outside].map(normalize));
  return (path: string) => keys.has(normalize(path));
}

/**
 * The line `evaluate` adds when it set files aside — so the model learns WHY the score ignores them
 * and that they are the user's to keep. '' when nothing was set aside.
 */
export function outsideTheAppNote(paths: readonly string[], setAsideFindings: number): string {
  if (paths.length === 0) return '';
  const shown = paths.slice(0, 5).join(', ');
  const more = paths.length > 5 ? `, +${paths.length - 5} more` : '';
  const why = setAsideFindings > 0 ? ` (${setAsideFindings} finding(s) in them are not counted)` : '';
  return `📎 Not judged as the app: ${shown}${more}${why}. These pages are in the workspace but are not part of `
    + 'what the app builds or ships (not the entry, not in public/, not in any folder the project\'s tsconfig includes, and named by no bundler config or script). '
    + 'They are the user\'s files — leave them exactly as they are: do not delete, move or rewrite them to change this score.';
}

/**
 * 🔴 A WHOLE FOLDER THE APP DOES NOT BUILD (failedbr #728/#731/#734/#735, queue Q-3201). An imported repo carried
 * ~480 reference files under `Anthropic/claude-code/skills/…`. The readiness snapshot reads at most 300 source
 * files, so those files crowded the real app out of it: the security scan reported "unsafe-html-sink @
 * …/artifact.d.ts", design and accessibility were "partially scanned", and four packages the app really uses
 * were called unused because the files that import them were never read.
 *
 * The project already SAYS what it builds: its tsconfig `include`. A top-level folder that no tsconfig includes,
 * that package.json's scripts, the bundler config and the root index.html never name, is not the app. Narrow:
 *   • a bundler project only, with at least one root tsconfig that has an `include` list;
 *   • an include whose first segment is a glob (`**`, `*`, `.`) covers everything ⇒ nothing is set aside;
 *   • root files are never set aside, and neither are the folders an app conventionally owns.
 * Unknown means INSIDE. PURE — no I/O.
 */
const APP_FOLDERS = new Set(['src', 'public', 'app', 'pages', 'components', 'lib', 'server', 'api', 'functions', 'supabase', 'prisma', 'e2e', 'test', 'tests', '__tests__', 'scripts', 'shared', 'packages', 'apps', 'android', 'ios', 'assets', 'styles']);

function jsonWithComments(text: string): unknown {
  try { return JSON.parse(text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'\\])\/\/[^\n]*/g, '$1').replace(/,\s*([}\]])/g, '$1')); }
  catch { return null; }
}

export function foldersOutsideTheApp(
  files: readonly string[],
  packageJson: string | null | undefined,
  projectSources: readonly { path: string; content: string }[],
): Set<string> {
  const out = new Set<string>();
  if (!projectHasBundler(packageJson)) return out;
  const covered = new Set<string>();
  let sawInclude = false;
  for (const s of projectSources) {
    if (!/^tsconfig(?:\.[\w-]+)?\.json$/.test(normalize(s.path))) continue;
    const cfg = jsonWithComments(s.content) as { include?: unknown; files?: unknown } | null;
    if (!cfg || typeof cfg !== 'object') continue;
    for (const field of ['include', 'files'] as const) {
      const list = cfg[field];
      if (!Array.isArray(list)) continue;
      if (field === 'include') sawInclude = true;
      for (const entry of list) {
        if (typeof entry !== 'string') continue;
        const first = normalize(entry).split('/')[0];
        if (!first || /[*?{[]/.test(first) || first === '.' || first === '..') return out; // covers everything
        covered.add(first);
      }
    }
  }
  if (!sawInclude) return out;
  const named = [packageJson ?? '', ...projectSources.filter((s) => BUNDLER_CONFIG.test(normalize(s.path)) || normalize(s.path) === 'index.html').map((s) => s.content)].join('\n');
  for (const raw of files) {
    const path = normalize(raw);
    const slash = path.indexOf('/');
    if (slash <= 0) continue;
    const top = path.slice(0, slash);
    if (out.has(top) || covered.has(top) || APP_FOLDERS.has(top) || top.startsWith('.')) continue;
    if (/^(node_modules|dist|build|coverage)$/.test(top)) continue;
    if (new RegExp(`(^|[^\\w-])${top.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[/\\\\'"\`\\s]|$)`).test(named)) continue;
    out.add(top);
  }
  return out;
}

/** Is this path inside one of those folders? */
export function inFolderOutsideTheApp(folders: ReadonlySet<string>): (path: string) => boolean {
  if (folders.size === 0) return () => false;
  return (path: string) => { const p = normalize(path); const i = p.indexOf('/'); return i > 0 && folders.has(p.slice(0, i)); };
}
