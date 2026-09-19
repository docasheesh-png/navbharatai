/**
 * THE SIDEBAR'S "CONNECT MY WEBSITE" IS GONE — one flow keeps its two real doors, and loses its third.
 *
 * Admin, 2026-09-19: *"navbharatai ke slidebar menu me sabse last me 'connect my website' naam ka
 * button hai. isko hata do! already kayi jagah ho chuka hai. setting me, deploy me hai. to alag se
 * button banane ki need nahi hai!"*
 *
 * ## The claim was checked before anything was deleted
 *
 * `ConnectMyWebsitePanel` is mounted from three places, and all three render the SAME component:
 *
 *   • `SettingsPanel.tsx`  — Settings → App Settings → Domain          ← kept
 *   • `ViewPanels.tsx`     — Publish & Deploy → Custom Domain          ← kept
 *   • `App.tsx`            — the `connect_domain` view, opened ONLY by the sidebar row   ← removed
 *
 * So this is not a feature being taken away; it is a duplicate entrance. The two that remain sit
 * where someone is already thinking about their app. The one removed sat in a general navigation
 * menu beside "About Us" and "Donate", where a domain is not on anyone's mind.
 *
 * ## Why the view goes too, not just the button
 *
 * `toggleTab('connect_domain')` appeared exactly once in the whole repo — in that sidebar row. Delete
 * the row and the `activeView === 'connect_domain'` branch in `App.tsx` becomes code nothing on earth
 * can reach, and the `'connect_domain'` member of `ViewType` a name nothing can hold. This repo has
 * already paid for leaving one of those behind: the sidebar's "App Builder v5.0" row (deleted
 * 2026-09-12) navigated to a view `App.tsx` had stopped rendering, so the most builder-looking entry
 * in the menu did nothing at all. Removing the entrance and leaving the room is how that is made.
 *
 * 🔒 **No persisted state can strand a user in the removed view.** `activeView` is restored only as
 * `admin`, `appstore`, `nbi_pro_chat` or `home`, and `openTabs` starts empty (or with the v5 tab) on
 * every load — checked, because a view id surviving in storage would render a blank screen.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

/** Comments are stripped: the prose above, and the deletion notes left in the source, must keep
 *  naming the removed button — that record is the point. Only live code is asserted on. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
}

describe('the third door is gone', () => {
  it('the sidebar has no "Connect my website" button', () => {
    const nav = code(read('src/components/panels/SidebarNav.tsx'));
    expect(nav).not.toMatch(/Connect my website/i);
    expect(nav).not.toMatch(/connect_domain/);
  });

  it('the view it opened is removed, so nothing unreachable is left behind', () => {
    // The lesson from the "App Builder v5.0" row: an entrance removed while its room stays is how a
    // dead button is made. Here the room goes with it.
    expect(code(read('src/App.tsx'))).not.toMatch(/connect_domain/);
    expect(read('src/types/index.ts')).not.toMatch(/'connect_domain'/);
  });

  it('nothing anywhere still navigates to it', () => {
    // The sweep, not the spot check: a second `toggleTab('connect_domain')` added later — or left
    // behind in a file this change did not open — would be a button to nowhere.
    for (const f of [
      'src/App.tsx',
      'src/components/panels/SidebarNav.tsx',
      'src/components/panels/ViewPanels.tsx',
      'src/components/panels/SettingsPanel.tsx',
    ]) {
      expect(code(read(f)), `${f} still routes to connect_domain`).not.toMatch(/connect_domain/);
    }
  });
});

describe('both real doors survive — this removes an entrance, never the flow', () => {
  it('Settings → App Settings → Domain still mounts the panel', () => {
    const settings = code(read('src/components/panels/SettingsPanel.tsx'));
    expect(settings).toMatch(/settingsScreen === 'domain'/);
    expect(settings).toMatch(/<ConnectMyWebsitePanel/);
  });

  it('Publish & Deploy → Custom Domain still mounts the panel', () => {
    const views = code(read('src/components/panels/ViewPanels.tsx'));
    expect(views).toMatch(/activeView === 'domain'/);
    expect(views).toMatch(/<ConnectMyWebsitePanel/);
  });

  it('the panel itself is untouched by this change', () => {
    // Its own heading is the cheapest proof that the flow still exists and was not gutted along with
    // the button that used to reach it.
    expect(read('src/components/panels/ConnectMyWebsitePanel.tsx')).toMatch(/Connect my website/);
  });
});

describe('nothing sends a user to the door that is gone', () => {
  it('the knowledge base no longer names the sidebar for this', () => {
    // Every AI in the app answers "domain kahan jodun?" from this file. Directions to a button that
    // no longer exists are worse than no directions: the user hunts, finds nothing, and concludes the
    // feature was taken away.
    const kb = read('src/server/AppContext/AppKnowledgeBase.ts');
    expect(kb).not.toMatch(/Sidebar → More menu → "Connect my website"/);
    expect(kb).not.toMatch(/Sidebar → More → Connect my website/);
    expect(kb).toMatch(/Settings → App Settings → Domain/);
  });

  it('no source comment still points at it either', () => {
    // `tsc` and vitest cannot read a comment, so a stale one survives every gate and misleads the next
    // reader — the exact failure CLAUDE.md records for the four comments that claimed GPT was on the
    // weak ladder. Three comments described this door; all three were corrected.
    for (const f of [
      'src/components/panels/ViewPanels.tsx',
      'src/components/panels/SettingsPanel.tsx',
      'src/components/panels/ConnectMyWebsitePanel.tsx',
    ]) {
      const src = read(f);
      expect(src, `${f} still documents the removed sidebar door`)
        .not.toMatch(/Sidebar → (More menu → )?"?Connect my website/);
      expect(src, `${f} still documents the removed sidebar door`)
        .not.toMatch(/Sidebar → More and Home/);
    }
  });
});
