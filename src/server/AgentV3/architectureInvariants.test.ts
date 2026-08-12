import { describe, it, expect } from 'vitest';
import {
  deriveInvariants, renderInvariants, checkInvariants, invariantSummary,
  detectStylingSystem, detectImportStyle, detectApiHub,
  type DeriveInput, type Invariant,
} from './architectureInvariants';

/**
 * THE ONE THING THAT MUST NOT HAPPEN HERE IS A FALSE ACCUSATION.
 *
 * This module tells the builder what a project's own rules are, and then reports when an edit broke
 * one. Both halves are worthless the moment either invents a rule the project never made — an
 * invariant we imagined becomes an instruction to rewrite working code in OUR house style, and a
 * violation we imagined becomes a warning nobody reads. So most of what follows is about the cases
 * where the honest answer is "this project has not decided that", not about the happy path.
 */

const input = (o: Partial<DeriveInput>): DeriveInput => ({ files: [], imports: {}, ...o });

describe('styling system — one, or none at all', () => {
  it('reads Tailwind from the project\'s own config file', () => {
    expect(detectStylingSystem(input({ files: ['tailwind.config.js', 'src/App.tsx'] }))).toBe('tailwind');
  });

  it('reads Tailwind v4, which declares itself in the stylesheet instead', () => {
    // v4 dropped the config file for CSS-first config; a project on v4 is no less a Tailwind project.
    const got = detectStylingSystem(input({
      files: ['src/index.css'], contents: { 'src/index.css': '@import "tailwindcss";' },
    }));
    expect(got).toBe('tailwind');
  });

  it('reads styled-components from the dependency, not from a guess', () => {
    expect(detectStylingSystem(input({ files: ['src/App.tsx'], dependencies: ['styled-components'] })))
      .toBe('styled-components');
  });

  it('needs TWO module stylesheets before calling it a system', () => {
    // One stray *.module.css in a big app is a file, not an architecture.
    expect(detectStylingSystem(input({ files: ['src/a.module.css'] }))).toBeNull();
    expect(detectStylingSystem(input({ files: ['src/a.module.css', 'src/b.module.css'] }))).toBe('css-modules');
  });

  it('REFUSES TO CHOOSE for a project that genuinely uses two', () => {
    // A repo with Tailwind pages and a CSS-module design system is not making a mistake. Picking a
    // winner here would make us rewrite half of somebody's working app.
    const got = detectStylingSystem(input({
      files: ['tailwind.config.js', 'src/a.module.css', 'src/b.module.css'],
    }));
    expect(got).toBeNull();
  });

  it('says nothing about a project that styles by no system', () => {
    expect(detectStylingSystem(input({ files: ['src/App.tsx', 'src/index.css'] }))).toBeNull();
  });
});

describe('import style — and the half of it that is a build breaker', () => {
  const aliasHeavy = {
    'src/a.tsx': ['@/lib/x', '@/lib/y', '@/components/z', 'react'],
    'src/b.tsx': ['@/lib/x', '@/lib/q', '@/hooks/h', './local'],
    'src/c.tsx': ['@/lib/x', '@/lib/y'],
  };

  it('recognises a project that imports through an alias', () => {
    expect(detectImportStyle(input({ imports: aliasHeavy }))).toEqual({ style: 'alias', alias: '@/' });
  });

  it('recognises a project that has NO alias — the more important direction', () => {
    // Writing `@/x` into a project whose bundler has no such alias is not untidy, it fails to resolve.
    const got = detectImportStyle(input({
      imports: {
        'src/a.tsx': ['./x', '../y', './z', 'react'],
        'src/b.tsx': ['./p', '../../q', './r'],
        'src/c.tsx': ['./s', './t'],
      },
    }));
    expect(got).toEqual({ style: 'relative', alias: '@/' });
  });

  it('stays silent on a genuinely mixed project', () => {
    expect(detectImportStyle(input({
      imports: {
        'src/a.tsx': ['@/x', '@/y', './p', './q'],
        'src/b.tsx': ['@/z', './r', './s', '../t'],
      },
    }))).toBeNull();
  });

  it('stays silent on a project too small to have a convention', () => {
    expect(detectImportStyle(input({ imports: { 'src/a.tsx': ['@/x', '@/y'] } }))).toBeNull();
  });

  it('ignores test files when reading the convention', () => {
    // Tests import their subject relatively far more often than app code does; counting them would
    // drag a genuinely alias-based project below the threshold.
    const got = detectImportStyle(input({
      imports: { ...aliasHeavy, 'src/a.test.tsx': ['./a', './b', './c', './d', './e', './f', './g', './h'] },
    }));
    expect(got).toEqual({ style: 'alias', alias: '@/' });
  });
});

