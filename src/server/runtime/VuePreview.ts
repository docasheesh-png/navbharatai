/**
 * Phase 6 — In-browser Vue 3 preview (no server, no WebContainer).
 *
 * Vue Single-File Components (.vue) can't be served by the plain static builder
 * (they need compilation) and the heavy server/WebContainer runtimes aren't
 * always provisioned. This builds ONE self-contained HTML document that previews
 * a Vue 3 + Vite app entirely in the browser: Vue 3 from a CDN + `vue3-sfc-loader`
 * (the standard in-browser SFC compiler) + a tiny virtual filesystem so the app's
 * own .vue/.js/.css modules resolve.
 *
 * Scope (kept honest): .vue SFCs, relative imports, CSS imports/<style>, the `vue`
 * specifier, and other bare deps loaded best-effort from esm.sh. Anything that
 * fails surfaces a clear in-preview error rather than a silent blank screen.
 *
 * Pure + dependency-free (string in → string out) → unit-testable.
 */
import { VirtualFileSystem } from '../project/ProjectModel';
import { PROCESS_SHIM_SOURCE, NAVDATA_RUNTIME_SOURCE, STORAGE_SHIM_SOURCE, APP_TOUCH_CSS, APP_FEEL_LISTENER_SOURCE } from './previewImportMeta';

const VUE_CDN = 'https://unpkg.com/vue@3.4.38/dist/vue.runtime.global.prod.js';
const SFC_LOADER_CDN = 'https://cdn.jsdelivr.net/npm/vue3-sfc-loader@0.9.5/dist/vue3-sfc-loader.js';
const ESM = 'https://esm.sh/';

const SOURCE_EXT = ['.vue', '.js', '.ts', '.mjs', '.jsx', '.tsx'];
const CSS_EXT = ['.css'];

/** True if this VFS looks like a Vue app we can compile in-browser. */
export function isVueProject(vfs: VirtualFileSystem): boolean {
  const pkgText = vfs.readText('package.json');
  if (pkgText) {
    try {
      const pkg = JSON.parse(pkgText);
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      if (deps.vue) return true;
    } catch (e) { console.warn('[preview] package.json parse failed:', e); }
  }
  return vfs.paths().some((p) => p.endsWith('.vue'));
}

