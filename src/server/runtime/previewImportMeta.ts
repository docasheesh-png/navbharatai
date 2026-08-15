// PHASE 1b of the in-browser preview plan — make `import.meta` survive the module loader.
//
// THE BUG, REPRODUCED (2026-08-13). The in-browser preview compiles each module with Babel and then
// runs it with `new Function('require','module','exports', code)`. Babel's commonjs transform does NOT
// touch `import.meta` — it is left verbatim in the output — and `import.meta` inside a Function body is
// a SYNTAX ERROR:
//
//     new Function('const u = import.meta.env.VITE_API_URL;')
//     → SyntaxError: Cannot use 'import.meta' outside a module
//
// A SyntaxError in the wrapper is not a bad value in one component; it kills the module outright, and
// with it the whole preview. And `import.meta.env` is not an exotic corner of Vite — it is how every
// Vite project reads configuration, so this single line is a very large share of why an IMPORTED app
// shows nothing. Generated apps rarely hit it because the scaffold does not use it; the people the
// admin asked us to look after ("apni already bani hui app github/zip par layenge") hit it constantly.
//
// THE FIX: an AST plugin replaces the `import.meta` meta-property with an identifier the module wrapper
// supplies. AST, not a text replacement — a regex cannot tell `import.meta` in code from the same
// characters inside a string literal, and corrupting one library string would be a blank preview with
// no obvious cause.
//
// WHAT THE VALUES ARE, AND WHY THEY ARE NOT A FAKE. Vite's own semantics are reproduced exactly:
// MODE/DEV/PROD/SSR/BASE_URL are the real values for a dev-mode app, and a `VITE_*` variable that was
// never defined is `undefined` — which is precisely what Vite itself yields for an undefined variable.
// We deliberately do NOT invent values for them: live `.env` files are excluded at the import boundary
// on purpose (SECRET_FILE_RE — we never import somebody's secrets), so there is nothing honest to put
// there. The app therefore behaves as it would under Vite with an empty env, instead of dying.
//
// `viteEnvVarsUsed` exists so the UI can SAY that, rather than leaving the user to wonder why one
// feature is misconfigured. A missing value that is named is a known limitation; a missing value that
// is silent is the "built but not really working" state the second absolute rule forbids.

/** The identifier the compiled module reads instead of `import.meta`. */
export const IMPORT_META_IDENT = '__nbaiImportMeta';

/**
 * `import.meta.env`, as JS source — Vite's real dev-mode values.
 *
 * ONE definition, interpolated into both the server precompile output and the browser loader's runtime
 * helper. The two paths must agree on what an app sees, and the cheapest way to guarantee that is for
 * there to be nothing to keep in agreement.
 */
export const IMPORT_META_ENV_SOURCE = '{MODE:"development",DEV:true,PROD:false,SSR:false,BASE_URL:"/"}';

/**
 * The object bound to that identifier, as JS source.
 *
 * A getter-free plain object on purpose: the compiled code only ever reads properties off it, and a
 * literal is what both the server precompile path and the browser fallback can emit identically.
 *
 * `hot` is Vite's HMR handle, and it is deliberately undefined: an imported app guarded with
 * `if (import.meta.hot)` must take the FALSE branch here. There is no HMR in a static render, and
 * pretending otherwise would have the app register callbacks that never fire.
 */
export function importMetaObjectSource(modulePath: string): string {
  const url = JSON.stringify(`file:///${String(modulePath).replace(/^\/+/, '')}`);
  return `{url:${url},env:${IMPORT_META_ENV_SOURCE},hot:undefined}`;
}

/**
 * `process.env`, as JS source — the SAME class of bug as `import.meta`, one layer along.
 *
 * `process` is a Node global. In a browser it does not exist, so a module reading `process.env.NODE_ENV`
 * throws `ReferenceError: process is not defined` and dies — taking the preview with it, exactly like
 * the `import.meta` SyntaxError did.
 *
 * It is easy to assume this is a CRA-only concern and therefore rare. It is not: `process.env.NODE_ENV`
 * is one of the most common lines in ordinary React source, used to gate dev-only logging and checks.
 * Libraries pulled from the dependency mirror are already built with it substituted; the USER's own
 * code is not, and the user's own code is the entire imported project.
 *
 * NODE_ENV is 'development' because that is what this preview genuinely is. `REACT_APP_*` /
 * `NEXT_PUBLIC_*` are absent for the same reason their Vite counterparts are: live .env files are
 * excluded at the import boundary on purpose, so `undefined` is the honest answer and the one the real
 * toolchain gives for an undefined variable.
 */
export const PROCESS_ENV_SOURCE = '{NODE_ENV:"development"}';

