import { describe, it, expect } from 'vitest';
import { reconcileImportExports, reconcileAndReanalyze, addMissingProjectImports, fixWrongSourceImports } from './ImportExportReconcile';

describe('reconcileImportExports — the reported bug (named import of a default export)', () => {
  it('rewrites `import { App } from "./App"` to a default import when App is the default export', async () => {
    const r = await reconcileImportExports({
      'src/App.tsx': `export default function App() { return null; }`,
      'src/App.test.tsx': `import { App } from './App';\nexport const t = App;`,
    });
    expect(r.fixes).toHaveLength(1);
    expect(r.fixes[0].kind).toBe('named-to-default');
    expect(r.fixes[0].name).toBe('App');
    expect(r.files['src/App.test.tsx']).toContain(`import App from './App'`);
    expect(r.files['src/App.test.tsx']).not.toContain(`{ App }`);
  });

  it('handles a const default export (`const Watch = …; export default Watch`)', async () => {
    const r = await reconcileImportExports({
      'src/Watch.tsx': `const Watch = () => null;\nexport default Watch;`,
      'src/Watch.test.tsx': `import { Watch } from './Watch';\nexport const t = Watch;`,
    });
    expect(r.fixes).toHaveLength(1);
    expect(r.files['src/Watch.test.tsx']).toContain(`import Watch from './Watch'`);
  });

  it('fixes all three broken test imports from the fae70e42 report and clears the readiness blocker', async () => {
    const { fixes, report } = await reconcileAndReanalyze({
      'src/App.tsx': `export default function App() { return null; }`,
      'src/Watch.tsx': `export default function Watch() { return null; }`,
      'src/WatchHand.tsx': `export default function WatchHand() { return null; }`,
      'src/App.test.tsx': `import { App } from './App';`,
      'src/Watch.test.tsx': `import { Watch } from './Watch';`,
      'src/WatchHand.test.tsx': `import { WatchHand } from './WatchHand';`,
    });
    expect(fixes).toHaveLength(3);
    expect(report.ok).toBe(true); // the build-breaking blocker is gone after the deterministic repair
  });

  it('preserves other named imports on the same statement (moves only the default one)', async () => {
    const r = await reconcileImportExports({
      'src/mod.tsx': `export default function App() { return null; }\nexport const helper = 1;`,
      'src/use.tsx': `import { App, helper } from './mod';\nexport const t = [App, helper];`,
    });
    expect(r.fixes).toHaveLength(1);
    const out = r.files['src/use.tsx'];
    expect(out).toContain('App');
    expect(out).toContain('helper');
    // App became the default; helper stays named.
    expect(out).toMatch(/import App, \{ ?helper ?\} from '\.\/mod'/);
  });
});

describe('reconcileImportExports — default import of a named export (Case B)', () => {
  it('rewrites `import Thing from "./m"` to a named import when Thing is a named export', async () => {
    const r = await reconcileImportExports({
      'src/m.ts': `export const Thing = 1;`,
      'src/use.ts': `import Thing from './m';\nexport const t = Thing;`,
    });
    expect(r.fixes).toHaveLength(1);
    expect(r.fixes[0].kind).toBe('default-to-named');
    expect(r.files['src/use.ts']).toMatch(/import \{ ?Thing ?\} from '\.\/m'/);
  });
});

