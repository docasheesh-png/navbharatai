import { describe, it, expect } from 'vitest';
import { analyzeImportExports, resolveLocalTarget, exportRegenTargets, exportRegenInstruction, findCircularDependencies, findUnusedDependencies } from './ImportExportAnalysis';

describe('resolveLocalTarget', () => {
  const set = new Set(['src/lib/util.ts', 'src/components/Button.tsx', 'src/api/index.ts']);
  it('resolves with extension inference', () => {
    expect(resolveLocalTarget('src/App.tsx', './lib/util', set)).toBe('src/lib/util.ts');
    expect(resolveLocalTarget('src/pages/Home.tsx', '../components/Button', set)).toBe('src/components/Button.tsx');
  });
  it('resolves index files', () => {
    expect(resolveLocalTarget('src/App.tsx', './api', set)).toBe('src/api/index.ts');
  });
  it('returns null for external packages', () => {
    expect(resolveLocalTarget('src/App.tsx', 'react', set)).toBeNull();
  });
  it('returns null when nothing matches', () => {
    expect(resolveLocalTarget('src/App.tsx', './missing', set)).toBeNull();
  });
  it('resolves a NodeNext/ESM `.js`-extension import to its `.ts` source (SvelteKit — CollabDesk autopsy)', () => {
    const ts = new Set(['src/lib/types.ts', 'src/lib/cards.ts']);
    expect(resolveLocalTarget('src/lib/cards.ts', './types.js', ts)).toBe('src/lib/types.ts');
    expect(resolveLocalTarget('src/lib/cards.ts', './missing.js', ts)).toBeNull();
  });
});

describe('analyzeImportExports — clean (no false positives)', () => {
  it('accepts imports that match the target exports', async () => {
    const r = await analyzeImportExports({
      'src/util.ts': `export const add = (a,b)=>a+b;\nexport function sub(a,b){return a-b;}\nexport default function main(){}`,
      'src/App.tsx': `import main, { add, sub } from './util';\nexport function App(){ return add(1,2)+sub(3,1)+Number(main); }`,
    });
    expect(r.ok).toBe(true);
    expect(r.mismatches).toEqual([]);
    expect(r.filesScanned).toBe(2);
  });

  it('accepts a renamed import (import { X as Y }) when X is exported', async () => {
    const r = await analyzeImportExports({
      'src/util.ts': `export const original = 1;`,
      'src/App.tsx': `import { original as renamed } from './util';\nexport const v = renamed;`,
    });
    expect(r.ok).toBe(true);
  });

  it('accepts type imports of exported types', async () => {
    const r = await analyzeImportExports({
      'src/types.ts': `export interface User { id: string }\nexport type Role = 'admin' | 'user';`,
      'src/App.tsx': `import type { User, Role } from './types';\nexport const u: User = { id: 'x' }; export const r: Role = 'admin';`,
    });
    expect(r.ok).toBe(true);
  });

  it('stays silent for external packages and unresolved files', async () => {
    const r = await analyzeImportExports({
      'src/App.tsx': `import React from 'react';\nimport { thing } from './does-not-exist';\nexport const A = React;`,
    });
    expect(r.ok).toBe(true); // external + missing-file are not this checker's concern
  });

  it('stays silent when the target uses a wildcard re-export', async () => {
    const r = await analyzeImportExports({
      'src/barrel.ts': `export * from './somewhere';`,
      'src/App.tsx': `import { MaybeThere } from './barrel';\nexport const x = MaybeThere;`,
    });
    expect(r.ok).toBe(true); // export * could legitimately provide the name
  });

  it('resolves a name re-exported through a barrel file', async () => {
    const r = await analyzeImportExports({
      'src/widgets/Card.tsx': `export const Card = () => null;`,
      'src/widgets/index.ts': `export { Card } from './Card';`,
      'src/App.tsx': `import { Card } from './widgets';\nexport const A = Card;`,
    });
    expect(r.ok).toBe(true);
  });
});

