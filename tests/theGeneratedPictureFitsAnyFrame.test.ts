// Resizing and cropping a FINISHED picture into any frame — with black where it does not reach.
//
// Admin, 2026-09-21: "image generate ho jane ke bad image ka size badalne / crop karne ka option do
// … agar user image ko frame se chota kar de, to bahat kala background a jaye."
//
// The geometry is pure and is the opposite of the attach-side rule on purpose: `imageCrop.ts` keeps
// an attached picture COVERING its frame (zoom floor 1); here the user asked for the black band, so
// the floor is 0.25 and the picture may sit small in the middle of a black frame.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FREE_MIN_ZOOM, FREE_MAX_ZOOM, FREE_IDENTITY, RESIZE_BACKGROUND,
  fitZoom, clampFreeView, freeZoomBy, freeDrawRect, showsBackground, isFreeIdentity,
} from '../src/lib/imageResize';
import { MIN_ZOOM as ATTACH_MIN_ZOOM } from '../src/lib/imageCrop';

const SQ = { w: 1024, h: 1024 };
const WIDE = { w: 1280, h: 720 };

describe('🔑 the floor is BELOW 1 here, and 1 on the attach side — one rule per job', () => {
  it('the two floors differ, and this one lets a picture be smaller than its frame', () => {
    expect(ATTACH_MIN_ZOOM).toBe(1);
    expect(FREE_MIN_ZOOM).toBeLessThan(1);
    expect(FREE_MAX_ZOOM).toBeGreaterThan(1);
  });

  it('fitZoom letterboxes a square into a wide frame — the whole picture visible, black at the sides', () => {
    const z = fitZoom(SQ, WIDE);
    expect(z).toBeLessThan(1);
    const r = freeDrawRect('crop', { zoom: z, offsetX: 0, offsetY: 0 }, SQ, WIDE);
    expect(Math.round(r.dh)).toBe(720);
    expect(Math.round(r.dw)).toBe(720);
    expect(Math.round(r.dx)).toBe(280);
    expect(showsBackground('crop', { zoom: z, offsetX: 0, offsetY: 0 }, SQ, WIDE)).toBe(true);
  });

  it('at zoom 1 the picture covers the frame exactly and no black shows', () => {
    expect(showsBackground('crop', FREE_IDENTITY, SQ, WIDE)).toBe(false);
    expect(showsBackground('crop', FREE_IDENTITY, SQ, SQ)).toBe(false);
  });
});

describe('the slack is |drawn − frame| / 2 in both directions', () => {
  it('a small picture may be moved to the frame edge but not past it', () => {
    // 0.5 of cover on a square frame: drawn 512 in a 1024 frame → slack 256.
    const v = clampFreeView({ zoom: 0.5, offsetX: 999, offsetY: -999 }, SQ, SQ);
    expect(v.offsetX).toBe(256);
    expect(v.offsetY).toBe(-256);
    const r = freeDrawRect('crop', v, SQ, SQ);
    expect(r.dx + r.dw).toBeCloseTo(1024, 6); // flush with the right edge, never beyond
  });

  it('a big picture may be moved until its edge meets the frame edge, as on the attach side', () => {
    const v = clampFreeView({ zoom: 2, offsetX: 999, offsetY: 0 }, SQ, SQ);
    expect(v.offsetX).toBe(512);
  });

  it('junk and out-of-range values are bounded, and -0 is 0', () => {
    const v = clampFreeView({ zoom: Number.NaN, offsetX: Number.NaN, offsetY: -0 }, SQ, SQ);
    expect(v).toEqual({ zoom: 1, offsetX: 0, offsetY: 0 });
    expect(Object.is(v.offsetY, -0)).toBe(false);
    expect(clampFreeView({ zoom: 99, offsetX: 0, offsetY: 0 }, SQ, SQ).zoom).toBe(FREE_MAX_ZOOM);
    expect(clampFreeView({ zoom: 0.01, offsetX: 0, offsetY: 0 }, SQ, SQ).zoom).toBe(FREE_MIN_ZOOM);
  });

  it('+ and − step and stay bounded', () => {
    let v = FREE_IDENTITY;
    for (let i = 0; i < 20; i += 1) v = freeZoomBy(v, -1, SQ, SQ);
    expect(v.zoom).toBe(FREE_MIN_ZOOM);
    for (let i = 0; i < 60; i += 1) v = freeZoomBy(v, 1, SQ, SQ);
    expect(v.zoom).toBe(FREE_MAX_ZOOM);
    expect(isFreeIdentity(FREE_IDENTITY)).toBe(true);
    expect(isFreeIdentity(freeZoomBy(FREE_IDENTITY, 1, SQ, SQ))).toBe(false);
  });
});

describe('Stretch mode is the whole frame, whatever the picture\'s shape', () => {
  it('draws edge to edge and shows no background', () => {
    expect(freeDrawRect('stretch', { zoom: 0.3, offsetX: 50, offsetY: 50 }, SQ, WIDE)).toEqual({ dx: 0, dy: 0, dw: 1280, dh: 720 });
    expect(showsBackground('stretch', { zoom: 0.3, offsetX: 50, offsetY: 50 }, SQ, WIDE)).toBe(false);
  });
});

describe('🔒 SOURCE — the editor and the button', () => {
  const editor = readFileSync(join(__dirname, '..', 'src/components/ide/ImageResizeEditor.tsx'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const gen = readFileSync(join(__dirname, '..', 'src/components/ide/AIImageGenerator.tsx'), 'utf8').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('the canvas is filled with the ONE background constant before the picture is drawn', () => {
    expect(RESIZE_BACKGROUND).toBe('#000000');
    expect(editor).toContain('ctx.fillStyle = RESIZE_BACKGROUND');
    expect(editor.indexOf('ctx.fillStyle = RESIZE_BACKGROUND')).toBeLessThan(editor.indexOf('ctx.drawImage('));
  });

  it('the output is the frame at its real pixels, exported as PNG, and the sheet portals to the body', () => {
    expect(editor).toMatch(/canvas\.width = frame\.w;\s*canvas\.height = frame\.h;/);
    expect(editor).toContain("toDataURL('image/png')");
    expect(editor).toContain('createPortal(');
  });

  it('the generator offers it on every image, through the local-bytes door, and replaces the image in place', () => {
    expect(gen).toMatch(/ensureLocalImage\(item\.id\)\.then\(\(ok\) => \{ if \(ok\) setResizeOn\(item\.id\); \}\)/);
    expect(gen).toContain('<ImageResizeEditor');
    expect(gen).toMatch(/setHistory\(\(h\) => h\.map\(\(x\) => \(x\.id === resizeOn \? updated : x\)\)\)/);
  });
});
