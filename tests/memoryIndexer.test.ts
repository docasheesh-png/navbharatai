import { describe, it, expect } from 'vitest';
import { MemoryIndexer } from '../src/server/Memory/MemoryIndexer';
import { InitialMemory } from '../src/server/Memory/ProjectGraph';
import type { ProjectMemory } from '../src/server/Memory/ProjectGraph';

function freshMemory(): ProjectMemory {
  return JSON.parse(JSON.stringify(InitialMemory));
}

describe('MemoryIndexer', () => {
  it('adds filePath to memory.files', () => {
    const mem = freshMemory();
    MemoryIndexer.index('src/App.tsx', '', mem);
    expect(mem.files).toContain('src/App.tsx');
  });

  it('does not duplicate files on second index of same path', () => {
    const mem = freshMemory();
    MemoryIndexer.index('src/App.tsx', '', mem);
    MemoryIndexer.index('src/App.tsx', '', mem);
    expect(mem.files.filter(f => f === 'src/App.tsx')).toHaveLength(1);
  });

  it('extracts exported component name from tsx content', () => {
    const mem = freshMemory();
    MemoryIndexer.index('src/components/Button.tsx', 'export default function Button() {}', mem);
    expect(mem.components).toContain('Button');
  });

  it('extracts exported const name from ts content', () => {
    const mem = freshMemory();
    MemoryIndexer.index('src/lib/utils.ts', 'export const formatDate = () => {}', mem);
    expect(mem.components).toContain('formatDate');
  });

  it('does not add component name for non-ts/tsx files', () => {
    const mem = freshMemory();
    MemoryIndexer.index('styles/main.css', 'export const x = 1', mem);
    expect(mem.components).toHaveLength(0);
  });

  it('returns the updated memory object', () => {
    const mem = freshMemory();
    const result = MemoryIndexer.index('src/foo.ts', '', mem);
    expect(result).toBe(mem);
  });
});
