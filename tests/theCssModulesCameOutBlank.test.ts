/**
 * ADMIN 2026-09-28, with a screenshot of a "secret calculator" rendered in a serif "0" and browser-default
 * buttons wrapping inline: "code padh ke dekh! kya aisa calculator banaya ja raha hai! navbharatai dwara?
 * user ko aise farzi app na mile! real looking apps/games mile! … sundar aur real cheez bane fake/farzi nahi!!"
 *
 * THE FINDINGS, each locked here:
 *   1. BOTH in-browser renderers answered every `.css` import with `exports: {}`. For a CSS Module that
 *      makes `styles.card` undefined — every class on the page blank — so a fully styled app was shown as
 *      raw HTML in the user's preview pane, the admin's Built-apps preview and every App Mart web player.
 *      `previewFidelity.ts` KNEW ("class names come out blank here") and said so in a caveat.
 *   2. The server renderer detected only Tailwind v3 (`@tailwind`); a v4 app (`@import "tailwindcss"`) got
 *      the v3 Play CDN, which compiles nothing from it. The client bundler loaded no Tailwind at all.
 *   3. The fast lane's convention said "CSS Modules (default)" one paragraph after its design contract
 *      said "use classes that REALLY exist in the global stylesheet" — two shapes, chosen at random.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { transformCssModule, bundleCssModules, cssModuleScope, cssModuleExportsJs, isCssModulePath } from '../src/lib/cssModules';
import { detectTailwindFlavour, tailwindHeadTags, TAILWIND_DIRECTIVE_RE, TAILWIND_V3_CDN, TAILWIND_V4_CDN } from '../src/lib/previewTailwind';
import { buildReactPreview, SHADCN_TW_CONFIG } from '../src/server/runtime/ReactPreview';
import { buildSourceAppPreview } from '../src/lib/previewUtils';
import { previewFidelityCaveats } from '../src/server/AgentV3/previewFidelity';
import { VirtualFileSystem } from '../src/server/project/ProjectModel';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('1 · the transform — a CSS Module is scoped and its map is exact', () => {
  it('renames every class in a selector, exports written → scoped, and adds a camelCase alias', () => {
    const t = transformCssModule('src/Card.module.css', '.card, .card:hover .nav-item { color: red }');
    const scope = cssModuleScope('src/Card.module.css');
    expect(t.exports.card).toBe(`card_${scope}`);
    expect(t.exports['nav-item']).toBe(`nav-item_${scope}`);
    expect(t.exports.navItem).toBe(`nav-item_${scope}`);
    expect(t.css).toBe(`.card_${scope}, .card_${scope}:hover .nav-item_${scope} { color: red }`);
  });

  it('never touches a number, a string, or a comment — only selectors', () => {
    const t = transformCssModule('a.module.css', '/* .ghost */ .x { padding: .5em 1.5rem; content: ".not"; } [data-k=".no"] { color: red }');
    expect(t.css).toContain('padding: .5em 1.5rem');
    expect(t.css).toContain('content: ".not"');
    expect(t.css).toContain('[data-k=".no"]');
    expect(Object.keys(t.exports)).toEqual(['x']);
  });

  it('scopes inside @media, leaves @keyframes steps alone, and follows a top-level @import statement', () => {
    const t = transformCssModule('a.module.css', '@import "base.css";\n.card { color: red }\n@media (max-width: 600px) { .card { padding: 0 } }\n@keyframes fade { from { opacity: 0 } to { opacity: 1 } }');
    const scope = cssModuleScope('a.module.css');
    expect(t.css).toContain(`@media (max-width: 600px) { .card_${scope} { padding: 0 } }`);
    expect(t.css).toContain('from { opacity: 0 } to { opacity: 1 }');
    // The class right after `@import …;` is scoped — the statement ended the prelude.
    expect(t.css).toContain(`@import "base.css";\n.card_${scope} {`);
    expect(t.exports).toEqual({ card: `card_${scope}` });
  });

  it(':global() is the escape hatch and stays verbatim; native nesting is scoped', () => {
    const t = transformCssModule('a.module.css', ':global(.body-lock) { overflow: hidden }\n.btn :global(.lucide) { size: 1 }\n.btn { &.active { color: blue } }');
    const scope = cssModuleScope('a.module.css');
    expect(t.css).toContain('.body-lock { overflow: hidden }');
    expect(t.css).toContain(`.btn_${scope} .lucide {`);
    expect(t.css).toContain(`&.active_${scope} {`);
    expect(t.exports['body-lock']).toBeUndefined();
    expect(t.exports.active).toBe(`active_${scope}`);
  });

  it('the scope is stable per path and different per file, so two modules can both define .card', () => {
    expect(cssModuleScope('src/A.module.css')).toBe(cssModuleScope('src/A.module.css'));
    expect(cssModuleScope('src/A.module.css')).not.toBe(cssModuleScope('src/B.module.css'));
    const b = bundleCssModules({ 'src/A.module.css': '.card{}', 'src/B.module.css': '.card{}', 'src/index.css': '.card{}' });
    expect(b.exports['src/A.module.css'].card).not.toBe(b.exports['src/B.module.css'].card);
    expect(b.files['src/index.css']).toBe('.card{}'); // a plain stylesheet is untouched
    expect(b.exports['src/index.css']).toBeUndefined();
    expect(isCssModulePath('src/index.css')).toBe(false);
  });

  it('the loader expression yields the shape Babel interop expects: default = the map, and named keys', () => {
    const map = { card: 'card_x', 'nav-item': 'n_x', navItem: 'n_x' };
    const ex = new Function('return ' + cssModuleExportsJs(JSON.stringify(map)))();
    expect(ex.__esModule).toBe(true);
    expect(ex.default).toEqual(map);
    expect(ex.card).toBe('card_x');
    // A path with no map (a module the transform never saw) still yields a usable, empty module.
    const empty = new Function('return ' + cssModuleExportsJs('undefined'))();
    expect(empty.default).toEqual({});
  });
});

