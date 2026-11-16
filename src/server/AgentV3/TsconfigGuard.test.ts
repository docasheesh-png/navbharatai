import { describe, it, expect } from 'vitest';
import * as ts from 'typescript';
import { isTsconfigPath, ensureTsconfigBaseUrl, ensureTsconfigJsx, healTsconfigConflictTail, isClearlyReactApp } from './TsconfigGuard';
import { parseTsconfigJsonc } from './FrameworkFoundation';

describe('isTsconfigPath', () => {
  it('matches tsconfig.json and variants but not tsconfig.node.json', () => {
    expect(isTsconfigPath('tsconfig.json')).toBe(true);
    expect(isTsconfigPath('tsconfig.app.json')).toBe(true);
    expect(isTsconfigPath('packages/web/tsconfig.json')).toBe(true);
    expect(isTsconfigPath('tsconfig.node.json')).toBe(false);
    expect(isTsconfigPath('vite.config.ts')).toBe(false);
    expect(isTsconfigPath('src/App.tsx')).toBe(false);
  });
});

describe('ensureTsconfigBaseUrl — restore baseUrl/paths when a rewrite wiped them (#1305 regression guard)', () => {
  it('injects baseUrl:"src" + @/* paths when a tsconfig has NEITHER', () => {
    const before = JSON.stringify({ compilerOptions: { jsx: 'react-jsx', strict: true }, include: ['src'] }, null, 2);
    const after = JSON.parse(ensureTsconfigBaseUrl('tsconfig.json', before));
    expect(after.compilerOptions.baseUrl).toBe('src');
    expect(after.compilerOptions.paths).toEqual({ '@/*': ['*'] });
    expect(after.compilerOptions.strict).toBe(true); // existing options preserved
    expect(after.include).toEqual(['src']);
  });

  it('proves the restored config actually resolves a baseUrl import via the real TS resolver', () => {
    const restored = JSON.parse(ensureTsconfigBaseUrl('tsconfig.json', JSON.stringify({ compilerOptions: { jsx: 'react-jsx' } })));
    const { options } = ts.convertCompilerOptionsFromJson(restored.compilerOptions, '/proj');
    const existing = new Set(['/proj/src/stores/useBoardStore.ts', '/proj/src/components/Dashboard.tsx']);
    const host: ts.ModuleResolutionHost = { fileExists: (f) => existing.has(f.replace(/\\/g, '/')), readFile: () => '', directoryExists: () => true, getDirectories: () => [] };
    const resolved = ts.resolveModuleName('stores/useBoardStore', '/proj/src/components/Dashboard.tsx', options, host).resolvedModule?.resolvedFileName;
    expect(resolved).toBe('/proj/src/stores/useBoardStore.ts');
  });

  it('respects a deliberate baseUrl (no-op when baseUrl is already set)', () => {
    const before = JSON.stringify({ compilerOptions: { baseUrl: '.' } });
    expect(ensureTsconfigBaseUrl('tsconfig.json', before)).toBe(before);
  });

  it('respects deliberate paths (no-op when paths is already set)', () => {
    const before = JSON.stringify({ compilerOptions: { paths: { '~/*': ['./src/*'] } } });
    expect(ensureTsconfigBaseUrl('tsconfig.json', before)).toBe(before);
  });

  it('no-ops for a non-tsconfig file, a commented (non-strict-JSON) tsconfig, and no compilerOptions', () => {
    expect(ensureTsconfigBaseUrl('src/App.tsx', '{}')).toBe('{}');
    const commented = '{\n  // a comment\n  "compilerOptions": {}\n}';
    expect(ensureTsconfigBaseUrl('tsconfig.json', commented)).toBe(commented); // JSON.parse fails → untouched
    const noCo = JSON.stringify({ include: ['src'] });
    expect(ensureTsconfigBaseUrl('tsconfig.json', noCo)).toBe(noCo);
  });

  it('never touches tsconfig.node.json (the vite-config project has no app sources)', () => {
    const before = JSON.stringify({ compilerOptions: { composite: true } });
    expect(ensureTsconfigBaseUrl('tsconfig.node.json', before)).toBe(before);
  });
});


const OPEN = '<'.repeat(7);
const CLOSE = '>'.repeat(7);

/** The clean prefix of this report's model-written tsconfig (comments, no jsx, DOM lib, no references). */
const BR1982_TSCONFIG_PREFIX = `{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,

    /* Bundler mode */
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,

    /* Linting */
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
`;

/** The leftover apply-patch tail captured on this report's tsconfig snapshot. */
const BR1982_TSCONFIG_TAIL = `${OPEN} SEARCH
  "references": [{ "path": "./tsconfig.node.json" }]
}
=======
}
${CLOSE} REPLACE>>>
`;

