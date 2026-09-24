import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { softKeyboardWouldOpen, dismissKeyboardOnMobile } from '../src/lib/dismissKeyboard';

/**
 * 🔴 THE KEYBOARD MUST NOT OPEN UNTIL SOMEBODY ASKS TO TYPE (admin 2026-09-19, verbatim:
 * *"code studio (IDE) me agar terminal par click karte hai to 'keynote' open ho jata hai, isko abhi
 * roko, jab tak typing ke liye inputbox me click na kiya jaye, automatic keyboard open na ho!"*).
 *
 * **What it was.** `ShellTerminal` had an effect on `[active]` that refit xterm and then focused an
 * input — on touch, the command bar. Focusing an input on a phone RAISES the on-screen keyboard, so
 * tapping TERMINAL covered with a keyboard the transcript the user had gone there to read. They had
 * asked for a terminal, not for a text field.
 *
 * ⚠️ **The line it replaces was itself a fix, and its reasoning still holds:** when focus IS wanted on
 * touch it must go to the command bar and never to xterm, whose keys a soft keyboard cannot reach.
 * That is preserved — what changed is only WHO decides to focus. Both ways in are still one tap.
 *
 * **The split this file encodes**, because the rule is about automatic focus and not about focus:
 *   • focus the user did NOT ask for (a panel you navigate to) must consult `softKeyboardWouldOpen()`
 *   • a control the user opened IN ORDER to type — a rename field, a password prompt, "add key",
 *     "new file", the chat search box — keeps its `autoFocus`: that tap already said "I want to type",
 *     and removing it would cost every one of those flows a second tap.
 */

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const term = read('src/components/ide/ShellTerminal.tsx');
const studio = read('src/components/ide/CodeStudio.tsx');

/** These suites run in the node environment, so `window` is supplied here rather than assumed. */
const g = globalThis as unknown as { window?: { matchMedia?: unknown } };
const hadWindow = 'window' in g;
const realWindow = g.window;
afterEach(() => { if (hadWindow) g.window = realWindow; else delete g.window; });

function pointer(kind: 'coarse' | 'fine' | 'absent') {
  g.window = kind === 'absent'
    ? {}
    : { matchMedia: (q: string) => ({ matches: q.includes('pointer') && q.includes('coarse') === (kind === 'coarse') }) };
}

/** Comments are prose, not usage — this file's own notes name the things it counts. */
const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n');

describe('the predicate: would focusing raise a keyboard?', () => {
  it('a coarse pointer has a soft keyboard; a fine one does not', () => {
    pointer('coarse');
    expect(softKeyboardWouldOpen()).toBe(true);
    pointer('fine');
    expect(softKeyboardWouldOpen()).toBe(false);
  });

  it('no matchMedia (jsdom, an old browser) means NO soft keyboard — never a crash', () => {
    pointer('absent');
    expect(() => softKeyboardWouldOpen()).not.toThrow();
    expect(softKeyboardWouldOpen()).toBe(false);
  });

  it('🔒 the two halves of this module read ONE predicate, so they cannot disagree', () => {
    // `dismissKeyboardOnMobile` closes the keyboard and this closes the door on opening it. If they
    // ever tested the pointer separately, one half could think a device has a keyboard and the other
    // think it does not — on the same phone.
    const src = read('src/lib/dismissKeyboard.ts');
    expect(codeOnly(src).match(/matchMedia/g) ?? []).toHaveLength(1);
    expect(src).toContain('if (!softKeyboardWouldOpen()) return;');
    pointer('fine');
    expect(() => dismissKeyboardOnMobile(null)).not.toThrow();
  });
});

describe('the terminal: tapping TERMINAL asks for a terminal, not for a text field', () => {
  it('the refit still always runs — it is why the effect exists', () => {
    const i = term.indexOf('if (!active) return;');
    expect(i).toBeGreaterThan(-1);
    const eff = term.slice(i, i + 1400);
    expect(eff).toContain('fitRef.current?.fit()');
    // The focus is now conditional, and the condition is the shared predicate.
    expect(eff).toContain('if (!softKeyboardWouldOpen()) termRef.current?.focus();');
    // ⚠️ REVERSION GUARD: the exact line that raised the keyboard must not come back.
    expect(eff).not.toContain('barInputRef.current?.focus()');
  });

  it('no private copy of the pointer test is left in this file', () => {
    expect(term).not.toContain("matchMedia?.('(pointer: coarse)')");
    expect(term).toContain('useState<boolean>(softKeyboardWouldOpen)');
  });

  it('🔑 and NOTHING is lost — both ways to start typing are still one tap', () => {
    // The helper-key row is still rendered on touch, and tapping the terminal box still arms the bridge.
    // Without these the fix would trade the admin's problem for a terminal nobody can type in.
    expect(term).toContain('{showCommandBar && (');
    expect(term).toContain('onClick={focusBridge}');
    // And a press on a helper key still keeps focus (now the bridge's), so the keyboard does not
    // flicker shut mid-command. Re-aimed 2026-09-24: the bar's line input — and its own focus call —
    // were removed as a duplicate of typing in the box.
    expect(term).toContain('onPointerDown={keepFocus}');
    expect(term).toContain('keepFocus = (e: React.PointerEvent) => e.preventDefault()');
  });

  it('a desktop keeps its auto-focus: a mouse has no keyboard to raise', () => {
    const i = term.indexOf('if (!active) return;');
    expect(term.slice(i, i + 1400)).toContain('termRef.current?.focus()');
  });
});

describe('the sibling: a panel you NAVIGATE to must not open the keyboard either', () => {
  it("Code Studio's Search input focuses itself only where no keyboard can pop", () => {
    expect(studio).toContain('autoFocus={!softKeyboardWouldOpen()}');
    // Reached from the bottom nav and from Ctrl+Shift+F — navigation, not a request to type.
    expect(studio).toContain("{ label: 'Search', Icon: Search, onTap: () => handleScreenChange('search') }");
  });

  it('🔒 the DELIBERATE ones are listed, so a later sweep does not strip them blindly', () => {
    // Each of these renders only after the user asked for a field to type in. An unconditional
    // `autoFocus` there is correct, and this assertion is what says so out loud.
    for (const [file, gate] of [
      ['src/components/panels/FilesPanel.tsx', '{showNewFile && ('],
      ['src/components/ide/CodeVersioning.tsx', '{showSaveName ? ('],
      ['src/components/ide/LocalizationManager.tsx', '{showAddKey && ('],
      ['src/components/chat/ChatToolbar.tsx', '{searchOpen && showActions && ('],
    ] as const) {
      const src = read(file);
      expect(src, file).toContain('autoFocus');
      expect(src, `${file} must keep its user-asked-for gate`).toContain(gate);
    }
    // A dialog whose only content is a field — a password prompt — keeps it too.
    expect(read('src/components/ide/WebAppPlayer.tsx')).toContain('autoFocus');
  });

  it('and focusing a BUTTON or a panel is not this defect — no keyboard follows', () => {
    // ExitConfirmDialog focuses Cancel and HistoryPopup focuses the panel: both are keyboard-safe and
    // are real accessibility behaviour. Named here so they are never "fixed" by mistake.
    expect(read('src/components/ExitConfirmDialog.tsx')).toContain('cancelRef.current?.focus()');
    expect(read('src/components/history/HistoryPopup.tsx')).toContain('panelRef.current?.focus()');
  });
});
