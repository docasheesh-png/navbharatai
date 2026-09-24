/**
 * THE CUSTOM FACE (admin 2026-09-24): "select a shortcut function ke niche 'switch to cursor tool' wala
 * text hai, usko button banao, 'custom' naam ka! yaha wahi cursor wale function chahiye! jaise hi user
 * custom par click kare, to popup flip back ho jaye — waha user ko upar ek input box mile, jahan user
 * kuch bhi type kar sake! niche 'go' button ho! aur uske niche, desktop me use hone wale sabhi button ho."
 *
 * The behaviour is proven in a real browser by `scripts/ideShortcutAudit/customFace.mjs` (20 checks,
 * phone and desktop). This file locks the WIRING that `tsc` cannot see: one popup with two faces, the
 * old standalone Cursor popup retired rather than duplicated, and every door that used to reach it now
 * reaching the CUSTOM face.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const studio = strip(read('src/components/ide/CodeStudio.tsx'));
const keyboard = strip(read('src/components/ide/VirtualKeyboard.tsx'));
const face = strip(read('src/components/ide/CustomFace.tsx'));

describe('one popup, two faces', () => {
  it('the "Switch to Cursor Tool" text is a CUSTOM button that flips the card', () => {
    expect(keyboard).not.toContain('Switch to Cursor Tool');
    expect(keyboard).toContain('aria-label="Custom"');
    expect(keyboard).toContain("flipTo('custom')");
    expect(keyboard).toContain('data-face="custom"');
    expect(keyboard).toContain('data-face="shortcuts"');
  });
  it('the CUSTOM face has the box, GO, the keyboard and the cursor tool', () => {
    expect(face).toContain('aria-label="Key combination"');
    expect(face).toContain('aria-label="Go"');
    expect(face).toContain('data-keyboard');
    expect(face).toContain('data-cursor-tool');
  });
  it('the keyboard is a full desktop layout — modifiers, Tab, CapsLk, Fn, F1–F12, arrows, nav keys', () => {
    for (const key of ["k('Ctrl'", "k('Shift'", "k('Alt'", "k('Win'", "k('Fn'", "k('CapsLk'", "k('Tab'", "k('Esc'", "k('F1')", "k('F12')", "k('Backspace'", "k('Del'", "k('Ins'", "k('Home'", "k('End'", "k('PgUp'", "k('PgDn'", "k('←'", "k('↑'", "k('↓'", "k('→'", "k('PrtSc'", "k('Space'", "k('Enter'"]) {
      expect(face, key).toContain(key);
    }
  });
  it('every outcome is announced in words (a tap is never silent)', () => {
    expect(face).toContain('role="status"');
    expect(face).toContain('aria-live="polite"');
  });
});

describe('the old Cursor popup is retired, not duplicated', () => {
  it('CursorPopup.tsx is gone and nothing imports it', () => {
    expect(existsSync(join(process.cwd(), 'src/components/ide/CursorPopup.tsx'))).toBe(false);
    expect(studio).not.toContain("from './CursorPopup'");
    expect(studio).not.toContain('<CursorPopup');
  });
  it('its arithmetic lives in cursorTool.ts, read by the CUSTOM face', () => {
    expect(face).toContain("from './cursorTool'");
    expect(strip(read('src/components/ide/dispatchCombo.ts'))).toContain("from './cursorTool'");
  });
});

describe('every door reaches the CUSTOM face', () => {
  it("the ActivityBar's Cursor button opens the popup on CUSTOM (and closes it from there)", () => {
    const i = studio.indexOf("if (screen === 'cursor') {");
    expect(i).toBeGreaterThan(0);
    const body = studio.slice(i, i + 400);
    expect(body).toContain("setShortcutsInitialFace('custom')");
    expect(body).toContain('setIsShortcutsOpen(true)');
  });
  it("the phone's MORE sheet has a 'Custom keys' entry beside Shortcuts", () => {
    expect(studio).toContain("label: 'Custom keys'");
  });
  it('the popup receives the editor and reports its face back', () => {
    expect(studio).toContain('editor={editorInstance}');
    expect(studio).toContain('onFaceChange={setShortcutsFace}');
    expect(studio).toContain("isCursorPopupOpen={isShortcutsOpen && shortcutsFace === 'custom'}");
  });
});