describe('the API hub — only when the project has really held the line', () => {
  const hub = 'src/lib/api.ts';
  const withHub = (extra: Record<string, string> = {}, imports: Record<string, string[]> = {}): DeriveInput => input({
    files: [hub, 'src/pages/A.tsx', 'src/pages/B.tsx', 'src/pages/C.tsx', ...Object.keys(extra)],
    contents: {
      [hub]: 'export const get = (u: string) => fetch(u).then(r => r.json());',
      'src/pages/A.tsx': 'import { get } from "@/lib/api";',
      'src/pages/B.tsx': 'import { get } from "@/lib/api";',
      'src/pages/C.tsx': 'import { get } from "@/lib/api";',
      ...extra,
    },
    imports: {
      'src/pages/A.tsx': ['@/lib/api'], 'src/pages/B.tsx': ['@/lib/api'], 'src/pages/C.tsx': ['@/lib/api'],
      ...imports,
    },
  });

  it('finds it when three modules go through it and nobody goes around it', () => {
    expect(detectApiHub(withHub())).toEqual({ file: hub, importers: 3 });
  });

  it('REFUSES when even one other file already calls the network directly', () => {
    // There is no convention to protect if the project itself does not keep it. Claiming one would
    // mean warning about a new file for doing exactly what an existing file does.
    const got = detectApiHub(withHub({ 'src/pages/D.tsx': 'const r = await fetch("/x");' }));
    expect(got).toBeNull();
  });

  it('refuses when barely anyone imports it — one caller is not a convention', () => {
    const got = detectApiHub(input({
      files: [hub, 'src/pages/A.tsx'],
      contents: { [hub]: 'fetch("/x")', 'src/pages/A.tsx': 'import "@/lib/api";' },
      imports: { 'src/pages/A.tsx': ['@/lib/api'] },
    }));
    expect(got).toBeNull();
  });

  it('refuses when there are two candidate hubs — we would be picking one arbitrarily', () => {
    const got = detectApiHub(input({
      files: ['src/lib/api.ts', 'src/services/httpClient.ts'],
      contents: {
        'src/lib/api.ts': 'fetch("/a")',
        'src/services/httpClient.ts': 'axios.get("/b")',
      },
      imports: {},
    }));
    expect(got).toBeNull();
  });

  it('needs contents — it never guesses a hub from a filename alone', () => {
    expect(detectApiHub(input({ files: ['src/lib/api.ts'], imports: {} }))).toBeNull();
  });

  it('a file named like a hub that never touches the network is not one', () => {
    const got = detectApiHub(input({
      files: ['src/lib/apiTypes.ts', 'src/pages/A.tsx'],
      contents: { 'src/lib/apiTypes.ts': 'export interface User { id: string }', 'src/pages/A.tsx': 'x' },
      imports: { 'src/pages/A.tsx': ['@/lib/apiTypes'] },
    }));
    expect(got).toBeNull();
  });
});

