/**
 * THE APP MUST NOT OPEN WITH SOMEBODY ELSE'S LOGO.
 *
 * ADMIN REPORT 2026-08-16: "navbharatai app open karte hai to 0.5 second ke liye Capacitor logo screen
 * par aata hai."
 *
 * ROOT CAUSE — the iOS project is NOT committed; it is generated in CI by `cap add ios`, which scaffolds
 * Capacitor's DEFAULT `Splash.imageset`. The workflow already replaced the app ICON (added when Apple
 * flagged it as a placeholder, Guideline 2.3.8) but NOTHING ever replaced the SPLASH. Android never
 * showed it, because its splash PNGs are committed as real files — which is exactly why the symptom was
 * iPhone-only and survived unnoticed.
 *
 * 🔒 WHY THESE ARE FILE/WORKFLOW ASSERTIONS: the failure cannot be reproduced in a unit test — it lives
 * in a generated Xcode project on a macOS runner. What CAN be pinned is the machinery that prevents it:
 * the source image exists, it is the right size and the right background, and the workflow step that
 * installs it is still there. Dropping any one of them fails HERE, on the branch, instead of shipping a
 * stranger's logo to the App Store and waiting for someone to notice.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');
const workflow = readFileSync(join(ROOT, '.github/workflows/ios-ipa.yml'), 'utf8');
const SPLASH = join(ROOT, 'ios-config/splash.png');

/** Minimal PNG header reader — the IHDR width/height live at a fixed offset. */
function pngSize(path: string): { w: number; h: number } {
  const buf = readFileSync(path);
  expect(buf.subarray(1, 4).toString('ascii'), 'not a PNG').toBe('PNG');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

describe('🔒 the iOS splash source is committed and correct', () => {
  it('exists and is a real image, not a stub', () => {
    expect(() => statSync(SPLASH)).not.toThrow();
    expect(statSync(SPLASH).size).toBeGreaterThan(10_000);
  });

  it('is 2732x2732 — the size Capacitor’s launch storyboard expects', () => {
    // Square and oversized on purpose: the storyboard scales-to-fill, so one image covers every device
    // and both orientations without a stretched pixel.
    expect(pngSize(SPLASH)).toEqual({ w: 2732, h: 2732 });
  });
});

describe('🔒 the splash background matches the app’s own surface', () => {
  it('capacitor.config.ts still declares #0d1117', () => {
    // If the image and the config disagree, the hand-off from splash to app flashes a seam — the exact
    // "this is a web page loading" moment the native-polish work exists to remove. The generator asserts
    // the same colour at build time; this pins the other half of the pair.
    const cfg = readFileSync(join(ROOT, 'capacitor.config.ts'), 'utf8');
    expect(cfg).toMatch(/backgroundColor:\s*'#0d1117'/);
  });
});

describe('🔒 the workflow step that installs it is still wired', () => {
  it('the iOS build replaces Splash.imageset', () => {
    expect(workflow).toContain('Splash.imageset');
    expect(workflow).toContain('ios-config/splash.png');
  });

  it('it FAILS LOUDLY rather than shipping the placeholder', () => {
    const at = workflow.indexOf('Replace placeholder splash screen');
    expect(at, 'the splash step is missing from the iOS workflow').toBeGreaterThan(-1);
    const step = workflow.slice(at, at + 1400);
    expect(step).toContain('::error::');       // a missing source/imageset stops the build
    expect(step).toContain('exit 1');
  });

  it('the icon step it mirrors is still there too — they solve the same class', () => {
    expect(workflow).toContain('AppIcon.appiconset');
    expect(workflow).toContain('ios-config/app-icon.png');
  });
});

describe('the generator is committed with its output', () => {
  it('scripts/make-ios-splash.py exists, so the asset can be rebuilt deterministically', () => {
    const gen = readFileSync(join(ROOT, 'scripts/make-ios-splash.py'), 'utf8');
    // Sourced from the ANDROID splash on purpose, so both platforms show the identical lockup.
    expect(gen).toContain('drawable-port-xxxhdpi/splash.png');
    expect(gen).toContain('2732');
  });
});
