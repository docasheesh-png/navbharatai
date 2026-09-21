import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { COMING_SOON_TOOL_IDS, isComingSoonTool, COMING_SOON_LABEL } from './comingSoonTools';
import { HOME_TOOL_GROUPS } from '../components/home/homeToolGroups';

/**
 * The admin's 2026-09-15 hold-back list, encoded so it cannot drift.
 *
 * *"yeh sabhi abhi maine test nahi kiya hai, jab mai test karunga tab ek ek kar ke on karwa dunga apse.
 * fihal abhi band kar do — 'coming soon' likh kar."*
 *
 * These tests exist to catch the two ways this kind of list goes quietly wrong: an id that matches no
 * real tool (so a tool the admin thinks is off is still live), and a tool switched on or off by
 * accident in a later edit.
 */

const read = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');
const allTools = HOME_TOOL_GROUPS.flatMap((g) => g.items);
const idsIn = (title: string) => HOME_TOOL_GROUPS.find((g) => g.title === title)!.items.map((i) => i.id);

describe('the held-back tool list matches what the admin actually named', () => {
  it('🔒 every held-back id is a REAL tool — an unmatched id would silently leave a tool live', () => {
    const real = new Set(allTools.map((t) => t.id));
    for (const id of COMING_SOON_TOOL_IDS) {
      expect(real.has(id), `'${id}' is in the coming-soon set but matches no tool in HOME_TOOL_GROUPS`).toBe(true);
    }
  });

  it('AI Tools: only AI Debugger and Code Review are off — the other six stay ON', () => {
    const off = idsIn('AI Tools').filter(isComingSoonTool);
    expect(new Set(off)).toEqual(new Set(['debugger', 'codereview']));
    for (const id of ['botbuilder', 'imagegen', 'api', 'versioning', 'minifier', 'apk']) {
      expect(isComingSoonTool(id), `${id} must stay usable`).toBe(false);
    }
  });

  it('Developer Tools: the WHOLE group is off ("developer tool sabhi") — except the NavBharatAI API', () => {
    // ⚠️ ONE EXEMPTION, ordered by the admin two days after the hold-back (2026-09-17): "developer
    // tools ke andar yeh pura system bana kar dalo … system working hona chahiye". The API tile was
    // built to that order and is live; every OTHER tool in the group stays held back until tested.
    const dev = idsIn('Developer Tools');
    expect(dev).toContain('devapi');
    expect(isComingSoonTool('devapi'), 'the NavBharatAI API is the one live tile in this group').toBe(false);
    const rest = dev.filter((id) => id !== 'devapi');
    expect(rest.length).toBeGreaterThan(0);
    for (const id of rest) expect(isComingSoonTool(id), `${id} should be held back`).toBe(true);
  });

  it('Publish & Deploy: everything off EXCEPT Custom Domain ("custom domain ko chor ke sabhi")', () => {
    const pub = idsIn('Publish & Deploy');
    expect(pub).toContain('domain');
    expect(isComingSoonTool('domain'), 'Custom Domain is the one the admin kept').toBe(false);
    for (const id of pub.filter((i) => i !== 'domain')) {
      expect(isComingSoonTool(id), `${id} should be held back`).toBe(true);
    }
  });

  it('Monetization & Team: the WHOLE group is off ("sabhi")', () => {
    const mon = idsIn('Monetization & Team');
    expect(mon.length).toBeGreaterThan(0);
    for (const id of mon) expect(isComingSoonTool(id), `${id} should be held back`).toBe(true);
  });

  it('exactly eight tools remain usable — the seven the admin signed off on, plus the API they ordered', () => {
    const live = allTools.filter((t) => !isComingSoonTool(t.id)).map((t) => t.id);
    expect(new Set(live)).toEqual(
      new Set(['botbuilder', 'imagegen', 'api', 'versioning', 'minifier', 'apk', 'domain', 'devapi']),
    );
  });
});

describe('a held-back tool is really OFF, not just greyed out', () => {
  it('the Other page disables the tile and labels it, instead of a click that does nothing', () => {
    const view = read('src/components/home/OtherAIView.tsx');
    expect(view).toContain('isComingSoonTool(item.id)');
    expect(view).toContain('disabled={soon}');
    // A handler-less enabled button is exactly the dead control this repo sweeps for.
    expect(view).toContain('onClick={soon ? undefined : () => onOpenTool(item.id)}');
    expect(view).toContain('{COMING_SOON_LABEL}');
  });

  it('toggleTab refuses the id too, so no other doorway can open an untested tool', () => {
    // Same choke point the Play medical gate uses, and for the same reason: every tab-open goes
    // through it, so a future button that forgets to ask still cannot reach the tool.
    const app = read('src/App.tsx');
    // `toggleTab` reports whether it navigated since 2026-09-21 (the window cap needs the answer), so the
    // refusal is `return false` — the same gate, one line above the window logic, still before any open.
    expect(app).toContain('if (isComingSoonTool(view)) return false;');
    expect(app).toContain("import { isComingSoonTool } from './lib/comingSoonTools'");
  });

  it('the label is one shared constant, so the tile and this test cannot disagree', () => {
    expect(COMING_SOON_LABEL).toBe('Coming soon');
  });
});
