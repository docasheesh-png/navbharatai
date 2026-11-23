// `import.meta.glob` IN THE IN-BROWSER RUNTIME — expanded on the server, before compile (2026-11-22).
//
// 🔴 THE REPORT. The admin tried to publish a game to App Mart and was refused: "this project builds part of
// itself while it compiles, which only the live server can do". The game was made by NavBharatAI itself. Four
// of the platform's own game-kit generators (GameAssetRuntimeGenerator, GamePlayerBodyGenerator,
// GameRaceCustomGenerator, gameAssets/soundSeed) write `import.meta.glob('./assetCustomizations.ts',
// { eager: true })` and similar — Vite's way to say "load this file if it exists". The in-browser runtime
// could not answer `import.meta.glob`, so previewCapability refused every such app. The platform was writing
// code that its own App Mart would not run.
//
// THE FIX, AT THE ROOT. `import.meta.glob` is a BUILD-TIME expansion, and the server holds every file of the
// app when it renders the page — exactly what Vite holds when it expands it. So the expansion is done here,
// with Vite's semantics, before either compile path (server precompile or the Babel-in-browser fallback)
// sees the code:
//   import.meta.glob('./a/*.ts')                    → { "./a/x.ts": () => Promise.resolve(require("./a/x.ts")) }
//   import.meta.glob('./a/*.ts', { eager: true })   → { "./a/x.ts": require("./a/x.ts") }
//   … { eager: true, import: 'CAR' }                → { "./car.ts": require("./car.ts").CAR }
//   a pattern that matches no file                  → {}            (Vite's answer, and the kit relies on it)
// `require` is the module wrapper's own resolver, the same one every compiled `import` becomes.
//
// ONLY WHAT IS PROVABLE. Vite itself requires literal arguments; a call whose pattern or options are not
// literals (a variable, a template with `${}`, an option this pass does not implement such as `query`) is
// left untouched and reported, and previewCapability keeps refusing that app exactly as before. A wrong
// expansion would render an app "working-looking and wrong", which is worse than an honest refusal.
//
// TEXT OUTSIDE THE CALL IS NOT TOUCHED. The parser finds each call's exact character range; only that range
// is replaced, padded with the same number of newlines it removed, so every later line keeps its number —
// the Visual Editor maps clicks to `file:line` and must not drift.

// eslint-disable-next-line @typescript-eslint/no-require-imports
type BabelParser = { parse: (code: string, opts: object) => any };
let _parser: BabelParser | null | undefined;
function loadParser(): BabelParser | null {
  if (_parser !== undefined) return _parser;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _parser = (require('@babel/standalone') as { packages?: { parser?: BabelParser } }).packages?.parser ?? null;
  } catch {
    _parser = null;
  }
  return _parser ?? null;
}

