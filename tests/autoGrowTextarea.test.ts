import { describe, it, expect } from 'vitest';
import { growHeightPx, autoGrow, resetGrow } from '../src/lib/autoGrowTextarea';

/**
 * Shared composer auto-grow (admin 2026-07-20: every AI input box starts 1 line and grows while
 * typing). Locks the pure sizing decision and the DOM helper contract, plus the wiring of the two
 * composers that previously shipped rows=1 with NO grow logic (Professionals, Offline AI).
 */

describe('growHeightPx', () => {
  it('fits content up to the cap, then clamps', () => {
    expect(growHeightPx(40, 128)).toBe(40);
    expect(growHeightPx(300, 128)).toBe(128);
    expect(growHeightPx(128, 128)).toBe(128);
  });
  it('degrades safely on junk input', () => {
    expect(growHeightPx(0, 128)).toBe(0);
    expect(growHeightPx(-5, 128)).toBe(0);
    expect(growHeightPx(NaN, 128)).toBe(0);
    expect(growHeightPx(40, NaN)).toBe(0);
  });
});

describe('autoGrow / resetGrow (DOM contract)', () => {
  const fakeEl = (scrollHeight: number) => {
    const el = { style: { height: '' }, scrollHeight } as unknown as HTMLTextAreaElement;
    return el;
  };
  it('sets the fitted pixel height while typing', () => {
    const el = fakeEl(64);
    autoGrow(el, 128);
    expect(el.style.height).toBe('64px');
  });
  it('clamps at the max so beyond it the textarea scrolls internally', () => {
    const el = fakeEl(500);
    autoGrow(el, 112);
    expect(el.style.height).toBe('112px');
  });
  it('resetGrow returns the box to its natural 1-line height', () => {
    const el = fakeEl(500);
    autoGrow(el, 112);
    resetGrow(el);
    expect(el.style.height).toBe('');
  });
});

describe('composer wiring — the two previously static composers grow now', () => {
  it('ProfessionalChat and OfflineAI call autoGrow on change and reset on clear', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    for (const rel of ['../src/components/professionals/ProfessionalChat.tsx', '../src/components/offline/OfflineAI.tsx']) {
      const src = readFileSync(join(__dirname, rel), 'utf8');
      expect(src).toContain('autoGrow(e.target');
      expect(src).toContain('resetGrow(');
      expect(src).toContain('rows={1}');
    }
  });
});
