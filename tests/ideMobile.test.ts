import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Phone-first Code Studio (admin 2026-07-31): on a narrow screen the editor is tuned for touch and the
 * key no-Ctrl actions become tap buttons. Desktop is untouched. Source-level lock.
 */
const studio = readFileSync(join(__dirname, '../src/components/ide/CodeStudio.tsx'), 'utf8');
const editor = readFileSync(join(__dirname, '../src/components/ide/Editor.tsx'), 'utf8');


/**
 * The phone footer block, sliced by its real boundaries rather than a fixed character count. A
 * character window broke the moment a menu entry was added — a test that fails for a change it does
 * not cover teaches people to widen the number instead of reading the failure.
 */
const footerBlock = (): string => {
  const start = studio.indexOf('PHONE BOTTOM-TAB IDE');
  const end = studio.indexOf('Code Studio\'s own footer is now the BOTTOM-MOST bar', start);
  return studio.slice(start, end > start ? end + 4000 : start + 9000);
};

describe('Mobile editor is tuned for touch', () => {
  it('CodeStudio overrides Monaco options when isMobile (no minimap/sticky, word-wrap, fat scrollbars)', () => {
    const i = studio.indexOf('...(isMobile ? {');
    expect(i).toBeGreaterThan(-1);
    const block = studio.slice(i, i + 900);   // the phone-override object itself, not the footer
    expect(block).toContain('minimap: { enabled: false }');
    expect(block).toContain('stickyScroll: { enabled: false }');
    expect(block).toContain("wordWrap: 'on'");
    expect(block).toContain('verticalScrollbarSize: 14');
  });
});

describe('Mobile action toolbar (no Ctrl key on a phone)', () => {
  it('shows Undo / Redo / Find / SAVE as tap buttons on mobile only', () => {
    expect(editor).toContain("editorRef.current?.trigger('mobile-toolbar', 'undo', {})");
    expect(editor).toContain("editorRef.current?.trigger('mobile-toolbar', 'redo', {})");
    expect(editor).toContain("editorRef.current?.getAction('actions.find')?.run()");
    expect(editor).toContain('md:hidden h-11');
    const row = editor.slice(editor.indexOf('md:hidden h-11'), editor.indexOf('md:hidden h-11') + 1600);
    // SAVE, not Run (admin 2026-08-04). The green Run only re-ran the PREVIEW — already reachable from
    // the header button — while Ctrl+S, the one action a phone genuinely cannot perform, had no button.
    expect(row).toContain('handleSave');
    expect(row).not.toContain('onRun');
  });

  it('has NO dead controls left in the editor toolbar', () => {
    // A control that does nothing is worse than a missing one: it teaches the user the app is broken.
    // The old row shipped a <Layout/> icon with no onClick at all, and a ▶ that duplicated Preview.
    expect(editor).not.toContain('<Layout className');
    expect(editor).not.toContain("aria-label=\"Run project\"");
  });
});

describe('Save is real, and says so honestly', () => {
  it('confirms in WORDS, and only after the save resolves', () => {
    expect(editor).toContain('justSaved');
    expect(editor).toContain('Saved');
    // `await onSave()` BEFORE the confirmation — the durable sync is debounced, so announcing success
    // first would be a fake success message the user would trust and act on.
    const i = editor.indexOf('const handleSave');
    const fn = editor.slice(i, i + 700);
    expect(fn).toContain('await onSave()');
    expect(fn.indexOf('await onSave()')).toBeLessThan(fn.indexOf('setJustSaved(true)'));
    // A failed save must NOT claim success.
    expect(fn).toContain('return;');
  });

  it('Code Studio waits for the DURABLE flush before reporting saved', () => {
    const i = studio.indexOf('const handleSaveActiveFile');
    expect(i).toBeGreaterThan(-1);
    const fn = studio.slice(i, i + 400);
    expect(fn).toContain("handleShortcut([], 'base.action.save')");
    expect(fn).toContain('await onFlushEdits()');
  });

  it('Code Studio edits go through the DURABLE edit seam, not raw setFiles', () => {
    // ROOT CAUSE (2026-08-04): the syncer was wired into the Git panel only, so typing in the IDE
    // never reached the durable workspace — the edit looked saved and did not survive a reload.
    const app = readFileSync(join(__dirname, '../src/App.tsx'), 'utf8');
    expect(app).toContain('const applyIdeFileChange');
    expect(app).toContain('onIdeFilesChange={applyIdeFileChange}');
    const panels = readFileSync(join(__dirname, '../src/components/panels/ViewPanels.tsx'), 'utf8');
    const i = panels.indexOf('<CodeStudio');
    expect(panels.slice(i, i + 900)).toContain('onFilesChange={onIdeFilesChange}');
  });
});

