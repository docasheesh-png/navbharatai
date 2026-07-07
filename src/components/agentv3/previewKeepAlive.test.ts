import { describe, it, expect } from 'vitest';
import { previewVisible, previewMounted, previewWrapClass } from './previewKeepAlive';

describe('preview keep-alive (admin 2026-07-07 — preview must never be destroyed by a tab switch)', () => {
  it('lazy first mount: never mounted before the preview is first opened', () => {
    expect(previewMounted(false, false, 'preview')).toBe(false); // workspace closed
    expect(previewMounted(false, true, 'files')).toBe(false);    // workspace open on another tab
  });
  it('mounts when the preview becomes visible', () => {
    expect(previewVisible(true, 'preview')).toBe(true);
    expect(previewMounted(false, true, 'preview')).toBe(true);
  });
  it('THE REGRESSION: once opened, stays mounted through tab switches AND collapsing to chat', () => {
    expect(previewMounted(true, true, 'files')).toBe(true);    // switched to Files
    expect(previewMounted(true, true, 'terminal')).toBe(true); // switched to Terminal
    expect(previewMounted(true, false, 'preview')).toBe(true); // workspace collapsed (back to chat)
  });
  it('hidden via CSS (not unmounted) when another surface is on top', () => {
    expect(previewWrapClass(true, 'preview')).not.toContain('hidden');
    expect(previewWrapClass(true, 'files')).toContain('hidden');
    expect(previewWrapClass(false, 'preview')).toContain('hidden');
  });
});
