import { describe, it, expect, afterEach, vi } from 'vitest';
import { dismissKeyboardOnMobile } from './dismissKeyboard';

// The helper reads the globals window.matchMedia + document.activeElement. The node test env has neither,
// so each test installs exactly what it needs and restores afterwards.
const savedWindow = (globalThis as any).window;
const savedDocument = (globalThis as any).document;

function install(coarse: boolean, activeEl: unknown) {
  (globalThis as any).window = {
    matchMedia: (q: string) => ({ matches: coarse && /coarse/.test(q) }),
  };
  (globalThis as any).document = { activeElement: activeEl };
}

afterEach(() => {
  (globalThis as any).window = savedWindow;
  (globalThis as any).document = savedDocument;
});

describe('dismissKeyboardOnMobile', () => {
  it('blurs the passed composer on a touch (coarse-pointer) device', () => {
    const blur = vi.fn();
    install(true, null);
    dismissKeyboardOnMobile({ blur } as unknown as HTMLElement);
    expect(blur).toHaveBeenCalledOnce();
  });

  it('does NOTHING on a desktop (fine pointer) — focus is kept so the next message flows', () => {
    const blur = vi.fn();
    install(false, { blur });
    dismissKeyboardOnMobile({ blur } as unknown as HTMLElement);
    expect(blur).not.toHaveBeenCalled();
  });

  it('falls back to the focused element when no element is passed', () => {
    const blur = vi.fn();
    install(true, { blur });
    dismissKeyboardOnMobile();
    expect(blur).toHaveBeenCalledOnce();
  });

  it('is a safe no-op in a non-browser environment (no window/document)', () => {
    (globalThis as any).window = undefined;
    (globalThis as any).document = undefined;
    expect(() => dismissKeyboardOnMobile(null)).not.toThrow();
  });

  it('does not throw when matchMedia is missing (older/jsdom env)', () => {
    (globalThis as any).window = {};
    (globalThis as any).document = { activeElement: null };
    expect(() => dismissKeyboardOnMobile(null)).not.toThrow();
  });
});
