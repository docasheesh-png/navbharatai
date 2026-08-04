/**
 * Phase 3 — In-browser React/Vite preview (no server, no WebContainer).
 *
 * Frontend React projects (the default `vite-react` scaffold) can't be served by
 * the plain static builder (they use JSX + ESM module imports) and the heavy
 * WebContainer/server-container runtimes aren't always provisioned. This builds
 * ONE self-contained HTML document that previews such an app entirely in the
 * browser: React/ReactDOM from a CDN, Babel-standalone to transpile JSX/TS, and a
 * tiny module loader that wires the project's own ESM modules together.
 *
 * Scope (kept honest): relative imports (`./x`, `../y`), CSS imports (injected as
 * <style>), and the `react` / `react-dom` / `react-dom/client` bare specifiers.
 * Any other bare dependency surfaces a clear in-preview error rather than a silent
 * blank screen — heavier apps still belong on the server/WebContainer runtime.
 *
 * Pure + dependency-free (string in → string out) → unit-testable.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { VirtualFileSystem } from '../project/ProjectModel';
import { normalizePath } from '../project/ProjectModel';
import { ashokChakraSvg } from '../../lib/ashokChakra';

// Compiler is self-hosted on NavBharatAI's own origin (served from public/vendor)
// so it is never blocked by a third-party CDN; CDNs are only a fallback chain.
const BABEL_PRIMARY = '/vendor/babel.min.js';

// BULLETPROOF compiler delivery: INLINE the Babel source straight into the preview HTML. A
// <script src=…> can fail in a sandboxed <iframe srcDoc> (root-relative paths don't resolve, an
// absolute URL can 404 if the asset isn't deployed, and every third-party CDN is blocked by the
// app's CSP) — which is exactly the recurring "Could not load the preview compiler" error. An
// inline <script> is same-document (CSP allows 'unsafe-inline'), needs NO network and NO asset
// serving, so the compiler is ALWAYS present. Read once from disk and cached.
let _babelInlineCache: string | null | undefined;
function babelInlineSource(): string | null {
  if (_babelInlineCache !== undefined) return _babelInlineCache;
  // Tests assert the <script src=…> markup (the no-network fallback), so skip inlining under vitest.
  if (process.env.VITEST) { _babelInlineCache = null; return null; }
  const candidates = [
    join(process.cwd(), 'public/vendor/babel.min.js'),
    join(process.cwd(), 'dist/vendor/babel.min.js'),
    join(process.cwd(), 'node_modules/@babel/standalone/babel.min.js'),
  ];
  for (const p of candidates) {
    try {
      const src = readFileSync(p, 'utf8');
      if (src && src.length > 100_000) { _babelInlineCache = src; return src; }
    } catch { /* try the next path */ }
  }
  _babelInlineCache = null; // none readable — fall back to <script src=…>
  return null;
}
const BABEL_FALLBACKS = [
  'https://cdn.jsdelivr.net/npm/@babel/standalone@7.26.4/babel.min.js',
  'https://unpkg.com/@babel/standalone@7.26.4/babel.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.26.4/babel.min.js',
];
const ESM = 'https://esm.sh/';
// Externalize ONLY react/react-dom on esm.sh (single shared React); everything else a package
// needs is bundled by esm.sh with absolute URLs — see the note in buildImportmap.
const EXTERNAL_REACT_Q = '?external=react,react-dom';

// VENDORED SAME-ORIGIN REACT (admin 2026-08-03, "in-browser preview ko 100x more strong"): the single
// most fragile link in the in-browser preview is fetching React ITSELF from third-party CDNs — when
// esm.sh/jsdelivr/unpkg all blip (autopsy ce713a7e proved a two-host blip is real), no fallback chain
// can save a preview whose FOUNDATION failed to load. So React 18 now ships from NavBharatAI's OWN
// origin (public/vendor/react18: the official UMD builds + tiny same-origin ESM facades over
// window.React), exactly like the self-hosted Babel compiler above. The CDN chain remains as the
// fallback — a facade throws when the UMD did not load, which drops that specifier into the existing
// 4-rung CDN ladder. Only applies when the app targets React 18 (or pins no version — the scaffold
// default): the vendored runtime IS 18.3.1, and silently substituting it under a React 19/17 app
// would change semantics. Kill switch: AGENTV3_VENDOR_REACT=off.
const VENDOR_REACT_DIR = '/vendor/react18';
const VENDOR_REACT_SHIMS: Record<string, string> = {
  react: '/react.mjs',
  'react-dom': '/react-dom.mjs',
  'react-dom/client': '/react-dom-client.mjs',
  'react/jsx-runtime': '/jsx-runtime.mjs',
  'react/jsx-dev-runtime': '/jsx-dev-runtime.mjs',
};

