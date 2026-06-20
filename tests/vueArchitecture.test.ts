import { describe, it, expect } from 'vitest';
import { VirtualFileSystem } from '../src/server/project/ProjectModel';
import { selectArchitecture, manifestContract, forbiddenPathPatterns } from '../src/server/project/ArchitectureManifest';
import { detectFramework, scaffold, scaffoldSummary } from '../src/server/project/Scaffold';
import { validateArchitecture, isVueApp } from '../src/server/project/ArchitectureValidator';
import { verifyProject } from '../src/server/project/ProjectVerifier';

const vfsFrom = (f: Record<string, string>) => VirtualFileSystem.fromRecord(f);

describe('Vue architecture — selection', () => {
  it('selectArchitecture picks Vue for explicit Vue prompts (even with "dashboard")', () => {
    const m = selectArchitecture('a vue dashboard with multiple pages and pinia');
    expect(m.framework).toBe('vue');
    expect(m.bundler).toBe('vite');
    expect(m.entry).toBe('src/main.js');
    expect(m.mountId).toBe('app');
    expect(m.routing).toBe('vue-router');
    expect(m.state).toBe('pinia');
  });

  it('does NOT pick Vue for a plain React prompt', () => {
    expect(selectArchitecture('a react todo app').framework).toBe('react');
  });

  it('manifestContract for Vue mandates SFCs + single #app mount + main.js', () => {
    const c = manifestContract(selectArchitecture('a vue app'));
    expect(c).toMatch(/Vue 3 \+ Vite/);
    expect(c).toMatch(/\.vue/);
    expect(c).toMatch(/id="app"/);
    expect(c).toMatch(/createApp\(App\)\.mount\('#app'\)/);
  });

  it('forbids React/JSX inside a Vue manifest', () => {
    const pats = forbiddenPathPatterns(selectArchitecture('a vue app'));
    expect(pats.some((p) => p.test('src/App.jsx'))).toBe(true);
    expect(pats.some((p) => p.test('src/components/Foo.tsx'))).toBe(true);
  });
});

describe('Vue architecture — scaffold', () => {
  it('detectFramework picks vite-vue for explicit Vue prompts', () => {
    expect(detectFramework('a vue 3 expense tracker')).toBe('vite-vue');
    expect(detectFramework('build a vuejs app with vue-router')).toBe('vite-vue');
  });

  it('seeds a runnable, conformant vite-vue skeleton', () => {
    const vfs = vfsFrom({});
    expect(scaffold(vfs, 'vite-vue')).toBe('vite-vue');
    expect(vfs.has('src/App.vue')).toBe(true);
    expect(vfs.readText('src/main.js')).toMatch(/createApp\(App\)\.mount\('#app'\)/);
    expect(vfs.readText('index.html')).toMatch(/<div id="app">/);
    expect(scaffoldSummary('vite-vue')).toMatch(/Vue 3/);
    // The seeded skeleton must verify clean (no dangling refs / mount mismatch).
    expect(verifyProject(vfs).ok).toBe(true);
  });
});

describe('Vue architecture — validation', () => {
  it('isVueApp detects a vue dependency or a .vue file', () => {
    expect(isVueApp(vfsFrom({ 'package.json': JSON.stringify({ dependencies: { vue: '^3' } }) }))).toBe(true);
    expect(isVueApp(vfsFrom({ 'src/App.vue': '<template></template>' }))).toBe(true);
    expect(isVueApp(vfsFrom({ 'index.html': '<div></div>' }))).toBe(false);
  });

  it('passes a clean, conformant Vue app', () => {
    const vfs = vfsFrom({
      'package.json': JSON.stringify({ dependencies: { vue: '^3.4.0' } }),
      'index.html': '<div id="app"></div><script type="module" src="/src/main.js"></script>',
      'src/main.js': "import { createApp } from 'vue';\nimport App from './App.vue';\ncreateApp(App).mount('#app');",
      'src/App.vue': '<template><h1>Hi</h1></template>',
    });
    expect(validateArchitecture(vfs).length).toBe(0);
  });

  it('flags a Vue mount mismatch (createApp.mount(#app) vs no #app node)', () => {
    const vfs = vfsFrom({
      'package.json': JSON.stringify({ dependencies: { vue: '^3' } }),
      'index.html': '<div id="root"></div><script type="module" src="/src/main.js"></script>',
      'src/main.js': "import { createApp } from 'vue';\nimport App from './App.vue';\ncreateApp(App).mount('#app');",
      'src/App.vue': '<template><h1>Hi</h1></template>',
    });
    const issues = validateArchitecture(vfs);
    expect(issues.some((i) => /mount mismatch/i.test(i.message))).toBe(true);
  });

  it('flags React (JSX) mixed into a Vue app', () => {
    const vfs = vfsFrom({
      'package.json': JSON.stringify({ dependencies: { vue: '^3' } }),
      'index.html': '<div id="app"></div><script type="module" src="/src/main.js"></script>',
      'src/main.js': "import { createApp } from 'vue';\nimport App from './App.vue';\ncreateApp(App).mount('#app');",
      'src/App.vue': '<template><h1>Hi</h1></template>',
      'src/Legacy.jsx': 'export default () => null;',
    });
    const issues = validateArchitecture(vfs);
    expect(issues.some((i) => /Mixed architecture/i.test(i.message) && /Legacy\.jsx/.test(i.message))).toBe(true);
  });
});
