import { describe, it, expect } from 'vitest';
import { buildArchitectureMap, renderArchitectureMap } from './architectureMap';
import type { ProjectGraph } from './WorkspaceMemory';

// A2: agent-orientation map from the import graph. Pure — assert entry points, hubs, areas, rendering.

const graph: ProjectGraph = {
  files: [
    'src/main.tsx', 'src/App.tsx', 'src/pages/Home.tsx', 'src/pages/About.tsx',
    'src/components/Button.tsx', 'src/components/Card.tsx', 'src/lib/api.ts', 'style.css',
  ],
  symbols: [],
  components: ['App', 'Home', 'About', 'Button', 'Card'],
  routes: ['/', '/about'],
  imports: {
    'src/main.tsx': ['./App'],
    'src/App.tsx': ['./pages/Home', './pages/About', './lib/api'],
    'src/pages/Home.tsx': ['./../components/Button', './../lib/api'],
    'src/pages/About.tsx': ['../components/Button', '../components/Card'],
    'src/components/Button.tsx': ['../lib/api'],
    'src/components/Card.tsx': [],
    'src/lib/api.ts': ['axios'],
  },
  dependencies: ['axios', 'react'],
};

describe('buildArchitectureMap', () => {
  const map = buildArchitectureMap(graph);

  it('counts only code files, plus components and routes', () => {
    expect(map.totalFiles).toBe(7); // style.css excluded
    expect(map.totalComponents).toBe(5);
    expect(map.totalRoutes).toBe(2);
  });

  it('reports the entry point (nothing imports main.tsx) and ranks entry-named roots first', () => {
    expect(map.entryPoints[0]).toBe('src/main.tsx');
  });

  it('ranks the most-imported files as hubs', () => {
    // api.ts is imported by App, Home, Button (3); Button by Home + About (2).
    expect(map.hubs[0].file).toBe('src/lib/api.ts');
    expect(map.hubs[0].importedBy).toBe(3);
    const button = map.hubs.find(h => h.file === 'src/components/Button.tsx')!;
    expect(button.importedBy).toBe(2);
  });

  it('groups files into structural areas by directory, largest first', () => {
    const dirs = map.areas.map(a => a.dir);
    expect(dirs).toContain('src/components');
    expect(dirs).toContain('src/pages');
    // src has main.tsx + App.tsx at depth 2 → area "src"
    const total = map.areas.reduce((n, a) => n + a.fileCount, 0);
    expect(total).toBe(map.totalFiles);
  });

  it('lists external dependencies (sorted, capped)', () => {
    expect(map.externalDeps).toEqual(['axios', 'react']);
  });
});

describe('renderArchitectureMap', () => {
  it('renders a concise orientation with a reading order', () => {
    const text = renderArchitectureMap(buildArchitectureMap(graph));
    expect(text).toContain('Entry points: src/main.tsx');
    expect(text).toContain('Core modules');
    expect(text).toContain('src/lib/api.ts (3)');
    expect(text).toContain('Suggested reading order');
  });

  it('is honest when nothing is indexed', () => {
    const empty: ProjectGraph = { files: [], symbols: [], components: [], routes: [], imports: {}, dependencies: [] };
    expect(renderArchitectureMap(buildArchitectureMap(empty))).toContain('nothing to map');
  });
});
