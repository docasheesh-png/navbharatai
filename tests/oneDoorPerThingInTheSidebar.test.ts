/**
 * The sidebar drawer showed Settings twice (admin 2026-09-19: "sidebar menu me 'setting' ke 2 option
 * dikh rahe hai — ek list me hai, ek system matrix me (squire). List wala hata do, system matrix wala
 * squire wala rahne do"). Both called the same `toggleTab(...)`, so the list row was pure duplication.
 *
 * What this suite locks is not just "the rows are gone" — it is WHERE they are gone from. The obvious fix
 * (add the ids to SIDEBAR_HIDDEN) would have removed them from the desktop/tablet RAIL too, and the rail
 * has no System Matrix section: that section lives inside the mobile drawer only. Settings' other door on
 * the rail is TopNav's user dropdown, which renders solely for a signed-in user. So a change whose whole
 * purpose was to remove a SECOND door would have removed the ONLY one for a signed-out user. Hence one assertion per half: gone from the drawer, still present on the rail.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');
const sidebar = readFileSync(join(root, 'src/components/panels/SidebarNav.tsx'), 'utf8');
const app = readFileSync(join(root, 'src/App.tsx'), 'utf8');

// Whole-line `//` comments are stripped before the halves are compared: the explanatory comment above
// `drawerItems` names "System Matrix" itself, so an unstripped rail half would match text that renders
// nothing. JSX comments are left alone — the drawer marker below is one.
const code = sidebar.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

// The drawer begins at its own marker comment; everything before it is the persistent rail.
const DRAWER_MARKER = 'Mobile slide-out navigation drawer';
const split = code.indexOf(DRAWER_MARKER);
const railHalf = code.slice(0, split);
const drawerHalf = code.slice(split);

// Every id that must appear exactly once in the drawer, as a System Matrix tile rather than a list row.
const DEDUPED: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'settings', label: 'Settings' },
  // Wallet & Billing took the tile the removed Donate option used to fill (admin 2026-09-26).
  { id: 'billing', label: 'Wallet &amp; Billing' },
];

describe('one door per thing in the sidebar', () => {
  it('splits cleanly into a rail half and a drawer half', () => {
    expect(split).toBeGreaterThan(0);
    // The System Matrix tiles are the drawer's doors, and they must be on the drawer side — if this ever
    // moves, every assertion below is measuring the wrong half.
    expect(drawerHalf).toContain('System Matrix');
    expect(railHalf).not.toContain('System Matrix');
  });

  it('drops the duplicated ids from the drawer LIST', () => {
    const set = /const DRAWER_HIDDEN = new Set\(\[([^\]]*)\]\)/.exec(sidebar);
    expect(set).not.toBeNull();
    for (const { id } of DEDUPED) expect(set![1]).toContain(`'${id}'`);
    expect(sidebar).toContain('const drawerItems = visibleItems.filter(item => !DRAWER_HIDDEN.has(item.id))');
    // The drawer's Core Navigation list renders drawerItems, never the unfiltered set — this is the
    // assertion that actually breaks if the filter is computed and then not used, which is the way this
    // class of fix usually rots.
    expect(drawerHalf).toContain('drawerItems.map');
    expect(drawerHalf).not.toContain('visibleItems.map');
  });

  it('keeps them on the desktop/tablet RAIL, which has no System Matrix to fall back on', () => {
    expect(railHalf).toContain('visibleItems.map');
    expect(railHalf).not.toContain('drawerItems.map');
  });

  it('never hides them globally via SIDEBAR_HIDDEN', () => {
    const hidden = /const SIDEBAR_HIDDEN = new Set\(\[([^\]]*)\]\)/.exec(sidebar);
    expect(hidden).not.toBeNull();
    for (const { id } of DEDUPED) expect(hidden![1]).not.toContain(`'${id}'`);
  });

  it('keeps exactly one System Matrix tile per deduplicated id', () => {
    for (const { id, label } of DEDUPED) {
      expect(drawerHalf.match(new RegExp(`toggleTab\\('${id}'\\)`, 'g'))!.length).toBe(1);
      expect(drawerHalf).toContain(`>${label}</span>`);
    }
  });

  it('keeps the entry in menuItems, which other surfaces read by id', () => {
    // TopNav does `menuItems.find(m => m.id === tabId); if (!item) return null`, and the mobile footer
    // reads the settings entry's icon for its "More" button — deleting it would silently break them.
    expect(app).toMatch(/\{\s*id: 'settings',\s*label: 'Settings',\s*icon: Settings\s*\}/);
    expect(app).toContain("menuItems.find(m => m.id === 'settings')?.icon");
  });
});
