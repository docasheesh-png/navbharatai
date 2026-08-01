import { describe, it, expect } from 'vitest';
import * as ts from 'typescript';
import { ViteReactProvider } from './ViteReactProvider';
import { hasErrorBoundarySignal } from '../../../../ErrorBoundaryAnalysis';

describe('ViteReactProvider (v5.0 sandbox template) — ships an error boundary by default (C8)', () => {
  const files = new ViteReactProvider().getFiles([]);

  it('includes a real ErrorBoundary component the readiness analysis recognises', () => {
    expect(files['src/ErrorBoundary.tsx']).toBeDefined();
    expect(hasErrorBoundarySignal(files['src/ErrorBoundary.tsx'])).toBe(true); // getDerivedStateFromError + componentDidCatch
  });

  it('wraps <App/> in <ErrorBoundary> in main.tsx (so a component crash never white-screens the app)', () => {
    const main = files['src/main.tsx'];
    expect(main).toContain("import ErrorBoundary from './ErrorBoundary'");
    expect(main).toMatch(/<ErrorBoundary>[\s\S]*<App \/>[\s\S]*<\/ErrorBoundary>/);
    expect(hasErrorBoundarySignal(main)).toBe(true); // the <ErrorBoundary> usage is itself a signal
  });

  it('still ships the essentials (App, vite config, tsconfig, index.html)', () => {
    for (const p of ['src/App.tsx', 'src/main.tsx', 'vite.config.ts', 'tsconfig.json', 'index.html', 'package.json']) {
      expect(files[p], p).toBeDefined();
    }
  });
});

// Kanban build autopsy (2026-07-13): the build wrote src/stores/useBoardStore.ts and src/types/index.ts,
// yet the generated code imported them baseUrl-"src" style (`from 'stores/useBoardStore'`, `from 'types/index'`)
// — and the scaffold tsconfig had NO baseUrl, so tsc reported TS2307 "Cannot find module" → TYPECHECK_FAILED,
// even though the file existed. This proves, via the REAL TypeScript resolver against the scaffold's own
// tsconfig, that such imports now resolve — the fix holds where it broke, not just in a config-string check.
describe('ViteReactProvider scaffold — resolves baseUrl-"src" imports (Kanban autopsy regression)', () => {
  const files = new ViteReactProvider().getFiles([]);
  const ROOT = '/proj';
  const tsconfigJson = JSON.parse(files['tsconfig.json']);
  const { options } = ts.convertCompilerOptionsFromJson(tsconfigJson.compilerOptions, ROOT);

  // Virtual project = the two modules the Kanban build actually wrote under src/, plus one component.
  const existing = new Set<string>([
    `${ROOT}/src/stores/useBoardStore.ts`,
    `${ROOT}/src/types/index.ts`,
    `${ROOT}/src/components/ui/Button.tsx`,
    `${ROOT}/src/components/Dashboard.tsx`,
  ]);
  const host: ts.ModuleResolutionHost = {
    fileExists: (f) => existing.has(f.replace(/\\/g, '/')),
    readFile: () => '',
    directoryExists: () => true,
    getDirectories: () => [],
  };
  const resolve = (spec: string): string | undefined =>
    ts.resolveModuleName(spec, `${ROOT}/src/components/Dashboard.tsx`, options, host).resolvedModule?.resolvedFileName;

  it('resolves a bare baseUrl import to its file under src/ (the exact TYPECHECK_FAILED cause)', () => {
    expect(resolve('stores/useBoardStore')).toBe(`${ROOT}/src/stores/useBoardStore.ts`);
    expect(resolve('types/index')).toBe(`${ROOT}/src/types/index.ts`);
  });

  it('resolves the @/ alias to src/', () => {
    expect(resolve('@/components/ui/Button')).toBe(`${ROOT}/src/components/ui/Button.tsx`);
  });

  it('does NOT hijack a real npm package (no src/react → falls through to node resolution, unresolved here)', () => {
    expect(resolve('react')).toBeUndefined(); // no src/react and no node_modules in the virtual FS
  });

  it('Vite mirrors the tsconfig paths so resolution holds at build/runtime, not only in tsc', () => {
    expect(files['vite.config.ts']).toContain("import tsconfigPaths from 'vite-tsconfig-paths'");
    expect(files['vite.config.ts']).toMatch(/plugins:\s*\[react\(\),\s*tsconfigPaths\(\)\]/);
    expect(JSON.parse(files['package.json']).devDependencies['vite-tsconfig-paths']).toBeTruthy();
  });

  // ShopKhata autopsy 2026-07-17: without type:module Vite require()s the bundled config, and the
  // ESM-only vite-tsconfig-paths crashes the dev server on BOOT — the app never gets a preview.
  // The plugin version is exact-pinned so a fresh npm install can't drift onto a build the baked
  // sandbox never tested (the ^5.1.4 range is how the crash arrived).
  it('package.json carries the LOAD-BEARING type:module + an exact-pinned tsconfig-paths plugin', () => {
    const pkg = JSON.parse(files['package.json']);
    expect(pkg.type).toBe('module');
    expect(pkg.devDependencies['vite-tsconfig-paths']).toBe('5.1.4');
  });
});

