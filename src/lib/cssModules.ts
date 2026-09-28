// CSS MODULES FOR THE IN-BROWSER PREVIEW — the class names stop coming out blank.
//
// WHY (admin 2026-09-28, with a screenshot of a calculator rendered in a serif "0" and browser-default
// buttons: "kya aisa calculator banaya ja raha hai! … user ko aise farzi app na mile!"). Both in-browser
// renderers — the server one (`src/server/runtime/ReactPreview.ts`, behind the user's preview pane, the
// admin's Built-apps preview and every App Mart web player) and the client one (`src/lib/previewUtils.ts`)
// — answered EVERY `.css` import with an empty exports object. For a plain stylesheet that is right: the
// text is injected and nothing is exported. For `import styles from "./X.module.css"` it means
// `styles.card` is `undefined`, `className={undefined}` renders as no class at all, and a fully styled
// app is shown as raw HTML. `previewFidelity.ts` KNEW this and said so in a caveat — which is how a
// known defect gets a label instead of a fix.
//
// WHAT THIS IS: the one thing a CSS Modules pipeline does — rename each class to a unique name and hand
// the component a map from the written name to the renamed one. Vite/PostCSS hash the file's content;
// this hashes the PATH, which is just as unique per file and lets the same map be built anywhere from the
// same input (server precompile, browser Babel path, client bundler) with no coordination.
//
// PURE, dependency-free, importable by the server AND the browser bundle — one definition, because a
// second copy of a renaming rule is a second place for it to drift (the safeRelPath lesson).
//
// WHAT IT DOES NOT DO, said plainly: `composes:` is left in place (the browser ignores an unknown
// property; nothing breaks, the composed rule is simply not merged), `@keyframes` names stay global
// (they are global in the browser too, so `animation: fade 1s` keeps working), and a `.module.scss` is
// not compiled here at all — the preprocessor caveat still covers that.

export interface CssModuleTransform {
  /** The stylesheet with every local class renamed to its scoped name. */
  css: string;
  /** written class name → scoped class name, plus a camelCase alias for every dashed name. */
  exports: Record<string, string>;
}

/** `X.module.css` — the only file shape whose import carries a class map. */
export function isCssModulePath(path: string): boolean {
  return /\.module\.css$/i.test(path);
}

/**
 * A short, stable suffix for one file. FNV-1a over the path, base36, six characters: unique enough for
 * the handful of stylesheets one app has, short enough not to bloat every class attribute.
 */
export function cssModuleScope(path: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < path.length; i++) {
    h ^= path.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(6, '0').slice(-6);
}

