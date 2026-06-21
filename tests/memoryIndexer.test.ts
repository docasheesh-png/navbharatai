import { describe, it, expect } from 'vitest';
import { MemoryIndexer } from '../src/server/Memory/MemoryIndexer';
import type { ProjectMemory } from '../src/server/Memory/ProjectGraph';

function emptyMemory(): ProjectMemory {
  return { projectType: '', files: [], components: [], routes: [], models: [], services: [], features: [], dependencies: [], buildHistory: [] };
}

describe('MemoryIndexer.index', () => {
  it('adds the file path to memory.files', () => {
    const mem = emptyMemory();
    MemoryIndexer.index('src/App.tsx', 'export default function App() {}', mem);
    expect(mem.files).toContain('src/App.tsx');
  });

  it('extracts a component name from "export default function"', () => {
    const mem = emptyMemory();
    MemoryIndexer.index('src/App.tsx', 'export default function App() { return <div/>; }', mem);
    expect(mem.components).toContain('App');
  });

  it('extracts a component name from "export const"', () => {
    const mem = emptyMemory();
    MemoryIndexer.index('src/Header.tsx', 'export const Header = () => <header/>;', mem);
    expect(mem.components).toContain('Header');
  });

  it('does not extract component names from non-tsx/ts files', () => {
    const mem = emptyMemory();
    MemoryIndexer.index('styles.css', 'export default function App() {}', mem);
    expect(mem.components).toHaveLength(0);
  });

  it('does not add the same file to files twice', () => {
    const mem = emptyMemory();
    MemoryIndexer.index('src/App.tsx', 'export const X = 1;', mem);
    MemoryIndexer.index('src/App.tsx', 'export const X = 1;', mem);
    expect(mem.files.filter(f => f === 'src/App.tsx')).toHaveLength(1);
  });

  it('does not add the same component name twice', () => {
    const mem = emptyMemory();
    MemoryIndexer.index('src/App.tsx', 'export default function App() {}', mem);
    MemoryIndexer.index('src/App2.tsx', 'export default function App() {}', mem);
    expect(mem.components.filter(c => c === 'App')).toHaveLength(1);
  });

  it('returns the mutated memory object', () => {
    const mem = emptyMemory();
    const result = MemoryIndexer.index('src/X.ts', 'export const X = 1;', mem);
    expect(result).toBe(mem);
  });
});
