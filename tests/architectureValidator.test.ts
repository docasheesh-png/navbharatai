import { describe, it, expect } from 'vitest';
import { VirtualFileSystem } from '../src/server/project/ProjectModel';
import { validateArchitecture, isReactApp } from '../src/server/project/ArchitectureValidator';
import { selectArchitecture, manifestContract, forbiddenPathPatterns } from '../src/server/project/ArchitectureManifest';
import { verifyProject } from '../src/server/project/ProjectVerifier';

const vfsFrom = (f: Record<string, string>) => VirtualFileSystem.fromRecord(f);

const PKG = JSON.stringify({ dependencies: { react: '^18', 'react-dom': '^18' } });

describe('selectArchitecture', () => {
  it('locks a single React architecture for app-like prompts', () => {
    const m = selectArchitecture('a react kanban task board with multiple pages');
    expect(m.framework).toBe('react');
    expect(m.mountId).toBe('root');
    expect(m.entry).toBe('src/main.jsx');
    expect(manifestContract(m)).toMatch(/do not mix/i);
  });
  it('forbids the vanilla js/ layer in a React manifest', () => {
    const pats = forbiddenPathPatterns(selectArchitecture('react app'));
    expect(pats.some((p) => p.test('js/router.js'))).toBe(true);
    // pages/*.js is NOT blanket-forbidden (React projects may have .js helpers)
    expect(pats.some((p) => p.test('pages/Home.jsx'))).toBe(false);
  });

  it('selects Vue 3 architecture for explicit Vue prompts', () => {
    const m = selectArchitecture('build a vue 3 dashboard with pinia');
    expect(m.framework).toBe('vue');
    expect(m.bundler).toBe('vite');
    expect(m.mountId).toBe('app');
    expect(m.entry).toBe('src/main.js');
    expect(manifestContract(m)).toMatch(/Vue 3/);
    expect(manifestContract(m)).toMatch(/do not mix/i);
  });
  it('forbids JSX/TSX and vanilla js/ in a Vue manifest', () => {
    const pats = forbiddenPathPatterns(selectArchitecture('vue app'));
    expect(pats.some((p) => p.test('App.tsx'))).toBe(true);
    expect(pats.some((p) => p.test('js/helpers.js'))).toBe(true);
    expect(pats.some((p) => p.test('src/App.vue'))).toBe(false);
  });

  it('selects Svelte 4 architecture for explicit Svelte prompts', () => {
    const m = selectArchitecture('build a svelte todo app');
    expect(m.framework).toBe('svelte');
    expect(m.bundler).toBe('vite');
    expect(m.mountId).toBe('app');
    expect(m.entry).toBe('src/main.js');
    expect(manifestContract(m)).toMatch(/Svelte 4/);
    expect(manifestContract(m)).toMatch(/do not mix/i);
    expect(manifestContract(m)).toMatch(/\.svelte/);
  });
  it('forbids JSX/TSX and .vue in a Svelte manifest', () => {
    const pats = forbiddenPathPatterns(selectArchitecture('svelte app'));
    expect(pats.some((p) => p.test('App.tsx'))).toBe(true);
    expect(pats.some((p) => p.test('App.vue'))).toBe(true);
    expect(pats.some((p) => p.test('src/App.svelte'))).toBe(false);
  });
  it('Svelte prompt does NOT get misidentified as Vue or React', () => {
    const m = selectArchitecture('sveltekit blog with components');
    expect(m.framework).toBe('svelte');
  });
  it('selects vanilla for plain/static prompts', () => {
    const m = selectArchitecture('a plain landing page');
    expect(m.framework).toBe('vanilla');
    expect(m.bundler).toBe('none');
    expect(manifestContract(m)).toMatch(/Vanilla JavaScript/);
  });
});