// NotesNest autopsy (2026-07-16): the scaffold shipped NO stylesheet and main.tsx imported none, so a
// build whose generated CSS never got wired rendered as raw unstyled HTML. "Styled" is now the default
// by construction: the starter ships src/index.css and main.tsx imports it.
describe('ViteReactProvider — ships a wired global stylesheet by default', () => {
  const files = new ViteReactProvider().getFiles([]);

  it('includes src/index.css with a real base (font stack, box-sizing, theme variables)', () => {
    const css = files['src/index.css'];
    expect(css).toBeDefined();
    expect(css).toContain('font-family');
    expect(css).toContain('box-sizing');
    expect(css).toContain('--accent');
  });

  // Colour-by-default (design autopsy 2026-08-01, "b/w app bani hai, koi colour nahi"): the starter must
  // not just DEFINE an accent — it must USE it as a real fill, so an app the generator barely styles is
  // still colourful, not black-and-white. Lock: a saturated (non-grey) accent + a FILLED primary button
  // (accent background) + coloured links + semantic status colours.
  it('actually USES colour: filled primary button, coloured links, semantic colours (not just a defined accent)', () => {
    const css = files['src/index.css'];
    // The accent is a real saturated hue (indigo), never grey/black.
    expect(css).toMatch(/--accent:\s*#4f46e5/i);
    // A primary/submit button is FILLED with the accent (white text) — not a grey outlined button.
    expect(css).toMatch(/button\[type="submit"\][\s\S]*background:\s*var\(--accent\)/);
    expect(css).toContain('--accent-fg');
    // Links carry the accent colour.
    expect(css).toMatch(/a\s*\{[^}]*color:\s*var\(--accent\)/);
    // Semantic status colours exist for badges/alerts.
    for (const v of ['--success', '--danger', '--warning']) expect(css).toContain(v);
  });

  // M2-S2.1 (design system): the scaffold ships a small premium component kit so every app looks
  // designed out of the box — a typographic scale plus badge/alert/container/field/ghost-button classes.
  it('ships the component kit (typography + .badge/.alert/.container/.field/.btn-ghost)', () => {
    const css = files['src/index.css'];
    expect(css).toMatch(/h1\s*\{[^}]*font-size/); // a real heading scale
    for (const cls of ['.btn-ghost', '.badge', '.badge-success', '.alert', '.alert-danger', '.container', '.stack', '.row', '.field']) {
      expect(css, cls).toContain(cls);
    }
  });

  it('main.tsx imports it (so an app is styled even if the generator forgets the import)', () => {
    expect(files['src/main.tsx']).toContain("import './index.css'");
  });
});

// ShopKhata-class sweep 2026-07-17: EVERY vite-family template must carry type:module — Vue's
// @vitejs/plugin-vue 5.x and Svelte's vite-plugin-svelte 3.x are ESM-only, so without it Vite
// require()s the bundled config and the dev server dies on boot (the exact ShopKhata failure).
describe('vite-family templates — the type:module invariant holds everywhere', () => {
  it('Vue, Svelte and Vanilla scaffolds all ship "type": "module"', async () => {
    const { VueProvider } = await import('./VueProvider');
    const { SvelteProvider } = await import('./SvelteProvider');
    const { VanillaProvider } = await import('./VanillaProvider');
    for (const P of [VueProvider, SvelteProvider, VanillaProvider]) {
      const files = new P().getFiles([]);
      expect(JSON.parse(files['package.json']).type).toBe('module');
    }
  });
});
