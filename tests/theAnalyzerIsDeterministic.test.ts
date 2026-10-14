import { describe, it, expect } from 'vitest';
import { analyzeRequirements, recommendServices } from '../src/server/analyzer/requirements';

const pkg = (deps: Record<string, string>) => JSON.stringify({ dependencies: deps });

describe('requirements analyzer', () => {
  it('a static site needs nothing', () => {
    const r = analyzeRequirements({ paths: ['index.html', 'src/App.tsx'], packageJson: pkg({ react: '18' }) });
    expect(r).toEqual({ needsBackend: false, needsDatabase: false, needsAuth: false, evidence: [] });
    expect(recommendServices(r)).toEqual([]);
  });
  it('a database dependency implies a backend and a database', () => {
    const r = analyzeRequirements({ paths: ['server.ts', 'prisma/schema.prisma'], packageJson: pkg({ express: '4', pg: '8' }) });
    expect(r.needsBackend && r.needsDatabase).toBe(true);
    expect(r.evidence).toContain('dependency pg');
  });
  it('the same input always gives the same output', () => {
    const s = { paths: ['b.sql', 'api/x.ts', 'a.sql'], packageJson: pkg({ knex: '1', passport: '1' }) };
    expect(analyzeRequirements(s)).toEqual(analyzeRequirements({ ...s, paths: [...s.paths] }));
  });
  it('bad package.json is ignored, not thrown', () => {
    expect(() => analyzeRequirements({ paths: [], packageJson: '{nope' })).not.toThrow();
  });
  it('never recommends an unauthorised SKU (dedicated DB needs reseller auth)', () => {
    const r = analyzeRequirements({ paths: [], packageJson: pkg({ pg: '8' }) });
    const ids = recommendServices(r).map((x) => x.skuId);
    expect(ids).not.toContain('addon.dedicated_db');
    expect(ids).toContain('byo.supabase');
  });
});
