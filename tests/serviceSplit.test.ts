/**
 * Service-split analysis + named architectures.
 *
 * The most important test in this file is the one asserting the tool says "DON'T SPLIT". The obvious
 * version of this feature happily carves any app into services because that is what it was asked to
 * do — which for almost every app this product builds is a downgrade paid for in deployment
 * complexity and distributed bugs. A tool that never recommends against itself is not advice.
 *
 * The second is that the architecture scaffold's ESLint rules and its README are generated from ONE
 * source: a README that disagrees with the linter is worse than no README at all.
 */

import { describe, it, expect } from 'vitest';
import { analyzeServiceSplit, clusterKeyFor } from '../src/server/AgentV3/ServiceSplitAnalysis';
import { generateArchitectureScaffold, isArchitectureStyle } from '../src/server/lib/ArchitectureScaffold';

/** Build an app of `n` files inside one feature folder, each importing the next. */
function feature(dir: string, n: number, extra: (i: number) => string = () => ''): Record<string, string> {
  const files: Record<string, string> = {};
  for (let i = 0; i < n; i += 1) {
    files[`src/${dir}/f${i}.ts`] = `import next from './f${i + 1}';\n${extra(i)}`;
  }
  files[`src/${dir}/f${n}.ts`] = 'export default 1;';
  return files;
}

describe('🔒 it recommends AGAINST splitting when that is the right answer', () => {
  it('tells a small app to stay one app', () => {
    const r = analyzeServiceSplit(feature('orders', 6));
    expect(r.splittable).toBe(false);
    expect(r.verdict).toContain('keep it as one app');
    expect(r.verdict).toMatch(/add deployment and networking work/i);
  });

  it('🔒 the splittable flag can never contradict the verdict', () => {
    // The real bug this encodes: every group in a six-file app is trivially "cohesive", so the seam
    // scan reported a clean seam and set splittable=true while the verdict printed beside it said keep
    // it as one app. A caller reading the flag would have acted against the advice.
    // `feature(dir, n)` writes n+1 files, so these are 5 / 7 / 13 / 21 files — all genuinely under the
    // 25-file threshold below which splitting is never the right advice.
    for (const n of [4, 6, 12, 20]) {
      const r = analyzeServiceSplit(feature('orders', n));
      expect(r.splittable, `${n} files`).toBe(false);
      expect(r.verdict, `${n} files`).toContain('keep it as one app');
    }
    // At the threshold the tool is allowed to offer a split — and then the flag and the verdict must
    // still agree with each other, which is the property that actually matters.
    const atThreshold = analyzeServiceSplit({ ...feature('orders', 20), ...feature('billing', 20) });
    expect(atThreshold.splittable).toBe(true);
    expect(atThreshold.verdict).not.toContain('keep it as one app');
  });

  it('refuses to invent a seam in a big but tangled app', () => {
    // Two groups that constantly reach into each other are not two services; they are one service
    // that has not been written yet.
    const files: Record<string, string> = {};
    for (let i = 0; i < 20; i += 1) {
      files[`src/a/f${i}.ts`] = `import x from '../b/g${i}';\nimport y from '../b/g${(i + 1) % 20}';`;
      files[`src/b/g${i}.ts`] = `import p from '../a/f${i}';`;
    }
    const r = analyzeServiceSplit(files);
    expect(r.splittable).toBe(false);
    expect(r.verdict).toMatch(/No clean split exists yet/);
    expect(r.seams.some((s) => s.verdict === 'tangled')).toBe(true);
  });

  it('names the entanglement, with the real number of imports', () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 15; i += 1) {
      files[`src/checkout/f${i}.ts`] = `import x from '../cart/g${i}';`;
      files[`src/cart/g${i}.ts`] = 'export default 1;';
    }
    const seam = analyzeServiceSplit(files).seams.find((s) => s.cluster.endsWith('checkout'));
    expect(seam?.reason).toContain('src/cart');
    expect(seam?.cutSize).toBe(15);
  });

  it('even when a split IS clean, it warns against doing it without a reason', () => {
    const files = { ...feature('orders', 20), ...feature('billing', 20) };
    const r = analyzeServiceSplit(files);
    expect(r.splittable).toBe(true);
    expect(r.verdict).toMatch(/Only split if you actually need to/);
    expect(r.verdict).toMatch(/One app that works beats two/);
  });
});

