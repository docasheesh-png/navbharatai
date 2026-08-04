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
    const branch = src.slice(branchStart, branchStart + 1600);
    expect(branch).toContain("label: 'History'");
    expect(branch).toContain("label: 'AI'");
    expect(branch).toContain("label: 'Mode'");
    expect(branch).toContain("label: 'Settings'");
  });

  it("Mode is a disabled 'coming soon' item, not a real view", () => {
    const branchStart = src.indexOf("(activeView === 'nbi_chat' || activeView === 'professionals') ?");
    const branch = src.slice(branchStart, branchStart + 1600);
    expect(branch).toMatch(/label: 'Mode',\s*comingSoon: true/);
    expect(branch).toContain('disabled={comingSoon}');
    expect(branch).toContain("addToast('Mode switching — coming soon'");
  });

  it('the AI item points at the active AI (professional vs free) and History/Settings navigate', () => {
    const branchStart = src.indexOf("(activeView === 'nbi_chat' || activeView === 'professionals') ?");
    const branch = src.slice(branchStart, branchStart + 1600);
    expect(branch).toContain("activeView === 'professionals' ? 'professionals' : 'nbi_chat'");
    expect(branch).toContain("id: 'history' as ViewType");
    expect(branch).toContain("id: 'settings' as ViewType");
    expect(branch).toContain('toggleTab(id)');
  });

  it('History from the Free footer opens History scoped to Free sessions only', () => {
    const branchStart = src.indexOf("(activeView === 'nbi_chat' || activeView === 'professionals') ?");
    const branch = src.slice(branchStart, branchStart + 1600);
    expect(branch).toContain("if (id === 'history') setHistoryInitialFilter(activeView === 'nbi_chat' ? 'free' : 'all')");
    // the scoped filter resets to 'all' when leaving History, and is passed into HistoryView
    expect(src).toContain("if (activeView !== 'history') setHistoryInitialFilter('all')");
    expect(src).toContain('initialFilter={historyInitialFilter}');
  });
});
