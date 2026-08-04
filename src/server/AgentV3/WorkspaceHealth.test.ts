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
    expect(r.checks).toHaveLength(6);
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

  it('framework-gates the React-only checks — a Nuxt/Vue app is not falsely blocked (ShopSphere autopsy)', async () => {
    // The SAME code that trips react-hooks/jsx/hook-resolution above must be treated as CLEAN for a
    // non-React framework: a Nuxt `useX` composable is not a React hook, and an auto-imported composable
    // is not "never imported". Import/export consistency stays framework-neutral.
    const files = {
      'package.json': JSON.stringify({ dependencies: {} }),
      'app.vue': `<script setup>\nconst { data } = useFetch('/api/products');\nconst products = useProducts();\n</script>`,
    };
    const nuxt = await analyzeWorkspaceHealth(files, 'nuxt');
    const byId = Object.fromEntries(nuxt.checks.map(c => [c.id, c]));
    expect(byId['react-hooks'].ok).toBe(true);
    expect(byId['react-hooks'].issues).toBe(0);
    expect(byId['react-hooks'].summary).toMatch(/skipped/i);
    expect(byId['jsx-resolution'].ok).toBe(true);
    expect(byId['hook-resolution'].ok).toBe(true);
    expect(byId['hook-resolution'].summary).toMatch(/skipped/i);
  });

  it('always returns the six named checks in a stable shape', async () => {
    const r = await analyzeWorkspaceHealth({});
    expect(r.checks.map(c => c.id)).toEqual(['code-confidence', 'react-hooks', 'import-export', 'jsx-resolution', 'hook-resolution', 'dependency-constraints']);
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