describe('reconcileImportExports — safety (never guess, never break a working build)', () => {
  it('does nothing when the import is already correct', async () => {
    const files = {
      'src/App.tsx': `export default function App() { return null; }`,
      'src/App.test.tsx': `import App from './App';`,
    };
    const r = await reconcileImportExports(files);
    expect(r.fixes).toHaveLength(0);
    expect(r.files).toEqual(files);
  });

  it('does NOT touch a named import that is a real named export', async () => {
    const r = await reconcileImportExports({
      'src/m.ts': `export const foo = 1;`,
      'src/use.ts': `import { foo } from './m';`,
    });
    expect(r.fixes).toHaveLength(0);
  });

  it('does NOT act on an anonymous default export (no name to match)', async () => {
    const r = await reconcileImportExports({
      'src/m.tsx': `export default () => null;`,
      'src/use.tsx': `import { Thing } from './m';`,
    });
    expect(r.fixes).toHaveLength(0); // can't prove the intent — leave the real blocker for the agent
  });

  it('does NOT act when the default name differs from the imported name (coincidence guard)', async () => {
    const r = await reconcileImportExports({
      'src/m.tsx': `export default function Widget() { return null; }`,
      'src/use.tsx': `import { Sidebar } from './m';`,
    });
    expect(r.fixes).toHaveLength(0);
  });

  it('does NOT act on aliased named imports (`{ App as X }`)', async () => {
    const r = await reconcileImportExports({
      'src/App.tsx': `export default function App() { return null; }`,
      'src/use.tsx': `import { App as Root } from './App';`,
    });
    expect(r.fixes).toHaveLength(0);
  });

  it('ignores external packages and unresolved local files', async () => {
    const r = await reconcileImportExports({
      'src/use.tsx': `import { useState } from 'react';\nimport { Gone } from './missing';`,
    });
    expect(r.fixes).toHaveLength(0);
  });

  it('never throws on unparseable content, returns files unchanged', async () => {
    const files = { 'src/broken.tsx': 'import { <<< from ./', 'src/ok.ts': 'export const a = 1;' };
    const r = await reconcileImportExports(files);
    expect(Array.isArray(r.fixes)).toBe(true);
    expect(r.files['src/ok.ts']).toBe('export const a = 1;');
  });

  it('returns an empty fix list for a non-code file set', async () => {
    const r = await reconcileImportExports({ 'README.md': 'import { x } from "./y"' });
    expect(r.fixes).toHaveLength(0);
  });
});