describe('the seams it finds are real', () => {
  it('a self-contained feature is a clean seam, and the cut size is exact', () => {
    const files = { ...feature('orders', 20), ...feature('billing', 20) };
    files['src/orders/f0.ts'] = "import b from '../billing/f0';\nimport next from './f1';";
    const seam = analyzeServiceSplit(files).seams.find((s) => s.cluster.endsWith('orders'));
    expect(seam?.verdict).toBe('clean-seam');
    expect(seam?.cutSize).toBe(1);                 // exactly the one cross-import added above
    expect(seam?.reason).toContain('1 import');
  });

  it('cohesion is the share of imports that stay inside the group', () => {
    const files = { ...feature('orders', 20), ...feature('billing', 20) };
    const seam = analyzeServiceSplit(files).seams.find((s) => s.cluster.endsWith('orders'));
    expect(seam!.cohesion).toBe(1);                // nothing crosses at all
  });

  it('ignores packages — a dependency is not this app\'s own coupling', () => {
    const files = feature('orders', 30, () => "import React from 'react';\nimport _ from 'lodash';");
    const r = analyzeServiceSplit(files);
    expect(r.seams[0].cutSize).toBe(0);
  });

  it('skips tests and build output', () => {
    const r = analyzeServiceSplit({
      'src/orders/a.test.ts': "import x from '../billing/b';",
      'node_modules/p/i.js': "import x from '../q/r';",
      'dist/b.js': 'export default 1;',
    });
    expect(r.filesScanned).toBe(0);
  });

  it('groups by feature folder, not by every sub-directory', () => {
    // One level would make the whole app a single group (nothing could ever be split); three would
    // make every sub-folder look like its own service.
    expect(clusterKeyFor('src/features/orders/api/list.ts')).toBe('src/features');
    expect(clusterKeyFor('src/orders/list.ts')).toBe('src/orders');
  });

  it('handles an empty or junk workspace without throwing', () => {
    expect(analyzeServiceSplit({}).verdict).toContain('No app code');
    expect(() => analyzeServiceSplit(undefined as never)).not.toThrow();
  });
});

describe('named architectures — enforced, not decorated', () => {
  const styles = ['clean', 'ddd', 'mvc', 'hexagonal'] as const;

  it('every style ships lint rules, not just folders', () => {
    // A structure nobody checks stops being true within a fortnight.
    for (const s of styles) {
      const r = generateArchitectureScaffold(s);
      const cfg = JSON.parse(r.files['.eslintrc.architecture.json']);
      expect(cfg.rules['import/no-restricted-paths'][0], s).toBe('error');
      expect(cfg.rules['import/no-restricted-paths'][1].zones.length, s).toBeGreaterThan(0);
    }
  });

  it('🔒 the innermost layer may import nothing — the rule the whole architecture rests on', () => {
    const cfg = JSON.parse(generateArchitectureScaffold('clean').files['.eslintrc.architecture.json']);
    const zones: Array<{ target: string; from: string }> = cfg.rules['import/no-restricted-paths'][1].zones;
    const intoDomain = zones.filter((z) => z.target === './src/domain').map((z) => z.from).sort();
    expect(intoDomain).toEqual(['./src/application', './src/infrastructure', './src/presentation']);
  });

  it('🔒 the rules and the README come from ONE source, so they cannot disagree', () => {
    for (const s of styles) {
      const r = generateArchitectureScaffold(s);
      const cfg = JSON.parse(r.files['.eslintrc.architecture.json']);
      const zones: Array<{ target: string; from: string }> = cfg.rules['import/no-restricted-paths'][1].zones;
      const doc = r.files['ARCHITECTURE.md'];
      for (const layer of r.layers) {
        const dir = layer.replace('src/', '');
        expect(doc, `${s}/${dir}`).toContain(`\`src/${dir}/\``);
      }
      // Every forbidden pair is a real layer pair, never a typo'd path.
      for (const z of zones) {
        expect(r.layers, `${s} ${z.target}`).toContain(z.target.replace('./', ''));
        expect(r.layers, `${s} ${z.from}`).toContain(z.from.replace('./', ''));
      }
    }
  });

  it('creates the folders in a way that survives a clone', () => {
    // git does not track empty directories, so a scaffold without these vanishes on checkout.
    const r = generateArchitectureScaffold('mvc');
    for (const l of r.layers) expect(Object.keys(r.files)).toContain(`${l}/.gitkeep`);
  });

  it('explains each layer where a developer will actually look', () => {
    const r = generateArchitectureScaffold('hexagonal');
    expect(r.files['src/core/README.md']).toContain('May import: nothing');
    expect(r.files['src/adapters/README.md']).toContain('May import: core');
  });

  it('is honest that small apps should not use it', () => {
    expect(generateArchitectureScaffold('clean').files['ARCHITECTURE.md']).toMatch(/If your app is small/);
  });

  it('says the boundaries are enforced, and does not claim to move existing code', () => {
    const r = generateArchitectureScaffold('ddd');
    expect(r.instructions).toContain('ENFORCED');
    expect(r.instructions).toContain('Existing code is untouched');
  });

  it('validates the style name', () => {
    expect(isArchitectureStyle('clean')).toBe(true);
    expect(isArchitectureStyle('microservices')).toBe(false);
  });
});