describe('deriving the whole set', () => {
  const project = (): DeriveInput => input({
    files: [
      'tailwind.config.js', 'src/lib/api.ts', 'src/store/useAppStore.ts',
      'src/pages/Home.tsx', 'src/pages/Orders.tsx', 'src/pages/Settings.tsx',
      'src/server/index.ts', 'src/components/Button.tsx',
    ],
    dependencies: ['tailwindcss', 'zustand'],
    contents: {
      'src/lib/api.ts': 'export const get = (u: string) => fetch(u);',
      'src/pages/Home.tsx': 'import { get } from "@/lib/api";',
      'src/pages/Orders.tsx': 'import { get } from "@/lib/api";',
      'src/pages/Settings.tsx': 'import { get } from "@/lib/api";',
    },
    imports: {
      // Deliberately over the 8-internal-import floor: below it there is no convention to observe,
      // only a handful of imports, and the detector correctly says nothing.
      'src/pages/Home.tsx': ['@/lib/api', '@/store/useAppStore', '@/components/Button', 'react'],
      'src/pages/Orders.tsx': ['@/lib/api', '@/components/Button', '@/store/useAppStore', 'react'],
      'src/pages/Settings.tsx': ['@/lib/api', '@/store/useAppStore'],
      'src/components/Button.tsx': ['react'],
    },
  });

  it('reads every rule this project has actually made', () => {
    const kinds = deriveInvariants(project()).map((i) => i.kind).sort();
    expect(kinds).toEqual(['data-access', 'import-alias', 'layering', 'page-location', 'state-store', 'styling']);
  });

  it('EVERY invariant carries its evidence — a rule with no observation behind it is our opinion', () => {
    for (const inv of deriveInvariants(project())) {
      expect(inv.evidence, inv.kind).toBeTruthy();
      expect(inv.rule, inv.kind).toBeTruthy();
    }
  });

  it('every CHECKED invariant carries the data the checker needs', () => {
    // Without this the check would have to parse its own sentence back out of `rule`, and a reword
    // would switch it off in silence.
    for (const inv of deriveInvariants(project()).filter((i) => i.checked)) {
      expect(Object.keys(inv.params ?? {}), inv.kind).not.toHaveLength(0);
    }
  });

  it('a brand-new project has no rules yet, so it gets none', () => {
    expect(deriveInvariants(input({}))).toEqual([]);
    expect(renderInvariants(deriveInvariants(input({})))).toBe('');
  });

  it('survives junk input rather than taking a build down with it', () => {
    expect(deriveInvariants(null as unknown as DeriveInput)).toEqual([]);
    expect(deriveInvariants({ files: ['a.ts'] } as unknown as DeriveInput)).toEqual([]);
  });

  it('the prompt block says these came from the project, not from us', () => {
    const block = renderInvariants(deriveInvariants(project()));
    expect(block).toContain('observed from its own code');
    expect(block).toContain('not general best practices');
    // The escape hatch matters: a user who ASKS to switch styling must not be argued with.
    expect(block).toContain('If the user explicitly asks to change one of these');
  });
});