describe('addMissingProjectImports — the jungle-game bug (uses a shared const without importing it)', () => {
  it('adds the forgotten value import (CANVAS_HEIGHT used, only the type was imported)', async () => {
    const r = await addMissingProjectImports({
      'src/game/constants.ts': `export const CANVAS_WIDTH = 800;\nexport const CANVAS_HEIGHT = 450;\nexport interface LayerConfig { id: number }`,
      'src/game/Background.ts': `import type { LayerConfig } from './constants';\nexport class Background {\n  draw(ctx: any) { ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT); }\n}`,
    });
    expect(r.added.length).toBe(2); // CANVAS_WIDTH + CANVAS_HEIGHT
    const out = r.files['src/game/Background.ts'];
    expect(out).toContain('import { CANVAS_HEIGHT } from "./constants"');
    expect(out).toContain('import { CANVAS_WIDTH } from "./constants"');
  });

  it('computes the correct relative path across folders', async () => {
    const r = await addMissingProjectImports({
      'src/game/constants.ts': `export const SPEED = 5;`,
      'src/App.tsx': `export default function App() { return SPEED; }`,
    });
    expect(r.added).toHaveLength(1);
    expect(r.files['src/App.tsx']).toContain('from "./game/constants"');
  });

  it('does NOT add when the name is already imported (even as the wrong kind is left to the reconciler)', async () => {
    const r = await addMissingProjectImports({
      'src/c.ts': `export const X = 1;`,
      'src/use.ts': `import { X } from './c';\nexport const y = X;`,
    });
    expect(r.added).toHaveLength(0);
  });

  // ── THE FIGHT-3D REGRESSION (admin report, build 5e2de8c4, 2026-08-27) ──────────────────────────
  //
  // A working 3D fighting game was turned into a build that would not compile BY THIS FUNCTION. It
  // could not see a DEFAULT import, so it added a named import of a symbol that was already bound:
  //
  //     import ErrorBoundary from './ErrorBoundary';        ← already there
  //     import { ErrorBoundary } from "./ErrorBoundary";    ← added by us → Duplicate declaration
  //
  // The whole build then failed on `src/main.tsx: Duplicate declaration "ErrorBoundary"`. These tests
  // encode every import form, because the bug was not "we forgot default" — it was that the guard was
  // inferred from identifier parents instead of read off the import declarations.
  it('THE REPORTED BUG: does NOT add when the name is already a DEFAULT import', async () => {
    const r = await addMissingProjectImports({
      'src/ErrorBoundary.tsx': `export class ErrorBoundary {}\nexport default ErrorBoundary;`,
      'src/main.tsx': `import ErrorBoundary from './ErrorBoundary';\nexport const el = ErrorBoundary;`,
    });
    expect(r.added).toHaveLength(0);
    // The precise symptom: two declarations of one name in one file is a PARSE error, not a lint nit.
    expect(r.files['src/main.tsx']).toBe(`import ErrorBoundary from './ErrorBoundary';\nexport const el = ErrorBoundary;`);
  });

  it('does NOT add when the name is bound by an ALIAS (the local binding is the alias)', async () => {
    const r = await addMissingProjectImports({
      'src/c.ts': `export const helper = 1;\nexport const other = 2;`,
      'src/use.ts': `import { other as helper } from './c';\nexport const y = helper;`,
    });
    // `helper` is bound locally by the alias — adding an import of it would collide.
    expect(r.added).toHaveLength(0);
  });

  it('does NOT add when the name is bound by a NAMESPACE import', async () => {
    const r = await addMissingProjectImports({
      'src/c.ts': `export const THREE = 1;`,
      'src/use.ts': `import * as THREE from './c';\nexport const y = THREE;`,
    });
    expect(r.added).toHaveLength(0);
  });

  it('does NOT add when default and named imports are combined on one line', async () => {
    const r = await addMissingProjectImports({
      'src/c.tsx': `export const Named = 1;\nconst Def = 2;\nexport default Def;`,
      'src/use.ts': `import Def, { Named } from './c';\nexport const y = [Def, Named];`,
    });
    expect(r.added).toHaveLength(0);
  });

  it('still DOES add the genuinely missing import — the fix must not make the healer useless', async () => {
    const r = await addMissingProjectImports({
      'src/c.ts': `export const SPEED = 5;`,
      'src/use.tsx': `import React from 'react';\nexport const y = SPEED;`,
    });
    expect(r.added).toHaveLength(1);
    expect(r.added[0].name).toBe('SPEED');
  });

  it('does NOT add for a locally-declared name (never shadow/duplicate)', async () => {
    const r = await addMissingProjectImports({
      'src/c.ts': `export const X = 1;`,
      'src/use.ts': `const X = 99;\nexport const y = X;`,
    });
    expect(r.added).toHaveLength(0);
  });

  it('does NOT add for an ambiguous name exported by 2+ modules', async () => {
    const r = await addMissingProjectImports({
      'src/a.ts': `export const DUP = 1;`,
      'src/b.ts': `export const DUP = 2;`,
      'src/use.ts': `export const y = DUP;`,
    });
    expect(r.added).toHaveLength(0);
  });

  it('does NOT add for a property access (obj.CANVAS_HEIGHT is not a free variable)', async () => {
    const r = await addMissingProjectImports({
      'src/c.ts': `export const CANVAS_HEIGHT = 450;`,
      'src/use.ts': `const cfg = { CANVAS_HEIGHT: 1 };\nexport const y = cfg.CANVAS_HEIGHT;`,
    });
    expect(r.added).toHaveLength(0);
  });

  it('does NOT touch a name that is not a project export (globals/typos left alone)', async () => {
    const r = await addMissingProjectImports({
      'src/c.ts': `export const X = 1;`,
      'src/use.ts': `export const y = window.innerHeight + Math.PI;`,
    });
    expect(r.added).toHaveLength(0);
  });

  it('never throws on unparseable content', async () => {
    const files = { 'src/broken.tsx': 'const <<< =', 'src/c.ts': 'export const X = 1;' };
    const r = await addMissingProjectImports(files);
    expect(Array.isArray(r.added)).toBe(true);
  });
})

