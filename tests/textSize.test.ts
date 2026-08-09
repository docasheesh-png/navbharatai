import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  clampFontScale, FONT_SCALE_MIN, FONT_SCALE_MAX, FONT_SCALE_STEP, FONT_SCALE_DEFAULT,
  FONT_SCALE_STORAGE_KEY,
} from '../src/lib/a11y';

/**
 * ADMIN ASK 2026-08-08: "setting me jo size wala option hai, isko slidebar menu me kar do — 50% to
 * 200% tak font size ho."
 *
 * Widening the range exposed a DRIFTED DUPLICATE: `main.tsx` applies the stored scale before React
 * mounts (so there is no flash of unscaled text) and re-implemented the clamp with 0.9/1.4 inlined.
 * Widening a11y.ts alone would have left every user pinned back to 140 % on boot and then jumping to
 * their real size after hydration — a setting that looks broken. These tests pin the range AND the
 * single-definition property that keeps the two paths from drifting again.
 */

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('the range is a real accessibility range (50 %–200 %)', () => {
  it('bounds are exactly what was asked for', () => {
    expect(FONT_SCALE_MIN).toBe(0.5);
    expect(FONT_SCALE_MAX).toBe(2);
    expect(FONT_SCALE_DEFAULT).toBe(1);
  });

  it('clamps out-of-range values to the new bounds, never the old ones', () => {
    expect(clampFontScale(0.1)).toBe(0.5);
    expect(clampFontScale(9)).toBe(2);
    expect(clampFontScale(1.8)).toBe(1.8);   // would have been pinned to 1.4 before
    expect(clampFontScale(0.6)).toBe(0.6);   // would have been pinned to 0.9 before
  });

  it('survives garbage without breaking the app — non-finite input falls back to 100 %', () => {
    // Deliberate: NaN/Infinity mean "the stored value is corrupt", not "the user wanted the maximum".
    // Snapping a corrupt value to 200 % would hand someone a huge UI they never chose; 100 % is the
    // only honest recovery.
    expect(clampFontScale(NaN)).toBe(FONT_SCALE_DEFAULT);
    expect(clampFontScale(Infinity)).toBe(FONT_SCALE_DEFAULT);
    expect(clampFontScale(-Infinity)).toBe(FONT_SCALE_DEFAULT);
  });

  it('the step divides the range into whole 10 % increments', () => {
    expect(FONT_SCALE_STEP).toBe(0.1);
    expect(Math.round((FONT_SCALE_MAX - FONT_SCALE_MIN) / FONT_SCALE_STEP)).toBe(15);
  });
});

describe('ONE definition of the clamp — the boot path can never drift from a11y.ts again', () => {
  const main = read('src/main.tsx');

  it('main.tsx imports the shared clamp instead of re-implementing it', () => {
    expect(main).toContain("from './lib/a11y'");
    expect(main).toContain('clampFontScale(fontScale)');
  });

  it('main.tsx no longer inlines the old bounds', () => {
    expect(main).not.toMatch(/Math\.min\(1\.4,\s*Math\.max\(0\.9/);
  });

  it('the storage key is shared too, not typed twice', () => {
    expect(main).toContain('FONT_SCALE_STORAGE_KEY');
    expect(FONT_SCALE_STORAGE_KEY).toBe('navbharat_font_scale');
  });
});

describe('the control is where the user needs it — one tap, in the slide-out menu', () => {
  const sidebar = read('src/components/panels/SidebarNav.tsx');
  const slider = read('src/components/panels/TextSizeSlider.tsx');

  it('the sidebar renders it', () => {
    expect(sidebar).toContain('<TextSizeSlider />');
    expect(sidebar).toContain("from './TextSizeSlider'");
  });

  it('it is a real slider spanning the full range, driven by the shared constants', () => {
    expect(slider).toContain('type="range"');
    expect(slider).toContain('min={FONT_SCALE_MIN}');
    expect(slider).toContain('max={FONT_SCALE_MAX}');
    expect(slider).toContain('step={FONT_SCALE_STEP}');
    // No hardcoded percentages — the labels are derived, so they can never disagree with the bounds.
    expect(slider).not.toMatch(/>50%<|>200%</);
  });

  it('it applies AND persists through the shared engine (not its own copy)', () => {
    expect(slider).toContain('applyFontScale(');
    expect(slider).toContain('getStoredFontScale()');
  });

  it('has a one-tap way back to 100 % and an accessible name', () => {
    expect(slider).toContain('FONT_SCALE_DEFAULT');
    expect(slider).toContain('aria-label');
  });

  it('Settings keeps its own stepper — the control was ADDED where it is needed, not taken away', () => {
    expect(read('src/components/panels/SettingsPanel.tsx')).toContain('Text Size');
  });
});

describe('every AI can tell a user where it is (AppKnowledgeBase sync rule)', () => {
  const kb = read('src/server/AppContext/AppKnowledgeBase.ts');

  it('has an entry naming both paths and the real range', () => {
    expect(kb).toContain("id: 'text_size'");
    expect(kb).toMatch(/50%[\s\S]{0,80}200%/);
    expect(kb).toContain('System Matrix');
  });

  it('carries the words a user would actually type, in Hinglish too', () => {
    for (const k of ['font bada', 'text size', 'zoom', 'padhne me dikkat']) {
      expect(kb).toContain(k);
    }
  });
});
