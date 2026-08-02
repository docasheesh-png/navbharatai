import { describe, it, expect } from 'vitest';
import { STARTER_TEMPLATES, startersByCategory, partitionStarters } from './starterTemplates';

describe('STARTER_TEMPLATES', () => {
  it('has a healthy library of starters with unique ids', () => {
    expect(STARTER_TEMPLATES.length).toBeGreaterThanOrEqual(12);
    const ids = STARTER_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length); // no dupes
  });

  it('every starter has a label, an icon, a category, and a RICH prompt', () => {
    for (const t of STARTER_TEMPLATES) {
      expect(t.label, t.id).toBeTruthy();
      expect(t.icon, t.id).toBeTruthy();
      expect(t.category, t.id).toBeTruthy();
      // a real, detailed prompt (not a one-word stub) so it showcases the engine + feeds requirement-awareness
      expect(t.prompt.length, t.id).toBeGreaterThan(80);
    }
  });
});

describe('startersByCategory', () => {
  it('groups by category in a stable order and covers every template', () => {
    const groups = startersByCategory();
    const total = groups.reduce((n, g) => n + g.items.length, 0);
    expect(total).toBe(STARTER_TEMPLATES.length);
    // categories appear in the intended order
    expect(groups.map((g) => g.category)).toEqual(['Business', 'Commerce', 'Social', 'Productivity', 'Personal']);
  });

  it('respects a filtered input list', () => {
    const groups = startersByCategory(STARTER_TEMPLATES.filter((t) => t.category === 'Personal'));
    expect(groups).toHaveLength(1);
    expect(groups[0].category).toBe('Personal');
  });
});

describe('partitionStarters — tier-aware suggestions (free first-build must work)', () => {
  it('every template declares a tier; showcase only ever marks pro templates', () => {
    for (const t of STARTER_TEMPLATES) {
      expect(['simple', 'pro'], t.id).toContain(t.tier);
      if (t.showcase) expect(t.tier, t.id).toBe('pro');
    }
  });

  it('has a real library of BOTH simple and pro apps, and at least a few pro showcases', () => {
    const simple = STARTER_TEMPLATES.filter((t) => t.tier === 'simple');
    const pro = STARTER_TEMPLATES.filter((t) => t.tier === 'pro');
    expect(simple.length).toBeGreaterThanOrEqual(8);
    expect(pro.length).toBeGreaterThanOrEqual(8);
    expect(pro.filter((t) => t.showcase).length).toBeGreaterThanOrEqual(4);
  });

  it('a FREE user is only offered SIMPLE apps (their first build works), pro ones are locked showcases', () => {
    const { tappable, locked } = partitionStarters(false);
    expect(tappable.length).toBeGreaterThan(0);
    expect(tappable.every((t) => t.tier === 'simple')).toBe(true); // never a pro app a free tier would flail on
    expect(locked.length).toBeGreaterThan(0);
    expect(locked.every((t) => t.tier === 'pro' && t.showcase === true)).toBe(true);
  });

  it('an UNLOCKED (paid) user sees the WHOLE library tappable and nothing locked', () => {
    const { tappable, locked } = partitionStarters(true);
    expect(tappable).toHaveLength(STARTER_TEMPLATES.length);
    expect(locked).toHaveLength(0);
  });
});
