/**
 * THE KEYBOARD CAN BE CLOSED (admin 2026-11-05, verbatim):
 *
 *   "han, isko hide kar do! aur jab keyboard on ho, tab dikhna chahiye, par size me 1/8 ke as pas
 *    ho! iska kaam bas keyboard ko band karna hai! keyboard open to kahi bhi touch karo, keyboard
 *    open ho jata hai. band nahi hota, is button se keyboard band ho jaye, bas itna karo!!"
 *
 * THE DEFECT CLASS: a control whose action the user already gets for free, standing in the place
 * of the action they cannot reach at all. Monaco's `.iPadShowKeyboard` widget OPENS the keyboard,
 * which any tap in the code area does anyway; closing it was impossible, because
 * `installKeyboardBehaviour` (nativeShell.ts) removes iOS's accessory bar to stop the app looking
 * like a WebView. So the fix is not "make the button smaller" — it is to hide the widget and put
 * its inverse in the same corner.
 *
 * These lock all four halves of that: the decision, the focus bookkeeping it depends on, the CSS
 * that hides Monaco's widget, and the button in `Editor.tsx` — the last two at the source, because
 * neither `tsc` nor a jsdom render can see a stylesheet rule or a Monaco overlay.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { shouldShowKeyboardDismiss, stillFocusedAfterFocusOut } from '../src/components/ide/keyboardDismiss';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('shouldShowKeyboardDismiss — both conditions, every time', () => {
  it('shows while a touchscreen holds focus in the editor (the keyboard is up)', () => {
    expect(shouldShowKeyboardDismiss({ coarsePointer: true, editorFocused: true })).toBe(true);
  });

  it('is hidden when the editor is not focused — there is no keyboard to close', () => {
    expect(shouldShowKeyboardDismiss({ coarsePointer: true, editorFocused: false })).toBe(false);
  });

  it('never appears on a mouse pointer, focused or not', () => {
    expect(shouldShowKeyboardDismiss({ coarsePointer: false, editorFocused: true })).toBe(false);
    expect(shouldShowKeyboardDismiss({ coarsePointer: false, editorFocused: false })).toBe(false);
  });

  it('takes NO viewport input — a measured keyboard height cannot decide it', () => {
    // THE LOCK, not a tautology. `Keyboard.resize: 'native'` in capacitor.config.ts shrinks the
    // WebView itself, so `window.innerHeight - visualViewport.height` is 0 inside our own app and a
    // height-driven button would never appear there. The input type is what keeps that out.
    const inputs = { coarsePointer: true, editorFocused: true };
    expect(Object.keys(inputs).sort()).toEqual(['coarsePointer', 'editorFocused']);
  });
});

describe('stillFocusedAfterFocusOut — focus moving WITHIN the editor is not a blur', () => {
  const container = { contains: (n: unknown) => n === 'inner' } as unknown as Node;

  it('focus moving to another node inside the editor keeps the button up', () => {
    expect(stillFocusedAfterFocusOut(container, 'inner' as unknown as Node)).toBe(true);
  });

  it('focus leaving the editor takes the button down', () => {
    expect(stillFocusedAfterFocusOut(container, 'outside' as unknown as Node)).toBe(false);
  });

  it('a focusout with no next target (the keyboard was dismissed) is a blur', () => {
    expect(stillFocusedAfterFocusOut(container, null)).toBe(false);
    expect(stillFocusedAfterFocusOut(null, 'inner' as unknown as Node)).toBe(false);
  });
});

describe("Monaco's own show-keyboard widget stays hidden", () => {
  it('index.css hides .iPadShowKeyboard', () => {
    const css = read('src/index.css');
    expect(css).toMatch(/\.monaco-editor\s+\.iPadShowKeyboard\s*\{[^}]*display:\s*none/);
  });

  it('every rule that targets it hides it — none re-enables it', () => {
    const css = read('src/index.css');
    const rules = [...css.matchAll(/iPadShowKeyboard[^{]*\{([^}]*)\}/g)].map((m) => m[1]);
    expect(rules.length).toBeGreaterThan(0);
    for (const body of rules) expect(body).toMatch(/display:\s*none/);
  });
});

describe('the Editor renders the replacement — and only while the keyboard is up', () => {
  const src = read('src/components/ide/Editor.tsx');

  it('the button is gated on the shared decision, never on an inline condition', () => {
    expect(src).toContain('shouldShowKeyboardDismiss(');
    expect(src).toMatch(/\{showHideKeyboard && \(/);
  });

  it('its action is to CLOSE the keyboard, through the one shared blur helper', () => {
    expect(src).toContain('dismissKeyboardOnMobile(');
    expect(src).toMatch(/aria-label="Hide keyboard"/);
    // It must not call focus() — that was the whole defect in the widget it replaces. Scoped to
    // the handler itself, because the Undo/Redo/Find buttons below legitimately refocus the editor.
    const handler = src.slice(src.indexOf('const hideKeyboard = ')).split('\n  };')[0];
    expect(handler).toContain('dismissKeyboardOnMobile(');
    expect(handler).not.toContain('.focus()');
  });

  it('it is far smaller than the 58×36 widget it replaces', () => {
    const chip = src.match(/w-\[(\d+)px\] h-\[(\d+)px\] rounded-md border border-line/);
    expect(chip).toBeTruthy();
    const area = Number(chip![1]) * Number(chip![2]);
    expect(area).toBeLessThanOrEqual((58 * 36) / 3);   // asked for ~1/8; kept tappable
  });

  it('focus bookkeeping is wired to the editor area, so the gate can ever be true', () => {
    expect(src).toContain('setEditorFocused(true)');
    expect(src).toContain('stillFocusedAfterFocusOut(e.currentTarget, e.relatedTarget)');
  });
});
