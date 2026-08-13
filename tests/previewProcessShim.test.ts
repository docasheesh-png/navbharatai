import { describe, it, expect } from 'vitest';
import { buildReactPreview } from '../src/server/runtime/ReactPreview';
import { buildVuePreview } from '../src/server/runtime/VuePreview';
import { PROCESS_ENV_SOURCE } from '../src/server/runtime/previewImportMeta';
import { VirtualFileSystem } from '../src/server/project/ProjectModel';

/**
 * PHASE 1b — the sibling of the `import.meta` bug, found by asking rule 3's question ("the same root
 * cause almost always lives in more than one place") instead of stopping at the first fix.
 *
 * `process` is a NODE global. In a browser it does not exist, so a module reading
 * `process.env.NODE_ENV` throws `ReferenceError: process is not defined` and dies — taking the preview
 * with it, exactly as the import.meta SyntaxError did.
 *
 * It is tempting to file this as a CRA-only concern and therefore rare. It is not: `process.env.NODE_ENV`
 * is one of the most common lines in ordinary React source, gating dev-only logging and checks.
 * Packages from the dependency mirror are already BUILT with it substituted; the user's own code is
 * not — and the user's own code is the entire imported project.
 */

const reactApp = VirtualFileSystem.fromRecord({
  'package.json': JSON.stringify({ dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' } }),
  'index.html': '<div id="root"></div>',
  'src/main.tsx': "if (process.env.NODE_ENV !== 'production') console.log('dev'); export default () => null;",
});

const vueApp = VirtualFileSystem.fromRecord({
  'package.json': JSON.stringify({ dependencies: { vue: '^3.4.0' } }),
  'index.html': '<div id="app"></div>',
  'src/main.js': "import { createApp } from 'vue';",
  'src/App.vue': '<template><b>hi</b></template>',
});

const SHIM_RE = /if \(typeof window\.process === 'undefined'\) \{[\s\S]*?\n {2}\}/;

/** The shim's SOURCE, as the page really carries it. */
function shimSource(html: string): string {
  const m = html.match(SHIM_RE);
  expect(m, 'the generated page must carry a process shim').toBeTruthy();
  return m![0];
}

/** Pull the shim out of a generated page and run it against a window that has no `process`. */
function applyShim(html: string): Record<string, unknown> {
  const win: Record<string, unknown> = {};
  new Function('window', shimSource(html))(win);
  return win.process as Record<string, unknown>;
}

describe('the crash it prevents', () => {
  it('a bare `process` read really does throw where there is no Node global', () => {
    // The bug, stated as a test. A browser has no `process`; this is what the user's module hits.
    expect(() => new Function('"use strict"; return processNotDefinedAnywhere.env;')()).toThrow(ReferenceError);
  });

  it('the React preview defines one', () => {
    expect(applyShim(buildReactPreview(reactApp))).toBeTruthy();
  });

  it('the Vue preview defines the same one — the sibling, not a second opinion', () => {
    // Compared as SOURCE, not as objects: two shims produce distinct function instances, so a deep
    // equality check would fail on identity even when the implementations are character-identical.
    // The source text is also the thing that actually has to match.
    expect(shimSource(buildVuePreview(vueApp))).toBe(shimSource(buildReactPreview(reactApp)));
  });
});

describe('what the shim actually contains', () => {
  const proc = () => applyShim(buildReactPreview(reactApp));

  it('NODE_ENV is development, because that is what this preview genuinely is', () => {
    expect((proc().env as Record<string, string>).NODE_ENV).toBe('development');
  });

  it('a REACT_APP_ variable is undefined — the honest answer, not an invented one', () => {
    // Same reasoning as the VITE_ case: live .env files are excluded at the import boundary on
    // purpose, so `undefined` is both the truth and what the real toolchain gives.
    expect((proc().env as Record<string, string>).REACT_APP_TITLE).toBeUndefined();
  });

  it('the functions are inert rather than absent', () => {
    // Code that reaches for `process` often reaches for these too. An undefined call is a crash; a
    // no-op is merely nothing happening — and there IS no process to exit or stdout to write to.
    const p = proc();
    expect(() => (p.exit as () => void)()).not.toThrow();
    expect((p.cwd as () => string)()).toBe('/');
    expect(p.browser).toBe(true);
  });

  it('an existing process is left completely alone', () => {
    /**
     * The guard that keeps this additive. If a page (or a polyfilled dependency) already provided one,
     * overwriting it would replace a real implementation with our minimal stand-in — turning a fix
     * into a regression for the app that had it right.
     */
    const html = buildReactPreview(reactApp);
    const m = html.match(/if \(typeof window\.process === 'undefined'\) \{[\s\S]*?\n {2}\}/)!;
    const win = { process: { env: { NODE_ENV: 'production' }, mine: true } };
    new Function('window', m[0])(win);
    expect(win.process.mine).toBe(true);
    expect(win.process.env.NODE_ENV).toBe('production');
  });

  it('both pages interpolate the ONE exported constant', () => {
    // Nothing to keep in agreement is stronger than a rule saying they must agree.
    for (const html of [buildReactPreview(reactApp), buildVuePreview(vueApp)]) {
      expect(html).toContain(PROCESS_ENV_SOURCE);
    }
  });
});
