import { describe, it, expect } from 'vitest';
import { VirtualFileSystem } from '../src/server/project/ProjectModel';
import { runValidation, renderReportCard } from '../src/server/project/ValidationPipeline';
import { selectArchitecture } from '../src/server/project/ArchitectureManifest';

const PKG = JSON.stringify({ dependencies: { react: '^18', 'react-dom': '^18' } });
const cleanReact = () => VirtualFileSystem.fromRecord({
  'package.json': PKG,
  'index.html': '<div id="root"></div>\n<script type="module" src="/src/main.jsx"></script>',
  'src/main.jsx': "import {createRoot} from 'react-dom/client';\nimport App from './App.jsx';\ncreateRoot(document.getElementById('root')).render(<App/>);",
  'src/App.jsx': 'export default function App(){return null;}',
});

describe('runValidation', () => {
  it('allows preview when critical gates pass, but caps score (infra gates pending, never faked)', () => {
    const r = runValidation(cleanReact(), selectArchitecture('react app'));
    expect(r.previewAllowed).toBe(true);
    expect(r.status).toBe('PARTIAL');               // pending infra gates → not fully PASSED
    expect(r.qualityScore).toBeLessThan(100);        // honest: can't be 100 without build/runtime/tests
    expect(r.gates.find(g => g.id === 'build')?.status).toBe('pending');
    expect(r.gates.find(g => g.id === 'architecture')?.status).toBe('pass');
  });

  it('BLOCKS preview on the React #299 / mixed-architecture failure', () => {
    const vfs = VirtualFileSystem.fromRecord({
      'package.json': PKG,
      'index.html': '<div id="app"></div>\n<script type="module" src="/src/main.jsx"></script>\n<script src="js/router.js"></script>',
      'src/main.jsx': "createRoot(document.getElementById('root'))",
      'src/App.jsx': 'export default ()=>null',
      'js/router.js': '//legacy',
    });
    const r = runValidation(vfs, selectArchitecture('react app'));
    expect(r.previewAllowed).toBe(false);
    expect(r.status).toBe('FAILED');
    expect(r.blockingReasons.length).toBeGreaterThan(0);
    expect(r.gates.find(g => g.id === 'architecture')?.status).toBe('fail');
  });

  it('renderReportCard produces a structured, no-fake-success card', () => {
    const card = renderReportCard(runValidation(cleanReact(), selectArchitecture('react app')), selectArchitecture('react app'));
    expect(card).toMatch(/Build Status:/);
    expect(card).toMatch(/Quality Score: \d+\/100/);
    expect(card).toMatch(/PENDING \(infra\)/);       // honest about not-run gates
  });

  it('blocks preview when a static error (broken import) exists', () => {
    const vfs = VirtualFileSystem.fromRecord({
      'index.html': '<div id="root"></div>\n<script type="module" src="/src/main.jsx"></script>',
      'package.json': PKG,
      'src/main.jsx': "import X from './missing';\ncreateRoot(document.getElementById('root'))",
      'src/App.jsx': 'export default ()=>null',
    });
    const r = runValidation(vfs, selectArchitecture('react app'));
    expect(r.previewAllowed).toBe(false);
    expect(r.gates.find(g => g.id === 'static')?.status).toBe('fail');
  });
});
