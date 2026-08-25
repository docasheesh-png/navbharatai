import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * PART 1 — the dynamic bottom footer (admin 2026-07-28; Mode made REAL 2026-08-25): every chat surface
 * (NavBharatAI Free, the Professionals hub, Doctor AI, each professional) gets a focused nav —
 * History / AI / Mode / Settings — instead of the default Home / AI / Preview / Studio / More.
 * Source-level lock (the footer lives inline in App.tsx).
 */
const src = readFileSync(join(__dirname, '../src/App.tsx'), 'utf8');

describe('dynamic per-AI footer', () => {
  const branch = () => {
    const branchStart = src.indexOf(') : isModeSurface(activeView) ? (');
    expect(branchStart).toBeGreaterThan(-1);
    return src.slice(branchStart, branchStart + 3200);
  };

  it('renders the focused footer for EVERY chat surface — Free, the hub, Doctor and each professional', () => {
    // Was `nbi_chat || professionals` only; Mode going live (2026-08-25) widened it so an expert's own
    // chat can switch modes too — isModeSurface is the one shared rule (modePicker.ts, test-pinned).
    expect(src).toContain(') : isModeSurface(activeView) ? (');
  });

  it('the focused footer is exactly History / AI / Mode / Settings', () => {
    const b = branch();
    expect(b).toContain("label: 'History'");
    expect(b).toContain("label: 'AI'");
    expect(b).toContain("label: 'Mode'");
    expect(b).toContain("label: 'Settings'");
  });

  it('Mode is LIVE — it opens the picker, and no coming-soon remnant survives', () => {
    // The 2026-07-28 footer shipped Mode as a disabled "coming soon" tag; the admin asked for the real
    // thing on 2026-08-25. A leftover disabled state or toast would be a dead button wearing a label.
    const b = branch();
    expect(b).toContain("if (key === 'mode') { setShowModePicker(true); return; }");
    expect(src).not.toContain('Mode switching — coming soon');
    expect(b).not.toContain('comingSoon');
  });

  it('the AI item marks the surface you are on, and History/Settings navigate', () => {
    const b = branch();
    expect(b).toContain('id: activeView');
    expect(b).toContain("id: 'history' as ViewType");
    expect(b).toContain("id: 'settings' as ViewType");
    expect(b).toContain('toggleTab(id)');
  });

  it('History scoping: FREE opens the unified tagged list; the hub keeps its professional-only view', () => {
    const b = branch();
    // Amended 2026-08-25: the FREE surface's history is Free + Doctor + every professional, tagged —
    // so every chat surface EXCEPT the hub routes to the 'free' (unified) scope.
    expect(b).toContain("setHistoryInitialFilter(activeView === 'professionals' ? 'professional' : 'free')");
    // the scoped filter resets to 'all' when leaving History
    expect(src).toContain("if (activeView !== 'history') setHistoryInitialFilter('all')");
    // FREE stays LOCKED (no filter tabs) and carries the professionals merged in, with navigation out.
    expect(src).toContain("lockFilter={historyInitialFilter === 'free'}");
    expect(src).toContain("includeProfessionals={historyInitialFilter === 'free'}");
    expect(src).toContain('onOpenProfessional={(viewId) => toggleTab(viewId as ViewType)}');
    // Professionals hub keeps the dedicated professional-only history.
    expect(src).toContain("historyInitialFilter === 'professional'");
    expect(src).toContain('<ProfessionalHistoryView');
  });
});

