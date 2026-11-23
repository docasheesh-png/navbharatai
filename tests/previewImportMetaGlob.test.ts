/**
 * `import.meta.glob` in the in-browser runtime (admin 2026-11-22: a NavBharatAI-made game was refused by App
 * Mart — "this project builds part of itself while it compiles"). The platform's own game kit writes
 * `import.meta.glob`; the runtime now expands it on the server with Vite's semantics.
 *
 * The class locked here: "the platform generates code its own App Mart refuses". The census at the bottom
 * reads every `import.meta.glob(` call the game-kit generators emit and fails if one is not expandable.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expandImportMetaGlob, expansionSource, globToRegExp } from '../src/server/runtime/previewImportMetaGlob';
import { proveBrowserRunnable, importMetaGlobNeedsLiveServer } from '../src/server/AgentV3/previewCapability';
import { previewFidelityCaveats } from '../src/server/AgentV3/previewFidelity';
import { precompileModules } from '../src/server/runtime/PreviewPrecompile';

const REACT_APP = {
  'package.json': JSON.stringify({ dependencies: { react: '18', 'react-dom': '18' } }),
  'index.html': '<div id=root></div><script type="module" src="/src/main.tsx"></script>',
  'src/main.tsx': 'import App from "./App"; import { createRoot } from "react-dom/client"; createRoot(document.getElementById("root")!).render(<App />);',
  'src/App.tsx': 'export default () => null;',
};

/** The exact line the game kit writes (GameAssetRuntimeGenerator) — the admin's report. */
const KIT_LINE = "const customizationModules = import.meta.glob('./assetCustomizations.ts', { eager: true }) as Record<string, { assetCustomizations?: Record<string, unknown> }>;";

describe('expansion follows Vite', () => {
  const paths = ['src/game/three/assetRuntime.ts', 'src/game/three/assetCustomizations.ts', 'src/game/player.ts', 'src/game/car.ts', 'src/pages/a.tsx', 'src/pages/b.tsx', 'src/pages/deep/c.tsx'];
  it('eager, present file → the module; missing file → {}', () => {
    expect(expansionSource('src/game/three/assetRuntime.ts', { patterns: ['./assetCustomizations.ts'], eager: true, importName: null }, paths))
      .toBe('({"./assetCustomizations.ts": require("./assetCustomizations.ts")})');
    expect(expansionSource('src/game/three/assetRuntime.ts', { patterns: ['./nope.ts'], eager: true, importName: null }, paths)).toBe('({})');
  });
  it('parent directories, a named import and lazy loading', () => {
    expect(expansionSource('src/game/three/x.ts', { patterns: ['../car.ts'], eager: true, importName: 'CAR' }, paths))
      .toBe('({"../car.ts": require("../car.ts")["CAR"]})');
    expect(expansionSource('src/game/three/x.ts', { patterns: ['../player.ts'], eager: false, importName: null }, paths))
      .toBe('({"../player.ts": () => Promise.resolve().then(() => require("../player.ts"))})');
  });
  it('wildcards, ** and negation; keys sorted; the importer never matches itself', () => {
    const one = expansionSource('src/App.tsx', { patterns: ['./pages/*.tsx'], eager: true, importName: null }, paths);
    expect(one).toBe('({"./pages/a.tsx": require("./pages/a.tsx"), "./pages/b.tsx": require("./pages/b.tsx")})');
    const deep = expansionSource('src/App.tsx', { patterns: ['./pages/**/*.tsx', '!./pages/b.tsx'], eager: true, importName: 'default' }, paths);
    expect(deep).toBe('({"./pages/a.tsx": require("./pages/a.tsx").default, "./pages/deep/c.tsx": require("./pages/deep/c.tsx").default})');
    expect(globToRegExp('src/{a,b}.ts').test('src/b.ts')).toBe(true);
  });
});

