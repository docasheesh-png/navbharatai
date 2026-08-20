/**
 * No render branch for a view nothing can reach.
 *
 * WHERE THIS CAME FROM. Removing the duplicate Settings→Terminal (2026-08-11) prompted a sweep for the
 * same class, and it found a leftover: `activeView === 'cloudeploy'` still rendered MultiCloudDeploy in
 * ViewPanels, but its Home tile had been removed on 2026-07-29 when the feature moved into Settings.
 * Nothing set that view any more, so the branch could never run — while still pulling MultiCloudDeploy
 * into the panel chunk.
 *
 * ⚠️ IT IS NOT ENOUGH TO CHECK THE TILE LISTS, and that is the part worth remembering: `activeView` is
 * also set dynamically from restored OAuth state (`setActiveView(savedState.activeView)`). That path
 * only replays a view the user was ALREADY on, within 30 minutes, so with no doorway left it cannot
 * resurrect one — but a future dynamic setter could, and then "dead" would be wrong. This test asserts
 * the narrow fact (the branch and its ViewType member are gone), not the general claim.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
/** Comments legitimately DISCUSS removed things; matching prose is how a test fails on its own note. */
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const viewPanels = codeOnly(read('src/components/panels/ViewPanels.tsx'));
const types = codeOnly(read('src/types/index.ts'));
const homeTools = codeOnly(read('src/components/home/homeToolGroups.ts'));

describe('🔒 unreachable view branches stay removed', () => {
  it('ViewPanels has no cloudeploy branch — the feature lives in Settings now', () => {
    expect(viewPanels).not.toContain("activeView === 'cloudeploy'");
    // And it no longer lazy-loads the deploy panel it cannot render.
    expect(viewPanels).not.toContain('MultiCloudDeploy');
  });

  it('ViewType no longer carries cloudeploy, so the branch cannot be re-added by accident', () => {
    const viewType = types.slice(types.indexOf('ViewType'), types.indexOf('SettingsScreen'));
    expect(viewType).not.toContain("'cloudeploy'");
  });

  it('🔒 SettingsScreen no longer carries cloudeploy either — the screen itself was removed', () => {
    // This case used to assert the OPPOSITE, and it was right to: 'cloudeploy' lived in TWO unions
    // (the same trap as 'shell'), and deleting the wrong one would have blanked a live screen. On
    // 2026-08-20 the screen was removed outright — it duplicated the v5.0 Publish sheet and could
    // not see a v5.0 app at all — so BOTH unions must now be clean. The guard's purpose is unchanged:
    // the union and the screen must agree, because a member nothing can navigate to is how the
    // 'modules' dead branch survived unnoticed for months.
    const settingsScreen = types.slice(types.indexOf('SettingsScreen'));
    expect(settingsScreen).not.toContain("'cloudeploy'");
    const panel = codeOnly(read('src/components/panels/SettingsPanel.tsx'));
    expect(panel).not.toContain("settingsScreen === 'cloudeploy'");
    expect(panel).not.toContain('MultiCloudDeploy');
  });

  it('Home has no cloudeploy tile either — that is why the branch was unreachable', () => {
    expect(homeTools).not.toContain("id: 'cloudeploy'");
  });
});

describe('every Home tool tile still has somewhere to go', () => {
  it('🔒 no tile points at a view nothing renders', () => {
    // The mirror of the test above: a tile with no branch is a button that does nothing, which is the
    // same defect seen from the other side.
    const app = codeOnly(read('src/App.tsx'));
    const ids = [...homeTools.matchAll(/\{ id: '([a-z_]+)', label:/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(20);
    const orphans = ids.filter((id) => !viewPanels.includes(`activeView === '${id}'`) && !app.includes(`activeView === '${id}'`));
    expect(orphans, `Home tiles with no render branch: ${orphans.join(', ')}`).toEqual([]);
  });
});
