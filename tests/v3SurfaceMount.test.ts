import { describe, it, expect } from 'vitest';
import { shouldRenderV3Surface, v3SurfaceDisplayClass, V3_VIEW } from '../src/components/agentv3/v3SurfaceMount';

describe('shouldRenderV3Surface (window semantics)', () => {
  it('renders when v3.0 is the active tab', () => {
    expect(shouldRenderV3Surface(V3_VIEW, false, false)).toBe(true);
    expect(shouldRenderV3Surface(V3_VIEW, true, true)).toBe(true);
  });

  // THE round-2 fix (IMG_5715): the v3.0 tab is OPEN in the tab bar → the surface stays mounted under
  // ANY other active tab, build running or not. The old running-only keep-alive unmounted the surface
  // the moment the build finished in the background → "blank page, new chat" on return.
  it('stays mounted while the v3.0 tab is OPEN, under any other tab, even with NO build running', () => {
    expect(shouldRenderV3Surface('nbi_chat', false, true)).toBe(true);  // Free chat active, idle v3 tab open
    expect(shouldRenderV3Surface('studio', false, true)).toBe(true);
    expect(shouldRenderV3Surface('home', false, true)).toBe(true);
  });

  it('a running build keeps it mounted even if the tab was closed (accidental close cannot kill a build)', () => {
    expect(shouldRenderV3Surface('nbi_chat', true, false)).toBe(true);
  });

  it('unmounts only when: not active, tab closed, and nothing running', () => {
    expect(shouldRenderV3Surface('nbi_chat', false, false)).toBe(false);
    expect(shouldRenderV3Surface('home', false, false)).toBe(false);
  });

  it('back-compat: the tab-open param defaults to false (old call shape still safe)', () => {
    expect(shouldRenderV3Surface('nbi_chat', true)).toBe(true);
    expect(shouldRenderV3Surface('nbi_chat', false)).toBe(false);
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
