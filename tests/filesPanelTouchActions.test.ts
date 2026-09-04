import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * THE PER-ROW ICON STRIP IS DESKTOP-ONLY (admin 2026-09-03).
 *
 * Report, with a phone screenshot of the whole right-hand column ringed in red: *"jab koi app banata
 * hai, aur user file wala button se jab file kholta hai, to yaha bahut se button dikhte hai … uske
 * andar woh sare button hatao."*
 *
 * ROOT CAUSE — it was never one row of buttons, it was TWO SETS OF THE SAME ACTIONS. On a touch
 * layout the file row already opens a tap menu of real labelled buttons, so the five 10px icons
 * beside every row were a second, harder-to-hit copy of it. They could not even hover-hide there
 * (`opacity-60` below `sm`), so they sat on screen permanently and took the width that made
 * filenames truncate mid-name.
 *
 * THE INVARIANT THIS FILE LOCKS: the strip and the tap menu are MUTUALLY EXCLUSIVE, and between them
 * every action stays reachable exactly once. The second half matters as much as the first — deleting
 * the strip alone would have removed Rename and Duplicate from every phone, which is a lost feature
 * wearing the costume of a tidier screen.
 */
const panel = readFileSync(join(__dirname, '..', 'src/components/panels/FilesPanel.tsx'), 'utf8');

const STRIP_GATE = '{!tapActions && (';
const MENU_GATE = '{tapActions && actionPath === path';

const stripAt = panel.indexOf(STRIP_GATE);
const menuAt = panel.indexOf(MENU_GATE);
/** The icon strip: from its own gate up to where the tap menu begins. */
const strip = panel.slice(stripAt, menuAt);
/** The tap menu: its gate to its last element (`copyNote`). Bounded by a real marker rather than a
 *  character count, so a "Rename" elsewhere in the file can never satisfy an assertion below. */
const menu = panel.slice(menuAt, panel.indexOf('{copyNote &&', menuAt));

describe('the icon strip never renders on a touch layout', () => {
  it('is gated on !tapActions, so it cannot sit beside the tap menu', () => {
    expect(stripAt).toBeGreaterThan(-1);
    expect(menuAt).toBeGreaterThan(stripAt);
  });

  it('🔒 the five icons live INSIDE that gate — not one of them escapes it', () => {
    // If a button is moved out of the gated block it renders on mobile again, which is the exact
    // screen the admin ringed in red.
    for (const icon of ['Eye', 'Copy', 'Plus', 'Pencil', 'Trash2']) {
      expect(strip, `${icon} icon must be inside the desktop-only strip`).toContain(`<${icon} className="w-2.5 h-2.5" />`);
    }
  });
});

describe('🔒 nothing was taken away from mobile — every strip action is in the tap menu', () => {
  it('the menu offers all seven actions as real labelled buttons', () => {
    for (const label of ['See', 'Open', 'Copy file', 'Copy path', 'Rename', 'Duplicate', 'Delete']) {
      expect(menu, `the tap menu must offer ${label}`).toContain(`> ${label}\n`);
    }
  });

  it('Rename and Duplicate — the two that existed ONLY in the strip — really do the work', () => {
    // A labelled button that does not wire the same handler would be the "looks done, does nothing"
    // state the second absolute rule forbids.
    expect(menu).toContain('setRenamingPath(path); setRenameValue(path);');
    expect(menu).toContain('onDuplicateFile(path, copyPath);');
  });

  it('each stays behind the same capability guard it had in the strip', () => {
    // The panel is rendered in places that pass no rename/duplicate handler; an ungated button there
    // would be a dead control.
    expect(menu).toContain('{onRenameFile && (');
    expect(menu).toContain('{onDuplicateFile && (');
  });

  it('an action taken from the menu closes it, so the row does not stay expanded', () => {
    expect(menu).toContain('setActionPath(null); setRenamingPath(path)');
    expect(menu).toMatch(/setActionPath\(null\);\s*\n\s*onDuplicateFile\(path, copyPath\)/);
  });
});
