import { describe, it, expect } from 'vitest';
import { BuildManifestGenerator } from '../src/server/BuildEngine/BuildManifestGenerator';
import type { Feature } from '../src/server/BuildEngine/types';

function makeFeature(id: string, components: string[] = [], logicCategories: string[] = []): Feature {
  return {
    id,
    dependencies: [],
    capabilities: [],
    components,
    logicHandlers: logicCategories.map(cat => ({ category: cat, inputs: {}, outputs: {} })),
  };
}

describe('BuildManifestGenerator', () => {
  it('generates a manifest with the given projectType', () => {
    const gen = new BuildManifestGenerator();
    const manifest = gen.generate('react-spa', []);
    expect(manifest.projectType).toBe('react-spa');
  });

  it('always includes App.tsx and index.css in filesToGenerate', () => {
    const gen = new BuildManifestGenerator();
    const manifest = gen.generate('react-spa', []);
    expect(manifest.filesToGenerate).toContain('src/App.tsx');
    expect(manifest.filesToGenerate).toContain('src/index.css');
  });

  it('adds server.ts when api-routes feature is included', () => {
    const gen = new BuildManifestGenerator();
    const manifest = gen.generate('full-stack', [makeFeature('api-routes')]);
    expect(manifest.filesToGenerate).toContain('src/server/server.ts');
  });

  it('collects unique components from features', () => {
    const gen = new BuildManifestGenerator();
    const manifest = gen.generate('react-spa', [
      makeFeature('ui', ['Button', 'Card']),
      makeFeature('auth', ['Button']),  // Button duplicated
    ]);
    expect(manifest.components.filter(c => c === 'Button')).toHaveLength(1);
    expect(manifest.components).toContain('Card');
  });

  it('collects logic handler categories from features', () => {
    const gen = new BuildManifestGenerator();
    const manifest = gen.generate('react-spa', [makeFeature('data', [], ['database', 'cache'])]);
    expect(manifest.logicHandlers).toContain('database');
    expect(manifest.logicHandlers).toContain('cache');
  });
});