describe('checking what the edit actually wrote', () => {
  const tailwindAliasHub: Invariant[] = [
    { kind: 'styling', rule: 'r', evidence: 'e', checked: true, params: { styling: 'tailwind' } },
    { kind: 'import-alias', rule: 'r', evidence: 'e', checked: true, params: { importStyle: 'alias' } },
    { kind: 'data-access', rule: 'r', evidence: 'e', checked: true, params: { apiHub: 'src/lib/api.ts' } },
  ];

  it('catches a second styling system arriving in a new page', () => {
    const v = checkInvariants(tailwindAliasHub, {
      'src/pages/New.tsx': 'import styled from "styled-components";\nexport const X = styled.div``;',
    });
    expect(v.map((x) => x.kind)).toContain('styling');
    expect(v[0].detail).toContain('styled-components');
  });

  it('catches a CSS module landing in a Tailwind app', () => {
    const v = checkInvariants(tailwindAliasHub, { 'src/pages/New.tsx': 'import s from "./New.module.css";' });
    expect(v.map((x) => x.kind)).toContain('styling');
  });

  it('catches a page that goes around the API layer', () => {
    const v = checkInvariants(tailwindAliasHub, { 'src/pages/New.tsx': 'const r = await fetch("/api/x");' });
    expect(v.map((x) => x.kind)).toContain('data-access');
    expect(v[0].detail).toContain('src/lib/api.ts');
  });

  it('does NOT accuse the hub itself of calling the network', () => {
    expect(checkInvariants(tailwindAliasHub, { 'src/lib/api.ts': 'fetch("/x")' })).toEqual([]);
  });

  it('does not mistake refetch() or a method call for a direct network call', () => {
    // The obvious `content.includes("fetch(")` would flag every react-query page in existence.
    const v = checkInvariants(tailwindAliasHub, {
      'src/pages/New.tsx': 'const { refetch } = useQuery(); refetch(); queryClient.fetchQuery();',
    });
    expect(v).toEqual([]);
  });

  it('catches a deep relative import in an alias project', () => {
    const v = checkInvariants(tailwindAliasHub, { 'src/pages/New.tsx': 'import { x } from "../../lib/x";' });
    expect(v.map((k) => k.kind)).toContain('import-alias');
  });

  it('leaves ordinary sibling imports alone', () => {
    // `./x` and `../x` are normal even in an alias project; only a deep climb is drift.
    expect(checkInvariants(tailwindAliasHub, { 'src/pages/New.tsx': 'import { x } from "./x";\nimport { y } from "../y";' }))
      .toEqual([]);
  });

  it('in a NO-ALIAS project, an aliased import is the violation — it will not resolve', () => {
    const noAlias: Invariant[] = [
      { kind: 'import-alias', rule: 'r', evidence: 'e', checked: true, params: { importStyle: 'relative' } },
    ];
    const v = checkInvariants(noAlias, { 'src/pages/New.tsx': 'import { x } from "@/lib/x";' });
    expect(v).toHaveLength(1);
    expect(v[0].detail).toContain('no such alias');
  });

  it('a clean edit produces nothing at all', () => {
    const v = checkInvariants(tailwindAliasHub, {
      'src/pages/New.tsx': 'import { get } from "@/lib/api";\nexport default () => <div className="p-4">hi</div>;',
    });
    expect(v).toEqual([]);
  });

  it('STATED-ONLY invariants never produce a violation', () => {
    // Layering is detectable, but ArchitectureAnalysis already owns that detection. Two modules
    // reporting one defect is how the two of them drift apart.
    const stated: Invariant[] = [{ kind: 'layering', rule: 'r', evidence: 'e', checked: false }];
    expect(checkInvariants(stated, { 'src/components/A.tsx': 'import x from "../server/db";' })).toEqual([]);
  });

  it('test files are not judged — they legitimately break every one of these rules', () => {
    expect(checkInvariants(tailwindAliasHub, {
      'src/pages/New.test.tsx': 'import { x } from "../../lib/x"; fetch("/x");',
    })).toEqual([]);
  });

  it('non-source files are ignored', () => {
    expect(checkInvariants(tailwindAliasHub, { 'README.md': 'fetch( and ../../ and styled-components' })).toEqual([]);
  });

  it('the violation list is capped so one bad build cannot flood the report', () => {
    const changed: Record<string, string> = {};
    for (let i = 0; i < 30; i += 1) changed[`src/pages/P${i}.tsx`] = 'const r = await fetch("/x");';
    expect(checkInvariants(tailwindAliasHub, changed).length).toBeLessThanOrEqual(8);
  });

  it('no invariants means no work and no findings', () => {
    expect(checkInvariants([], { 'src/a.tsx': 'fetch("/x")' })).toEqual([]);
  });
});

