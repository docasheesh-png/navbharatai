import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { generateGameAssetRuntime } from './GameAssetRuntimeGenerator';
import { generateGame3D } from './Game3DGenerator';

describe('optional L3 runtime source', () => {
  it('produces compilable TypeScript with owned URLs, hash checking and animation updates', () => {
    const source = generateGameAssetRuntime();
    const result = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, reportDiagnostics: true });
    expect(result.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error)).toEqual([]);
    expect(source).toContain('crypto.subtle.digest');
    expect(source).toContain('mixer?.update');
    expect(source).toContain('return fallback()');
    expect(source).toContain('root.removeFromParent()');
    expect(source).not.toContain('https://');
  });
  it('leaves the current L1/L2 kit unchanged until the acquisition integration is verified', () => {
    const kit = generateGame3D();
    expect(kit.files['src/game/three/objects.ts']).toContain('createCar');
    expect(kit.files['src/game/three/humanoid.ts']).toContain('createHumanoid');
    expect(Object.keys(kit.files)).not.toContain('src/game/three/externalAssets.ts');
  });
});