describe('analyzeImportExports — mismatches', () => {
  it('flags a named import the target does not export', async () => {
    const r = await analyzeImportExports({
      'src/util.ts': `export const add = 1;`,
      'src/App.tsx': `import { add, subtract } from './util';\nexport const v = add;`,
    });
    expect(r.ok).toBe(false);
    expect(r.counts['named-import-not-exported']).toBe(1);
    expect(r.mismatches[0].imported).toBe('subtract');
    expect(r.mismatches[0].from).toBe('./util');
    expect(r.mismatches[0].kind).toBe('named-import-not-exported');
  });

  it('flags a default import when the target has no default export', async () => {
    const r = await analyzeImportExports({
      'src/util.ts': `export const add = 1;`,
      'src/App.tsx': `import util from './util';\nexport const v = util;`,
    });
    expect(r.ok).toBe(false);
    expect(r.counts['default-import-missing']).toBe(1);
    expect(r.mismatches[0].kind).toBe('default-import-missing');
  });

  it('reports the correct line and file, and finds multiple mismatches', async () => {
    const r = await analyzeImportExports({
      'src/a.ts': `export const one = 1;`,
      'src/b.tsx': `import { one, two } from './a';\nimport missing from './a';\nexport const x = one;`,
    });
    expect(r.mismatches).toHaveLength(2); // 'two' not exported + default missing
    const named = r.mismatches.find(m => m.kind === 'named-import-not-exported')!;
    expect(named.imported).toBe('two');
    expect(named.line).toBe(1);
  });
});

describe('analyzeImportExports — robustness', () => {
  it('returns honest zeros for a non-code file set', async () => {
    const r = await analyzeImportExports({ 'README.md': 'import { x } from "./y"' });
    expect(r.filesScanned).toBe(0);
    expect(r.ok).toBe(true);
  });

  it('does not throw on unparseable content', async () => {
    const r = await analyzeImportExports({ 'src/broken.tsx': 'import { <<< from ./', 'src/ok.ts': 'export const a = 1;' });
    expect(Array.isArray(r.mismatches)).toBe(true);
  });
});

describe('exportRegenTargets (deep-test App #7) — group missing exports by the file to regenerate', () => {
  it('maps the exact Trello case: cards.ts must export cardRoutes (truncated export)', async () => {
    // server/index.ts imports { cardRoutes } from './routes/cards', but cards.ts (truncated) doesn't export it.
    const files = {
      'server/index.ts': "import { cardRoutes } from './routes/cards';\nimport { authRoutes } from './routes/auth';\ncardRoutes; authRoutes;",
      'server/routes/cards.ts': 'export const router = 1;', // cardRoutes cut off by truncation
      'server/routes/auth.ts': 'export const authRoutes = 1;', // this one is fine
    };
    const rep = await analyzeImportExports(files);
    const targets = exportRegenTargets(rep, new Set(Object.keys(files)));
    expect(targets).toHaveLength(1);
    expect(targets[0].target).toBe('server/routes/cards.ts');
    expect(targets[0].missingNamed).toEqual(['cardRoutes']);
    expect(targets[0].neededBy[0]).toContain('server/index.ts');
    expect(exportRegenInstruction(targets)).toContain('server/routes/cards.ts MUST provide named export(s): cardRoutes');
  });

  it('groups multiple missing names on the same target file into one regen entry', async () => {
    const files = {
      'a.ts': "import { x, y } from './lib';\nx; y;",
      'b.ts': "import { z } from './lib';\nz;",
      'lib.ts': 'export const w = 1;',
    };
    const targets = exportRegenTargets(await analyzeImportExports(files), new Set(Object.keys(files)));
    expect(targets).toHaveLength(1);
    expect(targets[0].target).toBe('lib.ts');
    expect(targets[0].missingNamed).toEqual(['x', 'y', 'z']);
  });

  it('is empty when every import resolves to a real export (no false regen)', async () => {
    const files = {
      'a.ts': "import { ok } from './lib';\nok;",
      'lib.ts': 'export const ok = 1;',
    };
    expect(exportRegenTargets(await analyzeImportExports(files), new Set(Object.keys(files)))).toEqual([]);
  });
});

