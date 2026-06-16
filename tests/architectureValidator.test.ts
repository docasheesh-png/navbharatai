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
  it('forbids vanilla layers in a React manifest', () => {
    const pats = forbiddenPathPatterns(selectArchitecture('react app'));
    expect(pats.some((p) => p.test('js/router.js'))).toBe(true);
    expect(pats.some((p) => p.test('pages/home.js'))).toBe(true);
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