/**
 * The whole shim, as the JS source both preview pages embed verbatim.
 *
 * ONE constant rather than a copy per renderer. The React and Vue pages both execute the user's own
 * code in the browser, so both need it — and two hand-written copies is precisely the drift this
 * codebase has been bitten by before (four copies of `safeRelPath`, five hardcoded model ids). Having
 * nothing to keep in agreement is stronger than a test asserting they agree.
 *
 * `argv` / `exit` / `cwd` / `nextTick` are present because code that reaches for `process` often
 * reaches for those too: an undefined call is a crash, while a no-op is merely nothing happening. They
 * are honestly inert — there is no process to exit and no stdout to write to.
 *
 * The `typeof` guard keeps this strictly ADDITIVE. If the page or a polyfilled dependency already
 * provided a real `process`, overwriting it with this minimal stand-in would turn a fix into a
 * regression for the app that had it right.
 */
/**
 * NAVDATA — the shared-data helper every generated page carries (store ecosystem Kadam 4).
 *
 * THE PROBLEM IT SOLVES: a chat, a leaderboard, a booking sheet need data SHARED between viewers —
 * and a browser-run app has nowhere shared to put it. The platform now provides a tiny per-app row
 * store (append + list, hard-quota'd server-side); this helper is how an app reaches it.
 *
 * TWO BACKENDS, one honest split:
 *   • On the NAV APP STORE the player injects `window.__NBAI_STORE_APP_ID`, and rows go to the real
 *     API — genuinely shared between every viewer of that app.
 *   • In the creator's own PREVIEW no app id exists yet (the app is not published), so rows go to
 *     localStorage — the app WORKS end-to-end, with the one difference that the data is per-device.
 *     That difference is the truth, not a downgrade: unshared data before publishing is what
 *     "not published yet" means.
 *
 * The API calls are relative ('/api/…') on purpose: a srcdoc iframe inherits its parent's base URL,
 * so the same page works in the same-origin preview AND the opaque-origin store player (where the
 * fetch is cross-origin and the data routes answer with ACAO:*). localStorage access THROWS in an
 * opaque origin — wrapped, with an in-memory fallback, so no environment can crash an app over it.
 */
export const NAVDATA_RUNTIME_SOURCE = [
  `if (typeof window.NavData === 'undefined') {`,
  `    (function () {`,
  `      var mem = {};`,
  `      function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch (e) { return mem[k] || []; } }`,
  `      function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { mem[k] = v; } }`,
  `      window.NavData = {`,
  `        add: function (collection, data) {`,
  `          var id = window.__NBAI_STORE_APP_ID;`,
  `          if (id) {`,
  `            return fetch('/api/nav-store/web/app/' + encodeURIComponent(id) + '/data/' + encodeURIComponent(collection), {`,
  `              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: data })`,
  `            }).then(function (r) { return r.json(); });`,
  `          }`,
  `          var k = 'navdata_' + collection; var rows = lsGet(k);`,
  `          var row = { id: 'r' + Date.now() + Math.random().toString(36).slice(2, 6), data: data, at: Date.now() };`,
  `          rows.unshift(row); lsSet(k, rows.slice(0, 500));`,
  `          return Promise.resolve({ ok: true, row: row });`,
  `        },`,
  `        list: function (collection, limit) {`,
  `          var id = window.__NBAI_STORE_APP_ID;`,
  `          if (id) {`,
  `            return fetch('/api/nav-store/web/app/' + encodeURIComponent(id) + '/data/' + encodeURIComponent(collection) + '?limit=' + (limit || 50))`,
  `              .then(function (r) { return r.json(); }).then(function (d) { return d.rows || []; });`,
  `          }`,
  `          return Promise.resolve(lsGet('navdata_' + collection).slice(0, limit || 50));`,
  `        }`,
  `      };`,
  `    })();`,
  `  }`,
].join('\n');

export const PROCESS_SHIM_SOURCE = [
  `if (typeof window.process === 'undefined') {`,
  `    window.process = { env: ${PROCESS_ENV_SOURCE}, platform: 'browser', version: '', browser: true,`,
  `      argv: [], exit: function () {}, cwd: function () { return '/'; }, nextTick: function (f) { Promise.resolve().then(f); } };`,
  `  }`,
].join('\n');

/**
 * STORAGE SHIM — kills the class behind the store's first real crash report (admin, 2026-08-15):
 * a game played fine until game over, then hung with "Script error."
 *
 * The store player (and any future opaque-origin embed) runs the app in a sandboxed iframe WITHOUT
 * allow-same-origin, and in an opaque origin the localStorage/sessionStorage GETTERS themselves
 * throw a SecurityError. Generated apps use localStorage constantly — a game saving its high score
 * at game over is the canonical case — so the app's first storage touch became an uncaught throw at
 * the exact moment it "finished". NavData already wrapped its OWN storage calls for this reason;
 * this shim protects the APP's own code the same way, one layer down: when native storage throws,
 * window.localStorage/sessionStorage are redefined as an in-memory Storage lookalike. Honest
 * behavior, not a fake: the data genuinely persists for the session and genuinely does not survive
 * a reload — exactly what an opaque origin can offer. Where native storage works (the same-origin
 * creator preview), the shim touches nothing.
 */