describe('healTsconfigConflictTail — drop a leftover apply-patch tail (BR1982)', () => {
  it("this report's tsconfig (valid JSONC prefix + SEARCH/REPLACE tail) keeps only the prefix", () => {
    const landed = BR1982_TSCONFIG_PREFIX + BR1982_TSCONFIG_TAIL;
    const healed = healTsconfigConflictTail('tsconfig.json', landed);
    expect(healed).toBe(BR1982_TSCONFIG_PREFIX);
    expect(healed.startsWith(OPEN) || healed.includes('\n' + OPEN)).toBe(false);
  });

  it('neighbour: a clean tsconfig is untouched, and a non-tsconfig is untouched even with a tail', () => {
    expect(healTsconfigConflictTail('tsconfig.json', BR1982_TSCONFIG_PREFIX)).toBe(BR1982_TSCONFIG_PREFIX);
    const md = 'Notes\n' + OPEN + ' SEARCH\nhello\n' + CLOSE + ' END\n';
    expect(healTsconfigConflictTail('README.md', md)).toBe(md);
    expect(healTsconfigConflictTail('tsconfig.node.json', md)).toBe(md);
  });

  it('neighbour: if the prefix is not parseable, the file is left alone (no invented salvage)', () => {
    const broken = '{ not json\n' + OPEN + ' SEARCH\n}\n';
    expect(healTsconfigConflictTail('tsconfig.json', broken)).toBe(broken);
  });
});


const REACT = { framework: 'vite-react' as const };

