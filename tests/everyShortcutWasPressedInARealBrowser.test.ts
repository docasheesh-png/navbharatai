/**
 * EVERY SHORTCUT WAS PRESSED IN A REAL BROWSER (admin 2026-09-24: "sabhi list ko ek ek kar ke verify
 * karo! kon kon se shortcut kam kar rahe hai, kon kon se nahi! jo kaam kar rahe hai, unko aur
 * rocksolid banao, aur jo kaam nahi kar rahe hai, usko working karo!").
 *
 * The audit (`scripts/ideShortcutAudit/`, Playwright, Chromium, 390×844 phone and 1280×800 desktop,
 * a harness page mounting the whole Code Studio) pressed all 82 entries through the popup and
 * asserted each one's OBSERVABLE effect — a moved cursor, a changed line count, a widget on screen,
 * a callback fired. `tests/ideNoDeadControls.test.ts` proves every advertised command has a handler;
 * this file locks the ROOT CAUSES of the ones that had a handler and still did nothing:
 *
 *   • Ctrl+T / Ctrl+L / Ctrl+G / Ctrl+D ran `getAction(id).run()` on whatever had focus — after a
 *     tap in the popup that is the popup, and Monaco threw "Quick input service needs a focused
 *     editor to work". The generic passthrough always focused first; these sites had drifted.
 *   • Alt+← / Alt+→ called `window.history.back()` / `.forward()` — the BROWSER's back button, which
 *     leaves Code Studio. The cursor never moved.
 *   • F9 dispatched `editor.debug.action.toggleBreakpoint`, a VS CODE id Monaco does not have:
 *     "command … not found" on every press, and never a breakpoint.
 *   • "Accept Suggestion" (Tab) cannot work from a popup whose tap closes the suggestion list; it is
 *     no longer listed rather than listed and dead.
 *   • "Save All Files" was labelled Ctrl+K S while the physical listener binds Ctrl+Shift+S.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const studio = stripComments(read('src/components/ide/CodeStudio.tsx'));
const keyboard = read('src/components/ide/VirtualKeyboard.tsx');
const keyboardCode = stripComments(keyboard);

describe('a Monaco action is always run with the editor focused', () => {
  it('there is ONE helper, and it focuses before it runs', () => {
    const i = studio.indexOf('const runEditorAction = (id: string) =>');
    expect(i).toBeGreaterThan(0);
    const body = studio.slice(i, i + 400);
    expect(body.indexOf('editorInstance.focus()')).toBeLessThan(body.indexOf('.run()'));
    // Core commands (cursorUndo, …) are not actions; the helper must reach them through `trigger`.
    expect(body).toContain("editorInstance.trigger('keyboard', id, {})");
  });

  it('no call site runs an action without it (the drifted-copy class)', () => {
    const bare = [...studio.matchAll(/editorInstance\?\.getAction\('([^']+)'\)\?\.run\(\)/g)].map((m) => m[1]);
    expect(bare).toEqual([]);
  });

  it('the four audited shortcuts go through the helper', () => {
    for (const id of ['expandLineSelection', 'editor.action.quickOutline', 'editor.action.gotoLine', 'editor.action.addSelectionToNextFindMatch']) {
      expect(studio).toContain(`runEditorAction('${id}')`);
    }
  });
});

describe('Go Back / Go Forward walk the cursor history, never the browser history', () => {
  it("handleShortcut maps them to Monaco's cursorUndo / cursorRedo", () => {
    expect(studio).toMatch(/case 'workbench\.action\.navigateBack':\s*case 'workbench\.action\.navigateForward':/);
    expect(studio).toContain("runEditorAction(command === 'workbench.action.navigateBack' ? 'cursorUndo' : 'cursorRedo')");
  });
  it('window.history.back / forward are not called from a shortcut', () => {
    expect(studio).not.toContain('window.history.back()');
    expect(studio).not.toContain('window.history.forward()');
  });
  it('the panel says what they do', () => {
    expect(keyboard).toContain("label: 'Go Back (previous cursor spot)'");
    expect(keyboard).toContain("label: 'Go Forward (next cursor spot)'");
  });
});

describe('F9 sets a real breakpoint', () => {
  it('is handled by the debugger path, on the cursor line, in the pane being edited', () => {
    const i = studio.indexOf("case 'editor.debug.action.toggleBreakpoint'");
    expect(i).toBeGreaterThan(0);
    const body = studio.slice(i, i + 500);
    expect(body).toContain('handleToggleBreakpoint(bpPath, line)');
    expect(body).toContain("splitOpen && focusedPane === 'right' ? splitActive : activeFile");
  });
  it('the generic `editor.` passthrough does not swallow it first (Monaco has no such command)', () => {
    const i = studio.indexOf("command !== 'editor.debug.action.toggleBreakpoint'");
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(studio.indexOf("case 'editor.debug.action.toggleBreakpoint'"));
  });
});

describe('honest listing', () => {
  it('"Accept Suggestion" is not advertised from a popup that cannot deliver it', () => {
    expect(keyboardCode).not.toContain("label: 'Accept Suggestion'");
    expect(keyboardCode).not.toContain("command: 'acceptSelectedSuggestion'");
  });
  it('Save All is labelled with the key that actually saves all', () => {
    expect(keyboard).toContain("key: 'ctrl+shift+s', label: 'Save All Files'");
    expect(keyboard).not.toContain("key: 'ctrl+k s', label: 'Save All Files'");
    // …and that IS the physical binding.
    expect(studio).toContain("call(['ctrl', 'shift', 's'], 'workbench.action.files.saveAll')");
  });
});

describe('the editor instance survives a keystroke', () => {
  // The biggest find of the audit, and not a popup bug at all: `Editor.tsx` reported `onMount(null)`
  // from an effect that depended on `[onMount]`, an inline arrow in CodeStudio — so the cleanup ran on
  // EVERY re-render, i.e. every keystroke, and `editorInstance` was null from the first character
  // typed until the editor was clicked again. Undo from the menu, Format Document, every popup
  // shortcut: silently dead in that window.
  const editor = stripComments(read('src/components/ide/Editor.tsx'));
  it('the memo comparator names every paint-affecting prop — a gutter click drew no glyph until the next keystroke', () => {
    const cmp = editor.slice(editor.lastIndexOf('(prev, next) =>'));
    for (const prop of ['activeBreakpoints', 'dirtyTabs', 'editorOptions', 'editorTheme', 'liteEditor', 'hideHeaderDebug']) {
      expect(cmp, prop).toContain(prop);
    }
  });
  it('the unmount report has NO dependencies and reads the callback through a ref', () => {
    expect(editor).toMatch(/useEffect\(\(\) => \{\s*return \(\) => \{\s*onMountRef\.current\?\.\(null\);\s*\};\s*\}, \[\]\);/);
    expect(editor).not.toMatch(/\}, \[onMount\]\);/);
    expect(editor).toContain('onMountRef.current?.(editor)');
  });
});
