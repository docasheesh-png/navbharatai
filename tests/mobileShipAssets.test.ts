/**
 * THE APP'S PICTURES HAVE TO GET ON THE PLANE.
 *
 * Found 2026-08-16 while tracing why the admin's APK builds kept failing on images. The ship path
 * builds the repo from `loadWorkspaceFiles()`, which is TEXT ONLY by design — binary assets live in
 * their own durable store (`WorkspaceAssetStore`) precisely so they cannot leak into the text map.
 * **Nothing on the ship path ever read that store.** `binaryFiles` carried the launcher ICON and
 * nothing else, so an imported app's logo, photos and fonts were persisted correctly and then left
 * behind: the pushed repo contained `import logo from './logo.png'` and no `logo.png`.
 *
 * On a static app that is a blank image. On a BUILT app it is a hard failure — Vite stops with
 * "Could not resolve ./logo.png" — which is the class of failure behind the blocked APK reports.
 *
 * 🔒 AND THE OTHER HALF: the earlier fix stopped the preflight calling an image "a missing library",
 * which was right, but it only corrected the SENTENCE. This is the condition that produced the
 * failure. Both halves, per the 50/50 law.
 */

import { describe, it, expect } from 'vitest';
import { assembleMobileProject } from '../src/server/lib/mobileProjectAssembler';
// Moved to its canonical home when the App Store's publish gate became the second caller — one
// definition of "which asset imports will not resolve", never a re-export creating two import paths.
import { unshippableAssetImports } from '../src/server/lib/assetImports';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const WOFF = 'data:font/woff2;base64,d09GMgABAAA=';

const builtApp = {
  'package.json': JSON.stringify({ name: 'app', scripts: { build: 'vite build' }, dependencies: { react: '18' } }),
  'index.html': '<div id="root"></div>',
  'src/main.tsx': 'import "./App";',
  'src/App.tsx': `import logo from './logo.png';\nexport default function App(){ return <img src={logo}/>; }\n`,
};

const opts = { appName: 'My App', appId: 'com.test.app' };

describe('🔒 the app’s own assets reach the pushed repo', () => {
  it('a logo in the asset store is pushed as real bytes', () => {
    const p = assembleMobileProject(builtApp, {}, { ...opts, appAssets: { 'src/logo.png': PNG } });
    expect(p.binaryFiles['src/logo.png']).toBe('iVBORw0KGgo=');
  });

  it('fonts and photos travel too, not just images', () => {
    const p = assembleMobileProject(builtApp, {}, {
      ...opts,
      appAssets: { 'src/logo.png': PNG, 'public/fonts/Inter.woff2': WOFF },
    });
    expect(Object.keys(p.binaryFiles).sort()).toEqual(['public/fonts/Inter.woff2', 'src/logo.png']);
  });

  it('🔒 the behaviour with NO assets is exactly what it was before', () => {
    const before = assembleMobileProject(builtApp, {}, opts);
    const after = assembleMobileProject(builtApp, {}, { ...opts, appAssets: {} });
    expect(after.binaryFiles).toEqual(before.binaryFiles);
    expect(after.files).toEqual(before.files);
  });

  it('🔒 the user’s chosen icon still wins a name collision — it is an explicit choice on that screen', () => {
    const p = assembleMobileProject(builtApp, {}, {
      ...opts,
      appAssets: { 'resources/icon.png': PNG },
      iconDataUrl: 'data:image/png;base64,QUJD',
    });
    expect(p.binaryFiles['resources/icon.png']).toBe('QUJD');
  });

  it('an unreadable asset is REPORTED, never silently dropped', () => {
    const p = assembleMobileProject(builtApp, {}, { ...opts, appAssets: { 'src/logo.png': 'not-a-data-uri' } });
    expect(p.binaryFiles['src/logo.png']).toBeUndefined();
    expect(p.notes.join(' ')).toContain('could not be read');
    expect(p.notes.join(' ')).toContain('src/logo.png');
  });
});

describe('🔒 what still cannot ship is stated as fact, not guessed', () => {
  it('names an image the code imports that is in neither map', () => {
    expect(unshippableAssetImports(builtApp, {})).toEqual(['./logo.png']);
  });

  it('says nothing once the asset is really there', () => {
    expect(unshippableAssetImports(builtApp, { 'src/logo.png': 'x' })).toEqual([]);
  });

  it('matches by basename, because a static app is re-rooted under the web dir', () => {
    expect(unshippableAssetImports(builtApp, { 'www/src/logo.png': 'x' })).toEqual([]);
  });

  it('🔒 ignores what the repo does not need to contain', () => {
    const files = {
      'a.tsx': [
        `import a from 'https://cdn.example.com/x.png';`,
        `import b from 'data:image/png;base64,AAA';`,
        `import c from './Button';`,      // code, not an asset — a different problem
        `import d from 'react';`,
      ].join('\n'),
    };
    expect(unshippableAssetImports(files, {})).toEqual([]);
  });

  it('handles the query suffix bundlers add', () => {
    expect(unshippableAssetImports({ 'a.tsx': `import u from './hero.png?url';` }, {})).toEqual(['./hero.png?url']);
    expect(unshippableAssetImports({ 'a.tsx': `import u from './hero.png?url';` }, { 'hero.png': 'x' })).toEqual([]);
  });

  it('survives junk without throwing', () => {
    expect(unshippableAssetImports({} as never, {} as never)).toEqual([]);
    expect(() => unshippableAssetImports(null as never, null as never)).not.toThrow();
  });
});

describe('🔒 the note the user reads', () => {
  it('a BUILT app is told the build will fail, because it will', () => {
    const p = assembleMobileProject(builtApp, {}, opts);
    const note = p.notes.join(' ');
    expect(note).toContain('./logo.png');
    expect(note).toContain('will fail');
  });

  it('a STATIC app is told the image will be blank, because that is what happens', () => {
    const staticApp = {
      'index.html': '<img src="logo.png">',
      'app.js': `import logo from './logo.png';`,
    };
    const p = assembleMobileProject(staticApp, {}, opts);
    expect(p.notes.join(' ')).toContain('blank');
  });

  it('a complete app gets NO note about assets — this must not nag', () => {
    const p = assembleMobileProject(builtApp, {}, { ...opts, appAssets: { 'src/logo.png': PNG } });
    expect(p.notes.join(' ')).not.toContain('not pushed');
  });
});