describe('the rewrite touches only the call', () => {
  it('line numbers after a multi-line call are unchanged; non-literal calls are reported and left alone', () => {
    const src = "const a = import.meta.glob(\n  './x.ts',\n  { eager: true },\n);\nexport const marker = 1;\n";
    const { modules, unsupported } = expandImportMetaGlob({ 'src/m.ts': src, 'src/x.ts': 'export const v = 1;' });
    expect(unsupported).toEqual([]);
    expect(modules['src/m.ts'].split('\n').indexOf('export const marker = 1;')).toBe(src.split('\n').indexOf('export const marker = 1;'));
    expect(modules['src/m.ts']).not.toMatch(/import\.meta\.glob/);
    const bad = expandImportMetaGlob({ 'src/r.ts': 'const d = "./p/"; export const pages = import.meta.glob(d + "*.tsx");' });
    expect(bad.unsupported[0]).toMatch(/not a literal/);
    expect(bad.modules['src/r.ts']).toContain('import.meta.glob');
    expect(expandImportMetaGlob({ 'src/q.ts': "import.meta.glob('./x', { query: '?raw' })" }).unsupported[0]).toMatch(/`query` option/);
  });
  it('the expanded module compiles and runs: the kit reads its customisation file', () => {
    const files = {
      'src/game/three/assetRuntime.ts': `${KIT_LINE}\nexport const read = () => Object.values(customizationModules)[0]?.assetCustomizations;`,
      'src/game/three/assetCustomizations.ts': 'export const assetCustomizations = { car: { color: "red" } };',
    };
    const compiled = precompileModules(expandImportMetaGlob(files).modules)!;
    expect(compiled).not.toBeNull();
    const cache: Record<string, any> = {};
    const load = (path: string): any => {
      if (cache[path]) return cache[path].exports;
      const module = { exports: {} as any };
      cache[path] = module;
      const req = (spec: string) => load(join(path, '..', spec).replace(/\\/g, '/'));
      new Function('require', 'module', 'exports', compiled[path])(req, module, module.exports);
      return module.exports;
    };
    expect(load('src/game/three/assetRuntime.ts').read()).toEqual({ car: { color: 'red' } });
  });
});

describe('App Mart and the preview follow the same decision', () => {
  it('a React app with the kit\'s glob is browser-runnable now — the reported refusal', () => {
    const app = { ...REACT_APP, 'src/game/three/assetRuntime.ts': KIT_LINE };
    expect(importMetaGlobNeedsLiveServer(app)).toBe(false);
    const c = proveBrowserRunnable(app);
    expect(c.blockers).not.toContain('import-meta-glob');
    expect(previewFidelityCaveats(app).map((x: { id: string }) => x.id)).not.toContain('vite-glob');
  });
  it('a glob that cannot be proven, or a renderer that does not expand it, is still refused', () => {
    expect(importMetaGlobNeedsLiveServer({ ...REACT_APP, 'src/r.ts': 'const d="x"; import.meta.glob(d);' })).toBe(true);
    expect(importMetaGlobNeedsLiveServer({ 'index.html': '<p>hi</p>', 'src/a.js': "import.meta.glob('./x.js')" })).toBe(true);
  });
});

describe('census: every import.meta.glob the platform writes into a game is expandable', () => {
  const sources = [
    ...readdirSync('src/server/lib').filter((f) => /^Game.*Generator\.ts$/.test(f)).map((f) => join('src/server/lib', f)),
    ...readdirSync('src/server/AgentV3/gameAssets').filter((f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f)).map((f) => join('src/server/AgentV3/gameAssets', f)),
  ];
  it('each emitted call parses with literal arguments and supported options', () => {
    const calls: string[] = [];
    for (const file of sources) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        const m = line.match(/import\.meta\.glob\s*(?:<[^>]*>)?\s*\((.*?)\)\s*(?:as\b|;|$)/);
        if (m) calls.push(`${file}: import.meta.glob(${m[1]})`);
      }
    }
    expect(calls.length).toBeGreaterThanOrEqual(6);
    const bad = calls.filter((c) => {
      const code = `const x = ${c.slice(c.indexOf('import.meta'))};`;
      return expandImportMetaGlob({ 'src/k.ts': code }).unsupported.length > 0;
    });
    expect(bad, 'A game-kit generator writes an import.meta.glob the runtime cannot expand — App Mart would refuse every such game').toEqual([]);
  });
});
