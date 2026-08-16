/**
 * A STORE APP THAT OPENS BLANK IS WORSE THAN ONE THAT NEVER PUBLISHED.
 *
 * Sibling of the mobile-ship asset bug (#2400), found by asking the obvious follow-up: what ELSE
 * assembles a snapshot from `loadWorkspaceFiles()` and sends it somewhere it must run alone?
 *
 * The App Store snapshot is TEXT ONLY — binary assets live in their own durable store, and this gate
 * already refuses large files with "large assets don't belong in published source". So an app whose
 * code says `import logo from './logo.png'` published with no `logo.png` anywhere in it.
 *
 * 🔒 IN A BROWSER THAT IS NOT A BROKEN IMAGE — IT IS A BLANK PAGE. The store runs the snapshot as ES
 * modules, so an unresolvable module import kills the whole entry. The viewer gets nothing.
 *
 * And `proveBrowserRunnable` already refuses exactly this shape of failure on its own stated principle
 * — it blocks `import.meta.glob` because an app that renders with no routes is "working-looking and
 * wrong, which is worse than an honest refusal". It simply had no check for a missing asset.
 *
 * 🔒 REFUSAL HERE, ONLY A NOTE ON THE MOBILE PATH — deliberately. There the user ships their own app to
 * their own repo and the call is theirs; this ships to strangers under our name.
 */

import { describe, it, expect } from 'vitest';
import { evaluateWebPublish } from '../src/server/lib/navStoreWeb';
import { unshippableAssetImports } from '../src/server/lib/assetImports';

/** A minimal app the prover already accepts, so these tests isolate the ASSET rule. */
const app = (extra: Record<string, string>): Record<string, string> => ({
  'index.html': '<div id="root"></div>',
  'src/main.jsx': `import App from './App';\nexport default App;`,
  ...extra,
});

describe('🔒 publishing is refused when the app cannot load its own images', () => {
  it('names the missing file and says what the viewer would see', () => {
    const r = evaluateWebPublish(app({ 'src/App.jsx': `import logo from './logo.png';\nexport default () => null;` }));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('logo.png');
    expect(r.reason).toContain('blank');
    // A refused publish must carry nothing forward — the caller writes `gate.files`.
    expect(r.files).toEqual({});
  });

  it('counts them honestly when there are several', () => {
    const r = evaluateWebPublish(app({
      'src/App.jsx': `import a from './a.png';\nimport b from './b.jpg';\nimport c from './c.woff2';\nimport d from './d.mp4';\nexport default () => null;`,
    }));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('4 image/font file(s)');
    expect(r.reason).toContain('+1 more');
  });
});

describe('🔒 it must not refuse an app that is genuinely fine', () => {
  it('an app with no asset imports publishes', () => {
    const r = evaluateWebPublish(app({ 'src/App.jsx': `export default () => null;` }));
    expect(r.ok).toBe(true);
  });

  it('🔒 an <img src> is NOT an import — the file may be served, and we do not guess', () => {
    const r = evaluateWebPublish(app({ 'src/App.jsx': `export default () => <img src="/logo.png"/>;` }));
    expect(r.ok).toBe(true);
  });

  it('a remote or inline image needs nothing from the snapshot', () => {
    const r = evaluateWebPublish(app({
      'src/App.jsx': `import a from 'https://cdn.example.com/x.png';\nimport b from 'data:image/png;base64,AAA';\nexport default () => null;`,
    }));
    expect(r.ok).toBe(true);
  });

  it('the asset being present — under any prefix — publishes', () => {
    const r = evaluateWebPublish(app({
      'src/App.jsx': `import logo from './logo.png';\nexport default () => null;`,
      'public/logo.png': 'x',
    }));
    expect(r.ok).toBe(true);
  });

  it('a missing CODE import is left to the checks that own it, not double-reported here', () => {
    const r = evaluateWebPublish(app({ 'src/App.jsx': `import { Button } from './Button';\nexport default () => null;` }));
    expect(r.reason ?? '').not.toContain('image/font');
  });
});

describe('the shared predicate — one definition, two callers', () => {
  it('is the same function both surfaces use', () => {
    expect(unshippableAssetImports({ 'a.js': `import x from './x.png';` })).toEqual(['./x.png']);
    expect(unshippableAssetImports({ 'a.js': `import x from './x.png';` }, { 'x.png': 1 })).toEqual([]);
  });

  it('survives junk without throwing', () => {
    expect(unshippableAssetImports(null)).toEqual([]);
    expect(unshippableAssetImports(undefined, undefined)).toEqual([]);
    expect(unshippableAssetImports({ 'a.js': null as never })).toEqual([]);
  });
});
