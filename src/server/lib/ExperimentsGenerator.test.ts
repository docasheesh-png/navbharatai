import { describe, it, expect, afterAll } from 'vitest';

import { generateExperimentsIntegration, EXPERIMENTS_SERVICE_SOURCE } from './ExperimentsGenerator';
import { emitModule } from '../../../tests/helpers/emitModule';

describe('generateExperimentsIntegration (wiring)', () => {
  it('emits the experiment service, routes and README', () => {
    const out = generateExperimentsIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/experiments/experimentService.ts');
    expect(paths).toContain('server/experiments/routes.ts');
    expect(paths).toContain('server/experiments/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/experiments/routes.ts']).toContain('export const experimentRouter');
  });
});

// Materialize + execute the emitted domain logic — the deterministic sticky assignment + weight split + exposure
// counts are real business rules, verified against the actual emitted code.
describe('emitted ExperimentService — deterministic sticky assignment + weight split (real logic)', () => {
  const emitted = emitModule('experiment', EXPERIMENTS_SERVICE_SOURCE);
  afterAll(emitted.cleanup);

  interface Variant { key: string; weight: number }
  interface Experiment { key: string; salt: string; active: boolean; variants: Variant[] }
  interface Service {
    define(key: string, variants: Array<{ key: string; weight?: number }>, opts?: { salt?: string; active?: boolean }): Experiment;
    get(key: string): Experiment | undefined;
    assign(experimentKey: string, user: string): string;
    expose(experimentKey: string, user: string): string;
    counts(experimentKey: string): Record<string, number>;
    list(): Experiment[];
  }
  interface Emitted { ExperimentService: new () => Service }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ emitted.href)) as unknown as Emitted;
  }

  it('assignment is DETERMINISTIC and STICKY (same user → same variant, always)', async () => {
    const { ExperimentService } = await load();
    const svc = new ExperimentService();
    svc.define('exp1', [{ key: 'A' }, { key: 'B' }]);
    const first = svc.assign('exp1', 'user-42');
    // repeated calls (a fresh service, even) give the same answer — it's a pure hash, no stored state
    for (let i = 0; i < 5; i++) expect(svc.assign('exp1', 'user-42')).toBe(first);
    const svc2 = new ExperimentService();
    svc2.define('exp1', [{ key: 'A' }, { key: 'B' }]);
    expect(svc2.assign('exp1', 'user-42')).toBe(first); // deterministic across instances
    expect(['A', 'B']).toContain(first);
  });

  it('respects variant WEIGHTS across a population (roughly 80/20 within tolerance)', async () => {
    const { ExperimentService } = await load();
    const svc = new ExperimentService();
    svc.define('exp2', [{ key: 'A', weight: 80 }, { key: 'B', weight: 20 }]);
    let a = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) if (svc.assign('exp2', 'u' + i) === 'A') a++;
    const share = a / N;
    // deterministic hash → stable distribution; assert it's clearly near 0.8, not 0.5
    expect(share).toBeGreaterThan(0.72);
    expect(share).toBeLessThan(0.88);
  });

  it('an inactive or unknown experiment returns the control (first variant) and never throws', async () => {
    const { ExperimentService } = await load();
    const svc = new ExperimentService();
    svc.define('off', [{ key: 'control' }, { key: 'variant' }], { active: false });
    // inactive → everyone gets the first-declared variant
    expect(svc.assign('off', 'anyone')).toBe('control');
    expect(svc.assign('off', 'someone-else')).toBe('control');
    // unknown experiment → safe fallback, no throw
    expect(svc.assign('does-not-exist', 'u1')).toBe('control');
  });

  it('expose logs each user once (idempotent) → exact per-variant counts', async () => {
    const { ExperimentService } = await load();
    const svc = new ExperimentService();
    svc.define('exp3', [{ key: 'A' }, { key: 'B' }]);
    const seen: Record<string, number> = { A: 0, B: 0 };
    for (let i = 0; i < 50; i++) {
      const v = svc.expose('exp3', 'u' + i);
      svc.expose('exp3', 'u' + i); // duplicate exposure → not double-counted
      seen[v]++;
    }
    const counts = svc.counts('exp3');
    expect(counts.A + counts.B).toBe(50); // 50 distinct users, each counted once
    expect(counts).toEqual(seen); // counts match the variants we observed
  });

  it('validates experiment + variant definitions', async () => {
    const { ExperimentService } = await load();
    const svc = new ExperimentService();
    expect(() => svc.define('', [{ key: 'A' }])).toThrow(/experiment key is required/);
    expect(() => svc.define('e', [])).toThrow(/at least one variant/);
    expect(() => svc.define('e', [{ key: '' }])).toThrow(/each variant needs a key/);
    expect(() => svc.define('e', [{ key: 'A', weight: 0 }])).toThrow(/positive number/);
    expect(svc.define('e', [{ key: 'A' }]).variants[0].weight).toBe(1); // default weight
  });
});
