import { describe, it, expect } from 'vitest';
import { BuildManifestGenerator } from '../src/server/BuildEngine/BuildManifestGenerator';
import type { Feature } from '../src/server/BuildEngine/types';

function feature(id: string, components: string[] = [], logicHandlers: string[] = []): Feature {
  return {
    id,
    dependencies: [],
    capabilities: [],
    components,
    logicHandlers: logicHandlers.map(c => ({ category: c, inputs: {}, outputs: {} })),
  };
}

describe('BuildManifestGenerator.generate', () => {
  const gen = new BuildManifestGenerator();

  it('sets projectType from the argument', () => {
    const m = gen.generate('react-spa', []);
    expect(m.projectType).toBe('react-spa');
  });

  it('always includes src/App.tsx and src/index.css', () => {
    const m = gen.generate('react-spa', []);
    expect(m.filesToGenerate).toContain('src/App.tsx');
    expect(m.filesToGenerate).toContain('src/index.css');
  });

  it('adds server.ts when api-routes feature is present', () => {
    const m = gen.generate('react-spa', [feature('api-routes')]);
    expect(m.filesToGenerate).toContain('src/server/server.ts');
  });

  it('does NOT add server.ts when api-routes feature is absent', () => {
    const m = gen.generate('react-spa', [feature('auth')]);
    expect(m.filesToGenerate).not.toContain('src/server/server.ts');
  });

  it('collects unique components from all features', () => {
    const f1 = feature('f1', ['Button', 'Input']);
    const f2 = feature('f2', ['Input', 'Card']);
    const m = gen.generate('react-spa', [f1, f2]);
    expect(m.components).toEqual(expect.arrayContaining(['Button', 'Input', 'Card']));
    expect(m.components.filter(c => c === 'Input')).toHaveLength(1);
  });

  it('collects unique logicHandler categories', () => {
    const f1 = feature('f1', [], ['formHandler', 'authHandler']);
    const f2 = feature('f2', [], ['formHandler']);
    const m = gen.generate('react-spa', [f1, f2]);
    expect(m.logicHandlers.filter(h => h === 'formHandler')).toHaveLength(1);
  });

  it('always includes react and tailwindcss in dependencies', () => {
    const m = gen.generate('react-spa', []);
    expect(m.dependencies).toContain('react');
    expect(m.dependencies).toContain('tailwindcss');
  });

  it('returns empty features/components/logicHandlers for empty input', () => {
    const m = gen.generate('vanilla', []);
    expect(m.features).toHaveLength(0);
    expect(m.components).toHaveLength(0);
    expect(m.logicHandlers).toHaveLength(0);
  });
});