describe('why the baseline must exclude the build\'s own writes', () => {
  // This is the failure mode the wiring is shaped to avoid, demonstrated on the pure functions so the
  // reason survives even if the call site is refactored.
  const before: DeriveInput = input({
    files: ['tailwind.config.js', 'src/pages/A.tsx', 'src/pages/B.tsx', 'src/pages/C.tsx'],
    dependencies: ['tailwindcss'],
  });
  const offendingFile = { 'src/pages/New.tsx': 'import styled from "styled-components";' };

  it('judged against the project as it WAS, the drift is caught', () => {
    const invs = deriveInvariants(before);
    expect(checkInvariants(invs, offendingFile).map((v) => v.kind)).toEqual(['styling']);
  });

  it('judged against the project as it BECAME, the same edit exonerates itself', () => {
    // Both styling systems are now present, so there is no single system to keep to — the rule
    // dissolves and the build reports itself clean. Marking your own exam.
    const after = input({ ...before, dependencies: ['tailwindcss', 'styled-components'] });
    expect(deriveInvariants(after).some((i) => i.kind === 'styling')).toBe(false);
    expect(checkInvariants(deriveInvariants(after), offendingFile)).toEqual([]);
  });
});

describe('the sentence the report prints', () => {
  const invs: Invariant[] = [
    { kind: 'styling', rule: 'r', evidence: 'e', checked: true, params: { styling: 'tailwind' } },
    { kind: 'layering', rule: 'r', evidence: 'e', checked: false },
  ];

  it('says plainly how many rules were machine-checked, not just how many exist', () => {
    // "2 rules held" would overstate it when only one of them is actually verifiable.
    const s = invariantSummary(invs, []);
    expect(s).toContain('2 observed architecture rule(s)');
    expect(s).toContain('1 of them machine-checked');
  });

  it('names the file and what it did when a rule was broken', () => {
    const s = invariantSummary(invs, [
      { kind: 'styling', file: 'src/pages/New.tsx', detail: 'it styles with something else', rule: 'r' },
    ]);
    expect(s).toContain('src/pages/New.tsx');
    expect(s).toContain('it styles with something else');
  });
});

/**
 * THE WIRING. A pure module nobody calls is a module that does nothing, and this codebase has shipped
 * that mistake before (ADRManager sat dead in AppMakerLab while the live engine re-decided the stack
 * from scratch on every build). Both halves are asserted at their real call sites.
 */
describe('it is actually wired into a build', () => {
  const routes = require('fs').readFileSync(
    require('path').join(__dirname, '../routes/agentv3.ts'), 'utf8',
  ) as string;

  it('PREVENT — the rules reach the edit prompt before a line is written', () => {
    expect(routes).toContain('deriveInvariants(');
    expect(routes).toContain('renderInvariants(');
    expect(routes).toContain('AGENTV3_ARCH_INVARIANTS');
  });

  it('DETECT — the files the build changed are checked against them', () => {
    expect(routes).toContain('checkInvariants(');
    expect(routes).toContain('ARCHITECTURE_INVARIANT_VIOLATED');
  });

  it('the baseline EXCLUDES this build\'s own writes', () => {
    // Deriving from the post-build project would let a build that broke the convention in five new
    // files redefine the convention, and then report itself clean.
    expect(routes).toContain('invariantBaseline');
    expect(routes).toContain('// The project as it was BEFORE this build touched it');
  });

  it('the baseline DEPENDENCIES are filtered too, not just the file list', () => {
    // The subtle half of the same trap: a build that adds `styled-components` puts it in the graph's
    // dependency list, the project then looks like it has always used two styling systems, the
    // invariant dissolves, and the edit that broke it reports itself clean.
    expect(routes).toContain('const baseDeps = new Set<string>()');
    expect(routes).toContain('if (writtenFiles.has(f)) continue;');
  });

  it('it can never fail a build — every finding is advisory', () => {
    const at = routes.indexOf('ARCHITECTURE_INVARIANT_VIOLATED');
    expect(at).toBeGreaterThan(-1);
    const near = routes.slice(at - 900, at + 900);
    expect(near).toContain("severity: 'warning'");
    expect(near).not.toContain('result.ok = false');
  });
});
