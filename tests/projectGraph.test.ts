import { describe, it, expect } from 'vitest';
import { InitialMemory } from '../src/server/Memory/ProjectGraph';
import { MemoryIndexer } from '../src/server/Memory/MemoryIndexer';

describe('InitialMemory', () => {
  it('has the expected shape with empty arrays', () => {
    expect(InitialMemory.projectType).toBe('');
    expect(InitialMemory.files).toEqual([]);
    expect(InitialMemory.components).toEqual([]);
    expect(InitialMemory.routes).toEqual([]);
    expect(InitialMemory.buildHistory).toEqual([]);
  });
});

describe('MemoryIndexer.index', () => {
  function freshMemory() {
    return JSON.parse(JSON.stringify(InitialMemory));
  }

  it('adds file path to memory.files', () => {
    const mem = freshMemory();
    const updated = MemoryIndexer.index('src/App.tsx', '// content', mem);
    expect(updated.files).toContain('src/App.tsx');
  });

  it('does not add the same file path twice', () => {
    const mem = freshMemory();
    MemoryIndexer.index('src/App.tsx', '// a', mem);
    MemoryIndexer.index('src/App.tsx', '// b', mem);
    expect(mem.files.filter(f => f === 'src/App.tsx').length).toBe(1);
  });

  it('extracts exported function name from .tsx file', () => {
    const mem = freshMemory();
    MemoryIndexer.index('src/Button.tsx', 'export default function Button() {}', mem);
    expect(mem.components).toContain('Button');
  });

  it('extracts exported const from .ts file', () => {
    const mem = freshMemory();
    MemoryIndexer.index('src/utils.ts', 'export const formatDate = () => {}', mem);
    expect(mem.components).toContain('formatDate');
  });

  it('does not add duplicate component names', () => {
    const mem = freshMemory();
    MemoryIndexer.index('src/A.tsx', 'export default function MyComp() {}', mem);
    MemoryIndexer.index('src/B.tsx', 'export default function MyComp() {}', mem);
    expect(mem.components.filter(c => c === 'MyComp').length).toBe(1);
  });

  it('ignores non-ts/tsx files for component extraction', () => {
    const mem = freshMemory();
    MemoryIndexer.index('styles.css', 'export default function Button() {}', mem);
    expect(mem.components).toEqual([]);
    expect(mem.files).toContain('styles.css');
  });

  it('handles content without export statement gracefully', () => {
    const mem = freshMemory();
    MemoryIndexer.index('src/no-export.ts', 'const x = 1;', mem);
    expect(mem.files).toContain('src/no-export.ts');
    expect(mem.components).toEqual([]);
  });
});
