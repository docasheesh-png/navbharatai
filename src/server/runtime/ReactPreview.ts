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
import { VirtualFileSystem } from '../project/ProjectModel';
import { normalizePath } from '../project/ProjectModel';

const BABEL_CDN = 'https://unpkg.com/@babel/standalone@7.26.4/babel.min.js';
const ESM = 'https://esm.sh/';

const SOURCE_EXT = ['.jsx', '.js', '.tsx', '.ts', '.mjs'];
const CSS_EXT = ['.css'];

/** True if this VFS looks like a frontend React app we can bundle in-browser. */
export function isReactProject(vfs: VirtualFileSystem): boolean {
  const pkgText = vfs.readText('package.json');
  if (pkgText) {
    try {
      const pkg = JSON.parse(pkgText);
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      if (deps.react) return true;
    } catch { /* ignore */ }
  }
  // fallback: any JSX/TSX source present
  return vfs.paths().some((p) => p.endsWith('.jsx') || p.endsWith('.tsx'));
}

/** Find the module entry: the <script type=module src> in index.html, else common defaults. */
function findEntry(vfs: VirtualFileSystem): string | null {
  const html = vfs.readText('index.html');
  if (html) {
    const m = html.match(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/i);
    if (m) {
      const resolved = resolveModule(vfs, normalizePath(m[1].replace(/^\//, '')));
      if (resolved) return resolved;
    }
  }
  for (const cand of ['src/main.jsx', 'src/main.tsx', 'src/index.jsx', 'src/index.tsx', 'src/main.js', 'src/index.js']) {
    if (vfs.has(cand)) return cand;
  }
  return null;
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
export function buildReactPreview(vfs: VirtualFileSystem): string {
  const entry = findEntry(vfs);

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
  const importmap = JSON.stringify({ imports: buildImportmap(vfs) }).replace(/<\//g, '<\\/');
  const css = baseStyles(vfs);

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
${css ? `<style>\n${css}\n</style>` : ''}
<script type="importmap">${importmap}</script>
<script src="${BABEL_CDN}"></script>
</head>
<body>
<div id="root"></div>
<script type="application/json" id="__bundle__">${payload}</script>
<script>
(function () {
  var bundle = JSON.parse(document.getElementById('__bundle__').textContent);
  var SOURCES = bundle.modules;
  var ENTRY = bundle.entry;
  var IMAP = ${importmap ? 'JSON.parse(document.querySelector(\'script[type="importmap"]\').textContent).imports' : '{}'};
  var ESM = '${ESM}';
  var cache = {};
  var bareCache = {};
  var SRC_EXT = ['.jsx', '.js', '.tsx', '.ts', '.mjs'];

  function showError(msg) {
    var el = document.getElementById('root');
    el.innerHTML = '<pre style="white-space:pre-wrap;color:#b00;padding:16px;font:13px/1.5 monospace">Preview error:\\n' +
      String(msg).replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</pre>';
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
  var styleEl;
  function injectCss(text) {
    if (!styleEl) { styleEl = document.createElement('style'); document.head.appendChild(styleEl); }
    styleEl.appendChild(document.createTextNode('\\n' + (text || '')));
  }

  function requireModule(path) {
    if (cache.hasOwnProperty(path)) return cache[path].exports;
    var code = SOURCES[path];
    if (code == null) throw new Error('Module not found: ' + path);
    if (/\\.css$/.test(path)) { injectCss(code); cache[path] = { exports: {} }; return cache[path].exports; }
    if (/\\.json$/.test(path)) { cache[path] = { exports: JSON.parse(code) }; return cache[path].exports; }
    var isTs = /\\.tsx?$/.test(path), isTsx = /\\.tsx$/.test(path);
    var presets = isTs
      ? [['react', { runtime: 'automatic' }], ['typescript', { isTSX: isTsx, allExtensions: true }]]
      : [['react', { runtime: 'automatic' }]];
    var transformed;
    try { transformed = Babel.transform(code, { filename: path, presets: presets, plugins: ['transform-modules-commonjs'], sourceType: 'module' }).code; }
    catch (e) { throw new Error('Compile ' + path + ': ' + e.message); }
    var module = { exports: {} };
    cache[path] = module;
    function localRequire(spec) {
      if (spec.charAt(0) !== '.' && spec.charAt(0) !== '/') {
        if (bareCache[spec]) return bareCache[spec];
        throw new Error('Missing dependency: ' + spec);
      }
      return requireModule(resolve(path, spec));
    }
    try { (new Function('require', 'module', 'exports', transformed))(localRequire, module, module.exports); }
    catch (e) { throw new Error('Run ' + path + ': ' + e.message); }
    return module.exports;
  }

  function collectBare() {
    var found = {}, re = /(?:from|import|require\\(|import\\()\\s*['"]([^'"]+)['"]/g;
    Object.keys(SOURCES).forEach(function (p) {
      var src = SOURCES[p] || '', m; re.lastIndex = 0;
      while ((m = re.exec(src))) { var s = m[1]; if (s && s.charAt(0) !== '.' && s.charAt(0) !== '/') found[s] = true; }
    });
    return Object.keys(found);
  }
  function specUrl(spec) {
    if (IMAP[spec]) return IMAP[spec];
    var root = spec.charAt(0) === '@' ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
    if (IMAP[root]) return IMAP[root] + spec.slice(root.length);
    return ESM + spec;
  }

  window.addEventListener('error', function (e) { showError((e && e.message) || 'Script error'); });
  window.addEventListener('unhandledrejection', function (e) { showError((e && e.reason && e.reason.message) || e.reason || 'Promise rejected'); });

  if (typeof Babel === 'undefined') { showError('Could not load the preview compiler (network blocked?).'); return; }

  var forced = ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'];
  (async function () {
    try {
      var bare = collectBare();
      forced.forEach(function (s) { if (bare.indexOf(s) < 0) bare.push(s); });
      await Promise.all(bare.map(async function (spec) {
        try { bareCache[spec] = interop(await import(specUrl(spec))); }
        catch (e) { console.warn('[preview] failed to load', spec, e && e.message); }
      }));
      requireModule(ENTRY);
    } catch (err) {
      showError((err && err.stack) || err);
    }
  })();
})();
</script>
</body>
</html>`;
}

/** Build an esm.sh importmap from package.json deps (+ always-needed React entries). */
function buildImportmap(vfs: VirtualFileSystem): Record<string, string> {
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
  for (const name of Object.keys(deps)) {
    if (!imap[name]) imap[name] = ESM + name + ver(name);
  }
  return imap;
}
