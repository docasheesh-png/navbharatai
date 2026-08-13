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