// Circular-dependency detection (theory → live; Vol 5 X.4 / Vol 6 C18 / Vol 7). Advisory, non-blocking.
describe('findCircularDependencies — local import cycles', () => {
  it('detects a two-file cycle A→B→A (both files, normalized to smallest first)', () => {
    const files = {
      'src/A.ts': `import { b } from './B';\nexport const a = 1;`,
      'src/B.ts': `import { a } from './A';\nexport const b = 2;`,
    };
    const cy = findCircularDependencies(files);
    expect(cy).toHaveLength(1);
    expect(cy[0].cycle).toEqual(['src/A.ts', 'src/B.ts']);
  });

  it('detects a three-file cycle A→B→C→A', () => {
    const files = {
      'src/A.ts': `import './B';`,
      'src/B.ts': `import './C';`,
      'src/C.ts': `import './A';`,
    };
    const cy = findCircularDependencies(files);
    expect(cy).toHaveLength(1);
    expect(cy[0].cycle).toEqual(['src/A.ts', 'src/B.ts', 'src/C.ts']);
  });

  it('detects a self-import as a 1-node cycle', () => {
    const files = { 'src/A.ts': `import { x } from './A';\nexport const x = 1;` };
    const cy = findCircularDependencies(files);
    expect(cy).toEqual([{ cycle: ['src/A.ts'] }]);
  });

  it('an ACYCLIC graph is never flagged (no false positive)', () => {
    const files = {
      'src/A.ts': `import './B';\nimport './C';`,
      'src/B.ts': `import './C';`,
      'src/C.ts': `export const c = 1;`,
    };
    expect(findCircularDependencies(files)).toHaveLength(0);
  });

  it('package imports never form edges (only local files can cycle)', () => {
    const files = {
      'src/A.ts': `import React from 'react';\nimport _ from 'lodash';\nexport const a = 1;`,
      'src/B.ts': `import { useState } from 'react';\nexport const b = 2;`,
    };
    expect(findCircularDependencies(files)).toHaveLength(0);
  });

  it('two INDEPENDENT cycles are both reported; an identical cycle is not double-counted', () => {
    const files = {
      'src/A.ts': `import './B';`,
      'src/B.ts': `import './A';`,
      'src/X.ts': `import './Y';`,
      'src/Y.ts': `import './X';`,
    };
    const cy = findCircularDependencies(files);
    expect(cy).toHaveLength(2);
    expect(cy.map((c) => c.cycle)).toContainEqual(['src/A.ts', 'src/B.ts']);
    expect(cy.map((c) => c.cycle)).toContainEqual(['src/X.ts', 'src/Y.ts']);
  });

  it('a commented-out import does not create an edge', () => {
    const files = {
      'src/A.ts': `import './B';`,
      'src/B.ts': `// import './A';\n/* import './A'; */\nexport const b = 1;`,
    };
    expect(findCircularDependencies(files)).toHaveLength(0);
  });
});

