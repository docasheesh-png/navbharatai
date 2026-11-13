import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GAME_RECIPES, recipeDependenciesNeeded, recipeDependencyVersions, type RecipeOutput,
} from '../src/server/lib/gameRecipeLayers';

const registry = GAME_RECIPES as Record<string, (include?: string[]) => RecipeOutput>;
const originalEntries = Object.entries(registry);

afterEach(() => {
  vi.restoreAllMocks();
  for (const name of Object.keys(registry)) delete registry[name];
  for (const [name, generate] of originalEntries) registry[name] = generate;
});

function declaredVersions(outputs: RecipeOutput[]): Map<string, { version: string; dev: boolean }> {
  const expected = new Map<string, { version: string; dev: boolean }>();
  for (const output of outputs) {
    for (const dependency of output.dependencies ?? []) {
      if (!expected.has(dependency.name)) expected.set(dependency.name, { version: dependency.version, dev: false });
    }
  }
  const three = expected.get('three');
  if (three && !expected.has('@types/three')) expected.set('@types/three', { version: three.version, dev: true });
  return expected;
}

const fingerprint = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

describe('recipe dependency metadata, without regenerating unused kit instructions', () => {
  it('matches every current generator declaration and leaves full default outputs deterministic and unchanged', () => {
    const before = Object.values(registry).map((generate) => generate());
    const expected = declaredVersions(before);
    expect([...expected]).toEqual([
      ['three', { version: '^0.180.0', dev: false }],
      // generate_game_physics (2026-11-13): the Rapier physics engine, pinned exactly because its WASM API is not caret-stable
      ['@dimforge/rapier3d-compat', { version: '0.21.0', dev: false }],
      ['@types/three', { version: '^0.180.0', dev: true }],
    ]);
    expect(recipeDependencyVersions()).toEqual(expected);
    const after = Object.values(registry).map((generate) => generate());
    expect(after.map((output) => output.dependencies)).toEqual(before.map((output) => output.dependencies));
    expect(after.map(fingerprint)).toEqual(before.map(fingerprint));
  });

  it('generates each stable recipe only once across repeated import lookups', () => {
    const spies = Object.keys(registry).map((name) => vi.spyOn(registry, name));
    for (let i = 0; i < 15; i++) {
      expect(recipeDependenciesNeeded({ 'src/scene.ts': "import * as THREE from 'three';" }, '{}')).toEqual([
        { name: '@types/three', version: '^0.180.0', dev: true },
        { name: 'three', version: '^0.180.0', dev: false },
      ]);
    }
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  });

  it('copies declarations and returns fresh maps and value records', () => {
    const dependencies = [{ name: 'metadata-copy', version: '1.0.0' }];
    const generate = vi.spyOn(registry, 'generate_game_runtime').mockReturnValue({ files: {}, dependencies });
    const first = recipeDependencyVersions();
    dependencies[0].version = 'mutated-generator-output';
    dependencies.push({ name: 'injected-dependency', version: '2.0.0' });
    first.get('metadata-copy')!.version = 'mutated-return-value';
    first.delete('three');
    first.set('injected-map-entry', { version: '3.0.0', dev: false });

    const second = recipeDependencyVersions();
    expect(second).not.toBe(first);
    expect(second.get('metadata-copy')).not.toBe(first.get('metadata-copy'));
    expect(second.get('metadata-copy')).toEqual({ version: '1.0.0', dev: false });
    expect(second.get('three')).toEqual({ version: '^0.180.0', dev: false });
    expect(second.has('injected-dependency')).toBe(false);
    expect(second.has('injected-map-entry')).toBe(false);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('reads live registry membership, order, and generator replacement with first declaration winning', () => {
    const first = vi.fn(() => ({ files: {}, dependencies: [{ name: 'shared-dependency', version: '1' }] }));
    const second = vi.fn(() => ({ files: {}, dependencies: [{ name: 'shared-dependency', version: '2' }] }));
    registry.generate_game_runtime = first;
    registry.generate_game_3d = second;
    expect(recipeDependencyVersions().get('shared-dependency')?.version).toBe('1');
    delete registry.generate_game_runtime;
    registry.generate_game_runtime = first;
    expect(recipeDependencyVersions().get('shared-dependency')?.version).toBe('2');
    delete registry.generate_game_3d;
    expect(recipeDependencyVersions().get('shared-dependency')?.version).toBe('1');

    registry.generate_game_runtime = vi.fn(() => ({ files: {}, dependencies: [{ name: 'replacement', version: '3' }] }));
    const replaced = recipeDependencyVersions();
    expect(replaced.has('shared-dependency')).toBe(false);
    expect(replaced.get('replacement')).toEqual({ version: '3', dev: false });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(registry.generate_game_runtime).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed generation and still derives the types version and development flag', () => {
    const generate = vi.spyOn(registry, 'generate_game_3d')
      .mockImplementationOnce(() => { throw new Error('generation failed'); })
      .mockReturnValue({ files: {}, dependencies: [{ name: 'three', version: '^9.0.0' }] });
    expect(() => recipeDependencyVersions()).toThrow('generation failed');
    expect(recipeDependencyVersions().get('three')).toEqual({ version: '^9.0.0', dev: false });
    expect(recipeDependencyVersions().get('@types/three')).toEqual({ version: '^9.0.0', dev: true });
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('preserves an explicitly declared types package rather than replacing its version or development flag', () => {
    vi.spyOn(registry, 'generate_game_3d').mockReturnValue({
      files: {}, dependencies: [{ name: 'three', version: '1' }, { name: '@types/three', version: '2' }],
    });
    expect(recipeDependencyVersions().get('@types/three')).toEqual({ version: '2', dev: false });
  });
});
