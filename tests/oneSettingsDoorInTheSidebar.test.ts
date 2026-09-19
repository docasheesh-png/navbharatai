/**
 * The sidebar drawer showed Settings TWICE (admin 2026-09-19: "sidebar menu me Settings ke 2 option
 * dikh rahe hai — ek list me hai, ek System Matrix me (square). List wala hata do, System Matrix wala
 * rahne do"). Both rows called `toggleTab('settings')`, so one of them was pure duplication.
 *
 * What this suite locks is not just "the row is gone" — it is WHERE it is gone from. The obvious fix
 * (add 'settings' to SIDEBAR_HIDDEN) would have removed it from the desktop/tablet RAIL too, and the
 * rail has no System Matrix section: that section lives inside the mobile drawer only. The rail's other
 * door is TopNav's user dropdown, which renders solely for a signed-in user — so a signed-out desktop
 * user would have been left with no way into Settings at all, from a change whose whole purpose was to
 * remove a SECOND door. Hence one assertion per half: gone from the drawer, still present on the rail.
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

describe('one Settings door in the sidebar', () => {
  it('splits cleanly into a rail half and a drawer half', () => {
    expect(split).toBeGreaterThan(0);
    // The System Matrix square is the drawer's Settings door, and it must be on the drawer side —
    // if this ever moves, every assertion below is measuring the wrong half.
    expect(drawerHalf).toContain('System Matrix');
    expect(railHalf).not.toContain('System Matrix');
  });

  it('drops Settings from the drawer LIST', () => {
    expect(sidebar).toContain("const drawerItems = visibleItems.filter(item => item.id !== 'settings')");
    // The drawer's Core Navigation list renders drawerItems, never the unfiltered set — this is the
    // assertion that actually breaks if the filter is computed and then not used, which is the way
    // this class of fix usually rots.
    expect(drawerHalf).toContain('drawerItems.map');
    expect(drawerHalf).not.toContain('visibleItems.map');
  });

  it('keeps Settings on the desktop/tablet RAIL, which has no System Matrix to fall back on', () => {
    expect(railHalf).toContain('visibleItems.map');
    expect(railHalf).not.toContain('drawerItems.map');
  });

  it('never hides Settings globally via SIDEBAR_HIDDEN', () => {
    const hidden = /const SIDEBAR_HIDDEN = new Set\(\[([^\]]*)\]\)/.exec(sidebar);
    expect(hidden).not.toBeNull();
    expect(hidden![1]).not.toContain('settings');
  });

  it('keeps the System Matrix Settings tile as the drawer door', () => {
    expect(drawerHalf).toContain("toggleTab('settings')");
    // Exactly one Settings door in the drawer, not two.
    expect(drawerHalf.match(/toggleTab\('settings'\)/g)!.length).toBe(1);
  });

  it("keeps the 'settings' entry in menuItems, which other surfaces read by id", () => {
    // TopNav does `menuItems.find(m => m.id === tabId); if (!item) return null`, and the mobile footer
    // reads this entry's icon for its "More" button — deleting the entry would silently break both.
    expect(app).toMatch(/\{\s*id: 'settings',\s*label: 'Settings',\s*icon: Settings\s*\}/);
    expect(app).toContain("menuItems.find(m => m.id === 'settings')?.icon");
  });
});
