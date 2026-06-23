import { describe, it, expect } from 'vitest';
import { analyzeRunnability, runnabilitySummary } from './RunnabilityAnalysis';
import type { ProjectGraph } from './WorkspaceMemory';

function graph(partial: Partial<ProjectGraph>): ProjectGraph {
  return {
    files: [],
    symbols: [],
    components: [],
    routes: [],
    imports: {},
    dependencies: [],
    ...partial,
  };
}

const pkg = (o: unknown) => JSON.stringify(o);

describe('analyzeRunnability', () => {
  it('is not assessable without a Node manifest', () => {
    const r = analyzeRunnability(graph({ files: ['main.py'] }), null);
    expect(r.assessed).toBe(false);
    expect(r.findings).toHaveLength(0);
  });

  it('is not assessable when there is no code yet', () => {
    const r = analyzeRunnability(graph({ files: [] }), pkg({ scripts: { dev: 'vite' } }));
    expect(r.assessed).toBe(false);
  });

  it('flags HIGH when there is no run script', () => {
    const r = analyzeRunnability(
      graph({ files: ['src/App.tsx'] }),
      pkg({ dependencies: { react: '^18' }, scripts: { lint: 'eslint .' } }),
    );
    expect(r.assessed).toBe(true);
    expect(r.findings.some((f) => f.level === 'high' && /run script/.test(f.message))).toBe(true);
  });

  it('flags a bundler dependency with no build script', () => {
    const r = analyzeRunnability(
      graph({ files: ['src/App.tsx', 'index.html'] }),
      pkg({ devDependencies: { vite: '^5' }, dependencies: { react: '^18' }, scripts: { dev: 'vite' } }),
    );
    expect(r.findings.some((f) => /build" script/.test(f.message))).toBe(true);
  });

  it('flags a Vite app with no index.html entry', () => {
    const r = analyzeRunnability(
      graph({ files: ['src/App.tsx'] }),
      pkg({ devDependencies: { vite: '^5' }, scripts: { dev: 'vite', build: 'vite build' } }),
    );
    expect(r.findings.some((f) => /index\.html/.test(f.message))).toBe(true);
  });

  it('reports no issues for a properly runnable Vite app', () => {
    const r = analyzeRunnability(
      graph({ files: ['src/App.tsx', 'index.html'] }),
      pkg({ devDependencies: { vite: '^5' }, dependencies: { react: '^18' }, scripts: { dev: 'vite', build: 'vite build' } }),
    );
    expect(r.assessed).toBe(true);
    expect(r.findings).toHaveLength(0);
  });

  it('survives malformed package.json (not assessable)', () => {
    const r = analyzeRunnability(graph({ files: ['src/App.tsx'] }), '{ not json');
    expect(r.assessed).toBe(false);
  });
});

describe('runnabilitySummary', () => {
  it('renders the not-assessable line', () => {
    expect(runnabilitySummary({ assessed: false, findings: [] })).toContain('no Node manifest');
  });

  it('renders a pass line when runnable', () => {
    expect(runnabilitySummary({ assessed: true, findings: [] })).toContain('✓');
  });

  it('lists the blocking issues', () => {
    const out = runnabilitySummary({
      assessed: true,
      findings: [{ level: 'high', message: 'No run script (dev/start/serve) in package.json — there is no defined way to start the app.' }],
    });
    expect(out).toContain('⚠');
    expect(out).toContain('run script');
  });
});
