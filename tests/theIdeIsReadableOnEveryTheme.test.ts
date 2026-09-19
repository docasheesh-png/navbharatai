import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * 🔴 TWO PROBLEMS THE ADMIN REPORTED FROM A PHONE SCREENSHOT OF CODE STUDIO (2026-09-19):
 *   1. *"light theme me visiblity kam"*
 *   2. *"upfooter me jo button hai {}()[] etc etc woh kaam nahi kar rahe hai. actualy unki need hi
 *      nahi hai. hata do!!"*
 *
 * **The first had one cause, and it is measurable rather than a matter of taste.** `Editor.tsx` — the
 * whole editor pane: tab strip, breadcrumb, mobile toolbars — was still written in VS-Code-dark
 * literals (`bg-[#1e1e1e]`, `bg-[#252526]`, `bg-[#2d2d2d]`, `bg-[#1f1f1f]`, `text-white`), and
 * `theme-compat.css` remaps only SOME of them: `#1e1e1e` and `#252526` are in its allowlist, while
 * `#2d2d2d`, `#2a2d2e` and `#1f1f1f` are not. So on Light the same pane came out half repainted and
 * half frozen — the active tab turned light while the inactive tabs stayed near-black, and the
 * action bar under the editor stayed a black strip with white-alpha buttons on it. Exactly the
 * failure CLAUDE.md predicts of an allowlist against an open-ended set of class names.
 *
 * The fix is at the source: the pane is on tokens, so the ratchet keeps it there for ever.
 */

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const editor = read('src/components/ide/Editor.tsx');
const studio = read('src/components/ide/CodeStudio.tsx');
const keyboard = read('src/components/ide/VirtualKeyboard.tsx');
const baseline = JSON.parse(read('tests/fixtures/themeColourBaseline.json')) as Record<string, number>;

/** Comments are prose, not usage — the same discipline `themeColourBaseline.mjs` and
 *  `uiLanguageEnglishOnly` already apply, and this file's own notes NAME the classes it forbids. */
const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n');
const editorCode = codeOnly(editor);

describe('1 — the editor pane carries no colour of its own', () => {
  it('🔒 Editor.tsx is OUT of the colour baseline, so the ratchet allows it zero literals', () => {
    // The ratchet's own contract: "a file not in the baseline has a baseline of ZERO". This is the
    // durable half of the fix — a new `bg-[#1e1e1e]` in this file now fails CI rather than waiting
    // for somebody to open Code Studio on a light phone.
    expect(baseline['src/components/ide/Editor.tsx']).toBeUndefined();
    expect(baseline['src/components/ide/VirtualKeyboard.tsx']).toBeUndefined();
  });

  it('not one of the five literals that made the pane unreadable survives', () => {
    for (const lit of ['bg-[#1e1e1e]', 'bg-[#252526]', 'bg-[#2d2d2d]', 'bg-[#2a2d2e]', 'bg-[#1f1f1f]', 'text-white']) {
      expect(editorCode, lit).not.toContain(lit);
    }
    // ⚠️ `var(--surface-card, #1e1e1e)` on the mobile textarea is NOT one of these and must stay: the
    // variable wins wherever a theme is set, and the hex is the no-theme fallback. A previous session
    // fixed exactly that one element on 2026-07-22 for exactly this complaint — and left the rest of
    // the pane on literals. The instance was fixed; the class was not. That is what this file closes.
    expect(editor).toContain("var(--surface-card, #1e1e1e)");
  });

  it('🔑 the three tab surfaces are DIFFERENT, so a selected tab is visible on every theme', () => {
    // The bug was not only darkness: compat mapped the active tab AND the strip to the same themed
    // surface, so on Light the selection marker was the one thing that disappeared. Active = the
    // editor's own surface (the tab reads continuous with the code), strip = the page behind it,
    // inactive = recessed.
    const strip = editor.slice(editor.indexOf('{/* Tab bar */}'), editor.indexOf('{/* Tab bar */}') + 900);
    expect(strip).toContain('h-9 bg-surface');
    expect(strip).toContain('isActive ? "bg-card text-ink"');
    expect(strip).toContain('bg-well text-muted hover:bg-well-hover');
    expect(strip).toContain('border-r border-line');
  });

  it('the mobile action bar is chrome, not a black strip with white-alpha buttons', () => {
    const bar = editor.slice(editor.indexOf('md:hidden h-11'), editor.indexOf('md:hidden h-11') + 2400);
    expect(bar).toContain('md:hidden h-11 bg-card border-t border-line');
    // Each state names its own label colour: the un-saved Save button was `text-on-accent` on a
    // raised surface, i.e. a near-white word on a light bar.
    expect(bar).toContain("'bg-raised active:bg-raised-hover text-ink'");
    expect(bar).toContain("justSaved ? 'bg-emerald-600 text-on-accent'");
  });

  it("CodeStudio's floating terminal button no longer fixes its fill while theming its icon", () => {
    // `bg-[#333] hover:bg-[#444]` with `text-muted` — a dark-grey icon on a dark-grey disc once the
    // icon followed the theme and the disc could not.
    expect(studio).not.toContain('bg-[#333]');
    expect(studio).not.toContain('hover:bg-[#444]');
  });

  it('the shortcut panel had labels that were invisible on EVERY theme, not just Light', () => {
    // `#21262d` is GitHub-dark's BORDER colour used as a TEXT colour — about 1.3:1 on that panel.
    expect(keyboard).not.toContain('#21262d');
    // A white pill with black ink said "selected" on dark and nothing at all on light.
    expect(keyboard).not.toContain('bg-white text-black');
    expect(keyboard).toContain('bg-accent text-on-accent');
  });
});

describe('2 — the symbol row is gone, and cannot come back by accident', () => {
  it('no insertion path, no strip, and no reach for the monaco global', () => {
    expect(editor).not.toContain("executeEdits('helper'");
    expect(editor).not.toContain('md:hidden h-10');
    // It was the ONLY place in the repo that touched `window.monaco`; every button that works on that
    // bar goes through `editorRef.current` alone.
    expect(editorCode).not.toContain('window as any).monaco');
    expect(editorCode).not.toMatch(/\bwindow\.monaco\b/);
  });

  it('⚠️ REVERSION GUARD — the reason it is gone is recorded where the next editor will read it', () => {
    const note = editor.slice(editor.indexOf('THE SYMBOL ROW IS GONE'), editor.indexOf('THE SYMBOL ROW IS GONE') + 1800);
    expect(note).toContain('autoClosingBrackets');
    expect(note).toContain('Do NOT re-add it');
  });

  it('🔒 and the toolbar it sat under is untouched — Undo / Redo / Find / Save all still there', () => {
    // The row that WORKS was not the row that was removed. `tests/ideMobile.test.ts` owns these
    // assertions; repeated here because deleting a neighbouring block is exactly how they get lost.
    expect(editor).toContain("editorRef.current?.trigger('mobile-toolbar', 'undo', {})");
    expect(editor).toContain("editorRef.current?.trigger('mobile-toolbar', 'redo', {})");
    expect(editor).toContain("editorRef.current?.getAction('actions.find')?.run()");
    expect(editor).toContain('handleSave');
  });
});