const SOURCE_RE = /\.[cm]?[jt]sx?$/i;
const QUICK_RE = /import\.meta\.glob\s*(?:<[^>]*>)?\s*\(/;

export interface GlobExpansion {
  /** The modules, with every provable `import.meta.glob` call replaced. Untouched modules are the same strings. */
  modules: Record<string, string>;
  /** `file: reason` for each call that could not be expanded (the app must keep its live-server refusal). */
  unsupported: string[];
}

function dirOf(p: string): string {
  const i = p.lastIndexOf('/');
  return i <= 0 ? '' : p.slice(0, i);
}

/** Normalise `a/./b/../c` → `a/c`. Leading `/` is dropped (module paths here are root-relative). PURE. */
function normalise(p: string): string {
  const out: string[] = [];
  for (const part of p.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

/** A Vite glob pattern (`*`, `**`, `?`, `{a,b}`) as a RegExp over a normalised root-relative path. PURE. */
export function globToRegExp(pattern: string): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        // `**/` matches zero or more whole directories; a bare `**` matches anything.
        if (pattern[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const end = pattern.indexOf('}', i);
      if (end === -1) { re += '\\{'; continue; }
      re += `(?:${pattern.slice(i + 1, end).split(',').map((s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&')).join('|')})`;
      i = end;
    } else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

interface ParsedCall { start: number; end: number; patterns: string[]; eager: boolean; importName: string | null }

/** Read a literal string / array-of-strings / object literal, or null when it is not a literal. */
function literalString(n: any): string | null {
  if (!n) return null;
  if (n.type === 'StringLiteral') return n.value;
  if (n.type === 'TemplateLiteral' && n.expressions.length === 0) return n.quasis.map((q: any) => q.value.cooked).join('');
  return null;
}

function parseCall(node: any): ParsedCall | string {
  const [first, second, ...rest] = node.arguments ?? [];
  if (rest.length) return 'more than two arguments';
  let patterns: string[] | null = null;
  const one = literalString(first);
  if (one !== null) patterns = [one];
  else if (first?.type === 'ArrayExpression') {
    const all = first.elements.map(literalString);
    if (all.every((s: string | null) => s !== null) && all.length > 0) patterns = all as string[];
  }
  if (!patterns) return 'the pattern is not a literal string';
  let eager = false;
  let importName: string | null = null;
  if (second) {
    if (second.type !== 'ObjectExpression') return 'the options are not an object literal';
    for (const prop of second.properties) {
      if (prop.type !== 'ObjectProperty' || prop.computed) return 'an option is not a plain property';
      const key = prop.key.type === 'Identifier' ? prop.key.name : literalString(prop.key);
      if (key === 'eager') {
        if (prop.value.type !== 'BooleanLiteral') return '`eager` is not true/false';
        eager = prop.value.value;
      } else if (key === 'import') {
        const v = literalString(prop.value);
        if (v === null) return '`import` is not a literal string';
        importName = v;
      } else return `the \`${key}\` option is not supported here`;
    }
  }
  return { start: node.start, end: node.end, patterns, eager, importName };
}

/** True when the node is `import.meta.glob` (optionally with a TS type argument — the parser keeps it apart). */
function isGlobCallee(callee: any): boolean {
  return callee?.type === 'MemberExpression' && !callee.computed
    && callee.object?.type === 'MetaProperty' && callee.object.meta?.name === 'import' && callee.object.property?.name === 'meta'
    && callee.property?.type === 'Identifier' && callee.property.name === 'glob';
}

function collectCalls(ast: any): any[] {
  const found: any[] = [];
  const walk = (n: any): void => {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'CallExpression' && isGlobCallee(n.callee)) { found.push(n); return; }
    for (const key of Object.keys(n)) {
      if (key === 'loc' || key === 'start' || key === 'end' || key === 'extra') continue;
      const v = n[key];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object' && typeof v.type === 'string') walk(v);
    }
  };
  walk(ast.program);
  return found;
}

/** The replacement source for one call: an object literal keyed exactly as Vite keys it. PURE. */
export function expansionSource(importer: string, call: Pick<ParsedCall, 'patterns' | 'eager' | 'importName'>, paths: readonly string[]): string {
  const base = dirOf(importer);
  const positive: Array<{ re: RegExp; relative: boolean }> = [];
  const negative: RegExp[] = [];
  for (const raw of call.patterns) {
    const neg = raw.startsWith('!');
    const pat = neg ? raw.slice(1) : raw;
    const relative = !pat.startsWith('/');
    const absolute = normalise(relative ? `${base}/${pat}` : pat);
    const re = globToRegExp(absolute);
    if (neg) negative.push(re);
    else positive.push({ re, relative });
  }
  const keys = new Map<string, string>(); // key (as Vite writes it) → root-relative path
  for (const p of paths) {
    const np = normalise(p);
    if (np === normalise(importer) || negative.some((re) => re.test(np))) continue;
    const hit = positive.find(({ re }) => re.test(np));
    if (!hit) continue;
    let key: string;
    if (hit.relative) {
      const from = base ? base.split('/') : [];
      const to = np.split('/');
      let i = 0;
      while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
      const up = from.length - i;
      key = (up === 0 ? './' : '../'.repeat(up)) + to.slice(i).join('/');
    } else key = `/${np}`;
    keys.set(key, np);
  }
  const pick = call.importName === null ? '' : call.importName === 'default' ? '.default' : `[${JSON.stringify(call.importName)}]`;
  const entries = [...keys.keys()].sort().map((key) => {
    const req = `require(${JSON.stringify(key)})`;
    const value = call.eager ? `${req}${pick}` : `() => Promise.resolve().then(() => ${req}${pick})`;
    return `${JSON.stringify(key)}: ${value}`;
  });
  return `({${entries.join(', ')}})`;
}

/**
 * Expand every provable `import.meta.glob` call across the module map. Modules without one are returned as
 * the very same strings; a module the parser cannot read is left as it was and reported. PURE apart from
 * loading the parser.
 */
export function expandImportMetaGlob(modules: Record<string, string>): GlobExpansion {
  const out: Record<string, string> = { ...modules };
  const unsupported: string[] = [];
  const paths = Object.keys(modules);
  for (const [file, code] of Object.entries(modules)) {
    if (!SOURCE_RE.test(file) || typeof code !== 'string' || !QUICK_RE.test(code)) continue;
    const parser = loadParser();
    if (!parser) { unsupported.push(`${file}: the compiler is unavailable`); continue; }
    let ast: any;
    try {
      const ts = /\.[cm]?tsx?$/i.test(file);
      ast = parser.parse(code, { sourceType: 'module', plugins: ts ? ['typescript', 'jsx'] : ['jsx'], errorRecovery: false });
    } catch {
      unsupported.push(`${file}: could not be read`);
      continue;
    }
    const calls = collectCalls(ast);
    if (calls.length === 0) continue;
    let next = code;
    // Replace from the end so earlier ranges stay valid.
    for (const node of [...calls].sort((a, b) => b.start - a.start)) {
      const parsed = parseCall(node);
      if (typeof parsed === 'string') { unsupported.push(`${file}: ${parsed}`); continue; }
      const removed = next.slice(parsed.start, parsed.end);
      const newlines = (removed.match(/\n/g) ?? []).length;
      next = next.slice(0, parsed.start) + expansionSource(file, parsed, paths) + '\n'.repeat(newlines) + next.slice(parsed.end);
    }
    out[file] = next;
  }
  return { modules: out, unsupported };
}

/** Does any module use `import.meta.glob` in a way this expansion cannot prove? (previewCapability's question.) */
export function hasUnexpandableImportMetaGlob(files: Record<string, string> | null | undefined): boolean {
  return expandImportMetaGlob(files ?? {}).unsupported.length > 0;
}