describe('fixWrongSourceImports — a named import pointing at the WRONG module (Kanban build 2026-07-13)', () => {
  it('rewrites the import source when the symbol lives in exactly one OTHER module', async () => {
    const r = await fixWrongSourceImports({
      'src/utils/dateUtils.ts': `export function formatDate(d: Date) { return d.toISOString(); }`,
      'src/utils/formatters.ts': `export function formatDueDate(d: Date) { return d.toDateString(); }`,
      'src/components/Card.tsx': `import { formatDueDate } from '../utils/dateUtils';\nexport const Card = () => formatDueDate(new Date());`,
    });
    expect(r.fixes).toHaveLength(1);
    expect(r.fixes[0]).toMatchObject({ name: 'formatDueDate', file: 'src/components/Card.tsx' });
    const out = r.files['src/components/Card.tsx'];
    expect(out).toContain('formatDueDate'); // still imported…
    expect(out).toContain('../utils/formatters'); // …but now from the RIGHT module
    expect(out).not.toMatch(/import\s*\{\s*formatDueDate\s*\}\s*from\s*['"]\.\.\/utils\/dateUtils['"]/); // not the wrong one
  });

  it('moves ONLY the wrong name out of a multi-name import; the correctly-sourced name stays put', async () => {
    const r = await fixWrongSourceImports({
      'src/utils/dateUtils.ts': `export function formatDate(d: Date) { return ''; }`,
      'src/utils/formatters.ts': `export function formatDueDate(d: Date) { return ''; }`,
      'src/components/Card.tsx': `import { formatDate, formatDueDate } from '../utils/dateUtils';\nexport const Card = () => formatDate(new Date()) + formatDueDate(new Date());`,
    });
    expect(r.fixes).toHaveLength(1);
    const out = r.files['src/components/Card.tsx'];
    expect(out).toMatch(/import\s*\{\s*formatDate\s*\}\s*from\s*['"]\.\.\/utils\/dateUtils['"]/); // formatDate stays on dateUtils
    expect(out).toMatch(/formatDueDate.*from\s*['"]\.\.\/utils\/formatters['"]/); // formatDueDate moved to formatters
  });

  it('preserves a local alias when moving the import', async () => {
    const r = await fixWrongSourceImports({
      'src/a.ts': `export const realThing = 1;`,
      'src/wrong.ts': `export const other = 2;`,
      'src/use.ts': `import { realThing as rt } from './wrong';\nexport const y = rt;`,
    });
    expect(r.fixes).toHaveLength(1);
    expect(r.fixes[0].alias).toBe('rt');
    expect(r.files['src/use.ts']).toMatch(/realThing as rt.*from\s*['"]\.\/a['"]/);
  });

  it('does NOT act when the name is exported by 2+ modules (ambiguous → never guess)', async () => {
    const r = await fixWrongSourceImports({
      'src/a.ts': `export const DUP = 1;`,
      'src/b.ts': `export const DUP = 2;`,
      'src/wrong.ts': `export const filler = 0;`,
      'src/use.ts': `import { DUP } from './wrong';\nexport const y = DUP;`,
    });
    expect(r.fixes).toHaveLength(0);
    expect(r.files['src/use.ts']).toContain("from './wrong'"); // untouched
  });

  it('does NOT act when the name is exported NOWHERE (genuinely missing → the LLM must add it)', async () => {
    const r = await fixWrongSourceImports({
      'src/types.ts': `export interface Board { id: string }`,
      'src/BoardView.tsx': `import { ID } from './types';\nexport const v: ID = '1' as any;`,
    });
    expect(r.fixes).toHaveLength(0);
  });

  it('does NOT act when the current module already exports the name (correct source, left alone)', async () => {
    const r = await fixWrongSourceImports({
      'src/a.ts': `export const X = 1;`,
      'src/use.ts': `import { X } from './a';\nexport const y = X;`,
    });
    expect(r.fixes).toHaveLength(0);
  });

  it('stays out when the target uses a wildcard re-export (`export *` — the name could be there)', async () => {
    const r = await fixWrongSourceImports({
      'src/real.ts': `export const thing = 1;`,
      'src/barrel.ts': `export * from './real';`, // barrel MIGHT surface `thing`
      'src/use.ts': `import { thing } from './barrel';\nexport const y = thing;`,
    });
    expect(r.fixes).toHaveLength(0); // conservative — don't rewrite past a wildcard
  });

  it('never touches a default or namespace import', async () => {
    const r = await fixWrongSourceImports({
      'src/a.ts': `const A = 1; export default A;`,
      'src/other.ts': `export const A = 9;`,
      'src/use.ts': `import A from './a';\nimport * as NS from './a';\nexport const y = A + (NS as any).x;`,
    });
    expect(r.fixes).toHaveLength(0);
  });

  it('never throws on unparseable content', async () => {
    const r = await fixWrongSourceImports({ 'src/broken.tsx': 'import { <<< } from', 'src/c.ts': 'export const X = 1;' });
    expect(Array.isArray(r.fixes)).toBe(true);
  });
})
