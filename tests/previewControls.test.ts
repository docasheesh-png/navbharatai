import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { nextZoom, zoomLabel, resolveZoomScale, ZOOM_ORDER, computeDeviceScale } from '../src/components/agentv3/previewViewport';
import { previewBridgeSource } from '../src/server/AgentV3/previewBridge';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const utils = read('src/lib/previewUtils.ts');
const surface = read('src/components/agentv3/PreviewSurface.tsx');

describe('preview zoom', () => {
  it('cycles through every step and back to Fit', () => {
    let z = ZOOM_ORDER[0];
    const seen = [z];
    for (let i = 0; i < ZOOM_ORDER.length; i++) { z = nextZoom(z); seen.push(z); }
    expect(seen.slice(0, ZOOM_ORDER.length)).toEqual([...ZOOM_ORDER]);
    expect(seen[seen.length - 1]).toBe('fit');
  });

  it('labels Fit as a word, because it is not a percentage', () => {
    expect(zoomLabel('fit')).toBe('Fit');
    expect(zoomLabel('1')).toBe('100%');
    expect(zoomLabel('0.5')).toBe('50%');
  });

  it('Fit keeps the original never-upscale behaviour exactly', () => {
    expect(resolveZoomScale('fit', 400, 400, 1280, 800)).toBe(computeDeviceScale(400, 400, 1280, 800));
    // a device smaller than the panel still renders 1:1 rather than being blown up
    expect(resolveZoomScale('fit', 2000, 2000, 390, 844)).toBe(1);
  });

  it('an explicit step OVERFLOWS the panel on purpose', () => {
    // Fitting a 1280px desktop into a 500px split makes every measurement a lie — text looks smaller
    // than it is. At 100% the box overflows and scrolls, and what the user sees is the real thing.
    expect(resolveZoomScale('1', 500, 400, 1280, 800)).toBe(1);
    expect(resolveZoomScale('0.75', 500, 400, 1280, 800)).toBe(0.75);
  });

  it('recovers from a nonsense value rather than collapsing the box', () => {
    expect(resolveZoomScale('bogus' as never, 500, 400, 1280, 800)).toBe(1);
    expect(nextZoom('bogus' as never)).toBe(ZOOM_ORDER[0]);
  });

  it('is offered only in a device viewport, where there is something to fit', () => {
    expect(surface).toContain("const zoomButton = viewport === 'auto' ? null : (");
  });
});

describe('dark mode — offered only where it is real', () => {
  it('the app is asked whether it has class-based dark styling at all', () => {
    const js = previewBridgeSource('live');
    expect(js).toContain('hasClassDarkStyling');
    expect(js).toContain("sel.indexOf('.dark') >= 0");
    // A page cannot emulate prefers-color-scheme for a frame it embeds. Claiming to would be a fake
    // control, so the button is gated on the app's own answer.
    expect(js).toContain('canToggle:');
  });

  it('the stylesheet scan is bounded, because it runs on the user’s phone', () => {
    expect(previewBridgeSource('live')).toContain('scanned > 6000');
  });

  it('the panel hides the button when the app says no', () => {
    expect(surface).toContain('const themeButton = themeToggleAvailable ? (');
  });
});

describe('a dependency blip must not become a dead preview', () => {
  it('retries the primary CDN once before giving up', () => {
    expect(utils).toContain('one honest retry of the primary');
    expect(utils).toContain('setTimeout(r,400)');
  });

  it('offers the extra CDN ONLY to apps with no React — the duplicate-React trap', () => {
    // jsdelivr's +esm bundles its own React, so a React app rescued that way renders with two Reacts
    // and dies on "Invalid hook call". A fallback that produces a broken app is worse than an honest
    // failure, so this rung is gated.
    expect(utils).toContain('if(!appUsesReact)list.push');
    expect(utils).toContain('cdn.jsdelivr.net/npm/');
  });
});

describe('"Preview is empty" must be evidence, not a stopwatch', () => {
  it('abandons the warning when the DOM is still changing', () => {
    // A phone on Indian mobile data routinely takes 5-8s to pull React and a router. Telling that
    // user their working app rendered nothing is the false alarm this closes.
    expect(utils).toContain('MutationObserver');
    expect(utils).toContain('if(domChanged)return;');
  });

  it('still refuses to speak while the loader is running', () => {
    expect(utils).toContain('if(window.__nbLoading)return false;');
  });
});
