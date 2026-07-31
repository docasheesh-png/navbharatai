import { describe, it, expect } from 'vitest';
import { planImportedApp, RUN_IMPORTED_APP_MESSAGE } from './importedAppPlan';

describe('planImportedApp — decide what to do after a .zip project import', () => {
  it('AUTO-RUNS a framework app (Vite + package.json) — the exact admin case: .zip imported but preview never started', () => {
    const files = {
      'package.json': JSON.stringify({ devDependencies: { vite: '^5.0.0' }, dependencies: { react: '^18' } }),
      'src/App.tsx': 'export default function App(){ return <div>hi</div>; }',
      'index.html': '<div id="root"></div>',
    };
    const p = planImportedApp(files);
    expect(p.kind).toBe('framework');
    expect(p.autoRun).toBe(true);           // must auto-boot — this is what was missing
    expect(p.inBrowserPreview).toBe(false); // needs a real dev server, not the Babel preview
  });

  it('detects the common bundlers/frameworks as framework apps', () => {
    for (const tool of ['vite', 'webpack', 'next', 'nuxt', 'gatsby', 'parcel', 'rollup', '@vitejs']) {
      const files = { 'package.json': `{ "devDependencies": { "${tool}": "1.0.0" } }`, 'src/main.tsx': 'x' };
      expect(planImportedApp(files).kind, tool).toBe('framework');
      expect(planImportedApp(files).autoRun, tool).toBe(true);
    }
  });

  it('does NOT auto-run a simple-React app (JSX, no bundler) — it previews in-browser via Babel', () => {
    const p = planImportedApp({ 'App.jsx': 'export default () => <h1>Hi</h1>;' });
    expect(p.kind).toBe('simple-react');
    expect(p.autoRun).toBe(false);
    expect(p.inBrowserPreview).toBe(true);
  });

  it('does NOT auto-run a static app (html, no package.json) — it previews in-browser immediately', () => {
    const p = planImportedApp({ 'index.html': '<h1>hello</h1>', 'style.css': 'body{}' });
    expect(p.kind).toBe('static');
    expect(p.autoRun).toBe(false);
    expect(p.inBrowserPreview).toBe(true);
  });

  it('a package.json WITHOUT a bundler (a plain node lib) is not a framework preview — no auto-run', () => {
    const p = planImportedApp({ 'package.json': '{ "dependencies": { "express": "4" } }', 'index.js': 'x' });
    expect(p.kind).toBe('other');
    expect(p.autoRun).toBe(false);
  });

  it('an empty / binary-only import is "other" and never auto-runs', () => {
    expect(planImportedApp({}).autoRun).toBe(false);
    expect(planImportedApp({ 'logo.png': 'binary' }).kind).toBe('other');
  });

  it('the auto-run message tells the engine to RUN (not rebuild) the imported app', () => {
    expect(RUN_IMPORTED_APP_MESSAGE.toLowerCase()).toContain('install');
    expect(RUN_IMPORTED_APP_MESSAGE.toLowerCase()).toContain('preview');
    expect(RUN_IMPORTED_APP_MESSAGE.toLowerCase()).toContain('do not rebuild');
  });
});
