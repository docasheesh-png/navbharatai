import { describe, it, expect } from 'vitest';
import { buildReactPreview } from './ReactPreview';
import { buildVuePreview } from './VuePreview';
import { buildStaticPreview } from './StaticPreview';
import { STORAGE_SHIM_SOURCE, APP_TOUCH_CSS, NAVDATA_RUNTIME_SOURCE } from './previewImportMeta';
import { VirtualFileSystem } from '../project/ProjectModel';

/**
 * THE STORE'S FIRST REAL PLAY REPORT (admin, 2026-08-15) — two failures, one session:
 *
 *   1. "game over hone par hang jaisa crash" — the player runs apps in an opaque-origin sandboxed
 *      iframe, where the localStorage GETTER throws; a game writing its high score at game over
 *      threw, and the shell's error handler then WIPED the running app's DOM. Two root causes,
 *      both fixed and both pinned here: the storage shim (the throw never happens) and the
 *      painted-guard (even if something else throws, a painted app is never destroyed).
 *   2. "long press par text select ho jata hai" — a published app must feel like an app, not a
 *      document: selection off by default, inputs still selectable, no double-tap zoom.
 *
 * All three shells (React, Vue, Static) must carry both — a game is as likely to be plain JS as
 * React, and a fix that lands in one shell is the exact drift this suite forbids.
 */

const REACT_APP = {
  'package.json': JSON.stringify({ name: 'app', dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' } }),
  'src/main.jsx': "import App from './App';\nexport default App;",
  'src/App.jsx': "export default function App(){ return <div>Hi</div>; }",
};

const VUE_APP = {
  'package.json': JSON.stringify({ name: 'app', dependencies: { vue: '^3.0.0' } }),
  'index.html': '<div id="app"></div><script type="module" src="/src/main.js"></script>',
  'src/main.js': "import { createApp } from 'vue';\nimport App from './App.vue';\ncreateApp(App).mount('#app');",
  'src/App.vue': '<template><div>Hi</div></template>',
};

const STATIC_APP = {
  'index.html': '<!DOCTYPE html><html><head><title>Game</title></head><body><canvas></canvas><script src="game.js"></script></body></html>',
  'game.js': "localStorage.setItem('highscore', '9');",
};

const shells: Array<[string, string]> = [
  ['react', buildReactPreview(VirtualFileSystem.fromRecord(REACT_APP))],
  ['vue', buildVuePreview(VirtualFileSystem.fromRecord(VUE_APP))],
  ['static', buildStaticPreview(VirtualFileSystem.fromRecord(STATIC_APP))],
];

describe('every shell ships the storage shim (opaque-origin localStorage cannot crash an app)', () => {
  it.each(shells)('%s shell contains the shim', (_name, html) => {
    expect(html).toContain(STORAGE_SHIM_SOURCE);
  });

  it('the shim only replaces storage that THROWS — a working native storage is untouched', () => {
    expect(STORAGE_SHIM_SOURCE).toContain("window[name].getItem('')");
    expect(STORAGE_SHIM_SOURCE).toContain('catch');
    expect(STORAGE_SHIM_SOURCE).toContain("ensure('localStorage')");
    expect(STORAGE_SHIM_SOURCE).toContain("ensure('sessionStorage')");
  });

  it('the shim runs BEFORE any app script can touch storage', () => {
    for (const [name, html] of shells) {
      const shimAt = html.indexOf(STORAGE_SHIM_SOURCE);
      expect(shimAt, name).toBeGreaterThan(-1);
      // The static app's own inlined game script (and each shell's loader) must come after.
      const appScriptAt = name === 'static' ? html.indexOf('highscore') : html.indexOf('__bundle__');
      expect(shimAt, name).toBeLessThan(appScriptAt);
    }
  });
});

describe('every shell ships the app-feel CSS (no long-press selection, inputs still selectable)', () => {
  it.each(shells)('%s shell contains the touch CSS', (_name, html) => {
    expect(html).toContain(APP_TOUCH_CSS);
  });

  it('selection is off by default but inputs/textareas/contenteditable keep it', () => {
    expect(APP_TOUCH_CSS).toContain('user-select: none');
    expect(APP_TOUCH_CSS).toContain('-webkit-touch-callout: none');
    expect(APP_TOUCH_CSS).toContain('touch-action: manipulation');
    expect(APP_TOUCH_CSS).toMatch(/input, textarea, select, \[contenteditable\][^{]*\{[^}]*user-select: text/);
  });

  it('the CSS is a DEFAULT the app can override — injected before the app\'s own styles', () => {
    for (const [name, html] of shells) {
      const cssAt = html.indexOf(APP_TOUCH_CSS);
      expect(cssAt, name).toBeGreaterThan(-1);
      expect(cssAt, name).toBeLessThan(html.length / 2); // early in the document, never appended last
    }
  });
});

describe('a painted app is never wiped by a later runtime error (the game-over hang)', () => {
  it('React shell: showError refuses to touch the DOM after paint', () => {
    const html = shells[0][1];
    expect(html).toContain('var nbaiPainted = false');
    // the guard is the FIRST statement of showError, before hideBoot/innerHTML
    expect(html).toMatch(/function showError\(msg\) \{[\s\S]{0,700}?if \(nbaiPainted\) return;/);
    // both paint paths set the flag: the #root MutationObserver and the portal/canvas fallback
    expect(html).toContain('nbaiPainted = true; hideBoot();');
    expect(html).toContain('nbaiPainted = true; hideBoot(); }, 300)');
  });

  it('Vue shell: same guard, same order', () => {
    const html = shells[1][1];
    expect(html).toContain('var nbaiPainted = false');
    expect(html).toMatch(/function showError\(msg\) \{[\s\S]{0,300}?if \(nbaiPainted\) return;/);
    expect(html).toContain('nbaiPainted = true; }, 300)');
  });
});

describe('the static shell finally keeps the NavData promise', () => {
  // The builder prompt tells every generated app that window.NavData exists. React and Vue shells
  // injected it; plain-HTML apps got nothing — found as a sibling while fixing the crash.
  it('NavData runtime is injected into static previews', () => {
    expect(shells[2][1]).toContain(NAVDATA_RUNTIME_SOURCE);
  });

  it('a head-less document still gets the platform runtime (prepended)', () => {
    const html = buildStaticPreview(VirtualFileSystem.fromRecord({ 'index.html': '<body><h1>x</h1></body>' }));
    expect(html).toContain(STORAGE_SHIM_SOURCE);
    expect(html).toContain(APP_TOUCH_CSS);
  });
});