describe('ensureTsconfigJsx — add react-jsx only on a clearly-React DOM tsconfig (BR1982)', () => {
  it("this report's prefix (DOM lib, no jsx, vite-react) gains jsx: react-jsx and keeps its comments", () => {
    const after = ensureTsconfigJsx('tsconfig.json', BR1982_TSCONFIG_PREFIX, REACT);
    const parsed = parseTsconfigJsonc(after);
    expect(parsed).not.toBeNull();
    expect((parsed!.compilerOptions as { jsx: string }).jsx).toBe('react-jsx');
    expect((parsed!.compilerOptions as { moduleResolution: string }).moduleResolution).toBe('bundler');
    expect(parsed!.include).toEqual(['src']);
    expect((parsed!.compilerOptions as { lib: string[] }).lib).toEqual(['ES2020', 'DOM', 'DOM.Iterable']);
    expect(after).toContain('/* Bundler mode */');
    expect(after).toContain('/* Linting */');
    // ensureTsconfigBaseUrl's commented-tsconfig contract stays intact: comments still block a rewrite.
    expect(ensureTsconfigBaseUrl('tsconfig.json', after)).toBe(after);
  });

  it('neighbour: without React evidence the file is left alone, so TS17004 stays visible', () => {
    expect(ensureTsconfigJsx('tsconfig.json', BR1982_TSCONFIG_PREFIX)).toBe(BR1982_TSCONFIG_PREFIX);
    expect(isClearlyReactApp(undefined)).toBe(false);
    expect(isClearlyReactApp({})).toBe(false);
  });

  it('neighbour: an existing jsx value is never overwritten (preserve / react / react-jsx)', () => {
    for (const jsx of ['preserve', 'react', 'react-jsx']) {
      const before = JSON.stringify({ compilerOptions: { jsx, lib: ['DOM'] } });
      expect(ensureTsconfigJsx('tsconfig.json', before, REACT)).toBe(before);
    }
  });

  it('neighbour: a Node tsconfig (no DOM lib) is left alone even on a React app', () => {
    const node = JSON.stringify({ compilerOptions: { module: 'NodeNext', lib: ['ES2020'] } }, null, 2);
    expect(ensureTsconfigJsx('tsconfig.json', node, REACT)).toBe(node);
  });

  it('neighbour: Next.js (jsx dropped, plugins next; or package.json with next) is left alone — Next needs preserve', () => {
    const nextMissingJsx = JSON.stringify({
      compilerOptions: {
        lib: ['dom', 'dom.iterable', 'esnext'],
        moduleResolution: 'bundler',
        plugins: [{ name: 'next' }],
      },
    }, null, 2);
    const reactAndNext = JSON.stringify({ dependencies: { react: '^18', next: '^15' } });
    expect(ensureTsconfigJsx('tsconfig.json', nextMissingJsx, { framework: 'nextjs' })).toBe(nextMissingJsx);
    expect(ensureTsconfigJsx('tsconfig.json', nextMissingJsx, { packageJson: reactAndNext })).toBe(nextMissingJsx);
    expect(ensureTsconfigJsx('tsconfig.json', nextMissingJsx, { framework: 'vite-react', packageJson: reactAndNext })).toBe(nextMissingJsx);
  });

  it('neighbour: the official Vue shape, and a Vue app with jsx dropped, are left alone', () => {
    const officialVue = JSON.stringify({
      compilerOptions: {
        target: 'ES2020',
        lib: ['ES2020', 'DOM', 'DOM.Iterable'],
        moduleResolution: 'bundler',
        jsx: 'preserve',
      },
      include: ['src/**/*.ts', 'src/**/*.vue'],
    }, null, 2);
    expect(ensureTsconfigJsx('tsconfig.json', officialVue, { framework: 'vue' })).toBe(officialVue);
    const vueDropped = JSON.stringify({ compilerOptions: { lib: ['DOM'] } }, null, 2);
    const vuePkg = JSON.stringify({ dependencies: { vue: '^3' } });
    expect(ensureTsconfigJsx('tsconfig.json', vueDropped, { framework: 'vue' })).toBe(vueDropped);
    expect(ensureTsconfigJsx('tsconfig.json', vueDropped, { framework: 'vite-react', packageJson: vuePkg })).toBe(vueDropped);
  });

  it('neighbour: Solid (jsxImportSource solid-js, jsx dropped) is left alone', () => {
    const solid = JSON.stringify({
      compilerOptions: { lib: ['ES2020', 'DOM', 'DOM.Iterable'], jsxImportSource: 'solid-js' },
    }, null, 2);
    const solidPkg = JSON.stringify({ dependencies: { 'solid-js': '^1' } });
    expect(ensureTsconfigJsx('tsconfig.json', solid, { framework: 'solid' })).toBe(solid);
    expect(ensureTsconfigJsx('tsconfig.json', solid, { framework: 'vite-react', packageJson: solidPkg })).toBe(solid);
  });

  it('neighbour: Preact with both jsx and jsxImportSource dropped is left alone', () => {
    const preactDropped = JSON.stringify({
      compilerOptions: { lib: ['ES2020', 'DOM', 'DOM.Iterable'] },
    }, null, 2);
    const preactPkg = JSON.stringify({ dependencies: { preact: '^10' } });
    expect(ensureTsconfigJsx('tsconfig.json', preactDropped, { framework: 'preact' })).toBe(preactDropped);
    expect(ensureTsconfigJsx('tsconfig.json', preactDropped, { framework: 'vite-react', packageJson: preactPkg })).toBe(preactDropped);
  });

  it('neighbour: a child tsconfig with extends is left alone', () => {
    const child = JSON.stringify({
      extends: './tsconfig.base.json',
      compilerOptions: { lib: ['DOM'] },
    }, null, 2);
    expect(ensureTsconfigJsx('tsconfig.json', child, REACT)).toBe(child);
    expect(ensureTsconfigJsx('tsconfig.app.json', child, REACT)).toBe(child);
  });

  it('neighbour: a commented tsconfig that is not clearly React is left alone (baseUrl contract too)', () => {
    const commented = '{\n  // a comment\n  "compilerOptions": { "lib": ["DOM"] }\n}';
    expect(ensureTsconfigJsx('tsconfig.json', commented)).toBe(commented);
    expect(ensureTsconfigBaseUrl('tsconfig.json', commented)).toBe(commented);
  });

  it('neighbour: tsconfig.node.json and a non-tsconfig are left alone', () => {
    const src = JSON.stringify({ compilerOptions: { lib: ['DOM'] } });
    expect(ensureTsconfigJsx('tsconfig.node.json', src, REACT)).toBe(src);
    expect(ensureTsconfigJsx('src/App.tsx', src, REACT)).toBe(src);
  });

  it('a package.json with react and no next/vue/solid/preact is enough even without a framework label', () => {
    const pkg = JSON.stringify({ dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' } });
    const after = ensureTsconfigJsx('tsconfig.json', BR1982_TSCONFIG_PREFIX, { packageJson: pkg });
    expect(parseTsconfigJsonc(after)!.compilerOptions).toMatchObject({ jsx: 'react-jsx' });
    expect(after).toContain('/* Bundler mode */');
  });
});

describe('the write-door compose: strip then jsx (vite-react) on this report\'s exact file', () => {
  it('produces a tsconfig with jsx, no markers, kept comments, and no invented references', () => {
    const landed = BR1982_TSCONFIG_PREFIX + BR1982_TSCONFIG_TAIL;
    const out = ensureTsconfigBaseUrl(
      'tsconfig.json',
      ensureTsconfigJsx('tsconfig.json', healTsconfigConflictTail('tsconfig.json', landed), REACT),
    );
    const json = parseTsconfigJsonc(out);
    expect(json).not.toBeNull();
    expect((json!.compilerOptions as { jsx: string }).jsx).toBe('react-jsx');
    expect((json!.compilerOptions as { moduleResolution: string }).moduleResolution).toBe('bundler');
    expect(json!.references).toBeUndefined();
    expect(out).toContain('/* Bundler mode */');
    expect(out.includes(OPEN) || out.includes('\n' + CLOSE) || out.startsWith(CLOSE)).toBe(false);
    // Comments remain, so the baseUrl rewrite must not fire.
    expect(out).toBe(ensureTsconfigJsx('tsconfig.json', healTsconfigConflictTail('tsconfig.json', landed), REACT));
  });
});
