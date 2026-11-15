import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { FORGE_CHECK } from './forgeCheckSource';
import { FORGE_ENGINE } from './forgeEngineSource';
import { subjectKindOf } from './forgeSubjects';
const exports: Record<string, any> = {};
// Execute only the repository-owned engine, never model-supplied code.
// eslint-disable-next-line no-new-func
new Function('exports', ts.transpileModule(FORGE_ENGINE, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(exports);
describe('ancestor copy identities', () => {
  it('keeps all leaf identities distinct with two repeated ancestors', () => {
    const nodes = exports.expandNodes({ nodes: [{ name: 'A', repeat: { count: 2, step: [1, 0, 0] }, children: [{ name: 'B', repeat: { count: 2, step: [0, 0, 1] }, children: [{ name: 'C' }] }] }] });
    expect(new Set(nodes.map((n: any) => n.name)).size).toBe(nodes.length);
    expect(nodes.filter((n: any) => n.name.startsWith('C')).map((n: any) => n.name)).toEqual(['C', 'C_1p1', 'C_1p', 'C_1p_1p1']);
  });
  it('preserves the single repeated parent names', () => {
    const nodes = exports.expandNodes({ nodes: [{ name: 'A', repeat: { count: 2, step: [1, 0, 0] }, children: [{ name: 'C' }] }] });
    expect(nodes.map((n: any) => n.name)).toEqual(['A', 'C', 'A_1', 'C_1p']);
  });
});
describe('subject phrases', () => {
  it('prefers bullet bike over the ambiguous rail word bullet', () => expect(subjectKindOf('a bullet bike')).toBe('bike'));
  it('keeps first subject precedence and token boundaries', () => {
    expect(subjectKindOf('a train with a bullet bike')).toBe('rail');
    expect(subjectKindOf('a bullet bike carrying a train')).toBe('bike');
    expect(subjectKindOf('a bullet train')).toBe('rail');
    expect(subjectKindOf('bullets bicycle')).toBe('bike');
  });
});

const check: Record<string, any> = {};
// eslint-disable-next-line no-new-func
new Function('exports', 'require', ts.transpileModule(FORGE_CHECK, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(check, () => exports);
describe('bounded expansion and mirror identities', () => {
  it('distinguishes different mirrored ancestors and keeps first-level mirror names', () => {
    const nodes = exports.expandNodes({ nodes: [{ name: 'A', mirror: 'x', children: [{ name: 'B', mirror: 'x', children: [{ name: 'C' }] }] }] });
    expect(new Set(nodes.map((n: any) => n.name)).size).toBe(nodes.length);
    expect(nodes.map((n: any) => n.name)).toContain('A_mirror');
    expect(nodes.map((n: any) => n.name)).toContain('C_mirror1');
    expect(nodes.map((n: any) => n.name)).toContain('C_mirror');
  });
  it('bounds multiplicative expansion before materializing a huge tree', () => {
    let node: any = { name: 'leaf', shape: { type: 'box', size: [1, 1, 1] }, material: 'm' };
    for (let i = 0; i < 6; i++) node = { name: 'group' + i, repeat: { count: 64, step: [1, 0, 0] }, children: [node] };
    const spec = { id: 'bounded-object', name: 'bounded', materials: { m: { color: '#ffffff' } }, nodes: [node] };
    expect(() => exports.expandNodes(spec)).toThrow('expanded node limit exceeded: 400');
    const result = check.validateObjectSpec(spec);
    expect(result.spec).toBeNull(); expect(result.errors).toContain('expanded node limit exceeded: 400');
  });
  it('allows exactly 400 nodes but rejects the next emit', () => {
    const nodes = Array.from({ length: 400 }, (_, i) => ({ name: 'node' + i }));
    expect(exports.expandNodes({ nodes }).length).toBe(400);
    expect(() => exports.expandNodes({ nodes: [...nodes, { name: 'extra' }] })).toThrow('expanded node limit exceeded');
  });
});

describe('mixed branching preserves geometry and parent links', () => {
  it('keeps identities unique across three mixed repeat/mirror ancestors', () => {
    const shape = { type: 'box', size: [1, 1, 1] };
    let node: any = { name: 'leaf', shape, material: 'm' };
    for (let i = 0; i < 3; i++) node = { name: 'branch' + i, repeat: { count: 2, step: [1, 0, 0] }, mirror: 'x', children: [node] };
    const nodes = exports.expandNodes({ nodes: [node] });
    expect(new Set(nodes.map((n: any) => n.name)).size).toBe(nodes.length);
    const leaves = nodes.filter((n: any) => n.shape);
    expect(leaves.length).toBe(64);
    expect(new Set(leaves.map((n: any) => n.source)).size).toBe(1);
    nodes.forEach((n: any, index: number) => {
      expect(n.parent).toBeLessThan(index);
      if (n.shape) {
        expect(nodes[n.parent].name.startsWith('branch0')).toBe(true);
        expect(nodes[n.source].shape).toEqual(shape);
      }
    });
  });
  it('repeated parents still translate their own children independently', () => {
    const spec = { nodes: [{ name: 'parent', repeat: { count: 2, step: [10, 0, 0] }, children: [{ name: 'leaf', position: [2, 0, 0], shape: { type: 'box', size: [1, 1, 1] }, material: 'm' }] }] };
    const meshes = exports.worldMeshes(spec);
    const minX = (m: any) => Math.min(...m.position.filter((_: number, i: number) => i % 3 === 0));
    expect(meshes.length).toBe(2);
    expect(minX(meshes[0])).toBeCloseTo(1.5);
    expect(minX(meshes[1])).toBeCloseTo(11.5);
  });
});
