import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { jsxDevRuntimeUrl, JSX_DEV_RUNTIME_PATH } from '../src/lib/jsxDevRuntimeFacade';

/**
 * ⚠️ EVERY REACT-19 APP'S IN-BROWSER PREVIEW WAS DEAD (admin build report 2026-08-25, whose prompt was
 * literally "ab to preview hi nahi chal raha, fix karo"):
 *
 *     Error: Run src/main.tsx: (0 , _jsxDevRuntime.jsxDEV) is not a function
 *
 * Proven from React's own source in this repo, not inferred:
 *
 *     // react/cjs/react-jsx-dev-runtime.production.js
 *     exports.Fragment = REACT_FRAGMENT_TYPE;
 *     exports.jsxDEV = void 0;          // ← literally undefined
 *
 * We compile the preview with Babel's DEVELOPMENT JSX runtime on purpose — `jsxDEV` carries
 * `_debugSource`, which the Visual Editor's click-to-source mapping is built on. React 19's entry picks
 * its build from NODE_ENV, a CDN serves production, and every `jsxDEV(...)` we emitted lands on
 * `void 0`. React 18 hid this for years because ITS production dev-runtime aliased jsxDEV to jsx.
 */
describe('the assumption this rests on, checked against React itself', () => {
  it("React 19's PRODUCTION dev-runtime really does export jsxDEV as undefined", () => {
    // If a future React makes this a real function, the facade becomes belt-and-braces rather than
    // load-bearing — and whoever notices should see this test and know that.
    const prod = readFileSync(
      join(__dirname, '..', 'node_modules/react/cjs/react-jsx-dev-runtime.production.js'), 'utf8');
    expect(prod).toContain('exports.jsxDEV = void 0');
  });
});

describe('the preview resolves jsx-dev-runtime to our own facade', () => {
  it('absolute when the origin is known — the iframe\'s base is not ours', () => {
    expect(jsxDevRuntimeUrl('https://navbharatai.com')).toBe('https://navbharatai.com/vendor/jsx-dev-runtime.mjs');
    expect(jsxDevRuntimeUrl('https://navbharatai.com/')).toBe('https://navbharatai.com/vendor/jsx-dev-runtime.mjs');
  });

  it('root-relative when it is not', () => {
    for (const v of ['', '   ', undefined]) expect(jsxDevRuntimeUrl(v)).toBe(JSX_DEV_RUNTIME_PATH);
  });

  it('all THREE importmaps use it — three copies is how two get fixed and one does not', () => {
    for (const p of [
      'src/lib/previewUtils.ts',
      'src/server/routes/preview.ts',
      'src/server/runtime/ReactPreview.ts',
    ]) {
      const src = readFileSync(join(__dirname, '..', p), 'utf8');
      expect(src, p).toContain('jsxDevRuntimeUrl(');
      expect(src, p).not.toContain("reactVer + '/jsx-dev-runtime'");
    }
  });
});

describe('the facade itself', () => {
  const facade = readFileSync(join(__dirname, '..', 'public/vendor/jsx-dev-runtime.mjs'), 'utf8');

  it('exists and exports what Babel calls', () => {
    expect(facade).toContain('export function jsxDEV');
    expect(facade).toContain('export const Fragment');
  });

  it('🔑 uses createElement and NOTHING else — the reason it is safe on every React', () => {
    // Stable public API, present in every build of every version, dev or prod. The alternative —
    // asking the CDN for the DEVELOPMENT bundle — would pair a dev jsx-runtime with a production React
    // and rely on their internals matching, which is a worse and stranger failure than this one.
    expect(facade).toContain('R.createElement');
    expect(facade).not.toMatch(/__CLIENT_INTERNALS|__SECRET_INTERNALS|ReactSharedInternals/);
  });

  it('takes React from the import map, not a window global', () => {
    // Outside the React-18 vendor path there is no `window.React` to read — that is the one difference
    // from the React-18 facade beside it.
    //
    // Asserted against the CODE with comments stripped: the file's own prose EXPLAINS that difference
    // and therefore names `window.React`, which a naive text match reads as using it. The same
    // comment-vs-code trap this repo already hit in firstPublish.test.ts.
    const code = facade.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code).toContain("import * as ReactNS from 'react'");
    expect(code).not.toContain('window.React');
  });

  it('fails LOUDLY if React does not resolve, rather than rendering nothing', () => {
    expect(facade).toContain("throw new Error('react/jsx-dev-runtime facade");
  });

  it('passes key through config, the way createElement expects', () => {
    expect(facade).toContain('key !== undefined ? { ...props, key } : props');
  });
});

describe('the React-18 vendored facade is untouched', () => {
  it('still reads window.React, because on that path the global really is there', () => {
    // It is in production and proven; changing it would be risk for no gain. It also overrides the base
    // mapping AFTER it, so React-18 apps keep exactly today's behaviour.
    const v18 = readFileSync(join(__dirname, '..', 'public/vendor/react18/jsx-dev-runtime.mjs'), 'utf8');
    expect(v18).toContain('window.React');
    expect(v18).toContain('export function jsxDEV');
  });
});
