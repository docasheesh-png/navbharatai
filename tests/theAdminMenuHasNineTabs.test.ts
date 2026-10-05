// THE ADMIN MENU HAS NINE TABS, AND EVERY PAGE IN IT IS REAL (admin panel audit PR 2, 2026-10-04).
//
// The admin accepted the audit's nine-tab menu as proposed. What this suite holds, none of which
// `tsc` can see:
//   1. Every page in the menu has a block that renders it, and every rendered block is a page in the
//      menu — a menu entry that opens nothing, or a screen no menu entry reaches, are the two ways a
//      reorganisation silently loses a feature.
//   2. NULL IS NOT ZERO one level up: a tab grouping two inboxes shows a sum only when both were
//      measured.
//   3. The two inboxes the admin ruled must stay separate (complaints vs the user list, phone builds
//      vs build reports) are separate PAGES with their own badges, never one merged list.
//   4. Each moved card is fetched on the page it moved to — a card on a page that never loads its data
//      is a card that shows nothing.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ADMIN_TABS, ADMIN_PAGE_IDS, tabOfPage, firstPageOf, pageTitle, resolvePage, tabBarBadges, sumBadges, pageBadge,
} from '../src/lib/adminTabs';
import { badgesFromPayload, formatBadge, badgeNeedsAttention } from '../src/lib/adminTabBadges';

const DASH = readFileSync(resolve(__dirname, '..', 'src/components/AdminDashboard.tsx'), 'utf8');

describe('the nine tabs, in the order the admin accepted', () => {
  it('are exactly these', () => {
    expect(ADMIN_TABS.map((t) => t.label)).toEqual([
      'Home', 'Users', 'Apps', 'Builds', 'AI Engines', 'Money', 'Safety', 'Messages', 'Settings',
    ]);
  });

  it('every page belongs to exactly one tab, and page ids are unique', () => {
    expect(new Set(ADMIN_PAGE_IDS).size).toBe(ADMIN_PAGE_IDS.length);
    for (const page of ADMIN_PAGE_IDS) {
      const owners = ADMIN_TABS.filter((t) => t.pages.some((p) => p.id === page));
      expect(owners, page).toHaveLength(1);
      expect(tabOfPage(page)).toBe(owners[0].id);
    }
  });

  it('opening a tab opens its first page', () => {
    expect(firstPageOf('home')).toBe('monitor');
    expect(firstPageOf('builds')).toBe('reports');
    expect(firstPageOf('apps')).toBe('apps');
  });

  it('the page name says where the admin is', () => {
    expect(pageTitle('apkreports')).toBe('Builds · Phone builds');
    expect(pageTitle('revenue')).toBe('Money');
  });

  it('an old tab id still lands on the page that holds its content', () => {
    expect(resolvePage('diagnostics')).toBe('health');
    expect(resolvePage('overview')).toBe('monitor');
    expect(resolvePage('reports')).toBe('reports');
    expect(resolvePage('nonsense')).toBe('monitor');
  });
});

