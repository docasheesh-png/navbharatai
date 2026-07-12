import { describe, it, expect } from 'vitest';
import { reconcileImportExports, reconcileAndReanalyze } from './ImportExportReconcile';

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
