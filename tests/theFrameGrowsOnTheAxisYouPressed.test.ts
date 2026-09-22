// The Resize sheet's W and H buttons "did not work": pressing EITHER changed only the height on screen.
//
// Admin, 2026-09-22, with a screenshot of the sheet at 1024 × 1024: "resize me W aur H button kaam
// nahi kar rahe hai. dono me se kuch bhi press karo, bas height change hoti hai, width nahi! fix karo!!"
//
// 🔑 THE BUTTONS WORKED; THE PREVIEW COULD NOT SHOW IT. The canvas was styled `w-full h-auto`, so its
// displayed WIDTH was pinned to the container and a change of shape appeared only as a change of
// displayed HEIGHT. Measured in Chromium in a 360px container before a line was changed:
//
//   frame        shown
//   1024×1024 →  360 × 360
//   1088×1024 →  360 × 339   ← W+ made the picture SHORTER
//   1280×1024 →  360 × 288
//   1024×1088 →  360 × 383   ← H+ made it taller
//
// The output PNG was right the whole time (the canvas's real pixels were the frame's). What the user
// saw was not. The fix is one rule, `previewPercent`: a SQUARE stage and the canvas sized as a percent
// of it on BOTH axes against ONE constant reference, so the axis pressed is the axis that moves.
// Measured after: 1024×1024 → 240×240, 1088×1024 → 255×240, 1280×1024 → 300×240, 1024×1280 → 240×300.
//
// Second defect in the same sheet, fixed alongside: two CustomSizeFields could be on the page at once
// (the composer's and the sheet's) with the SAME input ids, so the sheet's "W" label pointed at the
// composer's input behind it.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PREVIEW_REFERENCE_PX, previewPercent } from '../src/lib/imageResize';
import { MAX_CUSTOM_PX, PRESET_PIXELS, resolveCustomSize, stepCustomSide } from '../src/lib/imageSize';

const strip = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const read = (p: string) => strip(readFileSync(join(__dirname, '..', p), 'utf8'));

describe('🔑 the axis you pressed is the axis that moves', () => {
  it('W+ widens the preview and leaves its height exactly where it was', () => {
    const before = previewPercent({ w: 1024, h: 1024 });
    const after = previewPercent({ w: stepCustomSide(1024, 1), h: 1024 });
    expect(after.w).toBeGreaterThan(before.w);
    expect(after.h).toBe(before.h);
  });

  it('H+ heightens the preview and leaves its width exactly where it was', () => {
    const before = previewPercent({ w: 1024, h: 1024 });
    const after = previewPercent({ w: 1024, h: stepCustomSide(1024, 1) });
    expect(after.h).toBeGreaterThan(before.h);
    expect(after.w).toBe(before.w);
  });

  it('the reference is CONSTANT across every reachable frame — that is what makes the two cases above true', () => {
    // If the reference followed the frame's own longer side, W+ on a square would re-scale everything
    // and the width would stay pinned (the exact bug). One number for all of them:
    expect(PREVIEW_REFERENCE_PX).toBe(MAX_CUSTOM_PX);
    const frames = [
      ...Object.values(PRESET_PIXELS),
      resolveCustomSize(256, 256),
      resolveCustomSize(1536, 1024),
      resolveCustomSize(1024, 1536),
      resolveCustomSize(1536, 1536), // scaled down together by the area cap, still ≤ the reference
    ];
    for (const f of frames) {
      const p = previewPercent(f);
      expect(p.w).toBeCloseTo((f.w / PREVIEW_REFERENCE_PX) * 100, 1);
      expect(p.h).toBeCloseTo((f.h / PREVIEW_REFERENCE_PX) * 100, 1);
      expect(p.w).toBeLessThanOrEqual(100);
      expect(p.h).toBeLessThanOrEqual(100);
    }
  });

  it('a frame past the reference (none today) keeps its SHAPE and still fits the stage', () => {
    const p = previewPercent({ w: 4000, h: 2000 });
    expect(p.w).toBe(100);
    expect(p.h).toBe(50);
  });

  it('junk is 0, never NaN in a style attribute', () => {
    expect(previewPercent({ w: Number.NaN, h: -5 } as { w: number; h: number })).toEqual({ w: 0, h: 0 });
  });

  it('the widest reachable frame exactly fills the stage — nothing reachable can overflow it', () => {
    expect(previewPercent({ w: MAX_CUSTOM_PX, h: 1024 }).w).toBe(100);
  });
});

describe('🔒 SOURCE — the sheet draws on a square stage, never on a width-pinned canvas', () => {
  const editor = read('src/components/ide/ImageResizeEditor.tsx');
  const fields = read('src/components/ide/CustomSizeFields.tsx');

  it('the canvas is sized by previewPercent on BOTH axes, and is no longer w-full h-auto', () => {
    expect(editor).toContain('const pct = previewPercent(frame)');
    expect(editor).toMatch(/style=\{\{ width: `\$\{pct\.w\}%`, height: `\$\{pct\.h\}%` \}\}/);
    // The exact idiom that produced the bug, on the resize canvas specifically:
    const canvas = editor.slice(editor.indexOf('<canvas'), editor.indexOf('/>', editor.indexOf('<canvas')));
    expect(canvas).not.toMatch(/w-full|h-auto/);
  });

  it('the stage is SQUARE, so a percent of it means the same length on both axes', () => {
    const stage = editor.slice(editor.lastIndexOf('className=', editor.indexOf('<canvas')) - 400, editor.indexOf('<canvas'));
    expect(stage).toContain('aspect-square');
    expect(stage).toContain('w-full');
  });

  it('the sheet\'s fields carry their OWN ids, distinct from the composer\'s', () => {
    expect(fields).toMatch(/idPrefix = 'nbai-custom'/);
    expect(fields).toContain('`${idPrefix}-w`');
    expect(fields).toContain('`${idPrefix}-h`');
    expect(fields).not.toMatch(/'nbai-custom-[wh]'/);
    expect(editor).toMatch(/idPrefix="nbai-resize"/);
    // And the composer keeps the default (it is the first mount and the one the old id named).
    expect(read('src/components/ide/AIImageGenerator.tsx')).not.toMatch(/idPrefix=/);
  });

  it('W still changes only W and H only H in the fields themselves — the half that was never broken', () => {
    expect(fields).toMatch(/field\('W', width, \(n\) => onChange\(n, height\)/);
    expect(fields).toMatch(/field\('H', height, \(n\) => onChange\(width, n\)/);
  });
});
