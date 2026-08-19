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
      'aitesting', 'analytics', 'api', 'apimarket', 'apk', 'botbuilder', 'cicd', 'codereview', 'collab',
      'components', 'darkmode', 'dbstudio', 'debugger', 'designsys', 'domain', 'figma', 'gallery', 'imagegen',
      'insights', 'localization', 'minifier', 'monetize', 'multipages', 'performance', 'plugins', 'seo', 'sharereview', 'team', 'testing',
      'versioning', 'whitelabel',
    ]);
  });

  it('🔒 App Mart left this grid by PROMOTION, and still has exactly one doorway', async () => {
    /**
     * 'appstore' was removed from the list above on 2026-08-16 — the one deliberate departure since
     * these groups were written. It is not a dropped tool: it became **App Mart**, a tile of its own
     * on the home screen (admin: "usko Other ke andar nahi, bahar homepage par hi ek 5th new tile").
     *
     * Keeping a shortcut here as well would have been the tempting move and the wrong one: this
     * codebase has twice learned that a second doorway to one room makes users believe there are two
     * rooms (the removed 'database' tile, the removed duplicate Terminal). So the test pins BOTH
     * halves — gone from the grid, present on the home screen — because either half alone is a bug:
     * still in the grid means two doors, and missing from HomeView means no door at all.
     */
    const ids = HOME_TOOL_GROUPS.flatMap((g) => g.items.map((i) => i.id));
    expect(ids, 'App Mart must not be a tool tile as well as a home tile').not.toContain('appstore');

    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const home = readFileSync(join(process.cwd(), 'src/components/home/HomeView.tsx'), 'utf8');
    expect(home, 'App Mart lost its home tile').toContain("id: 'appmart'");
    expect(home).toContain('onOpenAppMart');
    const app = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');
    expect(app, 'the home tile must actually open the store view').toContain("onOpenAppMart={() => toggleTab('appstore')}");
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
