import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { footerTapPlan } from '../src/lib/footerSheets';

/**
 * One footer sheet at a time (admin 2026-09-23): *"Mode press karne ke baad History, AI, Settings kisi
 * par click karo, Mode hat ta hi nahi hai … old wala hide ho jaye, new click wala show ho!!"*
 *
 * The bottom bar paints over the sheets it opens, so every tap on it must first close what another
 * item left open. These tests lock the rule and its wiring, since the bug was a missing CALL rather
 * than wrong arithmetic.
 */

const none = { mode: false, history: false };

describe('the rule: a footer tap closes what another item opened', () => {
  it('with the Mode sheet open, History / AI / Settings close it and then go on', () => {
    for (const key of ['history', 'ai', 'settings'] as const) {
      expect(footerTapPlan(key, { mode: true, history: false })).toEqual({ close: ['mode'], proceed: true });
    }
  });

  it('with the History list open, Mode / AI / Settings close it and then go on', () => {
    for (const key of ['mode', 'ai', 'settings'] as const) {
      expect(footerTapPlan(key, { mode: false, history: true })).toEqual({ close: ['history'], proceed: true });
    }
  });

  it('a second tap on the open item closes it and does nothing else', () => {
    expect(footerTapPlan('mode', { mode: true, history: false })).toEqual({ close: ['mode'], proceed: false });
    expect(footerTapPlan('history', { mode: false, history: true })).toEqual({ close: ['history'], proceed: false });
  });

  it('with nothing open, a tap closes nothing and does its own thing', () => {
    for (const key of ['history', 'ai', 'mode', 'settings'] as const) {
      expect(footerTapPlan(key, none)).toEqual({ close: [], proceed: true });
    }
  });
});

describe('the footing: a footer sheet sits UNDER the bar, so the bar stays tappable', () => {
  // The root of the report: the Mode sheet was z-200 over the bar's z-150, so a tap on another footer
  // item hit the sheet instead. HistoryPopup was always z-130 with the shared flush overlay; the Mode
  // sheet now stands on the same footing.
  const z = (src: string, re: RegExp) => Number(re.exec(src)?.[1] ?? NaN);
  const app = readFileSync(join(__dirname, '..', 'src/App.tsx'), 'utf8');
  const bar = z(app, /<nav className=\{`fixed bottom-0 left-0 right-0 z-\[(\d+)\]/);

  for (const [file, label] of [
    ['src/components/chat/ModePickerSheet.tsx', 'Mode sheet'],
    ['src/components/history/HistoryPopup.tsx', 'History popup'],
  ] as const) {
    it(`the ${label} is below the bar and reserves room for it`, () => {
      const src = readFileSync(join(__dirname, '..', file), 'utf8');
      const sheet = z(src, /nb-sheet-overlay-flush fixed inset-0 z-\[(\d+)\]/);
      expect(bar).toBe(150);
      expect(sheet).toBeLessThan(bar);
    });
  }
});

describe('the wiring: the footers really ask the rule', () => {
  const app = readFileSync(join(__dirname, '..', 'src/App.tsx'), 'utf8');

  it('the Free / Professionals footer runs footerTapPlan before any item acts', () => {
    const start = app.indexOf("{ key: 'mode',     id: null");
    expect(start).toBeGreaterThan(0);
    const handler = app.slice(start, start + 2500);
    const plan = handler.indexOf('footerTapPlan(');
    const opensMode = handler.indexOf('setShowModePicker(true)');
    expect(plan).toBeGreaterThan(0);
    expect(opensMode).toBeGreaterThan(plan);
    expect(handler).toContain('setShowModePicker(false)');
    expect(handler).toContain('setHistoryPopupOpen(false)');
  });

  it("Pro v5.0's Code Studio item closes the panel's own sheet before leaving it", () => {
    expect(app).toContain("onTap: () => { v3FooterApi.closeSheet(); toggleTab('studio'); }");
    const panel = readFileSync(join(__dirname, '..', 'src/components/agentv3/AgentV3Panel.tsx'), 'utf8');
    expect(panel).toContain('closeSheet: () => setMobileSheet(null)');
  });
});
