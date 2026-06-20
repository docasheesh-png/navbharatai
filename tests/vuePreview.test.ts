import { describe, it, expect } from 'vitest';
import { VirtualFileSystem } from '../src/server/project/ProjectModel';
import { buildVuePreview, isVueProject } from '../src/server/runtime/VuePreview';

const vfsFrom = (f: Record<string, string>) => VirtualFileSystem.fromRecord(f);

const vueApp = () => vfsFrom({
  'package.json': JSON.stringify({ dependencies: { vue: '^3.4.0', 'vue-router': '^4' } }),
  'index.html': '<div id="app"></div><script type="module" src="/src/main.js"></script>',
  'src/main.js': "import { createApp } from 'vue';\nimport App from './App.vue';\nimport './style.css';\ncreateApp(App).mount('#app');",
  'src/App.vue': '<template><h1>Hi</h1></template>\n<script setup></script>',
  'src/style.css': 'body{margin:0}',
});

describe('isVueProject', () => {
  it('detects a vue dependency or a .vue file', () => {
    expect(isVueProject(vfsFrom({ 'package.json': '{"dependencies":{"vue":"^3"}}' }))).toBe(true);
    expect(isVueProject(vfsFrom({ 'src/App.vue': '<template/>' }))).toBe(true);
    expect(isVueProject(vfsFrom({ 'index.html': '<div></div>' }))).toBe(false);
  });
});

describe('buildVuePreview', () => {
  it('produces a self-contained doc that loads Vue + sfc-loader and embeds the SFCs', () => {
    const html = buildVuePreview(vueApp());
    expect(html).toContain('vue3-sfc-loader');
    expect(html).toContain('vue.runtime.global');
    expect(html).toContain('id="app"');           // mount node matches
    expect(html).toContain('loadModule');
    // the project's own modules are embedded for in-browser resolution
    expect(html).toContain('App.vue');
    expect(html).toContain('src/main.js');
    // bare deps (vue-router) get an esm.sh url sharing the same vue instance
    expect(html).toContain('esm.sh/vue-router');
    expect(html).toContain('deps=vue@3');
  });

  it('uses the index.html mount id (not hardcoded) and falls back honestly with no entry', () => {
    const noEntry = buildVuePreview(vfsFrom({ 'src/Foo.vue': '<template/>' }));
    expect(noEntry).toContain('No Vue entry module found');
  });
});
