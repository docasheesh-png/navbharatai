import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * THE WIRING — that both screens really show the list, open it the way the admin asked, and that
 * neither had to invent a server route to do it.
 *
 * The normalisation is pinned in `publishedAppsView.test.ts`. This file pins what a pure module
 * cannot: that it is CALLED, from both screens, and that the Open control is the one that reaches a
 * real browser on the Android shell.
 */

const profile = readFileSync('src/components/profile/ProfilePage.tsx', 'utf8');
const adminUi = readFileSync('src/components/AdminDashboard.tsx', 'utf8');
const card = readFileSync('src/components/profile/PublishedAppsCard.tsx', 'utf8');
const adminRoute = readFileSync('src/server/routes/reports.ts', 'utf8');
const chooser = readFileSync('src/components/agentv3/HostingChooser.tsx', 'utf8');

/** Comments stripped — several of them quote the very code being asserted about. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the owner sees their own apps on My Profile', () => {
  it('the card is rendered there', () => {
    expect(code(profile)).toContain('<PublishedAppsCard');
    expect(code(profile)).toContain('Your Published Apps');
  });

  it('🔎 it reuses the EXISTING endpoint rather than a new one', () => {
    // `/api/agentv3/my-published-apps` has answered exactly this question for the signed-in caller
    // since before this feature; it is what the Publish sheet's own list reads.
    expect(code(profile)).toContain("fetch('/api/agentv3/my-published-apps'");
  });

  it('🔒 "not read yet" and "you have none" are different states', () => {
    // Telling somebody they have published nothing, when we simply could not read their apps, is a
    // false statement about their own work.
    expect(code(profile)).toContain('useState<PublishedAppRow[] | null>(null)');
    expect(code(profile)).toContain('loading={publishedApps === null && !publishedError}');
    expect(code(profile)).toMatch(/setPublishedError\('Your published apps could not be loaded/);
  });

  it('a failure there never stops the profile rendering', () => {
    const at = code(profile).indexOf("fetch('/api/agentv3/my-published-apps'");
    expect(at).toBeGreaterThan(0);
    expect(code(profile).slice(at - 200, at + 800)).toMatch(/catch \{/);
  });
});

describe('the admin sees the same list on a user’s account sheet', () => {
  it('the same component, not a second one', () => {
    expect(code(adminUi)).toContain('<PublishedAppsCard');
    expect(code(adminUi)).toContain('publishedAppRows(account.publishedApps.rows)');
    expect(code(adminUi)).toContain('showStatus');
  });

  it('🔎 the rows were ALREADY in the response — the screen was discarding them', () => {
    expect(code(adminRoute)).toContain('publishedApps: {');
    const at = code(adminRoute).indexOf('publishedApps: {');
    const block = code(adminRoute).slice(at, at + 900);
    expect(block).toContain('url: d.url');
    expect(block).toContain('sizeMb: d.sizeMb');
    expect(block).toContain('orphaned: d.orphaned === true');
  });

  it('🔴 the live count is computed over EVERY record, not the truncated list', () => {
    // `rows` is capped at 20, so counting what is on screen would under-report a heavy account.
    const at = code(adminRoute).indexOf('publishedApps: {');
    const block = code(adminRoute).slice(at, at + 900);
    expect(block).toContain('liveCount:');
    expect(block).toContain('isLiveDeployment');
    expect(block.indexOf('liveCount:')).toBeLessThan(block.indexOf('rows:'));
    expect(code(adminUi)).toContain('liveCount: account.publishedApps.liveCount');
  });

  it('…and a capped list says so, so it is never read as the whole account', () => {
    expect(code(adminUi)).toContain('totalCount: account.publishedApps.count');
    expect(code(card)).toContain('const truncated = typeof totalCount === \'number\' && totalCount > rows.length;');
  });

  it('🔴 the copied summary uses the SAME number as the badges beside it', () => {
    // It used to copy `publishedApps.count` — every record — under the word "live".
    expect(code(adminUi)).toContain("rows.push(['Published apps (live)'");
    expect(code(adminUi)).not.toMatch(/rows\.push\(\['Published apps',/);
  });
});

describe('🔒 how an app is opened', () => {
  it('through openExternalUrl, never a bare target="_blank"', () => {
    // On the Android shell a bare `_blank` opens inside the app's own WebView — and the request was
    // explicitly "chrome ke new page me". The helper passes `_system` on native, validates the
    // scheme again, and adds noopener,noreferrer on the web.
    expect(code(card)).toContain('openExternalUrl(app.url)');
    expect(code(card)).not.toContain('target="_blank"');
  });

  it('the button is only offered when the row can really be opened', () => {
    expect(code(card)).toContain('{app.openable ? (');
  });

  it('a screen reader is told WHICH app the button opens', () => {
    expect(code(card)).toContain('aria-label={`Open ${app.label} in a new tab`}');
  });

  it('the sibling that opens the same thing from the Publish sheet was fixed too', () => {
    const at = code(chooser).indexOf('onClick={() => openExternalUrl(a.url)}');
    expect(at).toBeGreaterThan(0);
  });
});
