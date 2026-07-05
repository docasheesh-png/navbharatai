import { describe, it, expect } from 'vitest';
import { shouldRenderV3Surface, v3SurfaceDisplayClass, V3_VIEW } from '../src/components/agentv3/v3SurfaceMount';

describe('shouldRenderV3Surface', () => {
  it('renders when v3.0 is the active tab (build running or not)', () => {
    expect(shouldRenderV3Surface(V3_VIEW, false)).toBe(true);
    expect(shouldRenderV3Surface(V3_VIEW, true)).toBe(true);
  });

  // THE fix (admin, 2026-07-05): switching to another tab used to UNMOUNT v3.0 and kill the live
  // build stream → "Load failed". While a build is RUNNING, keep it mounted under any active tab.
  it('keeps v3.0 mounted under ANOTHER active tab while a build is running (the fix)', () => {
    expect(shouldRenderV3Surface('nbi_chat', true)).toBe(true);   // Free chat active, v3 build running
    expect(shouldRenderV3Surface('studio', true)).toBe(true);
    expect(shouldRenderV3Surface('home', true)).toBe(true);
  });

  it('unmounts v3.0 under another tab once no build is running (zero idle overhead)', () => {
    expect(shouldRenderV3Surface('nbi_chat', false)).toBe(false);
    expect(shouldRenderV3Surface('home', false)).toBe(false);
  });
});

describe('v3SurfaceDisplayClass', () => {
  it('is a layout no-op (contents) when v3.0 is the active tab', () => {
    expect(v3SurfaceDisplayClass(V3_VIEW)).toBe('contents');
  });

  it('is hidden (display:none) when kept alive in the background under another tab', () => {
    expect(v3SurfaceDisplayClass('nbi_chat')).toBe('hidden');
    expect(v3SurfaceDisplayClass('home')).toBe('hidden');
    expect(v3SurfaceDisplayClass('studio')).toBe('hidden');
  });
});
