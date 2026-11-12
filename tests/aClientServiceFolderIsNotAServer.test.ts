// BR1960 (report 1946f797, 2026-11-08) — a Vite SPA (YouTube SEO generator) kept a mock data fetcher in
// `src/services/seoAPI.ts`. FE_BE_PARTITION said "9 frontend, 1 backend … A clean full-stack split exists"
// about an app with no server. The class: `src/services|api|models` under the source root is a CLIENT
// layer unless the same file set has an unambiguous server signal.
//
// t311u narrowing: the CSP scan (scanProjectCsp) skips when a backend exists. Its reading is pinned to the
// old classification so this fix cannot start emitting new agent-facing CSP findings.
import { describe, it, expect } from 'vitest';
import { classifyFile, partitionFrontendBackend, partitionSummary } from '../src/server/AgentV3/frontendBackendPartition';
import { scanProjectCsp } from '../src/server/AgentV3/CspMetaAnalysis';

// The shape of the files BR1960's turn wrote (24 total: 9 frontend, 1 "backend", 5 shared, 9 other).
const BR1960_FILES = [
  'src/App.tsx', 'src/main.tsx', 'src/components/InputSection.tsx', 'src/components/RelatedKeywords.tsx',
  'src/components/ResultsSection.tsx', 'src/components/TagSuggestions.tsx', 'src/components/Header.tsx',
  'src/index.css', 'src/App.css', 'src/services/seoAPI.ts', 'src/utils/seo.ts', 'src/types/index.ts',
  'src/lib/format.ts', 'src/data/sample.ts', 'src/hooks/useSeo.ts', 'package.json', 'index.html',
];

describe('a client service folder is not a server', () => {
  it('the BR1960 file set has no backend and no full-stack split', () => {
    const p = partitionFrontendBackend(BR1960_FILES);
    expect(p.backend).toEqual([]);
    expect(p.shared).toContain('src/services/seoAPI.ts');
    expect(p.partitionable).toBe(false);
    expect(partitionSummary(p)).toMatch(/No clean full-stack split/);
  });

  it.each(['src/services/api.ts', 'src/api/client.ts', 'src/models/Video.ts', './src/service/x.ts'])(
    'SPA-only: %s is shared', (f) => {
      const p = partitionFrontendBackend(['src/App.tsx', f]);
      expect(p.backend).toEqual([]);
      expect(p.shared).toContain(f);
    });
});

describe('🔒 neighbours: real backends are still backends', () => {
  it('a server tree beside src/services makes the client layer backend again (old reading)', () => {
    const p = partitionFrontendBackend(['src/App.tsx', 'src/services/api.ts', 'server/index.ts', 'server/routes/a.ts']);
    expect(p.backend).toEqual(['src/services/api.ts', 'server/index.ts', 'server/routes/a.ts']);
    expect(p.partitionable).toBe(true);
  });

  it.each([
    ['src/server/services/mail.ts'], ['backend/src/models/User.ts'], ['api/orders.ts'], ['src/app/api/route.ts'],
    ['pages/api/hello.ts'], ['src/routes/users.ts'], ['app.server.ts'], ['db/migrations/001.sql'],
  ])('%s stays backend', (f) => {
    expect(partitionFrontendBackend(['src/App.tsx', f]).backend).toContain(f);
  });

  it('classifyFile (single path) is unchanged', () => {
    expect(classifyFile('src/models/User.ts')).toBe('backend');
    expect(classifyFile('src/services/seoAPI.ts')).toBe('backend');
  });

  it('a monorepo client package is not affected (path not at src root)', () => {
    const p = partitionFrontendBackend(['apps/web/src/App.tsx', 'apps/web/src/services/api.ts']);
    expect(p.backend).toEqual(['apps/web/src/services/api.ts']);
  });
});

describe('🔒 t311u: the CSP scan keeps its old skip decision', () => {
  const html = '<!doctype html><html><head><script src="https://cdn.example.com/x.js"></script></head><body></body></html>';
  it('an SPA with src/services still skips the CSP scan exactly as before', () => {
    expect(scanProjectCsp({ 'index.html': html, 'src/services/seoAPI.ts': 'export {}', 'src/App.tsx': '' })).toEqual([]);
  });
  it('an SPA without one still gets scanned', () => {
    expect(scanProjectCsp({ 'index.html': html, 'src/App.tsx': '' }).length).toBe(1);
  });
});
