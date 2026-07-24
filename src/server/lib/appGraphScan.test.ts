import { describe, it, expect } from 'vitest';
import {
  extractImports, classifySpec, packageRoot, normalizePath, resolveRelative,
  declaredDependencies, scanAppGraph,
} from './appGraphScan';
import type { AppFinding } from './appDebugAnalysis';

const cat = (fs: AppFinding[], c: string) => fs.filter((f) => f.category === c);

describe('extractImports', () => {
  it('captures static, side-effect, require, and dynamic imports with line numbers', () => {
    const src = [
      "import React from 'react';",          // 1
      "import './styles.css';",              // 2
      "const x = require('lodash');",        // 3
      "const y = await import('./lazy');",   // 4
      "export { z } from './z';",            // 5
    ].join('\n');
    const imps = extractImports(src);
    const specs = imps.map((i) => i.spec);
    expect(specs).toEqual(expect.arrayContaining(['react', './styles.css', 'lodash', './lazy', './z']));
    expect(imps.find((i) => i.spec === 'lodash')!.line).toBe(3);
  });
});

describe('classifySpec / packageRoot', () => {
  it('classifies relative, bare, alias, builtin', () => {
    expect(classifySpec('./a')).toBe('relative');
    expect(classifySpec('../a')).toBe('relative');
    expect(classifySpec('react')).toBe('bare');
    expect(classifySpec('@scope/pkg')).toBe('bare');
    expect(classifySpec('@/components/X')).toBe('alias');
    expect(classifySpec('~/lib/y')).toBe('alias');
    expect(classifySpec('fs')).toBe('builtin');
    expect(classifySpec('node:path')).toBe('builtin');
  });
  it('extracts the npm package root', () => {
    expect(packageRoot('lodash/merge')).toBe('lodash');
    expect(packageRoot('@scope/pkg/sub')).toBe('@scope/pkg');
    expect(packageRoot('react')).toBe('react');
  });
});

describe('normalizePath / resolveRelative', () => {
  it('normalizes . and ..', () => {
    expect(normalizePath('src/a/../b')).toBe('src/b');
    expect(normalizePath('src/./a')).toBe('src/a');
    expect(normalizePath('a/b/../../c')).toBe('c');
  });
  it('resolves with extension and index fallbacks', () => {
    const set = new Set(['src/a.ts', 'src/util/index.ts', 'src/data.json']);
    expect(resolveRelative('src/main.ts', './a', set)).toBe('src/a.ts');
    expect(resolveRelative('src/main.ts', './util', set)).toBe('src/util/index.ts');
    expect(resolveRelative('src/main.ts', './data.json', set)).toBe('src/data.json');
    expect(resolveRelative('src/main.ts', './missing', set)).toBeNull();
  });
});

describe('declaredDependencies', () => {
  it('unions every dependency bucket and captures the package name', () => {
    const { deps, selfName } = declaredDependencies(JSON.stringify({
      name: 'my-app',
      dependencies: { react: '^18' },
      devDependencies: { vitest: '^2' },
      peerDependencies: { 'react-dom': '^18' },
    }));
    expect(selfName).toBe('my-app');
    expect(deps.has('react')).toBe(true);
    expect(deps.has('vitest')).toBe(true);
    expect(deps.has('react-dom')).toBe(true);
  });
  it('an unparseable package.json yields empty deps (never throws)', () => {
    expect(declaredDependencies('{ not json').deps.size).toBe(0);
  });
});

describe('scanAppGraph — MISSING_DEPENDENCY', () => {
  const pkg = JSON.stringify({ name: 'app', dependencies: { react: '^18' } });

  it('flags a bare import missing from package.json', () => {
    const fs = scanAppGraph({
      'package.json': pkg,
      'src/a.ts': "import axios from 'axios';\nimport React from 'react';\n",
    }, true);
    const dep = cat(fs, 'dependency');
    expect(dep).toHaveLength(1);
    expect(dep[0].problem).toMatch(/axios/);
    expect(dep[0].severity).toBe('high');
    expect(dep[0].source).toBe('graph');
  });

  it('does NOT flag declared deps, builtins, aliases, or relative imports', () => {
    const fs = scanAppGraph({
      'package.json': pkg,
      'src/a.ts': "import React from 'react';\nimport fs from 'fs';\nimport X from '@/x';\nimport y from './y';\n",
      'src/y.ts': 'export const y = 1;',
    }, true);
    expect(cat(fs, 'dependency')).toHaveLength(0);
  });

  it('dedupes a missing dep across many files (reported once)', () => {
    const fs = scanAppGraph({
      'package.json': pkg,
      'src/a.ts': "import axios from 'axios';",
      'src/b.ts': "import axios from 'axios';",
    }, true);
    expect(cat(fs, 'dependency')).toHaveLength(1);
  });

  it('does not run the dependency check when there is no package.json', () => {
    const fs = scanAppGraph({ 'src/a.ts': "import axios from 'axios';" }, true);
    expect(cat(fs, 'dependency')).toHaveLength(0);
  });
});

describe('scanAppGraph — BROKEN_IMPORT (honest, gated)', () => {
  it('flags a relative import that resolves to nothing (complete fileset)', () => {
    const fs = scanAppGraph({
      'src/main.ts': "import { a } from './a';\n",
      'src/other.ts': 'export const o = 1;', // proves we hold src/ (area evidence)
    }, true);
    const broken = cat(fs, 'imports');
    expect(broken).toHaveLength(1);
    expect(broken[0].problem).toMatch(/does not resolve/);
  });

  it('does NOT flag broken imports when the fileset is incomplete (truncated fetch)', () => {
    const fs = scanAppGraph({ 'src/main.ts': "import { a } from './a';\n" }, false);
    expect(cat(fs, 'imports')).toHaveLength(0);
  });

  it('does NOT flag when the target directory is absent from the map (we never fetched it)', () => {
    // deep/ area has no files in the map → no evidence we hold it → no false "missing".
    const fs = scanAppGraph({ 'src/main.ts': "import x from '../deep/x';\n" }, true);
    expect(cat(fs, 'imports')).toHaveLength(0);
  });

  it('resolves a real relative import without flagging it', () => {
    const fs = scanAppGraph({
      'src/main.ts': "import { a } from './a';\n",
      'src/a.ts': 'export const a = 1;',
    }, true);
    expect(cat(fs, 'imports')).toHaveLength(0);
  });
});

describe('scanAppGraph — DEAD_FILE (conservative)', () => {
  it('flags an unimported source file but never an entry/route/type/config/test', () => {
    const fs = scanAppGraph({
      'src/main.ts': "import { a } from './a';\n",   // entry → never dead
      'src/a.ts': 'export const a = 1;',              // imported → not dead
      'src/orphan.ts': 'export const o = 1;',         // nothing imports it → DEAD
      'src/pages/home.tsx': 'export default () => null;', // route dir → never dead
      'src/types.d.ts': 'export type T = number;',    // decl → never dead
      'vite.config.ts': 'export default {};',         // config → never dead
      'src/a.test.ts': "import { a } from './a';",     // test → never dead
    }, true);
    const dead = cat(fs, 'maintainability');
    expect(dead).toHaveLength(1);
    expect(dead[0].file).toBe('src/orphan.ts');
    expect(dead[0].severity).toBe('low');
  });

  it('does not run dead-file detection on an incomplete fileset', () => {
    const fs = scanAppGraph({ 'src/orphan.ts': 'export const o = 1;' }, false);
    expect(cat(fs, 'maintainability')).toHaveLength(0);
  });
});
