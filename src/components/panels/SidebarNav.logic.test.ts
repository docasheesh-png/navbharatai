import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * WHAT THE SIDEBAR SHOWS — and, just as importantly, what stays REACHABLE after it stops showing it.
 *
 * Four entries have been removed from the sidebar over time (Git, Preview, Files, History) and each was
 * removed the same way: hidden from the rail, KEPT in `menuItems`. These tests pin that shape, because
 * the tempting version of the change — deleting the row from `menuItems` — breaks the feature silently.
 */

const sidebar = readFileSync(join(process.cwd(), 'src/components/panels/SidebarNav.tsx'), 'utf8');
const app = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');
const topNav = readFileSync(join(process.cwd(), 'src/components/panels/TopNav.tsx'), 'utf8');

function hiddenIds(): string[] {
  const m = sidebar.match(/SIDEBAR_HIDDEN = new Set\(\[([^\]]*)\]\)/);
  if (!m) return [];
  return m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

describe('the sidebar’s hidden list', () => {
  it('hides Professionals — it moved inside NavBharatAI FREE', () => {
    // admin 2026-09-11: "professional wale option ko navbharatai free ke andar hi shift kar diya gaya
    // hai, to sidebar menu me se bhi isko hata do".
    expect(hiddenIds()).toContain('professionals');
  });

  it('still hides the four that moved earlier', () => {
    for (const id of ['git', 'preview', 'files', 'history']) expect(hiddenIds()).toContain(id);
  });

  it('🔒 every hidden id is STILL in menuItems — hiding is not deleting', () => {
    // TopNav does `const item = menuItems.find(m => m.id === tabId); if (!item) return null`, so an id
    // dropped from menuItems opens with NO header window and no error. That is the bug the `other_ai`
    // entry in App.tsx was added to fix, and this assertion is what stops it coming back.
    for (const id of hiddenIds()) {
      expect(app, `menuItems is missing "${id}"`).toMatch(new RegExp(`id: '${id}'`));
    }
  });

  it('🔒 TopNav really does drop a tab with no menuItems entry (the reason for the rule above)', () => {
    expect(topNav).toContain('menuItems.find(m => m.id === tabId)');
    expect(topNav).toContain('if (!item) return null');
  });

  it('the filter applies the hidden set to what the sidebar renders', () => {
    expect(sidebar).toContain('menuItems.filter(item => !SIDEBAR_HIDDEN.has(item.id)');
  });
});

describe('🔒 Professionals is still REACHABLE — a hidden door is only safe when another one exists', () => {
  const modePicker = readFileSync(join(process.cwd(), 'src/components/chat/modePicker.ts'), 'utf8');

  it('the Free chat’s Mode list is built from the real professional configs', () => {
    // This is the door the sidebar row was made redundant BY. If this ever stops listing them, hiding
    // the sidebar entry stops being a tidy-up and becomes a removal.
    expect(modePicker).toContain("from '../professionals/professionalConfigs'");
    expect(modePicker).toContain('PROFESSIONAL_CHATS');
  });

  it('the hub view itself still has a way back', () => {
    // Professional history's back button opens the hub, so the view is not orphaned code.
    expect(app).toContain("toggleTab('professionals')");
  });
});

describe('🔒 every AI in the app now gives the RIGHT directions', () => {
  // AppKnowledgeBase is what Free Chat, Pro Chat, Engineer AI and Doctor AI read to answer "where is
  // X?". Hiding the sidebar row without fixing these would make every assistant in NavBharatAI send
  // users to a door that is not there — a worse outcome than leaving the row in place.
  const kb = readFileSync(join(process.cwd(), 'src/server/AppContext/AppKnowledgeBase.ts'), 'utf8');

  it('no entry still routes a user through "Sidebar → Professionals"', () => {
    expect(kb).not.toContain('Sidebar → Professionals');
  });

  it('the experts are directed through the Mode button instead', () => {
    expect(kb).toContain('NavBharatAI Free chat → Mode (bottom bar) → Doctor AI');
    expect(kb).toContain('NavBharatAI Free chat → Mode (bottom bar) → Teacher AI');
  });

  it('the SIDEBAR’s own description no longer lists Professionals among its screens', () => {
    const at = kb.indexOf('• SIDEBAR / MENU');
    expect(at).toBeGreaterThan(-1);
    const para = kb.slice(at, at + 700);
    expect(para).toContain('the full list of screens');
    expect(para).not.toMatch(/the full list of screens:[^.]*the Professionals,/);
  });
});
