// WHICH FILES REACH THE REPOSITORY — the silent-drop class (autopsy 2026-08-03).
//
// The assembler's filter used to be a WHITELIST of extensions: html/css/js/jsx/ts/tsx/json/md/txt/svg/
// xml/yml/env. Anything unlisted was dropped without a word. That is a whole family of build failures
// whose cause is invisible, because the app compiled perfectly inside NavBharatAI and then failed on the
// runner — the code that ran there was not the code the user wrote:
//   • a component importing './App.scss' → the stylesheet never arrived → "Cannot resolve" → build dies
//   • vite.config.mjs / postcss.config.cjs / tailwind.config.cjs → gone → wrong or unstyled output
//   • .npmrc, .nvmrc, App.vue, queries.graphql → gone
//
// A whitelist has to predict every extension an app might ever use and silently loses whatever it did
// not predict. A blocklist only names what genuinely cannot survive as text, and when it is wrong the
// file is INCLUDED — the safe direction. These tests lock that behaviour in both directions.

import { describe, it, expect } from 'vitest';
import { assembleMobileProject } from './mobileProjectAssembler';

const SHIP = { '.github/workflows/android-apk.yml': 'name: x' };
const OPTS = { appName: 'My App', appId: 'com.test.app' };
const BUILT_PKG = JSON.stringify({ scripts: { build: 'vite build' } });

describe('files the whitelist used to lose', () => {
  it('keeps every real source file of a built app', () => {
    const app: Record<string, string> = {
      'package.json': BUILT_PKG,
      'index.html': '<div id="root"></div>',
      'src/App.tsx': "import './App.scss';",
      'src/App.scss': '.a { color: red }',
      'vite.config.mjs': 'export default {}',
      'postcss.config.cjs': 'module.exports = {}',
      'tailwind.config.cjs': 'module.exports = {}',
      'src/Widget.vue': '<template></template>',
      'src/queries.graphql': 'query {}',
      '.npmrc': 'legacy-peer-deps=true',
      '.nvmrc': '22',
      'netlify.toml': '[build]',
    };
    const out = assembleMobileProject(app, SHIP, OPTS);
    for (const path of Object.keys(app)) {
      if (path === 'package.json') continue; // merged rather than copied — asserted below
      expect(Object.keys(out.files), `${path} was silently dropped`).toContain(path);
    }
  });

  it('a static app keeps its stylesheets and scripts under www/', () => {
    const out = assembleMobileProject({
      'index.html': '<html></html>',
      'style.css': 'body{}',
      'app.mjs': 'export const a = 1;',
    }, SHIP, OPTS);
    expect(out.kind).toBe('static');
    expect(Object.keys(out.files)).toContain('www/style.css');
    expect(Object.keys(out.files)).toContain('www/app.mjs');
  });
});

describe('files that genuinely must not be pushed', () => {
  it('leaves out binaries, secrets and build junk', () => {
    const out = assembleMobileProject({
      'package.json': BUILT_PKG,
      'index.html': '<html></html>',
      'public/logo.png': 'PNG bytes',
      'assets/font.woff2': 'font bytes',
      'release.keystore': 'the user signing key — must never leave their machine',
      'node_modules/react/index.js': 'never',
      '.DS_Store': 'junk',
    }, SHIP, OPTS);
    for (const gone of [
      'public/logo.png', 'assets/font.woff2', 'release.keystore',
      'node_modules/react/index.js', '.DS_Store',
    ]) {
      expect(Object.keys(out.files), `${gone} must not be pushed`).not.toContain(gone);
    }
  });

  it('never pushes a lock file — the workflow install step is built around its absence', () => {
    const out = assembleMobileProject({
      'package.json': BUILT_PKG,
      'package-lock.json': '{"lockfileVersion":3}',
      'index.html': '<html></html>',
    }, SHIP, OPTS);
    expect(Object.keys(out.files)).not.toContain('package-lock.json');
  });

  it('the app’s package.json is still merged, not copied through', () => {
    const out = assembleMobileProject({
      'package.json': JSON.stringify({ scripts: { build: 'vite build' }, dependencies: { react: '^19' } }),
      'index.html': '<html></html>',
    }, SHIP, OPTS);
    const pkg = JSON.parse(out.files['package.json']);
    expect(pkg.dependencies.react).toBe('^19');            // the user's own dependency survives
    expect(pkg.dependencies['@capacitor/core']).toBeTruthy(); // ours is added alongside
    expect(pkg.scripts.build).toBe('vite build');
  });
});
