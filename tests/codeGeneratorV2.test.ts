import { describe, it, expect } from 'vitest';
import { CodeGeneratorV2 } from '../src/server/BuildEngine/CodeGenerator';
import type { BuildManifest } from '../src/server/BuildEngine/types';

function manifest(filesToGenerate: string[]): BuildManifest {
  return { projectType: 'react-spa', features: [], components: [], logicHandlers: [], filesToGenerate, dependencies: [] };
}

describe('CodeGeneratorV2.generate', () => {
  const gen = new CodeGeneratorV2();

  it('returns one GeneratedFile per path in manifest.filesToGenerate', () => {
    const files = gen.generate(manifest(['src/App.tsx', 'src/main.tsx']));
    expect(files).toHaveLength(2);
  });

  it('each GeneratedFile has the correct path', () => {
    const files = gen.generate(manifest(['src/App.tsx']));
    expect(files[0].path).toBe('src/App.tsx');
  });

  it('unknown file path gets default comment content', () => {
    const files = gen.generate(manifest(['src/SomethingNew.tsx']));
    expect(files[0].content).toContain('// Generated manifest-driven file');
    expect(files[0].content).toContain('src/SomethingNew.tsx');
  });

  it('returns Product interface for src/server/models/Product.ts', () => {
    const files = gen.generate(manifest(['src/server/models/Product.ts']));
    expect(files[0].content).toContain('interface Product');
  });

  it('returns a table component for src/components/ProductTable.tsx', () => {
    const files = gen.generate(manifest(['src/components/ProductTable.tsx']));
    expect(files[0].content).toContain('ProductTable');
    expect(files[0].content).toContain('table');
  });

  it('returns empty array for empty filesToGenerate', () => {
    expect(gen.generate(manifest([]))).toHaveLength(0);
  });
});