const CSS_MODULE_APP = {
  'package.json': JSON.stringify({ name: 'calc', dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' } }),
  'index.html': '<div id="root"></div><script type="module" src="/src/main.tsx"></script>',
  'src/main.tsx': "import { createRoot } from 'react-dom/client';\nimport App from './App';\ncreateRoot(document.getElementById('root')!).render(<App />);",
  'src/App.tsx': "import styles from './App.module.css';\nexport default function App(){ return <div className={styles.display}><button className={styles.key}>0</button></div>; }",
  'src/App.module.css': '.display { font: 700 32px system-ui; } .key { border-radius: 12px; padding: 16px; }',
};

describe('2 · the SERVER renderer ships scoped CSS and the class map, on both of its paths', () => {
  const scope = cssModuleScope('src/App.module.css');

  it('🔴 the shipped stylesheet is scoped and the bundle carries the map (precompiled path)', () => {
    const html = buildReactPreview(VirtualFileSystem.fromRecord(CSS_MODULE_APP));
    expect(html).toContain(`.display_${scope} {`);
    expect(html).toContain(`"cssModules":{"src/App.module.css":{"display":"display_${scope}","key":"key_${scope}"}}`);
    expect(html).toContain('var CSS_MODULES = bundle.cssModules || {};');
    expect(html).toMatch(/\.module\\\.css\$\/\.test\(path\)/);
  });

  it('…and on the Babel-in-browser fallback path too (one transform, before precompilation)', () => {
    const prev = process.env.AGENTV3_PREVIEW_PRECOMPILE;
    process.env.AGENTV3_PREVIEW_PRECOMPILE = 'off';
    try {
      const html = buildReactPreview(VirtualFileSystem.fromRecord(CSS_MODULE_APP));
      expect(html).toContain(`.key_${scope} {`);
      expect(html).toContain(`"cssModules":{"src/App.module.css":`);
    } finally {
      if (prev === undefined) delete process.env.AGENTV3_PREVIEW_PRECOMPILE; else process.env.AGENTV3_PREVIEW_PRECOMPILE = prev;
    }
  });

  it('a plain-CSS app ships an empty map and byte-identical stylesheet', () => {
    const html = buildReactPreview(VirtualFileSystem.fromRecord({
      ...CSS_MODULE_APP,
      'src/App.tsx': "import './App.css';\nexport default function App(){ return <div className=\"display\">0</div>; }",
      'src/App.css': '.display { font: 700 32px system-ui; }',
      'src/App.module.css': undefined as unknown as string,
    }));
    expect(html).toContain('"cssModules":{}');
    expect(html).toContain('.display { font: 700 32px system-ui; }');
  });

  it('🔒 REVERSION GUARD — the loader keeps a `.module.css` branch that returns the map, ahead of the plain-CSS branch', () => {
    const src = read('src/server/runtime/ReactPreview.ts');
    const mod = src.indexOf("if (/\\\\.module\\\\.css$/.test(path)) { injectCss(code); cache[path] = { exports: ${cssModuleExportsJs('CSS_MODULES[path]')} }");
    const plain = src.indexOf("if (/\\\\.css$/.test(path)) { injectCss(code); cache[path] = { exports: {} }");
    expect(mod).toBeGreaterThan(-1);
    expect(plain).toBeGreaterThan(mod);
    expect(src).toContain('const cssBundle = bundleCssModules(gathered);');
    expect(src).toContain('cssModules: cssBundle.exports');
  });
});

describe('3 · the CLIENT bundler — the sibling that had the same `exports:{}` line', () => {
  const scope = cssModuleScope('src/App.module.css');

  it('🔴 ships the scoped stylesheet, the map, and a loader branch that reads it', () => {
    const html = buildSourceAppPreview(CSS_MODULE_APP);
    expect(html).toContain(`.display_${scope} {`);
    expect(html).toContain(`window.__CSS_MODULES={"src/App.module.css":{"display":"display_${scope}","key":"key_${scope}"}}`);
    expect(html).toContain('var CSSM=window.__CSS_MODULES||{};');
    expect(html).toMatch(/\.module\\\.css\$\/\.test\(path\)/);
  });

  it('🔒 REVERSION GUARD — the module branch precedes the plain-CSS branch in the bootstrap source', () => {
    const src = read('src/lib/previewUtils.ts');
    const mod = src.indexOf("if(/\\\\.module\\\\.css$/.test(path)){injectCss(src);cache[path]={exports:${cssModuleExportsJs('CSSM[path]')}}");
    const plain = src.indexOf("if(/\\\\.css$/.test(path)){injectCss(src);cache[path]={exports:{}}");
    expect(mod).toBeGreaterThan(-1);
    expect(plain).toBeGreaterThan(mod);
  });
});

describe('4 · Tailwind v4 is compiled, not silently dropped', () => {
  const V4_APP = {
    'package.json': JSON.stringify({ dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' }, devDependencies: { tailwindcss: '^4.1.0', '@tailwindcss/vite': '^4.1.0' } }),
    'index.html': '<div id="root"></div><script type="module" src="/src/main.tsx"></script>',
    'src/main.tsx': "import './index.css';\nexport default () => null;",
    'src/index.css': '@import "tailwindcss";\n@theme { --color-brand: #123456; }',
  };

  it('the detector tells the two generations apart, and stays silent for a plain-CSS app', () => {
    expect(detectTailwindFlavour({ 'src/index.css': '@import "tailwindcss";' })).toBe('v4');
    expect(detectTailwindFlavour({ 'src/index.css': '@tailwind base;\n@tailwind utilities;' })).toBe('v3');
    expect(detectTailwindFlavour({ 'src/index.css': '@apply p-4;\n@theme { }' })).toBe('v4'); // v4 wins when both appear
    expect(detectTailwindFlavour({ 'package.json': '{"devDependencies":{"tailwindcss":"^4.1.14"}}' })).toBe('v4');
    expect(detectTailwindFlavour({ 'package.json': '{"devDependencies":{"tailwindcss":"^3.4.14"}}' })).toBe('v3');
    expect(detectTailwindFlavour({ 'tailwind.config.js': 'module.exports = {}' })).toBe('v3');
    expect(detectTailwindFlavour({ 'src/index.css': 'body { margin: 0 }', 'package.json': '{"dependencies":{"react":"18"}}' })).toBeNull();
  });

  it('🔴 the server renderer loads the v4 browser build for a v4 app — never the v3 Play CDN and its config', () => {
    const html = buildReactPreview(VirtualFileSystem.fromRecord(V4_APP));
    expect(html).toContain(TAILWIND_V4_CDN);
    expect(html).not.toContain(TAILWIND_V3_CDN);
    expect(html).not.toContain(SHADCN_TW_CONFIG);
    expect(html).toContain('type="text/tailwindcss"');
  });

  it('a v3 app is byte-for-byte what it was: Play CDN + the shadcn token config', () => {
    const html = buildReactPreview(VirtualFileSystem.fromRecord({ ...V4_APP, 'src/index.css': '@tailwind base;\n@tailwind utilities;', 'package.json': JSON.stringify({ dependencies: { react: '^18.3.1' } }) }));
    expect(html).toContain(TAILWIND_V3_CDN);
    expect(html).toContain(SHADCN_TW_CONFIG);
    expect(html).not.toContain(TAILWIND_V4_CDN);
  });

  it('🔴 the client bundler now loads Tailwind at all — it used to load none', () => {
    expect(buildSourceAppPreview(V4_APP)).toContain(TAILWIND_V4_CDN);
    expect(buildSourceAppPreview({ ...V4_APP, 'src/index.css': '@tailwind base;' })).toContain(TAILWIND_V3_CDN);
    // (The bootstrap always carries the directive regex and the style-block type, so the CDN URLs are the
    // thing that must be absent for a plain-CSS app — not the word itself.)
    const plain = buildSourceAppPreview({ ...V4_APP, 'src/index.css': 'body{}', 'package.json': '{"dependencies":{"react":"18"}}' });
    expect(plain).not.toContain(TAILWIND_V4_CDN);
    expect(plain).not.toContain(TAILWIND_V3_CDN);
    expect(plain).not.toContain('<style id="__nbai-tw"');
  });

  it('both loaders route every directive — v3 and v4 — into the compiler block, from ONE regex source', () => {
    for (const d of ['@tailwind base;', '@apply p-4;', '@import "tailwindcss";', "@import 'tailwindcss/utilities';", '@theme { }', '@plugin "x";', '@custom-variant dark (&:is(.dark *));', '@utility tab-4 { }']) {
      expect(TAILWIND_DIRECTIVE_RE.test(d), d).toBe(true);
    }
    expect(TAILWIND_DIRECTIVE_RE.test('@import "./other.css"; body { margin: 0 }')).toBe(false);
    expect(read('src/server/runtime/ReactPreview.ts')).toContain('if (/${TAILWIND_DIRECTIVE_RE_SOURCE}/.test(t)) {');
    expect(read('src/lib/previewUtils.ts')).toContain("if(/${TAILWIND_DIRECTIVE_RE_SOURCE}/.test(src||'')){");
    expect(tailwindHeadTags(null)).toBe('');
  });
});

describe('5 · the label came off, and the instruction stopped contradicting itself', () => {
  it('previewFidelity no longer warns about CSS Modules — the preview renders them for real now', () => {
    expect(previewFidelityCaveats({ 'src/Card.module.css': '.card{color:red}', 'src/Card.tsx': "import s from './Card.module.css';" })).toEqual([]);
    // …but a .module.scss still is not compiled, and the preprocessor caveat still says so.
    expect(previewFidelityCaveats({ 'src/Card.module.scss': '.card{color:red}' }).map((c) => c.id)).toContain('css-preprocessor');
  });

  it('the fast lane no longer names CSS Modules as the default — one global stylesheet is', () => {
    const src = read('src/server/AgentV3/SimpleBuilder.ts');
    expect(src).not.toContain('CSS Modules: `import styles from "./X.module.css"` (default)');
    expect(src).toContain('STYLING: ONE global stylesheet');
    expect(src).toContain('ONLY when the existing project already does');
  });
});
