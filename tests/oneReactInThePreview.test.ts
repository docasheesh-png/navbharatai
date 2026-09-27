/**
 * ONE REACT IN THE PREVIEW — the core loads as a unit and is proven single before the app runs
 * (autopsy "Lekhan Sahyak", 2026-09-27).
 *
 * The in-browser preview loaded `react` from jsdelivr's fallback rung and `react-dom/client` from the
 * mirror. Two Reacts: the app's `useState` found no dispatcher and every render crashed with
 * "Cannot read properties of null (reading 'useState')". The live preview rendered the same files
 * perfectly. The user pressed "Fix with AI" five times and was billed ₹208 for `vite.config.ts` edits
 * that could never touch a fault living in our loader.
 *
 * These tests run the loader's REAL browser source against REAL copies of React: one copy must pass
 * the probe, two copies must fail it, and the loader must never hand the app a mixed group.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REACT_CORE_SPECS, REACT_CORE_LOADER_SOURCE } from '../src/server/runtime/reactCoreLoader';
import { buildReactPreview } from '../src/server/runtime/ReactPreview';
import { VirtualFileSystem } from '../src/server/project/ProjectModel';
import { isPreviewPlatformFault, REACT_SPLIT_FAULT_MESSAGE, PREVIEW_PLATFORM_FAULT_PREFIX } from '../src/lib/previewPlatformFault';
import { consoleRowFixable } from '../src/components/agentv3/previewConsole';
import { platformFixRequestPrompt, fixErrorAndContinuePrompt, inBrowserPreviewFixGuidance } from '../src/lib/platformFixRequest';

const req = createRequire(import.meta.url);
type Mods = Record<string, unknown>;

/** Just enough DOM for react-dom to render a component that returns nothing. */
function makeContainer() {
  const doc: Record<string, unknown> = { nodeType: 9, addEventListener() {}, removeEventListener() {}, activeElement: null };
  const el = {
    nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: doc, textContent: '',
    firstChild: null, childNodes: [], addEventListener() {}, removeEventListener() {}, appendChild() {}, removeChild() {},
  };
  doc.documentElement = el;
  return el;
}

const loader = new Function(`${REACT_CORE_LOADER_SOURCE}; return { nbaiReactIsSingle, nbaiLoadReactCore };`)() as {
  nbaiReactIsSingle: (mods: Mods, makeContainer: () => unknown) => boolean;
  nbaiLoadReactCore: (
    specs: readonly string[], rungs: Array<(s: string) => string>, importFn: (u: string) => Promise<unknown>,
    deadlineFn: (s: string) => Promise<never>, interopFn: (ns: unknown) => unknown, makeContainer: () => unknown,
  ) => Promise<{ mods: Mods | null; single: boolean; rung: number; errors: string[] }>;
};

const interop = (ns: unknown) => ns;
const never = () => new Promise<never>(() => {});

let copyA: Mods;
let copyB: unknown;
const hadWindow = 'window' in globalThis;

beforeAll(() => {
  // react-dom's client reads a few window fields while it renders; a browser has them all.
  if (!hadWindow) (globalThis as Record<string, unknown>).window = { event: undefined, HTMLIFrameElement: function HTMLIFrameElement() {}, addEventListener() {}, removeEventListener() {} };
  const react = req('react');
  copyA = { react, 'react-dom': req('react-dom'), 'react-dom/client': req('react-dom/client'), 'react/jsx-runtime': req('react/jsx-runtime') };
  // A SECOND React, exactly as a second CDN URL produces one: same code, separate module instance.
  for (const k of Object.keys(req.cache)) if (/[\\/]node_modules[\\/]react[\\/]/.test(k)) delete req.cache[k];
  copyB = req('react');
  expect(copyB).not.toBe(react);
});

// The stub window is deliberately left in place: react-dom's scheduler may still run a task after the
// last test, and vitest isolates this file's globals anyway.

