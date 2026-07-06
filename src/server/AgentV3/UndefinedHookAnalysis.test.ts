import { describe, it, expect } from 'vitest';
import { analyzeUndefinedHooks } from './UndefinedHookAnalysis';

const app = (body: string) => ({ 'src/App.tsx': body });

describe('analyzeUndefinedHooks — clean (no false positives)', () => {
  it('accepts a hook that is imported', async () => {
    const r = await analyzeUndefinedHooks(app(`
      import { useState } from 'react';
      export function App() { const [v] = useState(0); return v; }
    `));
    expect(r.ok).toBe(true);
    expect(r.filesScanned).toBe(1);
  });

  it('accepts a custom hook defined locally', async () => {
    const r = await analyzeUndefinedHooks(app(`
      function useCounter() { return 0; }
      export function App() { const n = useCounter(); return n; }
    `));
    expect(r.ok).toBe(true);
  });

  it('accepts a hook passed as a parameter', async () => {
    const r = await analyzeUndefinedHooks(app(`export function App({ useThing }) { return useThing(); }`));
    expect(r.ok).toBe(true);
  });

  it('skips member-expression hook calls (React.useState / lib.useX)', async () => {
    const r = await analyzeUndefinedHooks(app(`
      import React from 'react';
      export function App() { const [v] = React.useState(0); return v; }
    `));
    expect(r.ok).toBe(true);
  });

  it('does not flag non-hook "use"-ish calls', async () => {
    const r = await analyzeUndefinedHooks(app(`export function App() { const x = user(); return x; }`));
    expect(r.ok).toBe(true);
  });
});

describe('analyzeUndefinedHooks — violations', () => {
  it('flags a hook called without importing it', async () => {
    const r = await analyzeUndefinedHooks(app(`
      export function App() { const [v] = useState(0); return v; }
    `));
    expect(r.ok).toBe(false);
    expect(r.undefinedHooks).toHaveLength(1);
    expect(r.undefinedHooks[0].hook).toBe('useState');
    expect(r.undefinedHooks[0].line).toBe(2);
  });

  it('flags a custom hook that is used but never imported/defined', async () => {
    const r = await analyzeUndefinedHooks(app(`export function App() { const d = useFetchData(); return d; }`));
    expect(r.ok).toBe(false);
    expect(r.undefinedHooks[0].hook).toBe('useFetchData');
  });

  it('de-dupes repeated undefined hook usages within a file', async () => {
    const r = await analyzeUndefinedHooks(app(`
      export function App() { useEffect(() => {}); useEffect(() => {}); return null; }
    `));
    expect(r.undefinedHooks).toHaveLength(1);
  });

  it('reports across multiple files', async () => {
    const r = await analyzeUndefinedHooks({
      'src/A.tsx': `import { useState } from 'react';\nexport const A = () => useState(0);\n`,
      'src/B.tsx': `export const B = () => useRef(null);\n`,
    });
    expect(r.undefinedHooks).toHaveLength(1);
    expect(r.undefinedHooks[0].file).toBe('src/B.tsx');
    expect(r.undefinedHooks[0].hook).toBe('useRef');
  });
});

describe('analyzeUndefinedHooks — robustness', () => {
  it('skips non-code files and returns honest zeros', async () => {
    const r = await analyzeUndefinedHooks({ 'notes.md': 'useState everywhere' });
    expect(r.filesScanned).toBe(0);
    expect(r.ok).toBe(true);
  });
  it('does not throw on unparseable content', async () => {
    const r = await analyzeUndefinedHooks({ 'src/broken.tsx': 'const useState( <<<' });
    expect(Array.isArray(r.undefinedHooks)).toBe(true);
  });
});