/** Find the module entry: the <script type=module src> in index.html, else common defaults. */
export function findVueEntry(vfs: VirtualFileSystem): string | null {
  const html = vfs.readText('index.html');
  if (html) {
    const m = html.match(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/i);
    if (m) {
      const ref = m[1].replace(/^\//, '');
      if (vfs.has(ref)) return ref;
    }
  }
  for (const cand of ['src/main.js', 'src/main.ts', 'src/index.js', 'src/index.ts']) {
    if (vfs.has(cand)) return cand;
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
    const text = vfs.readText(href.replace(/^\//, ''));
    if (text) css.push(text);
  }
  return css.join('\n');
}

/** Build an esm.sh importmap-like dep→url map from package.json (vue excluded — it's the global). */
function buildDepUrls(vfs: VirtualFileSystem): Record<string, string> {
  const deps: Record<string, string> = {};
  try {
    const pkg = JSON.parse(vfs.readText('package.json') || '{}');
    Object.assign(deps, pkg.dependencies || {}, pkg.devDependencies || {});
  } catch { /* ignore */ }
  const ver = (name: string): string => {
    const v = deps[name];
    return v ? '@' + v.replace(/^[\^~>=<\s]*/, '').split(/\s/)[0] : '';
  };
  const map: Record<string, string> = {};
  for (const name of Object.keys(deps)) {
    if (name === 'vue') continue; // provided as the CDN global
    map[name] = ESM + name + ver(name) + '?deps=vue@3';
  }
  return map;
}

/**
 * Build a self-contained, in-browser-compiled Vue preview document.
 * Returns an HTML string; if no entry module is found, falls back to a clear notice.
 */
export function buildVuePreview(vfs: VirtualFileSystem, _origin?: string): string {
  const entry = findVueEntry(vfs);

  const modules: Record<string, string> = {};
  for (const path of vfs.paths()) {
    if ([...SOURCE_EXT, ...CSS_EXT].some((e) => path.endsWith(e))) {
      const text = vfs.readText(path);
      if (text != null) modules[path] = text;
    }
  }

  if (!entry) {
    return `<!doctype html><html><body style="font-family:system-ui;padding:24px;color:#444">`
      + `<h3>No Vue entry module found</h3>`
      + `<p>Expected a module entry (e.g. <code>src/main.js</code>) referenced by index.html.</p></body></html>`;
  }

  const mountId = (vfs.readText('index.html')?.match(/id=["']([^"']+)["']/)?.[1]) || 'app';
  const payload = JSON.stringify({ entry, modules, mountId, depUrls: buildDepUrls(vfs) }).replace(/<\//g, '<\\/');
  const css = baseStyles(vfs);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Preview</title>
<style>${APP_TOUCH_CSS}</style>
<script>${STORAGE_SHIM_SOURCE}
${APP_FEEL_LISTENER_SOURCE}</script>
${css ? `<style>\n${css}\n</style>` : ''}
<script src="${VUE_CDN}"></script>
<script src="${SFC_LOADER_CDN}"></script>
</head>
<body>
<div id="${mountId}"></div>
<script type="application/json" id="__bundle__">${payload}</script>
<script>
(function () {
  // PROCESS SHIM — the sibling of the one in ReactPreview (rule 3: the same root cause almost always
  // lives in more than one place). "process" is a Node global that does not exist in a browser, so a
  // component reading process.env.NODE_ENV throws "process is not defined" and kills the preview. The
  // SFC loader runs the user's own code in this page, so this path needs it exactly as much. Values
  // come from the SAME exported constant, so the two previews can never disagree.
  ${PROCESS_SHIM_SOURCE}
  ${NAVDATA_RUNTIME_SOURCE}
  var bundle = JSON.parse(document.getElementById('__bundle__').textContent);
  var SOURCES = bundle.modules;
  var ENTRY = bundle.entry;
  var DEP_URLS = bundle.depUrls || {};
  var EXT = ['', '.vue', '.js', '.ts', '.mjs', '.jsx', '.tsx', '.json', '.css', '/index.js', '/index.ts', '/index.vue'];

  // Same painted-vs-boot split as ReactPreview (the store's game-over crash, 2026-08-15): a boot
  // failure must be shown; an uncaught error AFTER the app is on screen must never wipe it.
  var nbaiPainted = false;
  function showError(msg) {
    if (nbaiPainted) return;
    var el = document.getElementById('${mountId}') || document.body;
    el.innerHTML = '<pre style="white-space:pre-wrap;color:#b00;padding:16px;font:13px/1.5 monospace">Preview error:\\n' +
      String(msg).replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</pre>';
  }
  function strip(p) { return p.replace(/^\\.?\\//, ''); }
  function resolveLocal(url) {
    var base = strip(url);
    for (var i = 0; i < EXT.length; i++) { if (SOURCES.hasOwnProperty(base + EXT[i])) return base + EXT[i]; }
    return null;
  }
  function extname(p) { var i = p.lastIndexOf('.'); return i < 0 ? '.js' : p.slice(i); }

  window.addEventListener('error', function (e) { showError((e && e.message) || 'Script error'); });
  window.addEventListener('unhandledrejection', function (e) { showError((e && e.reason && e.reason.message) || e.reason || 'Promise rejected'); });

  if (typeof Vue === 'undefined' || !window['vue3-sfc-loader']) {
    showError('Could not load the Vue preview compiler (network blocked?).');
    return;
  }
  var loadModule = window['vue3-sfc-loader'].loadModule;

  var moduleCache = { vue: Vue };
  var styleEl;
  function addStyle(text) {
    if (!styleEl) { styleEl = document.createElement('style'); document.head.appendChild(styleEl); }
    styleEl.appendChild(document.createTextNode('\\n' + (text || '')));
  }

  var options = {
    moduleCache: moduleCache,
    addStyle: addStyle,
    getFile: async function (url) {
      var local = resolveLocal(url);
      if (local != null) return { getContentData: function () { return SOURCES[local]; }, type: extname(local) };
      throw new Error('File not found in preview bundle: ' + url);
    },
    handleModule: async function (type, getContentData, path, opts) {
      if (type === '.css') { addStyle(await getContentData(false)); return null; }
      if (type === '.json') { return JSON.parse(await getContentData(false)); }
      return undefined; // .vue / .js → default handlers
    },
    log: function () {},
  };

  (async function () {
    try {
      // Preload bare deps (vue-router/pinia/etc) from esm.sh into the module cache,
      // sharing the same Vue instance. vue stays the CDN global.
      var names = Object.keys(DEP_URLS);
      await Promise.all(names.map(async function (name) {
        try { moduleCache[name] = await import(DEP_URLS[name]); }
        catch (e) { console.warn('[preview] dep load failed', name, e && e.message); }
      }));
      // Running the entry module executes createApp(App).mount('#${mountId}').
      await loadModule('/' + ENTRY, options);
      // The entry ran without throwing — the app is on screen (or mounting). From here, runtime
      // errors are reported, never allowed to replace a running app's DOM.
      setTimeout(function () { nbaiPainted = true; }, 300);
    } catch (err) {
      showError((err && (err.stack || err.message)) || err);
    }
  })();
})();
</script>
</body>
</html>`;
}
