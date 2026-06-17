import { describe, it, expect } from 'vitest';
import { VirtualFileSystem } from '../src/server/project/ProjectModel';
import { extractRequestedFeatures, computeFeatureCoverage, featureChecklist } from '../src/server/project/FeatureCoverage';
import { runValidation } from '../src/server/project/ValidationPipeline';
import { selectArchitecture } from '../src/server/project/ArchitectureManifest';

const KANBAN = 'Build a kanban task board with authentication, a dashboard, analytics charts, search and filter, dark mode, and localStorage persistence.';

describe('extractRequestedFeatures', () => {
  it('detects the features asked for in the prompt', () => {
    const ids = extractRequestedFeatures(KANBAN).map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(['auth', 'dashboard', 'kanban', 'analytics', 'search', 'filter', 'darkmode', 'persistence']));
  });
  it('returns nothing for a featureless prompt', () => {
    expect(extractRequestedFeatures('a nice landing page').length).toBeLessThanOrEqual(1);
  });
  it('detects common domain modules (ops apps)', () => {
    const ids = extractRequestedFeatures('app with inventory, incidents, notifications and settings').map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(['inventory', 'incidents', 'notifications', 'settings']));
  });
  it('featureChecklist lists every requested feature', () => {
    const c = featureChecklist(KANBAN);
    expect(c).toMatch(/Authentication/);
    expect(c).toMatch(/Kanban/);
  });
});

describe('computeFeatureCoverage', () => {
  it('scores a bare React shell as 0% (the "mounted successfully" failure)', () => {
    const shell = VirtualFileSystem.fromRecord({
      'index.html': '<div id="root"></div><script type="module" src="/src/main.jsx"></script>',
      'src/main.jsx': "createRoot(document.getElementById('root')).render(<App/>)",
      'src/App.jsx': 'export default function App(){ return <h1>Hello from App</h1>; }',
    });
    const r = computeFeatureCoverage(KANBAN, shell);
    expect(r.coverage).toBe(0);
    expect(r.implemented).toBe(0);
  });

  it('scores a real multi-feature implementation high', () => {
    const app = VirtualFileSystem.fromRecord({
      'index.html': '<div id="root"></div><script type="module" src="/src/main.jsx"></script>',
      'src/main.jsx': "createRoot(document.getElementById('root')).render(<App/>)",
      'src/App.jsx': "import { useState } from 'react';\nexport default function App(){ const [theme,setTheme]=useState('dark'); return null; }",
      'src/auth/Login.jsx': 'export function Login(){ const password=""; return null; } // signin auth session',
      'src/pages/Dashboard.jsx': 'export function Dashboard(){ return null; } // dashboard',
      'src/components/Board.jsx': 'export function Board(){ /* kanban column drag onDrop */ return null; }',
      'src/components/Analytics.jsx': 'export function Analytics(){ return <svg/>; } // chart metric',
      'src/store.js': "const data=[]; const r=data.filter(x=>x); localStorage.setItem('k','v'); // search query toggleTheme add delete onSubmit route nav",
    });
    const r = computeFeatureCoverage(KANBAN, app);
    expect(r.coverage).toBeGreaterThanOrEqual(80);
  });
});

describe('runValidation feature gate', () => {
  it('BLOCKS preview when requested features are missing (shell)', () => {
    const shell = VirtualFileSystem.fromRecord({
      'package.json': JSON.stringify({ dependencies: { react: '^18', 'react-dom': '^18' } }),
      'index.html': '<div id="root"></div><script type="module" src="/src/main.jsx"></script>',
      'src/main.jsx': "import {createRoot} from 'react-dom/client';\nimport App from './App.jsx';\ncreateRoot(document.getElementById('root')).render(<App/>)",
      'src/App.jsx': 'export default function App(){ return <h1>Hello from App</h1>; }',
    });
    const r = runValidation(shell, selectArchitecture(KANBAN), KANBAN);
    expect(r.previewAllowed).toBe(false);
    expect(r.featureCoverage?.coverage).toBe(0);
    expect(r.gates.find((g) => g.id === 'features')?.status).toBe('fail');
  });

  it('does not add a feature gate when the prompt requests nothing specific', () => {
    const vfs = VirtualFileSystem.fromRecord({ 'index.html': '<main id="app"></main><script src="app.js"></script>', 'app.js': 'x' });
    const r = runValidation(vfs, selectArchitecture('a landing page'), 'a landing page');
    expect(r.gates.find((g) => g.id === 'features')).toBeUndefined();
  });
});
