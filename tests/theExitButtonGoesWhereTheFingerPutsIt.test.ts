/**
 * THE FOCUS MODE EXIT BUTTON GOES WHERE THE FINGER PUTS IT (admin 2026-09-22: *"full screen off
 * (collapse) button upper right corner me fix hai. isko moveable banao, user usko ungli se khich ke
 * kahi bhi rakh sake! expand (full screen on) wala theek hai."*).
 *
 * Source-level: the mechanics are shared with the admin copy button through ONE hook, and a second
 * inline copy — or a button that reverted to `top-3 right-3` — would compile without complaint.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const app = codeOnly(read('src/App.tsx'));
const btn = codeOnly(read('src/components/FloatingExitFocusButton.tsx'));
const hook = codeOnly(read('src/hooks/useDraggableFloat.ts'));
const admin = codeOnly(read('src/components/admin/AdminCopyButton.tsx'));

describe('the exit button', () => {
  it('is mounted in focus mode in place of the fixed-corner button', () => {
    expect(app).toContain('{focusMode && <FloatingExitFocusButton onExit={() => setFocusMode(false)} />}');
    expect(app).not.toContain('aria-label="Exit Focus Mode — show header"');
    expect(app).not.toMatch(/top-3 right-3 w-9 h-9/);
  });

  it('drags through the shared hook, starts top-right, and remembers its own spot', () => {
    expect(btn).toContain('useDraggableFloat({');
    expect(btn).toContain('storageKey: FOCUS_EXIT_POSITION_KEY');
    expect(btn).toContain('topRightPosition(size, view, undefined, safeAreaTop())');
    expect(btn).toContain('onTap: onExit');
    expect(btn).toContain('{...handlers}');
    expect(btn).toContain("touchAction: 'none'");
    expect(btn).toContain('left: `${pos.x}px`, top: `${pos.y}px`');
    // The keyboard still exits — a draggable that only answers a pointer strands a keyboard user.
    expect(btn).toMatch(/onKeyDown=\{\(e\) => \{ if \(e\.key === 'Enter' \|\| e\.key === ' '\)/);
  });

  it('the ENTER button in the header is untouched ("expand wala theek hai")', () => {
    const nav = codeOnly(read('src/components/panels/TopNav.tsx'));
    expect(nav).toContain('aria-label="Enter Focus Mode"');
    expect(nav).not.toContain('useDraggableFloat');
  });
});

describe('one hook, two buttons — the mechanics exist once', () => {
  it('both floating buttons call the hook; neither carries its own pointer arithmetic', () => {
    for (const [name, src] of [['exit', btn], ['admin copy', admin]] as const) {
      expect(src, name).toContain('useDraggableFloat(');
      expect(src, name).not.toContain('setPointerCapture');
      expect(src, name).not.toContain('gesture.current');
      expect(src, name).not.toContain('clampPosition(');
    }
  });

  it('the hook clamps every position, listens for rotation, and tells a tap from a drag', () => {
    expect(hook.match(/clampPosition\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(hook).toMatch(/addEventListener\('resize'/);
    expect(hook).toMatch(/addEventListener\('orientationchange'/);
    expect(hook).toContain('isTap(');
    expect(hook).toContain('setPointerCapture(e.pointerId)');
    expect(hook).toContain('releasePointerCapture(e.pointerId)');
  });
});