/** The app's pinned React major version, or null when package.json pins none. */
function pinnedReactMajor(vfs: VirtualFileSystem): number | null {
  try {
    const pkg = JSON.parse(vfs.readText('package.json') || '{}');
    const raw = String(pkg?.dependencies?.react ?? pkg?.devDependencies?.react ?? '');
    const m = raw.match(/(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  } catch { return null; }
}

/**
 * Base URL for the vendored React runtime, or null when it must not be used: no origin to resolve
 * against (a sandboxed srcDoc iframe cannot load root-relative URLs), the kill switch is set, or the
 * app targets a non-18 React major. Exported for tests.
 */
export function vendoredReactBase(vfs: VirtualFileSystem, origin?: string): string | null {
  if (!origin) return null;
  if (process.env.AGENTV3_VENDOR_REACT === 'off') return null;
  const major = pinnedReactMajor(vfs);
  if (major !== null && major !== 18) return null;
  return `${origin.replace(/\/$/, '')}${VENDOR_REACT_DIR}`;
}

const SOURCE_EXT = ['.jsx', '.js', '.tsx', '.ts', '.mjs'];
const CSS_EXT = ['.css'];

// shadcn/ui token registry for the in-browser Tailwind Play CDN (admin 2026-07-17). Exported so it is
// unit-testable. The Play CDN ignores the project's tailwind.config.js, so these standard tokens must be
// declared inline or `@apply border-border` / `bg-background` / `text-foreground` throw "class does not
// exist" and kill the preview. Every colour maps to a CSS variable (shadcn convention); SHADCN_CSS_VARS
// supplies safe light-theme defaults so it renders even when the imported app omitted its `:root`.
export const SHADCN_TW_CONFIG =
  "tailwind.config={darkMode:['class'],theme:{extend:{colors:{" +
  "border:'hsl(var(--border))',input:'hsl(var(--input))',ring:'hsl(var(--ring))'," +
  "background:'hsl(var(--background))',foreground:'hsl(var(--foreground))'," +
  "primary:{DEFAULT:'hsl(var(--primary))',foreground:'hsl(var(--primary-foreground))'}," +
  "secondary:{DEFAULT:'hsl(var(--secondary))',foreground:'hsl(var(--secondary-foreground))'}," +
  "destructive:{DEFAULT:'hsl(var(--destructive))',foreground:'hsl(var(--destructive-foreground))'}," +
  "muted:{DEFAULT:'hsl(var(--muted))',foreground:'hsl(var(--muted-foreground))'}," +
  "accent:{DEFAULT:'hsl(var(--accent))',foreground:'hsl(var(--accent-foreground))'}," +
  "popover:{DEFAULT:'hsl(var(--popover))',foreground:'hsl(var(--popover-foreground))'}," +
  "card:{DEFAULT:'hsl(var(--card))',foreground:'hsl(var(--card-foreground))'}}," +
  "borderRadius:{lg:'var(--radius)',md:'calc(var(--radius) - 2px)',sm:'calc(var(--radius) - 4px)'}}}};";

export const SHADCN_CSS_VARS =
  ':root{--background:0 0% 100%;--foreground:222.2 84% 4.9%;--card:0 0% 100%;--card-foreground:222.2 84% 4.9%;' +
  '--popover:0 0% 100%;--popover-foreground:222.2 84% 4.9%;--primary:222.2 47.4% 11.2%;--primary-foreground:210 40% 98%;' +
  '--secondary:210 40% 96.1%;--secondary-foreground:222.2 47.4% 11.2%;--muted:210 40% 96.1%;--muted-foreground:215.4 16.3% 46.9%;' +
  '--accent:210 40% 96.1%;--accent-foreground:222.2 47.4% 11.2%;--destructive:0 84.2% 60.2%;--destructive-foreground:210 40% 98%;' +
  '--border:214.3 31.8% 91.4%;--input:214.3 31.8% 91.4%;--ring:222.2 84% 4.9%;--radius:0.5rem}';

/** True if this VFS looks like a frontend React app we can bundle in-browser. */
export function isReactProject(vfs: VirtualFileSystem): boolean {
  const pkgText = vfs.readText('package.json');
  if (pkgText) {
    try {
      const pkg = JSON.parse(pkgText);
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      if (deps.react) return true;
    } catch (e) { console.warn('[preview] package.json parse failed:', e); } // BUG C2 FIX
  }
  // fallback: any JSX/TSX source present
  return vfs.paths().some((p) => p.endsWith('.jsx') || p.endsWith('.tsx'));
}

/** True if `p` is a source (not test) module file. */
const isEntryCandidateFile = (p: string): boolean =>
  SOURCE_EXT.some((e) => p.endsWith(e)) && !/\.(test|spec)\.[jt]sx?$/.test(p);

/**
 * Pick the best entry from a set of candidate paths: prefer `main.*` over `index.*`, then a
 * shallower path (closer to root / in `src/`). Deterministic.
 */
function pickBestEntry(paths: string[]): string | null {
  if (paths.length === 0) return null;
  return [...paths].sort((a, b) => {
    const am = /(^|\/)main\.[jt]sx?$/.test(a) ? 0 : 1;
    const bm = /(^|\/)main\.[jt]sx?$/.test(b) ? 0 : 1;
    return am - bm || a.split('/').length - b.split('/').length || a.length - b.length;
  })[0];
}

/**
 * Find the module entry: the <script type=module src> in index.html, else common defaults, else a
 * RESILIENT fallback to any `main`/`index` source file anywhere in the tree. The fallback matters
 * because the file map can reach the preview keyed under an unexpected prefix or from a partial
 * restore — without it the preview died with "No React entry module found" even though an entry
 * clearly exists (e.g. src/main.tsx referenced by index.html).
 */
function findEntry(vfs: VirtualFileSystem): string | null {
  const html = vfs.readText('index.html');
  if (html) {
    const m = html.match(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/i);
    if (m) {
      const spec = m[1].replace(/^\//, '');
      const resolved = resolveModule(vfs, normalizePath(spec));
      if (resolved) return resolved;
      // The script src didn't resolve by exact path — match its BASENAME anywhere in the tree
      // (handles a file map keyed under an unexpected prefix / leading slash).
      const base = (spec.split('/').pop() || '').replace(/\.[^./]+$/, '');
      if (base) {
        const byBase = vfs.paths().filter(
          (p) => isEntryCandidateFile(p) && (p.split('/').pop() || '').replace(/\.[^./]+$/, '') === base,
        );
        const best = pickBestEntry(byBase);
        if (best) return best;
      }
    }
  }
  for (const cand of ['src/main.jsx', 'src/main.tsx', 'src/index.jsx', 'src/index.tsx', 'src/main.js', 'src/index.js']) {
    if (vfs.has(cand)) return cand;
  }
  // LAST RESORT — any main/index source file anywhere in the tree, so the in-browser preview renders
  // instead of failing when the entry sits at a non-standard path or under an unexpected key prefix.
  return pickBestEntry(vfs.paths().filter((p) => isEntryCandidateFile(p) && /(^|\/)(main|index)\.[jt]sx?$/.test(p)));
}

/** Strip // line and /* *\/ block comments so a commented tsconfig.json still JSON-parses. */
function stripJsonComments(raw: string): string {
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Build the project's path-alias map for the in-browser resolver — the fix for imported
 * shadcn/Vite/Next/Lovable/Bolt apps whose `@/…` imports were wrongly sent to the esm.sh CDN
 * ("Could not load @/components/ui/toaster") instead of resolving to a LOCAL file. Returns a map of
 * `aliasPrefix → root-absolute target` (e.g. `{ '@': '/client/src' }`), read in priority order from:
 *   1. tsconfig/jsconfig `compilerOptions.paths` (JSON — the reliable source: `"@/*": ["./client/src/*"]`)
 *   2. `vite.config.*` `resolve.alias` (best-effort regex)
 *   3. a heuristic: if `@/…` imports appear but no config declares the alias, infer `@` → the entry's
 *      src root (shadcn's `@` always maps to the src dir). Pure + unit-testable.
 */
export function buildAliasMap(vfs: VirtualFileSystem, entry: string | null): Record<string, string> {
  const aliases: Record<string, string> = {};
  const addAlias = (prefix: string, targetDir: string): void => {
    const p = prefix.replace(/\/\*$/, '').replace(/\*$/, '').replace(/\/$/, '');
    const d = targetDir.replace(/\/\*$/, '').replace(/\*$/, '').replace(/^\.\//, '').replace(/^\//, '').replace(/\/$/, '');
    if (p && d && !aliases[p]) aliases[p] = '/' + d;
  };
  // 1. tsconfig / jsconfig compilerOptions.paths
  for (const cfg of ['tsconfig.json', 'tsconfig.app.json', 'tsconfig.base.json', 'jsconfig.json']) {
    const raw = vfs.readText(cfg);
    if (!raw) continue;
    let json: { compilerOptions?: { paths?: Record<string, unknown> } };
    try { json = JSON.parse(stripJsonComments(raw)); } catch { continue; }
    const paths = json?.compilerOptions?.paths;
    if (paths && typeof paths === 'object') {
      for (const key of Object.keys(paths)) {
        const t = paths[key];
        const target = Array.isArray(t) ? t[0] : t;
        if (typeof key === 'string' && typeof target === 'string') addAlias(key, target);
      }
    }
  }
  // 2. vite.config.* resolve.alias (best-effort — the config is JS, so a targeted regex, not a parse)
  for (const cfg of vfs.paths().filter((p) => /(^|\/)vite\.config\.[cm]?[jt]s$/.test(p))) {
    const raw = vfs.readText(cfg) || '';
    // Matches  '@': path.resolve(__dirname, './client/src')  |  '@': '/src'  |  "@": fileURLToPath(new URL('./src', …))
    // The lazy [^}\n]*? spans a helper call's own args (incl. commas) up to the FIRST quoted …src… path.
    const re = /['"]([^'"]+)['"]\s*:\s*[^}\n]*?['"](\.?\/?[^'"]*src[^'"]*)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw))) addAlias(m[1], m[2]);
  }
  // 3. Heuristic default for `@` when the app uses it but no config declared it (very common export shape).
  if (!aliases['@']) {
    const usesAt = vfs.paths().some((p) => SOURCE_EXT.some((e) => p.endsWith(e)) && /(?:from|import|require\(|import\()\s*['"]@\//.test(vfs.readText(p) || ''));
    if (usesAt && entry) {
      const srcIdx = entry.lastIndexOf('/src/');
      if (srcIdx >= 0) aliases['@'] = '/' + entry.slice(0, srcIdx + 4);       // client/src/main.tsx → /client/src
      else if (entry.startsWith('src/')) aliases['@'] = '/src';               // src/main.tsx → /src
      else if (entry.includes('/')) aliases['@'] = '/' + entry.slice(0, entry.lastIndexOf('/')); // entry dir
    }
  }
  return aliases;
}

/** Resolve a module path (with/without extension, or /index) against the VFS. */
function resolveModule(vfs: VirtualFileSystem, path: string): string | null {
  if (vfs.has(path)) return path;
  for (const ext of [...SOURCE_EXT, ...CSS_EXT]) {
    if (vfs.has(path + ext)) return path + ext;
  }
  for (const ext of SOURCE_EXT) {
    if (vfs.has(`${path}/index${ext}`)) return `${path}/index${ext}`;
  }
  return null;
}

/** Collect the base stylesheet(s) referenced by index.html (local <link>). */
function baseStyles(vfs: VirtualFileSystem): string {
  const html = vfs.readText('index.html');
  if (!html) return '';
  const css: string[] = [];
  const re = /<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = m[0].match(/href=["']([^"']+)["']/i)?.[1];
    if (!href || /^(https?:)?\/\//.test(href)) continue;
    const text = vfs.readText(normalizePath(href.replace(/^\//, '')));
    if (text) css.push(text);
  }
  return css.join('\n');
}

/**
 * Build a self-contained, in-browser-bundled React preview document.
 * Returns an HTML string; if no entry module is found, falls back to a clear notice.
 */
export function buildReactPreview(vfs: VirtualFileSystem, origin?: string): string {
  const entry = findEntry(vfs);
  // Load the self-hosted compiler via an ABSOLUTE same-origin URL when the caller's origin is known
  // (root-relative paths don't resolve inside a sandboxed <iframe srcDoc>). Falls back to the
  // root-relative path when no origin is provided (e.g. unit tests, the /preview/:id static route).
  const babelPrimary = origin ? `${origin.replace(/\/$/, '')}${BABEL_PRIMARY}` : BABEL_PRIMARY;
  // Prefer INLINING the compiler (always works); fall back to a <script src=…> only when the source
  // can't be read from disk. The escapes guard against the (extremely unlikely) "</script>" in the
  // minified source breaking out of the tag.
  const inlineBabel = babelInlineSource();
  const babelTag = inlineBabel
    ? `<script>${inlineBabel.replace(/<\/script>/gi, '<\\/script>')}</script>`
    : `<script src="${babelPrimary}"></script>`;

  // Gather every source + css module so the in-browser loader can resolve imports.
  const modules: Record<string, string> = {};
  for (const path of vfs.paths()) {
    if ([...SOURCE_EXT, ...CSS_EXT].some((e) => path.endsWith(e))) {
      const text = vfs.readText(path);
      if (text != null) modules[path] = text;
    }
  }

  if (!entry) {
    return `<!doctype html><html><body style="font-family:system-ui;padding:24px;color:#444">`
      + `<h3>No React entry module found</h3>`
      + `<p>Expected a module entry (e.g. <code>src/main.jsx</code>) referenced by index.html.</p></body></html>`;
  }

  const payload = JSON.stringify({ entry, modules }).replace(/<\//g, '<\\/');
  // Vendored same-origin React runtime (see vendoredReactBase): the UMD builds load as plain
  // <script>s BEFORE the importmap's facades ever execute, so window.React/window.ReactDOM are
  // guaranteed present when a facade module runs. If either script fails to load, the facades
  // throw an explicit error and the loader's 4-rung CDN ladder takes over for that specifier.
  const vendorBase = vendoredReactBase(vfs, origin);
  const vendorScripts = vendorBase
    ? `<script src="${vendorBase}/react.production.min.js"></script>\n<script src="${vendorBase}/react-dom.production.min.js"></script>\n`
    : '';
  const importmap = JSON.stringify({ imports: buildImportmap(vfs, vendorBase) }).replace(/<\//g, '<\\/');
  // Path aliases (@/… → local src) so imported shadcn/Vite/Next apps resolve locally, not via esm.sh.
  const aliasesJson = JSON.stringify(buildAliasMap(vfs, entry)).replace(/<\//g, '<\\/');
  const css = baseStyles(vfs);
  // TAILWIND: an app that uses Tailwind (its CSS has @tailwind directives, or a tailwind.config exists)
  // needs PostCSS to generate the utility classes — which the no-build in-browser preview can't run, so
  // the preview was UNSTYLED. The Tailwind Play CDN compiles Tailwind in the browser at runtime: load it,
  // and put the project CSS in a <style type="text/tailwindcss"> so @tailwind/@apply are processed too.
  // Vite apps import their CSS from JS (`import './index.css'`) rather than via a <link>, so most Tailwind
  // CSS arrives through the runtime loader's injectCss — which appends into the `#__nbai-tw` block below.
  const usesTailwind = Object.values(modules).some((v) => /@tailwind\b|@apply\b/.test(v))
    || vfs.paths().some((p) => /(^|\/)tailwind\.config\.[cm]?[jt]s$/.test(p));
  // shadcn/ui DESIGN-TOKEN CONTRACT for the Tailwind Play CDN (admin 2026-07-17 — "border/colour error
  // kabhi wapas na aaye"). ROOT CAUSE (mitrify2 import): the Play CDN does NOT read the project's
  // tailwind.config.js, so a stylesheet using shadcn utilities — `@apply border-border`, `bg-background`,
  // `text-foreground`, … — failed to compile with "The `border-border` class does not exist" and the
  // whole preview died. We register the standard shadcn token set in an INLINE config (so every such
  // utility EXISTS) and supply default CSS variables (so the colours actually render even when the app
  // forgot its `:root` block; the app's own `:root`, injected after, always wins). Harmless for a
  // non-shadcn Tailwind app — the extra tokens/vars are simply unused.
  const tailwindCdn = usesTailwind
    ? `<script src="https://cdn.tailwindcss.com"></script>\n<script>${SHADCN_TW_CONFIG}</script>`
    : '';
  const twCss = usesTailwind ? `${SHADCN_CSS_VARS}\n${css}` : css;
  const styleTag = usesTailwind
    ? `<style id="__nbai-tw" type="text/tailwindcss">\n${twCss}\n</style>`
    : (css ? `<style>\n${css}\n</style>` : '');

  // The loader runs in the browser. It transpiles each module with Babel (JSX
  // automatic runtime, so no React-in-scope needed), wires a CommonJS-style
  // require graph for the project's own files, and loads EVERY bare dependency
  // (react, react-dom, and any npm package in package.json) from esm.sh — so
  // complex React apps (router/state/UI libs) preview without a server.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Preview</title>
${tailwindCdn}
${styleTag}
${vendorScripts}<script type="importmap">${importmap}</script>
${babelTag}
</head>
<body>
<div id="root"></div>
<!-- BOOT OVERLAY (admin 2026-07-07: "preview load ho raha hai ya fail, dikh hi nahi raha"): from the
     very first paint until the app actually mounts, a rotating Ashok Chakra + a live seconds counter
     make the loading phase VISIBLE — the blank-white mystery screen is gone. showError() and the
     25s watchdog below replace it with an explicit reason when the boot fails or hangs. -->
<div id="__nbai_boot" style="position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:#ffffff;z-index:99998">
  <div style="width:64px;height:64px;animation:__nbai_spin 1.6s linear infinite">${ashokChakraSvg(64)}</div>
  <div style="font:13px/1.4 system-ui;color:#555">Loading preview… <span id="__nbai_boot_s" style="font-family:monospace;color:#888"></span></div>
</div>
<style>@keyframes __nbai_spin{to{transform:rotate(360deg)}}</style>
<script type="application/json" id="__bundle__">${payload}</script>
<script>
(function () {
  var bundle = JSON.parse(document.getElementById('__bundle__').textContent);
  var SOURCES = bundle.modules;
  var ENTRY = bundle.entry;
  var IMAP = ${importmap ? 'JSON.parse(document.querySelector(\'script[type="importmap"]\').textContent).imports' : '{}'};
  // Path aliases (e.g. '@' -> '/client/src'): rewrite an alias-prefixed import to a root-absolute
  // LOCAL path so it resolves against the project's own files instead of being fetched from the CDN.
  var ALIASES = ${aliasesJson};
  function applyAlias(spec) {
    for (var a in ALIASES) {
      if (spec === a) return ALIASES[a];
      if (spec.indexOf(a + '/') === 0) return ALIASES[a] + spec.slice(a.length);
    }
    return spec;
  }
  var ESM = '${ESM}';
  // Fallback ESM CDN: if esm.sh flakes/times-out for a package, retry from jsdelivr's ESM (esm.run)
  // before giving up — one CDN hiccup should not blank the whole preview. (esm.run has no ?external
  // flag, so a React library loaded via the fallback may bundle its own React; acceptable only when
  // esm.sh is down anyway, and strictly better than a dead preview.)
  var ESM_ALT = 'https://esm.run/';
  // Third, GENUINELY-INDEPENDENT host (autopsy ce713a7e, 2026-08-02): the two rungs above collapse to
  // only TWO real CDN networks — esm.sh (rung 1 + the plain rung) and jsdelivr (esm.run, rung 2). When
  // BOTH momentarily failed to serve even 'react-dom/client' (esm.sh's most-cached module ever), the
  // whole in-browser preview blanked. unpkg is a third, infra-independent origin, so a two-host blip on
  // the FOUNDATIONAL React modules can no longer kill the preview. Purely additive — only tried after
  // all esm.sh/jsdelivr rungs fail, so it can never regress a currently-working preview.
  var ESM_ALT2 = 'https://unpkg.com/';
  var cache = {};
  var bareCache = {};
  var bareLoadErrors = {}; // spec → the REAL reason its CDN import failed (surfaced in the error)
  var missingLocal = {};   // resolved path → importer, for local files referenced but never created
  var SRC_EXT = ['.jsx', '.js', '.tsx', '.ts', '.mjs'];
  // ROOT-LOCAL SPECIFIERS (CoreUI report 2026-07-07): real Vite apps import from the project ROOT
  // without a leading './' — \`import { logo } from 'src/assets/brand/logo'\`, \`from 'src/components'\`
  // (Vite resolve.alias / jsconfig baseUrl). The loader treated every such spec as an npm package and
  // sent it to the CDN (https://esm.sh/src/assets/brand/logo → dead preview). A spec whose first
  // segment names a top-level dir/file that actually EXISTS in this project is LOCAL, not bare.
  var ROOT_SEGS = {};
  Object.keys(SOURCES).forEach(function (p) { ROOT_SEGS[p.split('/')[0]] = true; });
  function isLocalRootSpec(spec) {
    if (!spec || spec.indexOf(':') >= 0) return false; // node:path / http(s): are never local
    return ROOT_SEGS.hasOwnProperty(spec.split('/')[0]);
  }
  // Local binary assets (images) are not in the text file map — imports of them resolve to a tiny
  // transparent placeholder URL so the app renders (Vite semantics: an image import IS a URL string).
  var IMG_RE = /\\.(png|jpe?g|gif|webp|avif|ico|bmp|svg)$/i;
  var IMG_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

  // Boot-overlay lifecycle: hidden the moment the app REALLY paints (first child in #root) or an
  // error takes over; a 45s watchdog turns a silent hang into an explicit, named failure. 45s (not 25s):
  // a large app (a SaaS dashboard's 600 KB+ bundle) loading React + many deps from the esm.sh CDN and
  // compiling in-browser on a slow mobile network legitimately needs longer, and the server-side preview
  // start already allows 90s — the old 25s ceiling false-failed real, still-loading previews (autopsy
  // 2026-07-31). The reload button is always available, so a genuine hang is never trapped by the wait.
  var bootEl = document.getElementById('__nbai_boot');
  var bootStart = Date.now();
  var bootTick = setInterval(function () {
    var s = document.getElementById('__nbai_boot_s');
    if (s) s.textContent = Math.round((Date.now() - bootStart) / 1000) + 's';
  }, 1000);
  var bootWatchdog = setTimeout(function () {
    if (!bootEl) return; // already mounted or errored
    var failed = Object.keys(bareLoadErrors);
    var reason = 'The preview did not start within 45 seconds.\\n\\n';
    if (failed.length) {
      reason += 'These npm packages FAILED to load from the CDN:\\n'
        + failed.map(function (s) { return '  • ' + s + ' — ' + bareLoadErrors[s]; }).join('\\n')
        + '\\n\\nCheck your network and tap the reload (↻) button to retry.';
    } else if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      reason += 'You appear to be OFFLINE. The preview needs the network once to download npm packages — reconnect and tap the reload (↻) button.';
    } else {
      reason += 'npm packages are still downloading (a slow network), or a module hung while loading. Tap the reload (↻) button to retry.';
    }
    showError(reason);
  }, 45000);
  function hideBoot() {
    if (!bootEl) return;
    bootEl.style.display = 'none';
    bootEl = null;
    clearInterval(bootTick);
    clearTimeout(bootWatchdog);
  }
  try {
    new MutationObserver(function () {
      if (document.getElementById('root').childNodes.length > 0) hideBoot();
    }).observe(document.getElementById('root'), { childList: true });
  } catch (e) { /* observer unavailable — the explicit post-mount hide below still fires */ }

  function showError(msg) {
    hideBoot(); // an explicit reason always replaces the loading chakra — never both, never neither
    var el = document.getElementById('root');
    el.innerHTML = '<pre style="white-space:pre-wrap;color:#b00;padding:16px;font:13px/1.5 monospace">Preview error:\\n' +
      String(msg).replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</pre>';
    // Report the REAL preview error up to the host so it can be captured into the build report
    // (cross-origin srcdoc → postMessage is the only channel). Best-effort; the iframe still shows it.
    try { (window.parent || window.top).postMessage({ __nbaiPreviewError: true, source: 'in-browser', message: String(msg) }, '*'); } catch (e) {}
  }
  function dirname(p) { var i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); }
  function normalize(p) {
    var parts = p.split('/'), out = [];
    for (var i = 0; i < parts.length; i++) {
      var seg = parts[i];
      if (seg === '' || seg === '.') continue;
      if (seg === '..') out.pop(); else out.push(seg);
    }
    return out.join('/');
  }
  function resolve(importer, spec) {
    var base = spec.charAt(0) === '/' ? spec.slice(1) : normalize(dirname(importer) + '/' + spec);
    var t = [base];
    for (var i = 0; i < SRC_EXT.length; i++) t.push(base + SRC_EXT[i]);
    t.push(base + '.css', base + '.json');
    for (var k = 0; k < SRC_EXT.length; k++) t.push(base + '/index' + SRC_EXT[k]);
    for (var j = 0; j < t.length; j++) if (SOURCES.hasOwnProperty(t[j])) return t[j];
    return base;
  }
  function interop(ns) { var m = {}; for (var k in ns) m[k] = ns[k]; m.__esModule = true; if (m.default === undefined) m.default = ns; return m; }
  var styleEl, twStyleEl;
  function injectCss(text) {
    var t = text || '';
    // CSS carrying @tailwind/@apply MUST land in a <style type="text/tailwindcss"> so the Tailwind Play
    // CDN compiles it — a plain <style> would leave the directives as inert (no-op) CSS and the app would
    // render unstyled. Reuse the head's #__nbai-tw block when present (Vite imports CSS from JS at runtime).
    if (/@tailwind\\b|@apply\\b/.test(t)) {
      if (!twStyleEl) {
        twStyleEl = document.getElementById('__nbai-tw');
        if (!twStyleEl) { twStyleEl = document.createElement('style'); twStyleEl.setAttribute('type', 'text/tailwindcss'); document.head.appendChild(twStyleEl); }
      }
      twStyleEl.appendChild(document.createTextNode('\\n' + t));
      return;
    }
    if (!styleEl) { styleEl = document.createElement('style'); document.head.appendChild(styleEl); }
    styleEl.appendChild(document.createTextNode('\\n' + t));
  }

  function requireModule(path) {
    if (cache.hasOwnProperty(path)) return cache[path].exports;
    var code = SOURCES[path];
    if (code == null) throw new Error('Module not found: ' + path);
    if (/\\.css$/.test(path)) { injectCss(code); cache[path] = { exports: {} }; return cache[path].exports; }
    if (/\\.json$/.test(path)) { cache[path] = { exports: JSON.parse(code) }; return cache[path].exports; }
    var isTs = /\\.tsx?$/.test(path), isTsx = /\\.tsx$/.test(path);
    // development:true adds @babel/plugin-transform-react-jsx-source, which attaches each JSX
    // element's real source file/line/column to its React element (readable at runtime via the
    // fiber's _debugSource) — this is what lets the Visual Editor map a clicked, RENDERED element
    // back to its exact position in the REAL source file, so an edit lands there instead of on a
    // disposable compiled copy the next build would overwrite. Same mechanism React DevTools' own
    // "open in editor" feature uses.
    // allowDeclareFields:true — Babel's preset-typescript otherwise THROWS on a declare class field
    // ("The 'declare' modifier is only allowed when 'allowDeclareFields' is enabled"), even though tsc
    // and vite/esbuild accept it silently. Without this the in-browser preview white-screens on any app
    // whose class components use declare-state/declare-props (a legal, common TS pattern), while the
    // build's own tsc gate and the E2B/vite preview pass — a compiler divergence that shipped a broken
    // preview as "verified". Enabling it erases the type-only fields exactly like tsc does.
    var presets = isTs
      ? [['react', { runtime: 'automatic', development: true }], ['typescript', { isTSX: isTsx, allExtensions: true, allowDeclareFields: true }]]
      : [['react', { runtime: 'automatic', development: true }]];
    var transformed;
    // VISUAL EDITOR mapping (reliable, admin 2026-07-29): stamp data-nbai-src="file:line:col" onto every
    // HOST (lowercase) JSX element of the USER's code so the inspector can map ANY clicked element back to
    // its real source via el.closest('[data-nbai-src]') — instead of React's _debugSource, which is null
    // for library/nested elements (shadcn/lucide/etc.) and gone in React 19, the reason "Edit" silently
    // did nothing on most clicks. Line/col match _debugSource's 1-based convention so VisualEditPatcher is
    // unchanged. Runs before the react preset transforms the JSX away.
    var nbaiSrcPlugin = function (babel) {
      var t = babel.types;
      return { visitor: { JSXOpeningElement: function (p) {
        var nm = p.node.name;
        if (!nm || nm.type !== 'JSXIdentifier') return;                 // skip <Component/> and member/namespace
        var tag = nm.name;
        if (tag.charAt(0) !== tag.charAt(0).toLowerCase()) return;       // host (lowercase) elements only
        if (!p.node.loc) return;
        for (var i = 0; i < p.node.attributes.length; i++) {
          var a = p.node.attributes[i];
          if (a.type === 'JSXAttribute' && a.name && a.name.name === 'data-nbai-src') return; // no dup
        }
        var v = path + ':' + p.node.loc.start.line + ':' + (p.node.loc.start.column + 1);
        p.node.attributes.push(t.jsxAttribute(t.jsxIdentifier('data-nbai-src'), t.stringLiteral(v)));
      } } };
    };
    try { transformed = Babel.transform(code, { filename: path, presets: presets, plugins: [nbaiSrcPlugin, 'transform-modules-commonjs'], sourceType: 'module' }).code; }
    catch (e) { throw new Error('Compile ' + path + ': ' + e.message); }
    var module = { exports: {} };
    cache[path] = module;
    function localRequire(spec) {
      spec = applyAlias(spec); // @/… → /client/src/… so it resolves locally, not via the CDN
      // node: builtins cannot run in a browser — stub them (usually only config-file imports) so one
      // stray \`import path from 'node:path'\` never kills the whole preview.
      if (spec.indexOf('node:') === 0) {
        console.warn('[preview] node builtin stubbed in the browser preview:', spec);
        var nodeStub = new Proxy(function () { return ''; }, {
          get: function (_t, k) { if (k === '__esModule') return true; if (k === 'default') return nodeStub; return function () { return ''; }; },
        });
        return nodeStub;
      }
      // Root-local Vite import ('src/…') → make it a local absolute path, NEVER a CDN package.
      if (spec.charAt(0) !== '.' && spec.charAt(0) !== '/' && isLocalRootSpec(spec)) spec = '/' + spec;
      if (spec.charAt(0) !== '.' && spec.charAt(0) !== '/') {
        if (bareCache[spec]) return bareCache[spec];
        // Surface the REAL reason the CDN import failed (CSP block, network/fetch error, 404, CORS)
        // instead of a bare "not in package.json" — this is what pinpoints why React won't load.
        if (bareLoadErrors[spec]) throw new Error('Could not load "' + spec + '" (imported by ' + path + ') from the CDN: ' + bareLoadErrors[spec]);
        throw new Error('Missing dependency "' + spec + '" (imported by ' + path + '). It is not in package.json.');
      }
      var resolved = resolve(path, spec);
      // RESILIENCE: a single local file the generator referenced but never created (a "dangling
      // import", e.g. NoteCard importing ../utils/formatDate) should NOT blank the ENTIRE preview.
      // Instead of throwing, substitute a forgiving stub so the rest of the app renders, and record
      // the gap so a banner can tell the user exactly which file is missing (honest, not hidden).
      if (!SOURCES.hasOwnProperty(resolved)) {
        // A local IMAGE import (binary — never in the text file map) is a URL string in Vite
        // semantics: hand back a transparent placeholder so avatars/logos degrade gracefully
        // instead of the import dying at the CDN (the CoreUI avatars/*.jpg failure).
        if (IMG_RE.test(resolved)) {
          cache[resolved] = { exports: { __esModule: true, default: IMG_PLACEHOLDER } };
          return cache[resolved].exports;
        }
        missingLocal[resolved] = path;
        var stub = new Proxy(function () { return ''; }, {
          get: function (_t, k) { if (k === '__esModule') return true; if (k === 'default') return stub; return function () { return ''; }; },
        });
        cache[resolved] = { exports: stub };
        return stub;
      }
      return requireModule(resolved);
    }
    try { (new Function('require', 'module', 'exports', transformed))(localRequire, module, module.exports); }
    catch (e) { throw new Error('Run ' + path + ': ' + e.message); }
    return module.exports;
  }

  function collectBare() {
    var found = {}, re = /(?:from|import|require\\(|import\\()\\s*['"]([^'"]+)['"]/g;
    Object.keys(SOURCES).forEach(function (p) {
      var src = SOURCES[p] || '', m; re.lastIndex = 0;
      // Skip node: builtins (browser can't load them; vite.config imports land here too) and
      // root-local Vite specs ('src/…' — they resolve from THIS project's files, never the CDN).
      while ((m = re.exec(src))) { var s = applyAlias(m[1]); if (s && s.charAt(0) !== '.' && s.charAt(0) !== '/' && s.indexOf('node:') !== 0 && !isLocalRootSpec(s)) found[s] = true; }
    });
    return Object.keys(found);
  }
  function specUrl(spec) {
    if (IMAP[spec]) return IMAP[spec];
    var root = spec.charAt(0) === '@' ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
    // Sub-path import of a mapped package ('firebase/app', 'react-router-dom/server'): insert
    // the sub-path BEFORE the entry's ?external=… query so the deep import keeps the same
    // single-shared-React externalization. Only for esm.sh bases — a vendored same-origin facade
    // module has no sub-path files, so an unmapped deep import of a vendored root
    // ('react-dom/server') falls through to the plain esm.sh default below.
    if (IMAP[root] && IMAP[root].indexOf(ESM) === 0) {
      var base = IMAP[root], qi = base.indexOf('?');
      if (qi < 0) return base + spec.slice(root.length);
      return base.slice(0, qi) + spec.slice(root.length) + base.slice(qi);
    }
    // Unknown dep (not in package.json): same targeted external so it shares the single React.
    var isReactPkg = root === 'react' || root === 'react-dom';
    return ESM + spec + (isReactPkg ? '' : ${JSON.stringify(EXTERNAL_REACT_Q)});
  }
  // Fallback URL for the SAME spec on the alternate CDN (pins the version from the importmap when known
  // so the fallback matches package.json, e.g. react@18.3.1). Used only when specUrl() failed to load.
  function specUrlAlt(spec) {
    var root = spec.split('/')[0]; if (spec[0] === '@') root = spec.split('/').slice(0, 2).join('/');
    // The version-pin extraction below only parses esm.sh URLs — a vendored same-origin base would
    // yield garbage (slicing a '/vendor/…' path as if it were 'https://esm.sh/pkg@ver'). React 18 is
    // the only vendored runtime, so pin the fallback to @18 rather than letting the alt CDN serve
    // "latest" (which could be a different major and break the app mid-fallback).
    if (IMAP[root] && IMAP[root].indexOf(ESM) !== 0) return ESM_ALT + root + '@18' + spec.slice(root.length);
    if (IMAP[root]) { var b = IMAP[root], qi = b.indexOf('?'); var noQ = qi < 0 ? b : b.slice(0, qi); var verPart = noQ.slice(ESM.length + root.length); return ESM_ALT + root + verPart + spec.slice(root.length); }
    return ESM_ALT + spec;
  }
  // Fourth rung on the INDEPENDENT unpkg origin (pins the importmap version like specUrlAlt). unpkg's
  // ?module query rewrites bare imports to unpkg URLs, so 'react-dom/client' resolves standalone — the
  // exact last-resort a two-host esm.sh+jsdelivr blip on the React core needs.
  function specUrlAlt2(spec) {
    var root = spec.split('/')[0]; if (spec[0] === '@') root = spec.split('/').slice(0, 2).join('/');
    // Same guard as specUrlAlt: a vendored (non-esm.sh) base pins the unpkg rung to React 18.
    if (IMAP[root] && IMAP[root].indexOf(ESM) !== 0) return ESM_ALT2 + root + '@18' + spec.slice(root.length) + '?module';
    if (IMAP[root]) { var b = IMAP[root], qi = b.indexOf('?'); var noQ = qi < 0 ? b : b.slice(0, qi); var verPart = noQ.slice(ESM.length + root.length); return ESM_ALT2 + root + verPart + spec.slice(root.length) + '?module'; }
    return ESM_ALT2 + spec + '?module';
  }
  // Plain esm.sh rung (no externalization query). For a vendored (non-esm.sh) root, pin @18 so a
  // vendor miss on React itself still fetches the SAME major from esm.sh — never "latest".
  function specUrlPlain(spec) {
    var root = spec.split('/')[0]; if (spec[0] === '@') root = spec.split('/').slice(0, 2).join('/');
    if (IMAP[root] && IMAP[root].indexOf(ESM) !== 0) return ESM + root + '@18' + spec.slice(root.length);
    return ESM + spec;
  }

  window.addEventListener('error', function (e) { showError((e && e.message) || 'Script error'); });
  window.addEventListener('unhandledrejection', function (e) { showError((e && e.reason && e.reason.message) || e.reason || 'Promise rejected'); });

  function loadScript(u){return new Promise(function(res){var s=document.createElement('script');s.src=u;s.onload=res;s.onerror=res;document.head.appendChild(s);});}
  var BABEL_FALLBACKS = ${JSON.stringify(BABEL_FALLBACKS)};

  var forced = ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'];
  (async function () {
    try {
      // Self-hosted compiler loads from <head>; if that failed, try CDN fallbacks before giving up.
      for (var bi = 0; bi < BABEL_FALLBACKS.length && typeof Babel === 'undefined'; bi++) { await loadScript(BABEL_FALLBACKS[bi]); }
      if (typeof Babel === 'undefined') { showError('Could not load the preview compiler (network blocked?).'); return; }
      var bare = collectBare();
      forced.forEach(function (s) { if (bare.indexOf(s) < 0) bare.push(s); });
      await Promise.all(bare.map(async function (spec) {
        // An npm package's CSS file ('simplebar-react/dist/simplebar.min.css') is a STYLESHEET, not
        // an ES module — dynamic import() of it fails outright (the CoreUI failure). Load it as a
        // <link> from the CDN (raw file, no ?external query) and satisfy the import with an empty
        // module, exactly what a bundler does with CSS imports.
        if (/\\.css$/i.test(spec)) {
          var link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = specUrl(spec).split('?')[0];
          document.head.appendChild(link);
          bareCache[spec] = { __esModule: true, default: {} };
          return;
        }
        try { bareCache[spec] = interop(await import(specUrl(spec))); }
        catch (e) {
          // esm.sh flaked for this package — retry ONCE from the fallback CDN before giving up, so a
          // single transient CDN hiccup doesn't blank the whole preview.
          try {
            bareCache[spec] = interop(await import(specUrlAlt(spec)));
            console.warn('[preview] loaded', spec, 'from fallback CDN after esm.sh failed');
          } catch (e2) {
            // LAST RUNG (Conduit report 2026-07-07): plain esm.sh WITHOUT the react-externalization
            // query. A legacy package (React 16/17 era) whose externalized \`import {Component} from
            // 'react'\` hits a named-export binding mismatch ("does not provide an export named
            // 'Component'") loads fine when it bundles its OWN react copy. Class-component apps
            // tolerate that; a rare dual-React hook conflict then surfaces as its own honest error.
            try {
              bareCache[spec] = interop(await import(specUrlPlain(spec)));
              console.warn('[preview] loaded', spec, 'WITHOUT react-externalization (legacy interop fallback)');
            } catch (e3) {
              // FINAL rung on the independent unpkg origin (autopsy ce713a7e): if esm.sh AND jsdelivr both
              // failed to fetch even the React core, a third, infra-independent CDN is the last line of
              // defence before the preview blanks.
              try {
                bareCache[spec] = interop(await import(specUrlAlt2(spec)));
                console.warn('[preview] loaded', spec, 'from unpkg (independent CDN) after esm.sh + jsdelivr failed');
              } catch (e4) {
                // Record EVERY rung's real failure so the surfaced error names the true causes,
                // not just the first rung's message.
                bareLoadErrors[spec] = [
                  (e && e.message) ? e.message : String(e),
                  (e2 && e2.message) ? 'alt CDN: ' + e2.message : '',
                  (e3 && e3.message) ? 'plain: ' + e3.message : '',
                  (e4 && e4.message) ? 'unpkg: ' + e4.message : '',
                ].filter(Boolean).join(' | ');
                console.warn('[preview] failed to load', spec, 'on all 4 rungs —', bareLoadErrors[spec]);
              }
            }
          }
        }
      }));
      requireModule(ENTRY);
      // The entry executed without throwing — the app is mounting. The MutationObserver above
      // normally hides the boot overlay on the first real paint; this explicit hide covers apps
      // that render outside #root (portals) so the chakra can never sit over a working app.
      setTimeout(hideBoot, 300);
      // If any local file was missing, the app still rendered (stubbed) — show an honest, non-blocking
      // banner naming the missing files and report them to the host so the build report captures them.
      var miss = Object.keys(missingLocal);
      if (miss.length) {
        var note = 'Missing file' + (miss.length > 1 ? 's' : '') + ' (stubbed so the preview still renders): '
          + miss.map(function (m) { return m + ' (imported by ' + missingLocal[m] + ')'; }).join('; ');
        var bar = document.createElement('div');
        bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#7c2d12;color:#fed7aa;font:12px/1.4 system-ui;padding:6px 10px';
        bar.textContent = '⚠️ ' + note;
        document.body.appendChild(bar);
        try { (window.parent || window.top).postMessage({ __nbaiPreviewError: true, source: 'in-browser', message: note }, '*'); } catch (e) {}
        console.warn('[preview]', note);
      }
    } catch (err) {
      // Show the actual MESSAGE first — some browsers (notably iOS Safari) put only stack FRAMES in
      // err.stack with no message line, which is why a real reason like "Cannot resolve './x' imported
      // by src/App.tsx" used to surface as a cryptic "requireModule@about:srcdoc:81". The message is the
      // useful part; the stack is appended after it for context.
      var emsg = (err && err.message) ? err.message : '';
      var estk = (err && err.stack) ? err.stack : '';
      showError(emsg ? (estk && estk.indexOf(emsg) < 0 ? emsg + '\\n\\n' + estk : (estk || emsg)) : (estk || String(err)));
    }
  })();
})();
</script>
${VISUAL_EDITOR_SCRIPT}
</body>
</html>`;
}

// VISUAL EDITOR (v1) — a separate script/scope from the loader above so it never interferes with the
// module graph. Toggled on/off by the PARENT page via postMessage (never active unless explicitly
// turned on), and reports back through postMessage too — this document is same-origin `srcDoc`, so a
// direct call would also work, but postMessage matches the established pattern this preview already
// uses for error reporting (__nbaiPreviewError), keeping ONE communication channel.
//
// Mechanism: React (with development:true set on the JSX transform above) attaches `_debugSource`
// (fileName/lineNumber/columnNumber) to the fiber of every JSX element — the same data React DevTools'
// own "open in editor" feature reads. Walking a clicked DOM node's `__reactFiber$*` property to its
// fiber (a real, stable React internal API, not a hack specific to this app) gives that exact source
// location, so an edit can be sent back to EXACTLY the JSX element the user clicked — no guessing.
const VISUAL_EDITOR_SCRIPT = `<script>
(function () {
  var editMode = false;
  var hovered = null;
  var editing = null;
  var selected = null;      // the element picked in edit mode (Phase 2 — toolbar/resize/reposition target)
  var selectedSrc = null;   // { fileName, lineNumber, columnNumber } for the selected element

  function fiberOf(el) {
    var key = Object.keys(el).find(function (k) { return k.indexOf('__reactFiber$') === 0; });
    return key ? el[key] : null;
  }
  function debugSourceFor(el) {
    var fiber = fiberOf(el);
    while (fiber) {
      if (fiber._debugSource) return fiber._debugSource;
      fiber = fiber.return;
    }
    return null;
  }
  // Reliable source: the nearest ancestor carrying data-nbai-src="file:line:col" (stamped at transform
  // time). Works for library/nested elements and every React version. Falls back to _debugSource.
  function srcFor(el) {
    var host = el && el.closest ? el.closest('[data-nbai-src]') : null;
    if (host) {
      var raw = host.getAttribute('data-nbai-src') || '';
      var c2 = raw.lastIndexOf(':'), c1 = raw.lastIndexOf(':', c2 - 1);
      if (c1 > 0 && c2 > c1) {
        var f = raw.slice(0, c1), ln = parseInt(raw.slice(c1 + 1, c2), 10), co = parseInt(raw.slice(c2 + 1), 10);
        if (f && ln) return { host: host, fileName: f, lineNumber: ln, columnNumber: co || 1 };
      }
    }
    var d = debugSourceFor(el);
    if (d && d.fileName) return { host: el, fileName: d.fileName, lineNumber: d.lineNumber, columnNumber: d.columnNumber };
    return null;
  }
  // Honest feedback: a brief red dashed outline when a clicked element maps to no editable source (so the
  // user never faces a silent no-op — the old behaviour that made "Edit" feel broken).
  function flashNotEditable(el) {
    if (!el || !el.style) return;
    var prev = el.style.outline;
    el.style.outline = '2px dashed #f43f5e';
    setTimeout(function () { el.style.outline = prev; }, 600);
  }
  function clearHover() {
    if (hovered) { hovered.style.outline = ''; hovered.style.cursor = ''; hovered = null; }
  }
  // The current styles of an element the toolbar cares about (so the controls open showing real values).
  function readStyles(el) {
    var cs = window.getComputedStyle(el);
    return {
      fontSize: cs.fontSize, color: cs.color, fontWeight: cs.fontWeight,
      textAlign: cs.textAlign, padding: cs.padding,
      width: el.style && el.style.width || '', height: el.style && el.style.height || ''
    };
  }
  function clearSelection() {
    if (selected) { selected.style.outline = ''; selected.style.outlineOffset = ''; }
    selected = null; selectedSrc = null;
    if (handle) handle.style.display = 'none';
  }
  function reportSelection() {
    if (!selected || !selectedSrc) return;
    try {
      (window.parent || window.top).postMessage({
        __nbaiSelect: true, file: selectedSrc.fileName, line: selectedSrc.lineNumber, column: selectedSrc.columnNumber,
        tag: (selected.tagName || '').toLowerCase(), styles: readStyles(selected),
      }, '*');
    } catch (e) {}
  }
  // Select an element (draw the selection box + resize grip + tell the parent, which shows the toolbar).
  // Does NOT edit text — that's a double-click (or the toolbar's "Edit text") — so a single click is safe.
  function selectEl(host, info) {
    clearHover();
    if (selected && selected !== host) { selected.style.outline = ''; selected.style.outlineOffset = ''; }
    selected = host;
    selectedSrc = { fileName: info.fileName, lineNumber: info.lineNumber, columnNumber: info.columnNumber };
    host.style.outline = '2px solid #10b981';
    host.style.outlineOffset = '1px';
    ensureHandle();
    positionHandle();
    reportSelection();
  }

  // ---- Slice D (resize) + E (reposition): a bottom-right grip resizes width/height; dragging the selected
  // element's body moves it via transform: translate(...) — a LAYOUT-SAFE move (transform never reflows
  // siblings, so responsive layouts don't break). Both persist through the same applyVisualStyleEdit. ----
  var handle = null;
  var drag = null; // { kind:'resize'|'move', sx, sy, w, h, tx, ty, moved } while a drag is active
  function isUi(el) { return !!(el && el.getAttribute && el.getAttribute('data-nbai-ui')); }
  function ensureHandle() {
    if (handle) return handle;
    handle = document.createElement('div');
    handle.setAttribute('data-nbai-ui', '1');
    handle.style.cssText = 'position:fixed;width:14px;height:14px;background:#10b981;border:2px solid #fff;border-radius:3px;z-index:2147483647;cursor:nwse-resize;box-shadow:0 1px 4px rgba(0,0,0,.4);display:none';
    handle.addEventListener('mousedown', onHandleDown, true);
    document.body.appendChild(handle);
    return handle;
  }
  function positionHandle() {
    if (!handle) return;
    if (!selected) { handle.style.display = 'none'; return; }
    var r = selected.getBoundingClientRect();
    handle.style.left = (r.right - 7) + 'px';
    handle.style.top = (r.bottom - 7) + 'px';
    handle.style.display = 'block';
  }
  function parseTranslate(el) {
    var m = (el.style.transform || '').match(/translate\\(\\s*(-?[0-9.]+)px\\s*,\\s*(-?[0-9.]+)px\\s*\\)/);
    return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : { x: 0, y: 0 };
  }
  function commitStyle(updates) {
    if (!selectedSrc) return;
    try {
      (window.parent || window.top).postMessage({
        __nbaiStyleCommit: true, file: selectedSrc.fileName, line: selectedSrc.lineNumber, column: selectedSrc.columnNumber, styleUpdates: updates,
      }, '*');
    } catch (e) {}
  }
  function onHandleDown(e) {
    if (!editMode || !selected) return;
    e.preventDefault(); e.stopPropagation();
    var r = selected.getBoundingClientRect();
    drag = { kind: 'resize', sx: e.clientX, sy: e.clientY, w: r.width, h: r.height };
  }
  function onBodyDown(e) {
    if (!editMode || editing || isUi(e.target)) return;
    var info = srcFor(e.target);
    // A MOVE drag only starts on the ALREADY-selected element (first click just selects, via onClick).
    if (info && selected === info.host) {
      var tr = parseTranslate(selected);
      drag = { kind: 'move', sx: e.clientX, sy: e.clientY, tx: tr.x, ty: tr.y, moved: false };
    }
  }
  function onMove(e) {
    if (!drag) return;
    var dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (drag.kind === 'resize') {
      selected.style.width = Math.max(8, Math.round(drag.w + dx)) + 'px';
      selected.style.height = Math.max(8, Math.round(drag.h + dy)) + 'px';
      drag.moved = true;
      positionHandle();
    } else {
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      if (drag.moved) { selected.style.transform = 'translate(' + Math.round(drag.tx + dx) + 'px, ' + Math.round(drag.ty + dy) + 'px)'; positionHandle(); }
    }
  }
  function onUp() {
    if (!drag) return;
    var d = drag; drag = null;
    if (!d.moved) return;
    if (d.kind === 'resize') { commitStyle({ width: selected.style.width, height: selected.style.height }); reportSelection(); }
    else { commitStyle({ transform: selected.style.transform }); }
  }
  function onMouseOver(e) {
    if (!editMode || editing || isUi(e.target)) return;
    var info = srcFor(e.target);
    var host = info ? info.host : e.target;
    if (hovered && hovered !== host) clearHover();
    hovered = host;
    hovered.style.outline = '2px solid #6366f1';
    hovered.style.cursor = 'text';
  }
  function stopEditing(commit) {
    if (!editing) return;
    var el = editing, src = editing.__nbaiSrc;
    editing.contentEditable = 'false';
    editing.style.outline = '';
    editing = null;
    if (commit && src) {
      try {
        (window.parent || window.top).postMessage({
          __nbaiVisualEditCommit: true,
          file: src.fileName, line: src.lineNumber, column: src.columnNumber,
          newText: el.textContent,
        }, '*');
      } catch (e) {}
    }
  }
  // A single click SELECTS (safe to explore); the parent shows the toolbar. Text editing is a deliberate
  // double-click (or the toolbar's "Edit text"), so clicking to inspect/style never traps you in a caret.
  function onClick(e) {
    if (!editMode || editing || isUi(e.target)) return;
    var info = srcFor(e.target);
    if (!info) { flashNotEditable(e.target); return; }
    e.preventDefault();
    e.stopPropagation();
    selectEl(info.host, info);
  }
  function beginTextEdit(host, src) {
    editing = host;
    editing.__nbaiSrc = src;
    if (selected === host) { selected.style.outline = ''; selected.style.outlineOffset = ''; }
    editing.contentEditable = 'true';
    editing.style.outline = '2px solid #10b981';
    editing.focus();
    var range = document.createRange();
    range.selectNodeContents(editing);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
  function onDblClick(e) {
    if (!editMode || editing) return;
    var info = srcFor(e.target);
    if (!info) { flashNotEditable(e.target); return; }
    e.preventDefault();
    e.stopPropagation();
    beginTextEdit(info.host, { fileName: info.fileName, lineNumber: info.lineNumber, columnNumber: info.columnNumber });
  }
  function onBlur(e) { if (editing === e.target) stopEditing(true); }
  function onKeyDown(e) {
    if (!editing) return;
    if (e.key === 'Enter') { e.preventDefault(); editing.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); stopEditing(false); }
  }
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.__nbaiSetEditMode !== undefined) {
      editMode = !!d.__nbaiSetEditMode;
      if (!editMode) { clearHover(); stopEditing(false); clearSelection(); }
      document.body.style.cursor = editMode ? 'crosshair' : '';
      return;
    }
    // Live-apply a style change to the SELECTED element (instant preview; the parent also persists it to
    // source via the visual-edit endpoint). camelCase CSS keys; '' removes the inline value.
    if (d.__nbaiApplyStyle && typeof d.__nbaiApplyStyle === 'object' && selected) {
      for (var k in d.__nbaiApplyStyle) {
        if (Object.prototype.hasOwnProperty.call(d.__nbaiApplyStyle, k)) {
          try { selected.style[k] = d.__nbaiApplyStyle[k]; } catch (err) {}
        }
      }
      try { (window.parent || window.top).postMessage({ __nbaiSelect: true, file: selectedSrc.fileName, line: selectedSrc.lineNumber, column: selectedSrc.columnNumber, tag: (selected.tagName || '').toLowerCase(), styles: readStyles(selected) }, '*'); } catch (e2) {}
      return;
    }
    // Toolbar asked to edit the selected element's text.
    if (d.__nbaiEditText && selected && selectedSrc) { beginTextEdit(selected, selectedSrc); return; }
    if (d.__nbaiDeselect) { clearSelection(); return; }
  });
  document.addEventListener('mouseover', onMouseOver, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('dblclick', onDblClick, true);
  document.addEventListener('mousedown', onBodyDown, true);
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('mouseup', onUp, true);
  window.addEventListener('scroll', positionHandle, true);
  window.addEventListener('resize', positionHandle);
  document.addEventListener('blur', onBlur, true);
  document.addEventListener('keydown', onKeyDown, true);
})();
</script>`;

/**
 * Build the importmap from package.json deps (+ always-needed React entries). When `vendorBase` is
 * set, the five React specifiers point at the SAME-ORIGIN vendored facades instead of esm.sh — every
 * other package still loads from esm.sh with `?external=react,react-dom`, so its internal `import
 * "react"` resolves through this importmap to the one vendored copy (single shared React preserved).
 */
function buildImportmap(vfs: VirtualFileSystem, vendorBase?: string | null): Record<string, string> {
  const deps: Record<string, string> = {};
  try {
    const pkg = JSON.parse(vfs.readText('package.json') || '{}');
    Object.assign(deps, pkg.dependencies || {}, pkg.devDependencies || {});
  } catch { /* ignore */ }
  const ver = (name: string): string => {
    const v = deps[name];
    return v ? '@' + v.replace(/^[\^~>=<\s]*/, '').split(/\s/)[0] : '';
  };
  const reactVer = ver('react') || '@18.3.1';
  const rdVer = ver('react-dom') || '@18.3.1';
  const imap: Record<string, string> = {
    react: ESM + 'react' + reactVer,
    'react-dom': ESM + 'react-dom' + rdVer,
    'react-dom/client': ESM + 'react-dom' + rdVer + '/client',
    'react/jsx-runtime': ESM + 'react' + reactVer + '/jsx-runtime',
    'react/jsx-dev-runtime': ESM + 'react' + reactVer + '/jsx-dev-runtime',
  };
  // CRITICAL for any React library (react-router-dom, @mui, framer-motion, …): externalize
  // react + react-dom (`?external=react,react-dom`) so those bare `import "react"` specifiers
  // resolve through THIS importmap to the single React above, instead of esm.sh bundling a
  // second private copy. Two React copies is the #1 cause of "Invalid hook call" → a blank or
  // crashing preview for router/state/UI-library apps.
  //
  // Deliberately NOT the old `*` (external-ALL) flag: `*` also externalized every OTHER
  // dependency of the package — e.g. firebase's internal `@firebase/app` — leaving bare
  // specifiers this importmap doesn't contain, so the browser failed with 'Failed to resolve
  // module specifier "@firebase/app"' and the whole imported-app preview died (admin bug,
  // 2026-07-04). With the targeted external list, esm.sh bundles those internals as absolute
  // URLs while the single shared React is still preserved. React's own entries stay plain
  // (they ARE the shared copy).
  for (const name of Object.keys(deps)) {
    if (!imap[name]) imap[name] = ESM + name + ver(name) + EXTERNAL_REACT_Q;
  }
  if (vendorBase) {
    for (const spec of Object.keys(VENDOR_REACT_SHIMS)) imap[spec] = vendorBase + VENDOR_REACT_SHIMS[spec];
  }
  return imap;
}
