import { describe, it, expect } from 'vitest';
import { analyzeCoupling, couplingSummary } from './couplingAnalysis';

// A shared util imported by 8 feature modules → a fan-in hotspot.
function fanInApp() {
  const sources = [{ path: 'src/lib/util.ts', content: 'export const x = 1;\n' }];
  for (let i = 0; i < 8; i++) {
    sources.push({ path: `src/features/f${i}.ts`, content: `import { x } from '../lib/util';\nexport const y${i} = x;\n` });
  }
  return sources;
}

describe('analyzeCoupling — fan-in hotspot', () => {
  it('flags a module imported by many others (relative + index + extension resolution)', async () => {
    const issues = await analyzeCoupling(fanInApp());
    const hot = issues.find((i) => i.file === 'src/lib/util.ts');
    expect(hot).toBeTruthy();
    expect(hot!.kind).toBe('fan-in-hotspot');
    expect(hot!.degree).toBe(8);
  });

  it('resolves ../lib/util → util.ts and index barrels', async () => {
    const sources = [{ path: 'src/lib/index.ts', content: 'export const core = 1;\n' }];
    for (let i = 0; i < 8; i++) {
      sources.push({ path: `src/m${i}.ts`, content: `import { core } from './lib';\nexport const z${i} = core;\n` });
    }
    const issues = await analyzeCoupling(sources);
    expect(issues.some((i) => i.file === 'src/lib/index.ts' && i.degree === 8)).toBe(true);
  });

  it('does NOT flag a module just under the threshold', async () => {
    const sources = [{ path: 'src/lib/util.ts', content: 'export const x = 1;\n' }];
    for (let i = 0; i < 7; i++) {
      sources.push({ path: `src/f${i}.ts`, content: `import { x } from './lib/util';\n` });
    }
    const issues = await analyzeCoupling(sources);
    expect(issues.some((i) => i.file === 'src/lib/util.ts')).toBe(false);
  });
});

describe('analyzeCoupling — God module (high fan-out)', () => {
  it('flags a file that imports from many internal modules', async () => {
    const sources: Array<{ path: string; content: string }> = [];
    let imports = '';
    for (let i = 0; i < 15; i++) {
      sources.push({ path: `src/mod${i}.ts`, content: `export const v${i} = ${i};\n` });
      imports += `import { v${i} } from './mod${i}';\n`;
    }
    sources.push({ path: 'src/app.ts', content: imports + 'export const all = 0;\n' });
    const issues = await analyzeCoupling(sources);
    const god = issues.find((i) => i.file === 'src/app.ts');
    expect(god).toBeTruthy();
    expect(god!.kind).toBe('god-module');
    expect(god!.degree).toBe(15);
  });
});

describe('analyzeCoupling — safety', () => {
  it('ignores external packages and self/unresolved imports; empty for tiny apps', async () => {
    // External-only imports never count as internal coupling, no false hotspot.
    const sources = [{ path: 'src/a.ts', content: "import React from 'react';\nimport { z } from './missing';\n" }];
    expect(await analyzeCoupling(sources)).toEqual([]);
    expect(await analyzeCoupling([])).toEqual([]);
  });

  it('excludes test/spec/d.ts files from the graph', async () => {
    const sources = [{ path: 'src/lib/util.ts', content: 'export const x = 1;\n' }];
    for (let i = 0; i < 8; i++) {
      sources.push({ path: `src/f${i}.test.ts`, content: `import { x } from './lib/util';\n` });
    }
    // 8 importers but all are test files → excluded → no hotspot.
    expect(await analyzeCoupling(sources)).toEqual([]);
  });

  it('couplingSummary is empty when clean and lists hotspots otherwise', async () => {
    expect(couplingSummary([])).toBe('');
    const issues = await analyzeCoupling(fanInApp());
    expect(couplingSummary(issues)).toContain('Coupling —');
    expect(couplingSummary(issues)).toContain('coupling hotspot');
  });
});
