/**
 * "PUBLISH ON APP MART" IS BACK IN THE PUBLISH SHEET (admin 2026-09-18: "publish on app mart button
 * wapas lao", after their capture of the sheet showed no way to reach App Mart from it).
 *
 * 🔴 WHAT IT IS NOT, AND WHY THAT MATTERS. An embedded App Mart publish CARD used to live in this
 * sheet and was removed on the admin's own instruction (#2986, 2026-09-17): hosting and App Mart are
 * two separate decisions made on their own screens. Restoring that card would ALSO restore a second
 * caller of `/api/navstore/publish` — and `NavAppStore.tsx` records that it is "now the ONLY caller
 * of the endpoint that bug was fixed for" (the 2026-08-27 infinity-loading report).
 *
 * So the button NAVIGATES. One publish implementation, reachable from where the admin looks for it,
 * carrying both the tab and the app so nobody lands on Browse hunting for what they just asked for.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (f: string) => readFileSync(resolve(__dirname, f), 'utf8');
const strip = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');

const sheet = strip(read('../src/components/agentv3/HostingChooser.tsx'));
const app = strip(read('../src/App.tsx'));
const panels = strip(read('../src/components/panels/ViewPanels.tsx'));
const store = strip(read('../src/components/ide/NavAppStore.tsx'));

describe('the button exists and goes somewhere real', () => {
  it('the publish sheet has a Publish on App Mart button', () => {
    expect(sheet).toContain('Publish on App Mart');
  });

  it('it navigates, carrying the tab AND this app', () => {
    // Landing on Browse would be the dead end `settingsScreen` exists to prevent, one screen over.
    expect(sheet).toContain("detail: { view: 'appstore', storeTab: 'publish', storeWorkspaceId: workspaceId }");
  });

  it('it closes the sheet it navigated away from', () => {
    // A modal left open over the screen it just sent you to is its own bug.
    const idx = sheet.indexOf('Publish on App Mart');
    expect(sheet.slice(Math.max(0, idx - 900), idx)).toContain('onClose();');
  });

  it('🔒 it does NOT publish from here — no second caller of the endpoint', () => {
    // The guard on #2986's decision. If this ever fails, someone has re-embedded the publish form.
    expect(sheet).not.toContain('/api/navstore/publish');
    expect(sheet).not.toContain('navstore/publish');
  });
});

describe('WIRING — the intent survives the whole way to the store', () => {
  it('App carries the store target off the navigate event', () => {
    expect(app).toContain("storeTab?: 'browse' | 'publish' | 'mine' | 'review'");
    expect(app).toContain('setStoreTarget({ tab: detail.storeTab, workspaceId: detail.storeWorkspaceId ?? null })');
  });

  it('App hands it to ViewPanels', () => {
    expect(app).toContain('storeInitialTab={storeTarget?.tab}');
    expect(app).toContain('storePublishWorkspaceId={storeTarget?.workspaceId ?? null}');
  });

  it('ViewPanels hands it to the store — the link `_lz` erases the types on', () => {
    // `_lz` returns ComponentType<any>, so tsc CANNOT catch this dropping. Only this assertion can.
    expect(panels).toContain('<NavAppStore initialTab={storeInitialTab} initialPublishWorkspaceId={storePublishWorkspaceId} />');
  });

  it('the store opens on that tab and pre-selects that app', () => {
    expect(store).toContain("useState<Tab>(initialTab ?? 'browse')");
    expect(store).toContain('choosePublishApp(initialPublishWorkspaceId)');
  });
});

describe('the defaults are untouched — every other way in behaves exactly as before', () => {
  it('no target ⇒ the store still opens on Browse', () => {
    expect(store).toContain("initialTab ?? 'browse'");
  });

  it('the pre-select fires ONCE, and only for an app the picker really lists', () => {
    // Re-applying it would undo a user who then picked a different app; selecting an id the list
    // does not contain would leave the name blank and look like the form failed.
    expect(store).toContain('preselectedRef.current = true;');
    expect(store).toContain('myApps.some((a) => a.workspaceId === initialPublishWorkspaceId)');
  });

  it('it waits for the picker list rather than racing it', () => {
    expect(store).toContain('myApps === null) return;');
  });
});
