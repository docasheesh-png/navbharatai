import { describe, it, expect } from 'vitest';
import { buildReactPreview } from './ReactPreview';
import { VirtualFileSystem } from '../project/ProjectModel';

/**
 * The in-browser preview's boot watchdog (admin 2026-08-05: "app ban gayi hai — kitne bhi din baad
 * kholo, preview pehle jaisa chale").
 *
 * A fully-built app reopened days later showed "The preview did not start within 45 seconds… npm
 * packages are still downloading". `bareLoadErrors` was EMPTY — nothing had failed. A working preview
 * was killed mid-load by a flat timeout, and that timeout had already been raised once (25s → 45s) for
 * exactly the same reason. Any fixed ceiling is wrong for SOME app on SOME network, and the bigger the
 * project the more certainly it is wrong.
 *
 * So the watchdog watches PROGRESS instead. These tests pin that property, and — more importantly —
 * that the generated browser code still parses: this file builds JS inside a template string, where a
 * mis-escaped character produces a blank preview in every browser that no .ts test would catch.
 */
const APP = VirtualFileSystem.fromRecord({
  'package.json': JSON.stringify({ dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1', axios: '^1.6.0' } }),
  'index.html': '<!doctype html><html><body><div id="root"></div></body></html>',
  'src/main.tsx': "import React from 'react';\nimport { createRoot } from 'react-dom/client';\ncreateRoot(document.getElementById('root')).render(React.createElement('h1', null, 'hi'));",
});

describe('in-browser preview boot watchdog', () => {
  it('EVERY inline script in the generated page parses as real JavaScript', async () => {
    // Parsed with esbuild, not `new Function`: the page carries an importmap (JSON) and Babel-typed
    // JSX blocks, none of which are classic scripts. esbuild is already a dependency and understands
    // each flavour, so this checks the real thing rather than a convenient subset.
    const { transform } = await import('esbuild');
    const html = buildReactPreview(APP);
    const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)]
      .map((m) => ({ attrs: m[1], body: m[2] }))
      .filter((s) => s.body.trim());
    expect(scripts.length).toBeGreaterThan(0);

    let checked = 0;
    for (const { attrs, body } of scripts) {
      if (/type\s*=\s*["'](?:importmap|application\/json)["']/i.test(attrs)) continue;  // JSON, not JS
      const jsx = /type\s*=\s*["']text\/babel["']/i.test(attrs);
      await expect(
        transform(body, { loader: jsx ? 'jsx' : 'js', format: 'esm' }),
        `inline script #${checked} must parse`,
      ).resolves.toBeTruthy();
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('fails on a STALL, not on elapsed time', () => {
    const html = buildReactPreview(APP);
    expect(html).toContain('nbaiLastProgress');
    expect(html).toContain('STALL_MS');
    // The flat "did not start within 45 seconds" verdict is gone — that sentence was the false failure.
    expect(html).not.toContain('did not start within 45 seconds');
    // A pathological loop still ends, far out, so "no ceiling" never means "forever".
    expect(html).toContain('HARD_CEILING_MS');
  });

  it('counts every module resolution as progress — including a definitive failure', () => {
    // A package that fails on all rungs must ALSO stamp progress, or one dead dependency would stall
    // the watchdog and mask the real, specific error the loader already produced. The `finally` is what
    // makes that true for loaded and failed alike, so neither path can drift from the other.
    const html = buildReactPreview(APP);
    const stamps = html.match(/nbaiProgress\(\)/g) ?? [];
    expect(stamps.length).toBeGreaterThanOrEqual(4);
    expect(html).toContain('nbaiPending--; nbaiPkgsDone++; nbaiProgress();');
  });

  it('does not call an in-flight download a stall — packages load in PARALLEL', () => {
    // The hole in a naive stall check: one big dependency (firebase, @mui) can still be streaming long
    // after every small one finished, leaving a quiet gap that looks exactly like a hang. Firing then
    // would reproduce the very false failure this watchdog replaced, just with a different number.
    const html = buildReactPreview(APP);
    expect(html).toContain('nbaiPending === 0 && Date.now() - nbaiLastProgress > STALL_MS');
    expect(html).toContain('nbaiPending++');
  });

  it('bounds each package with its own deadline so pending can never stick above zero', () => {
    // A CDN that accepts the connection and then never answers is the one hang a stall check cannot
    // see: import() would stay pending forever and, with the guard above, suppress the watchdog
    // entirely. Every rung races this deadline, so the wait always terminates with an honest reason.
    const html = buildReactPreview(APP);
    expect(html).toContain('PKG_TIMEOUT_MS');
    const races = html.match(/Promise\.race\(\[import\(/g) ?? [];
    expect(races.length).toBe(3);   // all three CDN rungs, none left unbounded
  });

  it('shows real progress while loading, not just a rising clock', () => {
    // "12/34 packages" tells the user it is working. A bare seconds counter on a slow network reads
    // exactly like a hang — which is what sent this report in.
    const html = buildReactPreview(APP);
    expect(html).toContain("' packages · '");
    expect(html).toContain('nbaiPkgsTotal');
  });
});
