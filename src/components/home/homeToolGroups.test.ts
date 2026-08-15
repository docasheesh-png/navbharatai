import { describe, it, expect } from 'vitest';
import { HOME_TOOL_GROUPS } from './homeToolGroups';

describe('HOME_TOOL_GROUPS — the builder tools moved from Settings to the Home "Other AI" card', () => {
  it('carries exactly FOUR groups, in order (regrouped by the admin 2026-08-14)', () => {
    expect(HOME_TOOL_GROUPS.map((g) => g.title)).toEqual([
      'AI Tools',
      'Developer Tools',
      'Publish & Deploy',
      'Monetization & Team',
    ]);
  });

  it('🔒 "Design & Build" is GONE, not empty — its five tools moved into Developer Tools', () => {
    // An empty heading would be a dead section on the home page, and the tools would be unreachable.
    expect(HOME_TOOL_GROUPS.map((g) => g.title)).not.toContain('Design & Build');
    const dev = HOME_TOOL_GROUPS.find((g) => g.title === 'Developer Tools')!.items.map((i) => i.id);
    for (const id of ['multipages', 'components', 'designsys', 'figma', 'darkmode']) {
      expect(dev, `${id} lost its home`).toContain(id);
    }
  });

  it('🔒 the regrouping MOVED tools — it never dropped one', () => {
    // The real risk in a reshuffle is a tool silently disappearing from every group. This pins the
    // exact set that must still be reachable, whatever the grouping becomes.
    const ids = HOME_TOOL_GROUPS.flatMap((g) => g.items.map((i) => i.id)).sort();
    expect(ids).toEqual([
      'analytics', 'api', 'apk', 'appstore', 'botbuilder', 'cicd', 'codereview', 'collab',
      'components', 'darkmode', 'debugger', 'designsys', 'domain', 'figma', 'gallery', 'imagegen',
      'insights', 'minifier', 'monetize', 'multipages', 'performance', 'seo', 'team', 'testing',
      'versioning', 'whitelabel',
    ]);
  });

  it('the four tools the admin moved INTO AI Tools are there', () => {
    const ai = HOME_TOOL_GROUPS.find((g) => g.title === 'AI Tools')!.items.map((i) => i.id);
    for (const id of ['api', 'versioning', 'minifier', 'apk']) expect(ai, id).toContain(id);
    // …and are no longer duplicated in the group they came from.
    const others = HOME_TOOL_GROUPS.filter((g) => g.title !== 'AI Tools').flatMap((g) => g.items.map((i) => i.id));
    for (const id of ['api', 'versioning', 'minifier', 'apk']) expect(others, id).not.toContain(id);
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
