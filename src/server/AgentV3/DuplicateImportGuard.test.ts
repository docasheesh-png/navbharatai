import { describe, it, expect } from 'vitest';
import { dedupeDuplicateImports } from './DuplicateImportGuard';

describe('dedupeDuplicateImports — kill the "Duplicate declaration" preview breaker (buildId 1047276c)', () => {
  it('drops a named import that duplicates an earlier default import of the same module (the ErrorBoundary case)', () => {
    const src = [
      "import React from 'react';",
      "import App from './App';",
      "import ErrorBoundary from './ErrorBoundary';",
      "import { ErrorBoundary } from './ErrorBoundary';",
      'createRoot(el).render(<ErrorBoundary><App/></ErrorBoundary>);',
    ].join('\n');
    const { content, removed } = dedupeDuplicateImports(src);
    expect(removed).toHaveLength(1);
    // Only ONE ErrorBoundary import survives.
    expect((content.match(/ErrorBoundary\b(?=.*from)/g) || []).length).toBeLessThanOrEqual(1);
    expect(content).toContain("import ErrorBoundary from './ErrorBoundary';"); // the default (first) is kept
    expect(content).not.toContain("import { ErrorBoundary } from './ErrorBoundary';");
    expect(content).toContain("import App from './App';"); // unrelated imports untouched
    expect(content).toContain('createRoot'); // body untouched
  });

  it('drops a second identical import of the same page', () => {
    const src = "import Team from '@/pages/Team';\nimport Team from '@/pages/Team';\nexport const x = 1;";
    const { content, removed } = dedupeDuplicateImports(src);
    expect(removed).toHaveLength(1);
    expect((content.match(/import Team from/g) || []).length).toBe(1);
  });

  it('does NOT touch a legit same-name import from a DIFFERENT module (leaves the real collision to the backstop)', () => {
    const src = "import Button from './ui/Button';\nimport Button from './legacy/Button';\n";
    const { content, removed } = dedupeDuplicateImports(src);
    expect(removed).toHaveLength(0); // different modules — not a safe auto-dedupe
    expect(content).toBe(src);
  });

  it('leaves a partial-overlap import alone (conservative — only fully-redundant statements are dropped)', () => {
    const src = "import ErrorBoundary from './ErrorBoundary';\nimport { ErrorBoundary, Foo } from './ErrorBoundary';\n";
    const { removed } = dedupeDuplicateImports(src);
    expect(removed).toHaveLength(0); // Foo is new → don't drop the whole statement
  });

  it('is a no-op for clean files and junk input', () => {
    const clean = "import A from './a';\nimport B from './b';\n";
    expect(dedupeDuplicateImports(clean)).toEqual({ content: clean, removed: [] });
    expect(dedupeDuplicateImports('')).toEqual({ content: '', removed: [] });
    expect(dedupeDuplicateImports(undefined as never).content).toBe('');
  });

  it('handles `import type` and aliased named imports', () => {
    const src = "import type { Role } from './types';\nimport type { Role } from './types';\n";
    const { removed } = dedupeDuplicateImports(src);
    expect(removed).toHaveLength(1);
  });
});