export const STORAGE_SHIM_SOURCE = [
  `(function () {`,
  `    function memStorage() {`,
  `      var m = {};`,
  `      var s = {`,
  `        getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, String(k)) ? m[String(k)] : null; },`,
  `        setItem: function (k, v) { m[String(k)] = String(v); },`,
  `        removeItem: function (k) { delete m[String(k)]; },`,
  `        clear: function () { m = {}; },`,
  `        key: function (i) { var ks = Object.keys(m); return i >= 0 && i < ks.length ? ks[i] : null; }`,
  `      };`,
  `      Object.defineProperty(s, 'length', { get: function () { return Object.keys(m).length; } });`,
  `      return s;`,
  `    }`,
  `    function ensure(name) {`,
  `      try { window[name].getItem(''); }`,
  `      catch (e) { try { Object.defineProperty(window, name, { value: memStorage(), configurable: true }); } catch (e2) {} }`,
  `    }`,
  `    ensure('localStorage');`,
  `    ensure('sessionStorage');`,
  `  })();`,
].join('\n');

/**
 * APP-FEEL TOUCH CSS — the store's second real-use report (admin, 2026-08-15): long-pressing the
 * screen mid-game selected text and popped the copy menu; double-tap zoomed. A published app must
 * feel like an app, not a document. Selection is disabled by default with the two honest carve-outs
 * where selection IS the feature (inputs, textareas, contenteditable), plus `touch-action:
 * manipulation` to drop double-tap-zoom (pan/pinch stay available to apps that want them). Injected
 * FIRST in <head> on purpose: it is a default, so any app's own stylesheet (loaded later, equal
 * specificity) can deliberately re-enable selection — e.g. a notes app opting its content back in
 * with \`user-select: text\`.
 */
export const APP_TOUCH_CSS = [
  `html, body { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }`,
  `input, textarea, select, [contenteditable]:not([contenteditable="false"]) { -webkit-user-select: text; user-select: text; }`,
].join('\n');

/**
 * The Babel plugin, for the SERVER precompile path.
 *
 * ⚠️ The browser fallback path in ReactPreview.ts carries a hand-written twin of this, for the same
 * reason `srcStampPlugin` does: that path builds a script as a template string and cannot import a
 * module. The two must stay semantically identical, and a test in previewImportMeta.test.ts locks them
 * together — the same discipline ReactPreview.precompile.test.ts already applies to the stamping
 * plugin. The shared VALUES live here so the only thing that can differ is the plumbing.
 */
export function importMetaPlugin() {
  return {
    visitor: {
      MetaProperty(p: { replaceWithSourceString: (s: string) => void }) {
        p.replaceWithSourceString(IMPORT_META_IDENT);
      },
    },
  };
}

/**
 * `VITE_*` / `REACT_APP_*` variables the app's own code reads. Pure.
 *
 * Used for one honest sentence in the UI, never to block: an app whose only gap is a missing config
 * value still renders, and rendering-with-a-named-gap beats a white screen. Deduplicated and sorted so
 * the message is stable between renders.
 */
export function viteEnvVarsUsed(files: Record<string, string> | null | undefined): string[] {
  const found = new Set<string>();
  const re = /\b(?:import\.meta\.env|process\.env)\.((?:VITE|REACT_APP|NEXT_PUBLIC)_[A-Z0-9_]+)/g;
  for (const [path, src] of Object.entries(files ?? {})) {
    if (!/\.[cm]?[jt]sx?$/i.test(path) || typeof src !== 'string') continue;
    for (const m of src.matchAll(re)) found.add(m[1]);
  }
  return [...found].sort();
}

/**
 * True when the code uses `import.meta.glob` — Vite's BUILD-TIME directory expansion.
 *
 * Called out separately because it cannot be answered with a value: the plugin above would leave it as
 * a property read on an object that has no `glob`, and an app that builds its routes from a glob would
 * then render with no routes at all — working-looking and wrong. Apps using it are refused by
 * `proveBrowserRunnable` and sent to the live server, where Vite performs the real expansion.
 */
export function usesImportMetaGlob(files: Record<string, string> | null | undefined): boolean {
  for (const [path, src] of Object.entries(files ?? {})) {
    if (!/\.[cm]?[jt]sx?$/i.test(path) || typeof src !== 'string') continue;
    if (/import\.meta\.glob\s*(?:<[^>]*>)?\s*\(/.test(src)) return true;
  }
  return false;
}
