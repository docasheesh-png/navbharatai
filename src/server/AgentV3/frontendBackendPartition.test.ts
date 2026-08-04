import { describe, it, expect } from 'vitest';
import { classifyFile, partitionFrontendBackend, partitionSummary } from './frontendBackendPartition';

describe('classifyFile', () => {
  it('classifies backend trees + server entry files', () => {
    for (const p of ['server/index.ts', 'src/server/routes/users.ts', 'api/orders.ts', 'src/models/User.ts', 'db/migrations/001.sql', 'app.server.ts']) {
      expect(classifyFile(p), p).toBe('backend');
    }
  });
  it('classifies frontend trees, component extensions and styles', () => {
    for (const p of ['src/components/Button.tsx', 'src/pages/Home.jsx', 'src/App.vue', 'src/styles/main.css', 'src/hooks/useCart.ts']) {
      expect(classifyFile(p), p).toBe('frontend');
    }
  });
  it('classifies shared/ambiguous code as shared (never over-assigns a side)', () => {
    for (const p of ['src/types/index.ts', 'shared/contract.ts', 'src/utils/format.ts', 'src/lib/misc.ts', 'src/random.ts']) {
      expect(classifyFile(p), p).toBe('shared');
    }
  });
  it('excludes config/tests/assets/docs as other', () => {
    for (const p of ['package.json', 'tsconfig.json', 'vite.config.ts', 'README.md', 'src/App.test.tsx', 'public/logo.png', '.env']) {
      expect(classifyFile(p), p).toBe('other');
    }
  });
  it('is safe on empty/garbage input', () => {
    expect(classifyFile('')).toBe('other');
    // @ts-expect-error defensive
    expect(classifyFile(null)).toBe('other');
  });
});

describe('partitionFrontendBackend', () => {
  it('reports a clean split for a real full-stack app', () => {
    const p = partitionFrontendBackend([
      'src/components/Cart.tsx', 'src/pages/Checkout.tsx', 'src/styles/app.css',
      'server/index.ts', 'server/routes/orders.ts', 'server/models/Order.ts',
      'src/types/index.ts', 'package.json',
    ]);
    expect(p.frontend.length).toBe(3);
    expect(p.backend.length).toBe(3);
    expect(p.shared).toEqual(['src/types/index.ts']);
    expect(p.other).toEqual(['package.json']);
    expect(p.partitionable).toBe(true);
  });

  it('is NOT partitionable for a pure frontend SPA (no backend)', () => {
    const p = partitionFrontendBackend(['src/App.tsx', 'src/components/Nav.tsx', 'src/styles/x.css', 'index.html']);
    expect(p.backend.length).toBe(0);
    expect(p.partitionable).toBe(false);
  });

  it('is NOT partitionable when shared code dominates the sided files', () => {
    // 1 FE + 1 BE (sided=2) but 3 shared > 2 → not a clean split.
    const p = partitionFrontendBackend(['src/components/A.tsx', 'server/index.ts', 'src/lib/a.ts', 'src/utils/b.ts', 'shared/c.ts']);
    expect(p.partitionable).toBe(false);
  });
});

describe('partitionSummary', () => {
  it('names the counts and the parallel-candidate verdict when partitionable', () => {
    const out = partitionSummary(partitionFrontendBackend(['src/components/A.tsx', 'server/index.ts']));
    expect(out).toContain('1 frontend, 1 backend');
    expect(out).toContain('clean full-stack split exists');
  });
  it('says no clean split for a single-side build', () => {
    expect(partitionSummary(partitionFrontendBackend(['src/App.tsx']))).toContain('No clean full-stack split');
  });
});