describe('🔒 every page renders, and every rendered block is a page', () => {
  const blocks = [...DASH.matchAll(/\{activeTab === '(\w+)' && \(/g)].map((m) => m[1]);

  it.each([...ADMIN_PAGE_IDS])('page %s has its own block', (page) => {
    expect(blocks).toContain(page);
  });

  it('no block is unreachable from the menu', () => {
    for (const b of blocks) expect(ADMIN_PAGE_IDS as readonly string[], b).toContain(b);
  });

  it('the old Diagnostics tab is gone', () => {
    expect(blocks).not.toContain('diagnostics');
  });

  it('nothing renders twice: each feature marker sits in exactly ONE page', () => {
    // The census below names every feature the PR 2 move touched, plus the ones that stayed. A marker
    // in no page is a feature that disappeared; a marker in two pages is a duplicate implementation.
    for (const [marker, page] of Object.entries(FEATURE_HOME)) {
      const where = blocks.filter((b) => blockOf(b).includes(marker));
      expect(where, `${marker}`).toEqual(Array.isArray(page) ? page : [page]);
    }
  });
});

/** The open block of a page, up to its closing line. */
function blockOf(page: string): string {
  const open = DASH.indexOf(`{activeTab === '${page}' && (`);
  if (open === -1) return '';
  return DASH.slice(open, DASH.indexOf('\n          )}', open));
}

/**
 * THE FEATURE CENSUS (PR 2's regression lock). Every admin feature the migration considered, keyed by a
 * marker unique to it, and the ONE page that owns it. Moving a feature again means changing this table
 * on purpose; losing one fails CI.
 */
const FEATURE_HOME: Record<string, string | string[]> = {
  // Home — overview only
  '<LoadBoard adminToken': 'monitor',
  '<MonitorPanels adminToken': 'monitor',
  '<AudienceCard': 'monitor',
  // A SUMMARY figure on Home with its detail on Money — the one documented exception to "one home".
  "statCard('Total Revenue'": ['monitor', 'revenue'],
  "'Published Apps',": 'monitor',
  "statCard('Today Hits'": 'monitor',
  '>AI Insights</h3>': 'monitor',
  // Users
  'value={userSearch}': 'users',
  'handleTokenAdjust(u.userId': 'users',
  'handleBan(u.userId': 'users',
  'handleMerge(u.userId)': 'users',
  'handleBulkWelcomeGift': 'users',
  'markUserReport(openReport.report.id': 'userreports',
  'handleBan(openReport.report.target.ownerUid': 'userreports',
  // Apps
  '<BuiltAppsPanel': 'apps',
  '>Publish Capacity</h3>': 'publishing',
  'only={ENGINE_REPORTS_ON.publishing}': 'publishing',
  "storeTab: 'review'": 'review',
  '<BotsLedgerPanel': 'bots',
  // Builds
  'onClick={clearAllReports}': 'reports',
  '<FailureCategoryCard': 'reports',
  'All builds — every user, no submit needed': 'reports',
  '{openApkReport && (': 'apkreports',
  '<MobileBuildOutcomeCard': 'apkreports',
  'onClick={fetchNecessity}': 'health',
  'onClick={fetchHandover}': 'health',
  'onClick={fetchAppleDiag}': 'health',
  'only={ENGINE_REPORTS_ON.health}': 'health',
  // AI Engines
  '>Build Engines</h3>': 'engines',
  '>Chat Router — Live</h3>': 'engines',
  '>Latency Anomaly Watch</h3>': 'engines',
  '>API Usage Ranking</h3>': 'engines',
  '>Rate Limited Providers</h3>': 'engines',
  'only={ENGINE_REPORTS_ON.engines}': 'engines',
  // Money
  '>Purchases — who paid, for what</h3>': 'revenue',
  '>Top Consuming Users</h3>': 'revenue',
  '>FinOps Recommendations</h3>': 'revenue',
  '<BuildCostCard': 'revenue',
  '<BuildDiscountCard': 'revenue',
  '<ReferralCostCard': 'revenue',
  '>Provider Token Burn</h3>': 'revenue',
  '>Recent Token Purchases</h3>': 'revenue',
  'onClick={handlePromoCreate}': 'revenue',
  'only={ENGINE_REPORTS_ON.revenue}': 'revenue',
  // Safety
  '>Two-Factor Authentication</h3>': 'security',
  '>Recent Failed Login Attempts</h3>': 'security',
  "statCard('Failed Logins'": 'security',
  'only={ENGINE_REPORTS_ON.security}': 'security',
  // Messages
  'onClick={handleAnnouncement}': 'messages',
  '{/* App update broadcast': 'messages',
  '<OtpHealthCard': 'messages',
  '<PushHealthCard': 'messages',
  'only={ENGINE_REPORTS_ON.messages}': 'messages',
};

describe('each moved card is fetched where it is shown', () => {
  it('promo codes load on Money, the update cohort on Messages, the channel list on Publishing', () => {
    expect(DASH).toMatch(/if \(activeTab === 'revenue'\) \{[^}]*fetchPromos\(\)/);
    expect(DASH).toContain("if (activeTab === 'messages') fetchUpdateCohort()");
    expect(DASH).toContain("if (activeTab === 'publishing') fetchChannels()");
    expect(DASH).not.toMatch(/activeTab === 'settings'\) \{ fetchPromos/);
  });
});

describe('🔒 NULL IS NOT ZERO, one level up', () => {
  const full = badgesFromPayload({
    monitor: { needsAttention: 1 },
    users: { activeToday: 54, total: 1538 },
    engines: { usedToday: 3, configured: 7 },
    revenue: { todayInr: 120, totalInr: 8575 },
    reports: { unopened: 2, open: 5 },
    userreports: { unopened: 0, open: 3 },
    apkreports: { unopened: 1, open: 4 },
  });

  it('Builds sums the two inboxes when both were measured', () => {
    expect(formatBadge(tabBarBadges(full).builds)).toBe('3/9');
    expect(badgeNeedsAttention(tabBarBadges(full).builds)).toBe(true);
  });

  it('Builds shows NOTHING when either inbox could not be read — never a partial sum', () => {
    const half = badgesFromPayload({ reports: { unopened: 2, open: 5 } });
    expect(tabBarBadges(half).builds).toBeNull();
    expect(sumBadges(half.reports, half.apkreports)).toBeNull();
  });

  it('Users shows the activity count, until a complaint is waiting', () => {
    expect(formatBadge(tabBarBadges(full).users)).toBe('54/1538');
    const waiting = badgesFromPayload({ users: { activeToday: 54, total: 1538 }, userreports: { unopened: 2, open: 3 } });
    expect(formatBadge(tabBarBadges(waiting).users)).toBe('2/3');
    expect(badgeNeedsAttention(tabBarBadges(waiting).users)).toBe(true);
  });

  it('tabs with no measured number show none, and an unloaded payload shows none anywhere', () => {
    for (const t of ['apps', 'safety', 'messages', 'settings'] as const) expect(tabBarBadges(full)[t]).toBeNull();
    expect(Object.values(tabBarBadges(null)).every((b) => b === null)).toBe(true);
  });
});

describe('the inboxes that must stay separate are separate pages', () => {
  it('complaints and the user list', () => {
    const users = ADMIN_TABS.find((t) => t.id === 'users')!;
    expect(users.pages.map((p) => p.id)).toEqual(['users', 'userreports']);
  });

  it('phone builds and build reports, each with its own badge', () => {
    const builds = ADMIN_TABS.find((t) => t.id === 'builds')!;
    expect(builds.pages.map((p) => p.id)).toEqual(['reports', 'apkreports', 'health']);
    const b = badgesFromPayload({ reports: { unopened: 2, open: 5 }, apkreports: { unopened: 1, open: 4 } });
    expect(formatBadge(pageBadge('reports', b))).toBe('2/5');
    expect(formatBadge(pageBadge('apkreports', b))).toBe('1/4');
  });

  it('the page row is rendered on every screen size, so a page inside a tab is reachable on a phone', () => {
    const at = DASH.indexOf("{tabDef(openTabId).pages.length > 1 && (");
    expect(at).toBeGreaterThan(-1);
    // not hidden on small screens the way the header strip is
    expect(DASH.slice(at, at + 300)).not.toContain('hidden lg:flex');
  });
});

describe('destructive controls on the moved pages ask first (PR 2 audit point 9)', () => {
  it('reclaiming ONE hosting channel confirms, like Reclaim all already did', () => {
    const fn = DASH.slice(DASH.indexOf('const reclaimChannel = useCallback'), DASH.indexOf('const reclaimAllChannels'));
    expect(fn).toContain('window.confirm(');
    expect(fn.indexOf('window.confirm(')).toBeLessThan(fn.indexOf("fetch(`/api/admin/hosting/channels/"));
  });

  it('the PR 1 confirmations survived the move', () => {
    expect(DASH).toContain('<ConfirmActionDialog');
    expect(DASH).toContain("confirmScope: a.target === 'all' ? ALL_USERS_SCOPE : undefined");
    expect(DASH).not.toMatch(/void handleBan\(/);
  });

  it('the App Mart review entry reuses the existing navigation event, not a second review screen', () => {
    expect(DASH).toContain("new CustomEvent('navbharat:navigate', { detail: { view: 'appstore', storeTab: 'review' } })");
  });
});
