import { describe, it, expect } from 'vitest';
import { HOME_TOOL_GROUPS } from './homeToolGroups';

describe('HOME_TOOL_GROUPS — the builder tools moved from Settings to the Home "Other AI" card', () => {
  it('carries exactly the five groups the admin moved, in order', () => {
    expect(HOME_TOOL_GROUPS.map((g) => g.title)).toEqual([
      'AI Tools',
      'Developer Tools',
      'Design & Build',
      'Publish & Deploy',
      'Monetization & Team',
    ]);
  });

  it('every tool has a stable, unique tab id (the destination is unchanged from Settings)', () => {
    const ids = HOME_TOOL_GROUPS.flatMap((g) => g.items.map((i) => i.id));
    expect(new Set(ids).size).toBe(ids.length);
    // A few of the exact ids the old Settings tiles used — must not drift.
    expect(ids).toEqual(expect.arrayContaining(['botbuilder', 'imagegen', 'debugger', 'testing', 'figma', 'apk', 'monetize', 'analytics']));
  });

  it('offers no second Database doorway — that screen belongs to Settings alone', () => {
    // The removed tile opened a page whose only content was a link into Settings → Database, which
    // read as a different database to configure. Two doorways to one screen is the bug.
    const ids = HOME_TOOL_GROUPS.flatMap((g) => g.items.map((i) => i.id));
    expect(ids).not.toContain('database');
  });

  it('every tool has a non-empty label and an icon component', () => {
    for (const g of HOME_TOOL_GROUPS) {
      expect(g.items.length).toBeGreaterThan(0);
      for (const item of g.items) {
        expect(item.label.trim().length).toBeGreaterThan(0);
        expect(item.icon).toBeTruthy();
      }
    }
  });
});