describe('the probe measures, it does not assume', () => {
  it('one React passes', () => {
    expect(loader.nbaiReactIsSingle(copyA, makeContainer)).toBe(true);
  });

  it("the report's split — the app's react from one copy, react-dom from another — fails", () => {
    expect(loader.nbaiReactIsSingle({ ...copyA, react: copyB }, makeContainer)).toBe(false);
  });

  it('never prints: the dev build\'s "Invalid hook call" would reach the console mirror as an app error', () => {
    const spy = vi.spyOn(console, 'error');
    try {
      loader.nbaiReactIsSingle({ ...copyA, react: copyB }, makeContainer);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
    // …and the real console.error is back afterwards.
    expect(typeof console.error).toBe('function');
  });

  it('an incomplete group is not one React', () => {
    expect(loader.nbaiReactIsSingle({ react: copyA.react }, makeContainer)).toBe(false);
  });
});

describe('the group moves between rungs together — never a mix', () => {
  const rung = (n: number) => (s: string) => `r${n}:${s}`;

  it('one spec failing on rung 1 moves the WHOLE group to rung 2', async () => {
    const asked: string[] = [];
    const importFn = async (u: string) => {
      asked.push(u);
      if (u === 'r1:react') throw new Error('fetch failed');
      return copyA[u.slice(3)];
    };
    const r = await loader.nbaiLoadReactCore(REACT_CORE_SPECS, [rung(1), rung(2)], importFn, never, interop, makeContainer);
    expect(r.single).toBe(true);
    expect(r.rung).toBe(1);
    expect(r.errors[0]).toMatch(/rung 1: fetch failed/);
    for (const s of REACT_CORE_SPECS) expect(asked).toContain(`r2:${s}`);
  });

  it('a rung that loads but serves two Reacts is refused, and the next consistent rung wins', async () => {
    const importFn = async (u: string) => {
      const spec = u.slice(3);
      if (u.startsWith('r1:') && spec === 'react') return copyB; // the report's mixed page
      return copyA[spec];
    };
    const r = await loader.nbaiLoadReactCore(REACT_CORE_SPECS, [rung(1), rung(2)], importFn, never, interop, makeContainer);
    expect(r).toMatchObject({ single: true, rung: 1 });
    expect(r.mods?.react).toBe(copyA.react);
    expect(r.errors).toEqual(['rung 1: two copies of React']);
  });

  it('when no rung is consistent it says so — the page then refuses to mount the app', async () => {
    const importFn = async (u: string) => (u.slice(3) === 'react' ? copyB : copyA[u.slice(3)]);
    const r = await loader.nbaiLoadReactCore(REACT_CORE_SPECS, [rung(1), rung(2)], importFn, never, interop, makeContainer);
    expect(r.single).toBe(false);
    expect(r.mods).not.toBeNull();
  });

  it('when no rung loads the group at all, nothing is handed over', async () => {
    const r = await loader.nbaiLoadReactCore(REACT_CORE_SPECS, [rung(1)], async () => { throw new Error('offline'); }, never, interop, makeContainer);
    expect(r).toMatchObject({ mods: null, single: false });
  });

  it('a spec whose budget is spent counts as that rung failing', async () => {
    const importFn = () => new Promise(() => {});
    const deadline = () => Promise.reject(new Error('timed out after 180s'));
    const r = await loader.nbaiLoadReactCore(REACT_CORE_SPECS, [rung(1)], importFn, deadline, interop, makeContainer);
    expect(r.mods).toBeNull();
    expect(r.errors[0]).toMatch(/timed out/);
  });
});

describe('a fault that is ours is never offered as a paid repair', () => {
  it('the page marks it, the drawer refuses the button', () => {
    expect(isPreviewPlatformFault(REACT_SPLIT_FAULT_MESSAGE)).toBe(true);
    expect(consoleRowFixable('error', REACT_SPLIT_FAULT_MESSAGE)).toBe(false);
    expect(consoleRowFixable('error', `Preview error:\n${REACT_SPLIT_FAULT_MESSAGE}`)).toBe(false);
    // An ordinary app error keeps its button.
    expect(consoleRowFixable('error', "TypeError: Cannot read properties of undefined (reading 'map')")).toBe(true);
  });

  it('the words blame nobody and name no vendor', () => {
    expect(REACT_SPLIT_FAULT_MESSAGE.startsWith(PREVIEW_PLATFORM_FAULT_PREFIX)).toBe(true);
    expect(REACT_SPLIT_FAULT_MESSAGE).toMatch(/not the cause/);
    expect(REACT_SPLIT_FAULT_MESSAGE).not.toMatch(/jsdelivr|esm\.sh|cdn|vite/i);
  });
});

describe('the builder is told WHICH preview broke', () => {
  const REPORTED = "Cannot read properties of null (reading 'useState')\nTypeError: Cannot read properties of null (reading 'useState')\n    at X.r.useState (https://cdn.jsdelivr.net/npm/react@18.3.1/+esm:7:6304)";

  it("the report's own request carries the guidance: a renderer-only fault changes nothing", () => {
    const g = inBrowserPreviewFixGuidance(platformFixRequestPrompt(REPORTED));
    expect(g).toMatch(/QUICK IN-BROWSER PREVIEW/);
    expect(g).toMatch(/does NOT read vite\.config/);
    expect(g).toMatch(/Change NOTHING/);
    expect(g).toMatch(/never edit bundler config/);
  });

  it('it never tells the builder to ignore a real bug in the app\'s own files', () => {
    expect(inBrowserPreviewFixGuidance(platformFixRequestPrompt('x'))).toMatch(/it is a real bug: fix it/);
  });

  it('nothing else gets it — not a typed message, not the other platform templates', () => {
    expect(inBrowserPreviewFixGuidance('my app shows a blank screen, fix it')).toBe('');
    expect(inBrowserPreviewFixGuidance(fixErrorAndContinuePrompt('boom'))).toBe('');
    expect(inBrowserPreviewFixGuidance(null)).toBe('');
  });

  it('the route prepends it outside every best-effort block', () => {
    const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toMatch(/const previewFixHint = inBrowserPreviewFixGuidance\(prompt\);\n\s+if \(previewFixHint\) buildPrompt = `\$\{previewFixHint\}/);
    const at = route.indexOf('const previewFixHint = inBrowserPreviewFixGuidance(prompt);');
    expect(route.lastIndexOf('let buildPrompt = prompt;', at)).toBeGreaterThan(route.lastIndexOf('      try {\n', at));
  });
});

describe('🔒 the wiring — tsc and vitest cannot see a loader that stopped using the group', () => {
  const APP = VirtualFileSystem.fromRecord({
    'package.json': JSON.stringify({ dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' } }),
    'index.html': '<!doctype html><html><body><div id="root"></div></body></html>',
    'src/main.tsx': "import React from 'react';\nimport { createRoot } from 'react-dom/client';\ncreateRoot(document.getElementById('root')).render(React.createElement('h1', null, 'hi'));",
  });
  const html = buildReactPreview(APP);

  it('the page loads the core through the group loader, and the per-package ladder skips it', () => {
    expect(html).toContain('async function nbaiLoadReactCore(');
    expect(html).toContain('core = await nbaiLoadReactCore(REACT_CORE, coreRungs,');
    expect(html).toContain('bare = bare.filter(function (s) { return REACT_CORE.indexOf(s) < 0; });');
    expect(html.indexOf('core = await nbaiLoadReactCore(')).toBeLessThan(html.indexOf('await Promise.all(bare.map('));
  });

  it('a split React stops the boot with the platform message instead of mounting the app', () => {
    expect(html).toContain(`showError(${JSON.stringify(REACT_SPLIT_FAULT_MESSAGE)}, true);`);
    expect(html).toMatch(/platform: platform === true/);
  });

  it('the core never walks the unpinned "plain" rung, which could serve another major', () => {
    const src = readFileSync(join(__dirname, '..', 'src/server/runtime/ReactPreview.ts'), 'utf8');
    const block = src.slice(src.indexOf('var coreRungs = ['), src.indexOf('var core = { mods: null'));
    expect(block).not.toMatch(/ESM \+ s\b(?!.*slice)/);
    expect(block).toContain('specUrl, specUrlAlt');
  });
});
