import { describe, it, expect } from 'vitest';
import { VirtualFileSystem } from '../src/server/project/ProjectModel';
import { selectArchitecture, manifestContract, forbiddenPathPatterns } from '../src/server/project/ArchitectureManifest';
import { detectFramework, scaffold, scaffoldSummary } from '../src/server/project/Scaffold';
import { validateArchitecture, isSvelteApp } from '../src/server/project/ArchitectureValidator';
import { verifyProject } from '../src/server/project/ProjectVerifier';

const vfsFrom = (f: Record<string, string>) => VirtualFileSystem.fromRecord(f);

describe('Svelte architecture — selection', () => {
  it('selectArchitecture picks Svelte for explicit Svelte prompts', () => {
    const m = selectArchitecture('build a svelte 4 counter app');
    expect(m.framework).toBe('svelte');
    expect(m.bundler).toBe('vite');
    expect(m.entry).toBe('src/main.js');
    expect(m.mountId).toBe('app');
    expect(m.language).toBe('javascript');
  });

  it('does NOT pick Svelte for a React prompt', () => {
    expect(selectArchitecture('a react todo app').framework).toBe('react');
  });

  it('does NOT pick Svelte for a Vue prompt', () => {
    expect(selectArchitecture('a vue dashboard').framework).toBe('vue');
  });

  it('manifestContract for Svelte mandates .svelte SFCs + Svelte 4 syntax', () => {
    const c = manifestContract(selectArchitecture('a svelte app'));
    expect(c).toMatch(/Svelte 4/);
    expect(c).toMatch(/\.svelte/);
    expect(c).toMatch(/do not mix/i);
    // Must not suggest React or Vue patterns
    expect(c).not.toMatch(/createRoot/);
    expect(c).not.toMatch(/createApp/);
  });

  it('forbids .jsx, .tsx, and .vue in a Svelte manifest', () => {
    const pats = forbiddenPathPatterns(selectArchitecture('a svelte app'));
    expect(pats.some((p) => p.test('src/App.jsx'))).toBe(true);
    expect(pats.some((p) => p.test('src/App.tsx'))).toBe(true);
    expect(pats.some((p) => p.test('src/Widget.vue'))).toBe(true);
    expect(pats.some((p) => p.test('src/App.svelte'))).toBe(false);
  });
});

describe('Svelte architecture — scaffold', () => {
  it('detectFramework picks vite-svelte for explicit Svelte prompts', () => {
    expect(detectFramework('build a svelte todo app')).toBe('vite-svelte');
    expect(detectFramework('create a sveltekit blog')).toBe('vite-svelte');
  });

  it('scaffold produces a runnable vite-svelte skeleton', () => {
    const vfs = VirtualFileSystem.fromRecord({});
    scaffold(vfs, 'vite-svelte');
    const pkg = JSON.parse(vfs.readText('package.json')!);
    expect(pkg.dependencies?.svelte).toMatch(/\^4/);
    expect(pkg.devDependencies?.['@sveltejs/vite-plugin-svelte']).toMatch(/\^3/);
    expect(vfs.has('src/main.js')).toBe(true);
    expect(vfs.has('src/App.svelte')).toBe(true);
    expect(vfs.has('vite.config.js')).toBe(true);
    const viteConfig = vfs.readText('vite.config.js')!;
    expect(viteConfig).toMatch(/@sveltejs\/vite-plugin-svelte/);
  });

  it('scaffoldSummary describes Svelte', () => {
    expect(scaffoldSummary('vite-svelte')).toMatch(/svelte/i);
  });
});

describe('Svelte architecture — validation', () => {
  it('isSvelteApp detects a svelte dependency or a .svelte file', () => {
    expect(isSvelteApp(vfsFrom({ 'package.json': JSON.stringify({ dependencies: { svelte: '^4' } }) }))).toBe(true);
    expect(isSvelteApp(vfsFrom({ 'src/App.svelte': '<script>let x=1</script>' }))).toBe(true);
    expect(isSvelteApp(vfsFrom({ 'index.html': '<div></div>' }))).toBe(false);
  });

  it('passes a clean, conformant Svelte app', () => {
    const vfs = vfsFrom({
      'package.json': JSON.stringify({ dependencies: { svelte: '^4.2.19' } }),
      'index.html': '<div id="app"></div><script type="module" src="/src/main.js"></script>',
      'src/main.js': "import App from './App.svelte';\nnew App({ target: document.getElementById('app') });",
      'src/App.svelte': '<script>let count = 0;</script><button on:click={() => count++}>{count}</button>',
    });
    expect(validateArchitecture(vfs).length).toBe(0);
  });

  it('flags a React JSX file mixed into a Svelte app', () => {
    const vfs = vfsFrom({
      'package.json': JSON.stringify({ dependencies: { svelte: '^4' } }),
      'index.html': '<div id="app"></div><script type="module" src="/src/main.js"></script>',
      'src/main.js': "import App from './App.svelte';\nnew App({ target: document.getElementById('app') });",
      'src/App.svelte': '<h1>Hi</h1>',
      'src/Leaked.jsx': 'export default () => null;',
    });
    const issues = validateArchitecture(vfs);
    expect(issues.some((i) => /Mixed architecture/i.test(i.message) && /Leaked\.jsx/.test(i.message))).toBe(true);
  });

  it('flags a Vue SFC mixed into a Svelte app', () => {
    const vfs = vfsFrom({
      'package.json': JSON.stringify({ dependencies: { svelte: '^4' } }),
      'index.html': '<div id="app"></div><script type="module" src="/src/main.js"></script>',
      'src/main.js': "import App from './App.svelte';\nnew App({ target: document.getElementById('app') });",
      'src/App.svelte': '<h1>Hi</h1>',
      'src/Widget.vue': '<template><p>Vue</p></template>',
    });
    const issues = validateArchitecture(vfs);
    expect(issues.some((i) => /Mixed architecture/i.test(i.message) && /Widget\.vue/.test(i.message))).toBe(true);
  });

  it('flags a missing index.html in a Svelte app', () => {
    const vfs = vfsFrom({
      'package.json': JSON.stringify({ dependencies: { svelte: '^4' } }),
      'src/App.svelte': '<h1>Hi</h1>',
    });
    const issues = validateArchitecture(vfs);
    expect(issues.some((i) => /no index\.html/i.test(i.message))).toBe(true);
  });

  it('flags a legacy non-module script in a Svelte app', () => {
    const vfs = vfsFrom({
      'package.json': JSON.stringify({ dependencies: { svelte: '^4' } }),
      'index.html': '<div id="app"></div><script src="old.js"></script><script type="module" src="/src/main.js"></script>',
      'src/App.svelte': '<h1>Hi</h1>',
    });
    const issues = validateArchitecture(vfs);
    expect(issues.some((i) => /Mixed architecture/i.test(i.message) && /old\.js/.test(i.message))).toBe(true);
  });

  it('verifyProject passes a clean Svelte project end-to-end', () => {
    const vfs = vfsFrom({
      'package.json': JSON.stringify({ dependencies: { svelte: '^4.2.19' } }),
      'index.html': '<div id="app"></div><script type="module" src="/src/main.js"></script>',
      'src/main.js': "import App from './App.svelte';\nnew App({ target: document.getElementById('app') });",
      'src/App.svelte': '<script>let count = 0;</script><button>{count}</button>',
    });
    const r = verifyProject(vfs);
    expect(r.errors).toBe(0);
  });
});
