import { describe, it, expect } from 'vitest';
import { analyzeWorkspaceHealth } from './WorkspaceHealth';

describe('analyzeWorkspaceHealth', () => {
  it('reports ok:true with zero issues for a clean, coherent project', async () => {
    const r = await analyzeWorkspaceHealth({
      'package.json': JSON.stringify({ dependencies: { react: '^18.0.0' } }),
      'src/Button.tsx': `export function Button({ label }: { label: string }) { return <button>{label}</button>; }`,
      'src/App.tsx': `import { useState } from 'react';\nimport { Button } from './Button';\nexport function App() {\n  const [n, setN] = useState(0);\n  return <div><Button label={String(n)} /></div>;\n}`,
    });
    expect(r.ok).toBe(true);
    expect(r.totalIssues).toBe(0);
    expect(r.checks).toHaveLength(4);
    expect(r.checks.every(c => c.ok)).toBe(true);
  });

  it('aggregates issues from every failing check and sets ok:false', async () => {
    const r = await analyzeWorkspaceHealth({
      'package.json': JSON.stringify({ dependencies: {} }),
      // conditional hook (react-hooks) + undefined JSX component (jsx) + bad named import (import-export)
      'src/util.ts': `export const add = 1;`,
      'src/App.tsx': `import { useState } from 'react';\nimport { subtract } from './util';\nexport function App({ on }) {\n  if (on) { const [v] = useState(0); }\n  return <div><Ghost /></div>;\n}`,
    });
    expect(r.ok).toBe(false);
    const byId = Object.fromEntries(r.checks.map(c => [c.id, c]));
    expect(byId['react-hooks'].ok).toBe(false);
    expect(byId['jsx-resolution'].ok).toBe(false);
    expect(byId['import-export'].ok).toBe(false);
    expect(r.totalIssues).toBeGreaterThanOrEqual(3);
  });

  it('always returns the four named checks in a stable shape', async () => {
    const r = await analyzeWorkspaceHealth({});
    expect(r.checks.map(c => c.id)).toEqual(['code-confidence', 'react-hooks', 'import-export', 'jsx-resolution']);
    expect(r.ok).toBe(true); // nothing to scan → nothing broken
  });

  it('each check carries an honest one-line summary', async () => {
    const r = await analyzeWorkspaceHealth({
      'src/App.tsx': `export function App() { return <Ghost />; }`,
    });
    const jsx = r.checks.find(c => c.id === 'jsx-resolution')!;
    expect(jsx.ok).toBe(false);
    expect(jsx.summary).toMatch(/component/i);
  });
});
