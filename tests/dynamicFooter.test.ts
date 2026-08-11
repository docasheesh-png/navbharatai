import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * PART 1 — the dynamic bottom footer (admin 2026-07-28): NavBharatAI Free (nbi_chat) and Professional
 * (professionals) get a focused nav — History / AI / Mode (coming soon) / Settings — instead of the
 * default Home / AI / Preview / Studio / More. Source-level lock (the footer lives inline in App.tsx).
 */
const src = readFileSync(join(__dirname, '../src/App.tsx'), 'utf8');

describe('dynamic per-AI footer', () => {
  it('renders the focused footer for NavBharatAI Free + Professional', () => {
    expect(src).toContain("(activeView === 'nbi_chat' || activeView === 'professionals') ?");
  });

  it('the focused footer is exactly History / AI / Mode / Settings', () => {
    const branchStart = src.indexOf("(activeView === 'nbi_chat' || activeView === 'professionals') ?");
    const branch = src.slice(branchStart, branchStart + 2600);
    expect(branch).toContain("label: 'History'");
    expect(branch).toContain("label: 'AI'");
    expect(branch).toContain("label: 'Mode'");
    expect(branch).toContain("label: 'Settings'");
  });

  it("Mode is a disabled 'coming soon' item, not a real view", () => {
    const branchStart = src.indexOf("(activeView === 'nbi_chat' || activeView === 'professionals') ?");
    const branch = src.slice(branchStart, branchStart + 2600);
    expect(branch).toMatch(/label: 'Mode',\s*comingSoon: true/);
    expect(branch).toContain('disabled={comingSoon}');
    expect(branch).toContain("addToast('Mode switching — coming soon'");
  });

  it('the AI item points at the active AI (professional vs free) and History/Settings navigate', () => {
    const branchStart = src.indexOf("(activeView === 'nbi_chat' || activeView === 'professionals') ?");
    const branch = src.slice(branchStart, branchStart + 2600);
    expect(branch).toContain("activeView === 'professionals' ? 'professionals' : 'nbi_chat'");
    expect(branch).toContain("id: 'history' as ViewType");
    expect(branch).toContain("id: 'settings' as ViewType");
    expect(branch).toContain('toggleTab(id)');
  });

  it('History is scoped to where it was opened from — Free → free (locked), Professionals → professional', () => {
    const branchStart = src.indexOf("(activeView === 'nbi_chat' || activeView === 'professionals') ?");
    const branch = src.slice(branchStart, branchStart + 2600);
    expect(branch).toContain("setHistoryInitialFilter(activeView === 'nbi_chat' ? 'free' : activeView === 'professionals' ? 'professional' : 'all')");
    // the scoped filter resets to 'all' when leaving History
    expect(src).toContain("if (activeView !== 'history') setHistoryInitialFilter('all')");
    // Free is LOCKED to its own sessions (the filter tabs are hidden so it can't be switched to the whole app)
    expect(src).toContain("lockFilter={historyInitialFilter === 'free'}");
    // Professionals gets the dedicated professional-only history, never the generic session list.
    expect(src).toContain("historyInitialFilter === 'professional'");
    expect(src).toContain('<ProfessionalHistoryView');
  });
});
