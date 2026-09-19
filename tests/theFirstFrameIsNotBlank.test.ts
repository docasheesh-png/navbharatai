import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * THE FIRST FRAME IS NOT BLANK (2026-09-19).
 *
 * The admin reported that opening NavBharatAI lags and "kuch der baad response aata hai". Measured on
 * an emulated slow-4G link with a mid-range phone CPU, `<div id="root"></div>` was empty, so the first
 * contentful paint was **3,600 ms** — three and a half seconds of blank page that answers nothing the
 * user does to it. With a boot frame inside `#root` it is **2,380 ms**, consistently across runs.
 *
 * ⚠️ This is about WHEN SOMETHING APPEARS, not when the app becomes usable — LCP is unchanged, and
 * these assertions deliberately claim nothing about interactivity.
 *
 * Every case below encodes a way the frame could silently stop working: emptied out, styled from the
 * render-blocking stylesheet it exists to beat, grown into fake UI, missing a theme, or stranded on
 * screen because the mount stopped replacing the container's children.
 */
describe('index.html — something paints before the JavaScript arrives', () => {
  const raw = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
  // Judge the MARKUP, never the prose about it: the comment above the frame quotes the empty
  // `<div id="root"></div>` it replaced, and the first draft of this test matched its own explanation.
  const html = raw.replace(/<!--[\s\S]*?-->/g, '');
  const main = readFileSync(join(__dirname, '..', 'src', 'main.tsx'), 'utf8');

  it('🔴 #root is not empty — an empty root is the 3.6-second blank screen', () => {
    expect(html).not.toMatch(/<div id="root"\s*>\s*<\/div>/);
    expect(html).toMatch(/<div id="root"\s*>\s*<div id="nbai-boot"/);
  });

  it('its styles are INLINE, never in the stylesheet it exists to paint ahead of', () => {
    // A render-blocking <link> would make the frame wait for the very asset that delays first paint,
    // which is the whole thing this is beating. The parser applies an inline <style> with the HTML.
    const styleBlocks = html.match(/<style>[\s\S]*?<\/style>/g) || [];
    expect(styleBlocks.some((b) => b.includes('#nbai-boot'))).toBe(true);
  });

  it('🔒 it is a LOADING STATE, not fake UI — nothing in it can be pressed', () => {
    const frame = html.slice(html.indexOf('<div id="nbai-boot"'), html.indexOf('<script type="module"'));
    expect(frame).not.toMatch(/<button|<a\s|<input|<form|onclick/i);
    expect(frame.toLowerCase()).toContain('starting up');
  });

  it('every theme is covered, so the background does not change colour when the real CSS lands', () => {
    // The values are the real --surface-base of each theme block in src/index.css.
    const css = readFileSync(join(__dirname, '..', 'src', 'index.css'), 'utf8');
    for (const [selector, surface] of [
      ['#nbai-boot', '#0d1117'],
      ['[data-theme="light"] #nbai-boot', '#f8fafc'],
      ['[data-theme="contrast"] #nbai-boot', '#000000'],
    ] as const) {
      expect(html).toContain(selector);
      expect(html).toContain(surface);
      expect(css).toContain(surface);
    }
  });

  it('a spinner is decoration — reduced motion stills it', () => {
    expect(html).toMatch(/prefers-reduced-motion:\s*reduce/);
  });

  it('🔒 REACT REMOVES IT, and that is the mechanism — not a timer, not a flag', () => {
    // `createRoot(container).render()` replaces the container's children on its first commit. Nothing
    // else clears this frame, so a mount that APPENDED instead would leave it on screen for ever.
    expect(main).toMatch(/createRoot\(document\.getElementById\('root'\)!?\)/);
    expect(main).not.toMatch(/appendChild\(\s*document\.getElementById\('root'\)/);
  });
});

/**
 * AND THE PANELS THE FIRST SCREEN NEVER RENDERS ARE NOT IN THE FIRST-LOAD PATH.
 *
 * `ViewPanels` is imported statically by `App.tsx`, so whatever IT imports statically is downloaded
 * and compiled before anything responds. Forty-odd panels in that file are lazy for exactly that
 * reason; `PreviewSurface` (144 KB of source) and `FilesPanel` (33 KB) were not, and both render only
 * behind a single `activeView` gate.
 */
describe('ViewPanels — a view-gated panel is not a first-load panel', () => {
  const src = readFileSync(join(__dirname, '..', 'src', 'components', 'panels', 'ViewPanels.tsx'), 'utf8');

  it('PreviewSurface and FilesPanel are lazy, like every other panel in the file', () => {
    expect(src).not.toMatch(/^import\s*\{\s*PreviewSurface\s*\}\s*from/m);
    expect(src).not.toMatch(/^import\s*\{\s*FilesPanel\s*\}\s*from/m);
    expect(src).toMatch(/const PreviewSurface = lazy\(/);
    expect(src).toMatch(/const FilesPanel = lazy\(/);
  });

  it('🔒 and they keep their real prop types — `_lz` casts them away', () => {
    // `_lz` returns ComponentType<any>, which is why this file's own props doc warns the compiler
    // will not tell you when a prop stops reaching a panel. These two are typed.
    expect(src).toMatch(/import\('\.\.\/agentv3\/PreviewSurface'\)\.then\(m => \(\{ default: m\.PreviewSurface \}\)\)/);
    expect(src).toMatch(/import\('\.\/FilesPanel'\)\.then\(m => \(\{ default: m\.FilesPanel \}\)\)/);
  });
});
