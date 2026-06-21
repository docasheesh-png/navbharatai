import { describe, it, expect } from 'vitest';
import { ModuleGraph } from '../src/server/AppMakerLab/generator/ModuleGraph';

describe('ModuleGraph', () => {
  it('returns topological order for a single node', () => {
    const g = new ModuleGraph();
    g.addNode({ name: 'UI', dependencies: [] });
    expect(g.getTopologicalOrder()).toEqual(['UI']);
  });

  it('returns dependency before dependent in topological order', () => {
    const g = new ModuleGraph();
    g.addNode({ name: 'DB', dependencies: [] });
    g.addNode({ name: 'API', dependencies: ['DB'] });
    g.addNode({ name: 'UI', dependencies: ['API'] });
    const order = g.getTopologicalOrder();
    expect(order.indexOf('DB')).toBeLessThan(order.indexOf('API'));
    expect(order.indexOf('API')).toBeLessThan(order.indexOf('UI'));
  });

  it('filters out the invalid "Frontend" dependency on addNode', () => {
    const g = new ModuleGraph();
    g.addNode({ name: 'Service', dependencies: ['Frontend', 'DB'] });
    g.addNode({ name: 'DB', dependencies: [] });
    const order = g.getTopologicalOrder();
    expect(order).toContain('Service');
    expect(order).toContain('DB');
    // 'Frontend' was never added as a node, order should not include it
    expect(order).not.toContain('Frontend');
  });

  it('does not throw on a cyclic graph — prunes the back-edge instead', () => {
    const g = new ModuleGraph();
    g.addNode({ name: 'A', dependencies: ['B'] });
    g.addNode({ name: 'B', dependencies: ['A'] });
    expect(() => { g.validate(); g.getTopologicalOrder(); }).not.toThrow();
  });

  it('returns all nodes even with no dependencies between them', () => {
    const g = new ModuleGraph();
    g.addNode({ name: 'X', dependencies: [] });
    g.addNode({ name: 'Y', dependencies: [] });
    const order = g.getTopologicalOrder();
    expect(order).toContain('X');
    expect(order).toContain('Y');
  });

  it('getTopologicalOrder on an empty graph returns []', () => {
    const g = new ModuleGraph();
    expect(g.getTopologicalOrder()).toEqual([]);
  });
});
