import { describe, it, expect } from 'vitest';
import { VirtualFileSystem } from '../src/server/project/ProjectModel';
import { renderPreview, choosePreviewKind } from '../src/server/runtime/renderPreview';

/**
 * ADMIN REPORT 2026-08-25: an app that worked in its creator's account was published to the store,
 * and opening it from a third device showed "No React entry module found — Expected a module entry
 * (e.g. src/main.jsx) referenced by index.html."
 *
 * 🔒 ROOT CAUSE. `isReactProject()` answered "is this React?" from `package.json` dependencies (or
 * the mere presence of any .jsx/.tsx file). Our own builder scaffolds `react` into package.json even
 * for a vanilla HTML/canvas game, so the game was routed to the React renderer, which looked for a
 * React module entry, found none, and served that error to every viewer.
 *
 * WHY THE CREATOR NEVER SAW IT: their preview runs on the live sandbox dev server, not this static
 * renderer. The app was broken only for strangers — which is exactly the report.
 *
 * The publish gate did not catch it because `hasRenderableEntry` makes the SAME inference from the
 * same dependency, so it vouched for an app the player could not render. Gate and player agreed on
 * the wrong premise and disagreed on the outcome.
 */

const REACT_PKG = JSON.stringify({ name: 'g', dependencies: { react: '^18.0.0' } });
const NO_ENTRY = 'No React entry module found';
const vfs = (files: Record<string, string>) => VirtualFileSystem.fromRecord(files);

describe('store playback — a framework is only chosen when its entry really exists', () => {
  it('THE REPORTED APP: a vanilla game with react in package.json now renders', () => {
    const game = {
      'index.html': `<!doctype html><html><body><canvas id="c"></canvas>`
        + `<script>const c=document.getElementById('c');</script></body></html>`,
      'style.css': 'body{margin:0}',
      'package.json': REACT_PKG,
    };
    expect(choosePreviewKind(vfs(game))).toBe('static');
    const html = renderPreview(vfs(game), 'https://navbharatai.com', 'store-x');
    expect(html).not.toContain(NO_ENTRY);
    expect(html).toContain('canvas');
  });

  it('a stray .jsx component with no entry does not make it a React app', () => {
    const app = {
      'index.html': `<!doctype html><html><body><script>const x=1;</script></body></html>`,
      'components/Car.jsx': 'export const Car = () => null;',
    };
    expect(choosePreviewKind(vfs(app))).toBe('static');
    expect(renderPreview(vfs(app))).not.toContain(NO_ENTRY);
  });

  it('a REAL React app still goes to the React renderer', () => {
    const app = {
      'index.html': `<!doctype html><html><body><div id="root"></div>`
        + `<script type="module" src="/src/main.jsx"></script></body></html>`,
      'src/main.jsx': `import App from './App';`,
      'src/App.jsx': `export default function App(){ return <h1>hi</h1>; }`,
      'package.json': REACT_PKG,
    };
    expect(choosePreviewKind(vfs(app))).toBe('react');
    expect(renderPreview(vfs(app))).not.toContain(NO_ENTRY);
  });

  it('a REAL Vue app still goes to the Vue renderer', () => {
    const app = {
      'index.html': `<!doctype html><html><body><div id="app"></div>`
        + `<script type="module" src="/src/main.js"></script></body></html>`,
      'src/main.js': `import App from './App.vue';`,
      'src/App.vue': `<template><h1>hi</h1></template>`,
      'package.json': JSON.stringify({ dependencies: { vue: '^3.0.0' } }),
    };
    expect(choosePreviewKind(vfs(app))).toBe('vue');
  });

  it('an app pointing at a script it does NOT contain keeps the honest error', () => {
    // Falling back to static here would render a page with a dead script — a blank screen instead of
    // a message. Blank-and-wrong is worse than an honest refusal, so this case stays an error.
    const broken = {
      'index.html': `<!doctype html><html><body><script src="game.js"></script></body></html>`,
      'package.json': REACT_PKG,
    };
    expect(choosePreviewKind(vfs(broken))).toBe('react');
    expect(renderPreview(vfs(broken))).toContain(NO_ENTRY);
  });

  it('a plain page with no framework anywhere is still static', () => {
    const page = { 'index.html': `<!doctype html><html><body><h1>hello</h1></body></html>` };
    expect(choosePreviewKind(vfs(page))).toBe('static');
  });

  it('a remote CDN script is not mistaken for a missing local file', () => {
    const cdn = {
      'index.html': `<!doctype html><html><body><canvas></canvas>`
        + `<script src="https://cdn.example.com/three.min.js"></script>`
        + `<script>const x=1;</script></body></html>`,
      'package.json': REACT_PKG,
    };
    expect(choosePreviewKind(vfs(cdn))).toBe('static');
  });
});