/** `nav-item` → `navItem` (the alias Vite's `localsConvention: 'camelCase'` would add). */
function camelCase(name: string): string {
  return name.replace(/-+([a-zA-Z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** Strip block comments so a class name inside a comment is never renamed or exported. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** A CSS identifier as it appears after a `.` in a selector — with backslash escapes allowed. */
const CLASS_RE = /\.(-?(?:[_a-zA-Z]|\\.)(?:[\w-]|\\.)*)/g;

/** Is the `.` at `index` a class selector and not the decimal point of `.5em` or the dot in `1.5`? */
function classDotAt(prelude: string, index: number): boolean {
  const next = prelude.charAt(index + 1);
  return /[_a-zA-Z\\-]/.test(next) && !/[0-9]/.test(prelude.charAt(index - 1));
}

/**
 * Rename the classes in ONE selector list. `:global(…)` keeps its content verbatim (the CSS Modules
 * escape hatch for styling third-party markup); `:local(…)` is the default and is simply unwrapped.
 * Strings inside attribute selectors (`[data-x=".not-a-class"]`) are copied untouched.
 */
function scopeSelector(prelude: string, scope: string, exportsMap: Record<string, string>): string {
  let out = '';
  let i = 0;
  while (i < prelude.length) {
    const ch = prelude.charAt(i);
    if (ch === '"' || ch === "'") {
      const end = prelude.indexOf(ch, i + 1);
      const stop = end < 0 ? prelude.length : end + 1;
      out += prelude.slice(i, stop);
      i = stop;
      continue;
    }
    if (prelude.startsWith(':global(', i) || prelude.startsWith(':local(', i)) {
      const isGlobal = prelude.charAt(1 + i) === 'g';
      const open = prelude.indexOf('(', i);
      let depth = 1;
      let j = open + 1;
      while (j < prelude.length && depth > 0) {
        const c = prelude.charAt(j);
        if (c === '(') depth++;
        else if (c === ')') depth--;
        j++;
      }
      const inner = prelude.slice(open + 1, depth === 0 ? j - 1 : j);
      out += isGlobal ? inner : scopeSelector(inner, scope, exportsMap);
      i = j;
      continue;
    }
    if (ch === '.' && classDotAt(prelude, i)) {
      CLASS_RE.lastIndex = i;
      const m = CLASS_RE.exec(prelude);
      if (m && m.index === i) {
        const written = m[1].replace(/\\(.)/g, '$1');
        const scoped = `${written}_${scope}`;
        exportsMap[written] = scoped;
        out += `.${scoped.replace(/([^\w-])/g, '\\$1')}`;
        i += m[0].length;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}

/** An at-rule whose block holds RULES (so its selectors must be scoped), not declarations. */
const RULE_CONTAINER_RE = /^@(media|supports|container|layer|scope|document|starting-style)\b/i;
/** An at-rule whose block holds keyframe steps (`from`, `to`, `50%`) — nothing to scope inside. */
const KEYFRAMES_RE = /^@(-\w+-)?keyframes\b/i;

type Block = 'rules' | 'keyframes' | 'decls';

/**
 * Transform one CSS Module: scope its classes and return the map its importer receives.
 *
 * A small walker rather than a regex over the whole file, because the SAME text means different things
 * in different places: `.5em` in a declaration is a number, `.card` in a selector is a class, and
 * `.card` inside `content: ".card"` is neither. The walker knows which block it is in (rules /
 * keyframes / declarations) and renames only inside selectors — including a nested `&.active { }`
 * selector inside a rule, which native CSS nesting allows.
 */
export function transformCssModule(path: string, css: string): CssModuleTransform {
  const scope = cssModuleScope(path);
  const exportsMap: Record<string, string> = {};
  const src = stripComments(String(css ?? ''));
  const stack: Block[] = ['rules'];
  let out = '';
  let seg = '';
  let quote = '';

  const flushPrelude = (prelude: string): string => {
    const ctx = stack[stack.length - 1];
    const trimmed = prelude.trim();
    if (ctx === 'keyframes') { stack.push('decls'); return prelude; }
    if (ctx === 'rules') {
      if (trimmed.startsWith('@')) {
        if (RULE_CONTAINER_RE.test(trimmed)) { stack.push('rules'); return prelude; }
        if (KEYFRAMES_RE.test(trimmed)) { stack.push('keyframes'); return prelude; }
        stack.push('decls');
        return prelude;
      }
      stack.push('decls');
      return scopeSelector(prelude, scope, exportsMap);
    }
    // Inside a rule (native CSS nesting): a nested `@media` holds declarations, a nested selector
    // (`&:hover`, `&.active`, `.x &`) is scoped like any other.
    stack.push('decls');
    return trimmed.startsWith('@') ? prelude : scopeSelector(prelude, scope, exportsMap);
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src.charAt(i);
    if (quote) {
      seg += ch;
      if (ch === quote && src.charAt(i - 1) !== '\\') quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; seg += ch; continue; }
    if (ch === '{') { out += flushPrelude(seg) + '{'; seg = ''; continue; }
    if (ch === '}') { out += seg + '}'; seg = ''; if (stack.length > 1) stack.pop(); continue; }
    // A `;` ends a declaration inside a rule and an at-rule STATEMENT (`@import …;`) at the top, so
    // the text after it is a fresh prelude either way — `@import "x"; .card {` must still scope `.card`.
    if (ch === ';') { out += seg + ';'; seg = ''; continue; }
    seg += ch;
  }
  out += seg;

  for (const written of Object.keys(exportsMap)) {
    const alias = camelCase(written);
    if (alias !== written && !(alias in exportsMap)) exportsMap[alias] = exportsMap[written];
  }
  return { css: out, exports: exportsMap };
}

export interface CssModuleBundle {
  /** The file map with every `.module.css` replaced by its scoped stylesheet; other files untouched. */
  files: Record<string, string>;
  /** path → exports map, for every CSS Module in the input. Empty when the app has none. */
  exports: Record<string, Record<string, string>>;
}

/**
 * Apply the transform to every CSS Module in a file map — the one call both renderers make before
 * shipping files to the page. Files that are not CSS Modules are returned by reference, unchanged.
 */
export function bundleCssModules(files: Record<string, string>): CssModuleBundle {
  const out: Record<string, string> = {};
  const exportsByPath: Record<string, Record<string, string>> = {};
  for (const [path, text] of Object.entries(files)) {
    if (isCssModulePath(path) && typeof text === 'string') {
      const t = transformCssModule(path, text);
      out[path] = t.css;
      exportsByPath[path] = t.exports;
    } else {
      out[path] = text;
    }
  }
  return { files: out, exports: exportsByPath };
}

/**
 * The JavaScript the in-page loaders run for a `.module.css` import — written ONCE here and
 * interpolated into both loaders, so the module shape (`default` = the map, plus every key as a named
 * export, `__esModule` so Babel's interop hands the component the map itself) cannot drift between
 * them. `mapExpr` is the loader's expression for the file's exports map.
 */
export function cssModuleExportsJs(mapExpr: string): string {
  return `(function(m){var ex={__esModule:true,default:m||{}};for(var k in (m||{})){if(!Object.prototype.hasOwnProperty.call(ex,k))ex[k]=m[k];}return ex;})(${mapExpr})`;
}
