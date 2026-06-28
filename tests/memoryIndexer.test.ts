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

describe('MemoryIndexer.indexWithAST (P4.3 — AST consolidation)', () => {
  it('extracts ALL exported symbols (not just the first, unlike the regex baseline)', async () => {
    const mem = freshMemory();
    const content = 'export const A = 1;\nexport const B = 2;\nexport function cThing() {}';
    // Regex baseline alone would capture only the first export ("A").
    MemoryIndexer.index('src/multi.ts', content, freshMemory());
    await MemoryIndexer.indexWithAST('src/multi.ts', content, mem);
    expect(mem.components).toEqual(expect.arrayContaining(['A', 'B', 'cThing']));
  });

  it('detects React components in a .tsx file', async () => {
    const mem = freshMemory();
    const content = 'export function Header() { return <div/>; }\nexport const Footer = () => <div/>;';
    await MemoryIndexer.indexWithAST('src/components/Layout.tsx', content, mem);
    expect(mem.components).toEqual(expect.arrayContaining(['Header', 'Footer']));
  });

  it('extracts route paths via AST enrichment', async () => {
    const mem = freshMemory();
    const content = `import express from 'express';\nconst app = express();\napp.get('/api/users', () => {});\napp.post('/api/orders', () => {});`;
    await MemoryIndexer.indexWithAST('src/server/routes.ts', content, mem);
    expect(mem.routes).toEqual(expect.arrayContaining(['/api/users', '/api/orders']));
  });

  it('always includes the regex baseline (no regression) and records the file', async () => {
    const mem = freshMemory();
    await MemoryIndexer.indexWithAST('src/components/Button.tsx', 'export default function Button() { return null; }', mem);
    expect(mem.components).toContain('Button'); // preserved from the regex baseline (default export)
    expect(mem.files).toContain('src/components/Button.tsx');
  });

  it('never throws and still records the file for a non-ts asset', async () => {
    const mem = freshMemory();
    await expect(MemoryIndexer.indexWithAST('styles/main.css', 'body{}', mem)).resolves.toBe(mem);
    expect(mem.files).toContain('styles/main.css');
    expect(mem.components).toHaveLength(0);
  });

  it('does not duplicate symbols across repeated indexing', async () => {
    const mem = freshMemory();
    const content = 'export const A = 1;';
    await MemoryIndexer.indexWithAST('src/a.ts', content, mem);
    await MemoryIndexer.indexWithAST('src/a.ts', content, mem);
    expect(mem.components.filter((c) => c === 'A')).toHaveLength(1);
  });
});
