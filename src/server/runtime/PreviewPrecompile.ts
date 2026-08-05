/**
 * Server-side precompilation for the in-browser preview (admin 2026-08-05: "hamare in-browser preview
 * ko Bolt ke preview jaisa banao").
 *
 * What actually makes Bolt's preview FEEL fast is that the user's device never runs a compiler: by the
 * time the page is looking at the code, the code is already JavaScript. Ours shipped a ~2.85 MB Babel
 * to the browser and transpiled every module on the user's phone, on the main thread, on every full
 * reload — on a budget Android that is seconds of jank before the first paint.
 *
 * Nothing requires the compile to happen there. This runs the SAME compiler (@babel/standalone — a
 * regular prod dependency, importable in Node) with the SAME presets, the SAME visual-editor stamping
 * plugin and the SAME module transform on the SERVER, once per render — and the render cache already
 * deduplicates renders, so it is paid per file-change, not per open. The page then ships compiled
 * modules and NO compiler at all: boot = fetch deps (already parallel-preloaded) + execute.
 *
 * WHY BABEL AND NOT ESBUILD (which is also a dependency, and faster): the browser loader's behaviour
 * is defined by Babel's exact output — jsxDEV with _debugSource (the Visual Editor's click-to-source
 * mapping), the data-nbai-src stamping plugin (an AST plugin esbuild cannot run), allowDeclareFields,
 * CommonJS interop shape. Same compiler + same options = identical semantics by construction; a
 * different compiler would be a second implementation to keep in lockstep forever.
 *
 * ALL-OR-NOTHING: if ANY module fails to compile, the whole page falls back to today's
 * Babel-in-the-browser path — where the same compiler reports the same error in-preview, honestly.
 * No mixed pages: the loader is either "everything is compiled" or exactly what it was yesterday.
 * `AGENTV3_PREVIEW_PRECOMPILE=off` forces the fallback without a deploy.
 */

// Lazily loaded: @babel/standalone is a ~3 MB parse, paid once per process, and only when the
// in-browser preview is actually rendered.
let _babel: { transform: (code: string, opts: object) => { code?: string | null } } | null | undefined;
function loadBabel(): NonNullable<typeof _babel> | null {
  if (_babel !== undefined) return _babel;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _babel = require('@babel/standalone');
  } catch {
    _babel = null; // not installed/readable — precompile silently disabled, browser path unaffected
  }
  return _babel ?? null;
}

/**
 * The Visual Editor's source-stamping plugin — data-nbai-src="file:line:col" on every HOST (lowercase)
 * JSX element, so the inspector can map any clicked element back to its real source.
 *
 * ⚠️ This MUST stay semantically identical to the inline `nbaiSrcPlugin` in ReactPreview.ts's browser
 * loader (the fallback path): both paths must stamp the same attribute with the same 1-based line/col
 * convention, or the Visual Editor works on one path and silently misses on the other. A test in
 * ReactPreview.precompile.test.ts locks the two together.
 */
function srcStampPlugin(filePath: string) {
  return (babel: { types: Record<string, (...args: never[]) => unknown> }) => {
    const t = babel.types as {
      jsxAttribute: (name: unknown, value: unknown) => unknown;
      jsxIdentifier: (name: string) => unknown;
      stringLiteral: (value: string) => unknown;
    };
    return {
      visitor: {
        JSXOpeningElement(p: {
          node: {
            name?: { type: string; name: string };
            loc?: { start: { line: number; column: number } } | null;
            attributes: Array<{ type: string; name?: { name?: string } }>;
          };
        }) {
          const nm = p.node.name;
          if (!nm || nm.type !== 'JSXIdentifier') return; // skip <Component/> and member/namespace
          const tag = nm.name;
          if (tag.charAt(0) !== tag.charAt(0).toLowerCase()) return; // host (lowercase) elements only
          if (!p.node.loc) return;
          for (const a of p.node.attributes) {
            if (a.type === 'JSXAttribute' && a.name && a.name.name === 'data-nbai-src') return; // no dup
          }
          const v = `${filePath}:${p.node.loc.start.line}:${p.node.loc.start.column + 1}`;
          p.node.attributes.push(t.jsxAttribute(t.jsxIdentifier('data-nbai-src'), t.stringLiteral(v)) as never);
        },
      },
    };
  };
}

/**
 * Compile every source module to the exact JS the browser loader would have produced.
 *
 * Returns the compiled module map, or `null` when the page must use the browser-Babel fallback
 * (kill switch, Babel unavailable, or any module failing to compile). CSS passes through untouched —
 * it is a runtime concern (injectCss), not a compile-time one.
 */
export function precompileModules(modules: Record<string, string>): Record<string, string> | null {
  if (process.env.AGENTV3_PREVIEW_PRECOMPILE === 'off') return null;
  const Babel = loadBabel();
  if (!Babel) return null;

  const out: Record<string, string> = {};
  for (const [path, code] of Object.entries(modules)) {
    if (/\.css$/i.test(path)) { out[path] = code; continue; }
    const isTs = /\.tsx?$/.test(path);
    const isTsx = /\.tsx$/.test(path);
    // Mirrors the browser loader exactly — development:true for _debugSource (Visual Editor),
    // allowDeclareFields so a legal `declare` class field never white-screens the preview.
    const presets = isTs
      ? [['react', { runtime: 'automatic', development: true }], ['typescript', { isTSX: isTsx, allExtensions: true, allowDeclareFields: true }]]
      : [['react', { runtime: 'automatic', development: true }]];
    try {
      const res = Babel.transform(code, {
        filename: path,
        presets,
        plugins: [srcStampPlugin(path), 'transform-modules-commonjs'],
        sourceType: 'module',
      });
      if (typeof res?.code !== 'string') return null;
      out[path] = res.code;
    } catch {
      // A module that fails HERE fails identically in the browser — falling back lets the existing
      // in-preview error path name the file and the reason, unchanged from today.
      return null;
    }
  }
  return out;
}