describe('Phone bottom-tab IDE', () => {
  it('has a bottom tab bar with Code / Files / Terminal / Debug / More', () => {
    expect(studio.indexOf('PHONE BOTTOM-TAB IDE')).toBeGreaterThan(-1);
    const block = footerBlock();
    for (const label of ["label: 'Code'", "label: 'Files'", "label: 'Terminal'", "label: 'Debug'", "label: 'More'"]) {
      expect(block).toContain(label);
    }
    // AI and PREVIEW are NOT footer tabs — both are top-right header buttons, and offering the same
    // action twice on the smallest screen costs a tab and makes the user wonder if they differ.
    expect(block).not.toContain("label: 'Preview'");
    expect(block).not.toContain("label: 'AI'");
  });

  it('NEVER hides itself — a bottom bar that vanishes is a trapdoor', () => {
    // It used to disappear whenever the AI overlay opened — the one moment the user most needed a way
    // back, leaving the IDE with no visible navigation at all (admin: "apne aap gayab ho jata hai").
    const block = footerBlock();
    expect(block).toContain('{isMobile && (');
    expect(block).not.toContain("isMobile && activeScreen !== 'ai' && (");
  });

  it('the terminal has exactly ONE entrance on a phone', () => {
    // It had three (a floating handle, the More sheet, and no footer tab), so a user could not tell
    // whether they had opened the same terminal or a different one.
    const block = footerBlock();
    expect(block).toContain("label: 'Terminal', Icon: TerminalIcon");   // the footer tab
    expect(block).not.toContain("{ label: 'Terminal', Icon: TerminalIcon, onTap:");  // gone from More
    // The floating handle is desktop-only now.
    const handle = studio.slice(studio.indexOf('Open terminal panel') - 400, studio.indexOf('Open terminal panel') + 200);
    expect(handle).toContain('!isMobile');
  });

  it('the More sheet keeps the remaining secondary dev tools reachable', () => {
    const block = footerBlock();
    for (const label of ["label: 'Search'", "label: 'Source Control'", "label: 'Security'", "label: 'Shortcuts'"]) {
      expect(block).toContain(label);
    }
  });

  it('the global app nav and the space reserved for it read ONE flag', () => {
    // They drifted twice: focus mode, then Code Studio — 56px held for a nav that was not rendered,
    // floating the IDE's own footer off the screen edge with a dead strip beneath it.
    const app = readFileSync(join(__dirname, '../src/App.tsx'), 'utf8');
    expect(app).toContain('const showsGlobalMobileNav');
    expect(app).toContain('showsGlobalMobileNav ? { paddingBottom: MOBILE_NAV_TOTAL_HEIGHT } : undefined');
    expect(app).toContain('{showsGlobalMobileNav && (');
  });

  it('…and ONE height, which is the half that was still drifting', () => {
    // The flag fixed WHETHER the bar exists. It said nothing about HOW TALL it is, and the two
    // disagreed: the bar is `3.5rem + env(safe-area-inset-bottom)`, the reservation was a bare
    // `pb-14` — so on every iPhone the page's bottom row (the Professionals composer) was hidden by
    // exactly the home-indicator inset. Admin screenshot, TestFlight, 2026-08-25.
    const app = readFileSync(join(__dirname, '../src/App.tsx'), 'utf8');
    expect(app).not.toContain('showsGlobalMobileNav ? "pb-14"');
    // Import + the bar's own height + the page reservation.
    expect(app.split('MOBILE_NAV_TOTAL_HEIGHT').length - 1).toBeGreaterThanOrEqual(3);
    expect(app).not.toContain("height: 'calc(3.5rem + env(safe-area-inset-bottom, 0px))'");
  });
});
