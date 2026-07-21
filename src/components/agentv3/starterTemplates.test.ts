import { describe, it, expect } from 'vitest';
import { STARTER_TEMPLATES, startersByCategory } from './starterTemplates';

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
