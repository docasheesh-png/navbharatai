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

const REACT_CDN = 'https://unpkg.com/react@18/umd/react.development.js';
const REACTDOM_CDN = 'https://unpkg.com/react-dom@18/umd/react-dom.development.js';
const BABEL_CDN = 'https://unpkg.com/@babel/standalone@7/babel.min.js';

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

  const payload = JSON.stringify({ entry, modules });
  const css = baseStyles(vfs);

  // The loader runs in the browser. It transpiles each module with Babel and wires
  // a CommonJS-style require graph; react specifiers map to the CDN globals.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Preview</title>
${css ? `<style>\n${css}\n</style>` : ''}
<script src="${REACT_CDN}" crossorigin></script>
<script src="${REACTDOM_CDN}" crossorigin></script>
<script src="${BABEL_CDN}"></script>
</head>
<body>
<div id="root"></div>
<script type="application/json" id="__bundle__">${payload.replace(/</g, '\\u003c')}</script>
<script>
(function () {
  var bundle = JSON.parse(document.getElementById('__bundle__').textContent);
  var SOURCES = bundle.modules;
  var ENTRY = bundle.entry;
  var cache = {};
  var SRC_EXT = ['.jsx', '.js', '.tsx', '.ts', '.mjs'];
  var CSS_EXT = ['.css'];

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
    if (SOURCES.hasOwnProperty(base)) return base;
    for (var i = 0; i < SRC_EXT.length; i++) if (SOURCES.hasOwnProperty(base + SRC_EXT[i])) return base + SRC_EXT[i];
    for (var j = 0; j < CSS_EXT.length; j++) if (SOURCES.hasOwnProperty(base + CSS_EXT[j])) return base + CSS_EXT[j];
    for (var k = 0; k < SRC_EXT.length; k++) if (SOURCES.hasOwnProperty(base + '/index' + SRC_EXT[k])) return base + '/index' + SRC_EXT[k];
    return null;
  }

  function bareModule(spec) {
    if (spec === 'react') return window.React;
    if (spec === 'react-dom') return window.ReactDOM;
    if (spec === 'react-dom/client') return window.ReactDOM;
    return undefined;
  }

  function requireModule(path) {
    if (cache.hasOwnProperty(path)) return cache[path].exports;
    if (path.slice(-4) === '.css') { injectCss(SOURCES[path]); cache[path] = { exports: {} }; return cache[path].exports; }
    var code = SOURCES[path];
    var transformed = Babel.transform(code, {
      presets: [['react'], ['typescript', { allExtensions: true, isTSX: true }]],
      plugins: ['transform-modules-commonjs'],
      filename: path
    }).code;
    var module = { exports: {} };
    cache[path] = module;
    function localRequire(spec) {
      var bare = bareModule(spec);
      if (bare !== undefined) return bare;
      var resolved = resolve(path, spec);
      if (!resolved) throw new Error('Cannot resolve "' + spec + '" from ' + path);
      return requireModule(resolved);
    }
    var fn = new Function('require', 'module', 'exports', 'React', 'ReactDOM', transformed);
    fn(localRequire, module, module.exports, window.React, window.ReactDOM);
    return module.exports;
  }

  var styleEl;
  function injectCss(text) {
    if (!styleEl) { styleEl = document.createElement('style'); document.head.appendChild(styleEl); }
    styleEl.appendChild(document.createTextNode('\\n' + (text || '')));
  }

  window.addEventListener('error', function (e) { showError(e.message); });
  try {
    requireModule(ENTRY);
  } catch (err) {
    showError((err && err.stack) || err);
  }
})();
</script>
</body>
</html>`;
}