describe('findUnusedDependencies', () => {
  it('a dependency declared but never imported is reported', () => {
    const files = {
      'package.json': JSON.stringify({ dependencies: { lodash: '^4', axios: '^1' } }),
      'src/main.ts': `import axios from 'axios';\nconsole.log(axios);`,
    };
    expect(findUnusedDependencies(files)).toEqual([{ name: 'lodash' }]);
  });

  it('a dependency that IS imported (bare) is not reported', () => {
    const files = {
      'package.json': JSON.stringify({ dependencies: { axios: '^1' } }),
      'src/main.ts': `import axios from 'axios';`,
    };
    expect(findUnusedDependencies(files)).toHaveLength(0);
  });

  it('a scoped dep imported via a subpath is not reported (normalized to the package)', () => {
    const files = {
      'package.json': JSON.stringify({ dependencies: { '@tanstack/react-query': '^5' } }),
      'src/main.ts': `import { QueryClient } from '@tanstack/react-query/build/modern';`,
    };
    expect(findUnusedDependencies(files)).toHaveLength(0);
  });

  it('a plain dep imported via a subpath is not reported (react-dom/client)', () => {
    const files = {
      'package.json': JSON.stringify({ dependencies: { 'react-dom': '^18', 'date-fns': '^3' } }),
      'src/main.ts': `import { createRoot } from 'react-dom/client';\nimport { format } from 'date-fns/format';`,
    };
    expect(findUnusedDependencies(files)).toHaveLength(0);
  });

  it('implicit-use framework runtimes (react/react-dom) are never reported', () => {
    const files = {
      'package.json': JSON.stringify({ dependencies: { react: '^18', 'react-dom': '^18' } }),
      'src/App.tsx': `export const App = () => <div>hi</div>;`, // JSX, no explicit react import
    };
    expect(findUnusedDependencies(files)).toHaveLength(0);
  });

  it('Nuxt-provided deps (vue-router) are NOT reported when a nuxt.config is present (ShopSphere autopsy)', () => {
    const files = {
      'package.json': JSON.stringify({ dependencies: { nuxt: '^3', 'vue-router': '^4', lodash: '^4' } }),
      'nuxt.config.ts': `export default defineNuxtConfig({});`,
      // Nuxt auto-imports useRouter/<NuxtLink> — no file imports 'vue-router' directly, but it is NOT unused.
      'pages/index.vue': `<script setup>const r = useRouter();</script>`,
    };
    // vue-router is framework-provided → not flagged; lodash is genuinely unused → still flagged.
    expect(findUnusedDependencies(files)).toEqual([{ name: 'lodash' }]);
  });

  it('vue-router IS reported when there is no Nuxt (a plain Vue app must import it)', () => {
    const files = {
      'package.json': JSON.stringify({ dependencies: { vue: '^3', 'vue-router': '^4' } }),
      'src/main.ts': `import { createApp } from 'vue';`, // vue-router declared but never imported, no Nuxt
    };
    expect(findUnusedDependencies(files)).toEqual([{ name: 'vue-router' }]);
  });

  it('no package.json → empty (no crash)', () => {
    expect(findUnusedDependencies({ 'src/main.ts': `import x from 'x';` })).toHaveLength(0);
  });

  it('malformed package.json → empty (no crash)', () => {
    const files = { 'package.json': `{ not valid json `, 'src/main.ts': `` };
    expect(findUnusedDependencies(files)).toHaveLength(0);
  });

  it('an unused devDependency is NOT reported (only runtime dependencies inspected)', () => {
    const files = {
      'package.json': JSON.stringify({ dependencies: {}, devDependencies: { vitest: '^2' } }),
      'src/main.ts': ``,
    };
    expect(findUnusedDependencies(files)).toHaveLength(0);
  });

  it('a dep loaded via require() is not reported', () => {
    const files = {
      'package.json': JSON.stringify({ dependencies: { express: '^4' } }),
      'server.js': `const express = require('express');`,
    };
    expect(findUnusedDependencies(files)).toHaveLength(0);
  });

  it('a node builtin in a subpath import never counts as a package', () => {
    const files = {
      'package.json': JSON.stringify({ dependencies: { chalk: '^5' } }),
      'src/main.ts': `import { readFile } from 'node:fs/promises';\nimport path from 'path';`,
    };
    // chalk is declared, never imported → reported; the node builtins are ignored, no crash.
    expect(findUnusedDependencies(files)).toEqual([{ name: 'chalk' }]);
  });
});