describe('no false positives (rock-solid for legitimate apps)', () => {
  it('accepts a relative "./src/main.jsx" entry reference', () => {
    const vfs = vfsFrom({
      'package.json': PKG,
      'index.html': '<div id="root"></div>\n<script type="module" src="./src/main.jsx"></script>',
      'src/main.jsx': "createRoot(document.getElementById('root')).render(<App/>);",
      'src/App.jsx': 'export default ()=>null',
    });
    expect(validateArchitecture(vfs)).toEqual([]);
  });

  it('accepts a React app that has benign pages/*.jsx and helper .js files', () => {
    const vfs = vfsFrom({
      'package.json': PKG,
      'index.html': '<div id="root"></div>\n<script type="module" src="/src/main.jsx"></script>',
      'src/main.jsx': "createRoot(document.getElementById('root')).render(<App/>);",
      'src/App.jsx': 'export default ()=>null',
      'src/pages/Home.jsx': 'export default ()=>null',
      'src/utils/format.js': 'export const f = () => 1;',
    });
    expect(validateArchitecture(vfs)).toEqual([]);
  });

  it('accepts a React app loading external CDN scripts (not flagged as legacy)', () => {
    const vfs = vfsFrom({
      'package.json': PKG,
      'index.html': '<script src="https://cdn.example.com/x.js"></script>\n<div id="root"></div>\n<script type="module" src="/src/main.jsx"></script>',
      'src/main.jsx': "createRoot(document.querySelector('#root')).render(<App/>);",
      'src/App.jsx': 'export default ()=>null',
    });
    expect(validateArchitecture(vfs)).toEqual([]);
  });
});

describe('validateArchitecture — the React #299 failure class', () => {
  it('flags the exact observed failure: #app vs createRoot(#root) + mixed legacy JS', () => {
    const vfs = vfsFrom({
      'package.json': PKG,
      'index.html': '<div id="app"></div>\n<script type="module" src="/src/main.jsx"></script>\n<script src="js/router.js"></script>',
      'src/main.jsx': "import {createRoot} from 'react-dom/client';\ncreateRoot(document.getElementById('root')).render(null);",
      'src/App.jsx': 'export default ()=>null',
      'js/router.js': 'window.route = () => {}',
      'pages/dashboard.js': '// legacy',
    });
    const issues = validateArchitecture(vfs);
    const msgs = issues.map((i) => i.message).join(' | ');
    expect(issues.length).toBeGreaterThan(0);
    expect(msgs).toMatch(/mount mismatch.*root|#root/i);   // #app vs #root
    expect(msgs).toMatch(/Mixed architecture/i);            // js/ + pages/ + legacy script
    expect(issues.every((i) => i.severity === 'error')).toBe(true);
  });

  it('passes a clean, conformant React app', () => {
    const vfs = vfsFrom({
      'package.json': PKG,
      'index.html': '<div id="root"></div>\n<script type="module" src="/src/main.jsx"></script>',
      'src/main.jsx': "import {createRoot} from 'react-dom/client';\nimport App from './App.jsx';\ncreateRoot(document.getElementById('root')).render(<App/>);",
      'src/App.jsx': 'export default function App(){return null;}',
    });
    expect(validateArchitecture(vfs)).toEqual([]);
  });

  it('flags a missing module entry / duplicate mount nodes', () => {
    const noEntry = vfsFrom({
      'package.json': PKG,
      'index.html': '<div id="root"></div>',
      'src/main.jsx': "createRoot(document.getElementById('root'))",
    });
    expect(validateArchitecture(noEntry).some((i) => /Missing React entry/i.test(i.message))).toBe(true);

    const dup = vfsFrom({
      'package.json': PKG,
      'index.html': '<div id="root"></div><div id="root"></div>\n<script type="module" src="/src/main.jsx"></script>',
      'src/main.jsx': "createRoot(document.getElementById('root'))",
    });
    expect(validateArchitecture(dup).some((i) => /Duplicate mount/i.test(i.message))).toBe(true);
  });

  it('does not flag a plain vanilla (non-React) project', () => {
    const vfs = vfsFrom({ 'index.html': '<main id="app"></main><script src="app.js"></script>', 'app.js': 'x' });
    expect(isReactApp(vfs)).toBe(false);
    expect(validateArchitecture(vfs)).toEqual([]);
  });
});

describe('verifyProject integration', () => {
  it('marks a mixed-architecture build as FAILED (ok=false)', () => {
    const r = verifyProject(vfsFrom({
      'package.json': PKG,
      'index.html': '<div id="app"></div>\n<script type="module" src="/src/main.jsx"></script>',
      'src/main.jsx': "createRoot(document.getElementById('root'))",
      'src/App.jsx': 'export default ()=>null',
    }));
    expect(r.ok).toBe(false);
    expect(r.errors).toBeGreaterThan(0);
    expect(r.issues.some((i) => /mount mismatch/i.test(i.message))).toBe(true);
  });
});
