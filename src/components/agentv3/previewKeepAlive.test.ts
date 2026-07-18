import { describe, it, expect } from 'vitest';
import { previewVisible, previewMounted, previewWrapClass, shouldPrewarmPreview } from './previewKeepAlive';

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

describe('preview pre-warm (admin 2026-07-18 — open Preview must be instant, not a cold multi-minute compile)', () => {
  it('pre-warms once a build is idle and produced files', () => {
    expect(shouldPrewarmPreview(false, false, true)).toBe(true);
  });
  it('does NOT pre-warm while a build is still running (client or server)', () => {
    expect(shouldPrewarmPreview(true, false, true)).toBe(false);
    expect(shouldPrewarmPreview(false, true, true)).toBe(false);
  });
  it('does NOT pre-warm when there are no files yet (a brand-new chat)', () => {
    expect(shouldPrewarmPreview(false, false, false)).toBe(false);
  });
  it('the pre-warm flag mounts PreviewSurface off-screen before the user ever opens Preview', () => {
    // hidden (not the active tab) but still in the tree so it compiles in the background:
    expect(previewMounted(false, true, 'files', true)).toBe(true);
    expect(previewMounted(false, false, 'preview', true)).toBe(true); // workspace collapsed to chat
    expect(previewWrapClass(true, 'files')).toContain('hidden'); // stays hidden until opened
  });
  it('without the pre-warm flag, the lazy first-mount behaviour is unchanged', () => {
    expect(previewMounted(false, true, 'files', false)).toBe(false);
    expect(previewMounted(false, true, 'files')).toBe(false); // default arg = no pre-warm
  });
});
